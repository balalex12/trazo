// `trazo.map(gdf)` in a notebook sends projected, simplified shapes in pixels (tools/lite-python/trazo). This turns
// them into hand-drawn elements inside a frame, with labels and a legend. The shapes come from the user's own code,
// but they are validated like any other input: sizes are capped, numbers must be finite and colours plain hex.
import { clip } from "../infra/graph";

import type { Skeleton } from "../infra/graph";

export type MapShape = {
  kind: "polygon" | "hole" | "line" | "point";
  pts: [number, number][];
  fill?: string;
};

export type MapSpec = {
  title: string;
  width: number;
  height: number;
  shapes: MapShape[];
  labels: { x: number; y: number; text: string }[];
  legend: { label: string; color: string }[];
  note: string;
};

const MAX_SHAPES = 1500;
const MAX_POINTS = 8000;
const MAX_LABELS = 120;
const MAX_LEGEND = 12;
const MAX_SIDE = 5000;

const HEX = /^#[0-9a-fA-F]{6}$/;
const KINDS = new Set(["polygon", "hole", "line", "point"]);

const num = (v: unknown, max = MAX_SIDE): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The map to draw, or a sentence saying why it cannot be drawn */
export const parseMap = (data: Record<string, unknown>): MapSpec | string => {
  if (!num(data.width, MAX_SIDE) || !num(data.height, MAX_SIDE)) {
    return "The map has no valid size.";
  }
  if (!Array.isArray(data.shapes) || !data.shapes.length) {
    return "There is nothing to draw: the map has no shapes.";
  }
  if (data.shapes.length > MAX_SHAPES) {
    return `That map has too many shapes to draw (${data.shapes.length}; the limit is ${MAX_SHAPES}).`;
  }
  const shapes: MapShape[] = [];
  let points = 0;
  for (const raw of data.shapes) {
    if (
      !isRecord(raw) ||
      typeof raw.kind !== "string" ||
      !KINDS.has(raw.kind) ||
      !Array.isArray(raw.pts)
    ) {
      return "A shape of the map is malformed.";
    }
    const kind = raw.kind as MapShape["kind"];
    const need = kind === "point" ? 1 : kind === "line" ? 2 : 4;
    if (raw.pts.length < need) {
      return "A shape of the map has too few points.";
    }
    points += raw.pts.length;
    if (points > MAX_POINTS) {
      return `That map has too many points to draw (the limit is ${MAX_POINTS}). Simplify the geometries first.`;
    }
    const pts: [number, number][] = [];
    for (const p of raw.pts) {
      if (!Array.isArray(p) || !num(p[0]) || !num(p[1])) {
        return "A point of the map is not a pair of numbers.";
      }
      pts.push([p[0], p[1]]);
    }
    const fill =
      typeof raw.fill === "string" && HEX.test(raw.fill) ? raw.fill : undefined;
    shapes.push({ kind, pts, ...(fill ? { fill } : {}) });
  }
  const labels: MapSpec["labels"] = [];
  for (const l of (Array.isArray(data.labels) ? data.labels : []).slice(
    0,
    MAX_LABELS,
  )) {
    if (
      isRecord(l) &&
      num(l.x) &&
      num(l.y) &&
      typeof l.text === "string" &&
      l.text
    ) {
      labels.push({ x: l.x, y: l.y, text: clip(l.text, 30) });
    }
  }
  const legend: MapSpec["legend"] = [];
  for (const e of (Array.isArray(data.legend) ? data.legend : []).slice(
    0,
    MAX_LEGEND,
  )) {
    if (
      isRecord(e) &&
      typeof e.label === "string" &&
      typeof e.color === "string" &&
      HEX.test(e.color)
    ) {
      legend.push({ label: clip(e.label, 30), color: e.color });
    }
  }
  return {
    title: clip(typeof data.title === "string" ? data.title : "", 60),
    width: data.width,
    height: data.height,
    shapes,
    labels,
    legend,
    note: clip(typeof data.note === "string" ? data.note : "", 60),
  };
};

