// Runs the Trazo MCP server over stdio (one JSON message per line) in the folder TRAZO_DIR (default /work).
// Built into one file with esbuild by Dockerfile.mcp. Logs go to stderr: stdout is only for the protocol.
import { mkdir, open, readdir, rename, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";

import { SERVER_NAME, SERVER_VERSION, createServer } from "./server";

import type { Files } from "./server";

const dir = resolve(process.env.TRAZO_DIR || "/work");
const MAX_READ = 5 * 1024 * 1024;

/** a path inside the folder, whatever the name says */
const inside = (name: string) => {
  const p = resolve(join(dir, name));
  if (p !== dir && !p.startsWith(dir + sep)) {
    throw new Error("That name points outside the folder.");
  }
  return p;
};

const files: Files = {
  list: async () => (await readdir(dir)).sort(),
  read: async (name) => {
    const p = inside(name);
    // one handle for both the size check and the read, so the file cannot change in between
    const handle = await open(p, "r");
    try {
      if ((await handle.stat()).size > MAX_READ) {
        throw new Error(`${name} is too big (over 5 MB).`);
      }
      return await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  },
  write: async (name, text) => {
    const p = inside(name);
    await mkdir(dir, { recursive: true });
    // written next to the target and moved into place, so a crash never leaves half a file
    const tmp = `${p}.${process.pid}.tmp`;
    await writeFile(tmp, text, "utf8");
    await rename(tmp, p);
  },
};

const handle = createServer(files);
const send = (message: unknown) =>
  process.stdout.write(`${JSON.stringify(message)}\n`);

const rl = createInterface({ input: process.stdin });
let pending = Promise.resolve();
rl.on("line", (raw) => {
  // Windows PowerShell puts a byte order mark in front of what it pipes; clients do not, but be kind to a person testing
  const line = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  if (!line.trim()) {
    return;
  }
  // answered in order, one at a time
  pending = pending.then(async () => {
    let req;
    try {
      req = JSON.parse(line);
    } catch (e) {
      send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      return;
    }
    const res = await handle(req);
    if (res) {
      send(res);
    }
  });
});
rl.on("close", () => {
  void pending.then(() => process.exit(0));
});
process.stderr.write(
  `${SERVER_NAME} MCP ${SERVER_VERSION} ready, folder ${dir}\n`,
);
