#!/usr/bin/env node
// Trazo CLI bridge (optional, advanced, off unless you start or install it).
//
// Lets "Text to diagram" use the Claude Code or Codex CLI that YOU already have installed and signed in to, instead
// of an API key. It is a small local web server that runs the CLI in its non-interactive mode and returns the answer.
//
//   node tools/cli-bridge.mjs --install     # once: starts now and at every login, hidden, then opens Trazo paired
//   node tools/cli-bridge.mjs --uninstall   # stops it and removes the autostart
//   node tools/cli-bridge.mjs               # or just run it in this terminal (Ctrl+C stops it)
//   node tools/cli-bridge.mjs --link        # prints (and with --open, opens) the link that pairs Trazo with it
//   node tools/cli-bridge.mjs --status | --rotate | --help
//
// What it does NOT do: it never reads, stores or forwards your credentials (the CLI keeps its own login), it has no
// shell, and the CLI is started with no tools (it cannot read files or run commands). Read docs/CLI_BRIDGE.md,
// including the note about the providers' terms, before using it.
//
// Safety rules, all enforced below:
//  - listens on 127.0.0.1 only
//  - every request needs an allowed Origin (no other web page can use it) and a local Host header (blocks DNS
//    rebinding); everything except /hello also needs the random token (Authorization: Bearer ...)
//  - the token lives in ~/.trazo/bridge.json (owner only) so it survives restarts; --rotate replaces it
//  - the command line of the CLI is a constant: nothing from the browser ever reaches an argument, the prompt goes
//    through stdin
//  - one run at a time, request size and time are limited
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const VERSION = 1;
export const MAX_BODY = 1024 * 1024;
export const RUN_TIMEOUT_MS = 180_000;
export const TOOLS = ["claude", "codex"];
export const DEFAULT_PORT = 11500;
export const DEFAULT_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];

const isWin = process.platform === "win32";
const SCRIPT = fileURLToPath(import.meta.url);

// ---- where the bridge keeps its few files --------------------------------------------------------------------------

export const confDir = (env = process.env) =>
  env.TRAZO_BRIDGE_HOME || join(homedir(), ".trazo");

/** the token, from the environment or from the owner-only file (created on first use). `rotate` makes a new one. */
export const loadToken = ({ rotate = false, env = process.env } = {}) => {
  if (env.TRAZO_BRIDGE_TOKEN) {
    return env.TRAZO_BRIDGE_TOKEN;
  }
  const dir = confDir(env);
  const file = join(dir, "bridge.json");
  if (!rotate && existsSync(file)) {
    try {
      const t = JSON.parse(readFileSync(file, "utf8")).token;
      if (typeof t === "string" && t.length >= 32) {
        return t;
      }
    } catch {
      /* unreadable: make a new one */
    }
  }
  const token = randomBytes(24).toString("hex");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(
    file,
    JSON.stringify({ token, createdAt: new Date().toISOString() }, null, 2),
    { mode: 0o600 },
  );
  return token;
};

/** the link that opens Trazo and hands it the token. The part after # never goes to any server. */
export const pairLink = ({ token, port, origins }) => {
  const base = origins[0] || DEFAULT_ORIGINS[0];
  const extra =
    port === DEFAULT_PORT
      ? ""
      : `&url=${encodeURIComponent(`http://127.0.0.1:${port}`)}`;
  return `${base}/#bridge=${token}${extra}`;
};

// ---- finding the program ----------------------------------------------------------------------------------------

/** the real program for `name` on PATH. On Windows npm installs a .cmd shim: the real .exe is read from it. */
export const findProgram = (name, env = process.env) => {
  const dirs = (env.PATH || env.Path || "").split(delimiter).filter(Boolean);
  const exts = isWin ? [".exe", ".cmd", ""] : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const file = join(dir, name + ext);
      if (!existsSync(file)) {
        continue;
      }
      if (!isWin || ext === ".exe") {
        return file;
      }
      if (ext === ".cmd") {
        // npm shim: "%dp0%\node_modules\...\name.exe" %*
        const m = /"%dp0%\\([^"]+?\.exe)"/i.exec(readFileSync(file, "utf8"));
        const exe = m && join(dirname(file), m[1]);
        if (exe && existsSync(exe)) {
          return exe;
        }
      }
    }
  }
  return null;
};

// ---- the two CLIs: constant arguments, prompt on stdin ----------------------------------------------------------

