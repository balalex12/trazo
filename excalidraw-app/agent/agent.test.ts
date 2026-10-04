import { layoutGraph } from "../infra/graph";

import { buildIndex, summarize } from "./canvas";
import { defaultCtx } from "./elements";
import { layoutToElements } from "./fromLayout";
import { applyOps, MAX_OPS } from "./ops";
import { AGENT_SYSTEM, buildUserTurn, parseAgentReply } from "./prompt";

import type { Graph } from "../infra/graph";
import type { El } from "./elements";

const graph: Graph = {
  nodes: [
    { id: "web", role: "proxy", lines: ["Web"] },
    { id: "api", role: "app", lines: ["API"] },
    { id: "db", role: "database", lines: ["Database"] },
  ],
  edges: [
    { id: "w>a", from: "web", to: "api", kind: "depends", label: "https" },
    { id: "a>d", from: "api", to: "db", kind: "depends" },
  ],
};

const make = (): El[] => layoutToElements(layoutGraph(graph));
const idOf = (els: El[], label: string) => {
  const n = [...buildIndex(els).nodes.values()].find((x) => x.label === label);
  if (!n) {
    throw new Error(`no node ${label}`);
  }
  return n.key;
};
const live = (els: El[]) => els.filter((e) => !e.isDeleted);

/** every arrow binds to live elements that list it, and nothing lists a missing element */
const integrity = (els: El[]) => {
  const ls = live(els);
  const byId = new Map(ls.map((e) => [e.id, e]));
  const problems: string[] = [];
  for (const e of ls) {
    for (const b of e.boundElements || []) {
      if (!byId.has(b.id)) {
        problems.push(`${e.id} lists missing ${b.id}`);
      }
    }
    if (e.type === "arrow") {
      for (const side of ["startBinding", "endBinding"]) {
        const t = e[side] && byId.get(e[side].elementId);
        if (!t) {
          problems.push(`arrow ${e.id} ${side} points at nothing`);
        } else if (!(t.boundElements || []).some((b: El) => b.id === e.id)) {
          problems.push(`${t.id} does not list arrow ${e.id}`);
        }
      }
    }
    if (e.type === "text" && e.containerId && !byId.has(e.containerId)) {
      problems.push(`text ${e.id} has no container`);
    }
  }
  return problems;
};
const noOverlap = (els: El[]) => {
  const boxes = [...buildIndex(els).nodes.values()].map((n) => n.box);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y
      ) {
        return false;
      }
    }
  }
  return true;
};

describe("canvas summary", () => {
  it("lists boxes with labels and roles, and arrows between them", () => {
    const els = make();
    expect(integrity(els)).toEqual([]);
    const s = summarize(els);
    expect(s.nodes.map((n) => n.label).sort()).toEqual([
      "API",
      "Database",
      "Web",
    ]);
    expect(s.nodes.find((n) => n.label === "Database")?.role).toBe("database");
    expect(s.edges).toHaveLength(2);
    const web = idOf(els, "Web");
    const api = idOf(els, "API");
    expect(s.edges.find((e) => e.from === web && e.to === api)?.label).toBe(
      "https",
    );
  });

  it("treats a group of icons and texts as one node and reports the selection", () => {
    const base = { angle: 0, groupIds: ["G1"], isDeleted: false, version: 1 };
    const els: El[] = [
      { ...base, id: "i1", type: "image", x: 0, y: 0, width: 80, height: 80 },
      {
        ...base,
        id: "t1",
        type: "text",
        x: 0,
        y: 90,
        width: 80,
        height: 20,
        text: "Mobile",
      },
      {
        id: "r",
        type: "rectangle",
        x: 300,
        y: 0,
        width: 100,
        height: 60,
        groupIds: [],
        isDeleted: false,
        version: 1,
        boundElements: [{ type: "text", id: "rt" }],
      },
      {
        id: "rt",
        type: "text",
        containerId: "r",
        x: 310,
        y: 20,
        width: 60,
        height: 20,
        text: "Queue",
        groupIds: [],
        isDeleted: false,
        version: 1,
      },
    ];
    const s = summarize(els, ["t1"]);
    expect(s.nodes.map((n) => [n.id, n.label, n.kind])).toEqual([
      ["g:G1", "Mobile", "icon"],
      ["r", "Queue", "shape"],
    ]);
    expect(s.selected).toEqual(["g:G1"]);
  });

  it("ignores deleted elements and arrows that are not bound at both ends", () => {
    const els = make().map((e) =>
      e.type === "text" && e.text === "Web" ? { ...e, isDeleted: true } : e,
    );
    const idx = buildIndex(els);
    expect(idx.nodes.size).toBe(3); // the box is still there, only its text is gone
    const loose = [
      ...make(),
      {
        id: "x",
        type: "arrow",
        x: 0,
        y: 0,
        width: 5,
        height: 5,
        isDeleted: false,
        version: 1,
      },
    ];
    expect(summarize(loose).looseArrows).toBe(1);
  });
});

