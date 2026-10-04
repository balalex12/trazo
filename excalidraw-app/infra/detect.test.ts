import { MAX_INPUT_CHARS, detectFormat, importInfra } from "./detect";

const COMPOSE = "services:\n  web:\n    image: nginx\n    ports: ['80:80']\n";
const K8S =
  "apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: web }\nspec:\n  template:\n    metadata: { labels: { app: web } }\n    spec: { containers: [{ name: c, image: nginx }] }\n";
const TF = 'resource "aws_instance" "web" {\n  ami = "x"\n}\n';
const OPENAPI_YAML =
  "openapi: 3.0.0\ninfo: { title: Pets, version: '1' }\npaths:\n  /pets:\n    get: { responses: { '200': { description: ok } } }\n";
const OPENAPI_JSON = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Pets", version: "1" },
  paths: { "/pets": { get: {} } },
});
const SQL = "CREATE TABLE users (id int primary key, name text);";
const DBT = JSON.stringify({
  metadata: { dbt_schema_version: "x", project_name: "shop" },
  nodes: {
    "model.shop.a": {
      resource_type: "model",
      name: "a",
      package_name: "shop",
      depends_on: { nodes: [] },
    },
  },
});
const N8N = JSON.stringify({
  nodes: [{ name: "Start", type: "n8n-nodes-base.manualTrigger" }],
  connections: {},
});

describe("detectFormat", () => {
  it("tells the formats apart", () => {
    expect(detectFormat(COMPOSE)).toBe("compose");
    expect(detectFormat(K8S)).toBe("kubernetes");
    expect(detectFormat(TF)).toBe("terraform");
    expect(detectFormat(OPENAPI_YAML)).toBe("openapi");
    expect(detectFormat(OPENAPI_JSON)).toBe("openapi");
    expect(detectFormat(SQL)).toBe("sql");
    expect(detectFormat(DBT)).toBe("dbt");
    expect(detectFormat(N8N)).toBe("n8n");
  });

  it("reads several Kubernetes documents and a List", () => {
    expect(detectFormat(`${K8S}---\n${K8S}`)).toBe("kubernetes");
    expect(detectFormat("apiVersion: v1\nkind: List\nitems: []\n")).toBe(
      "kubernetes",
    );
  });

  it("accepts compose and Kubernetes written as JSON", () => {
    expect(detectFormat('{"services":{"a":{"image":"x"}}}')).toBe("compose");
    expect(detectFormat('{"apiVersion":"v1","kind":"List","items":[]}')).toBe(
      "kubernetes",
    );
  });

  it("recognizes Terraform JSON (a plan or a state)", () => {
    expect(detectFormat('{"format_version":"1.2","planned_values":{}}')).toBe(
      "terraform",
    );
    expect(
      detectFormat(
        '{"format_version":"1.0","terraform_version":"1.5","values":{}}',
      ),
    ).toBe("terraform");
  });

  it("does not take a Kubernetes manifest that mentions a table for SQL", () => {
    expect(
      detectFormat(
        `${K8S}---\napiVersion: v1\nkind: ConfigMap\ndata:\n  s: "create table x (a int)"\n`,
      ),
    ).toBe("kubernetes");
  });

  it("sends a Helm template to the Kubernetes reader, which explains it", () => {
    expect(
      detectFormat("apiVersion: v1\nkind: Service\nname: {{ .Values.n }}\n"),
    ).toBe("kubernetes");
  });

  it("returns null for anything else", () => {
    expect(detectFormat("")).toBeNull();
    expect(detectFormat("hello world")).toBeNull();
    expect(detectFormat("a: 1\nb: 2")).toBeNull();
    expect(detectFormat('{"hello":"world"}')).toBeNull();
  });
});

describe("importInfra", () => {
  it("lays out each format", () => {
    for (const [text, format] of [
      [COMPOSE, "compose"],
      [K8S, "kubernetes"],
      [TF, "terraform"],
      [OPENAPI_YAML, "openapi"],
      [SQL, "sql"],
      [DBT, "dbt"],
      [N8N, "n8n"],
    ] as const) {
      const r = importInfra(text);
      expect(r.format).toBe(format);
      expect(r.layout.nodes.length).toBeGreaterThan(0);
    }
  });

  it("explains what it cannot do", () => {
    expect(() => importInfra("")).toThrow(/Paste/);
    expect(() => importInfra("hello world")).toThrow(/could not recognise/);
    expect(() =>
      importInfra('{"format_version":"1","planned_values":{}}'),
    ).toThrow(/No resources found/);
  });

  it("passes the Terraform details option on", () => {
    const text =
      'resource "aws_vpc" "v" {}\nresource "aws_instance" "i" { subnet_id = aws_vpc.v.id }\n';
    expect(importInfra(text).layout.nodes.map((n) => n.id)).toEqual([
      "tf:aws_instance.i",
    ]);
    expect(
      importInfra(text, { details: true })
        .layout.nodes.map((n) => n.id)
        .sort(),
    ).toEqual(["tf:aws_instance.i", "tf:aws_vpc.v"]);
  });
});

describe("input limits", () => {
  it("refuses text over the limit with a clear message, before reading it", () => {
    const huge = `services:\n${" ".repeat(MAX_INPUT_CHARS)}`;
    expect(() => importInfra(huge)).toThrow(/too big to draw/);
    expect(() =>
      importInfra(`services:\n  a:\n    image: x\n${" ".repeat(1000)}`),
    ).not.toThrow();
  });
});
