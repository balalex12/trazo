import { layoutGraph } from "./graph";
import { looksLikeSqlQuery, parseSqlQuery } from "./sqlQuery";

import type { Graph } from "./graph";

const text = (g: Graph, startsWith: string) =>
  g.nodes.filter((n) => n.lines[0].startsWith(startsWith));
const one = (g: Graph, startsWith: string) => {
  const found = text(g, startsWith);
  expect([startsWith, found.length]).toEqual([startsWith, 1]);
  return found[0];
};
const flows = (g: Graph, from: string, to: string) =>
  g.edges.some((e) => e.from === from && e.to === to);
/** ids in the order the pipeline runs, following the single outgoing edge from `start` */
const chain = (g: Graph, start: string) => {
  const out = [start];
  for (;;) {
    const next = g.edges.filter((e) => e.from === out[out.length - 1]);
    if (next.length !== 1) {
      return out;
    }
    out.push(next[0].to);
  }
};
const firstLines = (g: Graph, ids: string[]) =>
  ids.map((id) => g.nodes.find((n) => n.id === id)!.lines[0]);

describe("parseSqlQuery: one SELECT", () => {
  const g = parseSqlQuery(`
    SELECT DISTINCT c.name, COUNT(*) AS orders
    FROM customers c
    JOIN orders o ON o.customer_id = c.id
    LEFT JOIN regions r ON r.id = c.region_id
    WHERE o.status = 'paid'
    GROUP BY c.name
    HAVING COUNT(*) > 2
    ORDER BY orders DESC
    LIMIT 10 OFFSET 5`);

  it("shows the steps in the order the database runs them", () => {
    const customers = one(g, "🗄️ customers").id;
    const steps = firstLines(g, chain(g, customers).slice(1));
    expect(steps).toEqual([
      "⋈ INNER JOIN",
      "⋈ LEFT JOIN",
      "🔎 WHERE",
      "Σ GROUP BY",
      "🔎 HAVING",
      "SELECT DISTINCT",
      "↕ ORDER BY",
      "✂ LIMIT 10 OFFSET 5",
      "📤 Result",
    ]);
  });

  it("draws every table once, with its alias, feeding the join that uses it", () => {
    expect(g.nodes.filter((n) => n.role === "database")).toHaveLength(3);
    expect(one(g, "🗄️ orders").lines[1]).toBe("as o");
    expect(flows(g, one(g, "🗄️ orders").id, one(g, "⋈ INNER JOIN").id)).toBe(
      true,
    );
    expect(one(g, "⋈ LEFT JOIN").lines[1]).toBe("ON r.id = c.region_id");
  });

  it("names the aggregates and the output columns", () => {
    expect(one(g, "Σ GROUP BY").lines).toContain("→ orders");
    expect(one(g, "SELECT DISTINCT").lines).toEqual([
      "SELECT DISTINCT",
      "c.name",
      "orders ← COUNT(*)",
    ]);
  });

  it("ends in a result and lays out as a flow", () => {
    expect(one(g, "📤 Result")).toBeTruthy();
    const layout = layoutGraph(g);
    const x = (id: string) => layout.nodes.find((n) => n.id === id)!.x;
    expect(x(one(g, "🗄️ customers").id)).toBeLessThan(
      x(one(g, "📤 Result").id),
    );
  });
});