describe("applyOps", () => {
  it("puts a cache between the API and the database", () => {
    const els = make();
    const api = idOf(els, "API");
    const db = idOf(els, "Database");
    const r = applyOps(els, [
      {
        op: "add_node",
        id: "c",
        label: "Cache",
        role: "cache",
        between: [api, db],
      },
      { op: "delete_edge", from: api, to: db },
      { op: "add_edge", from: api, to: "c" },
      { op: "add_edge", from: "c", to: db },
    ]);
    expect(r.skipped).toEqual([]);
    expect(r.applied).toEqual([
      'Added "Cache"',
      'Removed the link between "API" and "Database"',
      'Linked "API" to "Cache"',
      'Linked "Cache" to "Database"',
    ]);
    expect(integrity(r.elements)).toEqual([]);
    expect(noOverlap(r.elements)).toBe(true);
    const idx = buildIndex(r.elements);
    const cache = [...idx.nodes.values()].find((n) => n.label === "Cache")!;
    expect(cache.role).toBe("cache");
    const links = idx.edges
      .map(
        (e) => `${idx.nodes.get(e.from)!.label}>${idx.nodes.get(e.to)!.label}`,
      )
      .sort();
    expect(links).toEqual(["API>Cache", "Cache>Database", "Web>API"]);
    // the cache sits between the two in x
    const a = idx.nodes.get(api)!.box;
    const d = idx.nodes.get(db)!.box;
    expect(cache.box.x).toBeGreaterThanOrEqual(a.x + a.width);
    expect(cache.box.x + cache.box.width).toBeLessThanOrEqual(d.x);
  });

  it("makes room by moving what is on the far side, and re-draws the arrows that moved", () => {
    const els = make();
    const api = idOf(els, "API");
    const db = idOf(els, "Database");
    const before = buildIndex(els).nodes.get(db)!.box.x;
    const r = applyOps(els, [
      {
        op: "add_node",
        label: "A very long label that needs a wide box",
        between: [api, db],
      },
    ]);
    const after = buildIndex(r.elements).nodes.get(db)!.box.x;
    expect(after).toBeGreaterThan(before);
    expect(integrity(r.elements)).toEqual([]);
    expect(noOverlap(r.elements)).toBe(true);
    // the old arrow api -> db now ends at the moved database
    const idx = buildIndex(r.elements);
    const arrow = idx.edges.find((e) => e.from === api && e.to === db)!.arrow;
    expect(arrow.x + arrow.points[1][0]).toBeLessThanOrEqual(after);
    expect(arrow.x + arrow.points[1][0]).toBeGreaterThan(after - 20);
  });

  it("adds a box near another one and lets later operations use its name", () => {
    const els = make();
    const web = idOf(els, "Web");
    const r = applyOps(els, [
      { op: "add_node", id: "n1", label: "Auth", role: "auth", near: web },
      { op: "add_edge", from: web, to: "n1", label: "login" },
    ]);
    expect(r.skipped).toEqual([]);
    expect(integrity(r.elements)).toEqual([]);
    expect(noOverlap(r.elements)).toBe(true);
    const idx = buildIndex(r.elements);
    expect(
      idx.edges.find((e) => idx.nodes.get(e.to)!.label === "Auth")?.label,
    ).toBe("login");
  });

  it("puts a box with no hint below the diagram", () => {
    const els = make();
    const r = applyOps(els, [{ op: "add_node", label: "Notes" }]);
    const idx = buildIndex(r.elements);
    const bottom = Math.max(
      ...[...idx.nodes.values()]
        .filter((n) => n.label !== "Notes")
        .map((n) => n.box.y + n.box.height),
    );
    expect(
      [...idx.nodes.values()].find((n) => n.label === "Notes")!.box.y,
    ).toBeGreaterThan(bottom);
    expect(
      applyOps([], [{ op: "add_node", label: "First" }]).elements,
    ).toHaveLength(2);
  });

  it("renames a box (growing it when needed) and changes its role", () => {
    const els = make();
    const web = idOf(els, "Web");
    const before = buildIndex(els).nodes.get(web)!.box;
    const r = applyOps(els, [
      {
        op: "update_node",
        id: web,
        label: "Public web application and its CDN edge",
        role: "proxy",
      },
      { op: "update_node", id: idOf(els, "Database"), role: "cache" },
    ]);
    expect(r.skipped).toEqual([]);
    const idx = buildIndex(r.elements);
    const n = idx.nodes.get(web)!;
    expect(n.label).toBe("Public web application and its CDN edge");
    expect(n.box.width).toBeGreaterThan(before.width);
    // grows around its center, so arrows stay attached
    expect(n.box.x + n.box.width / 2).toBeCloseTo(before.x + before.width / 2);
    expect(idx.nodes.get(idOf(els, "Database"))!.role).toBe("cache");
    expect(integrity(r.elements)).toEqual([]);
  });

  it("deletes a box with its arrows and their labels, leaving nothing dangling", () => {
    const els = make();
    const api = idOf(els, "API");
    const r = applyOps(els, [{ op: "delete_node", id: api }]);
    expect(r.applied).toEqual(['Deleted "API" and its arrows']);
    const ls = live(r.elements);
    expect(ls.some((e) => e.type === "arrow")).toBe(false);
    expect(ls.some((e) => e.type === "text" && e.text === "https")).toBe(false);
    expect(integrity(r.elements)).toEqual([]);
    expect(buildIndex(r.elements).nodes.size).toBe(2);
  });

  it("moves a box and re-draws its arrows", () => {
    const els = make();
    const db = idOf(els, "Database");
    const r = applyOps(els, [{ op: "move_node", id: db, x: 900, y: 500 }]);
    const idx = buildIndex(r.elements);
    expect(idx.nodes.get(db)!.box).toMatchObject({ x: 900, y: 500 });
    const arrow = idx.edges.find((e) => e.to === db)!.arrow;
    expect(arrow.x + arrow.points[1][0]).toBeGreaterThan(800);
    expect(integrity(r.elements)).toEqual([]);
  });

  it("does not link twice, to itself, or to something that is not there", () => {
    const els = make();
    const web = idOf(els, "Web");
    const api = idOf(els, "API");
    const r = applyOps(els, [
      { op: "add_edge", from: web, to: api },
      { op: "add_edge", from: web, to: web },
      { op: "add_edge", from: web, to: "nope" },
      { op: "delete_edge", from: api, to: web },
      { op: "update_node", id: "nope", label: "x" },
      { op: "delete_node", id: "nope" },
      { op: "update_node", id: web },
      { op: "add_node", label: "  " },
      { op: "teleport" },
      "not an operation",
      { op: "move_node", id: web, x: "left", y: 1 },
    ]);
    expect(r.applied.length).toBe(1); // only the reverse arrow removal worked
    expect(r.skipped).toHaveLength(10);
    expect(r.skipped[0]).toContain("already linked");
    expect(integrity(r.elements)).toEqual([]);
  });

  it("only reads the first operations of a very long list, and ignores a non-list", () => {
    const many = Array.from({ length: MAX_OPS + 5 }, (_, i) => ({
      op: "add_node",
      label: `N${i}`,
    }));
    const r = applyOps([], many);
    expect(live(r.elements).filter((e) => e.type === "rectangle")).toHaveLength(
      MAX_OPS,
    );
    expect(r.skipped[0]).toContain(`first ${MAX_OPS}`);
    expect(noOverlap(r.elements)).toBe(true);
    expect(applyOps(make(), "nope")).toMatchObject({
      applied: [],
      skipped: [],
    });
  });

  it("does not change the elements it was given", () => {
    const els = make();
    const copy = JSON.stringify(els);
    applyOps(els, [{ op: "delete_node", id: idOf(els, "API") }]);
    expect(JSON.stringify(els)).toBe(copy);
  });

  it("keeps an alias that collides with an existing id from hijacking it", () => {
    const els = make();
    const api = idOf(els, "API");
    const r = applyOps(els, [{ op: "add_node", id: api, label: "Impostor" }]);
    expect(r.skipped[0]).toContain("already used");
    expect(buildIndex(r.elements).nodes.get(api)!.label).toBe("API");
  });
});

