// OpenAPI / Swagger (YAML or JSON) to a graph: clients, the API, one box per tag with its endpoints, the schemas those
// endpoints use (and the schemas those refer to), and the security schemes. Pure and deterministic, no AI.
import { load } from "js-yaml";

import { MAX_NODES, clip } from "./graph";

import type { Graph, GraphEdge, GraphNode } from "./graph";

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
];
const MAX_TAGS = 40;
const MAX_SCHEMAS = 40;
const LINES_PER_TAG = 6;
const PROPS_PER_SCHEMA = 5;

/** names of the schemas a piece of the document points to with $ref (OpenAPI 3 and Swagger 2) */
const refsIn = (node: unknown, out = new Set<string>(), depth = 0) => {
  if (depth > 40 || node === null || typeof node !== "object") {
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => refsIn(n, out, depth + 1));
    return out;
  }
  for (const [k, v] of Object.entries(node as Dict)) {
    if (k === "$ref" && typeof v === "string") {
      const m = /^#\/(?:components\/schemas|definitions)\/(.+)$/.exec(v);
      if (m) {
        out.add(decodeURIComponent(m[1]));
      }
    } else {
      refsIn(v, out, depth + 1);
    }
  }
  return out;
};

const tagOf = (path: string, op: Dict): string => {
  const t = Array.isArray(op.tags) ? op.tags.find((x) => x) : undefined;
  if (typeof t === "string") {
    return t;
  }
  const seg = path.split("/").find((s) => s && !s.startsWith("{"));
  return seg || "default";
};

const slug = (s: string) => s.replace(/[^\w.-]+/g, "_");

