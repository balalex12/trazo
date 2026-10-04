// A laid out graph (infra/graph.ts) as plain Excalidraw elements, without the editor. The import dialog draws the same
// layout through the editor's own converter; this is the editor-free twin used by the MCP server and the tests.
import { ROLE_STYLE, drawFrom } from "../infra/graph";

import {
  arrowElements,
  asBox,
  boxElements,
  defaultCtx,
  styleForRole,
  touch,
} from "./elements";

import type { Layout } from "../infra/graph";
import type { BoxStyle, Ctx, El } from "./elements";

const styleOf = (n: Layout["nodes"][number]): BoxStyle => {
  if (n.kind === "external") {
    return { shape: "ellipse", fill: "#f1f3f5", stroke: "#495057" };
  }
  if (n.kind === "attached") {
    return { fill: "#fff9db", stroke: "#f08c00", dashed: true };
  }
  const s = styleForRole(n.role && n.role in ROLE_STYLE ? n.role : "app");
  return { ...s, dashed: n.dashed };
};

export const layoutToElements = (
  layout: Layout,
  ctx: Ctx = defaultCtx(),
  offset: { x: number; y: number } = { x: 0, y: 0 },
): El[] => {
  const out: El[] = [];
  const boxes = new Map<
    string,
    { id: string; box: { x: number; y: number; width: number; height: number } }
  >();
  for (const n of layout.nodes) {
    const [shape, text] = boxElements(ctx, {
      label: n.lines.join("\n"),
      x: n.x + offset.x,
      y: n.y + offset.y,
      width: n.width,
      height: n.height,
      style: styleOf(n),
    });
    out.push(shape, text);
    boxes.set(n.id, { id: shape.id, box: asBox(shape) });
  }
  const refs = new Map<string, { type: string; id: string }[]>();
  for (const e of layout.edges) {
    const a = boxes.get(drawFrom(layout, e));
    const b = boxes.get(e.to);
    if (!a || !b) {
      continue;
    }
    const made = arrowElements(ctx, {
      from: a,
      to: b,
      label: e.label,
      dashed: e.kind === "attach",
      arrowhead: e.kind !== "attach",
    });
    out.push(...made);
    for (const end of [a.id, b.id]) {
      refs.set(end, [
        ...(refs.get(end) || []),
        { id: made[0].id, type: "arrow" },
      ]);
    }
  }
  return out.map((el) =>
    refs.has(el.id)
      ? touch(ctx, el, {
          boundElements: [...(el.boundElements || []), ...refs.get(el.id)!],
        })
      : el,
  );
};
