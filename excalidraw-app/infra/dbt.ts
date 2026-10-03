// dbt manifest.json (target/manifest.json) to a lineage graph: sources, seeds, snapshots, models and exposures, with an
// arrow from every parent to the nodes built on it, so data flows left to right. Models are colored by layer from
// their name (stg_, int_, fct_/dim_...). Pure and deterministic.
import { MAX_NODES, clip } from "./graph";

import type { Graph, GraphEdge, GraphNode, Role } from "./graph";

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export const dbtLayer = (name: string): Role => {
  if (/^(stg|base|src)_|(^|_)staging(_|$)/.test(name)) {
    return "app";
  }
  if (/^int_|(^|_)intermediate(_|$)/.test(name)) {
    return "function";
  }
  if (
    /^(fct|fact|dim|mart|rpt|report|agg)_|(^|_)(marts?|reporting)(_|$)/.test(
      name,
    )
  ) {
    return "database";
  }
  return "app";
};

const SHOWN = new Set(["model", "seed", "snapshot", "source", "exposure"]);

export const parseDbt = (text: string): Graph => {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("That is not valid JSON.");
  }
  if (!isDict(doc) || !isDict(doc.nodes)) {
    throw new Error("That does not look like a dbt manifest.json.");
  }
  const meta = isDict(doc.metadata) ? doc.metadata : {};
  const nodesIn: Dict = doc.nodes;
  const sourcesIn: Dict = isDict(doc.sources) ? doc.sources : {};
  const exposuresIn: Dict = isDict(doc.exposures) ? doc.exposures : {};

  // the project is the package most nodes belong to when the manifest does not say
  const project =
    str(meta.project_name) ||
    (() => {
      const count = new Map<string, number>();
      for (const n of Object.values(nodesIn)) {
        const p = isDict(n) ? str(n.package_name) : "";
        count.set(p, (count.get(p) || 0) + 1);
      }
      return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    })();

  type Entry = { id: string; type: string; raw: Dict };
  const all: Entry[] = [
    ...Object.entries(nodesIn).map(([id, raw]) => ({
      id,
      type: isDict(raw) ? str(raw.resource_type) : "",
      raw: isDict(raw) ? raw : {},
    })),
    ...Object.entries(sourcesIn).map(([id, raw]) => ({
      id,
      type: "source",
      raw: isDict(raw) ? raw : {},
    })),
    ...Object.entries(exposuresIn).map(([id, raw]) => ({
      id,
      type: "exposure",
      raw: isDict(raw) ? raw : {},
    })),
  ];

  let packageNodes = 0;
  const kept = all.filter((e) => {
    if (!SHOWN.has(e.type)) {
      return false;
    }
    const pkg = str(e.raw.package_name);
    if (e.type !== "source" && project && pkg && pkg !== project) {
      packageNodes++;
      return false;
    }
    return true;
  });
  if (!kept.length) {
    throw new Error(
      "That manifest has no models, seeds, snapshots or sources to draw.",
    );
  }
  if (kept.length > MAX_NODES) {
    throw new Error(
      `That is a lot to draw (${kept.length} boxes). Run dbt on a subset (for example --select) and paste that manifest.`,
    );
  }

  const ids = new Set(kept.map((e) => e.id));
  const nodes: GraphNode[] = kept.map((e) => {
    const name =
      e.type === "source"
        ? `${str(e.raw.source_name)}.${str(e.raw.name)}`
        : str(e.raw.name) || e.id.split(".").pop() || e.id;
    const config = isDict(e.raw.config) ? e.raw.config : {};
    const mat = str(config.materialized);
    const role: Role =
      e.type === "source"
        ? "storage"
        : e.type === "seed"
        ? "cache"
        : e.type === "snapshot"
        ? "monitoring"
        : e.type === "exposure"
        ? "proxy"
        : dbtLayer(name);
    const detail = e.type === "model" && mat ? `model · ${mat}` : e.type;
    const schema = str(e.raw.schema);
    return {
      id: `dbt:${e.id}`,
      role,
      lines: [
        `${
          e.type === "exposure"
            ? "📈"
            : e.type === "source"
            ? "💾"
            : e.type === "seed"
            ? "🌱"
            : e.type === "snapshot"
            ? "📸"
            : "🧮"
        } ${clip(name, 26)}`,
        clip(detail, 30),
        ...(schema && e.type !== "exposure" ? [clip(schema, 30)] : []),
      ],
    };
  });

  const parentsOf = (e: Entry): string[] => {
    const deps = isDict(e.raw.depends_on) ? asList(e.raw.depends_on.nodes) : [];
    if (deps.length) {
      return deps.map(str);
    }
    const pm = isDict(doc.parent_map) ? asList(doc.parent_map[e.id]) : [];
    return pm.map(str);
  };

  // data flows from the parent to the node built on it, so sources end up on the left
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const e of kept) {
    for (const p of parentsOf(e)) {
      if (!ids.has(p) || p === e.id) {
        continue;
      }
      const id = `lin:${p}>${e.id}`;
      if (!seen.has(id)) {
        seen.add(id);
        edges.push({
          id,
          from: `dbt:${p}`,
          to: `dbt:${e.id}`,
          kind: "depends",
        });
      }
    }
  }

  const notes: string[] = [];
  if (packageNodes) {
    notes.push(
      `Left out ${packageNodes} node${
        packageNodes > 1 ? "s" : ""
      } from installed packages`,
    );
  }
  return { nodes, edges, flow: true, ...(notes.length ? { notes } : {}) };
};
