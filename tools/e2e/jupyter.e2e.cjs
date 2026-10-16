// "Notebook > Jupyter server": the panel connected to a REAL Jupyter server through tools/jupyter-proxy.mjs, with its
// real Python kernel (the Python you started, not the one in the browser). Needs a Python that has jupyterlab,
// ipykernel, pandas and scikit-learn; skipped unless E2E_JUPYTER_PYTHON points to one:
//   python3 -m venv /tmp/jup && /tmp/jup/bin/pip install jupyterlab ipykernel pandas scikit-learn matplotlib
//   E2E_JUPYTER_PYTHON=/tmp/jup/bin/python yarn test:e2e tools/e2e/jupyter.e2e.cjs
// CI does not run it (it installs nothing).
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { openApp, elements, clickButton, waitFor, sleep } = require("./lib.cjs");

const PYTHON = process.env.E2E_JUPYTER_PYTHON;
const ROOT = path.resolve(__dirname, "..", "..");
const PROXY_PORT = Number(process.env.E2E_PROXY_PORT || 3003);
const SLOW = { timeout: 600000 };

const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

const get = (port, p, headers = {}) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: p, agent: false, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      })
      .on("error", reject);
  });

describe("your own Jupyter server", { skip: PYTHON ? false : "set E2E_JUPYTER_PYTHON to a Python with jupyterlab, ipykernel, pandas and scikit-learn" }, () => {
  let dir;
  let jupyter;
  let proxy;
  let port;
  const token = crypto.randomBytes(12).toString("hex");

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "trazo-jupyter-"));
    // the starter notebooks, for the Python 3 kernel of this server instead of the browser's
    for (const name of ["churn.ipynb", "welcome.ipynb"]) {
      const nb = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "lite-content", name), "utf8"));
      nb.metadata.kernelspec = { name: "python3", display_name: "Python 3", language: "python" };
      fs.writeFileSync(path.join(dir, name), JSON.stringify(nb));
    }
    port = await freePort();
    const root = typeof process.getuid === "function" && process.getuid() === 0 ? ["--allow-root"] : [];
    jupyter = spawn(
      PYTHON,
      ["-m", "jupyterlab", "--no-browser", ...root, "--ServerApp.ip=127.0.0.1", `--ServerApp.port=${port}`, "--ServerApp.port_retries=0", `--IdentityProvider.token=${token}`, "--LabApp.expose_app_in_browser=True", `--ServerApp.root_dir=${dir}`],
      {
        cwd: dir,
        // the module of tools/lite-python is importable in the kernels, and Jupyter keeps its files in the temp folder
        env: { ...process.env, PYTHONPATH: path.join(ROOT, "tools", "lite-python"), JUPYTER_CONFIG_DIR: path.join(dir, ".cfg"), JUPYTER_DATA_DIR: path.join(dir, ".data"), JUPYTER_RUNTIME_DIR: path.join(dir, ".run") },
        stdio: "ignore",
      },
    );
    await waitFor(async () => (await get(port, `/api/status?token=${token}`).catch(() => ({ status: 0 }))).status === 200, { timeout: 90000, what: "Jupyter to start" });
    const { createProxy, parseOptions } = await import(pathToFileURL(path.join(ROOT, "tools", "jupyter-proxy.mjs")));
    proxy = createProxy(parseOptions(["--target", `http://127.0.0.1:${port}`, "--port", String(PROXY_PORT)]));
    await new Promise((resolve, reject) => {
      proxy.once("error", reject);
      proxy.listen(PROXY_PORT, "127.0.0.1", resolve);
    });
  });
  after(async () => {
    if (proxy) {
      proxy.closeAllConnections();
      await new Promise((r) => proxy.close(r));
    }
    if (jupyter) jupyter.kill("SIGTERM");
    await sleep(500);
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("through the proxy: the page gets the bridge and may be embedded by Trazo, the API works, other names are refused", SLOW, async () => {
    const page = await get(PROXY_PORT, `/lab?token=${token}`);
    assert.equal(page.status, 200);
    assert.match(page.body, /\/trazo-bridge\.js/);
    assert.match(page.headers["content-security-policy"], /frame-ancestors 'self' http:\/\/localhost:3000 http:\/\/127\.0\.0\.1:3000/);
    assert.equal(page.headers["x-frame-options"], undefined);
    assert.equal((await get(PROXY_PORT, "/trazo-bridge.js")).status, 200);
    assert.equal((await get(PROXY_PORT, `/api/status?token=${token}`)).status, 200);
    // Jupyter's own login still applies: without the token the API says no
    assert.ok([401, 403].includes((await get(PROXY_PORT, "/api/contents")).status));
    assert.equal((await get(PROXY_PORT, "/lab", { host: "evil.example.com" })).status, 421);
  });

  describe("in the app", () => {
    let s;
    let frame;
    const py = (code) =>
      frame.evaluate(async (code) => {
        const kernel = window.jupyterapp.shell.currentWidget.sessionContext.session.kernel;
        let out = "";
        const future = kernel.requestExecute({ code, store_history: false });
        future.onIOPub = (m) => {
          if (m.header.msg_type === "stream") out += m.content.text;
          if (m.header.msg_type === "error") out += `ERR ${m.content.evalue}`;
        };
        await future.done;
        return out;
      }, code);
    const noCellRunning = () =>
      frame.evaluate(() => {
        const w = window.jupyterapp.shell.currentWidget;
        for (let i = 0; i < w.content.model.cells.length; i++) {
          const c = w.content.model.cells.get(i);
          if (c.type === "code" && c.executionState === "running") return false;
        }
        return true;
      });

    before(async () => {
      s = await openApp({ width: 1700 });
      await s.page.evaluate(() => window.dispatchEvent(new Event("brand:open-notebook")));
      await waitFor(() => s.page.$('select[title^="Where the Python runs"]'), { what: "the environment selector" });
    });
    after(async () => {
      await s.close();
    });

    it("connects from the selector, with a warning that it runs real code, and wakes the buttons up", SLOW, async () => {
      await s.page.select('select[title^="Where the Python runs"]', "server");
      const text = await waitFor(
        async () => {
          const t = await s.page.evaluate(() => document.body.innerText);
          return /no sandbox/.test(t) ? t : null;
        },
        { what: "the warning" },
      );
      assert.match(text, /runs real code on the machine of that Jupyter, with no sandbox/);
      // a wrong address is explained
      await s.page.$eval('input[placeholder^="http://127.0.0.1:3003"]', (i) => (i.value = ""));
      await s.page.type('input[placeholder^="http://127.0.0.1:3003"]', "http://jupyter.example.com/lab");
      await clickButton(s.page, "Connect");
      await waitFor(async () => /only for this machine/.test(await s.page.evaluate(() => document.body.innerText)), { what: "the refusal of plain http elsewhere" });
      // the right one, with the token of this Jupyter
      await s.page.$eval('input[placeholder^="http://127.0.0.1:3003"]', (i) => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        set.call(i, "");
        i.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await s.page.type('input[placeholder^="http://127.0.0.1:3003"]', `http://127.0.0.1:${PROXY_PORT}/lab?token=${token}`);
      await clickButton(s.page, "Connect");
      frame = await waitFor(() => s.page.frames().find((f) => f.url().includes(`:${PROXY_PORT}`)), { what: "the Jupyter frame" });
      await waitFor(() => frame.evaluate(() => !!(window.jupyterapp && window.jupyterapp.commands && window.jupyterapp.commands.hasCommand("docmanager:open"))).catch(() => false), { timeout: 90000, what: "JupyterLab" });
      await waitFor(() => s.page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Diagram this notebook" && !b.disabled)), { timeout: 90000, what: "the panel to be ready" });
    });

    it("remembers the address but never the token", SLOW, async () => {
      const stored = await s.page.evaluate(() => localStorage.getItem("trazo-notebook-env"));
      assert.deepEqual(JSON.parse(stored), { kind: "server", url: `http://127.0.0.1:${PROXY_PORT}/lab` });
      assert.ok(!stored.includes(token));
    });

    it("draws the data flow of a notebook of the real Python, and lights it up while the real kernel runs", SLOW, async () => {
      await frame.evaluate(() => window.jupyterapp.commands.execute("docmanager:open", { path: "churn.ipynb" }));
      await waitFor(() => frame.evaluate(() => window.jupyterapp.shell.currentWidget && window.jupyterapp.shell.currentWidget.context.path === "churn.ipynb"), { what: "churn.ipynb" });
      await waitFor(() => frame.evaluate(() => window.jupyterapp.shell.currentWidget.sessionContext.session && window.jupyterapp.shell.currentWidget.sessionContext.session.kernel && window.jupyterapp.shell.currentWidget.sessionContext.session.kernel.status), { timeout: 90000, what: "the kernel" });
      await clickButton(s.page, "Diagram this notebook");
      await waitFor(async () => (await elements(s.page)).filter((x) => x.meta).length >= 10, { what: "the diagram" });
      await frame.evaluate(() => window.jupyterapp.commands.execute("notebook:run-all-cells"));
      let sawRunning = false;
      await waitFor(
        async () => {
          const e = await elements(s.page);
          if (e.some((x) => x.meta && x.type !== "text" && x.strokeColor === "#e8590c")) sawRunning = true;
          return sawRunning && (await noCellRunning()) && e.filter((x) => x.badge).length >= 2;
        },
        { timeout: 180000, every: 150, what: "boxes to light up and the sizes to show" },
      );
      const badges = (await elements(s.page)).filter((e) => e.badge).map((e) => e.text);
      assert.ok(badges.includes("200 × 2") && badges.includes("400 × 3"), `badges: ${badges}`);
    });

    it("lets the real Python use the trazo module: draw, and read the canvas back", SLOW, async () => {
      await s.page.evaluate(() => {
        const els = window.h.app.scene.getElementsIncludingDeleted();
        window.h.app.syncActionResult({ elements: els.map((e) => ({ ...e, isDeleted: true })), captureUpdate: "NEVER" });
      });
      assert.match(await py("import pandas as pd\nimport trazo\nprint(trazo.__version__)"), /\d+\.\d+\.\d+/);
      await sleep(1000);
      await py("trazo.draw({'nodes': [{'id': 'a', 'label': 'raw'}, {'id': 'b', 'label': 'clean'}], 'edges': [('a', 'b')]})");
      await waitFor(async () => (await elements(s.page)).filter((x) => x.type === "rectangle").length === 2, { what: "the graph" });
      await waitFor(async () => (await py("nodes, edges = trazo.canvas()\nprint(len(nodes), len(edges))")).trim() === "2 1", { timeout: 20000, every: 800, what: "trazo.canvas()" });
      // and a map, with the real GeoPandas-free path (GeoJSON): the module needs nothing the Python does not have
      await py("trazo.map({'type': 'Polygon', 'coordinates': [[[0, 0], [4, 0], [4, 3], [0, 3], [0, 0]]]}, title='Square')");
      await waitFor(async () => (await elements(s.page)).some((x) => x.type === "frame" && x.name === "Square"), { what: "the map" });
    });

    it("goes back to Python in the browser from the same selector", SLOW, async () => {
      await s.page.select('select[title^="Where the Python runs"]', "browser");
      const src = await waitFor(() => s.page.$eval('iframe[title="Python notebook"]', (f) => f.src).catch(() => null), { what: "the iframe" });
      assert.match(src, /:3002\/lab\/index\.html$/);
      assert.deepEqual(JSON.parse(await s.page.evaluate(() => localStorage.getItem("trazo-notebook-env"))), { kind: "browser" });
    });

    it("stays on this machine", () => {
      assert.deepEqual(s.seen.external, [], `external requests: ${s.seen.external.join(", ")}`);
    });
  });
});
