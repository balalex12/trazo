// Serves the built notebook site (assets/jupyterlite) the way deploy/nginx/lite.conf does: the same mime types and the
// Content-Security-Policy that tools/build-jupyterlite.mjs wrote to _csp.conf. Used by the notebook browser tests, so
// they run under the real policy. (The nginx container itself is not part of these tests.)
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..", "assets", "jupyterlite");

const MIME = {
  html: "text/html",
  css: "text/css",
  js: "application/javascript",
  mjs: "application/javascript",
  json: "application/json",
  map: "application/json",
  webmanifest: "application/json",
  wasm: "application/wasm",
  zip: "application/zip",
  whl: "application/zip",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  txt: "text/plain",
  ipynb: "application/json",
};

const built = () => fs.existsSync(path.join(ROOT, "_csp.conf")) && fs.existsSync(path.join(ROOT, "lab", "index.html"));

/** the policy nginx would send (the quoted value of add_header in _csp.conf) */
const policy = () => /Content-Security-Policy "([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, "_csp.conf"), "utf8"))[1];

/**
 * Every file of the site, found once when the server starts: the URL path -> the file. A request is answered only from
 * this table, so what a request asks for never becomes a path on the disk (no traversal is possible by construction).
 */
const siteFiles = () => {
  const files = new Map();
  const walk = (dir, url) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      const at = `${url}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(file, at);
      } else if (entry.isFile() && at !== "/_csp.conf") {
        files.set(at, file);
        if (entry.name === "index.html") {
          // a folder is served by its index, with or without the closing slash
          files.set(`${url}/`, file);
          if (url) files.set(url, file);
        }
      }
    }
  };
  walk(ROOT, "");
  return files;
};

const start = (port) =>
  new Promise((resolve, reject) => {
    const csp = policy();
    const files = siteFiles();
    const server = http.createServer((req, res) => {
      let requested;
      try {
        requested = decodeURIComponent(req.url.split("?")[0]);
      } catch {
        requested = "";
      }
      const file = files.get(requested);
      if (!file) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": MIME[file.split(".").pop()] || "application/octet-stream",
        "Content-Security-Policy": csp,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-cache",
      });
      fs.createReadStream(file).pipe(res);
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });

module.exports = { built, start };
