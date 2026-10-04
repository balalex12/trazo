// Plain Excalidraw elements built by hand (no editor, no canvas, no DOM), so the same code runs in the browser (agent
// panel) and in Node (MCP server). The shapes mirror what the editor itself saves: bound text in a box, arrows bound
// to boxes with a fixed point. Text boxes are measured from the line count (exact for height) and a width estimate
// (only matters for centered text, which stays centered).
import { ROLE_STYLE, edgeEnds, sizeOf } from "../infra/graph";

import type { LayoutNode, Role } from "../infra/graph";

export type El = { id: string; type: string; [key: string]: any };

export type Ctx = {
  /** a new unique element id */
  id: () => string;
  /** the time stamp written to `updated` / `created` */
  now: () => number;
};

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";

export const defaultCtx = (): Ctx => ({
  id: () => {
    const bytes = new Uint8Array(21);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  },
  now: () => Date.now(),
});

const seed = () => Math.floor(Math.random() * 2 ** 31);

const common = (ctx: Ctx) => ({
  angle: 0,
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  groupIds: [] as string[],
  frameId: null as string | null,
  seed: seed(),
  version: 1,
  versionNonce: seed(),
  isDeleted: false,
  updated: ctx.now(),
  created: ctx.now(),
  link: null,
  locked: false,
});

/** a new version of an element with some fields changed */
export const touch = (
  ctx: Ctx,
  el: El,
  patch: Record<string, unknown>,
): El => ({
  ...el,
  ...patch,
  version: (el.version || 1) + 1,
  versionNonce: seed(),
  updated: ctx.now(),
});

export const textSize = (text: string, fontSize: number) => {
  const lines = text.split("\n");
  return {
    width: Math.max(...lines.map((l) => l.length), 1) * fontSize * 0.55,
    height: lines.length * fontSize * 1.25,
  };
};

export type Box = { x: number; y: number; width: number; height: number };

/** the box of an element */
export const asBox = (e: El): Box => ({
  x: e.x,
  y: e.y,
  width: e.width,
  height: e.height,
});

const textElement = (
  ctx: Ctx,
  o: {
    text: string;
    fontSize: number;
    containerId: string;
    color: string;
    center: { x: number; y: number };
    frameId?: string | null;
  },
): El => {
  const { width, height } = textSize(o.text, o.fontSize);
  return {
    id: ctx.id(),
    type: "text",
    x: o.center.x - width / 2,
    y: o.center.y - height / 2,
    width,
    height,
    strokeColor: o.color,
    backgroundColor: "transparent",
    ...common(ctx),
    frameId: o.frameId ?? null,
    roundness: null,
    boundElements: null,
    text: o.text,
    fontSize: o.fontSize,
    baseFontSize: null,
    fontFamily: 5,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: o.containerId,
    originalText: o.text,
    autoResize: true,
    lineHeight: 1.25,
    labelPosition: null,
  };
};

export type BoxStyle = {
  shape?: "rectangle" | "ellipse";
  fill: string;
  stroke: string;
  dashed?: boolean;
};

export const styleForRole = (role: Role | undefined): BoxStyle => {
  const s = ROLE_STYLE[role && role in ROLE_STYLE ? role : "app"];
  return { fill: s.fill, stroke: s.stroke };
};

/** a box with its label: [rectangle (or ellipse), bound text] */
export const boxElements = (
  ctx: Ctx,
  o: {
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    style: BoxStyle;
    frameId?: string | null;
  },
): [El, El] => {
  const shape: El = {
    id: ctx.id(),
    type: o.style.shape || "rectangle",
    x: o.x,
    y: o.y,
    width: o.width,
    height: o.height,
    strokeColor: o.style.stroke,
    backgroundColor: o.style.fill,
    ...common(ctx),
    strokeStyle: o.style.dashed ? "dashed" : "solid",
    frameId: o.frameId ?? null,
    roundness: o.style.shape === "ellipse" ? null : { type: 3 },
    boundElements: [],
  };
  const text = textElement(ctx, {
    text: o.label,
    fontSize: 16,
    containerId: shape.id,
    color: o.style.stroke,
    center: { x: o.x + o.width / 2, y: o.y + o.height / 2 },
    frameId: o.frameId,
  });
  shape.boundElements = [{ type: "text", id: text.id }];
  return [shape, text];
};

/** the size a box needs for this label */
export const sizeForLabel = (label: string) => sizeOf(label.split("\n"));

const gapPoint = (from: Box, to: Box): [[number, number], [number, number]] =>
  edgeEnds(from as unknown as LayoutNode, to as unknown as LayoutNode);

const fixedPoint = (b: Box, p: [number, number]): [number, number] => [
  (p[0] - b.x) / b.width,
  (p[1] - b.y) / b.height,
];

export type ArrowEnd = {
  /** the element the arrow is bound to */
  id: string;
  /** where the arrow aims (the whole node: a group of icons is one box) */
  box: Box;
  /** the bound element's own box, when it is smaller than `box` (fixed points are relative to it) */
  bindBox?: Box;
};

export type ArrowOptions = {
  from: ArrowEnd;
  to: ArrowEnd;
  label?: string;
  dashed?: boolean;
  arrowhead?: boolean;
  frameId?: string | null;
};

/** geometry and bindings of a straight arrow between two boxes (also used to re-route an existing arrow) */
export const arrowGeometry = (
  from: Box,
  to: Box,
  fromBind: Box = from,
  toBind: Box = to,
) => {
  const [[sx, sy], [ex, ey]] = gapPoint(from, to);
  return {
    x: sx,
    y: sy,
    width: Math.abs(ex - sx),
    height: Math.abs(ey - sy),
    points: [
      [0, 0],
      [ex - sx, ey - sy],
    ] as [number, number][],
    startFixed: fixedPoint(fromBind, [sx, sy]),
    endFixed: fixedPoint(toBind, [ex, ey]),
    mid: { x: (sx + ex) / 2, y: (sy + ey) / 2 },
  };
};

/** an arrow between two boxes, bound at both ends, with an optional label: [arrow, label?] */
export const arrowElements = (ctx: Ctx, o: ArrowOptions): El[] => {
  const g = arrowGeometry(o.from.box, o.to.box, o.from.bindBox, o.to.bindBox);
  const arrow: El = {
    id: ctx.id(),
    type: "arrow",
    x: g.x,
    y: g.y,
    width: g.width,
    height: g.height,
    strokeColor: "#495057",
    backgroundColor: "transparent",
    ...common(ctx),
    strokeStyle: o.dashed ? "dashed" : "solid",
    frameId: o.frameId ?? null,
    roundness: null,
    boundElements: null,
    points: g.points,
    startBinding: {
      elementId: o.from.id,
      mode: "orbit",
      fixedPoint: g.startFixed,
    },
    endBinding: { elementId: o.to.id, mode: "orbit", fixedPoint: g.endFixed },
    startArrowhead: null,
    endArrowhead: o.arrowhead === false ? null : "arrow",
    elbowed: false,
  };
  if (!o.label) {
    return [arrow];
  }
  const label = textElement(ctx, {
    text: o.label,
    fontSize: 14,
    containerId: arrow.id,
    color: "#495057",
    center: g.mid,
    frameId: o.frameId,
  });
  arrow.boundElements = [{ type: "text", id: label.id }];
  return [arrow, label];
};

/** an Excalidraw file (what "Save to…" writes) around some elements */
export const excalidrawFile = (elements: El[]) => ({
  type: "excalidraw",
  version: 2,
  source: "trazo",
  elements,
  appState: { viewBackgroundColor: "#ffffff", gridSize: null },
  files: {},
});
