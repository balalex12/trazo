// Regenerates the app icons (favicon.svg/.ico, PNG favicons, apple-touch, android-chrome, maskable) from the
// project mark. Edit MARK / COLORS to rebrand.   npm i --no-save puppeteer-core ; CHROME_PATH=... node tools/make-icons.cjs
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const path = require("path");

const BG = "#cc440c"; // keep in sync with excalidraw-app/brand.scss
// Original mark: a freehand stroke ending in a node (viewBox 0 0 52 52, drawn on a transparent background).
const MARK = `<path d="M12 34 C 18 14, 26 40, 32 22 S 40 18, 41 16" stroke="#fff" stroke-width="3.5" stroke-linecap="round" fill="none"/><circle cx="41" cy="16" r="4.5" fill="#fff"/>`;

// full-bleed square (apple/android) vs rounded (favicon) vs maskable (mark inside the 80% safe zone)
const svg = ({
  rounded,
  scale,
}) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
<rect width="52" height="52" ${rounded ? 'rx="12"' : ""} fill="${BG}"/>
<g transform="translate(26 26) scale(${scale}) translate(-26 -26)">${MARK}</g></svg>`;

const out = path.join(process.cwd(), "public");
const CHROME =
  process.env.CHROME_PATH ||
  "C:/Program Files/Google/Chrome/Application/chrome.exe";

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  const png = async (size, opts) => {
    await page.setViewport({ width: size, height: size });
    await page.setContent(
      `<body style="margin:0;background:transparent">${svg(opts).replace(
        "<svg ",
        `<svg width="${size}" height="${size}" `,
      )}</body>`,
    );
    return page.screenshot({ type: "png", omitBackground: true });
  };
  const write = (name, buf) => fs.writeFileSync(path.join(out, name), buf);

  fs.writeFileSync(
    path.join(out, "favicon.svg"),
    svg({ rounded: true, scale: 1 }),
  );
  write("favicon-16x16.png", await png(16, { rounded: true, scale: 1 }));
  write("favicon-32x32.png", await png(32, { rounded: true, scale: 1 }));
  write("apple-touch-icon.png", await png(180, { rounded: false, scale: 1 }));
  write(
    "android-chrome-192x192.png",
    await png(192, { rounded: true, scale: 1 }),
  );
  write(
    "android-chrome-512x512.png",
    await png(512, { rounded: true, scale: 1 }),
  );
  write(
    "maskable_icon_x192.png",
    await png(192, { rounded: false, scale: 0.7 }),
  );
  write(
    "maskable_icon_x512.png",
    await png(512, { rounded: false, scale: 0.7 }),
  );

  // .ico with PNG payloads (16, 32, 48)
  const sizes = [16, 32, 48];
  const imgs = [];
  for (const s of sizes) imgs.push(await png(s, { rounded: true, scale: 1 }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(imgs.length, 4);
  let offset = 6 + 16 * imgs.length;
  const dir = imgs.map((img, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(sizes[i], 0);
    e.writeUInt8(sizes[i], 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(img.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.length;
    return e;
  });
  write("favicon.ico", Buffer.concat([header, ...dir, ...imgs]));
  await browser.close();
  console.log("icons written to public/");
})();
