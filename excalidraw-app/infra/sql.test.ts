import { cleanName, parseSql, splitTop, stripSqlComments } from "./sql";

const DDL = `
-- the shop schema
CREATE TABLE public.customers (
  id        SERIAL PRIMARY KEY,
  email     VARCHAR(255) NOT NULL UNIQUE, -- login
  full_name TEXT
);

CREATE TABLE IF NOT EXISTS "orders" (
  id           bigint NOT NULL,
  customer_id  integer NOT NULL REFERENCES customers (id),
  placed_at    timestamp with time zone DEFAULT now(),
  parent_id    bigint,
  PRIMARY KEY (id),
  FOREIGN KEY (parent_id) REFERENCES orders(id)
);

CREATE TABLE order_items (
  order_id   bigint,
  product_id int,
  qty        int CHECK (qty > 0),
  CONSTRAINT pk_items PRIMARY KEY (order_id, product_id),
  CONSTRAINT fk_items_order FOREIGN KEY (order_id) REFERENCES "orders" (id)
);

CREATE TABLE products (id int primary key, name text, price numeric(10,2));
ALTER TABLE ONLY order_items ADD CONSTRAINT fk_prod FOREIGN KEY (product_id) REFERENCES public.products(id);
ALTER TABLE orders ADD FOREIGN KEY (parent_id) REFERENCES nowhere(id);
CREATE VIEW v AS SELECT 1;
`;

describe("parseSql", () => {
  const g = parseSql(DDL);
  const node = (name: string) => g.nodes.find((n) => n.id === `tbl:${name}`)!;
  const edge = (from: string, to: string) =>
    g.edges.find((e) => e.from === `tbl:${from}` && e.to === `tbl:${to}`);

  it("draws one box per table", () => {
    expect(g.nodes.map((n) => n.id).sort()).toEqual([
      "tbl:order_items",
      "tbl:orders",
      "tbl:products",
      "tbl:public.customers",
    ]);
  });

  it("marks primary keys, foreign keys and shows the types", () => {
    const customers = node("public.customers").lines;
    expect(customers[1]).toMatch(/🔑 id\s+SERIAL/);
    expect(customers[2]).toMatch(/· email\s+VARCHAR\(255\)/);
    const orders = node("orders").lines.join("\n");
    expect(orders).toMatch(/🔑 id/);
    expect(orders).toMatch(/🔗 customer_id\s+integer/);
    expect(orders).toMatch(/placed_at\s+timestamp/);
    expect(node("order_items").lines.join("\n")).toMatch(/🔑 order_id/);
    expect(node("order_items").lines.join("\n")).toMatch(/🔑 product_id/);
  });

  it("draws an arrow per foreign key, inline, table level and ALTER TABLE", () => {
    expect(edge("orders", "public.customers")?.label).toBe("customer_id");
    expect(edge("order_items", "orders")?.label).toBe("order_id");
    expect(edge("order_items", "products")?.label).toBe("product_id");
  });

  it("says what it left out", () => {
    expect(g.notes).toEqual([
      "1 self reference not drawn",
      "1 foreign key to tables that are not in the text",
      "Not drawn: 1 view",
    ]);
  });

  it("keeps a long table short", () => {
    const wide = parseSql(
      `CREATE TABLE t (${Array.from({ length: 12 }, (_, i) => `c${i} int`).join(
        ", ",
      )});`,
    );
    expect(wide.nodes[0].lines.length).toBe(1 + 8 + 1);
    expect(wide.nodes[0].lines.at(-1)).toBe("… +4 more");
  });

  it("reads MySQL and SQL Server styles", () => {
    const my = parseSql(
      "CREATE TABLE `a` (`id` INT AUTO_INCREMENT, `b_id` INT, PRIMARY KEY (`id`), KEY `k` (`b_id`), CONSTRAINT `f` FOREIGN KEY (`b_id`) REFERENCES `b` (`id`)) ENGINE=InnoDB;\nCREATE TABLE `b` (`id` INT PRIMARY KEY);",
    );
    expect(my.edges).toHaveLength(1);
    const ms = parseSql(
      "CREATE TABLE [dbo].[A] ([Id] int NOT NULL, [BId] int, CONSTRAINT [pk] PRIMARY KEY CLUSTERED ([Id]));\nGO\nCREATE TABLE [dbo].[B] ([Id] int);\nALTER TABLE [dbo].[A] ADD CONSTRAINT [fk] FOREIGN KEY ([BId]) REFERENCES [dbo].[B] ([Id]);",
    );
    expect(ms.nodes.map((n) => n.id)).toEqual(["tbl:dbo.a", "tbl:dbo.b"]);
    expect(ms.edges).toHaveLength(1);
  });

  it("asks for the right input", () => {
    expect(() => parseSql("  ")).toThrow(/Paste/);
    expect(() => parseSql("SELECT 1;")).toThrow(/No CREATE TABLE/);
  });
});

describe("helpers", () => {
  it("strips comments but not strings", () => {
    expect(stripSqlComments("a -- x\nb /* y */ c 'z -- w'")).toBe(
      `a \nb ${" ".repeat(7)} c 'z -- w'`,
    );
  });
  it("splits at top level only", () => {
    expect(splitTop("a, b(c, d), 'e,f', g", ",")).toEqual([
      "a",
      "b(c, d)",
      "'e,f'",
      "g",
    ]);
  });
  it("cleans quoted names", () => {
    expect(cleanName('"public"."Users"')).toBe("public.Users");
    expect(cleanName("[dbo].[A]")).toBe("dbo.A");
    expect(cleanName("`x`")).toBe("x");
  });
});
