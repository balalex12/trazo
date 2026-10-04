// The edits an AI may ask for, and how they are applied to the canvas. Pure: elements in, new elements out, so the
// agent panel (browser) and the MCP server (Node) share it, and a result can be previewed before it is applied.
//
// The AI never writes Excalidraw JSON. It names boxes by the ids of the canvas summary and asks for a few simple
// operations; everything here is validated, and what cannot be done is reported, not guessed.
import { ROLE_STYLE } from "../infra/graph";

import { buildIndex } from "./canvas";
import {
  arrowElements,
  arrowGeometry,
  asBox,
  boxElements,
  defaultCtx,
  sizeForLabel,
  styleForRole,
  textSize,
  touch,
} from "./elements";

import type { Role } from "../infra/graph";
import type { NodeInfo } from "./canvas";
import type { Box, Ctx, El } from "./elements";

export const ROLES = Object.keys(ROLE_STYLE) as Role[];
export const MAX_OPS = 50;
const GAP = 60;

export type Op =
  | {
      op: "add_node";
      id?: string;
      label: string;
      role?: Role;
      near?: string;
      between?: [string, string];
      x?: number;
      y?: number;
    }
  | { op: "add_edge"; from: string; to: string; label?: string }
  | { op: "update_node"; id: string; label?: string; role?: Role }
  | { op: "delete_node"; id: string }
  | { op: "delete_edge"; from: string; to: string }
  | { op: "move_node"; id: string; x: number; y: number };

export type ApplyResult = {
  elements: El[];
  /** one plain sentence per thing done */
  applied: string[];
  /** one plain sentence per thing that was not done, and why */
  skipped: string[];
};

const isRole = (r: unknown): r is Role =>
  typeof r === "string" && (ROLES as string[]).includes(r);
const num = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
const center = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const overlaps = (a: Box, b: Box, pad = 24) =>
  a.x < b.x + b.width + pad &&
  a.x + a.width + pad > b.x &&
  a.y < b.y + b.height + pad &&
  a.y + a.height + pad > b.y;

