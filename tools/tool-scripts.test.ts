import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");

// A command line tool that decides wrongly that it was imported instead of started does nothing at all: no output,
// exit code 0. That is what happened on Windows, so each tool must at least answer when asked for help.
describe("command line tools run when started directly", () => {
  it("hyperframes-render prints its usage", () => {
    const r = spawnSync(
      process.execPath,
      [path.join(root, "tools", "hyperframes-render.mjs"), "--help"],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("hyperframes-render.mjs animation.html");
  });

  it("the file URL of a script started by path matches import.meta.url", async () => {
    // what the guards in the tools compare, written for a Windows path too
    const { pathToFileURL } = await import("node:url");
    expect(
      pathToFileURL("C:\\Users\\a b\\tools\\x.mjs", { windows: true }).href,
    ).toBe("file:///C:/Users/a%20b/tools/x.mjs");
    expect(
      pathToFileURL(path.join(root, "tools", "x.mjs")).href.startsWith(
        "file:///",
      ),
    ).toBe(true);
  });
});
