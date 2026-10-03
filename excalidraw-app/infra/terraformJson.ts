// Terraform JSON: the output of `terraform show -json` for a plan (terraform show -json tfplan) or a state. Same boxes
// and colors as the .tf reader. Arrows come from what Terraform itself recorded: a plan lists the references of every
// expression, a state lists `depends_on`. A state written by recent Terraform often carries few of them, so a plan
// gives the richer picture. Pure and deterministic.
import { entriesToGraph } from "./terraform";

import type { Graph } from "./graph";
import type { TerraformOptions, TfEntry } from "./terraform";

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** "aws_db_instance.main[0].address" -> "aws_db_instance.main"; "module.vpc.vpc_id" -> "module.vpc" */
export const refAddress = (ref: string, modulePrefix = ""): string | null => {
  const clean = ref.replace(/\[[^\]]*\]/g, "");
  const parts = clean.split(".");
  if (parts[0] === "var" || parts[0] === "local" || parts[0] === "each") {
    return null;
  }
  if (parts[0] === "module") {
    return parts.length >= 2 ? `${modulePrefix}module.${parts[1]}` : null;
  }
  if (parts[0] === "data") {
    return parts.length >= 3
      ? `${modulePrefix}data.${parts[1]}.${parts[2]}`
      : null;
  }
  return parts.length >= 2 ? `${modulePrefix}${parts[0]}.${parts[1]}` : null;
};

const stripIndex = (address: string) => address.replace(/\[[^\]]*\]/g, "");

/** every `references` list found anywhere inside an expressions object */
const collectRefs = (
  node: unknown,
  out: string[] = [],
  depth = 0,
): string[] => {
  if (depth > 30 || node === null || typeof node !== "object") {
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => collectRefs(n, out, depth + 1));
    return out;
  }
  for (const [k, v] of Object.entries(node as Dict)) {
    if (k === "references" && Array.isArray(v)) {
      out.push(...v.filter((x): x is string => typeof x === "string"));
    } else {
      collectRefs(v, out, depth + 1);
    }
  }
  return out;
};

type Found = { address: string; mode: string; type: string; name: string };

/** resources of a state/plan "values" tree, walking child modules */
const walkValues = (mod: unknown, out: Found[] = []): Found[] => {
  if (!isDict(mod)) {
    return out;
  }
  for (const r of asList(mod.resources)) {
    if (isDict(r)) {
      out.push({
        address: stripIndex(str(r.address)),
        mode: str(r.mode) || "managed",
        type: str(r.type),
        name: str(r.name),
      });
    }
  }
  for (const c of asList(mod.child_modules)) {
    walkValues(c, out);
  }
  return out;
};

/** what each address refers to, from a plan's configuration (and from `depends_on` in a state) */
const walkConfig = (
  mod: unknown,
  prefix: string,
  out: Map<string, Set<string>>,
) => {
  if (!isDict(mod)) {
    return;
  }
  for (const r of asList(mod.resources)) {
    if (!isDict(r)) {
      continue;
    }
    const address = `${prefix}${stripIndex(str(r.address))}`;
    const set = out.get(address) || new Set<string>();
    for (const ref of collectRefs(r.expressions)) {
      const a = refAddress(ref, prefix);
      if (a) {
        set.add(a);
      }
    }
    for (const d of asList(r.depends_on)) {
      const a = typeof d === "string" ? refAddress(d, prefix) : null;
      if (a) {
        set.add(a);
      }
    }
    out.set(address, set);
  }
  if (isDict(mod.module_calls)) {
    for (const [name, call] of Object.entries(mod.module_calls)) {
      const inner = isDict(call) ? call.module : undefined;
      walkConfig(inner, `${prefix}module.${name}.`, out);
    }
  }
};

export const parseTerraformJson = (
  text: string,
  options: TerraformOptions = {},
): Graph => {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("That is not valid JSON.");
  }
  if (!isDict(doc)) {
    throw new Error("That does not look like Terraform JSON.");
  }
  const values = isDict(doc.values)
    ? doc.values
    : isDict(doc.planned_values)
    ? doc.planned_values
    : undefined;
  const found = walkValues(isDict(values) ? values.root_module : undefined);
  // a plan's resource_changes also lists resources that are only being created or destroyed
  for (const rc of asList(doc.resource_changes)) {
    if (
      isDict(rc) &&
      !found.some((f) => f.address === stripIndex(str(rc.address)))
    ) {
      found.push({
        address: stripIndex(str(rc.address)),
        mode: str(rc.mode) || "managed",
        type: str(rc.type),
        name: str(rc.name),
      });
    }
  }
  const unique = new Map<string, Found>();
  found.forEach((f) => f.address && f.type && unique.set(f.address, f));
  if (!unique.size) {
    throw new Error(
      "No resources found in that Terraform JSON. Use the output of `terraform show -json` (a plan or a state).",
    );
  }

  const refs = new Map<string, Set<string>>();
  walkConfig(
    isDict(doc.configuration) ? doc.configuration.root_module : undefined,
    "",
    refs,
  );
  // a state keeps its recorded dependencies in the resources of "values"
  const stateDeps = (mod: unknown) => {
    if (!isDict(mod)) {
      return;
    }
    for (const r of asList(mod.resources)) {
      if (isDict(r) && Array.isArray(r.depends_on)) {
        const address = stripIndex(str(r.address));
        const set = refs.get(address) || new Set<string>();
        for (const d of r.depends_on) {
          const a = typeof d === "string" ? refAddress(d) : null;
          if (a) {
            set.add(a);
          }
        }
        refs.set(address, set);
      }
    }
    asList(mod.child_modules).forEach(stateDeps);
  };
  stateDeps(isDict(values) ? values.root_module : undefined);

  const entries: TfEntry[] = [...unique.values()].map((f) => ({
    kind: f.mode === "data" ? "data" : "resource",
    address: f.address,
    type: f.type,
    name: f.name,
    refersTo: (address) => refs.get(f.address)?.has(address) ?? false,
  }));
  return entriesToGraph(entries, options);
};
