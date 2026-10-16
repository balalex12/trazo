// The conversation between Trazo and the notebook panel (JupyterLite in an iframe on its own origin). Plain
// `postMessage`, a handful of message types, checked on both sides. tools/lite-bridge.js is the other end.
import type { CanvasIndex } from "../agent/canvas";

export const PROTOCOL = "trazo-notebook/1";

/** Trazo -> notebook */
export type Request =
  | { proto: typeof PROTOCOL; type: "get-notebook"; id: string }
  | {
      proto: typeof PROTOCOL;
      type: "insert-cell";
      id: string;
      source: string;
    }
  /** the answer to a message the `trazo` Python module sent (see `kernel` below); goes back down the same comm */
  | {
      proto: typeof PROTOCOL;
      type: "kernel-reply";
      commId: string;
      data: unknown;
    };

/** What the kernel knows about a variable (a table, an array…), as far as Trazo cares */
export type VarInfo = {
  kind: string;
  shape?: number[];
  columns?: string[];
  length?: number;
};

/** One code cell of the open notebook: its position among the code cells, its `[n]` and whether it is running */
export type RunCell = {
  ord: number;
  count: number | null;
  state: "idle" | "running";
};

/** notebook -> Trazo */
export type Reply =
  | { proto: typeof PROTOCOL; type: "ready" }
  | {
      proto: typeof PROTOCOL;
      type: "notebook";
      id: string;
      path: string;
      text: string;
    }
  | { proto: typeof PROTOCOL; type: "inserted"; id: string; path: string }
  | { proto: typeof PROTOCOL; type: "error"; id: string; message: string }
  /** a message from the `trazo` Python module running in the notebook's kernel */
  | { proto: typeof PROTOCOL; type: "kernel"; commId: string; data: unknown }
  /** the cells of the open notebook changed state (one started or finished running) */
  | { proto: typeof PROTOCOL; type: "run"; cells: RunCell[] }
  /** the variables of the kernel (sent after every run) */
  | { proto: typeof PROTOCOL; type: "vars"; vars: Record<string, VarInfo> };

const REPLIES = new Set([
  "ready",
  "notebook",
  "inserted",
  "error",
  "kernel",
  "run",
  "vars",
]);
const MAX_CELLS = 2000;
const MAX_VARS = 300;
const MAX_COLUMNS = 60;

const isCount = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

const parseCells = (v: unknown): RunCell[] | null => {
  if (!Array.isArray(v) || v.length > MAX_CELLS) {
    return null;
  }
  const out: RunCell[] = [];
  for (const c of v) {
    if (typeof c !== "object" || c === null) {
      return null;
    }
    const { ord, count, state } = c as Record<string, unknown>;
    if (
      !isCount(ord) ||
      !(count === null || isCount(count)) ||
      (state !== "idle" && state !== "running")
    ) {
      return null;
    }
    out.push({ ord, count, state });
  }
  return out;
};

const parseVars = (v: unknown): Record<string, VarInfo> | null => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    return null;
  }
  const out: Record<string, VarInfo> = {};
  for (const [name, raw] of Object.entries(v).slice(0, MAX_VARS)) {
    if (typeof raw !== "object" || raw === null) {
      continue;
    }
    const r = raw as Record<string, unknown>;
    if (typeof r.kind !== "string") {
      continue;
    }
    const info: VarInfo = { kind: r.kind.slice(0, 60) };
    if (
      Array.isArray(r.shape) &&
      r.shape.length <= 8 &&
      r.shape.every(isCount)
    ) {
      info.shape = r.shape as number[];
    }
    if (Array.isArray(r.columns)) {
      info.columns = r.columns
        .filter((c): c is string => typeof c === "string")
        .slice(0, MAX_COLUMNS)
        .map((c) => c.slice(0, 60));
    }
    if (isCount(r.length)) {
      info.length = r.length;
    }
    out[name.slice(0, 80)] = info;
  }
  return out;
};

