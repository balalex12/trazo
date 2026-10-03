import { layoutGraph } from "./graph";

import type { Graph, GraphNode } from "./graph";

const node = (id: string, lines = [id]): GraphNode => ({
  id,
  role: "app",
  lines,
});
const dep = (from: string, to: string) => ({
  id: `${from}>${to}`,
  from,
  to,
  kind: "depends" as const,
});
const at = (layout: ReturnType<typeof layoutGraph>, id: string) =>
  layout.nodes.find((n) => n.id === id)!;

describe("layoutGraph: box size", () => {
  it("makes boxes taller for many lines and wider for long lines", () => {
    const l = layoutGraph({
      nodes: [
        node("short"),
        node(
          "tall",
          Array.from({ length: 9 }, (_, i) => `line ${i}`),
        ),
        node("wide", ["x".repeat(34)]),
      ],
      edges: [],
    });
    expect(at(l, "short").width).toBe(230);
    expect(at(l, "short").height).toBe(96);
    expect(at(l, "tall").height).toBeGreaterThan(96);
    expect(at(l, "wide").width).toBeGreaterThan(230);
    expect(at(l, "wide").width).toBeLessThanOrEqual(380);
  });

  it("never lets a box of one column touch the next column", () => {
    const g: Graph = {
      nodes: [node("a", ["x".repeat(40)]), node("b", ["x".repeat(40)])],
      edges: [dep("a", "b")],
    };
    const l = layoutGraph(g);
    expect(at(l, "b").x).toBeGreaterThanOrEqual(
      at(l, "a").x + at(l, "a").width + 100,
    );
  });
});

describe("layoutGraph: flow", () => {
  // src1 and src2 feed s1; seed feeds only the last step, two columns away
  const flow: Graph = {
    flow: true,
    nodes: ["src1", "src2", "seed", "s1", "s2", "end"].map((id) => node(id)),
    edges: [
      dep("src1", "s1"),
      dep("src2", "s1"),
      dep("s1", "s2"),
      dep("s2", "end"),
      dep("seed", "end"),
    ],
  };

  it("keeps the usual columns without the flow flag", () => {
    const l = layoutGraph({ ...flow, flow: false });
    expect(at(l, "seed").x).toBe(at(l, "src1").x);
  });

  it("puts an entry node right before the first thing it feeds", () => {
    const l = layoutGraph(flow);
    expect(at(l, "src1").x).toBeLessThan(at(l, "s1").x);
    // seed sits in the column before "end", not in the first one
    expect(at(l, "seed").x).toBe(at(l, "s2").x);
  });

  it("orders a column by where its upstream nodes are", () => {
    const g: Graph = {
      flow: true,
      nodes: ["a", "b", "x", "y"].map((id) => node(id)),
      // declared in the opposite order of their upstream nodes
      edges: [dep("a", "y"), dep("b", "x")],
    };
    const l = layoutGraph(g);
    expect(at(l, "a").y).toBeLessThan(at(l, "b").y);
    expect(at(l, "y").y).toBeLessThan(at(l, "x").y);
  });
});
