import {
  parseTerraform,
  scanBlocks,
  stripComments,
  terraformRole,
} from "./terraform";

const SAMPLE = `
terraform {
  required_providers { aws = { source = "hashicorp/aws" } }
}

# aws_s3_bucket.commented is only in a line comment
resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }
resource "aws_subnet" "a" { vpc_id = aws_vpc.main.id }
resource "aws_security_group" "web" {
  vpc_id = aws_vpc.main.id
  ingress { from_port = 80 }
}

data "aws_ami" "ubuntu" { most_recent = true }
data "aws_caller_identity" "me" {}

resource "aws_instance" "web" {
  ami                    = data.aws_ami.ubuntu.id
  subnet_id              = aws_subnet.a.id
  vpc_security_group_ids = [aws_security_group.web.id]
  user_data = <<-EOT
    #!/bin/bash
    echo "DB at \${aws_db_instance.main.address}"
  EOT
  tags = { Name = "\${var.name}-web" } // trailing comment
}

resource "aws_db_instance" "main" {
  engine = "postgres" /* aws_s3_bucket.logs is only in a block comment */
}
resource "aws_s3_bucket" "logs" { bucket = "logs" }
resource "aws_lb" "app" { subnets = [aws_subnet.a.id] }
resource "aws_lb_target_group_attachment" "web" { target_id = aws_instance.web.id }
resource "aws_iam_role" "exec" {}
resource "random_pet" "name" {}

module "cache" { source = "./modules/cache" }
resource "aws_sqs_queue" "jobs" { name = "\${module.cache.name}-jobs" }

variable "name" {}
output "url" { value = aws_lb.app.dns_name }
`;

describe("parseTerraform", () => {
  const g = parseTerraform(SAMPLE);
  const ids = g.nodes.map((n) => n.id);
  const has = (from: string, to: string) =>
    g.edges.some((e) => e.from === `tf:${from}` && e.to === `tf:${to}`);
  const node = (a: string) => g.nodes.find((n) => n.id === `tf:${a}`)!;

  it("draws resources, data sources and modules, and leaves out noise", () => {
    expect(ids.sort()).toEqual(
      [
        "tf:aws_instance.web",
        "tf:data.aws_ami.ubuntu",
        "tf:aws_db_instance.main",
        "tf:aws_s3_bucket.logs",
        "tf:aws_lb.app",
        "tf:aws_lb_target_group_attachment.web",
        "tf:module.cache",
        "tf:aws_sqs_queue.jobs",
      ].sort(),
    );
    // random_pet, the caller identity, variables and outputs are not architecture
    expect(ids.some((i) => /random_pet|caller_identity/.test(i))).toBe(false);
  });

  it("hides network and IAM by default and says so", () => {
    expect(g.notes).toEqual([
      expect.stringContaining("Left out 4 network or IAM resources"),
    ]);
  });

  it("draws an arrow from a block to every block it references", () => {
    expect(has("aws_instance.web", "data.aws_ami.ubuntu")).toBe(true);
    expect(has("aws_lb_target_group_attachment.web", "aws_instance.web")).toBe(
      true,
    );
    expect(has("aws_sqs_queue.jobs", "module.cache")).toBe(true);
  });

  it("sees a reference inside a heredoc and inside an interpolation", () => {
    expect(has("aws_instance.web", "aws_db_instance.main")).toBe(true);
  });

  it("ignores references that are only in comments", () => {
    expect(g.edges.some((e) => e.to === "tf:aws_s3_bucket.logs")).toBe(false);
  });

  it("colors by what the resource is", () => {
    expect(node("aws_db_instance.main").role).toBe("database");
    expect(node("aws_s3_bucket.logs").role).toBe("storage");
    expect(node("aws_lb.app").role).toBe("proxy");
    expect(node("aws_sqs_queue.jobs").role).toBe("queue");
    expect(node("aws_instance.web").role).toBe("app");
    expect(node("data.aws_ami.ubuntu").dashed).toBe(true);
    expect(node("module.cache").lines[1]).toBe("module · ./modules/cache");
  });

  it("draws network and IAM too when asked", () => {
    const d = parseTerraform(SAMPLE, { details: true });
    const hasD = (from: string, to: string) =>
      d.edges.some((e) => e.from === `tf:${from}` && e.to === `tf:${to}`);
    expect(d.nodes.map((n) => n.id)).toEqual(
      expect.arrayContaining([
        "tf:aws_vpc.main",
        "tf:aws_subnet.a",
        "tf:aws_security_group.web",
        "tf:aws_iam_role.exec",
      ]),
    );
    expect(hasD("aws_instance.web", "aws_subnet.a")).toBe(true);
    expect(hasD("aws_subnet.a", "aws_vpc.main")).toBe(true);
    expect(d.notes).toBeUndefined();
    expect(d.nodes.some((n) => n.id.includes("random_pet"))).toBe(false);
  });

  it("never draws an arrow to itself or to something not drawn", () => {
    for (const e of g.edges) {
      expect(e.from).not.toBe(e.to);
      expect(ids).toContain(e.from);
      expect(ids).toContain(e.to);
    }
  });
});

describe("parseTerraform: errors", () => {
  it("asks for resources", () => {
    expect(() => parseTerraform("  ")).toThrow(/Paste/);
    expect(() => parseTerraform('variable "x" {}')).toThrow(/No Terraform/);
  });

  it("points to the details switch when only plumbing was pasted", () => {
    expect(() =>
      parseTerraform(
        'resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }',
      ),
    ).toThrow(/network and IAM details/);
  });
});

describe("stripComments", () => {
  it("removes line and block comments but keeps strings and heredocs", () => {
    const out = stripComments(
      [
        'a = "http://example.com/#x" # gone',
        "b = 1 // gone",
        "c = 2 /* gone",
        "still gone */ d = 3",
        "e = <<EOT",
        "# kept: inside a heredoc",
        "EOT",
      ].join("\n"),
    );
    expect(out).toContain('"http://example.com/#x"');
    expect(out).not.toMatch(/gone\s*$/m);
    expect(out).toContain("d = 3");
    expect(out).toContain("# kept: inside a heredoc");
  });
});

describe("scanBlocks", () => {
  it("finds top level blocks with their labels, through nested braces and braces in strings", () => {
    const blocks = scanBlocks(
      `resource "a" "b" { x = "}" y = { z = 1 } w = "\${f("}")}" }\nmodule "m" { source = "s" }`,
    );
    expect(blocks.map((b) => [b.kind, ...b.labels])).toEqual([
      ["resource", "a", "b"],
      ["module", "m"],
    ]);
    expect(blocks[0].body).toContain("z = 1");
  });
});

describe("terraformRole", () => {
  it("recognizes common resources of the main clouds", () => {
    const cases: [string, string][] = [
      ["aws_lambda_function", "function"],
      ["aws_iam_role", "auth"],
      ["aws_elasticache_cluster", "cache"],
      ["aws_rds_cluster", "database"],
      ["azurerm_mssql_database", "database"],
      ["google_sql_database_instance", "database"],
      ["aws_sqs_queue", "queue"],
      ["google_pubsub_topic", "queue"],
      ["aws_s3_bucket", "storage"],
      ["azurerm_storage_account", "storage"],
      ["aws_cloudwatch_log_group", "monitoring"],
      ["aws_vpc", "network"],
      ["aws_route53_record", "proxy"],
      ["aws_cloudfront_distribution", "proxy"],
      ["aws_instance", "app"],
      ["google_compute_instance", "app"],
    ];
    for (const [type, role] of cases) {
      expect([type, terraformRole(type)]).toEqual([type, role]);
    }
  });
});