/** A reply, or null for anything else (other pages, other protocols, malformed data) */
export const parseReply = (data: unknown): Reply | null => {
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const d = data as Record<string, unknown>;
  if (d.proto !== PROTOCOL || typeof d.type !== "string") {
    return null;
  }
  if (!REPLIES.has(d.type)) {
    return null;
  }
  if (d.type === "ready") {
    return { proto: PROTOCOL, type: "ready" };
  }
  if (d.type === "run") {
    const cells = parseCells(d.cells);
    return cells ? { proto: PROTOCOL, type: "run", cells } : null;
  }
  if (d.type === "vars") {
    const vars = parseVars(d.vars);
    return vars ? { proto: PROTOCOL, type: "vars", vars } : null;
  }
  if (d.type === "kernel") {
    return typeof d.commId === "string"
      ? { proto: PROTOCOL, type: "kernel", commId: d.commId, data: d.data }
      : null;
  }
  if (typeof d.id !== "string") {
    return null;
  }
  if (
    d.type === "notebook" &&
    typeof d.path === "string" &&
    typeof d.text === "string"
  ) {
    return {
      proto: PROTOCOL,
      type: "notebook",
      id: d.id,
      path: d.path,
      text: d.text,
    };
  }
  if (d.type === "inserted" && typeof d.path === "string") {
    return { proto: PROTOCOL, type: "inserted", id: d.id, path: d.path };
  }
  if (d.type === "error" && typeof d.message === "string") {
    return { proto: PROTOCOL, type: "error", id: d.id, message: d.message };
  }
  return null;
};

/** The origin of a URL, or null when it is not an absolute URL */
export const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

const MAX_NODES = 500;

/** A string literal for Python (JSON strings are valid Python strings) */
const py = (s: string) => JSON.stringify(s);

export type Snapshot = {
  nodes: { id: string; label: string; details: string; role: string }[];
  edges: { from: string; to: string; label: string }[];
  /** more boxes than that were on the canvas: how many were left out */
  omitted: number;
};

/**
 * The diagram on the canvas as plain tables: the boxes (ids n1, n2…), and the arrows that connect two of them.
 * `only` limits it to some boxes (the selected ones).
 */
export const snapshotOf = (
  index: CanvasIndex,
  only?: ReadonlySet<string>,
): Snapshot => {
  const all = [...index.nodes.values()].filter((n) => !only || only.has(n.key));
  const nodes = all.slice(0, MAX_NODES);
  const ids = new Map(nodes.map((n, i) => [n.key, `n${i + 1}`]));
  return {
    nodes: nodes.map((n) => ({
      id: ids.get(n.key)!,
      label: n.label,
      details: n.details,
      role: n.role ?? "",
    })),
    edges: index.edges
      .filter((e) => ids.has(e.from) && ids.has(e.to))
      .map((e) => ({
        from: ids.get(e.from)!,
        to: ids.get(e.to)!,
        label: e.label,
      })),
    omitted: all.length - nodes.length,
  };
};

/**
 * The diagram on the canvas as Python for a notebook cell: one table of boxes and one of arrows (pandas), so it can
 * be analysed, joined with data or drawn again with NetworkX. Returns null when there is nothing to send.
 */
export const diagramToPython = (index: CanvasIndex): string | null => {
  const { nodes, edges, omitted } = snapshotOf(index);
  if (!nodes.length) {
    return null;
  }
  const lines = [
    `# Diagram from Trazo: ${nodes.length} boxes, ${edges.length} arrows`,
    "import pandas as pd",
    "",
    "nodes = pd.DataFrame([",
    ...nodes.map(
      (n) =>
        `    {"id": ${py(n.id)}, "label": ${py(n.label)}, "details": ${py(
          n.details,
        )}, "role": ${py(n.role)}},`,
    ),
    "])",
    "edges = pd.DataFrame(",
    "    [",
    ...edges.map(
      (e) =>
        `        {"from": ${py(e.from)}, "to": ${py(e.to)}, "label": ${py(
          e.label,
        )}},`,
    ),
    "    ],",
    '    columns=["from", "to", "label"],',
    ")",
    "nodes, edges",
  ];
  if (omitted) {
    lines.splice(
      1,
      0,
      `# (only the first ${MAX_NODES} boxes of ${MAX_NODES + omitted})`,
    );
  }
  return lines.join("\n");
};
