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
const lib = await fetch("http://127.0.0.1:3000/arcgis.excalidrawlib");
const text = await lib.text();
if (lib.status !== 200 || /calcite/i.test(text))
  fail(
    "the library is missing or carries Calcite glyphs (a published build must use --profile=public)",
  );
child.kill();
console.log(
  "OK: the desktop app serves Trazo with its security headers and the public library.",
);
process.exit(0);