const CLAUDE_ARGS = [
  "-p",
  "--tools",
  "",
  "--no-session-persistence",
  "--output-format",
  "json",
  "--system-prompt",
  "You answer exactly as the user's message asks and add nothing else.",
];

const CODEX_ARGS = (outFile) => [
  "exec",
  "--skip-git-repo-check",
  "--sandbox",
  "read-only",
  "--ephemeral",
  "-o",
  outFile,
  "-",
];

/**
 * Credentials in the environment that make Claude Code ignore your subscription login. In `claude -p` an
 * ANTHROPIC_API_KEY is "always used when present", which would bill an API account instead of your plan.
 * They are removed from the CLI's environment unless you start the bridge with --keep-env-auth.
 */
export const AUTH_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
];

export const childEnv = (env, keepAuth = false) => {
  const out = { ...env };
  delete out.TRAZO_BRIDGE_TOKEN;
  if (!keepAuth) {
    for (const k of AUTH_ENV) {
      delete out[k];
    }
  }
  return out;
};

/** the user message the CLI receives: the app's instructions first, then the conversation */
export const buildPrompt = (system, messages) =>
  [
    system ? `INSTRUCTIONS:\n${system}` : "",
    ...messages.map(
      (m) => `${m.role === "assistant" ? "ASSISTANT" : "USER"}:\n${m.content}`,
    ),
  ]
    .filter(Boolean)
    .join("\n\n");

/** the answer (and which model made it, and the list-price estimate) from the JSON `claude -p --output-format json` prints */
export const parseClaudeOutput = (stdout) => {
  let j;
  try {
    j = JSON.parse(stdout);
  } catch {
    throw new Error("Claude Code printed something that is not JSON.");
  }
  if (j.is_error) {
    throw new Error(
      `Claude Code reported an error: ${String(j.result || j.subtype || "unknown").slice(0, 300)}`,
    );
  }
  if (typeof j.result !== "string" || !j.result.trim()) {
    throw new Error("Claude Code returned an empty answer.");
  }
  const model = Object.keys(j.modelUsage || {})[0];
  return {
    text: j.result,
    ...(model ? { model } : {}),
    ...(typeof j.total_cost_usd === "number" ? { costUsd: j.total_cost_usd } : {}),
  };
};

const runProcess = (file, args, input, cwd, env, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`The CLI took longer than ${timeoutMs / 1000} s.`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not start the CLI: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });

