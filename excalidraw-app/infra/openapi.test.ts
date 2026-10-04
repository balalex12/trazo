import { parseOpenApi } from "./openapi";

const SPEC = `
openapi: 3.0.3
info: { title: Pet Store, version: 1.2.0 }
servers: [{ url: https://api.example.com/v1 }]
tags: [{ name: pets }, { name: store }]
paths:
  /pets:
    get:
      tags: [pets]
      responses:
        "200":
          content:
            application/json:
              schema: { type: array, items: { $ref: "#/components/schemas/Pet" } }
    post:
      tags: [pets]
      requestBody:
        content:
          application/json:
            schema: { $ref: "#/components/schemas/NewPet" }
  /pets/{id}:
    get:
      tags: [pets]
      parameters: [{ name: id, in: path }]
    delete:
      tags: [pets]
  /store/orders:
    post:
      requestBody:
        content: { application/json: { schema: { $ref: "#/components/schemas/Order" } } }
  /health:
    get: {}
components:
  securitySchemes:
    oauth: { type: oauth2 }
    key: { type: apiKey }
  schemas:
    Pet:
      type: object
      properties: { id: { type: integer }, name: { type: string }, owner: { $ref: "#/components/schemas/Owner" } }
    NewPet: { type: object, properties: { name: { type: string } } }
    Owner: { type: object, properties: { name: { type: string } } }
    Order: { type: object, properties: { petId: { type: integer } } }
    Unused: { type: object }
`;

describe("parseOpenApi", () => {
  const g = parseOpenApi(SPEC);
  const ids = g.nodes.map((n) => n.id);
  const has = (from: string, to: string) =>
    g.edges.some((e) => e.from === from && e.to === to);

  it("draws clients, the API, security, one box per tag and the schemas in use", () => {
    expect(ids.sort()).toEqual(
      [
        "clients",
        "api",
        "security",
        "tag:pets",
        "tag:store",
        "tag:health",
        "schema:Pet",
        "schema:NewPet",
        "schema:Owner",
        "schema:Order",
      ].sort(),
    );
    expect(ids).not.toContain("schema:Unused");
  });

  it("describes the API", () => {
    const api = g.nodes.find((n) => n.id === "api")!;
    expect(api.lines[0]).toContain("Pet Store");
    expect(api.lines.join("\n")).toMatch(/OpenAPI v1\.2\.0/);
    expect(api.lines.join("\n")).toContain("6 endpoints");
    expect(api.lines.join("\n")).toContain("https://api.example.com/v1");
  });

  it("groups endpoints by tag, falling back to the first path segment", () => {
    const pets = g.nodes.find((n) => n.id === "tag:pets")!.lines;
    expect(pets).toContain("GET /pets");
    expect(pets).toContain("DELETE /pets/{id}");
    const store = g.nodes.find((n) => n.id === "tag:store")!.lines;
    expect(store).toContain("POST /store/orders");
  });

  it("connects tags to the schemas they use, and schemas to the schemas they use", () => {
    expect(has("clients", "api")).toBe(true);
    expect(has("api", "tag:pets")).toBe(true);
    expect(has("tag:pets", "schema:Pet")).toBe(true);
    expect(has("tag:pets", "schema:NewPet")).toBe(true);
    expect(has("schema:Pet", "schema:Owner")).toBe(true);
    expect(has("tag:store", "schema:Order")).toBe(true);
  });

  it("lists security schemes", () => {
    const sec = g.nodes.find((n) => n.id === "security")!.lines.join("\n");
    expect(sec).toContain("oauth (oauth2)");
    expect(sec).toContain("key (apiKey)");
  });

  it("reads JSON and Swagger 2", () => {
    const json = parseOpenApi(
      JSON.stringify({
        swagger: "2.0",
        info: { title: "Old", version: "1" },
        host: "x.test",
        basePath: "/api",
        paths: {
          "/a": {
            get: {
              responses: { "200": { schema: { $ref: "#/definitions/A" } } },
            },
          },
        },
        definitions: { A: { properties: { x: {} } } },
      }),
    );
    expect(json.nodes.map((n) => n.id)).toContain("schema:A");
    expect(json.nodes.find((n) => n.id === "api")!.lines.join("\n")).toContain(
      "x.test/api",
    );
  });

  it("limits a huge API and says so", () => {
    const paths: Record<string, unknown> = {};
    for (let i = 0; i < 60; i++) {
      paths[`/t${i}/x`] = { get: {} };
    }
    const big = parseOpenApi(JSON.stringify({ openapi: "3.0.0", paths }));
    expect(big.nodes.filter((n) => n.id.startsWith("tag:"))).toHaveLength(40);
    expect(big.notes?.[0]).toContain("Not drawn: 20 more tags");
  });

  it("explains what is wrong", () => {
    expect(() => parseOpenApi("a: 1")).toThrow(/OpenAPI/);
    expect(() => parseOpenApi("openapi: 3.0.0\npaths: {}")).toThrow(
      /no endpoints/,
    );
  });
});

describe("errors do not repeat the file", () => {
  it("shows only the first line of a YAML error", () => {
    let message = "";
    try {
      parseOpenApi("openapi: 3.0.0\npaths: [unclosed\nsecret_token: abc123");
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("not valid YAML");
    expect(message).not.toContain("\n");
    expect(message).not.toContain("secret_token");
  });
});
