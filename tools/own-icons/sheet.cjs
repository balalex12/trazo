// Renders every own icon on one HTML page (a contact sheet) so the packs can be checked by eye.
//   node tools/own-icons/sheet.cjs [out.html]      (default: tools/own-icons/out/sheet.html, git-ignored)
const fs = require("fs");
const path = require("path");
const { sections } = require("./icons.cjs");

const out = path.resolve(process.argv[2] || path.join(__dirname, "out", "sheet.html"));
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const html = `<!doctype html><meta charset="utf-8"><title>Trazo icon packs</title>
<style>
body{font:14px system-ui,sans-serif;margin:24px;background:#fff;color:#212529}
h2{margin:28px 0 12px;font-size:16px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:14px}
.card{border:1px solid #dee2e6;border-radius:8px;padding:10px 6px;text-align:center}
.card svg{width:64px;height:64px;display:block;margin:0 auto 6px}
.card span{display:block;font-size:12px;line-height:1.25}
</style>
${sections
  .map(
    (s) => `<h2>${esc(s.title)} (${s.icons.length})</h2><div class="grid">${s.icons
      .map((i) => `<div class="card">${i.svg}<span>${esc(i.name)}</span></div>`)
      .join("")}</div>`,
  )
  .join("")}`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${out}: ${sections.reduce((n, s) => n + s.icons.length, 0)} icons`);
