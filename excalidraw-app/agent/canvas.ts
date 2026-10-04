// What is on the canvas, as a graph: boxes (a shape with its text, a group of icons with its labels, a loose text)
// and the arrows that connect them. This is the view an AI gets, and what the edit operations talk about.
import { ROLE_STYLE } from "../infra/graph";

import type { Role } from "../infra/graph";
import type { Box, El } from "./elements";

export type NodeInfo = {
  /** the element id of a single shape, or "g:<groupId>" for a group */
  key: string;
  /** the first line of each text: the name of the box */
  label: string;
  /** the other lines (columns of a table, for example) */
  details: string;
  kind: "shape" | "icon" | "text";
  box: Box;
  /** every element that belongs to the node (shapes, icons, texts) */
  members: El[];
  /** the element arrows attach to */
  primary: El;
  role?: Role;
  frameId: string | null;
};

export type EdgeInfo = {
  arrow: El;
  from: string;
  to: string;
  label: string;
  /** the text element that is the arrow's label, if any */
  labelEl?: El;
};

export type CanvasIndex = {
  nodes: Map<string, NodeInfo>;
  edges: EdgeInfo[];
  /** element id -> the node it belongs to */
  nodeOf: Map<string, string>;
  frames: { id: string; name: string }[];
  /** arrows that are not bound at both ends (the agent cannot talk about them) */
  looseArrows: number;
};

const LINEAR = new Set(["arrow", "line", "freedraw"]);
const FRAMES = new Set(["frame", "magicframe"]);

const ROLE_BY_FILL = new Map(
  (Object.entries(ROLE_STYLE) as [Role, { fill: string }][]).map(([r, s]) => [
    s.fill.toLowerCase(),
    r,
  ]),
);

const unionBox = (els: El[]): Box => {
  const x1 = Math.min(...els.map((e) => e.x));
  const y1 = Math.min(...els.map((e) => e.y));
  const x2 = Math.max(...els.map((e) => e.x + e.width));
  const y2 = Math.max(...els.map((e) => e.y + e.height));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
};

export const buildIndex = (elements: readonly El[]): CanvasIndex => {
  const live = elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));

  const keyOf = (e: El): string | null => {
    if (LINEAR.has(e.type) || FRAMES.has(e.type)) {
      return null;
    }
    if (e.type === "text" && e.containerId) {
      const c = byId.get(e.containerId);
      if (c?.type === "arrow") {
        return null; // an arrow's label
      }
      return c ? keyOf(c) : e.id;
    }
    const groups: string[] = e.groupIds || [];
    return groups.length ? `g:${groups[groups.length - 1]}` : e.id;
  };

  const members = new Map<string, El[]>();
  const nodeOf = new Map<string, string>();
  for (const e of live) {
    const k = keyOf(e);
    if (k) {
      members.set(k, [...(members.get(k) || []), e]);
      nodeOf.set(e.id, k);
    }
  }

  const nodes = new Map<string, NodeInfo>();
  for (const [key, els] of members) {
    const shapes = els.filter((e) => e.type !== "text");
    const texts = els
      .filter((e) => e.type === "text")
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const solid = shapes.length ? shapes : texts;
    const primary = [...solid].sort(
      (a, b) => b.width * b.height - a.width * a.height,
    )[0];
    const lines = texts.map((t) =>
      String(t.text || "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
    );
    const label = lines
      .map((l) => l[0])
      .filter(Boolean)
      .join(" / ");
    const details = lines.flatMap((l) => l.slice(1)).join(" | ");
    const kind: NodeInfo["kind"] = !shapes.length
      ? "text"
      : shapes.every((s) =>
          ["rectangle", "ellipse", "diamond"].includes(s.type),
        )
      ? "shape"
      : "icon";
    nodes.set(key, {
      key,
      label,
      details,
      kind,
      box: unionBox(solid),
      members: els,
      primary,
      role:
        kind === "shape"
          ? ROLE_BY_FILL.get(String(primary.backgroundColor).toLowerCase())
          : undefined,
      frameId: primary.frameId ?? null,
    });
  }

  const edges: EdgeInfo[] = [];
  let looseArrows = 0;
  for (const a of live) {
    if (a.type !== "arrow") {
      continue;
    }
    const s = a.startBinding && nodeOf.get(a.startBinding.elementId);
    const t = a.endBinding && nodeOf.get(a.endBinding.elementId);
    if (!s || !t) {
      looseArrows++;
      continue;
    }
    const labelId = (a.boundElements || []).find(
      (b: { type: string; id: string }) => b.type === "text",
    )?.id;
    const labelEl = labelId ? byId.get(labelId) : undefined;
    edges.push({
      arrow: a,
      from: s,
      to: t,
      label: labelEl ? String(labelEl.text || "").trim() : "",
      labelEl,
    });
  }

  return {
    nodes,
    edges,
    nodeOf,
    frames: live
      .filter((e) => FRAMES.has(e.type))
      .map((f) => ({ id: f.id, name: String(f.name || "") })),
    looseArrows,
  };
};

export type Summary = {
  nodes: {
    id: string;
    label: string;
    details?: string;
    kind: NodeInfo["kind"];
    role?: Role;
    x: number;
    y: number;
    w: number;
    h: number;
    frame?: string;
  }[];
  edges: { id: string; from: string; to: string; label?: string }[];
  frames: { id: string; name: string }[];
  selected: string[];
  /** how many nodes were left out to keep the summary small */
  omitted?: number;
  looseArrows?: number;
};

export const MAX_SUMMARY_NODES = 150;

/** the compact picture of the canvas an AI receives */
export const summarize = (
  elements: readonly El[],
  selectedIds: readonly string[] = [],
): Summary => {
  const idx = buildIndex(elements);
  const all = [...idx.nodes.values()].sort(
    (a, b) => a.box.y - b.box.y || a.box.x - b.box.x,
  );
  const shown = all.slice(0, MAX_SUMMARY_NODES);
  const keep = new Set(shown.map((n) => n.key));
  const selected = [
    ...new Set(
      selectedIds
        .map((id) => idx.nodeOf.get(id))
        .filter((k): k is string => !!k),
    ),
  ].filter((k) => keep.has(k));
  const r = Math.round;
  return {
    nodes: shown.map((n) => ({
      id: n.key,
      label: n.label,
      ...(n.details ? { details: n.details.slice(0, 240) } : {}),
      kind: n.kind,
      ...(n.role ? { role: n.role } : {}),
      x: r(n.box.x),
      y: r(n.box.y),
      w: r(n.box.width),
      h: r(n.box.height),
      ...(n.frameId ? { frame: n.frameId } : {}),
    })),
    edges: idx.edges
      .filter((e) => keep.has(e.from) && keep.has(e.to))
      .map((e) => ({
        id: e.arrow.id,
        from: e.from,
        to: e.to,
        ...(e.label ? { label: e.label } : {}),
      })),
    frames: idx.frames,
    selected,
    ...(all.length > shown.length
      ? { omitted: all.length - shown.length }
      : {}),
    ...(idx.looseArrows ? { looseArrows: idx.looseArrows } : {}),
  };
};
