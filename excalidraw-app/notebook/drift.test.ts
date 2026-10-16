import { compare, normalizeName, similarity, summarize } from "./drift";

import type { CanvasIndex } from "../agent/canvas";
import type { Graph } from "../infra/graph";

/* eslint-disable @typescript-eslint/no-explicit-any */

const box = (key: string, label: string, variable?: string) =>
  ({
    key,
    label,
    details: "",
    members: [
      {
        id: key,
        type: "rectangle",
        customData: variable ? { trazo: { var: variable } } : undefined,
      },
    ],
    primary: { id: key },
    box: { x: 0, y: 0, width: 10, height: 10 },
  } as any);

const diagram = (boxes: any[], edges: [string, string][]): CanvasIndex => ({
  nodes: new Map(boxes.map((b) => [b.key, b])),
  edges: edges.map(([from, to], i) => ({
    from,
    to,
    label: "",
    arrow: { id: `arrow${i}` } as any,
  })),
  nodeOf: new Map(),
  frames: [],
  looseArrows: 0,
});

const notebook = (names: string[], edges: [number, number][]): Graph => ({
  nodes: names.map((n, i) => ({ id: `nb${i}`, lines: [n, "x"] })),
  edges: edges.map(([a, b], i) => ({
    id: `e${i}`,
    from: `nb${a}`,
    to: `nb${b}`,
    kind: "depends" as const,
  })),
  flow: true,
});

describe("normalizeName", () => {
  it("drops the icon, the folder, the extension and the punctuation", () => {
    expect(normalizeName("📥 data/Customers.csv")).toBe("customers");
    expect(normalizeName("📊 df (2)")).toBe("df");
    expect(normalizeName("🤖 RandomForest model")).toBe("randomforest_model");
    expect(normalizeName("Clean orders\nsecond line")).toBe("clean_orders");
    expect(normalizeName("out/scored.parquet")).toBe("scored");
  });
});

describe("similarity", () => {
  it("is 1 for the same name, a fraction for words contained, 0 otherwise", () => {
    expect(similarity("orders", "orders")).toBe(1);
    expect(similarity("model", "churn_model")).toBe(0.5);
    expect(similarity("clean_orders", "orders")).toBe(0.5);
    expect(similarity("orders", "customers")).toBe(0);
    expect(similarity("", "x")).toBe(0);
  });

  it("does not take a one-letter name for part of another", () => {
    expect(similarity("x", "x_train")).toBe(0);
    expect(similarity("y", "y_test")).toBe(0);
    expect(similarity("x", "x")).toBe(1);
  });

  it("ignores filler words", () => {
    expect(similarity("df", "clean_df")).toBe(0);
    expect(similarity("orders_data", "orders")).toBe(1);
  });
});

describe("compare", () => {
  const nb = notebook(
    ["📥 customers.csv", "📥 orders.csv", "📊 df", "🤖 model", "💾 scored.csv"],
    [
      [0, 2],
      [1, 2],
      [2, 3],
      [3, 4],
    ],
  );

  it("matches by name and finds what is planned only and what is code only", () => {
    const d = compare(
      diagram(
        [
          box("a", "customers.csv"),
          box("b", "orders"),
          box("c", "df"),
          box("d", "feature store"),
          box("e", "churn model"),
        ],
        [
          ["a", "c"],
          ["b", "c"],
          ["c", "e"],
          ["d", "e"],
        ],
      ),
      nb,
    );
    expect([...d.matched.keys()].sort()).toEqual(["a", "b", "c", "e"]);
    expect(d.plannedOnly.map((b) => b.key)).toEqual(["d"]);
    // the notebook has a model and a file the diagram does not draw (the file)
    expect(d.codeOnly.map((n) => n.lines[0])).toEqual(["💾 scored.csv"]);
    // d is not matched, so its arrow is not judged; the others are all backed by code
    expect(d.arrowsWithoutCode).toEqual([]);
  });

  it("uses the variable a box was drawn for, over its text", () => {
    const d = compare(
      diagram([box("a", "The customer table", "customers")], []),
      notebook(["📊 customers"], []),
    );
    expect(d.matched.get("a")).toBe("nb0");
  });

  it("lets the box drawn from a variable win over a box that only has the same name", () => {
    const d = compare(
      diagram(
        [box("drawn", "sales table", "sales"), box("typed", "sales")],
        [],
      ),
      notebook(["📊 sales"], []),
    );
    expect(d.matched.get("drawn")).toBe("nb0");
    expect(d.matched.has("typed")).toBe(false);
    expect(d.plannedOnly.map((b) => b.key)).toEqual(["typed"]);
  });

  it("finds arrows with no code behind and flows that are not drawn", () => {
    const d = compare(
      diagram(
        [
          box("a", "customers"),
          box("b", "orders"),
          box("c", "df"),
          box("d", "model"),
        ],
        [
          ["a", "b"],
          ["c", "d"],
        ],
      ),
      nb,
    );
    // customers -> orders is drawn but the notebook has no path between them
    expect(d.arrowsWithoutCode.map((x) => [x.from, x.to])).toEqual([
      ["a", "b"],
    ]);
    // customers -> df, orders -> df are in the code and not drawn
    expect(d.flowsNotDrawn.map((x) => [x.from, x.to]).sort()).toEqual([
      ["a", "c"],
      ["b", "c"],
    ]);
  });

  it("accepts a longer path in the code for a direct arrow in the drawing", () => {
    const d = compare(
      diagram([box("a", "customers"), box("d", "model")], [["a", "d"]]),
      nb,
    );
    expect(d.arrowsWithoutCode).toEqual([]);
  });

  it("does not guess when a name does not decide", () => {
    const d = compare(
      diagram([box("a", "model")], []),
      notebook(["🤖 model_x", "🤖 model_z"], []), // "model" is half of both names
    );
    expect(d.matched.size).toBe(0);
    expect(d.plannedOnly).toHaveLength(1);
    expect(d.codeOnly).toHaveLength(2);
  });

  it("pairs each box with its best node, not the first it finds", () => {
    const d = compare(
      diagram([box("a", "orders"), box("b", "clean orders")], []),
      notebook(["📊 clean_orders", "📊 orders"], []),
    );
    expect(d.matched.get("a")).toBe("nb1");
    expect(d.matched.get("b")).toBe("nb0");
  });

  it("says in one sentence what it found", () => {
    const agree = compare(
      diagram([box("a", "customers")], []),
      notebook(["📊 customers"], []),
    );
    expect(summarize(agree, 1)).toBe("The diagram and the notebook agree.");
    const d = compare(
      diagram([box("a", "customers"), box("b", "feature store")], []),
      notebook(["📊 customers", "📊 extra"], []),
    );
    expect(summarize(d, 2)).toMatch(
      /1 of 2 boxes are in the notebook; 1 planned but not in the code \(red, dashed\); 1 in the code but not drawn/,
    );
  });
});
