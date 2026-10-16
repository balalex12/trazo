import { MAX_CAPTION, planStory } from "./story";

/* eslint-disable @typescript-eslint/no-explicit-any */

let n = 0;
const box = (id: string, cell: number, x: number, lines: string[]) => [
  {
    id,
    type: "rectangle",
    x,
    y: 0,
    width: 100,
    height: 60,
    customData: { trazo: { cell } },
    boundElements: [{ type: "text", id: `${id}-t` }],
  },
  {
    id: `${id}-t`,
    type: "text",
    x: x + 5,
    y: 5,
    width: 90,
    height: 40,
    containerId: id,
    text: lines.join("\n"),
  },
];
const arrow = (from: string, to: string) => ({
  id: `a${++n}`,
  type: "arrow",
  x: 0,
  y: 0,
  width: 10,
  height: 0,
  startBinding: { elementId: from },
  endBinding: { elementId: to },
});

const scene = () =>
  [
    ...box("a", 1, 0, ["📥 customers.csv", "read_csv · cell 1"]),
    ...box("b", 1, 0, ["📥 orders.csv", "read_csv · cell 1"]),
    ...box("c", 2, 200, ["📊 df", "DataFrame · cell 2", "↳ merge, dropna"]),
    ...box("d", 3, 400, [
      "🤖 model",
      "RandomForestClassifier · cell 3",
      "↳ fit on X_train",
    ]),
    ...box("e", 3, 400, ["🔢 pred", "predictions · cell 3", "↳ predict"]),
    arrow("a", "c"),
    arrow("b", "c"),
    arrow("c", "d"),
    arrow("d", "e"),
    // not part of the diagram: a size label, a deleted box
    {
      id: "badge",
      type: "text",
      x: 0,
      y: -20,
      width: 30,
      height: 10,
      text: "400 × 3",
      customData: { trazoBadge: "c" },
    },
    {
      id: "gone",
      type: "rectangle",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      isDeleted: true,
      customData: { trazo: { cell: 9 } },
    },
  ] as any[];

describe("planStory", () => {
  it("makes one step per code cell that made something, in order", () => {
    const plan = planStory(scene());
    expect(typeof plan).not.toBe("string");
    const steps = (plan as any).steps;
    expect(steps.map((s: any) => s.cell)).toEqual([1, 2, 3]);
  });

  it("shows on each slide everything built so far, and the arrows between those boxes only", () => {
    const steps = (planStory(scene()) as any).steps;
    const boxesOf = (s: any) =>
      s.ids
        .filter((id: string) => ["a", "b", "c", "d", "e"].includes(id))
        .sort();
    expect(boxesOf(steps[0])).toEqual(["a", "b"]);
    expect(boxesOf(steps[1])).toEqual(["a", "b", "c"]);
    expect(boxesOf(steps[2])).toEqual(["a", "b", "c", "d", "e"]);
    const arrowsOf = (s: any) =>
      s.ids.filter(
        (id: string) => id.startsWith("a") && id.length > 1 && /\d/.test(id),
      );
    expect(arrowsOf(steps[0])).toHaveLength(0);
    expect(arrowsOf(steps[1])).toHaveLength(2); // a->c and b->c
    expect(arrowsOf(steps[2])).toHaveLength(4);
    // the texts of a box travel with it
    expect(steps[1].ids).toContain("c-t");
  });

  it("marks what is new on each slide", () => {
    const steps = (planStory(scene()) as any).steps;
    expect(steps[0].added).toEqual(
      expect.arrayContaining(["a", "a-t", "b", "b-t"]),
    );
    expect(steps[1].added).toEqual(expect.arrayContaining(["c", "c-t"]));
    expect(steps[1].added).not.toContain("a");
    expect(steps[2].added).toEqual(expect.arrayContaining(["d", "e"]));
  });

  it("captions each step with what its cell added", () => {
    const steps = (planStory(scene()) as any).steps;
    expect(steps[0].caption).toBe("Cell 1: customers.csv · orders.csv");
    expect(steps[1].caption).toBe("Cell 2: df: merge, dropna");
    expect(steps[2].caption).toBe(
      "Cell 3: model: fit on X_train · pred: predict",
    );
    expect(steps.every((s: any) => s.caption.length <= MAX_CAPTION)).toBe(true);
  });

  it("covers the whole diagram with its bounds and ignores labels and deleted boxes", () => {
    const plan = planStory(scene()) as any;
    expect(plan.bounds).toEqual({ x: 0, y: 0, width: 500, height: 60 });
  });

  it("says why when there is nothing to make", () => {
    expect(planStory([])).toMatch(/no diagram from a notebook/);
    expect(
      planStory([
        { id: "x", type: "rectangle", x: 0, y: 0, width: 1, height: 1 },
      ] as any),
    ).toMatch(/no diagram from a notebook/);
    expect(
      planStory([
        ...box("a", 1, 0, ["📊 df"]),
        ...box("b", 1, 10, ["📊 x"]),
      ] as any),
    ).toMatch(/one cell/);
    const many = Array.from({ length: 25 }, (_, i) =>
      box(`b${i}`, i + 1, i * 10, [`📊 v${i}`]),
    ).flat();
    expect(planStory(many as any)).toMatch(/limit for slides is 24/);
  });
});
