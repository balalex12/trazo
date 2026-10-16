// Serves the built site on 127.0.0.1 for the portable web zip (docs/INSTALL.md): the same local server and security
// headers as the desktop app, without Electron. Needs Node.js 18 or newer.
//
//   node serve.cjs [port]        (default 3000: the notebook site and the map viewer expect that address)
//
// Next to this file: site-server.cjs and the folder site/ (the built app and its _csp.inc).
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const {
  createSiteServer,
  listen,
  policyFromInc,
} = require("./site-server.cjs");

const root = path.join(__dirname, "site");
const port = Number(process.argv[2] || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("The port must be a number between 1 and 65535.");
  process.exit(2);
}
const server = createSiteServer({
  root,
  csp: policyFromInc(fs.readFileSync(path.join(root, "_csp.inc"), "utf8")),
  spa: true,
  exclude: ["/_csp.inc"],
  ollamaCloud: true,
});
listen(server, port).then(
  () =>
    console.log(
      `Trazo is running on http://127.0.0.1:${port}  (Ctrl+C to stop)`,
    ),
  (e) => {
    console.error(
      e && e.code === "EADDRINUSE"
        ? `Port ${port} is in use. Close what uses it, or run: node serve.cjs <another port>`
        : String((e && e.message) || e),
    );
    process.exit(1);
  },
);
