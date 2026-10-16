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
  | { proto: typeof PROTOCOL; type: "error"; id: string; message: string };

const REPLIES = new Set(["ready", "notebook", "inserted", "error"]);

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

/** A Python string literal (JSON strings are valid Python strings) */
const py = (s: string) => JSON.stringify(s);

/**
 * The diagram on the canvas as Python for a notebook cell: one table of boxes and one of arrows (pandas), so it can
 * be analysed, joined with data or drawn again with NetworkX. Returns null when there is nothing to send.
 */
export const diagramToPython = (index: CanvasIndex): string | null => {
  const nodes = [...index.nodes.values()].slice(0, MAX_NODES);
  if (!nodes.length) {
    return null;
  }
  const ids = new Map(nodes.map((n, i) => [n.key, `n${i + 1}`]));
  const edges = index.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const lines = [
    `# Diagram from Trazo: ${nodes.length} boxes, ${edges.length} arrows`,
    "import pandas as pd",
    "",
    "nodes = pd.DataFrame([",
    ...nodes.map(
      (n) =>
        `    {"id": ${py(ids.get(n.key)!)}, "label": ${py(
          n.label,
        )}, "details": ${py(n.details)}, "role": ${py(n.role ?? "")}},`,
    ),
    "])",
    "edges = pd.DataFrame(",
    "    [",
    ...edges.map(
      (e) =>
        `        {"from": ${py(ids.get(e.from)!)}, "to": ${py(
          ids.get(e.to)!,
        )}, "label": ${py(e.label)}},`,
    ),
    "    ],",
    '    columns=["from", "to", "label"],',
    ")",
    "nodes, edges",
  ];
  if (index.nodes.size > MAX_NODES) {
    lines.splice(
      1,
      0,
      `# (only the first ${MAX_NODES} boxes of ${index.nodes.size})`,
    );
  }
  return lines.join("\n");
};
