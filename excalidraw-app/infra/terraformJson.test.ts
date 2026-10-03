import { parseTerraformJson, refAddress } from "./terraformJson";

const plan = {
  format_version: "1.2",
  terraform_version: "1.7.0",
  planned_values: {
    root_module: {
      resources: [
        {
          address: "aws_instance.web[0]",
          mode: "managed",
          type: "aws_instance",
          name: "web",
        },
        {
          address: "aws_instance.web[1]",
          mode: "managed",
          type: "aws_instance",
          name: "web",
        },
        {
          address: "aws_db_instance.main",
          mode: "managed",
          type: "aws_db_instance",
          name: "main",
        },
        {
          address: "aws_vpc.main",
          mode: "managed",
          type: "aws_vpc",
          name: "main",
        },
        {
          address: "data.aws_ami.ubuntu",
          mode: "data",
          type: "aws_ami",
          name: "ubuntu",
        },
        {
          address: "random_pet.n",
          mode: "managed",
          type: "random_pet",
          name: "n",
        },
      ],
      child_modules: [
        {
          address: "module.cache",
          resources: [
            {
              address: "module.cache.aws_elasticache_cluster.c",
              mode: "managed",
              type: "aws_elasticache_cluster",
              name: "c",
            },
          ],
        },
      ],
    },
  },
  resource_changes: [
    {
      address: "aws_s3_bucket.logs",
      mode: "managed",
      type: "aws_s3_bucket",
      name: "logs",
    },
  ],
  configuration: {
    root_module: {
      resources: [
        {
          address: "aws_instance.web",
          expressions: {
            ami: {
              references: ["data.aws_ami.ubuntu.id", "data.aws_ami.ubuntu"],
            },
            user_data: {
              references: [
                "aws_db_instance.main.address",
                "aws_db_instance.main",
                "module.cache.endpoint",
                "var.x",
              ],
            },
            subnet_id: { references: ["aws_vpc.main.id", "aws_vpc.main"] },
            nested: [{ block: { references: ["aws_s3_bucket.logs.arn"] } }],
          },
        },
        {
          address: "aws_db_instance.main",
          expressions: {},
          depends_on: ["aws_vpc.main"],
        },
      ],
      module_calls: {
        cache: {
          module: {
            resources: [
              {
                address: "aws_elasticache_cluster.c",
                expressions: { x: { references: ["data.aws_ami.ubuntu"] } },
              },
            ],
          },
        },
      },
    },
  },
};

describe("parseTerraformJson", () => {
  const g = parseTerraformJson(JSON.stringify(plan));
  const ids = g.nodes.map((n) => n.id).sort();
  const has = (from: string, to: string) =>
    g.edges.some((e) => e.from === `tf:${from}` && e.to === `tf:${to}`);

  it("draws one box per resource (instances collapsed) and leaves out noise and network", () => {
    expect(ids).toEqual(
      [
        "tf:aws_instance.web",
        "tf:aws_db_instance.main",
        "tf:data.aws_ami.ubuntu",
        "tf:module.cache.aws_elasticache_cluster.c",
        "tf:aws_s3_bucket.logs",
      ].sort(),
    );
    expect(g.notes).toEqual([
      expect.stringContaining("Left out 1 network or IAM resource"),
    ]);
  });

  it("draws arrows from the references a plan records", () => {
    expect(has("aws_instance.web", "data.aws_ami.ubuntu")).toBe(true);
    expect(has("aws_instance.web", "aws_db_instance.main")).toBe(true);
    expect(has("aws_instance.web", "aws_s3_bucket.logs")).toBe(true);
  });

  it("draws the network too when asked", () => {
    const d = parseTerraformJson(JSON.stringify(plan), { details: true });
    expect(d.nodes.map((n) => n.id)).toContain("tf:aws_vpc.main");
    expect(
      d.edges.some(
        (e) => e.from === "tf:aws_instance.web" && e.to === "tf:aws_vpc.main",
      ),
    ).toBe(true);
    expect(
      d.edges.some(
        (e) =>
          e.from === "tf:aws_db_instance.main" && e.to === "tf:aws_vpc.main",
      ),
    ).toBe(true);
  });

  it("reads a state with depends_on", () => {
    const state = {
      format_version: "1.0",
      terraform_version: "1.7.0",
      values: {
        root_module: {
          resources: [
            {
              address: "aws_instance.a",
              mode: "managed",
              type: "aws_instance",
              name: "a",
              depends_on: ["aws_db_instance.b"],
            },
            {
              address: "aws_db_instance.b",
              mode: "managed",
              type: "aws_db_instance",
              name: "b",
            },
          ],
        },
      },
    };
    const s = parseTerraformJson(JSON.stringify(state));
    expect(s.nodes).toHaveLength(2);
    expect(s.edges).toHaveLength(1);
  });

  it("explains what is wrong", () => {
    expect(() => parseTerraformJson("{")).toThrow(/valid JSON/);
    expect(() => parseTerraformJson("{}")).toThrow(/No resources/);
  });
});

describe("refAddress", () => {
  it("reduces a reference to the address of a block", () => {
    expect(refAddress("aws_db_instance.main.address")).toBe(
      "aws_db_instance.main",
    );
    expect(refAddress("aws_instance.web[0].id")).toBe("aws_instance.web");
    expect(refAddress("data.aws_ami.x.id")).toBe("data.aws_ami.x");
    expect(refAddress("module.vpc.vpc_id")).toBe("module.vpc");
    expect(refAddress("aws_vpc.main.id", "module.net.")).toBe(
      "module.net.aws_vpc.main",
    );
    expect(refAddress("var.region")).toBeNull();
    expect(refAddress("local.tags")).toBeNull();
  });
});
