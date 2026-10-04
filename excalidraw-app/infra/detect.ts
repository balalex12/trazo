// What was pasted? docker-compose, Kubernetes, Terraform (HCL or JSON), OpenAPI, SQL, a dbt manifest or an n8n
// workflow, decided from the text itself, and the one entry point the dialog uses: text in, laid out diagram out.
import { loadAll } from "js-yaml";

import { composeToGraph, parseCompose } from "./compose";
import { layoutGraph } from "./graph";
import { parseDbt } from "./dbt";
import { parseKubernetes } from "./kubernetes";
import { parseN8n } from "./n8n";
import { parseOpenApi } from "./openapi";
import { parseSql } from "./sql";
import { parseTerraform } from "./terraform";
import { parseTerraformJson } from "./terraformJson";

import type { Layout } from "./graph";

export type InfraFormat =
  | "compose"
  | "kubernetes"
  | "terraform"
  | "openapi"
  | "sql"
  | "dbt"
  | "n8n";

export const FORMAT_NAMES: Record<InfraFormat, string> = {
  compose: "Docker Compose",
  kubernetes: "Kubernetes",
  terraform: "Terraform",
  openapi: "OpenAPI",
  sql: "SQL schema",
  dbt: "dbt lineage",
  n8n: "n8n workflow",
};

/**
 * The most text an importer reads (about 2 MB). Real files are far smaller; the limit keeps a huge or hostile paste
 * (or an AI client sending one through the MCP server) from tying the browser or the container up.
 */
export const MAX_INPUT_CHARS = 2_000_000;

export const SUPPORTED =
  "docker-compose.yml, Kubernetes manifests, Terraform (.tf or JSON), OpenAPI, SQL (CREATE TABLE), a dbt manifest.json or an n8n workflow";

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const HCL_BLOCK =
  /^[ \t]*(resource|data|module|provider|terraform|variable|output|locals)\b[^\n{]*\{/m;
const SQL_TABLE =
  /\bcreate\s+(?:or\s+replace\s+)?(?:(?:global\s+|local\s+)?(?:temp|temporary)\s+|unlogged\s+)?table\b/i;

type JsonKind = "terraform" | "openapi" | "dbt" | "n8n";

/** which JSON document this is, or null when it is JSON of another kind (compose and Kubernetes JSON are YAML too) */
const detectJson = (t: string): JsonKind | null => {
  let j: unknown;
  try {
    j = JSON.parse(t);
  } catch {
    return null;
  }
  const doc = Array.isArray(j) && isDict(j[0]) ? j[0] : j;
  if (!isDict(doc)) {
    return null;
  }
  if (
    "planned_values" in doc ||
    "terraform_version" in doc ||
    ("format_version" in doc && ("values" in doc || "configuration" in doc))
  ) {
    return "terraform";
  }
  if (("openapi" in doc || "swagger" in doc) && isDict(doc.paths)) {
    return "openapi";
  }
  if (
    isDict(doc.nodes) &&
    isDict(doc.metadata) &&
    ("dbt_schema_version" in doc.metadata ||
      "child_map" in doc ||
      "parent_map" in doc)
  ) {
    return "dbt";
  }
  if (Array.isArray(doc.nodes) && isDict(doc.connections)) {
    return "n8n";
  }
  return null;
};

export const detectFormat = (text: string): InfraFormat | null => {
  const t = text.trim();
  if (!t) {
    return null;
  }
  if (t.startsWith("{") || t.startsWith("[")) {
    const kind = detectJson(t);
    if (kind) {
      return kind;
    }
  }
  if (/^\s*(openapi|swagger)\s*:/m.test(text) && /^\s*paths\s*:/m.test(text)) {
    return "openapi";
  }
  const looksKubernetes = /^\s*apiVersion\s*:/m.test(text);
  const looksCompose = /^\s*services\s*:/m.test(text);
  if (HCL_BLOCK.test(text) && !looksKubernetes && !looksCompose) {
    return "terraform";
  }
  if (SQL_TABLE.test(text) && !looksKubernetes && !looksCompose) {
    return "sql";
  }
  if (looksKubernetes && /\{\{/.test(text)) {
    return "kubernetes"; // a Helm template: the Kubernetes reader explains what to do
  }
  try {
    const docs = loadAll(text);
    if (
      docs.some(
        (d) =>
          isDict(d) &&
          typeof d.kind === "string" &&
          ("apiVersion" in d || d.kind.endsWith("List")),
      )
    ) {
      return "kubernetes";
    }
    if (docs.some((d) => isDict(d) && isDict(d.services))) {
      return "compose";
    }
  } catch (e) {
    /* not YAML */
  }
  return null;
};

export type ImportOptions = {
  /** Terraform: also draw network and IAM resources */
  details?: boolean;
};

export type Imported = {
  format: InfraFormat;
  layout: Layout;
};

export const importInfra = (
  text: string,
  options: ImportOptions = {},
): Imported => {
  if (!text.trim()) {
    throw new Error(`Paste something to draw: ${SUPPORTED}.`);
  }
  if (text.length > MAX_INPUT_CHARS) {
    throw new Error(
      `That is too big to draw (over ${
        MAX_INPUT_CHARS / 1_000_000
      } MB of text). Paste a part of it.`,
    );
  }
  const format = detectFormat(text);
  if (!format) {
    throw new Error(`I could not recognise that. Supported: ${SUPPORTED}.`);
  }
  const t = text.trim();
  const graph =
    format === "compose"
      ? composeToGraph(parseCompose(text))
      : format === "kubernetes"
      ? parseKubernetes(text)
      : format === "terraform"
      ? t.startsWith("{") || t.startsWith("[")
        ? parseTerraformJson(text, options)
        : parseTerraform(text, options)
      : format === "openapi"
      ? parseOpenApi(text)
      : format === "sql"
      ? parseSql(text)
      : format === "dbt"
      ? parseDbt(text)
      : parseN8n(text);
  return { format, layout: layoutGraph(graph) };
};
