import { graphFromDraw, parseKernelOp, sizeLabel } from "./live";
import { PROTOCOL, parseReply } from "./protocol";

describe("graphFromDraw", () => {
  const ok = (data: Record<string, unknown>) => {
    const made = graphFromDraw(data);
    if (typeof made === "string") {
      throw new Error(made);
    }
    return made;
  };

  it("makes a flow graph from nodes and edges", () => {
    const { graph, title } = ok({
      title: "Lineage",
      nodes: [
        { id: "a", label: "Source", details: ["raw"], role: "database" },
        { id: 2, label: "Report", details: "line 1\nline 2", role: "nonsense" },
      ],
      edges: [{ from: "a", to: 2, label: "feeds" }],
    });
    expect(title).toBe("Lineage");
    expect(graph.flow).toBe(true);
    expect(graph.nodes[0]).toMatchObject({
      lines: ["Source", "raw"],
      role: "database",
    });
    expect(graph.nodes[1].lines).toEqual(["Report", "line 1", "line 2"]);
    expect(graph.nodes[1].role).toBeUndefined(); // an unknown role is ignored
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0]).toMatchObject({
      from: graph.nodes[0].id,
      to: graph.nodes[1].id,
      label: "feeds",
    });
  });

  it("drops arrows that do not connect two boxes and says so", () => {
    const { graph } = ok({
      nodes: [{ id: "a" }, { id: "b" }],
      edges: [
        { from: "a", to: "zzz" },
        { from: "a", to: "a" },
        { from: "a", to: "b" },
      ],
    });
    expect(graph.edges).toHaveLength(1);
    expect(graph.notes?.[0]).toMatch(/2 edges/);
  });

  it("refuses what it cannot draw", () => {
    expect(graphFromDraw({ nodes: [] })).toMatch(/nothing to draw/);
    expect(graphFromDraw({})).toMatch(/nothing to draw/);
    expect(graphFromDraw({ nodes: [{ label: "no id" }] })).toMatch(/id/);
    expect(graphFromDraw({ nodes: [{ id: 1 }, { id: "1" }] })).toMatch(
      /same id/,
    );
    expect(
      graphFromDraw({
        nodes: Array.from({ length: 151 }, (_, i) => ({ id: i })),
      }),
    ).toMatch(/too many/);
  });

  it("clips long text instead of trusting its size", () => {
    const { graph } = ok({
      nodes: [{ id: "a", label: "x".repeat(500), details: ["y".repeat(500)] }],
    });
    expect(graph.nodes[0].lines[0].length).toBeLessThanOrEqual(40);
    expect(graph.nodes[0].lines[1].length).toBeLessThanOrEqual(40);
  });
});

describe("parseKernelOp", () => {
  it("knows the two messages of the trazo module", () => {
    expect(parseKernelOp({ op: "hello" })).toEqual({ op: "hello" });
    expect(parseKernelOp({ op: "draw", nodes: [{ id: "a" }] })).toMatchObject({
      op: "draw",
    });
  });

  it("ignores anything else, and reports a draw it cannot do", () => {
    expect(parseKernelOp({ op: "canvas", id: "q1" })).toBeNull(); // it is pushed, not asked for
    expect(parseKernelOp("draw")).toBeNull();
    expect(parseKernelOp(null)).toBeNull();
    expect(typeof parseKernelOp({ op: "draw", nodes: [] })).toBe("string");
  });
});

describe("sizeLabel", () => {
  it("is short", () => {
    expect(sizeLabel({ kind: "DataFrame", shape: [1200, 3] })).toBe(
      "1,200 × 3",
    );
    expect(sizeLabel({ kind: "ndarray", shape: [200] })).toBe("(200,)");
    expect(sizeLabel({ kind: "ndarray", shape: [2, 3, 4] })).toBe("(2, 3, 4)");
    expect(sizeLabel({ kind: "list", length: 12 })).toBe("n=12");
    expect(sizeLabel({ kind: "RandomForest" })).toBe("");
  });
});

describe("parseReply: what the notebook reports on its own", () => {
  it("accepts the state of the cells", () => {
    expect(
      parseReply({
        proto: PROTOCOL,
        type: "run",
        cells: [
          { ord: 1, count: 3, state: "running" },
          { ord: 2, count: null, state: "idle" },
        ],
      }),
    ).toMatchObject({ type: "run" });
  });

  it("refuses a malformed state", () => {
    for (const cells of [
      "x",
      [{ ord: -1, count: 1, state: "idle" }],
      [{ ord: 1, count: "1", state: "idle" }],
      [{ ord: 1, count: 1, state: "paused" }],
      [null],
      Array.from({ length: 2001 }, (_, i) => ({
        ord: i,
        count: null,
        state: "idle",
      })),
    ]) {
      expect(parseReply({ proto: PROTOCOL, type: "run", cells })).toBeNull();
    }
  });

  it("accepts and trims the variables", () => {
    const r = parseReply({
      proto: PROTOCOL,
      type: "vars",
      vars: {
        df: { kind: "DataFrame", shape: [10, 2], columns: ["a", "b", 5] },
        bad: "x",
        worse: { shape: [1] },
        huge: { kind: "ndarray", shape: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
      },
    });
    expect(r).toMatchObject({ type: "vars" });
    const vars = (r as { vars: Record<string, unknown> }).vars;
    expect(Object.keys(vars).sort()).toEqual(["df", "huge"]);
    expect(vars.df).toEqual({
      kind: "DataFrame",
      shape: [10, 2],
      columns: ["a", "b"],
    });
    expect(vars.huge).toEqual({ kind: "ndarray" }); // 9 dimensions: no shape
  });

  it("passes a kernel message on untouched (live.ts checks it)", () => {
    expect(
      parseReply({
        proto: PROTOCOL,
        type: "kernel",
        commId: "c1",
        data: { op: "x" },
      }),
    ).toEqual({
      proto: PROTOCOL,
      type: "kernel",
      commId: "c1",
      data: { op: "x" },
    });
    expect(
      parseReply({ proto: PROTOCOL, type: "kernel", data: {} }),
    ).toBeNull();
  });
});
