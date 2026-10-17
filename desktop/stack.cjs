// The three local servers of Trazo, the same ones Docker Compose runs, started from one folder:
//   site/         the app                                     http://127.0.0.1:3000   (required)
//   viewer/       the ArcGIS map viewer the app embeds        http://127.0.0.1:3001
//   jupyterlite/  the Python notebooks (JupyterLite, Pyodide) http://127.0.0.1:3002
// Each folder carries the policy that its server configuration (deploy/nginx) would send: site/_csp.inc,
// viewer/_csp.conf, jupyterlite/_csp.conf. Used by the desktop app and by the portable web zip.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const {
  createSiteServer,
  listen,
  policyFromInc,
} = require("./site-server.cjs");

// the app, the viewer and the notebook site list each other's origins, so the ports are part of the product
const PORTS = { app: 3000, viewer: 3001, lite: 3002 };

const policyOf = (dir, name) =>
  policyFromInc(fs.readFileSync(path.join(dir, name), "utf8"));

/**
 * @param {string} root                      the folder that holds site/, viewer/ and jupyterlite/
 * @param {object} [o]
 * @param {{app:number,viewer:number,lite:number}} [o.ports]  other ports (the tests use 0: any free port)
 * @returns {Promise<{servers: import("node:http").Server[], started: string[], skipped: string[]}>}
 *   the app must start (it throws if its port is taken); the viewer and the notebooks are skipped, not fatal, when their
 *   folder is missing or their port is taken: the app then works and says what it cannot reach
 */
const startStack = async (root, o = {}) => {
  const ports = { ...PORTS, ...(o.ports || {}) };
  const servers = [];
  const started = [];
  const skipped = [];

  const siteDir = path.join(root, "site");
  const app = createSiteServer({
    root: siteDir,
    csp: policyOf(siteDir, "_csp.inc"),
    spa: true,
    exclude: ["/_csp.inc"],
    ollamaCloud: true,
  });
  await listen(app, ports.app);
  servers.push(app);
  started.push("app");

  const optional = async (name, dir, policyFile, port, options) => {
    if (!fs.existsSync(path.join(dir, policyFile))) {
      skipped.push(name);
      return;
    }
    const server = createSiteServer({
      root: dir,
      csp: policyOf(dir, policyFile),
      exclude: [`/${policyFile}`],
      ...options,
    });
    try {
      await listen(server, port);
      servers.push(server);
      started.push(name);
    } catch {
      skipped.push(name); // the port is taken
    }
  };

  // the viewer calls ArcGIS services that read the Referer, so it keeps the origin (as deploy/nginx/viewer.conf says)
  await optional(
    "viewer",
    path.join(root, "viewer"),
    "_csp.conf",
    ports.viewer,
    {
      referrer: "strict-origin-when-cross-origin",
      permissions:
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-write=(self)",
    },
  );
  await optional(
    "notebooks",
    path.join(root, "jupyterlite"),
    "_csp.conf",
    ports.lite,
    {
      permissions:
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
  );
  return { servers, started, skipped };
};

module.exports = { PORTS, startStack };
