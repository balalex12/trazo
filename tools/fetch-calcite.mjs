// Downloads the Esri Calcite UI icon glyphs used by the library into assets/calcite/ (git-ignored).
// They are intentionally NOT committed: Calcite is distributed under the Esri Master License Agreement,
// which allows use and redistribution only without modification. Each user fetches them from npm/jsdelivr.
// Usage: node tools/fetch-calcite.mjs        (run from the repository root)
import { mkdirSync, existsSync, writeFileSync } from "node:fs";

const VERSION = "4.6.0-next.21"; // pinned for reproducibility
const BASE = `https://cdn.jsdelivr.net/npm/@esri/calcite-ui-icons@${VERSION}`;

export const GLYPHS = [
  "feature-layer", "layer-map-service", "layer-vector-tile", "utility-network", "utility-network-layer",
  "validate-utility-network-topology", "trace-path", "topology", "layer-line", "link", "geometric-network",
  "group-layers", "nodes-link", "cube", "layer-points", "connection-middle", "connection-end-right", "layer-set",
  "layers", "code", "apps", "switch", "all-servers", "server-lock", "globe", "lock",
];

const out = "assets/calcite";
mkdirSync(out, { recursive: true });
let fetched = 0, failed = 0;
for (const name of GLYPHS) {
  const file = `${out}/${name}.svg`;
  if (existsSync(file)) continue;
  let ok = false;
  for (let attempt = 0; attempt < 4 && !ok; attempt++) {
    try {
      const res = await fetch(`${BASE}/icons/${name}-32.svg`);
      if (res.ok) {
        writeFileSync(file, await res.text());
        ok = true;
        fetched++;
      }
    } catch (e) {
      /* retry */
    }
    if (!ok) await new Promise((r) => setTimeout(r, 800));
  }
  if (!ok) {
    failed++;
    console.warn(`! could not download ${name}`);
  }
}
try {
  const lic = await fetch(`${BASE}/LICENSE.md`);
  if (lic.ok) writeFileSync(`${out}/LICENSE.md`, await lic.text());
} catch (e) {
  /* optional */
}
console.log(`Calcite glyphs: ${fetched} downloaded, ${failed} failed, ${GLYPHS.length} total (assets/calcite/)`);
process.exit(failed ? 1 : 0);
