// Build-time helper: computes the sha256 of every inline <script> in the built index.html and writes an
// nginx include with a strict Content-Security-Policy that allows exactly those scripts (no 'unsafe-inline').
// Usage: node scripts/csp-hashes.mjs <index.html> <out.inc>
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const [, , htmlPath, outPath] = process.argv;
const html = readFileSync(htmlPath, "utf8");
const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((m) => m[1])
  .filter((body) => body.trim().length)
  .map((body) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`);

const policy = [
  "default-src 'self'",
  `script-src 'self' 'wasm-unsafe-eval' ${hashes.join(" ")}`.trim(),
  "style-src 'self' 'unsafe-inline'", // React inline styles
  "img-src 'self' data: blob: https:", // pasted images, embeds thumbnails
  "font-src 'self' data:",
  // 'self' + local LLM servers (Ollama 11434, LM Studio 1234, ...). Remote LLM hosts: add them in nginx conf.
  "connect-src 'self' data: blob: http://localhost:* http://127.0.0.1:*",
  // the ArcGIS viewer (port 3001) and https embeds (ArcGIS apps, video, ...); embeds are sandboxed by the app
  "frame-src 'self' http://localhost:3001 http://127.0.0.1:3001 https:",
  "worker-src 'self' blob:",
  "media-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

writeFileSync(outPath, `add_header Content-Security-Policy "${policy}" always;\n`);
console.log(`CSP written to ${outPath} with ${hashes.length} inline script hash(es)`);
