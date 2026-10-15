// Any JSON document to a diagram of its shape: every object is a box listing its simple fields, every nested object or
// list is a box of its own linked from the one that holds it. A list of similar objects is drawn once, as its first item
// with a count, so a 10,000-row export is as readable as a 3-row one. For JSON that has no importer of its own (API
// responses, configs, exports, GeoJSON, package.json...). Deterministic and offline.
import { MAX_NODES, clip } from "./graph";

import type { Graph, GraphEdge, GraphNode } from "./graph";

/** simple fields shown inside one box; the rest is counted */
const MAX_FIELDS = 9;
/** nested boxes drawn under one object or list */
const MAX_CHILDREN = 10;
/** different shapes shown for one list of objects */
const MAX_SHAPES = 3;
const MAX_DEPTH = 9;

type Json = unknown;
const isObj = (v: Json): v is Record<string, Json> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isScalar = (v: Json) => v === null || typeof v !== "object";

const show = (v: Json): string =>
  typeof v === "string" ? `"${clip(v.replace(/\s+/g, " "), 26)}"` : String(v);

/** a short inline form for a list of simple values: [1, 2, 3] (12 items) */
const inlineList = (a: Json[]): string => {
  const shown = a.slice(0, 4).map(show).join(", ");
  return `[${clip(shown, 34)}${a.length > 4 ? ", …" : ""}] (${a.length})`;
};

const typeName = (v: Json): string =>
  Array.isArray(v)
    ? "list"
    : isObj(v)
    ? "object"
    : v === null
    ? "null"
    : typeof v;

export const parseJson = (text: string): Graph => {
  let root: Json;
  try {
    root = JSON.parse(text);
  } catch (e) {
    throw new Error(`That is not valid JSON: ${(e as Error).message}`);
  }
  if (isScalar(root)) {
    throw new Error(
      "That JSON is a single value, there is no structure to draw. Paste an object or a list.",
    );
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  let hidden = 0;
  let seq = 0;

  const addNode = (role: GraphNode["role"], lines: string[]): string => {
    const id = `j${++seq}`;
    nodes.push({ id, role, lines });
    return id;
  };
  const addEdge = (from: string, to: string, label?: string) => {
    edges.push({
      id: `e${edges.length}`,
      from,
      to,
      kind: "depends",
      ...(label ? { label } : {}),
    });
  };
  const room = () => nodes.length < MAX_NODES;

  /** the box for one value, and the boxes below it; returns the box id */
  const walk = (
    value: Json,
    title: string,
    depth: number,
    isRoot: boolean,
  ): string => {
    if (Array.isArray(value)) {
      const id = addNode(isRoot ? "app" : "queue", [
        `📚 ${clip(title, 30)}`,
        `list · ${value.length} item${value.length === 1 ? "" : "s"}`,
      ]);
      if (!value.length) {
        return id;
      }
      if (value.every(isScalar)) {
        nodes.find((n) => n.id === id)!.lines.push(inlineList(value));
        return id;
      }
      // group the items by their shape: the same keys mean the same kind of item
      const groups = new Map<string, { sample: Json; count: number }>();
      for (const item of value) {
        const key = isObj(item)
          ? `{${Object.keys(item).sort().join(",")}}`
          : Array.isArray(item)
          ? "[]"
          : `scalar:${typeName(item)}`;
        const g = groups.get(key);
        if (g) {
          g.count++;
        } else {
          groups.set(key, { sample: item, count: 1 });
        }
      }
      let drawn = 0;
      for (const g of groups.values()) {
        if (drawn >= MAX_SHAPES || depth >= MAX_DEPTH || !room()) {
          hidden++;
          continue;
        }
        drawn++;
        if (isScalar(g.sample)) {
          continue; // mixed in with objects: not worth a box
        }
        const child = walk(g.sample, "item", depth + 1, false);
        addEdge(id, child, value.length > 1 ? `×${g.count}` : undefined);
      }
      return id;
    }

    const obj = value as Record<string, Json>;
    const entries = Object.entries(obj);
    const lines: string[] = [`📐 ${clip(title, 30)}`];
    const nested: [string, Json][] = [];
    let simple = 0;
    for (const [k, v] of entries) {
      const emptyBox =
        (Array.isArray(v) && v.length === 0) ||
        (isObj(v) && !Object.keys(v).length);
      if (isScalar(v) || emptyBox) {
        if (simple < MAX_FIELDS) {
          lines.push(
            `${clip(k, 22)}: ${
              emptyBox ? (Array.isArray(v) ? "[]" : "{}") : show(v)
            }`,
          );
        }
        simple++;
      } else if (Array.isArray(v) && v.every(isScalar)) {
        if (simple < MAX_FIELDS) {
          lines.push(`${clip(k, 22)}: ${inlineList(v)}`);
        }
        simple++;
      } else {
        nested.push([k, v]);
      }
    }
    if (simple > MAX_FIELDS) {
      lines.push(
        `… +${simple - MAX_FIELDS} more field${
          simple - MAX_FIELDS > 1 ? "s" : ""
        }`,
      );
    }
    const id = addNode(isRoot ? "app" : "schema", lines);
    for (const [i, [k, v]] of nested.entries()) {
      if (i >= MAX_CHILDREN || depth >= MAX_DEPTH || !room()) {
        hidden += nested.length - i;
        break;
      }
      addEdge(id, walk(v, k, depth + 1, false));
    }
    return id;
  };

  walk(root, "root", 0, true);

  const notes: string[] = [];
  if (hidden) {
    notes.push(
      `${hidden} nested part${
        hidden > 1 ? "s" : ""
      } left out to keep it readable (very deep, wide or many shapes)`,
    );
  }
  return { nodes, edges, ...(notes.length ? { notes } : {}) };
};
