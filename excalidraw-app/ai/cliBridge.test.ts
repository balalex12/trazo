// The CLI bridge is a plain Node script (tools/cli-bridge.mjs); these tests start its server with a fake CLI.
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// @ts-ignore a plain .mjs file without types
import * as bridge from "../../tools/cli-bridge.mjs";

const b = bridge as any;
const TOKEN = "t".repeat(48);
const ORIGIN = "http://localhost:3000";

type Res = { status: number; headers: http.IncomingHttpHeaders; body: any };
const call = (
  port: number,
  method: string,
  path: string,
  opts: { headers?: Record<string, string>; body?: string; host?: string } = {},
) =>
  new Promise<Res>((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path,
        headers: { Host: opts.host || `127.0.0.1:${port}`, ...opts.headers },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body: d ? JSON.parse(d) : null,
          }),
        );
      },
    );
    req.on("error", reject);
    if (opts.body) {
      req.write(opts.body);
    }
    req.end();
  });

const good = {
  Origin: ORIGIN,
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
};
const ask = (content = "a to b") =>
  JSON.stringify({
    tool: "claude",
    system: "SYS",
    messages: [{ role: "user", content }],
  });

describe("bridge server", () => {
  let port = 0;
  let server: http.Server;
  let shutdowns = 0;
  const prompts: string[] = [];
  let release: (() => void) | null = null;

  beforeAll(async () => {
    port = 11600 + Math.floor(Math.random() * 300);
    server = b.createBridge({
      token: TOKEN,
      origins: [ORIGIN],
      port,
      log: () => {},
      onShutdown: () => shutdowns++,
      run: async (_tool: string, prompt: string) => {
        prompts.push(prompt);
        if (prompt.includes("SLOW")) {
          await new Promise<void>((r) => (release = r));
        }
        return {
          text: "flowchart LR\n A-->B",
          model: "fake-model",
          costUsd: 0.01,
        };
      },
    });
    await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  });
  afterAll(() => {
    server.close();
  });

  it("refuses a missing or foreign origin and a rebinding Host", async () => {
    expect((await call(port, "GET", "/hello")).status).toBe(403);
    expect(
      (
        await call(port, "GET", "/hello", {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(port, "GET", "/hello", {
          headers: good,
          host: `evil.example:${port}`,
        })
      ).status,
    ).toBe(403);
  });

  it("answers /hello without a token, but only to an allowed origin", async () => {
    const r = await call(port, "GET", "/hello", {
      headers: { Origin: ORIGIN },
    });
    expect(r.status).toBe(200);
    expect(r.body.bridge).toBe("trazo-cli-bridge");
    expect(r.headers["access-control-allow-origin"]).toBe(ORIGIN);
    // nothing else is answered without the token
    expect(
      (await call(port, "GET", "/health", { headers: { Origin: ORIGIN } }))
        .status,
    ).toBe(401);
    expect(
      (
        await call(port, "POST", "/run", {
          headers: { Origin: ORIGIN },
          body: ask(),
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await call(port, "GET", "/health", {
          headers: { ...good, Authorization: "Bearer nope" },
        })
      ).status,
    ).toBe(401);
  });

  it("answers the browser's preflight for an allowed origin", async () => {
    const r = await call(port, "OPTIONS", "/run", {
      headers: { Origin: ORIGIN },
    });
    expect(r.status).toBe(204);
    expect(r.headers["access-control-allow-origin"]).toBe(ORIGIN);
  });

  it("runs the CLI and returns the text, the model and the cost", async () => {
    const r = await call(port, "POST", "/run", {
      headers: good,
      body: ask("hello"),
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      text: "flowchart LR\n A-->B",
      model: "fake-model",
      tool: "claude",
    });
    expect(prompts.at(-1)).toBe("INSTRUCTIONS:\nSYS\n\nUSER:\nhello");
  });

  it("rejects a bad body and an unknown tool", async () => {
    expect(
      (await call(port, "POST", "/run", { headers: good, body: "{" })).status,
    ).toBe(400);
    const r = await call(port, "POST", "/run", {
      headers: good,
      body: JSON.stringify({
        tool: "bash",
        messages: [{ role: "user", content: "x" }],
      }),
    });
    expect(r.status).toBe(400);
  });

  it("does one run at a time", async () => {
    const first = call(port, "POST", "/run", {
      headers: good,
      body: ask("SLOW"),
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(
      (await call(port, "POST", "/run", { headers: good, body: ask() })).status,
    ).toBe(429);
    release?.();
    expect((await first).status).toBe(200);
  });

  it("stops when asked with the token", async () => {
    const r = await call(port, "POST", "/shutdown", { headers: good });
    expect(r.status).toBe(200);
    await new Promise((res) => setTimeout(res, 250));
    expect(shutdowns).toBe(1);
  });
});

describe("bridge helpers", () => {
  it("builds the prompt with the app's instructions first", () => {
    expect(
      b.buildPrompt("RULES", [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ]),
    ).toBe("INSTRUCTIONS:\nRULES\n\nUSER:\na\n\nASSISTANT:\nb");
    expect(b.buildPrompt("", [{ role: "user", content: "a" }])).toBe(
      "USER:\na",
    );
  });

  it("removes the credentials that would make Claude Code ignore the subscription", () => {
    const env = {
      PATH: "/bin",
      ANTHROPIC_API_KEY: "sk-x",
      ANTHROPIC_AUTH_TOKEN: "y",
      CLAUDE_CODE_USE_BEDROCK: "1",
      TRAZO_BRIDGE_TOKEN: "secret",
    };
    expect(b.childEnv(env)).toEqual({ PATH: "/bin" });
    // with --keep-env-auth the user's own variables stay (the bridge token never does)
    expect(b.childEnv(env, true)).toEqual({
      PATH: "/bin",
      ANTHROPIC_API_KEY: "sk-x",
      ANTHROPIC_AUTH_TOKEN: "y",
      CLAUDE_CODE_USE_BEDROCK: "1",
    });
  });

  it("reads the answer, the model and the cost out of Claude Code's JSON", () => {
    expect(
      b.parseClaudeOutput(
        JSON.stringify({
          result: "ok",
          total_cost_usd: 0.02,
          modelUsage: { "claude-sonnet-5-5": {} },
        }),
      ),
    ).toEqual({ text: "ok", model: "claude-sonnet-5-5", costUsd: 0.02 });
    expect(b.parseClaudeOutput(JSON.stringify({ result: "ok" }))).toEqual({
      text: "ok",
    });
    expect(() => b.parseClaudeOutput("nope")).toThrow(/not JSON/);
    expect(() =>
      b.parseClaudeOutput(JSON.stringify({ is_error: true, result: "boom" })),
    ).toThrow(/boom/);
    expect(() => b.parseClaudeOutput(JSON.stringify({ result: " " }))).toThrow(
      /empty/,
    );
  });

  it("keeps the token between runs and makes a new one on request", () => {
    const home = mkdtempSync(join(tmpdir(), "trazo-test-"));
    try {
      const env = { TRAZO_BRIDGE_HOME: home };
      const a = b.loadToken({ env });
      expect(a).toMatch(/^[0-9a-f]{48}$/);
      expect(b.loadToken({ env })).toBe(a);
      expect(
        JSON.parse(readFileSync(join(home, "bridge.json"), "utf8")).token,
      ).toBe(a);
      expect(statSync(join(home, "bridge.json")).isFile()).toBe(true);
      const c = b.loadToken({ env, rotate: true });
      expect(c).not.toBe(a);
      expect(b.loadToken({ env })).toBe(c);
      expect(
        b.loadToken({
          env: {
            TRAZO_BRIDGE_TOKEN: "from-env-1234567890123456789012",
            TRAZO_BRIDGE_HOME: home,
          },
        }),
      ).toBe("from-env-1234567890123456789012");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("builds the pairing link, with the address only when it is not the default", () => {
    const origins = [ORIGIN];
    expect(b.pairLink({ token: "abc", port: 11500, origins })).toBe(
      `${ORIGIN}/#bridge=abc`,
    );
    expect(b.pairLink({ token: "abc", port: 11555, origins })).toBe(
      `${ORIGIN}/#bridge=abc&url=${encodeURIComponent(
        "http://127.0.0.1:11555",
      )}`,
    );
  });
});

describe("start at login files", () => {
  const spec = {
    node: "C:\\Program Files\\nodejs\\node.exe",
    script: "C:\\trazo\\tools\\cli-bridge.mjs",
    args: ["--background", "--port", "11500", "--origin", ORIGIN],
  };
  const env = {
    TRAZO_STARTUP_DIR: "/startup",
    APPDATA: "C:\\Users\\me\\AppData\\Roaming",
  };

  it("Windows: a hidden script in the Startup folder with every part quoted", () => {
    const f = b.startupFile("win32", spec, env);
    expect(f.path.endsWith("Trazo CLI Bridge.vbs")).toBe(true);
    expect(f.content).toContain('CreateObject("WScript.Shell").Run "');
    expect(f.content).toContain('""C:\\Program Files\\nodejs\\node.exe""');
    expect(f.content).toContain('""--port"" ""11500""');
    expect(f.content).toContain(", 0, False"); // window style 0: hidden
  });

  it("macOS: a launch agent that runs at login and restarts", () => {
    const f = b.startupFile(
      "darwin",
      { ...spec, node: "/usr/bin/node", script: "/t/cli-bridge.mjs" },
      env,
    );
    expect(f.path.endsWith("com.trazo.cli-bridge.plist")).toBe(true);
    expect(f.content).toContain("<key>RunAtLoad</key><true/>");
    expect(f.content).toContain("<string>/t/cli-bridge.mjs</string>");
  });

  it("Linux: a user service", () => {
    const f = b.startupFile(
      "linux",
      { ...spec, node: "/usr/bin/node", script: "/t/cli-bridge.mjs" },
      env,
    );
    expect(f.path.endsWith("trazo-cli-bridge.service")).toBe(true);
    expect(f.content).toContain(
      'ExecStart="/usr/bin/node" "/t/cli-bridge.mjs" "--background"',
    );
    expect(f.content).toContain("WantedBy=default.target");
  });
});
