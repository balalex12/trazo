import { PROTOCOL, diagramToPython, originOf, parseReply } from "./protocol";

import type { CanvasIndex } from "../agent/canvas";

/* eslint-disable @typescript-eslint/no-explicit-any */

const node = (key: string, label: string, details = "", role?: string) =>
  ({ key, label, details, role } as any);

const index = (over: Partial<CanvasIndex> = {}): CanvasIndex => ({
  nodes: new Map([
    ["a", node("a", "API", "port 80", "application")],
    ["b", node("b", 'DB "main"', "", "database")],
  ]),
  edges: [{ from: "a", to: "b", label: "reads", arrow: {} as any }],
  nodeOf: new Map(),
  frames: [],
  looseArrows: 0,
  ...over,
});

describe("parseReply", () => {
  it("accepts the four replies", () => {
    expect(parseReply({ proto: PROTOCOL, type: "ready" })).toEqual({
      proto: PROTOCOL,
      type: "ready",
    });
    expect(
      parseReply({
        proto: PROTOCOL,
        type: "notebook",
        id: "1",
        path: "a.ipynb",
        text: "{}",
      }),
    ).toMatchObject({ type: "notebook", path: "a.ipynb" });
    expect(
      parseReply({
        proto: PROTOCOL,
        type: "inserted",
        id: "2",
        path: "a.ipynb",
      }),
    ).toMatchObject({ type: "inserted" });
    expect(
      parseReply({ proto: PROTOCOL, type: "error", id: "3", message: "no" }),
    ).toMatchObject({ type: "error", message: "no" });
  });

  it("refuses everything else", () => {
    for (const bad of [
      null,
      "ready",
      42,
      {},
      { type: "ready" },
      { proto: "other/1", type: "ready" },
      { proto: PROTOCOL, type: "evil", id: "1" },
      { proto: PROTOCOL, type: "notebook", id: "1", path: "a" }, // no text
      { proto: PROTOCOL, type: "notebook", path: "a", text: "{}" }, // no id
      { proto: PROTOCOL, type: "error", id: "1", message: 5 },
    ]) {
      expect(parseReply(bad)).toBeNull();
    }
  });
});

describe("originOf", () => {
  it("gives the origin of an absolute URL", () => {
    expect(originOf("http://127.0.0.1:3002/lab/index.html")).toBe(
      "http://127.0.0.1:3002",
    );
    expect(originOf("not a url")).toBeNull();
  });
});

describe("diagramToPython", () => {
  it("writes the boxes and arrows as two pandas tables", () => {
    const py = diagramToPython(index())!;
    expect(py).toContain("# Diagram from Trazo: 2 boxes, 1 arrows");
    expect(py).toContain(
      '{"id": "n1", "label": "API", "details": "port 80", "role": "application"}',
    );
    expect(py).toContain('"label": "DB \\"main\\""'); // quotes are escaped
    expect(py).toContain('{"from": "n1", "to": "n2", "label": "reads"}');
    expect(py.trim().endsWith("nodes, edges")).toBe(true);
  });

  it("leaves out arrows whose ends are not boxes", () => {
    const py = diagramToPython(
      index({
        edges: [{ from: "a", to: "gone", label: "", arrow: {} as any }],
      }),
    )!;
    expect(py).toContain("0 arrows");
    expect(py).not.toContain('{"from"');
  });

  it("has nothing to send for an empty canvas", () => {
    expect(diagramToPython(index({ nodes: new Map(), edges: [] }))).toBeNull();
  });

  it("cannot carry code out through a label", () => {
    const py = diagramToPython(
      index({
        nodes: new Map([
          [
            "a",
            node(
              "a",
              '"); import os; os.system("x"); ("',
              "\n__import__('os')",
            ),
          ],
        ]),
        edges: [],
      }),
    )!;
    // the quote is escaped and the newline is an escape, so the label stays inside one string literal
    expect(py).toContain('\\"); import os; os.system(\\"x\\"); (\\"');
    expect(py).toContain("\\n__import__");
    expect(py.split("\n").filter((l) => l.includes("__import__"))).toHaveLength(
      1,
    );
  });
});
