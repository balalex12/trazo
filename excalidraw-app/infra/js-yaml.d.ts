// js-yaml ships no types and @types/js-yaml is not in the lockfile; we only use `load`.
declare module "js-yaml" {
  export function load(input: string): unknown;
}
