// Builds a JupyterLite site (Python notebooks that run in the browser) into assets/jupyterlite/ (git-ignored).
// Local-first: Pyodide and the Python packages are downloaded ONCE here, at build time, and served from your own
// machine. Once built, the notebook site makes no network request.
//
//   node tools/build-jupyterlite.mjs              (run from the repository root; needs python3, tar with bzip2, node 18+)
//   docker compose --profile lite up -d           (then http://127.0.0.1:3002)
//
// What it does: downloads the official Pyodide distribution (pinned, checked against a SHA-256), keeps the core plus a
// short list of data-science packages (and what they depend on), builds JupyterLite from pinned pip packages in a
// throwaway virtualenv and copies the starter notebooks from tools/lite-content/.
import { createHash } from "node:crypto";
import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";

// Pyodide must be the version the JupyterLite kernel was built for (see the kernel's bundled pyodide.mjs URL).
export const PYODIDE_VERSION = "314.0.6";
export const PYODIDE_SHA256 =
  "fd25b21567f83f83b0b8bb1780a5458c6d4dd10bb07a22004424194022037f00";
const PYODIDE_URL = `https://github.com/pyodide/pyodide/releases/download/${PYODIDE_VERSION}/pyodide-${PYODIDE_VERSION}.tar.bz2`;
export const PIP_PINS = [
  "jupyterlite-core==0.8.6",
  "jupyterlite-pyodide-kernel==0.8.6",
  "jupyter-server==2.21.1", // only needed to add the starter notebooks at build time
];

/** pure-Python wheels the kernel needs that Pyodide itself does not include (pinned) */
export const KERNEL_WHEELS = ["comm==0.2.3"];

/** What a notebook can import without installing anything (plus whatever those depend on). */
export const PACKAGES = [
  "micropip",
  "ipython",
  "traitlets",
  "pyodide-http",
  "numpy",
  "pandas",
  "scipy",
  "matplotlib",
  "scikit-learn",
  "statsmodels",
  "networkx",
  "sympy",
  "pillow",
  "lxml",
  "beautifulsoup4",
  "pyyaml",
  "pydantic",
  "tqdm",
  "joblib",
  "xarray",
  "pyarrow",
  "sqlalchemy",
  "duckdb",
  "shapely",
  "pyproj",
  "fiona",
  "geopandas",
  "rasterio",
  "h5py",
  "netcdf4",
];

const OUT = "assets/jupyterlite";
const WORK = "assets/jupyterlite-work";

/** names to keep: the wanted packages and, recursively, what they depend on */
export const closure = (lockPackages, wanted) => {
  // dependency names are not always spelled like the keys (prompt_toolkit / prompt-toolkit)
  const norm = (n) => n.toLowerCase().replace(/[-_.]+/g, "-");
  const keys = new Map(Object.keys(lockPackages).map((k) => [norm(k), k]));
  const keep = new Set();
  const todo = [...wanted];
  while (todo.length) {
    const name = keys.get(norm(todo.pop()));
    if (!name || keep.has(name)) continue;
    keep.add(name);
    todo.push(...(lockPackages[name].depends || []));
  }
  return keep;
};

/** SHA-256 hashes (CSP form) of the inline scripts of an HTML page; JSON data blocks are not executed and need none */
export const inlineScriptHashes = (html) => {
  const hashes = [];
  for (const m of html.matchAll(
    /<script(?![^>]*\bsrc=)([^>]*)>([^]*?)<\/script>/g,
  )) {
    if (/type=["']application\/json["']/.test(m[1])) continue;
    hashes.push(
      `'sha256-${createHash("sha256").update(m[2]).digest("base64")}'`,
    );
  }
  return hashes;
};

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
  );

/**
 * The Content-Security-Policy for the site, with the hash of each inline script (JupyterLite's pages have a few).
 * No other origin is allowed anywhere, and connect-src 'self' means a notebook cannot reach the network either.
 * 'wasm-unsafe-eval' is what WebAssembly needs; 'unsafe-eval' is what JupyterLab's own code loader needs.
 */
export const buildCsp = (hashes) =>
  [
    "default-src 'self'",
    `script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval' blob: ${[
      ...new Set(hashes),
    ].join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' data: blob:",
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // the Trazo app may embed it; change this if you move the app (deploy/nginx/lite.conf explains)
    "frame-ancestors 'self' http://localhost:3000 http://127.0.0.1:3000",
  ].join("; ");

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})`);
  }
};

const sha256 = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

const download = async (url, file) => {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
};

