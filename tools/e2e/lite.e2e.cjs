// The notebook panel with the real notebook site: Python in the page, the bridge between notebook and canvas, the live
// diagram, the `trazo` module. Needs the site built (node tools/build-jupyterlite.mjs); skipped otherwise. The site is
// served here under its real Content-Security-Policy, and nothing may leave the machine.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { LITE_PORT, openApp, elements, clickButton, waitFor, sleep, launch } = require("./lib.cjs");
const lite = require("./lite-server.cjs");

const SLOW = { timeout: 600000 };

describe("notebook site", { skip: lite.built() ? false : "the notebook site is not built (node tools/build-jupyterlite.mjs)" }, () => {
  let server;
  before(async () => {
    server = await lite.start(LITE_PORT);
  });
  after(() => new Promise((r) => server.close(r)));

  describe("on its own", () => {
    let s;
    before(async () => {
      s = await launch();
    });
    after(async () => {
      await s.close();
    });

    it("runs Python with pandas and scikit-learn, under its policy, offline", SLOW, async () => {
      const code = encodeURIComponent(
        "import pandas as pd\nfrom sklearn.ensemble import RandomForestClassifier\nprint('pandas', pd.__version__)\nprint('rows', len(pd.DataFrame({'a': [1, 2, 3]})))",
      );
      await s.page.goto(`http://127.0.0.1:${LITE_PORT}/repl/index.html?kernel=python&toolbar=1&code=${code}`, { waitUntil: "load" });
      const text = await waitFor(
        async () => {
          const t = await s.page.evaluate(() => document.body.innerText);
          return /rows 3/.test(t) ? t : null;
        },
        { timeout: 120000, what: "Python output" },
      );
      assert.match(text, /pandas \d/);
      assert.deepEqual(s.seen.external, [], `external requests: ${s.seen.external.join(", ")}`);
      assert.deepEqual(s.seen.csp, []);
    });
  });

  describe("inside the app", () => {
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
    const openNotebook = async (name) => {
      await frame.evaluate((n) => window.jupyterapp.commands.execute("docmanager:open", { path: n }), name);
      await waitFor(
        () => frame.evaluate((n) => window.jupyterapp.shell.currentWidget && window.jupyterapp.shell.currentWidget.context.path === n, name),
        { what: `${name} to open` },
      );
      await waitFor(() => frame.evaluate(() => window.jupyterapp.shell.currentWidget.sessionContext.ready.then(() => true)), { timeout: 90000, what: "the kernel" });
    };
    const clearCanvas = () =>
      s.page.evaluate(() => {
        const els = window.h.app.scene.getElementsIncludingDeleted();
        window.h.app.syncActionResult({ elements: els.map((e) => ({ ...e, isDeleted: true })), captureUpdate: "NEVER" });
      });
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
      frame = await waitFor(() => s.page.frames().find((f) => f.url().includes(`:${LITE_PORT}`)), { what: "the notebook frame" });
      await waitFor(() => frame.evaluate(() => !!(window.jupyterapp && window.jupyterapp.commands)).catch(() => false), { timeout: 90000, what: "JupyterLab" });
    });
    after(async () => {
      await s.close();
    });

    it("tells the app when it is ready, and the buttons wake up", SLOW, async () => {
      await waitFor(
        () => s.page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Diagram this notebook" && !b.disabled)),
        { timeout: 90000, what: "the panel to be ready" },
      );
    });

    it("draws the data flow of the open notebook, each box knowing its cell and variable", SLOW, async () => {
      await openNotebook("churn.ipynb");
      await clickButton(s.page, "Diagram this notebook");
      const els = await waitFor(
        async () => {
          const e = await elements(s.page);
          return e.filter((x) => x.meta).length >= 10 ? e : null;
        },
        { what: "the diagram" },
      );
      const boxes = els.filter((x) => x.meta && x.type !== "text");
      assert.ok(boxes.length >= 10, `${boxes.length} boxes`);
      assert.ok(boxes.some((b) => b.meta.var === "df" && b.meta.cell === 2), "df comes from cell 2");
      assert.ok(boxes.some((b) => b.meta.var === "model"), "the model is there");
    });

    it("lights up the boxes of the cell that runs, shows the size of the tables, and puts the colours back", SLOW, async () => {
      const original = new Map((await elements(s.page)).filter((e) => e.meta && e.type !== "text").map((e) => [e.id, e.strokeColor]));
      await frame.evaluate(() => window.jupyterapp.commands.execute("notebook:run-all-cells"));
      let sawRunning = false;
      const lastCellRan = () =>
        frame.evaluate(() => {
          const m = window.jupyterapp.shell.currentWidget.content.model;
          for (let i = m.cells.length - 1; i >= 0; i--) {
            const c = m.cells.get(i);
            if (c.type === "code") return c.executionCount !== null;
          }
          return false;
        });
      await waitFor(
        async () => {
          const e = await elements(s.page);
          if (e.some((x) => x.meta && x.type !== "text" && x.strokeColor === "#e8590c")) sawRunning = true;
          return (await lastCellRan()) && (await noCellRunning()) && e.filter((x) => x.badge).length >= 2;
        },
        { timeout: 120000, every: 150, what: "the run to finish and the sizes to show" },
      );
      assert.ok(sawRunning, "a box was orange while its cell ran");
      const badges = (await elements(s.page)).filter((e) => e.badge).map((e) => e.text);
      assert.ok(badges.some((t) => t === "200 × 2"), `badges: ${badges}`);
      assert.ok(badges.some((t) => t === "400 × 3"), `badges: ${badges}`);
      // the lit colours are given back
      await waitFor(
        async () => (await elements(s.page)).filter((e) => e.meta && e.type !== "text").every((e) => e.strokeColor === original.get(e.id)),
        { timeout: 15000, what: "the boxes to get their colours back" },
      );
    });

    it("lets Python read the canvas and draw on it with the trazo module", SLOW, async () => {
      await clearCanvas();
      await py("import pandas as pd\nimport trazo");
      await sleep(1500);
      await py("trazo.draw({'title': 'Pipeline', 'nodes': [{'id': 'a', 'label': 'sales.csv'}, {'id': 'b', 'label': 'clean', 'details': ['dropna']}, {'id': 'c', 'label': 'model', 'role': 'function'}], 'edges': [('a', 'b'), ('b', 'c', 'fit')]})");
      const els = await waitFor(
        async () => {
          const e = await elements(s.page);
          return e.filter((x) => x.type === "rectangle").length === 3 ? e : null;
        },
        { what: "the graph drawn from Python" },
      );
      assert.equal(els.filter((x) => x.type === "arrow").length, 2);
      // the canvas copy reaches the kernel between cells
      await waitFor(
        async () => (await py("nodes, edges = trazo.canvas()\nprint(len(nodes), len(edges))")).trim() === "3 2",
        { timeout: 20000, every: 800, what: "trazo.canvas() to see 3 boxes and 2 arrows" },
      );
      // the selection too
      await s.page.evaluate(() => {
        const rects = window.h.app.scene.getElementsIncludingDeleted().filter((e) => !e.isDeleted && e.type === "rectangle");
        window.h.app.setState({ selectedElementIds: { [rects[0].id]: true, [rects[1].id]: true } });
      });
      await waitFor(async () => (await py("n2, e2 = trazo.selected()\nprint(len(n2))")).trim() === "2", { timeout: 20000, every: 800, what: "trazo.selected()" });
      // a bad graph is reported, nothing is drawn
      const before = (await elements(s.page)).length;
      await py("trazo.draw({'nodes': []})").catch(() => {});
      await sleep(500);
      assert.equal((await elements(s.page)).length, before);
    });

    it("adds the canvas to the notebook as a cell, and drafts a notebook from the diagram (nothing is run)", SLOW, async () => {
      const cells = () => frame.evaluate(() => window.jupyterapp.shell.currentWidget.content.model.cells.length);
      const n0 = await cells();
      await clickButton(s.page, "Send diagram to notebook");
      await waitFor(async () => (await cells()) === n0 + 1, { what: "the cell with the diagram" });
      const last = await frame.evaluate(() => {
        const m = window.jupyterapp.shell.currentWidget.content.model;
        const c = m.cells.get(m.cells.length - 1);
        return { source: c.sharedModel.getSource(), count: c.executionCount };
      });
      assert.match(last.source, /# Diagram from Trazo: 3 boxes, 2 arrows/);
      assert.equal(last.count, null, "it was not run");
      await clickButton(s.page, "Draft notebook from diagram");
      await waitFor(async () => (await cells()) === n0 + 1 + 4, { what: "the drafted cells (imports and three boxes)" });
      const drafted = await frame.evaluate(() => {
        const m = window.jupyterapp.shell.currentWidget.content.model;
        const out = [];
        for (let i = m.cells.length - 4; i < m.cells.length; i++) out.push(m.cells.get(i).sharedModel.getSource());
        return out;
      });
      assert.match(drafted[0], /import pandas as pd/);
      assert.match(drafted[1], /sales = pd\.read_csv\("sales\.csv"\)/);
    });

    it("stays on this machine, under both policies", () => {
      assert.deepEqual(s.seen.external, [], `external requests: ${s.seen.external.join(", ")}`);
      assert.deepEqual(s.seen.csp, []);
    });
  });
});
