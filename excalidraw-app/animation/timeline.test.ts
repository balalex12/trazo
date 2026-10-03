import {
  DEFAULT_SETTINGS,
  buildScene,
  captionAt,
  ease,
  holdOf,
  panViewport,
  revealUnits,
  sampleAt,
  totalDurationMs,
  transitionMs,
  truncatePoints,
  wrapText,
} from "./timeline";

import type { Easing } from "./timeline";

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

// ---- deeper animation ------------------------------------------------------------------------------

const arrow = (id: string, x: number, y: number, extra: object = {}) => ({
  ...el(id, x, y),
  type: "arrow",
  points: [
    [0, 0],
    [100, 0],
    [100, 100],
  ],
  width: 100,
  height: 100,
  ...extra,
});

describe("easings", () => {
  const all: Easing[] = [
    "linear",
    "easeInOut",
    "easeOut",
    "easeInOutCubic",
    "easeOutBack",
    "spring",
  ];

  it("all start at 0 and end at exactly 1", () => {
    for (const e of all) {
      expect(ease(e, 0)).toBeCloseTo(0, 6);
      expect(ease(e, 1)).toBeCloseTo(1, 6);
    }
  });

  it("overshoot and spring go past 1 on the way, the others never do", () => {
    const peak = (e: Easing) =>
      Math.max(...Array.from({ length: 101 }, (_, i) => ease(e, i / 100)));
    expect(peak("easeOutBack")).toBeGreaterThan(1.05);
    expect(peak("spring")).toBeGreaterThan(1.05);
    for (const e of [
      "linear",
      "easeInOut",
      "easeOut",
      "easeInOutCubic",
    ] as Easing[]) {
      expect(peak(e)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("an overshooting easing never pushes opacity out of range", () => {
    const A = slide("a", 0, [
      el("a1", 0, 0, { customData: { animKey: "gone" } }),
    ]);
    const B = slide("b", 400, [el("b1", 0, 400)]);
    for (const p of [1.15, -0.1, 1]) {
      const { elements } = buildScene(A, B, p);
      for (const e of elements) {
        expect(e.opacity).toBeGreaterThanOrEqual(0);
        expect(e.opacity).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("truncatePoints (lines that draw themselves)", () => {
  const pts = [
    [0, 0],
    [100, 0],
    [100, 100],
  ];

  it("keeps the whole line at 1 and only the start at 0", () => {
    expect(truncatePoints(pts, 1)).toBe(pts);
    const zero = truncatePoints(pts, 0);
    expect(zero).toHaveLength(2);
    expect(zero[1]).toEqual([0, 0]);
  });

  it("cuts by length across segments", () => {
    const half = truncatePoints(pts, 0.25);
    expect(half[half.length - 1]).toEqual([50, 0]);
    const threeQuarters = truncatePoints(pts, 0.75);
    expect(threeQuarters[threeQuarters.length - 1]).toEqual([100, 50]);
    expect(threeQuarters).toHaveLength(3);
  });
});

describe("build transition (reveal in order)", () => {
  const A = slide("a", 0, [
    el("a1", 20, 30, { customData: { animKey: "keep" } }),
  ]);
  const B = slide(
    "b",
    400,
    [
      el("b1", 20, 430, { customData: { animKey: "keep" } }), // paired with a1
      el("n1", 150, 430),
      el("n2", 280, 430),
      el("n3", 20, 560),
      arrow("ar", 150, 480),
    ],
    { transition: "build" },
  );
  const opacityOf = (els: any[], id: string) => byText(els, id)[0]?.opacity;
  const at = (t: number) => buildScene(A, B, t, t).elements;

  it("shows no new element at the start and all of them at the end", () => {
    for (const id of ["n1", "n2", "n3", "ar"]) {
      expect(opacityOf(at(0), id)).toBe(0);
      expect(opacityOf(at(1), id)).toBe(100);
    }
    const full = byText(at(1), "ar")[0].points;
    expect(full).toHaveLength(3);
    expect(full[2]).toEqual([100, 100]);
  });

  it("brings them in one after another, in scene order", () => {
    const e = at(0.35);
    expect(opacityOf(e, "n1")).toBeGreaterThan(opacityOf(e, "n2"));
    expect(opacityOf(e, "n2")).toBeGreaterThan(opacityOf(e, "n3"));
    expect(opacityOf(e, "n3")).toBeGreaterThan(opacityOf(e, "ar"));
  });

  it("draws an arrow progressively instead of fading it", () => {
    let partial = false;
    for (let t = 0; t <= 1; t += 0.02) {
      const a = byText(at(t), "ar")[0];
      const len =
        a.points.length === 2
          ? Math.hypot(a.points[1][0], a.points[1][1])
          : 200;
      if (a.opacity === 100 && len > 0 && len < 199) {
        partial = true;
      }
    }
    expect(partial).toBe(true);
  });

  it("keeps a group, or a text with its container, together", () => {
    const grouped = slide("g", 0, [
      el("r", 0, 0, { groupIds: ["grp"] }),
      el("t", 0, 0, { type: "text", containerId: "r2" }),
      el("r2", 0, 0),
      el("s", 0, 0, { groupIds: ["grp"] }),
    ]);
    const { unitOf, count } = revealUnits(grouped, new Set());
    const unit = (id: string) =>
      unitOf.get(grouped.children.find((c) => c.id === id)!);
    expect(unit("r")).toBe(unit("s"));
    expect(unit("t")).toBe(unit("r2"));
    expect(unit("r")).not.toBe(unit("r2"));
    expect(count).toBe(2);
  });

  it("takes longer when there is more to show, and the timeline follows", () => {
    expect(transitionMs(A, B, settings)).toBe(4 * 450 + 500); // 4 new pieces
    const smart = slide("s", 400, B.children);
    expect(transitionMs(A, smart, settings)).toBe(settings.transitionMs);
    expect(
      transitionMs(
        A,
        slide("c", 400, B.children, { transition: "cut" }),
        settings,
      ),
    ).toBe(0);
    const slides = [A, B];
    expect(totalDurationMs(slides, settings)).toBe(2000 + 2300 + 2000);
    expect(sampleAt(2000 + 1150, slides, settings)).toEqual({
      a: 0,
      b: 1,
      t: 0.5,
    });
  });

  it("falls back to the normal duration when nothing new appears", () => {
    const same = slide(
      "b2",
      400,
      [el("b1", 20, 430, { customData: { animKey: "keep" } })],
      {
        transition: "build",
      },
    );
    expect(transitionMs(A, same, settings)).toBe(settings.transitionMs);
  });
});

describe("pan transition (camera over the canvas)", () => {
  const A = slide("a", 0, [el("a1", 20, 30)]);
  const B = slide("b", 400, [el("b1", 20, 430)], { transition: "pan" });

  it("starts on the first slide and ends on the second", () => {
    expect(panViewport(A, B, 0)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
    const end = panViewport(A, B, 1);
    expect(end.x).toBeCloseTo(0);
    expect(end.y).toBeCloseTo(400);
    expect(end.width).toBeCloseTo(400);
    expect(end.height).toBeCloseTo(300);
  });

  it("zooms out in the middle of a long trip", () => {
    const mid = panViewport(A, B, 0.5);
    expect(mid.width).toBeCloseTo(600);
    expect(mid.height).toBeCloseTo(450);
    expect(mid.x).toBeCloseTo(-100);
    expect(mid.y).toBeCloseTo(125);
  });

  it("keeps every element where it is on the canvas and moves only the view", () => {
    const { frame, elements } = buildScene(A, B, 1);
    expect(frame.width).toBeCloseTo(400);
    // viewport is the second slide: its element is at (20, 30) inside the view, the first slide's is above it
    expect(byText(elements, "b1")[0].x).toBeCloseTo(20);
    expect(byText(elements, "b1")[0].y).toBeCloseTo(30);
    expect(byText(elements, "a1")[0].y).toBeCloseTo(30 - 400);
    expect(elements.every((e) => e.frameId === "__anim_frame__")).toBe(true);
    expect(elements.every((e) => e.opacity === 100)).toBe(true);
  });
});

describe("captions", () => {
  const A = slide("a", 0, [], { caption: "First" });
  const B = slide("b", 400, [], { caption: "Second" });

  it("shows the old caption fading out, then the new one fading in", () => {
    expect(captionAt(A, B, 0)).toEqual({ text: "First", alpha: 1 });
    expect(captionAt(A, B, 0.25)).toEqual({ text: "First", alpha: 0.5 });
    expect(captionAt(A, B, 0.5)).toEqual({ text: "Second", alpha: 0 });
    expect(captionAt(A, B, 1)).toEqual({ text: "Second", alpha: 1 });
  });

  it("keeps a caption that does not change fully visible", () => {
    const C = slide("c", 800, [], { caption: "  First " });
    expect(captionAt(A, C, 0.5)).toEqual({ text: "First", alpha: 1 });
    expect(captionAt(slide("x", 0, []), slide("y", 400, []), 0.5).text).toBe(
      "",
    );
  });

  it("wraps text to the width and marks cut text", () => {
    const measure = (t: string) => t.length * 10;
    expect(wrapText("aaa bbb ccc ddd", 100, measure)).toEqual([
      "aaa bbb",
      "ccc ddd",
    ]);
    expect(wrapText("supercalifragilistic", 50, measure)).toEqual([
      "supercalifragilistic",
    ]);
    const cut = wrapText("aaa bbb ccc ddd eee fff", 70, measure, 2);
    expect(cut).toHaveLength(2);
    expect(cut[1].endsWith("…")).toBe(true);
    expect(wrapText("", 100, measure)).toEqual([]);
  });
});
