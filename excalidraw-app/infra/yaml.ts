import { load, loadAll } from "js-yaml";

// YAML aliases let a tiny file stand for an enormous structure ("billion laughs"): js-yaml shares the
// nodes, so loading is quick, but the importers then walk every path through them. Count the visits
// (a shared node counts each time it is reached) and refuse the file past a budget that real
// compose, Kubernetes and OpenAPI files stay far below.
const MAX_VISITS = 1_000_000;

const assertBudget = (root: unknown): void => {
  let visits = 0;
  const stack: unknown[] = [root];
  while (stack.length) {
    const v = stack.pop();
    if (++visits > MAX_VISITS) {
      throw new Error(
        "the file expands to far too many values (nested YAML aliases)",
      );
    }
    if (Array.isArray(v)) {
      stack.push(...v);
    } else if (v && typeof v === "object") {
      stack.push(...Object.values(v));
    }
  }
};

export const loadYaml = (text: string): unknown => {
  const doc = load(text);
  assertBudget(doc);
  return doc;
};

export const loadAllYaml = (text: string): unknown[] => {
  const docs = loadAll(text);
  assertBudget(docs);
  return docs;
};
