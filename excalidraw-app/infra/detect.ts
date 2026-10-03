// What was pasted? docker-compose, Kubernetes manifests or Terraform files, decided from the text itself, and the one
// entry point the dialog uses: text in, laid out diagram out.
import { loadAll } from "js-yaml";

import { composeToGraph, parseCompose } from "./compose";
import { layoutGraph } from "./graph";
import { parseKubernetes } from "./kubernetes";
import { parseTerraform } from "./terraform";

import type { Layout } from "./graph";

export type InfraFormat = "compose" | "kubernetes" | "terraform";

export const FORMAT_NAMES: Record<InfraFormat, string> = {
  compose: "Docker Compose",
  kubernetes: "Kubernetes",
  terraform: "Terraform",
};

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const HCL_BLOCK =
  /^[ \t]*(resource|data|module|provider|terraform|variable|output|locals)\b[^\n{]*\{/m;

export const detectFormat = (
  text: string,
): InfraFormat | "terraform-json" | null => {
  const t = text.trim();
  if (!t) {
    return null;
  }
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const j: unknown = JSON.parse(t);
      if (
        isDict(j) &&
        ("format_version" in j ||
          "planned_values" in j ||
          "terraform_version" in j)
      ) {
        return "terraform-json";
      }
    } catch (e) {
      /* not JSON: keep looking */
    }
  }
  const looksKubernetes = /^\s*apiVersion\s*:/m.test(text);
  const looksCompose = /^\s*services\s*:/m.test(text);
  if (HCL_BLOCK.test(text) && !looksKubernetes && !looksCompose) {
    return "terraform";
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
    throw new Error(
      "Paste a docker-compose.yml, Kubernetes manifests or Terraform (.tf) files first.",
    );
  }
  const format = detectFormat(text);
  if (format === "terraform-json") {
    throw new Error(
      "That is Terraform JSON (a plan or a state). Paste the .tf files instead; JSON support is planned.",
    );
  }
  if (!format) {
    throw new Error(
      "I could not recognise that. Supported: docker-compose.yml, Kubernetes manifests (YAML) and Terraform (.tf) files.",
    );
  }
  const graph =
    format === "compose"
      ? composeToGraph(parseCompose(text))
      : format === "kubernetes"
      ? parseKubernetes(text)
      : parseTerraform(text, options);
  return { format, layout: layoutGraph(graph) };
};
