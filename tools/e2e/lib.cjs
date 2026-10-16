// Shared helpers of the browser tests (tools/e2e). They drive a real Chrome through puppeteer-core, which is already in
// the lockfile (no new dependency), against a running app. `yarn test:e2e` starts the app if it is not running.
const fs = require("node:fs");
const puppeteer = require("puppeteer-core");

const APP_URL = process.env.E2E_APP_URL || "http://127.0.0.1:3000";
const LITE_PORT = Number(process.env.E2E_LITE_PORT || 3002);

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
];

const chromePath = () => {
  const found = CHROME_CANDIDATES.find((p) => p && fs.existsSync(p));
  if (!found) {
    throw new Error("No Chrome found: set CHROME_PATH to a Chrome or Chromium executable.");
  }
  return found;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls `fn` until it returns something truthy; throws with `what` after `timeout` ms. */
const waitFor = async (fn, { timeout = 30000, every = 200, what = "the condition" } = {}) => {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) {
        return last;
      }
    } catch (e) {
      last = e;
    }
    await sleep(every);
  }
  throw new Error(`Timed out after ${timeout} ms waiting for ${what}${last instanceof Error ? ` (${last.message})` : ""}`);
};

/** a request that stays on this machine: same host (any port), data: and blob: */
const isLocal = (url) => {
  try {
    const u = new URL(url);
    if (u.protocol === "data:" || u.protocol === "blob:" || u.protocol === "about:") {
      return true;
    }
    return ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
};

/**
 * Opens a browser and a page that records what leaves the machine, console errors and CSP violations.
 * `intercept(url) -> boolean` may abort requests (to simulate a site that is not running).
 */
const launch = async ({ width = 1500, height = 900, abort } = {}) => {
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: true,
    args: ["--no-sandbox", "--lang=en-US", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  const seen = { external: [], errors: [], csp: [] };
  if (abort) {
    await page.setRequestInterception(true);
  }
  page.on("request", (req) => {
    const url = req.url();
    if (!isLocal(url)) {
      seen.external.push(url);
    }
    if (abort) {
      abort(url) ? req.abort() : req.continue();
    }
  });
  page.on("pageerror", (e) => seen.errors.push(String(e.message || e)));
  page.on("console", (m) => {
    const text = m.text();
    if (/Content Security Policy|Refused to/i.test(text)) {
      seen.csp.push(text.slice(0, 300));
    }
  });
  return { browser, page, seen, close: () => browser.close() };
};

/** Opens the app and waits until the editor and the scene are there. */
const openApp = async (opts) => {
  const s = await launch(opts);
  await s.page.goto(APP_URL, { waitUntil: "load", timeout: 120000 });
  await waitFor(() => s.page.evaluate(() => !!(window.h && window.h.app && window.h.app.scene)), {
    timeout: 90000,
    what: "the editor",
  });
  return s;
};

/** the elements on the canvas that are not deleted */
const elements = (page) =>
  page.evaluate(() =>
    window.h.app.scene
      .getElementsIncludingDeleted()
      .filter((e) => !e.isDeleted)
      .map((e) => ({
        id: e.id,
        type: e.type,
        text: e.type === "text" ? e.text : undefined,
        name: e.name,
        polygon: e.polygon,
        frameId: e.frameId,
        fill: e.backgroundColor,
        custom: e.customData,
        width: e.width,
        height: e.height,
        meta: e.customData && e.customData.trazo,
        badge: e.customData && e.customData.trazoBadge,
        strokeColor: e.strokeColor,
      })),
  );

/** Clicks the first <button> whose text is exactly `text`. */
const clickButton = async (page, text, { timeout = 15000 } = {}) => {
  await waitFor(
    async () => {
      const handles = await page.$$("button");
      for (const h of handles) {
        const t = (await h.evaluate((e) => e.textContent || "")).trim();
        if (t === text && !(await h.evaluate((e) => e.disabled))) {
          await h.click();
          return true;
        }
      }
      return false;
    },
    { timeout, what: `the button "${text}"` },
  );
};

const openInfraDialog = async (page) => {
  await page.evaluate(() => window.dispatchEvent(new Event("brand:open-infra-import")));
  await page.waitForSelector("textarea", { timeout: 15000 });
};

module.exports = { APP_URL, LITE_PORT, chromePath, sleep, waitFor, isLocal, launch, openApp, elements, clickButton, openInfraDialog };