/** runs one CLI; resolves to { text, model?, costUsd? } */
export const runTool = async (
  tool,
  prompt,
  { timeoutMs = RUN_TIMEOUT_MS, keepAuth = false } = {},
) => {
  const file = findProgram(tool);
  if (!file) {
    throw new Error(
      `${tool} was not found on this computer's PATH. Install it and sign in first.`,
    );
  }
  const env = childEnv(process.env, keepAuth);
  // an empty folder: no project files, no CLAUDE.md or AGENTS.md picked up
  const dir = mkdtempSync(join(tmpdir(), "trazo-bridge-"));
  try {
    if (tool === "claude") {
      const r = await runProcess(file, CLAUDE_ARGS, prompt, dir, env, timeoutMs);
      if (r.code !== 0 && !r.stdout.trim()) {
        throw new Error(
          `Claude Code exited with code ${r.code}. ${r.stderr.slice(0, 300)}`,
        );
      }
      return parseClaudeOutput(r.stdout);
    }
    const out = join(dir, "answer.txt");
    const r = await runProcess(file, CODEX_ARGS(out), prompt, dir, env, timeoutMs);
    if (!existsSync(out)) {
      throw new Error(
        `Codex exited with code ${r.code} and wrote no answer. ${r.stderr.slice(0, 300)}`,
      );
    }
    const text = readFileSync(out, "utf8").trim();
    if (!text) {
      throw new Error("Codex returned an empty answer.");
    }
    return { text };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// ---- the server ---------------------------------------------------------------------------------------------------

const same = (a, b) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export const createBridge = ({
  token,
  origins,
  port,
  run = runTool,
  tools = TOOLS,
  log = console.log,
  onShutdown = () => {},
}) => {
  let busy = false;
  const localHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const toolStatus = () =>
    Object.fromEntries(tools.map((t) => [t, !!findProgram(t)]));

  const send = (res, status, body, origin) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(origin
        ? {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers": "authorization, content-type",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Private-Network": "true",
            Vary: "Origin",
          }
        : {}),
    });
    res.end(JSON.stringify(body));
  };

  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    const allowed = origin && origins.includes(origin) ? origin : undefined;
    if (!localHosts.has(String(req.headers.host))) {
      return send(res, 403, { error: "Bad Host header." });
    }
    if (!allowed) {
      return send(res, 403, { error: "This origin is not allowed." });
    }
    if (req.method === "OPTIONS") {
      return send(res, 204, {}, allowed);
    }
    // the only thing answered without the token: that a bridge is here and which CLIs it found (allowed origins only)
    if (req.method === "GET" && req.url === "/hello") {
      return send(
        res,
        200,
        { bridge: "trazo-cli-bridge", version: VERSION, tools: toolStatus() },
        allowed,
      );
    }
    const auth = String(req.headers.authorization || "");
    if (!auth.startsWith("Bearer ") || !same(auth.slice(7), token)) {
      return send(res, 401, { error: "Missing or wrong token." }, allowed);
    }
    if (req.method === "GET" && req.url === "/health") {
      return send(res, 200, { ok: true, tools: toolStatus() }, allowed);
    }
    if (req.method === "POST" && req.url === "/shutdown") {
      send(res, 200, { ok: true }, allowed);
      setTimeout(onShutdown, 100);
      return;
    }
    if (req.method !== "POST" || req.url !== "/run") {
      return send(res, 404, { error: "Not found." }, allowed);
    }
    let body = "";
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) {
        return send(res, 413, { error: "Request too large." }, allowed);
      }
      body += chunk;
    }
    let input;
    try {
      input = JSON.parse(body);
    } catch {
      return send(res, 400, { error: "Body must be JSON." }, allowed);
    }
    const messages = Array.isArray(input.messages)
      ? input.messages.filter(
          (m) => m && typeof m.content === "string" && typeof m.role === "string",
        )
      : [];
    if (!tools.includes(input.tool) || !messages.length) {
      return send(
        res,
        400,
        { error: `Need "tool" (${tools.join(" or ")}) and "messages".` },
        allowed,
      );
    }
    if (busy) {
      return send(res, 429, { error: "Another request is still running." }, allowed);
    }
    busy = true;
    const started = Date.now();
    try {
      const prompt = buildPrompt(
        typeof input.system === "string" ? input.system : "",
        messages,
      );
      const result = await run(input.tool, prompt);
      log(
        `${input.tool} ok${result.model ? ` (${result.model})` : ""} ${prompt.length} chars in, ${result.text.length} out, ${Date.now() - started} ms`,
      );
      return send(res, 200, { ...result, tool: input.tool }, allowed);
    } catch (e) {
      log(`${input.tool} failed: ${e.message}`);
      return send(res, 502, { error: e.message }, allowed);
    } finally {
      busy = false;
    }
  });
};

// ---- starting at login (no terminal left open) ---------------------------------------------------------------------

const quote = (s) =>
  `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** the file that makes the OS start the bridge at login, for each platform (pure, tested) */
export const startupFile = (platform, { node, script, args }, env = process.env) => {
  const home = homedir();
  if (platform === "win32") {
    const dir =
      env.TRAZO_STARTUP_DIR ||
      join(env.APPDATA || join(home, "AppData", "Roaming"), "Microsoft", "Windows", "Start Menu", "Programs", "Startup");
    const cmd = [node, script, ...args].map((p) => `""${p}""`).join(" ");
    return {
      path: join(dir, "Trazo CLI Bridge.vbs"),
      content: [
        "' Trazo CLI bridge, started hidden at login. Remove it with: node tools/cli-bridge.mjs --uninstall",
        `CreateObject("WScript.Shell").Run "${cmd}", 0, False`,
        "",
      ].join("\r\n"),
    };
  }
  if (platform === "darwin") {
    const dir = env.TRAZO_STARTUP_DIR || join(home, "Library", "LaunchAgents");
    const items = [node, script, ...args]
      .map((p) => `    <string>${String(p).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</string>`)
      .join("\n");
    return {
      path: join(dir, "com.trazo.cli-bridge.plist"),
      content: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.trazo.cli-bridge</string>
  <key>ProgramArguments</key>
  <array>
${items}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
`,
    };
  }
  const dir = env.TRAZO_STARTUP_DIR || join(home, ".config", "systemd", "user");
  return {
    path: join(dir, "trazo-cli-bridge.service"),
    content: `[Unit]
Description=Trazo CLI bridge (127.0.0.1 only)

[Service]
ExecStart=${[node, script, ...args].map(quote).join(" ")}
Restart=on-failure

[Install]
WantedBy=default.target
`,
  };
};

