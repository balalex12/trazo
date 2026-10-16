// A small local web server for the desktop app (desktop/main.cjs): it serves a built site from a folder on 127.0.0.1
// with the same security headers as deploy/nginx/app.conf (the Content-Security-Policy that scripts/csp-hashes.mjs
// computed, nosniff, no referrer...), and, for the app, the same-origin pass-through to Ollama Cloud that nginx has.
//
// Every file of the site is found once when the server starts and a request is answered only from that table, so
// what a request asks for never becomes a path on the disk: no traversal is possible by construction.
"use strict";
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");

const MIME = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "application/javascript",
  mjs: "application/javascript",
  json: "application/json",
  map: "application/json",
  webmanifest: "application/manifest+json",
  excalidrawlib: "application/json",
  excalidraw: "application/json",
  ipynb: "application/json",
  wasm: "application/wasm",
  zip: "application/zip",
  whl: "application/zip",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml",
  mp3: "audio/mpeg",
  wav: "audio/wav",
};

const OLLAMA_PREFIX = "/llm/ollama-cloud/";
const MAX_PROXY_BODY = 1024 * 1024;

/** the policy nginx would send: the quoted value of add_header in a csp.inc / _csp.conf */
const policyFromInc = (text) => {
  const m = /Content-Security-Policy "([^"]+)"/.exec(text);
  if (!m) throw new Error("No Content-Security-Policy in the policy file.");
  return m[1];
};

/** every file below `root`: URL path -> file; a folder is also served by its index.html */
const siteFiles = (root, exclude) => {
  const files = new Map();
  const walk = (dir, url) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      const at = `${url}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(file, at);
      } else if (entry.isFile() && !exclude.has(at)) {
        files.set(at, file);
        if (entry.name === "index.html") {
          files.set(`${url}/`, file);
          if (url) files.set(url, file);
        }
      }
    }
  };
  walk(root, "");
  return files;
};

/**
 * @param {object} o
 * @param {string} o.root           the folder of the built site
 * @param {string} o.csp            the Content-Security-Policy to send
 * @param {boolean} [o.spa]         unknown paths without an extension get index.html (the app's own routes)
 * @param {string[]} [o.exclude]    URL paths never served (the policy file)
 * @param {boolean} [o.ollamaCloud] the pass-through /llm/ollama-cloud/* -> ollama.com (the app only)
 * @param {string} [o.ollamaOrigin] where that pass-through goes (a test points it at a fake)
 * @param {string} [o.permissions]  Permissions-Policy
 */
const createSiteServer = (o) => {
  const files = siteFiles(o.root, new Set(o.exclude || []));
  const upstream = new URL(o.ollamaOrigin || "https://ollama.com");
  const headers = {
    "Content-Security-Policy": o.csp,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy":
      o.permissions ||
      "camera=(), microphone=(self), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cache-Control": "no-cache, must-revalidate",
  };

  const ollama = (req, res, rawPath, search) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_PROXY_BODY) {
        res.writeHead(413, headers);
        res.end();
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const lib = upstream.protocol === "http:" ? http : https;
      let out;
      try {
        out = lib.request(
          {
            host: upstream.hostname,
            port: upstream.port || (upstream.protocol === "http:" ? 80 : 443),
            method: req.method,
            path: `/${rawPath.slice(OLLAMA_PREFIX.length)}${search}`,
            // what the browser sends minus anything that identifies the page or the person (no cookies, origin, referer)
            headers: {
              Host: upstream.host,
              "Content-Type": req.headers["content-type"] || "application/json",
              Accept: req.headers.accept || "*/*",
              ...(req.headers.authorization
                ? { Authorization: req.headers.authorization }
                : {}),
              "Content-Length": body.length,
            },
          },
          (answer) => {
            res.writeHead(answer.statusCode, {
              ...headers,
              "Content-Type": answer.headers["content-type"] || "text/plain",
              "Cache-Control": "no-cache",
            });
            answer.pipe(res);
          },
        );
      } catch {
        // a path or header Node refuses (a space, a line break...): answer, do not crash the server
        res.writeHead(400, headers);
        res.end();
        return;
      }
      out.on("error", () => {
        if (!res.headersSent) res.writeHead(502, headers);
        res.end("Could not reach ollama.com");
      });
      out.end(body);
    });
  };

  const server = http.createServer((req, res) => {
    // a request for another name (DNS rebinding) gets nothing: only this address
    const port = server.address() && server.address().port;
    if (
      req.headers.host !== `127.0.0.1:${port}` &&
      req.headers.host !== `localhost:${port}`
    ) {
      res.writeHead(421, { "Content-Type": "text/plain" });
      res.end("Misdirected request");
      return;
    }
    let pathname;
    let rawPath;
    let search = "";
    try {
      const u = new URL(req.url, "http://local");
      rawPath = u.pathname; // still percent-encoded: this is what may go upstream
      pathname = decodeURIComponent(u.pathname);
      search = u.search;
    } catch {
      res.writeHead(400, headers);
      res.end();
      return;
    }
    if (o.ollamaCloud && rawPath.startsWith(OLLAMA_PREFIX)) {
      if (req.method !== "GET" && req.method !== "POST") {
        res.writeHead(405, headers);
        res.end();
        return;
      }
      ollama(req, res, rawPath, search);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { ...headers, Allow: "GET, HEAD" });
      res.end();
      return;
    }
    let file = files.get(pathname);
    if (!file && o.spa && !path.posix.basename(pathname).includes(".")) {
      file = files.get("/index.html");
    }
    if (!file) {
      res.writeHead(404, headers);
      res.end();
      return;
    }
    const ext = path.extname(file).slice(1).toLowerCase();
    res.writeHead(200, {
      ...headers,
      "Content-Type": MIME[ext] || "application/octet-stream",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
  });
  return server;
};

/** starts on 127.0.0.1:port; rejects (for example EADDRINUSE) so the caller can say what is wrong */
const listen = (server, port) =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });

module.exports = { createSiteServer, listen, policyFromInc, siteFiles };
