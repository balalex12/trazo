import { describe, expect, it } from "vitest";

import { layoutGraph } from "./graph";
import { routeEdges } from "./route";

import type { Graph, GraphEdge, GraphNode, Layout } from "./graph";

const node = (id: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id,
  lines: [id],
  role: "app",
  ...extra,
});
const dep = (from: string, to: string): GraphEdge => ({
  id: `${from}>${to}`,
  from,
  to,
  kind: "depends",
});

/** true when the polyline goes through the inside of the box */
const crossesBox = (pts: number[][], n: Layout["nodes"][number]) => {
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const x1 = Math.min(ax, bx);
    const x2 = Math.max(ax, bx);
    const y1 = Math.min(ay, by);
    const y2 = Math.max(ay, by);
    if (
      x2 > n.x + 0.5 &&
      x1 < n.x + n.width - 0.5 &&
      y2 > n.y + 0.5 &&
      y1 < n.y + n.height - 0.5
    ) {
      return true;
    }
  }
  return false;
};

const check = (g: Graph) => {
  const layout = layoutGraph(g);
  const routes = routeEdges(layout);
  expect(routes.size).toBe(layout.edges.length);
  for (const e of layout.edges) {
    const pts = routes.get(e.id)!;
    for (let i = 1; i < pts.length; i++) {
      expect(
        Math.abs(pts[i][0] - pts[i - 1][0]) < 0.01 ||
          Math.abs(pts[i][1] - pts[i - 1][1]) < 0.01,
      ).toBe(true);
    }
    for (const n of layout.nodes) {
      // the route may touch its own two boxes only at the ends (it stays outside them anyway)
      expect(crossesBox(pts, n), `${e.id} crosses ${n.id}`).toBe(false);
    }
  }
  return { layout, routes };
};

describe("routeEdges", () => {
  it("goes around a box that sits between source and target", () => {
    // a -> c skips b: a straight line from a to c would run through b
    const { routes } = check({
      nodes: [node("a"), node("b"), node("c")],
      edges: [dep("a", "b"), dep("b", "c"), dep("a", "c")],
    });
    expect(routes.get("a>c")!.length).toBeGreaterThan(2);
  });

  it("keeps a plain neighbour link straight", () => {
    const { routes } = check({
      nodes: [node("a"), node("b")],
      edges: [dep("a", "b")],
    });
    expect(routes.get("a>b")).toHaveLength(2);
  });

  it("routes a diamond, a fan and a back edge without crossing any box", () => {
    check({
      nodes: ["a", "b", "c", "d", "e", "f"].map((id) => node(id)),
      edges: [
        dep("a", "b"),
        dep("a", "c"),
        dep("a", "d"),
        dep("b", "e"),
        dep("c", "e"),
        dep("d", "f"),
        dep("e", "f"),
        dep("a", "f"),
        dep("f", "b"),
      ],
    });
  });

  it("handles entry points, attached boxes and flows", () => {
    check({
      flow: true,
      nodes: [
        node("net", { external: true }),
        node("web"),
        node("api"),
        node("db"),
        node("vol", { attachedTo: "db" }),
        node("cfg", { attachedTo: "db" }),
      ],
      edges: [
        { id: "i", from: "net", to: "web", kind: "ingress" },
        dep("web", "api"),
        dep("api", "db"),
        dep("web", "db"),
        { id: "v", from: "db", to: "vol", kind: "attach" },
        { id: "c", from: "db", to: "cfg", kind: "attach" },
      ],
    });
  });

  it("spreads arrows that leave the same side of a box", () => {
    const { routes } = check({
      nodes: [node("a"), node("b"), node("c"), node("d")],
      edges: [dep("a", "b"), dep("a", "c"), dep("a", "d")],
    });
    const starts = new Set(
      ["a>b", "a>c", "a>d"].map((k) => routes.get(k)![0][1]),
    );
    expect(starts.size).toBe(3);
  });

  it("stays fast and clean on a large graph", () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 120; i++) {
      nodes.push(node(`n${i}`));
    }
    for (let i = 1; i < 120; i++) {
      const j = Math.floor(rnd() * i);
      edges.push(dep(`n${j}`, `n${i}`));
      if (rnd() < 0.5) {
        const k = Math.floor(rnd() * i);
        if (k !== j) {
          edges.push(dep(`n${k}`, `n${i}`));
        }
      }
    }
    const t0 = Date.now();
    check({ nodes, edges, flow: true });
    expect(Date.now() - t0).toBeLessThan(20000);
  });
});
