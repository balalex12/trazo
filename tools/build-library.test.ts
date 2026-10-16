// The library of anything that is published (a release, an image) is built with --profile=public: it must not carry
// the Esri Calcite glyphs, whose redistribution is not settled (docs/LIBRARIES.md). It needs no download, so the test
// builds it offline into a temporary file.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const build = (out: string, args: string[] = []) =>
  spawnSync(process.execPath, ["tools/build-library.js", ...args], {
    encoding: "utf8",
    env: { ...process.env, LIBRARY_OUT: out, LIBRARY_OFFLINE: "1" },
  });

describe("the public library profile", () => {
  it("has no Calcite glyph and keeps the official icons, the containers and Trazo's own packs", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "trazo-lib-"));
    try {
      const out = path.join(dir, "public.excalidrawlib");
      const r = build(out, ["--profile=public"]);
      expect(r.status, r.stderr).toBe(0);
      const lib = JSON.parse(readFileSync(out, "utf8"));
      const sections = new Set(
        lib.libraryItems.map((i: { name: string }) => i.name.split(" / ")[0]),
      );
      expect([...sections].filter((s) => /calcite/i.test(s))).toEqual([]);
      expect(sections.has("Interactive ArcGIS Maps")).toBe(true);
      expect(sections.has("Esri Architecture Center · General")).toBe(true);
      expect(sections.has("Trazo · Data Engineering")).toBe(true);
      // the containers are still there, as a box and a title without the glyph
      const container = lib.libraryItems.find(
        (i: { name: string }) =>
          i.name ===
          "Esri Architecture Center · Containers & Labels / Data Center",
      );
      expect(container.elements.map((e: { type: string }) => e.type)).toEqual([
        "rectangle",
        "text",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
