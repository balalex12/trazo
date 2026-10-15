// Bundles the player runtime (runtime.ts) into one browser script. Used by the Vite plugin in vite.config.mts, so the
// app can embed the player in every exported .html file without a separate build step, in dev and in production.
//
// The runtime pulls in Excalidraw's SVG renderer. Its font subsetting code (two WebAssembly blobs, about 1.7 MB) and
// the CJK font files are not needed there: the fonts a slide uses are inlined by the app when it exports, and the
// player renders with `skipInliningFonts`, so those modules are replaced by empty stand-ins.
import { build } from "esbuild";

import type { Plugin } from "esbuild";

const EMPTY_EXPORTS = [
  "default",
  "XiaolaiFontFaces",
  "woff2Wasm",
  "harfbuzzWasm",
  "Woff2Binding",
  "HarfBuzzBinding",
].map((name) =>
  name === "default" ? "export default {};" : `export const ${name} = {};`,
);

const stubHeavyFontModules: Plugin = {
  name: "stub-heavy-font-modules",
  setup(b) {
    b.onResolve(
      {
        filter:
          /woff2-wasm|harfbuzz-wasm|woff2-bindings|harfbuzz-bindings|\/Xiaolai(\/index)?$|\.woff2$/,
      },
      (args) => ({ path: args.path, namespace: "stub" }),
    );
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: EMPTY_EXPORTS.join("\n"),
      loader: "js",
    }));
  },
};

export const bundlePlayer = async (
  entry: string,
  { minify = true }: { minify?: boolean } = {},
): Promise<string> => {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    minify,
    format: "iife",
    platform: "browser",
    target: "es2020",
    logLevel: "error",
    plugins: [stubHeavyFontModules],
    loader: {
      ".scss": "empty",
      ".css": "empty",
      ".svg": "dataurl",
      ".png": "dataurl",
    },
    define: {
      "import.meta.env": "{}",
      "import.meta.env.MODE": '"production"',
      "process.env.NODE_ENV": '"production"',
    },
  });
  return result.outputFiles[0].text;
};
