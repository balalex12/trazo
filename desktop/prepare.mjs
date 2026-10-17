// Gets the desktop app ready to be packed: copies the built site, the map viewer, the notebooks and the icon into desktop/ and writes the
// Content-Security-Policy for it. Run it from anywhere after building the app:
//
//   node tools/build-library.js --profile=public      # the library of what is published (no Calcite glyphs)
//   yarn build:app:docker                             # the site, the way the Docker image builds it
//   node desktop/prepare.mjs                          # copies it into desktop/site
//   cd desktop && npm ci && npm run dist              # the installers, in desktop/dist
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const built = path.join(root, "excalidraw-app", "build");
const site = path.join(here, "site");

if (!existsSync(path.join(built, "index.html"))) {
  console.error(
    "excalidraw-app/build is missing: run `yarn build:app:docker` first.",
  );
  process.exit(1);
}
rmSync(site, { recursive: true, force: true });
cpSync(built, site, { recursive: true });
// the same policy the Docker image uses: it allows exactly the inline scripts of this index.html
execFileSync(
  process.execPath,
  [
    path.join(root, "scripts", "csp-hashes.mjs"),
    path.join(site, "index.html"),
    path.join(site, "_csp.inc"),
  ],
  { stdio: "inherit" },
);
// the ArcGIS map viewer (what the app embeds for live maps), with the policy of its server configuration
const viewer = path.join(here, "viewer");
rmSync(viewer, { recursive: true, force: true });
cpSync(path.join(root, "viewer"), viewer, { recursive: true });
cpSync(
  path.join(root, "deploy", "nginx", "viewer.conf"),
  path.join(viewer, "_csp.conf"),
);

// the Python notebooks (JupyterLite and Pyodide, built by tools/build-jupyterlite.mjs): part of the product, so a
// release stops here when they are missing; a development build may go without them
const lite = path.join(here, "jupyterlite");
rmSync(lite, { recursive: true, force: true });
const builtLite = path.join(root, "assets", "jupyterlite");
if (existsSync(path.join(builtLite, "_csp.conf"))) {
  cpSync(builtLite, lite, { recursive: true });
} else if (process.env.TRAZO_REQUIRE_NOTEBOOKS) {
  console.error(
    "assets/jupyterlite is missing: run `node tools/build-jupyterlite.mjs` first.",
  );
  process.exit(1);
} else {
  mkdirSync(lite, { recursive: true }); // electron-builder wants the folder; without the notebooks it stays empty
  console.warn(
    "Notebooks not included (assets/jupyterlite is missing; node tools/build-jupyterlite.mjs builds it).",
  );
}

// electron-builder makes the .ico and the .icns from one 512 px png
mkdirSync(path.join(here, "build"), { recursive: true });
cpSync(
  path.join(root, "public", "android-chrome-512x512.png"),
  path.join(here, "build", "icon.png"),
);
console.log("Desktop app ready: cd desktop && npm ci && npm run dist");
