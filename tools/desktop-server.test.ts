// The local server of the desktop app (desktop/site-server.cjs): it must send the same security headers as nginx, answer
// only from the files it found at start (no path from a request reaches the disk), accept only its own address, and
// pass Ollama Cloud requests on without cookies.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// @ts-expect-error a CommonJS module without types
import {
  createSiteServer,
  listen,
  policyFromInc,
} from "../desktop/site-server.cjs";

const CSP = "default-src 'self'; script-src 'self' 'sha256-abc='";
let dir: string;
let secret: string;
let server: http.Server;
let upstream: http.Server;
let port: number;
let seen: {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}[] = [];

const get = (p: string, opts: http.RequestOptions = {}) =>
  new Promise<{
    status: number;
    headers: http.IncomingHttpHeaders;
    body: string;
  }>((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: p, method: "GET", ...opts },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode!, headers: res.headers, body }),
        );
      },
    );
    req.on("error", reject);
    if (opts.method === "POST") req.write("hello");
    req.end();
  });

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "trazo-site-"));
  const site = path.join(dir, "site");
  mkdirSync(path.join(site, "assets"), { recursive: true });
  writeFileSync(path.join(site, "index.html"), "<html>INDEX</html>");
  writeFileSync(path.join(site, "assets", "app.js"), "console.log(1)");
  writeFileSync(
    path.join(site, "_csp.inc"),
    `add_header Content-Security-Policy "${CSP}" always;\n`,
  );
  secret = path.join(dir, "secret.txt");
  writeFileSync(secret, "TOP SECRET");

  upstream = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    });
  });
  await listen(upstream, 0);
  const up = (upstream.address() as AddressInfo).port;

  server = createSiteServer({
    root: site,
    csp: CSP,
    spa: true,
    exclude: ["/_csp.inc"],
    ollamaCloud: true,
    ollamaOrigin: `http://127.0.0.1:${up}`,
  });
  await listen(server, 0);
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server.close();
  upstream.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the desktop app's local server", () => {
  it("reads the policy the way nginx writes it", () => {
    expect(
      policyFromInc(`add_header Content-Security-Policy "${CSP}" always;`),
    ).toBe(CSP);
    expect(() => policyFromInc("nothing")).toThrow();
  });

  it("serves the site with the security headers, and the app's own routes with its index", async () => {
    const home = await get("/");
    expect(home.status).toBe(200);
    expect(home.body).toContain("INDEX");
    expect(home.headers["content-security-policy"]).toBe(CSP);
    expect(home.headers["x-content-type-options"]).toBe("nosniff");
    expect(home.headers["referrer-policy"]).toBe("no-referrer");
    expect(home.headers["permissions-policy"]).toContain("camera=()");
    expect(home.headers["cross-origin-opener-policy"]).toBe("same-origin");
    const js = await get("/assets/app.js");
    expect(js.headers["content-type"]).toBe("application/javascript");
    expect((await get("/some/route")).body).toContain("INDEX");
    // a missing file (it has an extension) is a 404, not the index
    expect((await get("/assets/missing.js")).status).toBe(404);
  });

  it("never serves the policy file, nor anything outside the site", async () => {
    expect((await get("/_csp.inc")).status).toBe(404);
    for (const p of [
      "/../secret.txt",
      "/%2e%2e/secret.txt",
      "/assets/../../secret.txt",
      "/..%2fsecret.txt",
      "/%00",
    ]) {
      const r = await get(p);
      expect(r.body, p).not.toContain("TOP SECRET");
    }
  });

  it("answers only its own address, and only GET and HEAD for the site", async () => {
    expect((await get("/", { headers: { Host: "evil.example" } })).status).toBe(
      421,
    );
    expect(
      (await get("/", { headers: { Host: `localhost:${port}` } })).status,
    ).toBe(200);
    expect((await get("/", { method: "DELETE" })).status).toBe(405);
    expect((await get("/", { method: "HEAD" })).status).toBe(200);
  });

  it("passes Ollama Cloud requests on, with the key and without cookies", async () => {
    seen = [];
    const r = await get("/llm/ollama-cloud/v1/models?x=1", {
      headers: {
        Cookie: "a=b",
        Origin: "http://127.0.0.1:3000",
        Referer: "http://127.0.0.1:3000/",
        Authorization: "Bearer k",
      },
    });
    expect(r.status).toBe(200);
    expect(r.body).toBe('{"ok":true}');
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("/v1/models?x=1");
    expect(seen[0].headers.authorization).toBe("Bearer k");
    expect(seen[0].headers.cookie).toBeUndefined();
    expect(seen[0].headers.origin).toBeUndefined();
    expect(seen[0].headers.referer).toBeUndefined();
    const post = await get("/llm/ollama-cloud/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(post.status).toBe(200);
    expect(seen[1].body).toBe("hello");
    expect(
      (await get("/llm/ollama-cloud/v1/x", { method: "PUT" })).status,
    ).toBe(405);
  });
});
