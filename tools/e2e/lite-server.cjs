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

const start = (port) =>
  new Promise((resolve, reject) => {
    const csp = policy();
    const server = http.createServer((req, res) => {
      const notFound = () => {
        res.writeHead(404);
        res.end();
      };
      // the requested path is resolved against the site folder and checked to stay inside it BEFORE the disk is touched
      let requested;
      try {
        requested = decodeURIComponent(req.url.split("?")[0]);
      } catch {
        return notFound();
      }
      if (requested.includes("\0")) {
        return notFound();
      }
      // resolved against the site folder, and checked with startsWith(root + separator) before every use of the disk
      let file = path.resolve(ROOT, `.${requested.startsWith("/") ? requested : `/${requested}`}`);
      if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
        return notFound();
      }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
        file = path.resolve(file, "index.html");
        if (!file.startsWith(ROOT + path.sep)) {
          return notFound();
        }
      }
      if (path.basename(file) === "_csp.conf" || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        return notFound();
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