const sh = (cmd, args) => spawnSync(cmd, args, { stdio: "ignore", shell: false });

const startDetached = (args) => {
  const child = spawn(process.execPath, [SCRIPT, ...args], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
};

const openUrl = (url) => {
  const [cmd, args] = isWin
    ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
    : process.platform === "darwin"
      ? ["open", [url]]
      : ["xdg-open", [url]];
  const child = spawn(cmd, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => {});
  child.unref();
};

/** a plain HTTP call to a bridge on this machine, as an allowed page would make it */
const callBridge = (port, origin, path, { method = "GET", token } = {}) =>
  new Promise((resolve) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        timeout: 2000,
        headers: {
          Host: `127.0.0.1:${port}`,
          Origin: origin,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(d) });
          } catch {
            resolve({ status: res.statusCode, body: null });
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });

// ---- command line -----------------------------------------------------------------------------------------------

const HELP = `Trazo CLI bridge

  node tools/cli-bridge.mjs               run it in this terminal (Ctrl+C stops it)
  node tools/cli-bridge.mjs --install     start it now and at every login, hidden; then open Trazo paired
  node tools/cli-bridge.mjs --uninstall   stop it and remove the autostart
  node tools/cli-bridge.mjs --status      is it installed, is it running, which CLIs does it see
  node tools/cli-bridge.mjs --link        print the link that pairs Trazo with it (add --open to open it)
  node tools/cli-bridge.mjs --rotate      make a new token (then pair again with --link)

  --port 11500            port on 127.0.0.1
  --origin URL            page allowed to use the bridge (repeat it); default ${DEFAULT_ORIGINS.join(" and ")}
  --keep-env-auth         let the CLI see ANTHROPIC_API_KEY and similar (default: removed, so your plan is used)
  --no-open               with --install: do not open the browser`;

