// Renders tools/social-preview/index.html to docs/media/social-preview.png (1280x640), the repository's social
// preview image. Needs a Chrome or Chromium and puppeteer-core:
//   npm i --no-save puppeteer-core
//   CHROME_PATH="/path/to/chrome" node tools/social-preview/render.cjs
// Then upload the PNG in GitHub: Settings > General > Social preview.
const path = require("node:path");
const puppeteer = require("puppeteer-core");

const CHROME =
  process.env.CHROME_PATH ||
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((p) => require("node:fs").existsSync(p));
if (!CHROME) {
  console.error("Set CHROME_PATH to a Chrome/Chromium executable.");
  process.exit(2);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--allow-file-access-from-files"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 640, deviceScaleFactor: 1 });
  await page.goto(`file://${path.join(__dirname, "index.html")}`);
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(__dirname, "..", "..", "docs", "media", "social-preview.png");
  await page.screenshot({ path: out });
  await browser.close();
  console.log(`Wrote ${out}`);
})();
