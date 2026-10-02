// Downloads the community libraries listed in libraries/community.json from the official catalog repository
// (excalidraw/excalidraw-libraries, MIT) into assets/community/ (git-ignored). They are NOT redistributed in this repo:
// each user fetches them at build time. Usage (repo root): node tools/fetch-community-libraries.mjs
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync("libraries/community.json", "utf8"));
mkdirSync("assets/community", { recursive: true });

let ok = 0, failed = 0;
for (const lib of manifest.libraries) {
  const file = `assets/community/${lib.slug}.excalidrawlib`;
  if (existsSync(file)) { ok++; continue; }
  let done = false;
  for (let attempt = 0; attempt < 5 && !done; attempt++) {
    try {
      const res = await fetch(manifest.rawBase + lib.source);
      if (res.ok) {
        const text = await res.text();
        const json = JSON.parse(text); // validate
        const n = (json.libraryItems || json.library || []).length;
        if (n !== lib.items) console.warn(`~ ${lib.name}: ${n} items now (manifest says ${lib.items}); the upstream library changed`);
        writeFileSync(file, text);
        done = true;
        ok++;
      } else if (res.status === 404) break;
    } catch (e) { /* retry */ }
    if (!done) await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
  }
  if (!done) { failed++; console.warn(`! could not download ${lib.name} (${lib.source})`); }
}
console.log(`Community libraries: ${ok}/${manifest.libraries.length} available in assets/community/${failed ? `, ${failed} failed` : ""}`);
process.exit(failed ? 1 : 0);
