import { mapToSkeleton, parseMap } from "./geomap";
import { parseKernelOp } from "./live";

const square = [
  [10, 10],
  [110, 10],
  [110, 60],
  [10, 60],
  [10, 10],
];

const base = () => ({
  width: 300,
  height: 200,
  shapes: [{ kind: "polygon", pts: square, fill: "#a5d8ff" }],
});

const ok = (data: Record<string, unknown>) => {
  const made = parseMap(data);
  if (typeof made === "string") {
    throw new Error(made);
  }
  return made;
};

describe("parseMap", () => {
  it("accepts a map and keeps what it needs", () => {
    const m = ok({
      ...base(),
      title: "Parcels",
      labels: [{ x: 50, y: 30, text: "A" }],
      legend: [{ label: "1 – 5", color: "#e7f5ff" }],
      note: "simplified (1.2 px tolerance)",
      extra: "ignored",
    });
    expect(m.title).toBe("Parcels");
    expect(m.shapes).toHaveLength(1);
    expect(m.labels).toEqual([{ x: 50, y: 30, text: "A" }]);
    expect(m.legend).toHaveLength(1);
    expect(m).not.toHaveProperty("extra");
  });

  it("refuses what it cannot draw", () => {
    expect(parseMap({ width: 300, height: 200 })).toMatch(/no shapes/);
    expect(parseMap({ ...base(), width: -1 })).toMatch(/size/);
    expect(parseMap({ ...base(), width: 99999 })).toMatch(/size/);
    expect(
      parseMap({ ...base(), shapes: [{ kind: "spiral", pts: square }] }),
    ).toMatch(/malformed/);
    expect(
      parseMap({ ...base(), shapes: [{ kind: "polygon", pts: [[1, 1]] }] }),
    ).toMatch(/too few/);
    expect(
      parseMap({
        ...base(),
        shapes: [
          {
            kind: "line",
            pts: [
              [1, 1],
              ["x", 2],
            ],
          },
        ],
      }),
    ).toMatch(/pair of numbers/);
    expect(
      parseMap({
        ...base(),
        shapes: [
          {
            kind: "line",
            pts: [
              [1, 1],
              [NaN, 2],
            ],
          },
        ],
      }),
    ).toMatch(/pair of numbers/);
    expect(
      parseMap({
        ...base(),
        shapes: Array.from({ length: 1501 }, () => ({
          kind: "point",
          pts: [[1, 1]],
        })),
      }),
    ).toMatch(/too many shapes/);
    expect(
      parseMap({
        ...base(),
        shapes: Array.from({ length: 9 }, () => ({
          kind: "line",
          pts: Array.from({ length: 1000 }, () => [1, 1]),
        })),
      }),
    ).toMatch(/too many points/);
  });

  it("only takes plain hex colours and clips long text", () => {
    const m = ok({
      ...base(),
      shapes: [
        { kind: "polygon", pts: square, fill: "red; background:url(x)" },
      ],
      legend: [
        { label: "ok", color: "#12abEF" },
        { label: "bad", color: "url(javascript:1)" },
      ],
      labels: [{ x: 1, y: 1, text: "y".repeat(500) }],
    });
    expect(m.shapes[0].fill).toBeUndefined();
    expect(m.legend).toEqual([{ label: "ok", color: "#12abEF" }]);
    expect(m.labels[0].text.length).toBeLessThanOrEqual(30);
  });
});

describe("parseKernelOp: map", () => {
  it("reaches the panel as a map, or as an explanation", () => {
    expect(parseKernelOp({ op: "map", ...base() })).toMatchObject({
      op: "map",
    });
    expect(
      typeof parseKernelOp({ op: "map", width: 5, height: 5, shapes: [] }),
    ).toBe("string");
  });
});

describe("mapToSkeleton", () => {
  const spec = ok({
    ...base(),
    title: "Parcels",
    shapes: [
      { kind: "polygon", pts: square, fill: "#74c0fc" },
      {
        kind: "hole",
        pts: [
          [30, 20],
          [50, 20],
          [50, 40],
          [30, 40],
          [30, 20],
        ],
      },
      {
        kind: "line",
        pts: [
          [0, 0],
          [100, 100],
          [200, 80],
        ],
      },
      { kind: "point", pts: [[250, 150]] },
    ],
    labels: [{ x: 60, y: 35, text: "North" }],
    legend: [
      { label: "low", color: "#e7f5ff" },
      { label: "high", color: "#1971c2" },
    ],
    note: "simplified (1.0 px tolerance)",
  });
  let n = 0;
  const built = mapToSkeleton(spec, { x: 1000, y: 500 }, () => `t${++n}`);

  it("puts the shapes and the labels inside a frame named after the title", () => {
    const frame = built.skeleton.find((e) => e.type === "frame")!;
    expect(frame).toMatchObject({
      name: "Parcels",
      x: 1000,
      y: 500,
      width: 300,
      height: 200,
    });
    const children = frame.children as string[];
    // 4 shapes and 1 label
    expect(children).toHaveLength(5);
    const ids = new Set(built.skeleton.map((e) => e.id));
    children.forEach((c) => expect(ids.has(c)).toBe(true));
  });

  it("draws polygons filled and closed, lines open, holes in white and points as dots", () => {
    const byType = (type: string) =>
      built.skeleton.filter((e) => e.type === type);
    const lines = byType("line");
    const polygons = lines.filter((e) => e.polygon);
    expect(polygons).toHaveLength(2);
    expect(polygons[0]).toMatchObject({
      backgroundColor: "#74c0fc",
      x: 1010,
      y: 510,
    });
    expect(polygons[1]).toMatchObject({ backgroundColor: "#ffffff" });
    const open = lines.filter((e) => !e.polygon);
    expect(open).toHaveLength(1);
    expect(open[0].points).toEqual([
      [0, 0],
      [100, 100],
      [200, 80],
    ]);
    expect(byType("ellipse")).toHaveLength(1);
  });

  it("lists the legend under the frame, with the note, and says what area it covers", () => {
    const keys = built.skeleton.filter((e) => e.type === "rectangle");
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatchObject({
      x: 1000,
      y: 714,
      backgroundColor: "#e7f5ff",
    });
    const texts = built.skeleton
      .filter((e) => e.type === "text")
      .map((e) => e.text);
    expect(texts).toEqual(
      expect.arrayContaining([
        "North",
        "low",
        "high",
        "simplified (1.0 px tolerance)",
      ]),
    );
    expect(built.bounds[0]).toBe(1000);
    expect(built.bounds[2]).toBe(1300);
    expect(built.bounds[3]).toBeGreaterThan(714 + 44);
  });

  it("gives every element its own id, also across two maps", () => {
    const again = mapToSkeleton(spec);
    const ids = [...built.skeleton, ...again.skeleton].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