describe("parseSqlQuery: CTEs, subqueries and set operations", () => {
  it("draws each CTE as a box fed by its own pipeline and used where it is referenced", () => {
    const g = parseSqlQuery(`
      WITH a AS (SELECT id FROM t1 WHERE x = 1),
           b AS (SELECT id FROM a JOIN t2 ON t2.id = a.id)
      SELECT * FROM b JOIN a ON a.id = b.id`);
    const a = one(g, "📦 WITH a").id;
    const b = one(g, "📦 WITH b").id;
    const joins = text(g, "⋈ INNER JOIN").map((n) => n.id);
    expect(joins).toHaveLength(2);
    expect(flows(g, a, joins[0])).toBe(true); // b's own join reads a
    // the final join reads both b and a
    expect(flows(g, b, joins[1])).toBe(true);
    expect(flows(g, a, joins[1])).toBe(true);
    // a CTE is not drawn twice as a table
    expect(g.nodes.filter((n) => n.lines[0] === "🗄️ a")).toHaveLength(0);
  });

  it("draws a subquery in FROM and one in WHERE feeding the step that uses it", () => {
    const g = parseSqlQuery(`
      SELECT s.id FROM (SELECT id FROM t WHERE ok) s
      WHERE s.id IN (SELECT id FROM u) AND EXISTS (SELECT 1 FROM v WHERE v.id = s.id)`);
    expect(one(g, "⤷ subquery s")).toBeTruthy();
    const where = g.edges.find((e) => e.label === "IN")!.to;
    const labels = g.edges.filter((e) => e.to === where).map((e) => e.label);
    expect(labels).toContain("IN");
    expect(labels).toContain("EXISTS");
    expect(g.nodes.filter((n) => n.role === "database")).toHaveLength(3);
  });

  it("joins the sides of a UNION and sorts the combined result", () => {
    const g = parseSqlQuery(
      `SELECT a FROM t1 UNION ALL SELECT a FROM t2 ORDER BY a LIMIT 3`,
    );
    const u = one(g, "∪ UNION ALL").id;
    expect(g.edges.filter((e) => e.to === u)).toHaveLength(2);
    expect(firstLines(g, chain(g, u).slice(1))).toEqual([
      "↕ ORDER BY",
      "✂ LIMIT 3",
      "📤 Result",
    ]);
    // the ORDER BY is not attached to the second SELECT only
    expect(text(g, "↕ ORDER BY")).toHaveLength(1);
  });

  it("reads parenthesized sides and EXCEPT / INTERSECT", () => {
    const g = parseSqlQuery(
      `(SELECT a FROM t1) EXCEPT (SELECT a FROM t2) INTERSECT SELECT a FROM t3`,
    );
    expect(text(g, "−")).toHaveLength(1);
    expect(text(g, "∩")).toHaveLength(1);
  });

  it("shows window functions and an aggregate without GROUP BY", () => {
    const g = parseSqlQuery(
      `SELECT id, ROW_NUMBER() OVER (PARTITION BY k ORDER BY d) rn FROM t QUALIFY rn = 1`,
    );
    expect(one(g, "SELECT").lines).toContain("(1 window function)");
    expect(one(g, "SELECT").lines[2]).toMatch(/^rn ← ROW_NUMBER\(\) OVER/);
    expect(one(g, "🔎 QUALIFY")).toBeTruthy();
    const h = parseSqlQuery(`SELECT COUNT(*), MAX(x) FROM t`);
    expect(one(h, "Σ AGGREGATE")).toBeTruthy();
  });
});

describe("parseSqlQuery: statements that change data", () => {
  it("INSERT ... SELECT feeds the table it fills", () => {
    const g = parseSqlQuery(
      `INSERT INTO archive (id, name) SELECT id, name FROM users WHERE old`,
    );
    const insert = one(g, "➕ INSERT");
    expect(insert.lines[1]).toBe("(id, name)");
    const target = g.nodes.find((n) => n.lines[1] === "rows added")!;
    expect(target.lines[0]).toBe("🗄️ archive");
    expect(flows(g, insert.id, target.id)).toBe(true);
    expect(one(g, "🗄️ users")).toBeTruthy();
  });

  it("INSERT ... VALUES counts the rows and keeps ON CONFLICT", () => {
    const g = parseSqlQuery(
      `INSERT INTO t (a) VALUES (1), (2), (3) ON CONFLICT (a) DO NOTHING RETURNING a`,
    );
    expect(one(g, "VALUES").lines[1]).toBe("3 rows");
    expect(one(g, "➕ INSERT").lines.join(" ")).toMatch(/ON CONFLICT/);
  });

  it("UPDATE ... FROM, DELETE ... USING and MERGE", () => {
    const u = parseSqlQuery(
      `UPDATE orders o SET status = 'x', total = 0 FROM customers c WHERE c.id = o.customer_id`,
    );
    expect(one(u, "✏️ UPDATE SET").lines).toContain("status = 'x'");
    expect(u.nodes.some((n) => n.lines[1] === "rows changed")).toBe(true);
    expect(one(u, "🗄️ customers")).toBeTruthy();

    const d = parseSqlQuery(
      `DELETE FROM sessions s USING users u WHERE u.id = s.user_id AND u.banned`,
    );
    expect(one(d, "🗑️ DELETE")).toBeTruthy();
    expect(d.nodes.some((n) => n.lines[1] === "rows removed")).toBe(true);

    const m = parseSqlQuery(`
      MERGE INTO stock t USING deliveries d ON t.sku = d.sku
      WHEN MATCHED THEN UPDATE SET qty = t.qty + d.qty
      WHEN NOT MATCHED THEN INSERT (sku, qty) VALUES (d.sku, d.qty)`);
    expect(one(m, "⋈ MERGE ON").lines[1]).toBe("t.sku = d.sku");
    expect(text(m, "WHEN")).toHaveLength(2);
  });

  it("CREATE VIEW AS and CREATE TABLE AS draw the query and the thing it creates", () => {
    const v = parseSqlQuery(
      `CREATE OR REPLACE VIEW v_active AS SELECT id FROM users WHERE active`,
    );
    expect(
      v.nodes.some(
        (n) => n.lines.join("|") === "🗄️ v_active|created as a view",
      ),
    ).toBe(true);
    const t = parseSqlQuery(`CREATE TABLE copy AS (SELECT * FROM src)`);
    expect(t.nodes.some((n) => n.lines[1] === "created from the query")).toBe(
      true,
    );
  });
});