const main = async () => {
  const args = process.argv.slice(2);
  const has = (f) => args.includes(f);
  const opt = (name) => {
    const out = [];
    args.forEach((a, i) => a === name && args[i + 1] && out.push(args[i + 1]));
    return out;
  };
  if (has("--help") || has("-h")) {
    console.log(HELP);
    return;
  }
  const port = Number(opt("--port")[0] || process.env.TRAZO_BRIDGE_PORT || DEFAULT_PORT);
  const origins = opt("--origin").length ? opt("--origin") : DEFAULT_ORIGINS;
  const keepAuth = has("--keep-env-auth");
  const dir = confDir();
  const logFile = join(dir, "bridge.log");
  const background = has("--background");
  // the arguments the autostart entry will pass (without the action flags)
  const runArgs = [
    "--background",
    "--port",
    String(port),
    ...origins.flatMap((o) => ["--origin", o]),
    ...(keepAuth ? ["--keep-env-auth"] : []),
  ];

  const log = (msg) => {
    const line = `${new Date().toISOString()} ${msg}`;
    if (!background) {
      console.log(line);
    }
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      appendFileSync(logFile, `${line}\n`);
    } catch {
      /* logging is best effort */
    }
  };

  if (has("--rotate")) {
    const old = loadToken();
    const running = await callBridge(port, origins[0], "/shutdown", { method: "POST", token: old });
    const token = loadToken({ rotate: true });
    console.log(running?.status === 200 ? "Stopped the running bridge." : "No bridge was running.");
    console.log("New token saved. Pair Trazo again with:");
    console.log(`  ${pairLink({ token, port, origins })}`);
    if (existsSync(startupFile(process.platform, { node: process.execPath, script: SCRIPT, args: runArgs }).path)) {
      if (isWin) {
        startDetached(runArgs);
      } else if (process.platform === "linux") {
        sh("systemctl", ["--user", "restart", "trazo-cli-bridge.service"]);
      }
      console.log("The autostart bridge was restarted with the new token.");
    }
    return;
  }

  if (has("--link")) {
    const link = pairLink({ token: loadToken(), port, origins });
    console.log(link);
    if (has("--open")) {
      openUrl(link);
    }
    return;
  }

  if (has("--install")) {
    const entry = startupFile(process.platform, { node: process.execPath, script: SCRIPT, args: runArgs });
    mkdirSync(dirname(entry.path), { recursive: true });
    writeFileSync(entry.path, entry.content);
    console.log(`Autostart entry written: ${entry.path}`);
    if (!process.env.TRAZO_STARTUP_DIR) {
      if (isWin) {
        startDetached(runArgs);
      } else if (process.platform === "darwin") {
        sh("launchctl", ["load", "-w", entry.path]);
      } else {
        sh("systemctl", ["--user", "daemon-reload"]);
        sh("systemctl", ["--user", "enable", "--now", "trazo-cli-bridge.service"]);
      }
    }
    const link = pairLink({ token: loadToken(), port, origins });
    console.log("The bridge now starts by itself at login. Nothing else needs to stay open.");
    console.log("Pair Trazo (the token is in the part after #, which never leaves your computer):");
    console.log(`  ${link}`);
    if (!has("--no-open") && !process.env.TRAZO_STARTUP_DIR) {
      openUrl(link);
    }
    return;
  }

  if (has("--uninstall")) {
    const entry = startupFile(process.platform, { node: process.execPath, script: SCRIPT, args: runArgs });
    if (process.platform === "darwin") {
      sh("launchctl", ["unload", entry.path]);
    } else if (process.platform === "linux" && !process.env.TRAZO_STARTUP_DIR) {
      sh("systemctl", ["--user", "disable", "--now", "trazo-cli-bridge.service"]);
    }
    const running = await callBridge(port, origins[0], "/shutdown", { method: "POST", token: loadToken() });
    rmSync(entry.path, { force: true });
    console.log(`Autostart entry removed (${entry.path}).`);
    console.log(running?.status === 200 ? "The running bridge was stopped." : "No bridge was running.");
    return;
  }

  if (has("--status")) {
    const entry = startupFile(process.platform, { node: process.execPath, script: SCRIPT, args: runArgs });
    const hello = await callBridge(port, origins[0], "/hello");
    console.log(`Autostart : ${existsSync(entry.path) ? `installed (${entry.path})` : "not installed"}`);
    console.log(`Running   : ${hello?.body?.bridge ? `yes, on 127.0.0.1:${port}` : "no"}`);
    for (const t of TOOLS) {
      console.log(`${t.padEnd(10)}: ${findProgram(t) ? "found" : "not found"}`);
    }
    try {
      if (existsSync(logFile)) {
        console.log(`Log       : ${logFile} (${Math.round(statSync(logFile).size / 1024)} KB)`);
      }
    } catch {
      /* ignore */
    }
    return;
  }

  // ---- run the server
  const token = loadToken();
  try {
    if (existsSync(logFile) && statSync(logFile).size > 512 * 1024) {
      rmSync(logFile, { force: true });
    }
  } catch {
    /* ignore */
  }
  let server;
  server = createBridge({
    token,
    origins,
    port,
    log,
    run: (tool, prompt) => runTool(tool, prompt, { keepAuth }),
    onShutdown: () => server.close(() => process.exit(0)),
  });
  server.on("error", async (e) => {
    if (e.code === "EADDRINUSE") {
      const hello = await callBridge(port, origins[0], "/hello");
      console.error(
        hello?.body?.bridge
          ? `A Trazo CLI bridge is already running on 127.0.0.1:${port}. Nothing to do.`
          : `Port ${port} is used by something else. Use --port to choose another.`,
      );
      process.exit(hello?.body?.bridge ? 0 : 1);
    }
    console.error(`Could not listen on 127.0.0.1:${port}: ${e.message}`);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => {
    log(`bridge started on 127.0.0.1:${port}, allowed: ${origins.join(", ")}`);
    if (!background) {
      console.log("Trazo CLI bridge is running (Ctrl+C stops it).");
      console.log(`  Address : http://127.0.0.1:${port}`);
      console.log(`  Allowed : ${origins.join(", ")}`);
      for (const t of TOOLS) {
        console.log(`  ${t.padEnd(7)} : ${findProgram(t) ? "found" : "not found"}`);
      }
      console.log(`  Pair Trazo with this link (the token is after #, it never leaves your computer):`);
      console.log(`  ${pairLink({ token, port, origins })}`);
      console.log("  To skip the terminal next time: node tools/cli-bridge.mjs --install");
    }
  });
};

if (process.argv[1] && SCRIPT === process.argv[1]) {
  main();
}
