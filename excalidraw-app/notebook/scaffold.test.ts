import { spawnSync } from "node:child_process";

import { diagramToCells } from "./scaffold";

import type { CanvasIndex } from "../agent/canvas";

/* eslint-disable @typescript-eslint/no-explicit-any */

const node = (
  key: string,
  label: string,
  x: number,
  details = "",
  role?: string,
) =>
  ({
    key,
    label,
    details,
    role,
    box: { x, y: 0, width: 10, height: 10 },
  } as any);

const index = (nodes: any[], edges: [string, string][]): CanvasIndex => ({
  nodes: new Map(nodes.map((n) => [n.key, n])),
  edges: edges.map(([from, to]) => ({ from, to, label: "", arrow: {} as any })),
  nodeOf: new Map(),
  frames: [],
  looseArrows: 0,
});

const PIPELINE = index(
  [
    node("a", "📥 customers.csv", 0, "· id\n· plan"),
    node("b", "📥 orders.csv", 0),
    node("c", "📊 clean orders", 200, "↳ merge, dropna"),
    node("d", "🤖 churn model", 400, "", "function"),
    node("e", "💾 out/scored.parquet", 600),
  ],
  [
    ["a", "c"],
    ["b", "c"],
    ["c", "d"],
    ["d", "e"],
  ],
);

describe("diagramToCells", () => {
  it("has nothing to write for an empty canvas", () => {
    expect(diagramToCells(index([], []))).toBeNull();
  });

  it("writes the imports first and then a cell per box in flow order", () => {
    const cells = diagramToCells(PIPELINE)!;
    expect(cells).toHaveLength(6);
    expect(cells[0]).toBe("import pandas as pd");
    expect(cells[1]).toContain('customers = pd.read_csv("customers.csv")');
    expect(cells[1]).toContain("# columns: id, plan");
    expect(cells[2]).toContain('orders = pd.read_csv("orders.csv")');
    expect(cells[3]).toContain(
      'clean_orders = customers.merge(orders, on="TODO"',
    );
    expect(cells[3]).toContain("# ↳ merge, dropna");
    expect(cells[4]).toContain("churn_model = clean_orders.copy()");
    expect(cells[4]).toContain("# TODO: fit the model here");
    expect(cells[5]).toContain('churn_model.to_parquet("out/scored.parquet")');
    // the end of the flow is a file: there is no variable to show
    expect(cells[5].trim().split("\n").pop()).toContain("to_parquet");
  });

  it("puts upstream first even when the canvas order is the other way round", () => {
    const cells = diagramToCells(
      index(
        [node("z", "📊 step", 0), node("y", "📥 raw.csv", 500)],
        [["y", "z"]],
      ),
    )!;
    expect(cells[1]).toContain("raw = pd.read_csv");
    expect(cells[2]).toContain("step = raw.copy()");
  });

  it("imports what a file type needs and keeps names valid and unique", () => {
    const cells = diagramToCells(
      index(
        [
          node("a", "📥 parcels.geojson", 0),
          node("b", "📥 parcels.csv", 0),
          node("c", "📥 2024 data", 0),
          node("d", "class", 0),
        ],
        [],
      ),
    )!;
    expect(cells[0]).toBe("import geopandas as gpd\nimport pandas as pd");
    expect(cells[1]).toContain('parcels = gpd.read_file("parcels.geojson")');
    expect(cells[2]).toContain("parcels_2 = pd.read_csv");
    expect(cells[3]).toContain("df_2024_data = pd.DataFrame()  # TODO");
    expect(cells[4]).toContain("class_df = pd.DataFrame()");
  });

  it("handles a loop without hanging", () => {
    const cells = diagramToCells(
      index(
        [node("a", "A", 0), node("b", "B", 10)],
        [
          ["a", "b"],
          ["b", "a"],
        ],
      ),
    )!;
    expect(cells).toHaveLength(3);
  });

  const python = spawnSync("python3", ["-c", "pass"]).status === 0;
  (python ? it : it.skip)("writes cells that are valid Python", () => {
    for (const cell of diagramToCells(PIPELINE)!) {
      const r = spawnSync(
        "python3",
        ["-c", "import sys; compile(sys.stdin.read(), 'cell', 'exec')"],
        {
          input: cell,
        },
      );
      if (r.status !== 0) {
        throw new Error(`${cell}\n${r.stderr}`);
      }
      expect(r.status).toBe(0);
    }
  });
});
