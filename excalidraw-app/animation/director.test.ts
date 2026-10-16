import {
  DIRECTOR_SYSTEM,
  MAX_CAPTION,
  MAX_HOLD_MS,
  MAX_SCRIPT,
  MIN_HOLD_MS,
  buildDirectorTurn,
  describeSlides,
  estimateSpeechMs,
  parseDirection,
  patchFor,
} from "./director";
import { TRANSITION_MODES, getSlides } from "./timeline";

/* eslint-disable @typescript-eslint/no-explicit-any */

const frame = (id: string, y: number, customData?: any) => ({
  id,
  type: "frame",
  x: 0,
  y,
  width: 800,
  height: 500,
  name: id,
  isDeleted: false,
  customData,
});
const el = (id: string, frameId: string, y: number, extra: any = {}) => ({
  id,
  type: "rectangle",
  frameId,
  x: 20,
  y: y + 20,
  width: 100,
  height: 60,
  isDeleted: false,
  ...extra,
});
const text = (
  id: string,
  frameId: string,
  y: number,
  t: string,
  extra: any = {},
) => el(id, frameId, y, { type: "text", text: t, ...extra });

const slides = getSlides([
  frame("f1", 0, { caption: "Already written", script: "Keep me" }),
  text("t1", "f1", 0, "Shop architecture", { y: 10 }),
  el("web", "f1", 0, { customData: { animKey: "web" } }),
  text("l1", "f1", 0, "Web", { y: 50 }),
  frame("f2", 700),
  text("t2", "f2", 700, "Shop architecture", {
    y: 710,
    customData: { animKey: "t1" },
  }),
  el("web2", "f2", 700, { customData: { animKey: "web" }, x: 220 }),
  el("db", "f2", 700),
  text("l2", "f2", 700, "Database"),
] as any);

describe("describeSlides", () => {
  const briefs = describeSlides(slides);

  it("lists the texts and the kinds of shapes of each slide", () => {
    expect(briefs).toHaveLength(2);
    expect(briefs[0]).toMatchObject({
      slide: 1,
      name: "f1",
      texts: ["Shop architecture", "Web"],
      shapes: { rectangle: 1 },
      caption: "Already written",
      script: "Keep me",
    });
  });

  it("says what is new, what went and what moved since the previous slide", () => {
    expect(briefs[1].added).toEqual(["a rectangle", "Database"]);
    expect(briefs[1].removed).toEqual(["Web"]);
    expect(briefs[1].moved).toBe(1); // the web box moved right
    expect(briefs[0].added).toBeUndefined();
  });

  it("keeps long texts and long lists short", () => {
    const big = getSlides([
      frame("f", 0),
      ...Array.from({ length: 40 }, (_, i) =>
        text(`t${i}`, "f", 0, `Label number ${i} ${"x".repeat(200)}`, { y: i }),
      ),
    ] as any);
    const [b] = describeSlides(big);
    expect(b.texts).toHaveLength(14);
    expect(b.texts[0].length).toBeLessThanOrEqual(90);
  });

  it("puts the slides and the note in the user turn", () => {
    const turn = buildDirectorTurn(briefs, "  For the sales team, friendly  ");
    expect(turn).toContain('"Shop architecture"');
    expect(turn).toContain("For the sales team, friendly");
    expect(buildDirectorTurn(briefs, "")).toContain("(none");
  });

  it("tells the model every transition, the limits and the shape of the answer", () => {
    for (const m of TRANSITION_MODES) {
      expect(DIRECTOR_SYSTEM).toContain(`"${m}"`);
    }
    expect(DIRECTOR_SYSTEM).toContain(String(MAX_CAPTION));
    expect(DIRECTOR_SYSTEM).toContain(String(MAX_SCRIPT));
    expect(DIRECTOR_SYSTEM).toContain("ONLY a JSON object");
  });
});

