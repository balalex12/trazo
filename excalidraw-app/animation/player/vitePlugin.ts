// `import runtime from "./player/runtime.ts?bundle"` gives the runtime as one browser script (a string), bundled with
// esbuild. Used in vite.config.mts, so it works the same in `yarn start` and in the production build.
import path from "path";

import { bundlePlayer } from "./bundle";

import type { Plugin } from "vite";

const PREFIX = "\0trazo-bundle:";

export const trazoBundlePlugin = (): Plugin => {
  const cache = new Map<string, Promise<string>>();
  return {
    name: "trazo-bundle",
    enforce: "pre",
    resolveId(id, importer) {
      if (!id.endsWith("?bundle")) {
        return null;
      }
      const file = id.slice(0, -"?bundle".length);
      return `${PREFIX}${
        importer ? path.resolve(path.dirname(importer), file) : file
      }`;
    },
    async load(id) {
      if (!id.startsWith(PREFIX)) {
        return null;
      }
      const file = id.slice(PREFIX.length);
      if (!cache.has(file)) {
        cache.set(file, bundlePlayer(file));
      }
      const code = await cache.get(file)!;
      return `export default ${JSON.stringify(code)};`;
    },
  };
};
