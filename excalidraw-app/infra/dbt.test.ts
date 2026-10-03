import { dbtLayer, parseDbt } from "./dbt";

const manifest = {
  metadata: {
    dbt_schema_version: "https://schemas.getdbt.com/dbt/manifest/v11.json",
    project_name: "shop",
  },
  nodes: {
    "model.shop.stg_orders": {
      resource_type: "model",
      name: "stg_orders",
      package_name: "shop",
      schema: "analytics",
      config: { materialized: "view" },
      depends_on: { nodes: ["source.shop.raw.orders"] },
    },
    "model.shop.int_orders_enriched": {
      resource_type: "model",
      name: "int_orders_enriched",
      package_name: "shop",
      config: { materialized: "ephemeral" },
      depends_on: { nodes: ["model.shop.stg_orders", "seed.shop.countries"] },
    },
    "model.shop.fct_orders": {
      resource_type: "model",
      name: "fct_orders",
      package_name: "shop",
      config: { materialized: "table" },
      depends_on: { nodes: ["model.shop.int_orders_enriched"] },
    },
    "seed.shop.countries": {
      resource_type: "seed",
      name: "countries",
      package_name: "shop",
      depends_on: { nodes: [] },
    },
    "snapshot.shop.orders_snap": {
      resource_type: "snapshot",
      name: "orders_snap",
      package_name: "shop",
      depends_on: { nodes: ["model.shop.stg_orders"] },
    },
    "test.shop.not_null_orders_id": {
      resource_type: "test",
      name: "not_null_orders_id",
      package_name: "shop",
      depends_on: { nodes: ["model.shop.stg_orders"] },
    },
    "model.dbt_utils.helper": {
      resource_type: "model",
      name: "helper",
      package_name: "dbt_utils",
      depends_on: { nodes: [] },
    },
  },
  sources: {
    "source.shop.raw.orders": {
      resource_type: "source",
      source_name: "raw",
      name: "orders",
      package_name: "shop",
    },
  },
  exposures: {
    "exposure.shop.dashboard": {
      resource_type: "exposure",
      name: "sales_dashboard",
      package_name: "shop",
      depends_on: { nodes: ["model.shop.fct_orders"] },
    },
  },
};

describe("parseDbt", () => {
  const g = parseDbt(JSON.stringify(manifest));
  const ids = g.nodes.map((n) => n.id);
  const flows = (from: string, to: string) =>
    g.edges.some((e) => e.from === `dbt:${from}` && e.to === `dbt:${to}`);

  it("draws sources, seeds, snapshots, models and exposures, not tests or packages", () => {
    expect(ids.sort()).toEqual(
      [
        "dbt:source.shop.raw.orders",
        "dbt:model.shop.stg_orders",
        "dbt:model.shop.int_orders_enriched",
        "dbt:model.shop.fct_orders",
        "dbt:seed.shop.countries",
        "dbt:snapshot.shop.orders_snap",
        "dbt:exposure.shop.dashboard",
      ].sort(),
    );
    expect(g.notes).toEqual(["Left out 1 node from installed packages"]);
  });

  it("points arrows from the parent to what is built on it", () => {
    expect(flows("source.shop.raw.orders", "model.shop.stg_orders")).toBe(true);
    expect(
      flows("model.shop.stg_orders", "model.shop.int_orders_enriched"),
    ).toBe(true);
    expect(flows("seed.shop.countries", "model.shop.int_orders_enriched")).toBe(
      true,
    );
    expect(flows("model.shop.fct_orders", "exposure.shop.dashboard")).toBe(
      true,
    );
    expect(flows("model.shop.stg_orders", "snapshot.shop.orders_snap")).toBe(
      true,
    );
  });

  it("colors models by layer and names the materialization", () => {
    const n = (id: string) => g.nodes.find((x) => x.id === `dbt:${id}`)!;
    expect(n("model.shop.stg_orders").role).toBe("app");
    expect(n("model.shop.int_orders_enriched").role).toBe("function");
    expect(n("model.shop.fct_orders").role).toBe("database");
    expect(n("source.shop.raw.orders").role).toBe("storage");
    expect(n("model.shop.fct_orders").lines[1]).toBe("model · table");
    expect(n("source.shop.raw.orders").lines[0]).toContain("raw.orders");
  });

  it("guesses the layer from the name", () => {
    expect(dbtLayer("stg_x")).toBe("app");
    expect(dbtLayer("int_x")).toBe("function");
    expect(dbtLayer("dim_customers")).toBe("database");
    expect(dbtLayer("anything")).toBe("app");
  });

  it("falls back to parent_map and finds the project by itself", () => {
    const g2 = parseDbt(
      JSON.stringify({
        metadata: { dbt_schema_version: "x" },
        nodes: {
          "model.p.a": { resource_type: "model", name: "a", package_name: "p" },
          "model.p.b": { resource_type: "model", name: "b", package_name: "p" },
          "model.q.c": { resource_type: "model", name: "c", package_name: "q" },
        },
        parent_map: { "model.p.b": ["model.p.a"] },
      }),
    );
    expect(g2.nodes).toHaveLength(2);
    expect(g2.edges).toHaveLength(1);
  });

  it("explains what is wrong", () => {
    expect(() => parseDbt("{")).toThrow(/valid JSON/);
    expect(() => parseDbt("{}")).toThrow(/manifest/);
    expect(() => parseDbt(JSON.stringify({ metadata: {}, nodes: {} }))).toThrow(
      /no models/,
    );
  });
});