export const applyOps = (
  elements: readonly El[],
  rawOps: unknown,
  ctx: Ctx = defaultCtx(),
): ApplyResult => {
  let els: El[] = [...elements];
  const applied: string[] = [];
  const skipped: string[] = [];
  const alias = new Map<string, string>();
  const ops = Array.isArray(rawOps) ? rawOps : [];
  if (!Array.isArray(rawOps) || !ops.length) {
    return { elements: els, applied, skipped };
  }
  if (ops.length > MAX_OPS) {
    skipped.push(
      `Only the first ${MAX_OPS} of ${ops.length} operations were read.`,
    );
  }

  const resolve = (id: unknown): string | undefined =>
    typeof id === "string" ? alias.get(id) ?? id : undefined;
  const label = (n: NodeInfo | undefined, fallback = "?") =>
    `"${(n?.label || fallback).slice(0, 40)}"`;

  const patch = (id: string, changes: Record<string, unknown>) => {
    els = els.map((e) => (e.id === id ? touch(ctx, e, changes) : e));
  };
  const translate = (keys: Set<string>, dx: number, dy: number) => {
    const idx = buildIndex(els);
    const ids = new Set<string>();
    for (const k of keys) {
      idx.nodes.get(k)?.members.forEach((m) => ids.add(m.id));
    }
    els = els.map((e) =>
      ids.has(e.id) ? touch(ctx, e, { x: e.x + dx, y: e.y + dy }) : e,
    );
  };
  /** straight arrows between the (moved or resized) nodes are drawn again from edge to edge */
  const reroute = (keys: Set<string>) => {
    const idx = buildIndex(els);
    const byId = new Map(els.map((e) => [e.id, e]));
    for (const e of idx.edges) {
      if (!keys.has(e.from) && !keys.has(e.to)) {
        continue;
      }
      const A = idx.nodes.get(e.from);
      const B = idx.nodes.get(e.to);
      const sa = byId.get(e.arrow.startBinding.elementId);
      const sb = byId.get(e.arrow.endBinding.elementId);
      if (!A || !B || !sa || !sb) {
        continue;
      }
      const g = arrowGeometry(A.box, B.box, asBox(sa), asBox(sb));
      patch(e.arrow.id, {
        x: g.x,
        y: g.y,
        width: g.width,
        height: g.height,
        points: g.points,
        startBinding: { ...e.arrow.startBinding, fixedPoint: g.startFixed },
        endBinding: { ...e.arrow.endBinding, fixedPoint: g.endFixed },
      });
      if (e.labelEl) {
        patch(e.labelEl.id, {
          x: g.mid.x - e.labelEl.width / 2,
          y: g.mid.y - e.labelEl.height / 2,
        });
      }
    }
  };
  /** removes elements, and from the survivors every reference to them */
  const remove = (ids: Set<string>) => {
    els = els
      .map((e) => (ids.has(e.id) ? touch(ctx, e, { isDeleted: true }) : e))
      .map((e) =>
        !ids.has(e.id) &&
        (e.boundElements || []).some((b: { id: string }) => ids.has(b.id))
          ? touch(ctx, e, {
              boundElements: (e.boundElements || []).filter(
                (b: { id: string }) => !ids.has(b.id),
              ),
            })
          : e,
      );
  };
  const arrowsOf = (memberIds: Set<string>): Set<string> => {
    const out = new Set<string>();
    for (const e of els) {
      if (
        e.type === "arrow" &&
        !e.isDeleted &&
        (memberIds.has(e.startBinding?.elementId) ||
          memberIds.has(e.endBinding?.elementId))
      ) {
        out.add(e.id);
        (e.boundElements || []).forEach((b: { id: string; type: string }) => {
          if (b.type === "text") {
            out.add(b.id);
          }
        });
      }
    }
    return out;
  };

  ops.slice(0, MAX_OPS).forEach((raw, i) => {
    const n = i + 1;
    const op = raw as Record<string, unknown>;
    if (!op || typeof op !== "object" || typeof op.op !== "string") {
      skipped.push(`Operation ${n} is not an operation.`);
      return;
    }
    const idx = buildIndex(els);
    const node = (id: unknown) => {
      const k = resolve(id);
      return k ? idx.nodes.get(k) : undefined;
    };

    switch (op.op) {
      case "add_node": {
        const text = str(op.label);
        if (!text) {
          skipped.push(`Operation ${n}: a new box needs a label.`);
          return;
        }
        const role = isRole(op.role) ? op.role : "app";
        const { width, height } = sizeForLabel(text.slice(0, 200));
        const others = [...idx.nodes.values()].map((x) => x.box);
        let x = 0;
        let y = 0;
        let frameId: string | null = null;
        const [ia, ib] = Array.isArray(op.between) ? op.between : [];
        const A = node(ia);
        const B = node(ib);
        const near = node(op.near);
        if (num(op.x) && num(op.y)) {
          x = op.x;
          y = op.y;
        } else if (A && B && A !== B) {
          frameId = A.frameId === B.frameId ? A.frameId : null;
          const ca = center(A.box);
          const cb = center(B.box);
          const horizontal = Math.abs(ca.x - cb.x) >= Math.abs(ca.y - cb.y);
          let first = A;
          let second = B;
          if (horizontal ? ca.x > cb.x : ca.y > cb.y) {
            first = B;
            second = A;
          }
          const gap = horizontal
            ? second.box.x - (first.box.x + first.box.width)
            : second.box.y - (first.box.y + first.box.height);
          const need = (horizontal ? width : height) + 2 * GAP;
          if (gap < need) {
            // make room: everything from the second box on moves away
            const moved = new Set(
              [...idx.nodes.values()]
                .filter((m) =>
                  horizontal
                    ? m.box.x >= second.box.x - 1
                    : m.box.y >= second.box.y - 1,
                )
                .map((m) => m.key),
            );
            translate(
              moved,
              horizontal ? need - gap : 0,
              horizontal ? 0 : need - gap,
            );
            reroute(moved);
          }
          const fresh = buildIndex(els);
          const fa = fresh.nodes.get(first.key)!.box;
          const fb = fresh.nodes.get(second.key)!.box;
          if (horizontal) {
            x = (fa.x + fa.width + fb.x) / 2 - width / 2;
            y = (center(fa).y + center(fb).y) / 2 - height / 2;
          } else {
            y = (fa.y + fa.height + fb.y) / 2 - height / 2;
            x = (center(fa).x + center(fb).x) / 2 - width / 2;
          }
        } else if (near) {
          frameId = near.frameId;
          x = near.box.x + near.box.width + 100;
          y = near.box.y + (near.box.height - height) / 2;
        } else if (others.length) {
          x = Math.min(...others.map((b) => b.x));
          y = Math.max(...others.map((b) => b.y + b.height)) + 80;
        }
        if (!(num(op.x) && num(op.y))) {
          // not on top of anything else: step down, then further right
          const taken = [...buildIndex(els).nodes.values()].map((m) => m.box);
          for (let tries = 0; tries < 40; tries++) {
            const box = { x, y, width, height };
            if (!taken.some((t) => overlaps(box, t))) {
              break;
            }
            y += height + 40;
            if (tries % 10 === 9) {
              y -= 10 * (height + 40);
              x += width + 100;
            }
          }
        }
        const [shape, textEl] = boxElements(ctx, {
          label: text.slice(0, 200),
          x,
          y,
          width,
          height,
          style: styleForRole(role),
          frameId,
        });
        els = [...els, shape, textEl];
        if (typeof op.id === "string" && op.id.trim()) {
          if (idx.nodes.has(op.id)) {
            skipped.push(
              `"${op.id}" is already used by a box; the new box got its own name.`,
            );
          } else {
            alias.set(op.id, shape.id);
          }
        }
        applied.push(`Added ${label({ label: text } as NodeInfo)}`);
        return;
      }

      case "add_edge": {
        const A = node(op.from);
        const B = node(op.to);
        if (!A || !B) {
          skipped.push(
            `Operation ${n}: cannot link ${String(op.from)} to ${String(
              op.to,
            )}, one of them is not on the canvas.`,
          );
          return;
        }
        if (A === B) {
          skipped.push(`Operation ${n}: a box cannot be linked to itself.`);
          return;
        }
        if (idx.edges.some((e) => e.from === A.key && e.to === B.key)) {
          skipped.push(`${label(A)} is already linked to ${label(B)}.`);
          return;
        }
        const made = arrowElements(ctx, {
          from: { id: A.primary.id, box: A.box, bindBox: asBox(A.primary) },
          to: { id: B.primary.id, box: B.box, bindBox: asBox(B.primary) },
          label: str(op.label)?.slice(0, 60),
          frameId: A.frameId === B.frameId ? A.frameId : null,
        });
        const arrowId = made[0].id;
        els = [...els, ...made];
        for (const end of [A.primary.id, B.primary.id]) {
          const cur = els.find((e) => e.id === end)!;
          patch(end, {
            boundElements: [
              ...(cur.boundElements || []),
              { id: arrowId, type: "arrow" },
            ],
          });
        }
        applied.push(`Linked ${label(A)} to ${label(B)}`);
        return;
      }

      case "update_node": {
        const target = node(op.id);
        if (!target) {
          skipped.push(
            `Operation ${n}: ${String(op.id)} is not on the canvas.`,
          );
          return;
        }
        const newLabel = str(op.label)?.slice(0, 200);
        const newRole = isRole(op.role) ? op.role : undefined;
        if (!newLabel && !newRole) {
          skipped.push(
            `Operation ${n}: nothing to change in ${label(target)}.`,
          );
          return;
        }
        const before = label(target);
        if (newRole) {
          if (target.kind !== "shape") {
            skipped.push(
              `${before} is not a plain box, so its role was not changed.`,
            );
          } else {
            const st = styleForRole(newRole);
            patch(target.primary.id, {
              backgroundColor: st.fill,
              strokeColor: st.stroke,
            });
            target.members
              .filter((m) => m.type === "text")
              .forEach((t) => patch(t.id, { strokeColor: st.stroke }));
            applied.push(`Made ${before} a ${newRole}`);
          }
        }
        if (newLabel) {
          const texts = target.members.filter((m) => m.type === "text");
          if (texts.length !== 1) {
            skipped.push(
              `${before} has ${texts.length} texts, so it was not renamed.`,
            );
            return;
          }
          const t = texts[0];
          // only the first line is the name; the other lines (columns of a table, for example) stay
          const rest = String(t.text || "")
            .split("\n")
            .slice(1);
          const full = [newLabel, ...rest].join("\n");
          const size = textSize(full, t.fontSize || 16);
          if (t.containerId) {
            const c = target.primary;
            const grown = sizeForLabel(full);
            const w = Math.max(c.width, grown.width);
            const h = Math.max(c.height, grown.height);
            const cc = center(asBox(c));
            patch(c.id, {
              x: cc.x - w / 2,
              y: cc.y - h / 2,
              width: w,
              height: h,
            });
            patch(t.id, {
              text: full,
              originalText: full,
              width: size.width,
              height: size.height,
              x: cc.x - size.width / 2,
              y: cc.y - size.height / 2,
            });
            reroute(new Set([target.key]));
          } else {
            patch(t.id, {
              text: full,
              originalText: full,
              width: size.width,
              height: size.height,
            });
          }
          applied.push(`Renamed ${before} to "${newLabel}"`);
        }
        return;
      }

      case "delete_node": {
        const target = node(op.id);
        if (!target) {
          skipped.push(
            `Operation ${n}: ${String(op.id)} is not on the canvas.`,
          );
          return;
        }
        const members = new Set(target.members.map((m) => m.id));
        const gone = new Set([...members, ...arrowsOf(members)]);
        remove(gone);
        applied.push(`Deleted ${label(target)} and its arrows`);
        return;
      }

      case "delete_edge": {
        const A = node(op.from);
        const B = node(op.to);
        if (!A || !B) {
          skipped.push(
            `Operation ${n}: one of the boxes is not on the canvas.`,
          );
          return;
        }
        let found = idx.edges.filter((e) => e.from === A.key && e.to === B.key);
        if (!found.length) {
          found = idx.edges.filter((e) => e.from === B.key && e.to === A.key);
        }
        if (!found.length) {
          skipped.push(`${label(A)} and ${label(B)} are not linked.`);
          return;
        }
        const gone = new Set<string>();
        found.forEach((e) => {
          gone.add(e.arrow.id);
          if (e.labelEl) {
            gone.add(e.labelEl.id);
          }
        });
        remove(gone);
        applied.push(`Removed the link between ${label(A)} and ${label(B)}`);
        return;
      }

      case "move_node": {
        const target = node(op.id);
        if (!target || !num(op.x) || !num(op.y)) {
          skipped.push(`Operation ${n}: cannot move ${String(op.id)}.`);
          return;
        }
        const keys = new Set([target.key]);
        translate(keys, op.x - target.box.x, op.y - target.box.y);
        reroute(keys);
        applied.push(`Moved ${label(target)}`);
        return;
      }

      default:
        skipped.push(`Operation ${n}: "${op.op}" is not something I can do.`);
    }
  });

  return { elements: els, applied, skipped };
};
