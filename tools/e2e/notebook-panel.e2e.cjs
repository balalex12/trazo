// The notebook panel when the notebook site is NOT running (the common case on a machine that never built it): the
// panel opens, says how to start the site, disables what needs it, and keeps itself mounted when hidden.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");

const { openApp, waitFor, sleep } = require("./lib.cjs");

describe("notebook panel without the notebook site", () => {
  let s;
  before(async () => {
    // whatever listens on the notebook port (nothing, or a real site on a developer machine), the page sees no site
    s = await openApp({ abort: (url) => new URL(url).port === "3002" });
  });
  after(async () => {
    await s.close();
  });

  it("is offered as a button and opens in the app", async () => {
    await s.page.evaluate(() => window.dispatchEvent(new Event("brand:open-notebook")));
    await waitFor(() => s.page.$('iframe[title="Python notebook"]'), { what: "the notebook iframe" });
    const src = await s.page.$eval('iframe[title="Python notebook"]', (f) => f.src);
    assert.match(src, /:3002\/lab\/index\.html$/);
    const sandbox = await s.page.$eval('iframe[title="Python notebook"]', (f) => f.getAttribute("sandbox"));
    assert.match(sandbox, /allow-scripts/);
    assert.doesNotMatch(sandbox, /allow-top-navigation/);
  });

  it("says how to start the site when it does not answer, and disables what needs it", async () => {
    const text = await waitFor(
      async () => {
        const t = await s.page.evaluate(() => document.body.innerText);
        return /does not answer/.test(t) ? t : null;
      },
      { timeout: 30000, what: "the hint" },
    );
    assert.match(text, /node tools\/build-jupyterlite\.mjs/);
    assert.match(text, /docker compose --profile lite up -d/);
    const disabled = await s.page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .filter((b) => ["Diagram this notebook", "Send diagram to notebook", "Draft notebook from diagram"].includes(b.textContent.trim()))
        .map((b) => b.disabled),
    );
    assert.deepEqual(disabled, [true, true, true]);
  });

  it("keeps the iframe (and so the kernel) when the panel is hidden", async () => {
    const buttons = await s.page.$$("button");
    for (const b of buttons) {
      if ((await b.evaluate((e) => e.title)).startsWith("Hide the panel")) {
        await b.click();
        break;
      }
    }
    await sleep(300);
    const state = await s.page.evaluate(() => {
      const f = document.querySelector('iframe[title="Python notebook"]');
      return { there: !!f, shown: !!f && f.parentElement.style.display !== "none" };
    });
    assert.deepEqual(state, { there: true, shown: false });
    // and the button to bring it back is on screen
    assert.ok(await s.page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Notebook"))));
  });

  it("stays on this machine", () => {
    assert.deepEqual(s.seen.external, []);
    assert.deepEqual(s.seen.csp, []);
  });
});