describe("a box with several lines of text", () => {
  const table: Graph = {
    nodes: [
      {
        id: "t",
        role: "database",
        lines: ["orders", "id  int", "total  numeric"],
      },
      { id: "u", role: "database", lines: ["users", "id  int"] },
    ],
    edges: [{ id: "t>u", from: "t", to: "u", kind: "depends" }],
  };
  const els = layoutToElements(layoutGraph(table));

  it("names the box by its first line and keeps the rest as details", () => {
    const s = summarize(els);
    const orders = s.nodes.find((n) => n.label === "orders")!;
    expect(orders.details).toBe("id  int | total  numeric");
    expect(s.nodes.find((n) => n.label === "users")!.details).toBe("id  int");
  });

  it("renaming changes only the name and keeps the other lines", () => {
    const id = idOf(els, "orders");
    const r = applyOps(els, [{ op: "update_node", id, label: "purchases" }]);
    const text = live(r.elements).find(
      (e) => e.type === "text" && String(e.text).startsWith("purchases"),
    )!;
    expect(text.text).toBe(
      ["purchases", "id  int", "total  numeric"].join("\n"),
    );
    expect(
      summarize(r.elements).nodes.find((n) => n.label === "purchases")!.details,
    ).toBe("id  int | total  numeric");
    expect(integrity(r.elements)).toEqual([]);
  });
});

