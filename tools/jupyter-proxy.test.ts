import http from "node:http";
import net from "node:net";

import {
  allowEmbedding,
  bridgeSource,
  createProxy,
  injectBridge,
  isLoopbackHost,
  parseOptions,
  // @ts-expect-error plain ES module, not part of the typechecked sources
} from "./jupyter-proxy.mjs";

describe("parseOptions", () => {
  it("has safe defaults", () => {
    const o = parseOptions([]);
    expect(o.target).toBe("http://127.0.0.1:8888");
    expect(o.port).toBe(3003);
    expect(o.parents).toEqual([
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ]);
    expect(o.allowRemoteTarget).toBe(false);
  });

  it("reads its options", () => {
    const o = parseOptions([
      "--target",
      "http://localhost:9000",
      "--port",
      "4100",
      "--parent",
      "https://trazo.lan/",
    ]);
    expect(o.targetUrl.port).toBe("9000");
    expect(o.port).toBe(4100);
    expect(o.parents).toContain("https://trazo.lan");
  });

  it("refuses a target that is not on this machine unless told", () => {
    expect(() =>
      parseOptions(["--target", "http://jupyter.example.com:8888"]),
    ).toThrow(/not on this machine/);
    expect(
      parseOptions([
        "--target",
        "http://jupyter.example.com:8888",
        "--allow-remote-target",
      ]).allowRemoteTarget,
    ).toBe(true);
  });

  it("refuses what it cannot use", () => {
    expect(() => parseOptions(["--target", "ftp://x"])).toThrow(/http/);
    expect(() => parseOptions(["--target", "nope"])).toThrow(/not a URL/);
    expect(() => parseOptions(["--port", "99999"])).toThrow(/--port/);
    expect(() => parseOptions(["--port"])).toThrow(/needs a value/);
    expect(() => parseOptions(["--wat"])).toThrow(/Unknown option/);
  });

  it("knows what this machine is", () => {
    for (const h of ["127.0.0.1", "localhost", "::1", "127.1.2.3"])
      expect(isLoopbackHost(h)).toBe(true);
    for (const h of ["example.com", "192.168.1.2", "0.0.0.0"])
      expect(isLoopbackHost(h)).toBe(false);
  });
});

describe("rewriting what Jupyter sends", () => {
  it("lets the Trazo origins embed the page and keeps the other directives", () => {
    const csp = allowEmbedding(
      "report-uri /api/security/csp-report; frame-ancestors 'self'",
      ["http://127.0.0.1:3000"],
    );
    expect(csp).toBe(
      "report-uri /api/security/csp-report; frame-ancestors 'self' http://127.0.0.1:3000",
    );
    expect(allowEmbedding(undefined, ["http://a"])).toBe(
      "frame-ancestors 'self' http://a",
    );
  });

  it("adds the bridge script once, to the head of the page", () => {
    const html = "<html><head><title>x</title></head><body></body></html>";
    const out = injectBridge(html);
    expect(out).toContain(
      '<script defer src="/trazo-bridge.js"></script></head>',
    );
    expect(injectBridge(out)).toBe(out);
  });

  it("fills the Trazo origins into the bridge", () => {
    const src = bridgeSource(["http://127.0.0.1:3000"]);
    expect(src).toContain('["http://127.0.0.1:3000"]');
    expect(src).not.toContain("__TRAZO_PARENT_ORIGINS__");
  });
});