describe("parseSqlQuery: robustness", () => {
  it("ignores comments and keywords inside strings and function calls", () => {
    const g = parseSqlQuery(`
      -- from nowhere where
      SELECT EXTRACT(year FROM d) AS y, 'a from b where c' AS s /* order by x */
      FROM events WHERE a IS DISTINCT FROM b`);
    expect(g.nodes.filter((n) => n.role === "database")).toHaveLength(1);
    expect(text(g, "↕ ORDER BY")).toHaveLength(0);
    expect(one(g, "🔎 WHERE").lines[1]).toBe("a IS DISTINCT FROM b");
  });

  it("draws several statements and says what it skipped", () => {
    const g = parseSqlQuery(
      `SELECT 1; GRANT ALL ON t TO bob; SELECT a FROM t;`,
    );
    expect(text(g, "📤 Result")).toHaveLength(2);
    expect(one(g, "📤 Result 1")).toBeTruthy();
    expect(g.notes?.[0]).toMatch(/1 statement not drawn/);
  });

  it("handles schema-qualified and quoted names, comma joins and table functions", () => {
    const g = parseSqlQuery(
      `SELECT * FROM "public"."Users" u, generate_series(1, 3) g, other o WHERE u.id = o.id`,
    );
    expect(one(g, "🗄️ public.Users")).toBeTruthy();
    expect(text(g, "ƒ")).toHaveLength(1);
    expect(text(g, "⋈ CROSS JOIN")).toHaveLength(2);
  });

  it("explains what it cannot draw", () => {
    expect(() => parseSqlQuery("")).toThrow(/Paste/);
    expect(() => parseSqlQuery("GRANT ALL ON t TO bob")).toThrow(/No SELECT/);
  });

  it("never throws anything but a readable error, for any cut of a query", () => {
    const sql = `WITH a AS (SELECT x, SUM(y) s FROM t JOIN u ON u.id = t.id WHERE z IN (SELECT 1) GROUP BY x)
      SELECT a.x, (SELECT MAX(q) FROM w) m FROM a LEFT JOIN (SELECT 1 k) k ON k.k = a.x
      UNION SELECT 1, 2 ORDER BY 1 LIMIT 5; UPDATE t SET a = 1 FROM u WHERE t.id = u.id;`;
    for (let i = 1; i < sql.length; i += 3) {
      try {
        parseSqlQuery(sql.slice(0, i));
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    }
  });

  it("stops at a sane size", () => {
    const big = Array.from(
      { length: 160 },
      (_, i) => `SELECT a FROM t${i}`,
    ).join(" UNION ALL ");
    expect(() => parseSqlQuery(big)).toThrow(/too big/);
  });
});

describe("looksLikeSqlQuery", () => {
  it("accepts queries", () => {
    for (const q of [
      "select 1",
      "SELECT a FROM t",
      "with x as (select 1) select * from x",
      "insert into t values (1)",
      "update t set a = 1",
      "delete from t",
      "-- note\nSELECT * FROM t",
      "create view v as select 1",
      "create table t as select 1",
    ]) {
      expect([q, looksLikeSqlQuery(q)]).toEqual([q, true]);
    }
  });

  it("does not take prose or other formats", () => {
    for (const q of [
      "update your profile soon",
      "with love, the team",
      "select one of the options below",
      "services:\n  web:\n    image: x",
      "CREATE INDEX i ON t (a)",
    ]) {
      expect([q, looksLikeSqlQuery(q)]).toEqual([q, false]);
    }
  });
});
