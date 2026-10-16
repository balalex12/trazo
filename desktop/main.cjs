// Trazo as a desktop app: a window around the same site that the Docker image serves, from a small local server on
// 127.0.0.1:3000 with the same security headers (site-server.cjs). Nothing is contacted unless you configure it, exactly
// like the web version. The window has no Node.js: the page cannot reach your files or run programs.
//
// Optional: if a notebook pack (the JupyterLite site, docs/NOTEBOOKS.md) is in the folder "jupyterlite" next to the
// app data (Help > Open the notebook pack folder), it is served on 127.0.0.1:3002 and the Notebook panel works.
"use strict";
const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  session,
  shell,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const {
  createSiteServer,
  listen,
  policyFromInc,
} = require("./site-server.cjs");

const APP_PORT = 3000; // the notebook site and the viewer list this origin as the one that may embed them
const LITE_PORT = 3002;
const ORIGIN = `http://127.0.0.1:${APP_PORT}`;
const PROJECT = "https://github.com/balalex12/trazo";

const resources = app.isPackaged ? process.resourcesPath : __dirname;
const siteDir = path.join(resources, "site");
const packDir = () =>
  process.env.TRAZO_NOTEBOOK_DIR ||
  path.join(app.getPath("userData"), "jupyterlite");

const servers = [];
let win = null;

const startApp = async () => {
  const csp = policyFromInc(
    fs.readFileSync(path.join(siteDir, "_csp.inc"), "utf8"),
  );
  const server = createSiteServer({
    root: siteDir,
    csp,
    spa: true,
    exclude: ["/_csp.inc"],
    ollamaCloud: true,
  });
  await listen(server, APP_PORT);
  servers.push(server);
};

/** the notebook pack, when there is one: the same policy that its build wrote (_csp.conf) */
const startNotebookPack = async () => {
  const dir = packDir();
  if (
    !fs.existsSync(path.join(dir, "_csp.conf")) ||
    !fs.existsSync(path.join(dir, "lab", "index.html"))
  ) {
    return false;
  }
  const server = createSiteServer({
    root: dir,
    csp: policyFromInc(fs.readFileSync(path.join(dir, "_csp.conf"), "utf8")),
    exclude: ["/_csp.conf"],
    permissions: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  });
  try {
    await listen(server, LITE_PORT);
    servers.push(server);
    return true;
  } catch {
    return false; // the port is taken: the app works, the Notebook panel says it cannot find the site
  }
};

const isOurs = (url) => {
  try {
    return new URL(url).origin === ORIGIN;
  } catch {
    return false;
  }
};
const openOutside = (url) => {
  // only web links, and only with a click of the person: the system's own browser opens them
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
};

// what a page of the app may ask the system for: the clipboard, fullscreen and the microphone (narration, recorder)
const ALLOWED = new Set([
  "clipboard-read",
  "clipboard-sanitized-write",
  "fullscreen",
  "media",
]);
const hardenSession = () => {
  const s = session.defaultSession;
  s.setPermissionRequestHandler((_wc, permission, callback, details) =>
    callback(ALLOWED.has(permission) && isOurs(details.requestingUrl)),
  );
  s.setPermissionCheckHandler(
    (_wc, permission, requestingOrigin) =>
      ALLOWED.has(permission) && isOurs(requestingOrigin),
  );
};

const createWindow = () => {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 560,
    title: "Trazo",
    backgroundColor: "#ffffff",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!isOurs(url)) {
      event.preventDefault();
      openOutside(url);
    }
  });
  win.on("closed", () => {
    win = null;
  });
  win.loadURL(`${ORIGIN}/`);
};

const buildMenu = () => {
  const mac = process.platform === "darwin";
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(mac ? [{ role: "appMenu" }] : []),
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "reload" },
          { role: "togglefullscreen" },
          { type: "separator" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          ...(app.isPackaged
            ? []
            : [{ type: "separator" }, { role: "toggleDevTools" }]),
        ],
      },
      { role: "windowMenu" },
      {
        label: "Help",
        submenu: [
          { label: "Trazo on GitHub", click: () => openOutside(PROJECT) },
          {
            label: "Open the notebook pack folder",
            click: () => {
              fs.mkdirSync(packDir(), { recursive: true });
              shell.openPath(packDir());
            },
          },
        ],
      },
    ]),
  );
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(async () => {
    try {
      await startApp();
    } catch (e) {
      dialog.showErrorBox(
        "Trazo could not start",
        e && e.code === "EADDRINUSE"
          ? `Another program is using port ${APP_PORT} (maybe Trazo in Docker). Close it and open Trazo again.`
          : String((e && e.message) || e),
      );
      app.quit();
      return;
    }
    await startNotebookPack();
    hardenSession();
    buildMenu();
    createWindow();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => servers.forEach((s) => s.close()));
  app.on("activate", () => {
    if (!win) createWindow();
  });
}