const main = async () => {
  mkdirSync(WORK, { recursive: true });

  // 1. the Pyodide distribution, checked against the pinned hash
  const tarball = path.join(WORK, `pyodide-${PYODIDE_VERSION}.tar.bz2`);
  if (!existsSync(tarball) || sha256(tarball) !== PYODIDE_SHA256) {
    console.log(`Downloading Pyodide ${PYODIDE_VERSION} (about 350 MB)…`);
    await download(PYODIDE_URL, tarball);
  }
  if (sha256(tarball) !== PYODIDE_SHA256) {
    throw new Error("The Pyodide download does not match its pinned SHA-256.");
  }

  // 2. keep the core and the chosen packages
  const full = path.join(WORK, "pyodide-full");
  rmSync(full, { recursive: true, force: true });
  mkdirSync(full, { recursive: true });
  run("tar", ["-xjf", tarball, "-C", full]);
  const dist = path.join(full, "pyodide");
  const lockFile = path.join(dist, "pyodide-lock.json");
  const lock = JSON.parse(readFileSync(lockFile, "utf8"));
  // every pure-Python package too (about 35 MB): small, and it keeps the kernel and micropip from going to PyPI
  const pure = Object.entries(lock.packages)
    .filter(([n, p]) => /none-any\.whl$/.test(p.file_name) && !/^test/.test(n))
    .map(([n]) => n);
  const keep = closure(lock.packages, [...PACKAGES, ...pure]);
  const missing = PACKAGES.filter((p) => !lock.packages[p]); // keys are already normalised for these
  if (missing.length)
    console.warn(`Not in this Pyodide: ${missing.join(", ")}`);
  const keepFiles = new Set([...keep].map((n) => lock.packages[n].file_name));
  const packageFiles = new Set(
    Object.values(lock.packages).map((p) => p.file_name),
  );
  const slim = path.join(WORK, "lite", "static", "pyodide");
  rmSync(path.join(WORK, "lite"), { recursive: true, force: true });
  mkdirSync(slim, { recursive: true });
  for (const f of readdirSync(dist)) {
    const p = path.join(dist, f);
    const base = f.replace(/\.metadata$/, "");
    // the core (pyodide.*, python_stdlib.zip…) stays; of the packages only the chosen ones; test bundles never
    if (
      statSync(p).isDirectory() ||
      /-tests\.zip$|^test[-_]|^python(\.bat|\.exe)?$/.test(f) ||
      (packageFiles.has(base) && !keepFiles.has(base))
    ) {
      continue;
    }
    cpSync(p, path.join(slim, f));
  }
  lock.packages = Object.fromEntries(
    Object.entries(lock.packages).filter(([n]) => keep.has(n)),
  );
  writeFileSync(path.join(slim, "pyodide-lock.json"), JSON.stringify(lock));
  console.log(`Kept ${keep.size} packages.`);

  // 3. JupyterLite, from pinned pip packages in a throwaway virtualenv
  const venv = path.join(WORK, "venv");
  if (!existsSync(venv)) run("python3", ["-m", "venv", venv]);
  const bin = path.join(venv, process.platform === "win32" ? "Scripts" : "bin");
  run(path.join(bin, "pip"), ["install", "--quiet", ...PIP_PINS]);
  const content = path.join(WORK, "lite", "files");
  mkdirSync(content, { recursive: true });
  cpSync("tools/lite-content", content, { recursive: true });
  // `comm` is the one thing the kernel needs that Pyodide does not ship: bundle its wheel instead of letting the kernel
  // ask PyPI for it at run time
  const wheels = path.join(WORK, "lite", "pypi");
  mkdirSync(wheels, { recursive: true });
  run(path.join(bin, "pip"), [
    "download",
    "--quiet",
    "--no-deps",
    "--dest",
    wheels,
    ...KERNEL_WHEELS,
  ]);
  rmSync(OUT, { recursive: true, force: true });
  run(path.join(bin, "jupyter"), [
    "lite",
    "build",
    "--lite-dir",
    path.join(WORK, "lite"),
    "--output-dir",
    OUT,
  ]);
  // the kernel must load Pyodide from this site, never from the CDN it defaults to (patched after the build, which
  // rewrites these settings itself when it indexes the bundled wheels)
  const cfgFile = path.join(OUT, "jupyter-lite.json");
  const cfg = JSON.parse(readFileSync(cfgFile, "utf8"));
  const plugins = (cfg["jupyter-config-data"].litePluginSettings ||= {});
  const kernel = (plugins["@jupyterlite/pyodide-kernel-extension:kernel"] ||=
    {});
  kernel.pyodideUrl = "./static/pyodide/pyodide.mjs";
  writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
  // nginx reads the policy from here (deploy/nginx/lite.conf includes it)
  const hashes = walk(OUT)
    .filter((f) => f.endsWith(".html"))
    .flatMap((f) => inlineScriptHashes(readFileSync(f, "utf8")));
  writeFileSync(
    path.join(OUT, "_csp.conf"),
    `add_header Content-Security-Policy "${buildCsp(hashes)}" always;\n`,
  );
  console.log(
    `\nDone: ${OUT}. Start it with: docker compose --profile lite up -d  (http://127.0.0.1:3002)`,
  );
};

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
