// Runs the browser tests (tools/e2e/*.e2e.cjs): starts the app if it is not already running, runs node's test runner
// and stops what it started.   yarn test:e2e
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const APP_URL = process.env.E2E_APP_URL || "http://127.0.0.1:3000";

const reachable = async (url) => {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.status < 500;
  } catch {
    return false;
  }
};

let server = null;
const stop = () => {
  if (server) {
    server.kill("SIGTERM");
    server = null;
  }
};
process.on("exit", stop);
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    stop();
    process.exit(130);
  });
}

if (!(await reachable(APP_URL))) {
  const { port } = new URL(APP_URL);
  console.log(`Starting the app on ${APP_URL}…`);
  // BROWSER=none: vite must not try to open a browser (it crashes where xdg-open is missing)
  // vite is started the way `yarn start` does, from the app's folder, so it reads that folder's config
  server = spawn(
    process.execPath,
    [
      path.join(root, "node_modules", "vite", "bin", "vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      port || "3000",
      "--strictPort",
      "--no-open",
    ],
    {
      cwd: path.join(root, "excalidraw-app"),
      env: { ...process.env, BROWSER: "none" },
      stdio: ["ignore", "ignore", "inherit"],
    },
  );
  server.on("exit", (code) => {
    if (server && code) {
      console.error(`The app server stopped (exit ${code}).`);
      process.exit(1);
    }
  });
  const end = Date.now() + 120000;
  while (!(await reachable(APP_URL))) {
    if (Date.now() > end) {
      console.error("The app did not start in 2 minutes.");
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const files = readdirSync(here)
  .filter((f) => f.endsWith(".e2e.cjs"))
  .map((f) => path.join("tools", "e2e", f));
const only = process.argv.slice(2);
const run = spawn(process.execPath, ["--test", "--test-reporter=spec", "--test-concurrency=1", ...(only.length ? only : files)], {
  cwd: root,
  stdio: "inherit",
});
run.on("exit", (code) => {
  stop();
  process.exit(code ?? 1);
});
