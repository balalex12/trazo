// What the notebook tells Trazo while you work, and what Trazo does with it: the `trazo` Python module's messages
// (draw a graph, read the canvas), the cell that is running (its boxes light up) and the size of the tables the
// kernel holds (shown next to their boxes). The parsing is pure and tested; the scene edits are at the bottom.
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { MAX_NODES, ROLE_STYLE, clip } from "../infra/graph";

import { parseMap } from "./geomap";

import type { Graph, GraphEdge, GraphNode, Role } from "../infra/graph";
import type { MapSpec } from "./geomap";
import type { RunCell, VarInfo } from "./protocol";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A message from the `trazo` module (tools/lite-python/trazo/__init__.py) */
export type KernelOp =
  | { op: "draw"; title: string; graph: Graph }
  | { op: "map"; map: MapSpec }
  /** the module was imported in a notebook: it wants the canvas, now and whenever it changes */
  | { op: "hello" };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const asText = (v: unknown, max: number): string =>
  clip(typeof v === "string" ? v : v == null ? "" : String(v), max);

/**
 * The graph a notebook asks Trazo to draw. The code that sends it is the user's own, but it is still checked like any
 * other input: sizes are capped, roles must be known ones and an arrow to a box that does not exist is dropped.
 */
export const graphFromDraw = (
  data: Record<string, unknown>,
): { graph: Graph; title: string } | string => {
  if (!Array.isArray(data.nodes) || !data.nodes.length) {
    return "There is nothing to draw: the graph has no nodes.";
  }
  if (data.nodes.length > MAX_NODES) {
    return `That graph has too many nodes to draw (${data.nodes.length}; the limit is ${MAX_NODES}).`;
  }
  const idOf = new Map<string, string>();
  const nodes: GraphNode[] = [];
  for (const raw of data.nodes) {
    if (!isRecord(raw) || raw.id == null) {
      return "Every node needs an id.";
    }
    const key = String(raw.id);
    if (idOf.has(key)) {
      return `Two nodes have the same id (${asText(key, 40)}).`;
    }
    const id = `py${idOf.size + 1}`;
    idOf.set(key, id);
    const details = Array.isArray(raw.details)
      ? raw.details.slice(0, 6).map((d) => asText(d, 40))
      : typeof raw.details === "string" && raw.details
      ? raw.details
          .split("\n")
          .slice(0, 6)
          .map((d) => clip(d, 40))
      : [];
    const role =
      typeof raw.role === "string" && raw.role in ROLE_STYLE
        ? (raw.role as Role)
        : undefined;
    nodes.push({
      id,
      lines: [asText(raw.label ?? key, 40), ...details],
      role,
    });
  }
  const edges: GraphEdge[] = [];
  let dropped = 0;
  for (const raw of Array.isArray(data.edges) ? data.edges.slice(0, 600) : []) {
    const from = isRecord(raw) ? idOf.get(String(raw.from)) : undefined;
    const to = isRecord(raw) ? idOf.get(String(raw.to)) : undefined;
    if (!from || !to || from === to) {
      dropped++;
      continue;
    }
    const label = asText((raw as Record<string, unknown>).label, 30);
    edges.push({
      id: `pye${edges.length + 1}`,
      from,
      to,
      kind: "depends",
      ...(label ? { label } : {}),
    });
  }
  const notes = dropped
    ? [
        `${dropped} edge${
          dropped > 1 ? "s" : ""
        } did not connect two nodes and were left out`,
      ]
    : [];
  return {
    graph: { nodes, edges, flow: true, notes },
    title: asText(data.title, 60),
  };
};

/** What the `trazo` module sent, or null when it is not one of its messages */
export const parseKernelOp = (data: unknown): KernelOp | string | null => {
  if (!isRecord(data) || typeof data.op !== "string") {
    return null;
  }
  if (data.op === "draw") {
    const made = graphFromDraw(data);
    return typeof made === "string"
      ? made
      : { op: "draw", title: made.title, graph: made.graph };
  }
  if (data.op === "map") {
    const made = parseMap(data);
    return typeof made === "string" ? made : { op: "map", map: made };
  }
  if (data.op === "hello") {
    return { op: "hello" };
  }
  return null;
};

/** "400 × 3" for a table, "(200,)" for an array, "n=12" for a list: short, for a label next to a box */
export const sizeLabel = (info: VarInfo): string => {
  const fmt = (n: number) => n.toLocaleString("en-US");
  if (info.shape && info.shape.length === 2) {
    return `${fmt(info.shape[0])} × ${fmt(info.shape[1])}`;
  }
  if (info.shape && info.shape.length) {
    return `(${info.shape.map(fmt).join(", ")}${
      info.shape.length === 1 ? "," : ""
    })`;
  }
  if (info.length !== undefined) {
    return `n=${fmt(info.length)}`;
  }
  return "";
};

/* --- scene edits ------------------------------------------------------------------------------------------------ */

type Meta = { cell?: number; var?: string };
const metaOf = (el: any): Meta | undefined => el?.customData?.trazo;

