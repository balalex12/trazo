// A smoke test of a built desktop app, for CI (no dependency): it starts the app, waits for its local server and checks
// that the site answers with its security headers and that the page is Trazo's.
//
//   node desktop/smoke.mjs <path to the app's executable>      (on Linux inside xvfb-run, with --no-sandbox as in CI)
import { spawn } from "node:child_process";

const exe = process.argv[2];
if (!exe) {
  console.error("Usage: node desktop/smoke.mjs <path to the executable>");
  process.exit(2);
}
const extra = process.env.SMOKE_ARGS ? process.env.SMOKE_ARGS.split(" ") : [];
const child = spawn(exe, extra, { stdio: "ignore" });
let exited = false;
child.on("exit", () => {
  exited = true;
});

const fail = (message) => {
  console.error(`FAIL: ${message}`);
  child.kill();
  process.exit(1);
};

const deadline = Date.now() + 90_000;
let res = null;
while (Date.now() < deadline && !exited) {
  try {
    res = await fetch("http://127.0.0.1:3000/", {
      signal: AbortSignal.timeout(2000),
    });
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 500));
  }
}
if (!res)
  fail(
    exited
      ? "the app exited before serving anything"
      : "the app did not serve anything in 90 s",
  );
const html = await res.text();
const csp = res.headers.get("content-security-policy") || "";
if (res.status !== 200) fail(`status ${res.status}`);
if (!/Trazo/.test(html)) fail("the page is not Trazo's");
if (
  !csp.includes("default-src 'self'") ||
  !csp.includes("frame-ancestors 'none'")
)
  fail("the Content-Security-Policy is missing or weak");
if (res.headers.get("x-content-type-options") !== "nosniff")
  fail("nosniff is missing");
// the whole product is in the installer: the full library, the map viewer (3001) and the Python notebooks (3002)
const lib = await fetch("http://127.0.0.1:3000/arcgis.excalidrawlib");
const text = await lib.text();
if (
  lib.status !== 200 ||
  !/Esri Architecture Center/.test(text) ||
  !/Esri Calcite icons/.test(text)
)
  fail(
    "the library is missing, or it lacks the Esri icons or the Calcite glyphs",
  );
for (const [name, url, expected] of [
  ["the map viewer", "http://127.0.0.1:3001/", /<title>/i],
  ["the notebooks", "http://127.0.0.1:3002/lab/index.html", /jupyter/i],
]) {
  let r = null;
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(5000) });
  } catch {
    /* handled below */
  }
  if (!r || r.status !== 200) fail(`${name} does not answer on ${url}`);
  const body = await r.text();
  if (!expected.test(body))
    fail(`${name} answers with something else at ${url}`);
  if (!(r.headers.get("content-security-policy") || "").includes("default-src"))
    fail(`${name} has no Content-Security-Policy`);
}
child.kill();
console.log(
  "OK: the desktop app serves Trazo, the map viewer and the notebooks with their security headers, and the full library.",
);
process.exit(0);
