import { detectFormat, importInfra } from "./detect";

const COMPOSE = "services:\n  web:\n    image: nginx\n    ports: ['80:80']\n";
const K8S =
  "apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: web }\nspec:\n  template:\n    metadata: { labels: { app: web } }\n    spec: { containers: [{ name: c, image: nginx }] }\n";
const TF = 'resource "aws_instance" "web" {\n  ami = "x"\n}\n';

describe("detectFormat", () => {
  it("tells the three formats apart", () => {
    expect(detectFormat(COMPOSE)).toBe("compose");
    expect(detectFormat(K8S)).toBe("kubernetes");
    expect(detectFormat(TF)).toBe("terraform");
  });

  it("reads several Kubernetes documents and a List", () => {
    expect(detectFormat(`${K8S}---\n${K8S}`)).toBe("kubernetes");
    expect(detectFormat("apiVersion: v1\nkind: List\nitems: []\n")).toBe(
      "kubernetes",
    );
  });

  it("accepts a compose file written as JSON", () => {
    expect(detectFormat('{"services":{"a":{"image":"x"}}}')).toBe("compose");
  });

  it("recognizes Terraform JSON so it can explain it", () => {
    expect(detectFormat('{"format_version":"1.2","planned_values":{}}')).toBe(
      "terraform-json",
    );
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
  });
});

describe("importInfra", () => {
  it("lays out each format", () => {
    for (const [text, format] of [
      [COMPOSE, "compose"],
      [K8S, "kubernetes"],
      [TF, "terraform"],
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
    ).toThrow(/Terraform JSON/);
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
