// The app as a whole: it starts, it stays on this machine, and the credits and licenses are still there.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { openApp, waitFor, sleep } = require("./lib.cjs");

describe("app", () => {
  let s;
  before(async () => {
    s = await openApp();
  });
  after(async () => {
    await s.close();
  });

  it("starts with the editor on screen", async () => {
    assert.ok(await s.page.$(".excalidraw"), "the editor is mounted");
    assert.match(await s.page.title(), /Trazo/i);
  });

  it("makes no request that leaves this machine (local-first), also when its dialogs open", async () => {
    await s.page.click(".main-menu-trigger");
    await sleep(500);
    await s.page.keyboard.press("Escape");
    for (const event of ["brand:open-infra-import", "brand:open-about", "brand:open-agent", "brand:open-mcp"]) {
      await s.page.evaluate((e) => window.dispatchEvent(new Event(e)), event);
      await sleep(400);
    }
    await sleep(1500);
    assert.deepEqual(s.seen.external, [], `external requests: ${s.seen.external.join(", ")}`);
  });

  it("has no page errors and no Content-Security-Policy violations", () => {
    assert.deepEqual(s.seen.errors, []);
    assert.deepEqual(s.seen.csp, []);
  });

  it("offers its own entries in the main menu", async () => {
    // the dialogs above may still be open
    await s.page.keyboard.press("Escape");
    await sleep(300);
    await s.page.reload({ waitUntil: "load" });
    await waitFor(() => s.page.$(".main-menu-trigger"), { what: "the menu button" });
    await s.page.click(".main-menu-trigger");
    const text = await waitFor(
      async () => {
        const t = await s.page.evaluate(() => document.body.innerText);
        return /Import to diagram/.test(t) ? t : null;
      },
      { what: "the menu" },
    );
    for (const entry of ["Import to diagram…", "Python notebook…", "Connect Claude (MCP)…", "AI assistant settings…", "About & credits"]) {
      assert.ok(text.includes(entry), `the menu has "${entry}"`);
    }
  });

  it("keeps the credits and licenses of what it is built on", async () => {
    await s.page.keyboard.press("Escape");
    await s.page.evaluate(() => window.dispatchEvent(new Event("brand:open-about")));
    const text = await waitFor(
      async () => {
        const t = await s.page.evaluate(() => document.body.innerText);
        return /Esri/.test(t) && /Excalidraw/.test(t) ? t : null;
      },
      { what: "the About dialog" },
    );
    assert.match(text, /Excalidraw/);
    assert.match(text, /MIT/);
    assert.match(text, /Esri/);
    assert.match(text, /CC BY 4\.0/);
    assert.match(text, /Not affiliated with or endorsed by Excalidraw or Esri/);
  });
});
