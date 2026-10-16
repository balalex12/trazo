import { createHash } from "node:crypto";

// @ts-expect-error plain ES module, not part of the typechecked sources
import { buildCsp, closure, inlineScriptHashes } from "./build-jupyterlite.mjs";

describe("closure", () => {
  const lock = {
    pandas: { depends: ["numpy", "python-dateutil"] },
    numpy: { depends: [] },
    "python-dateutil": { depends: ["six"] },
    six: { depends: [] },
    ipython: { depends: ["prompt_toolkit"] },
    "prompt-toolkit": { depends: ["wcwidth"] },
    wcwidth: { depends: [] },
    scipy: { depends: ["numpy"] },
  };

  it("keeps what was asked for and, recursively, what it depends on", () => {
    expect([...closure(lock, ["pandas"])].sort()).toEqual([
      "numpy",
      "pandas",
      "python-dateutil",
      "six",
    ]);
  });

  it("matches dependency names spelled differently from the keys", () => {
    expect(closure(lock, ["ipython"])).toEqual(
      new Set(["ipython", "prompt-toolkit", "wcwidth"]),
    );
  });

  it("ignores names that are not in the lock", () => {
    expect(closure(lock, ["nope"]).size).toBe(0);
  });
});

describe("inlineScriptHashes / buildCsp", () => {
  const sha = (s: string) =>
    `'sha256-${createHash("sha256").update(s).digest("base64")}'`;

  it("hashes inline scripts, not external ones or JSON data", () => {
    const html = `<script src="a.js"></script>
      <script type="application/json" id="d">{"a":1}</script>
      <script>window.x = 1;</script>`;
    expect(inlineScriptHashes(html)).toEqual([sha("window.x = 1;")]);
  });

  it("allows no origin but itself, and the hashes it was given", () => {
    const csp = buildCsp([sha("a"), sha("a"), sha("b")]);
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self' data: blob:");
    expect(csp).not.toMatch(/https?:\/\/(?!localhost:3000|127\.0\.0\.1:3000)/);
    expect(csp.match(/sha256-/g)).toHaveLength(2);
    expect(
      csp.split("; ").find((d: string) => d.startsWith("script-src")),
    ).not.toContain("'unsafe-inline'");
  });
});
