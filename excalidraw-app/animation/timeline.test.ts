import {
  DEFAULT_SETTINGS,
  buildScene,
  holdOf,
  sampleAt,
  totalDurationMs,
} from "./timeline";

import type { Slide } from "./timeline";

const settings = { ...DEFAULT_SETTINGS, transitionMs: 1000, holdMs: 2000 };

const el = (id: string, x: number, y: number, extra: object = {}) => ({
  id,
  type: "rectangle",
  x,
  y,
  width: 100,
  height: 50,
  angle: 0,
  opacity: 100,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  strokeWidth: 2,
  ...extra,
});

// frames sit at different places on the canvas; children are positioned relative to their own frame
const slide = (
  id: string,
  frameY: number,
  children: ReturnType<typeof el>[],
  customData?: object,
): Slide => ({
  frame: {
    id,
    type: "frame",
    x: 0,
    y: frameY,
    width: 400,
    height: 300,
    angle: 0,
    opacity: 100,
    customData,
  },
  name: id,
  children,
});

const byText = (els: any[], id: string) => els.filter((e) => e.id === id);

describe("per-slide timing", () => {
  it("uses each slide's own hold and falls back to the default", () => {
    const slides = [
      slide("a", 0, [], { holdMs: 6000 }),
      slide("b", 400, []),
      slide("c", 800, [], { holdMs: 500 }),
    ];
    expect(slides.map((s) => holdOf(s, settings))).toEqual([6000, 2000, 500]);
    expect(totalDurationMs(slides, settings)).toBe(6000 + 2000 + 500 + 2000);
  });

  it("a cut has no transition time and is never sampled as a blend", () => {
    const slides = [
      slide("a", 0, []),
      slide("b", 400, [], { transition: "cut" }),
    ];
    expect(totalDurationMs(slides, settings)).toBe(4000);
    // right after the first hold we are already on slide b
    expect(sampleAt(2001, slides, settings)).toEqual({ a: 1, b: 1, t: 0 });
  });
});

describe("transitions between slides", () => {
  it("elements that are identical in both slides never move, even without animKey", () => {
    const A = slide("a", 0, [el("a1", 20, 30)]);
    // copy/pasted content: new id, no animKey, same place relative to its frame
    const B = slide("b", 400, [el("b1", 20, 430)]);
    for (const p of [0, 0.25, 0.5, 0.9]) {
      const { elements } = buildScene(A, B, p);
      expect(elements).toHaveLength(1); // paired, not "fade out + fade in"
      expect(elements[0].x).toBe(20);
      expect(elements[0].y).toBe(30);
      expect(elements[0].opacity).toBe(100);
    }
  });

  it("smart: a matching element that changed position does move", () => {
    const A = slide("a", 0, [
      el("a1", 20, 30, { customData: { animKey: "k" } }),
    ]);
    const B = slide("b", 400, [
      el("b1", 220, 430, { customData: { animKey: "k" } }),
    ]);
    const { elements } = buildScene(A, B, 0.5);
    expect(elements).toHaveLength(1);
    expect(elements[0].x).toBeCloseTo(120);
  });

  it("fade: nothing moves, changed elements cross-fade in place", () => {
    const A = slide("a", 0, [
      el("still-a", 20, 30),
      el("a1", 20, 100, { customData: { animKey: "k" } }),
    ]);
    const B = slide(
      "b",
      400,
      [
        el("still-b", 20, 430),
        el("b1", 220, 500, { customData: { animKey: "k" } }),
      ],
      { transition: "fade" },
    );
    const { elements } = buildScene(A, B, 0.5);
    const xs = elements
      .map((e: any) => e.x)
      .sort((x: number, y: number) => x - y);
    // the unchanged one once, the changed one twice (old at x=20, new at x=220); nothing in between
    expect(xs).toEqual([20, 20, 220]);
    const still = elements.filter((e: any) => e.y === 30);
    expect(still).toHaveLength(1);
    expect(still[0].opacity).toBe(100);
    expect(byText(elements, "a1")[0].opacity).toBeCloseTo(50);
    expect(byText(elements, "b1")[0].opacity).toBeCloseTo(50);
  });
});