describe("the proxy", () => {
  const listen = (server: http.Server | net.Server) =>
    new Promise<number>((resolve) =>
      server.listen(0, "127.0.0.1", () =>
        resolve((server.address() as net.AddressInfo).port),
      ),
    );

  let upstream: http.Server;
  let proxy: http.Server;
  let upstreamPort = 0;
  let proxyPort = 0;
  const seen: { host?: string; origin?: string; auth?: string }[] = [];
  const sockets = new Set<net.Socket>();
  const upstreamSockets = new Set<net.Socket>();

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      seen.push({
        host: req.headers.host,
        origin: req.headers.origin as string,
        auth: req.headers.authorization,
      });
      if (req.url!.startsWith("/lab")) {
        res.writeHead(200, {
          "Content-Type": "text/html",
          "X-Frame-Options": "DENY",
          "Content-Security-Policy": "frame-ancestors 'self'; report-uri /csp",
        });
        res.end("<html><head></head><body>lab</body></html>");
      } else if (req.url === "/api/data") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "X-Frame-Options": "DENY",
        });
        res.end('{"ok":true}');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    // a WebSocket-like upgrade: after the handshake, whatever arrives is sent back in capitals
    upstream.on("upgrade", (req, socket) => {
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
      );
      socket.on("data", (d) => socket.write(d.toString().toUpperCase()));
      // like a real WebSocket server: when the other side is gone, close ours
      socket.on("end", () => socket.end());
    });
    upstream.on("connection", (s) => upstreamSockets.add(s));
    upstreamPort = await listen(upstream);
    // the proxy needs to know its own port for the Host check: reserve one, then create it there
    const probe = net.createServer();
    proxyPort = await listen(probe);
    await new Promise((r) => probe.close(r));
    proxy = createProxy(
      parseOptions([
        "--target",
        `http://127.0.0.1:${upstreamPort}`,
        "--port",
        String(proxyPort),
      ]),
    );
    await new Promise<void>((r) =>
      proxy.listen(proxyPort, "127.0.0.1", () => r()),
    );
  });
  afterAll(async () => {
    // keep-alive connections of the test's own requests would keep the servers open
    proxy.closeAllConnections();
    sockets.forEach((s) => s.destroy());
    upstream.closeAllConnections();
    upstreamSockets.forEach((s) => s.destroy());
    await new Promise((r) => proxy.close(r));
    await new Promise((r) => upstream.close(r));
  });

  const get = (path: string, headers: Record<string, string> = {}) =>
    new Promise<{
      status: number;
      headers: http.IncomingHttpHeaders;
      body: string;
    }>((resolve, reject) => {
      http
        .get(
          {
            host: "127.0.0.1",
            port: proxyPort,
            path,
            headers: { host: `127.0.0.1:${proxyPort}`, ...headers },
          },
          (res) => {
            let body = "";
            res.on("data", (c) => (body += c));
            res.on("end", () =>
              resolve({ status: res.statusCode!, headers: res.headers, body }),
            );
          },
        )
        .on("error", reject);
    });

  it("adds the bridge to JupyterLite's page and lets Trazo embed it", async () => {
    const r = await get("/lab?token=abc");
    expect(r.status).toBe(200);
    expect(r.body).toContain("/trazo-bridge.js");
    expect(r.headers["x-frame-options"]).toBeUndefined();
    expect(r.headers["content-security-policy"]).toContain(
      "frame-ancestors 'self' http://localhost:3000 http://127.0.0.1:3000",
    );
    expect(r.headers["content-security-policy"]).toContain("report-uri /csp");
    expect(Number(r.headers["content-length"])).toBe(Buffer.byteLength(r.body));
  });

  it("serves the bridge itself and passes other answers on untouched", async () => {
    const bridge = await get("/trazo-bridge.js");
    expect(bridge.status).toBe(200);
    expect(bridge.body).toContain("trazo-notebook/1");
    const api = await get("/api/data");
    expect(api.body).toBe('{"ok":true}');
    expect((await get("/nope")).status).toBe(404);
  });

  it("passes Jupyter's own authentication on as it came, and adds none", async () => {
    seen.length = 0;
    await get("/api/data", {
      authorization: "token secret",
      origin: `http://127.0.0.1:${proxyPort}`,
    });
    expect(seen[0].auth).toBe("token secret");
    expect(seen[0].host).toBe(`127.0.0.1:${proxyPort}`);
    expect(seen[0].origin).toBe(`http://127.0.0.1:${proxyPort}`);
    seen.length = 0;
    await get("/api/data");
    expect(seen[0].auth).toBeUndefined();
  });

  it("answers nothing to a request for another name (DNS rebinding)", async () => {
    const r = await get("/lab", { host: "evil.example.com" });
    expect(r.status).toBe(421);
    expect(r.body).not.toContain("lab");
    const withPort = await get("/lab", {
      host: `evil.example.com:${proxyPort}`,
    });
    expect(withPort.status).toBe(421);
  });

  it("is a 502 when Jupyter is not there", async () => {
    const dead = createProxy(
      parseOptions([
        "--target",
        "http://127.0.0.1:9",
        "--port",
        String(proxyPort + 1),
      ]),
    );
    await new Promise<void>((r) =>
      dead.listen(proxyPort + 1, "127.0.0.1", () => r()),
    );
    const status = await new Promise<number>((resolve) =>
      http.get(
        {
          host: "127.0.0.1",
          port: proxyPort + 1,
          path: "/lab",
          headers: { host: `127.0.0.1:${proxyPort + 1}` },
        },
        (res) => {
          res.resume();
          resolve(res.statusCode!);
        },
      ),
    );
    dead.closeAllConnections();
    await new Promise((r) => dead.close(r));
    expect(status).toBe(502);
  });

  it("lets go of Jupyter when the browser goes away", async () => {
    const before = new Set(upstreamSockets);
    await new Promise<void>((resolve, reject) => {
      const socket = net.connect(proxyPort, "127.0.0.1", () => {
        socket.write(
          `GET /api/kernels/2/channels HTTP/1.1\r\nHost: 127.0.0.1:${proxyPort}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`,
        );
      });
      socket.on("data", (d) => {
        if (d.toString().includes("101")) {
          socket.destroy(); // the tab is closed
          resolve();
        }
      });
      socket.on("error", reject);
    });
    await new Promise((r) => setTimeout(r, 400));
    const alive = [...upstreamSockets].filter(
      (s) => !before.has(s) && !s.destroyed,
    );
    expect(alive).toHaveLength(0);
  });

  it("passes WebSocket upgrades through, both ways", async () => {
    const reply = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(proxyPort, "127.0.0.1", () => {
        socket.write(
          `GET /api/kernels/1/channels HTTP/1.1\r\nHost: 127.0.0.1:${proxyPort}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: x\r\nSec-WebSocket-Version: 13\r\n\r\n`,
        );
      });
      let got = "";
      let sent = false;
      socket.on("data", (d) => {
        got += d.toString();
        if (!sent && got.includes("101 Switching Protocols")) {
          sent = true;
          socket.write("hello kernel");
        }
        if (got.includes("HELLO KERNEL")) {
          socket.destroy();
          resolve(got);
        }
      });
      socket.on("error", reject);
      setTimeout(() => reject(new Error(`no answer: ${got}`)), 4000);
    });
    expect(reply).toContain("HELLO KERNEL");
  });

  it("refuses an upgrade for another name", async () => {
    const reply = await new Promise<string>((resolve) => {
      const socket = net.connect(proxyPort, "127.0.0.1", () => {
        socket.write(
          "GET /x HTTP/1.1\r\nHost: evil.example.com\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n",
        );
      });
      let got = "";
      socket.on("data", (d) => (got += d.toString()));
      socket.on("close", () => resolve(got));
      socket.on("error", () => resolve(got));
    });
    expect(reply).toContain("421");
  });
});