const RUNNING = { strokeColor: "#e8590c", strokeWidth: 5 };
const DONE = { strokeColor: "#2f9e44", strokeWidth: 4 };

/**
 * Lights up the boxes of the cells that are running (orange) and, for a moment, those that just finished (green).
 * `before` remembers each box's own colours so they come back. Not an undo step.
 */
export const showRun = (
  api: ExcalidrawImperativeAPI,
  cells: RunCell[],
  previous: RunCell[],
  before: Map<string, { strokeColor: string; strokeWidth: number }>,
): void => {
  const running = new Set(
    cells.filter((c) => c.state === "running").map((c) => c.ord),
  );
  const wasRunning = new Set(
    previous.filter((c) => c.state === "running").map((c) => c.ord),
  );
  const finished = new Set([...wasRunning].filter((o) => !running.has(o)));
  const scene = api.getSceneElementsIncludingDeleted() as readonly any[];
  let changed = false;
  const next = scene.map((el) => {
    const cell = metaOf(el)?.cell;
    if (el.isDeleted || cell === undefined || el.type === "text") {
      return el;
    }
    const style = running.has(cell)
      ? RUNNING
      : finished.has(cell)
      ? DONE
      : null;
    if (style) {
      if (!before.has(el.id)) {
        before.set(el.id, {
          strokeColor: el.strokeColor,
          strokeWidth: el.strokeWidth,
        });
      }
      changed = true;
      return {
        ...el,
        ...style,
        version: el.version + 1,
        versionNonce: Math.floor(Math.random() * 2 ** 31),
        updated: Date.now(),
      };
    }
    const own = before.get(el.id);
    if (own) {
      before.delete(el.id);
      changed = true;
      return {
        ...el,
        ...own,
        version: el.version + 1,
        versionNonce: Math.floor(Math.random() * 2 ** 31),
        updated: Date.now(),
      };
    }
    return el;
  });
  if (changed) {
    api.updateScene({
      elements: next as any,
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }
};

/** Puts back the colours of every box that is still lit (a moment after a cell finished) */
export const clearRun = (
  api: ExcalidrawImperativeAPI,
  before: Map<string, { strokeColor: string; strokeWidth: number }>,
): void => {
  if (!before.size) {
    return;
  }
  const next = (api.getSceneElementsIncludingDeleted() as readonly any[]).map(
    (el) => {
      const own = before.get(el.id);
      return own
        ? {
            ...el,
            ...own,
            version: el.version + 1,
            versionNonce: Math.floor(Math.random() * 2 ** 31),
            updated: Date.now(),
          }
        : el;
    },
  );
  before.clear();
  api.updateScene({
    elements: next as any,
    captureUpdate: CaptureUpdateAction.NEVER,
  });
};

/**
 * Writes the size of each table next to its box ("400 × 3"), from what the kernel holds right now. A box is found by
 * the variable it was drawn for; when the same name was read twice (df, df (2)) the last one gets the label.
 */
export const showVars = (
  api: ExcalidrawImperativeAPI,
  vars: Record<string, VarInfo>,
): void => {
  const scene = api.getSceneElementsIncludingDeleted() as readonly any[];
  const latest = new Map<string, any>();
  for (const el of scene) {
    const m = metaOf(el);
    if (el.isDeleted || !m?.var || el.type === "text") {
      continue;
    }
    const old = latest.get(m.var);
    if (!old || (metaOf(old)?.cell ?? 0) <= (m.cell ?? 0)) {
      latest.set(m.var, el);
    }
  }
  const badges = new Map<string, any>();
  for (const el of scene) {
    const id = el.customData?.trazoBadge;
    if (!el.isDeleted && typeof id === "string") {
      badges.set(id, el);
    }
  }
  const retire: string[] = [];
  const add: any[] = [];
  for (const [name, box] of latest) {
    const info = vars[name];
    const text = info ? sizeLabel(info) : "";
    const badge = badges.get(box.id);
    if (badge && badge.text === text) {
      continue;
    }
    if (badge) {
      retire.push(badge.id);
    }
    if (text) {
      add.push({
        type: "text",
        text,
        x: box.x + box.width - 8,
        y: box.y - 22,
        fontSize: 14,
        strokeColor: "#868e96",
        textAlign: "right",
        customData: { trazoBadge: box.id },
      });
    }
  }
  if (!retire.length && !add.length) {
    return;
  }
  const created = convertToExcalidrawElements(add) as any[];
  // right-align: the converter places text by its left edge
  created.forEach((c) => {
    c.x -= c.width;
  });
  const next = [
    ...scene.map((el) =>
      retire.includes(el.id)
        ? {
            ...el,
            isDeleted: true,
            version: el.version + 1,
            versionNonce: Math.floor(Math.random() * 2 ** 31),
            updated: Date.now(),
          }
        : el,
    ),
    ...created,
  ];
  api.updateScene({
    elements: next as any,
    captureUpdate: CaptureUpdateAction.NEVER,
  });
};