describe("parseDirection", () => {
  const answer = (slidesJson: unknown, extra: any = {}) =>
    JSON.stringify({
      message: "Short and friendly",
      slides: slidesJson,
      ...extra,
    });

  it("reads a good answer, even inside a fence or with words around it", () => {
    const good = answer([
      {
        slide: 1,
        caption: " Welcome ",
        script: "Here is the shop.",
        holdMs: 3000,
      },
      { slide: 2, transition: "build", holdMs: 2500 },
    ]);
    for (const raw of [
      good,
      `\`\`\`json\n${good}\n\`\`\``,
      `Sure! ${good} Hope it helps.`,
    ]) {
      const d = parseDirection(raw, 2);
      expect(d.dropped).toEqual([]);
      expect(d.message).toBe("Short and friendly");
      expect(d.items).toEqual([
        {
          index: 0,
          caption: "Welcome",
          script: "Here is the shop.",
          holdMs: 3000,
        },
        { index: 1, transition: "build", holdMs: 2500 },
      ]);
    }
  });

  it("clamps hold times and rounds them to 100 ms", () => {
    const d = parseDirection(
      answer([
        { slide: 1, holdMs: 5 },
        { slide: 2, holdMs: 999_999 },
        { slide: 3, holdMs: 2549 },
      ]),
      3,
    );
    expect(d.items.map((i) => i.holdMs)).toEqual([
      MIN_HOLD_MS,
      MAX_HOLD_MS,
      2500,
    ]);
  });

  it("cuts captions and scripts to their limits", () => {
    const d = parseDirection(
      answer([
        { slide: 1, caption: "c".repeat(500), script: "s ".repeat(500) },
      ]),
      1,
    );
    expect(d.items[0].caption).toHaveLength(MAX_CAPTION);
    expect(d.items[0].script!.length).toBeLessThanOrEqual(MAX_SCRIPT);
  });

  it("drops what is wrong and says so, without making anything up", () => {
    const d = parseDirection(
      answer([
        { slide: 9, caption: "no such slide" },
        { slide: 1, transition: "cut" },
        { slide: 2, transition: "explode", caption: 42, holdMs: "soon" },
        "nonsense",
        { slide: 2, caption: "ok" },
      ]),
      2,
    );
    expect(d.items).toEqual([{ index: 1, caption: "ok" }]);
    expect(d.dropped.join(" | ")).toMatch(/slide 9/);
    expect(d.dropped.join(" | ")).toMatch(/transition for slide 1/);
    expect(d.dropped.join(" | ")).toMatch(/"explode" is not one of/);
    expect(d.dropped.join(" | ")).toMatch(/caption of slide 2 \(not text\)/);
    expect(d.dropped.join(" | ")).toMatch(/hold time of slide 2/);
  });

  it("merges two entries for the same slide, the later one winning", () => {
    const d = parseDirection(
      answer([
        { slide: 1, caption: "a", holdMs: 2000 },
        { slide: 1, caption: "b" },
      ]),
      1,
    );
    expect(d.items).toEqual([{ index: 0, caption: "b", holdMs: 2000 }]);
  });

  it("explains an answer it cannot read", () => {
    expect(parseDirection("I would make it shorter.", 2).dropped[0]).toMatch(
      /JSON object/,
    );
    expect(parseDirection("{not json}", 2).dropped[0]).toMatch(
      /not valid JSON/,
    );
    expect(parseDirection('{"message":"x"}', 2).dropped[0]).toMatch(
      /"slides" list/,
    );
    expect(parseDirection("{}", 2).items).toEqual([]);
  });

  it("ignores empty values instead of clearing the slide", () => {
    const d = parseDirection(
      answer([{ slide: 1, caption: "  ", script: "" }]),
      1,
    );
    expect(d.items).toEqual([]);
  });
});

describe("patchFor", () => {
  it("changes only the fields the item has", () => {
    const next = patchFor(
      { index: 1, caption: "New", transition: "build" },
      { holdMs: 4000, other: 1 },
    );
    expect(next).toEqual({
      holdMs: 4000,
      other: 1,
      caption: "New",
      transition: "build",
    });
  });

  it("smart is the default, so it removes the field", () => {
    expect(
      patchFor({ index: 1, transition: "smart" }, { transition: "fade", x: 1 }),
    ).toEqual({ x: 1 });
  });

  it("keeps a slide on screen as long as its script takes to say", () => {
    const script = "word ".repeat(25).trim(); // 25 words, 10 s
    expect(estimateSpeechMs(script)).toBe(10_400);
    expect(patchFor({ index: 0, script, holdMs: 2000 }, {}).holdMs).toBe(
      10_400,
    );
    // the transition into the slide already takes part of that time
    expect(patchFor({ index: 1, script }, {}, 900).holdMs).toBe(9500);
    // a longer hold chosen by the model wins
    expect(
      patchFor({ index: 0, script: "Hi there", holdMs: 6000 }, {}).holdMs,
    ).toBe(6000);
  });

  it("applies only the fields that were ticked", () => {
    const item = {
      index: 1,
      caption: "C",
      script: "S",
      holdMs: 3000,
      transition: "fade" as const,
    };
    const next = patchFor(item, { caption: "old" }, 0, {
      caption: false,
      script: true,
      holdMs: false,
      transition: true,
    });
    expect(next).toEqual({ caption: "old", script: "S", transition: "fade" });
  });

  it("does not touch the original customData", () => {
    const original = { caption: "a" };
    patchFor({ index: 0, caption: "b" }, original);
    expect(original).toEqual({ caption: "a" });
  });
});