const STROKE = "#495057";
const LINE_STROKE = "#1971c2";
const POINT_FILL = "#e03131";
const DOT = 9;

/**
 * The elements of a map: a frame (named after the title) with the shapes and labels inside, and the legend under it.
 * `offset` places it; `uid` makes the element ids (random by default, fixed in tests). Also gives the area it covers.
 */
export const mapToSkeleton = (
  spec: MapSpec,
  offset: { x: number; y: number } = { x: 0, y: 0 },
  uid: () => string = () => Math.random().toString(36).slice(2, 10),
): { skeleton: Skeleton[]; bounds: [number, number, number, number] } => {
  const run = uid();
  let n = 0;
  const id = (what: string) => `map-${run}-${what}${++n}`;
  const ox = offset.x;
  const oy = offset.y;
  const children: Skeleton[] = [];

  for (const s of spec.shapes) {
    if (s.kind === "point") {
      children.push({
        type: "ellipse",
        id: id("pt"),
        x: ox + s.pts[0][0] - DOT / 2,
        y: oy + s.pts[0][1] - DOT / 2,
        width: DOT,
        height: DOT,
        backgroundColor: s.fill ?? POINT_FILL,
        fillStyle: "solid",
        strokeColor: STROKE,
        strokeWidth: 1,
        roughness: 0,
      });
      continue;
    }
    const [x0, y0] = s.pts[0];
    const rel = s.pts.map(([x, y]) => [x - x0, y - y0]);
    const xs = rel.map((p) => p[0]);
    const ys = rel.map((p) => p[1]);
    const closed = s.kind !== "line";
    children.push({
      type: "line",
      id: id(closed ? "poly" : "line"),
      x: ox + x0,
      y: oy + y0,
      points: rel,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      polygon: closed,
      backgroundColor: closed
        ? s.kind === "hole"
          ? "#ffffff"
          : s.fill ?? "#a5d8ff"
        : "transparent",
      fillStyle: "solid",
      strokeColor: closed ? STROKE : LINE_STROKE,
      strokeWidth: closed ? 1 : 2,
      roughness: 0,
    });
  }
  for (const l of spec.labels) {
    // text is placed by its left edge: centre it by an estimate of its width
    const w = l.text.length * 7.6;
    children.push({
      type: "text",
      id: id("lbl"),
      x: ox + l.x - w / 2,
      y: oy + l.y - 9,
      text: l.text,
      fontSize: 14,
      strokeColor: "#1e1e1e",
    });
  }

  const frameId = id("frame");
  const skeleton: Skeleton[] = [
    {
      type: "frame",
      id: frameId,
      x: ox,
      y: oy,
      width: spec.width,
      height: spec.height,
      name: spec.title || "Map",
      children: children.map((c) => c.id as string),
    },
    ...children,
  ];

  // legend under the frame: a swatch and a name for each class or category, then the note about simplification
  let y = oy + spec.height + 14;
  for (const e of spec.legend) {
    skeleton.push(
      {
        type: "rectangle",
        id: id("key"),
        x: ox,
        y,
        width: 16,
        height: 16,
        backgroundColor: e.color,
        fillStyle: "solid",
        strokeColor: STROKE,
        strokeWidth: 1,
        roughness: 0,
      },
      {
        type: "text",
        id: id("keytext"),
        x: ox + 24,
        y: y - 1,
        text: e.label,
        fontSize: 14,
        strokeColor: "#1e1e1e",
      },
    );
    y += 22;
  }
  if (spec.note) {
    skeleton.push({
      type: "text",
      id: id("note"),
      x: ox,
      y,
      text: spec.note,
      fontSize: 12,
      strokeColor: "#868e96",
    });
    y += 18;
  }
  return {
    skeleton,
    bounds: [ox, oy, ox + spec.width, Math.max(y, oy + spec.height)],
  };
};
