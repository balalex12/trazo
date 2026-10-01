// Network / CSP / service-worker audit of a running instance. Prints every external host contacted.
//   npm i --no-save puppeteer-core
//   CHROME_PATH="/path/to/chrome" node tools/audit/network-audit.cjs [http://localhost:3000]
// Exit code 1 if the app (without a map embed) contacts any external host or violates the CSP.
const puppeteer = require("puppeteer-core");

const APP = process.argv[2] || "http://localhost:3000";
const CHROME =
  process.env.CHROME_PATH ||
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((p) => require("fs").existsSync(p));
if (!CHROME) {
  console.error("Set CHROME_PATH to a Chrome/Chromium executable.");
  process.exit(2);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--lang=en-US"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const origin = new URL(APP).host;
  const hosts = new Map();
  const csp = [];
  let phase = "load";
  page.on("request", (r) => {
    try {
      const u = new URL(r.url());
      if (u.protocol.startsWith("http") && u.host !== origin && u.host !== "localhost:3001") {
        if (!hosts.has(u.host)) hosts.set(u.host, new Set());
        hosts.get(u.host).add(phase);
      }
    } catch (e) {
      /* ignore */
    }
  });
  page.on("console", (m) => {
    if (/Content Security Policy|violates the following/i.test(m.text())) csp.push(`${phase}: ${m.text().slice(0, 200)}`);
  });

  await page.goto(APP, { waitUntil: "networkidle2" });
  await sleep(3000);
  phase = "menu";
  await page.click(".main-menu-trigger").catch(() => {});
  await sleep(800);
  await page.keyboard.press("Escape");
  phase = "library";
  await page.click(".sidebar-trigger").catch(() => {});
  await sleep(2500);
  phase = "animation-panel";
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Animation"))?.click());
  await sleep(600);
  phase = "text-to-diagram";
  await page.keyboard.press("Escape");
  await page.keyboard.down("Control");
  await page.keyboard.press("/");
  await page.keyboard.up("Control");
  await sleep(600);
  await page.keyboard.type("text to diagram");
  await sleep(400);
  await page.keyboard.press("Enter");
  await sleep(2000);

  const workers = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
  console.log("EXTERNAL HOSTS (app, no map embed):", hosts.size ? [...hosts].map(([h, p]) => `${h} (${[...p]})`) : "none");
  console.log("CSP violations:", csp.length ? csp.length : "none");
  console.log("service workers:", workers);
  await browser.close();
  process.exit(hosts.size || csp.length || workers ? 1 : 0);
})();
