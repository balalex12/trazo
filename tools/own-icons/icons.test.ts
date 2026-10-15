// @ts-expect-error plain CommonJS module, not part of the typechecked sources
import { sections } from "./icons.cjs";

type Icon = { name: string; svg: string };
const all: (Icon & { pack: string })[] = sections.flatMap(
  (s: { key: string; icons: Icon[] }) =>
    s.icons.map((i) => ({ ...i, pack: s.key })),
);

describe("own icon packs", () => {
  it("has the three packs, each with a real set of icons", () => {
    expect(sections.map((s: { key: string }) => s.key)).toEqual([
      "gis",
      "data",
      "ml",
    ]);
    for (const s of sections) {
      expect(s.icons.length).toBeGreaterThanOrEqual(15);
      expect(s.title).toMatch(/^Trazo · /);
    }
  });

  it("names every icon once, so search finds exactly one", () => {
    const names = all.map((i) => i.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it("names the tools it stands for in the item names (so search finds them)", () => {
    const names = all.map((i) => i.name).join("|");
    expect(names).toMatch(/FME/);
    expect(names).toMatch(/GeoPandas/);
    expect(names).toMatch(/GDAL/);
  });

  it("draws well-formed, self-contained SVG on the 64 grid", () => {
    for (const i of all) {
      const doc = new DOMParser().parseFromString(i.svg, "image/svg+xml");
      expect([i.name, doc.querySelector("parsererror")]).toEqual([
        i.name,
        null,
      ]);
      expect(doc.documentElement.getAttribute("viewBox")).toBe("0 0 64 64");
      // nothing that loads or runs anything: a glyph is only shapes
      expect(i.svg).not.toMatch(
        /<script|<image|<foreignObject|href=|url\(|https?:\/\/(?!www\.w3\.org\/2000\/svg)/i,
      );
      expect(
        doc.querySelectorAll("path,rect,circle,ellipse,line").length,
      ).toBeGreaterThan(1);
    }
  });

  it("keeps every coordinate on the canvas", () => {
    for (const i of all) {
      const nums = [
        ...i.svg.matchAll(/\b(?:x|y|cx|cy|x1|x2|y1|y2)="(-?[\d.]+)"/g),
      ].map((m) => Number(m[1]));
      for (const v of nums) {
        expect([i.name, v >= -2 && v <= 66]).toEqual([i.name, true]);
      }
    }
  });
});
