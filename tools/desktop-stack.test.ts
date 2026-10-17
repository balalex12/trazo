// The three local servers of the desktop app and of the portable web zip (desktop/stack.cjs): the app, the ArcGIS map
// viewer and the Python notebooks start together, each with the policy of its own server configuration.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

// @ts-expect-error a CommonJS module without types
import { startStack } from "../desktop/stack.cjs";

const roots: string[] = [];
const running: http.Server[] = [];

const write = (file: string, text: string) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
};

/** a folder like the one of the installer: site/, viewer/ and jupyterlite/ with their policy files */
const makeRoot = ({ viewer = true, lite = true } = {}) => {
  const root = mkdtempSync(path.join(tmpdir(), "trazo-stack-"));
  roots.push(root);
  write(path.join(root, "site", "index.html"), "<html>APP</html>");
  write(
    path.join(root, "site", "_csp.inc"),
    `add_header Content-Security-Policy "default-src 'self'; script-src 'self'" always;`,
  );
  if (viewer) {
    write(path.join(root, "viewer", "index.html"), "<html>VIEWER</html>");
    write(
      path.join(root, "viewer", "_csp.conf"),
      `server { add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://js.arcgis.com; frame-ancestors 'self' http://127.0.0.1:3000" always; }`,
    );
  }
  if (lite) {
    write(path.join(root, "jupyterlite", "index.html"), "<html>LITE</html>");
    write(
      path.join(root, "jupyterlite", "_csp.conf"),
      `add_header Content-Security-Policy "default-src 'self'; connect-src 'self'" always;`,
    );
  }
  return root;
};

const get = (server: http.Server, p = "/") =>
  new Promise<{
    status: number;
    headers: http.IncomingHttpHeaders;
    body: string;
  }>((resolve, reject) => {
    const port = (server.address() as AddressInfo).port;
    http
      .get({ host: "127.0.0.1", port, path: p }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode!, headers: res.headers, body }),
        );
      })
      .on("error", reject);
  });

const ANY = { app: 0, viewer: 0, lite: 0 };

afterEach(() => {
  running.splice(0).forEach((s) => s.close());
  roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true }));
});

describe("the local servers of Trazo", () => {
  it("starts the app, the map viewer and the notebooks, each with its own policy", async () => {
    const r = await startStack(makeRoot(), { ports: ANY });
    running.push(...r.servers);
    expect(r.started).toEqual(["app", "viewer", "notebooks"]);
    expect(r.skipped).toEqual([]);
    const [app, viewer, lite] = r.servers;
    expect((await get(app)).body).toContain("APP");
    const v = await get(viewer);
    expect(v.body).toContain("VIEWER");
    expect(v.headers["content-security-policy"]).toContain("js.arcgis.com");
    // the viewer's map services read the Referer: it keeps the origin, as deploy/nginx/viewer.conf does
    expect(v.headers["referrer-policy"]).toBe(
      "strict-origin-when-cross-origin",
    );
    const l = await get(lite);
    expect(l.body).toContain("LITE");
    expect(l.headers["content-security-policy"]).toContain(
      "connect-src 'self'",
    );
    expect(l.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("never serves the policy files", async () => {
    const r = await startStack(makeRoot(), { ports: ANY });
    running.push(...r.servers);
    expect((await get(r.servers[0], "/_csp.inc")).status).toBe(404);
    expect((await get(r.servers[1], "/_csp.conf")).status).toBe(404);
    expect((await get(r.servers[2], "/_csp.conf")).status).toBe(404);
  });

  it("starts the app alone when the viewer and the notebooks are not in the folder", async () => {
    const r = await startStack(makeRoot({ viewer: false, lite: false }), {
      ports: ANY,
    });
    running.push(...r.servers);
    expect(r.started).toEqual(["app"]);
    expect(r.skipped).toEqual(["viewer", "notebooks"]);
  });

  it("skips a part whose port is taken, and fails only when the app's port is", async () => {
    const first = await startStack(makeRoot(), { ports: ANY });
    running.push(...first.servers);
    const [appPort, viewerPort, litePort] = first.servers.map(
      (s: http.Server) => (s.address() as AddressInfo).port,
    );
    // the viewer's and the notebooks' ports are taken: the app still starts
    const second = await startStack(makeRoot(), {
      ports: { app: 0, viewer: viewerPort, lite: litePort },
    });
    running.push(...second.servers);
    expect(second.started).toEqual(["app"]);
    expect(second.skipped).toEqual(["viewer", "notebooks"]);
    // the app's port is taken: it is an error
    await expect(
      startStack(makeRoot(), { ports: { app: appPort, viewer: 0, lite: 0 } }),
    ).rejects.toMatchObject({ code: "EADDRINUSE" });
  });
});
