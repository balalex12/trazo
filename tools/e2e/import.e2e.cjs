// "Import to diagram": every format draws a diagram from its example, one Ctrl+Z removes it, and bad input says so.
const { describe, it, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { openApp, elements, clickButton, openInfraDialog, waitFor, sleep } = require("./lib.cjs");

const FORMATS = {
  compose: "Docker Compose",
  kubernetes: "Kubernetes",
  terraform: "Terraform",
  openapi: "OpenAPI",
  sql: "SQL schema",
  sqlquery: "SQL query",
  dbt: "dbt lineage",
  n8n: "n8n workflow",
  notebook: "Jupyter notebook",
  json: "JSON data",
};

describe("import to diagram", () => {
  let s;
  before(async () => {
    s = await openApp();
  });
  after(async () => {
    await s.close();
  });
  beforeEach(async () => {
    // an empty canvas and no dialog
    await s.page.evaluate(() => {
      const els = window.h.app.scene.getElementsIncludingDeleted();
      window.h.app.syncActionResult({ elements: els.map((e) => ({ ...e, isDeleted: true })), captureUpdate: "NEVER" });
    });
    await s.page.keyboard.press("Escape");
    await sleep(200);
  });

  for (const [value, name] of Object.entries(FORMATS)) {
    it(`draws the ${name} example, recognised on its own, and Ctrl+Z removes it`, async () => {
      await openInfraDialog(s.page);
      await s.page.select("select", value);
      const filled = await waitFor(() => s.page.$eval("textarea", (t) => t.value.length > 20), { what: "the example text" });
      assert.ok(filled);
      await clickButton(s.page, "Generate diagram");
      const drawn = await waitFor(
        async () => {
          const els = await elements(s.page);
          return els.length > 3 ? els : null;
        },
        { what: `the ${name} diagram` },
      );
      assert.ok(drawn.some((e) => e.type === "arrow"), "it has arrows");
      assert.ok(drawn.some((e) => e.type === "rectangle" || e.type === "ellipse"), "it has boxes");
      // the dialog closed
      assert.equal(await s.page.$("textarea"), null);
      await s.page.keyboard.down("Control");
      await s.page.keyboard.press("z");
      await s.page.keyboard.up("Control");
      await waitFor(async () => (await elements(s.page)).length === 0, { what: "undo to empty the canvas" });
    });
  }

  it("says what it cannot read and draws nothing", async () => {
    await openInfraDialog(s.page);
    await s.page.type("textarea", "this is not any format that can be drawn");
    await clickButton(s.page, "Generate diagram");
    const text = await waitFor(
      async () => {
        const t = await s.page.evaluate(() => document.body.innerText);
        return /could not recognise/i.test(t) ? t : null;
      },
      { what: "the error message" },
    );
    assert.match(text, /Supported:/);
    assert.equal((await elements(s.page)).length, 0);
  });

  it("refuses a notebook of another language", async () => {
    await openInfraDialog(s.page);
    const nb = JSON.stringify({
      nbformat: 4,
      metadata: { kernelspec: { language: "julia", name: "julia-1.9" } },
      cells: [{ cell_type: "code", source: "x = 1" }],
    });
    await s.page.$eval(
      "textarea",
      (t, v) => {
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
        set.call(t, v);
        t.dispatchEvent(new Event("input", { bubbles: true }));
      },
      nb,
    );
    await clickButton(s.page, "Generate diagram");
    await waitFor(async () => /Python/.test(await s.page.evaluate(() => document.body.innerText)) && (await s.page.$("textarea")), {
      what: "the error",
    });
    assert.equal((await elements(s.page)).length, 0);
  });
});
