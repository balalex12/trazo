import { MAX_NODES } from "./graph";
import { parseJson } from "./json";

const byTitle = (g: ReturnType<typeof parseJson>, title: string) =>
  g.nodes.find((n) => n.lines[0] === title)!;

describe("parseJson", () => {
  const g = parseJson(
    JSON.stringify({
      id: 1,
      name: "Ada",
      active: true,
      nothing: null,
      tags: ["a", "b", "c", "d", "e"],
      empty: {},
      address: { city: "London", geo: { lat: 51.5, lng: -0.12 } },
    }),
  );

  it("draws the root with its simple fields and one box per nested object", () => {
    expect(g.nodes[0].lines).toEqual([
      "📐 root",
      "id: 1",
      'name: "Ada"',
      "active: true",
      "nothing: null",
      'tags: ["a", "b", "c", "d", …] (5)',
      "empty: {}",
    ]);
    expect(byTitle(g, "📐 address").lines[1]).toBe('city: "London"');
    expect(byTitle(g, "📐 geo").lines).toContain("lat: 51.5");
    const edge = (a: string, b: string) =>
      g.edges.some(
        (e) => e.from === byTitle(g, a).id && e.to === byTitle(g, b).id,
      );
    expect(edge("📐 root", "📐 address")).toBe(true);
    expect(edge("📐 address", "📐 geo")).toBe(true);
  });

  it("counts fields it does not list", () => {
    const wide = parseJson(
      JSON.stringify(
        Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`k${i}`, i])),
      ),
    );
    expect(wide.nodes[0].lines).toHaveLength(1 + 9 + 1);
    expect(wide.nodes[0].lines.at(-1)).toBe("… +5 more fields");
  });

  it("draws a list of similar objects once, with a count", () => {
    const list = parseJson(
      JSON.stringify({
        users: Array.from({ length: 500 }, (_, i) => ({
          id: i,
          name: `u${i}`,
        })),
      }),
    );
    expect(list.nodes).toHaveLength(3); // root, users, one item
    expect(byTitle(list, "📚 users").lines[1]).toBe("list · 500 items");
    expect(list.edges.find((e) => e.label)!.label).toBe("×500");
  });

  it("shows each different shape in a list", () => {
    const list = parseJson(
      JSON.stringify([{ a: 1 }, { a: 2 }, { b: "x" }, { a: 3 }]),
    );
    const labels = list.edges.map((e) => e.label).sort();
    expect(labels).toEqual(["×1", "×3"]);
    expect(list.nodes[0].role).toBe("app"); // the root
  });

  it("reads a list of simple values and nested lists", () => {
    expect(parseJson("[1, 2, 3]").nodes[0].lines).toEqual([
      "📚 root",
      "list · 3 items",
      "[1, 2, 3] (3)",
    ]);
    const nested = parseJson("[[1, 2], [3]]");
    expect(nested.nodes.length).toBeGreaterThan(1);
  });

  it("says what it cannot draw", () => {
    expect(() => parseJson("{nope")).toThrow(/not valid JSON/);
    expect(() => parseJson("42")).toThrow(/single value/);
    expect(() => parseJson('"text"')).toThrow(/single value/);
  });

  it("stays small on huge and deep documents", () => {
    let deep: unknown = { leaf: 1 };
    for (let i = 0; i < 40; i++) {
      deep = { child: deep };
    }
    const d = parseJson(JSON.stringify(deep));
    expect(d.nodes.length).toBeLessThanOrEqual(12);
    expect(d.notes?.[0]).toMatch(/left out/);

    const wide = parseJson(
      JSON.stringify(
        Object.fromEntries(
          Array.from({ length: 400 }, (_, i) => [
            `o${i}`,
            { a: { b: { c: i } } },
          ]),
        ),
      ),
    );
    expect(wide.nodes.length).toBeLessThanOrEqual(MAX_NODES);
  });
});
