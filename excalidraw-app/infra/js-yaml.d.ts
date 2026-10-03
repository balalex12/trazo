// js-yaml ships no types and @types/js-yaml is not in the lockfile; we only use `load` and `loadAll`.
declare module "js-yaml" {
  export function load(input: string): unknown;
  export function loadAll(input: string): unknown[];
}
