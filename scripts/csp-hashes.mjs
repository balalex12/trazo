// Build-time helper: computes the sha256 of every inline <script> in the built index.html and writes an
// nginx include with a strict Content-Security-Policy that allows exactly those scripts (no 'unsafe-inline').
// Usage: node scripts/csp-hashes.mjs <index.html> <out.inc>
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [, , htmlPath, outPath] = process.argv;
const html = readFileSync(htmlPath, "utf8");
const hashes = [
  ...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi),
]
  .map((m) => m[1])
  .filter((body) => body.trim().length)
  .map(
    (body) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`,
  );

// The ArcGIS viewer normally lives at the same host, port 3001 (always allowed below). A
// deployment that moves it to a different port or host over plain http (a reverse proxy, a
// non-default port) needs that origin in frame-src too: set VITE_APP_ARCGIS_VIEWER_ORIGIN to the
// same value used for the app build (see packages/element/src/embeddable.ts) and rebuild. An
// https:// override needs nothing extra here: frame-src already allows https: for ArcGIS app
// embeds (Experience Builder, Dashboards, ...), so any https viewer origin is already covered.
const viewerOriginOverride = process.env.VITE_APP_ARCGIS_VIEWER_ORIGIN?.replace(
  /\/$/,
  "",
);
const extraFrameSrc =
  viewerOriginOverride && viewerOriginOverride.startsWith("http://")
    ? ` ${viewerOriginOverride}`
    : "";

// The notebook panel (JupyterLite, docs/NOTEBOOKS.md) is embedded from the same host, port 3002 (always allowed
// below); VITE_APP_JUPYTERLITE_ORIGIN moves it, like the viewer above (an https origin is covered by `https:`).
const liteOriginOverride = process.env.VITE_APP_JUPYTERLITE_ORIGIN?.replace(
  /\/$/,
  "",
);
const extraLiteFrameSrc =
  liteOriginOverride && liteOriginOverride.startsWith("http://")
    ? ` ${liteOriginOverride}`
    : "";

const policy = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' ${hashes.join(" ")}`.trim(),
  "style-src 'self' 'unsafe-inline'", // React inline styles
  "img-src 'self' data: blob: https:", // pasted images, embeds thumbnails
  "font-src 'self' data:",
  // 'self' + local LLM servers (Ollama 11434, LM Studio 1234, ...). Remote LLM hosts: add them in nginx conf.
  "connect-src 'self' data: blob: http://localhost:* http://127.0.0.1:*",
  // the ArcGIS viewer (port 3001, or VITE_APP_ARCGIS_VIEWER_ORIGIN if set), the notebook panel (port 3002), the proxy of the user's own Jupyter (port 3003, tools/jupyter-proxy.mjs) and https embeds
  // (ArcGIS apps, video, ...); embeds are sandboxed by the app
  `frame-src 'self' http://localhost:3001 http://127.0.0.1:3001${extraFrameSrc} http://localhost:3002 http://127.0.0.1:3002${extraLiteFrameSrc} http://localhost:3003 http://127.0.0.1:3003 https:`,
  "worker-src 'self' blob:",
  "media-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

writeFileSync(
  outPath,
  `add_header Content-Security-Policy "${policy}" always;\n`,
);
console.log(
  `CSP written to ${outPath} with ${hashes.length} inline script hash(es)`,
);