export const parseOpenApi = (text: string): Graph => {
  let doc: unknown;
  try {
    doc = load(text);
  } catch (e) {
    throw new Error(`That is not valid YAML or JSON: ${(e as Error).message}`);
  }
  if (!isDict(doc) || !(doc.openapi || doc.swagger) || !isDict(doc.paths)) {
    throw new Error(
      "That does not look like an OpenAPI or Swagger file (it needs `openapi` or `swagger` and `paths`).",
    );
  }
  const paths = doc.paths;
  const info = isDict(doc.info) ? doc.info : {};
  const comps = isDict(doc.components) ? doc.components : {};
  const allSchemas: Dict = isDict(comps.schemas)
    ? comps.schemas
    : isDict(doc.definitions)
    ? doc.definitions
    : {};

  // endpoints grouped by tag
  type Endpoint = { line: string; schemas: Set<string> };
  const tags = new Map<string, Endpoint[]>();
  let endpointCount = 0;
  for (const [path, item] of Object.entries(paths)) {
    if (!isDict(item)) {
      continue;
    }
    for (const method of METHODS) {
      const op = item[method];
      if (!isDict(op)) {
        continue;
      }
      endpointCount++;
      const tag = tagOf(path, op);
      // parameters declared on the path itself apply to every method
      const used = refsIn([op, item.parameters]);
      const list = tags.get(tag) || [];
      list.push({ line: `${method.toUpperCase()} ${path}`, schemas: used });
      tags.set(tag, list);
    }
  }
  if (!endpointCount) {
    throw new Error("That OpenAPI file has no endpoints under `paths`.");
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const link = (
    from: string,
    to: string,
    kind: GraphEdge["kind"],
    label?: string,
  ) => {
    const id = `${kind === "ingress" ? "in" : "dep"}:${from}>${to}`;
    if (!seen.has(id) && from !== to) {
      seen.add(id);
      edges.push({ id, from, to, kind, ...(label ? { label } : {}) });
    }
  };

  const title = typeof info.title === "string" ? info.title : "API";
  const version = info.version !== undefined ? ` v${info.version}` : "";
  const server = (() => {
    const s = Array.isArray(doc.servers) ? doc.servers[0] : undefined;
    if (isDict(s) && typeof s.url === "string") {
      return s.url;
    }
    if (typeof doc.host === "string") {
      return `${doc.host}${
        typeof doc.basePath === "string" ? doc.basePath : ""
      }`;
    }
    return "";
  })();

  nodes.push({ id: "clients", lines: ["👥 Clients"], external: true });
  nodes.push({
    id: "api",
    role: "proxy",
    lines: [
      `🌐 ${clip(title, 26)}`,
      clip(`${doc.openapi ? "OpenAPI" : "Swagger"}${version}`, 30),
      clip(`${endpointCount} endpoint${endpointCount === 1 ? "" : "s"}`, 30),
      ...(server ? [clip(server, 34)] : []),
    ],
  });
  link("clients", "api", "ingress");

  // security schemes become one box the API depends on
  const schemes = isDict(comps.securitySchemes)
    ? comps.securitySchemes
    : isDict(doc.securityDefinitions)
    ? doc.securityDefinitions
    : {};
  const schemeNames = Object.entries(schemes).map(([name, s]) => {
    const type = isDict(s) && typeof s.type === "string" ? s.type : "";
    return type ? `${name} (${type})` : name;
  });
  if (schemeNames.length) {
    nodes.push({
      id: "security",
      role: "auth",
      lines: [
        "🔐 Security",
        ...schemeNames.slice(0, 3).map((s) => clip(s, 30)),
        ...(schemeNames.length > 3 ? [`+${schemeNames.length - 3} more`] : []),
      ],
    });
    link("api", "security", "depends");
  }

  // one box per tag (the busiest first when there are too many)
  const sortedTags = [...tags.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );
  const shownTags = sortedTags.slice(0, MAX_TAGS);
  const notes: string[] = [];
  if (sortedTags.length > shownTags.length) {
    const hidden = sortedTags.slice(MAX_TAGS);
    notes.push(
      `Not drawn: ${hidden.length} more tags (${hidden.reduce(
        (n, [, l]) => n + l.length,
        0,
      )} endpoints)`,
    );
  }
  const wantedSchemas = new Set<string>();
  const tagSchemas = new Map<string, Set<string>>();
  for (const [tag, list] of shownTags) {
    const id = `tag:${slug(tag)}`;
    nodes.push({
      id,
      role: "app",
      lines: [
        `⚙️ ${clip(tag, 24)}`,
        ...list.slice(0, LINES_PER_TAG).map((e) => clip(e.line, 34)),
        ...(list.length > LINES_PER_TAG
          ? [`+${list.length - LINES_PER_TAG} more`]
          : []),
      ],
    });
    link("api", id, "depends");
    const used = new Set(list.flatMap((e) => [...e.schemas]));
    tagSchemas.set(id, used);
    used.forEach((s) => wantedSchemas.add(s));
  }

  // the schemas used, and the schemas they use in turn
  const queue = [...wantedSchemas];
  while (queue.length) {
    const name = queue.shift()!;
    for (const dep of refsIn(allSchemas[name])) {
      if (!wantedSchemas.has(dep)) {
        wantedSchemas.add(dep);
        queue.push(dep);
      }
    }
  }
  const schemaNames = [...wantedSchemas].filter((n) => n in allSchemas);
  const shownSchemas = schemaNames.slice(0, MAX_SCHEMAS);
  const shown = new Set(shownSchemas);
  if (schemaNames.length > shownSchemas.length) {
    notes.push(
      `Not drawn: ${schemaNames.length - shownSchemas.length} more schemas`,
    );
  }
  for (const name of shownSchemas) {
    const s = allSchemas[name];
    const props =
      isDict(s) && isDict(s.properties) ? Object.keys(s.properties) : [];
    nodes.push({
      id: `schema:${slug(name)}`,
      role: "schema",
      lines: [
        `📐 ${clip(name, 24)}`,
        ...props.slice(0, PROPS_PER_SCHEMA).map((p) => clip(p, 30)),
        ...(props.length > PROPS_PER_SCHEMA
          ? [`+${props.length - PROPS_PER_SCHEMA} more`]
          : []),
      ],
    });
  }
  for (const [tagId, used] of tagSchemas) {
    for (const s of used) {
      if (shown.has(s)) {
        link(tagId, `schema:${slug(s)}`, "depends");
      }
    }
  }
  for (const name of shownSchemas) {
    for (const dep of refsIn(allSchemas[name])) {
      if (shown.has(dep)) {
        link(`schema:${slug(name)}`, `schema:${slug(dep)}`, "depends");
      }
    }
  }

  if (nodes.length > MAX_NODES) {
    throw new Error(
      `That is a lot to draw (${nodes.length} boxes). Split the API file, for example one tag.`,
    );
  }
  return { nodes, edges, ...(notes.length ? { notes } : {}) };
};