describe("fromLayout", () => {
  it("produces elements with unique ids that the canvas reads back", () => {
    const els = make();
    expect(new Set(els.map((e) => e.id)).size).toBe(els.length);
    expect(els.filter((e) => e.type === "arrow")).toHaveLength(2);
    // bound text sits inside its box
    for (const t of els.filter((e) => e.type === "text" && e.containerId)) {
      const c = els.find((e) => e.id === t.containerId)!;
      if (c.type !== "arrow") {
        expect(t.x).toBeGreaterThanOrEqual(c.x);
        expect(t.x + t.width).toBeLessThanOrEqual(c.x + c.width + 1);
      }
    }
    expect(defaultCtx().id()).toHaveLength(21);
  });
});

describe("talking to the model", () => {
  it("shows the canvas and the request", () => {
    const s = summarize(make());
    const turn = buildUserTurn(s, "  add a cache  ");
    expect(turn.startsWith("CANVAS:\n{")).toBe(true);
    expect(turn.endsWith("REQUEST:\nadd a cache")).toBe(true);
    expect(AGENT_SYSTEM).toContain("add_node");
    expect(AGENT_SYSTEM).toContain("database");
  });

  it("reads plain JSON, fenced JSON and JSON with words around it", () => {
    const json = '{"message":"Done","ops":[{"op":"delete_node","id":"a"}]}';
    expect(parseAgentReply(json)).toEqual({
      message: "Done",
      ops: [{ op: "delete_node", id: "a" }],
      plain: false,
    });
    expect(
      parseAgentReply(["```json", json, "```"].join("\n")).ops,
    ).toHaveLength(1);
    expect(parseAgentReply(`Sure! ${json} Hope it helps.`).message).toBe(
      "Done",
    );
  });

  it("falls back to showing the text when the answer is not the JSON shape", () => {
    expect(parseAgentReply("It is a three tier web app.")).toEqual({
      message: "It is a three tier web app.",
      ops: [],
      plain: true,
    });
    expect(parseAgentReply("{broken json").plain).toBe(true);
    expect(parseAgentReply('{"message":"hi"}')).toEqual({
      message: "hi",
      ops: [],
      plain: false,
    });
    expect(parseAgentReply('{"ops":"nope"}').ops).toEqual([]);
  });
});
