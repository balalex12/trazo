// Terraform (.tf, HCL) -> architecture graph (pure, no DOM). Deterministic and offline: it does not run Terraform, it
// reads the files. Every resource, data source and module is a box; an arrow goes from a block to every other block
// whose address (aws_db_instance.main, module.vpc, data.aws_ami.ubuntu…) appears in it, which is exactly how Terraform
// itself builds its dependency graph, plus `depends_on`. Comments are ignored.
import { MAX_NODES, ROLE_STYLE, clip } from "./graph";

import type { Graph, GraphEdge, GraphNode, Role } from "./graph";

// ---- scanning HCL ---------------------------------------------------------------------------------------------

/** index just after the string that opens at `i` (a quote), skipping `${ … }` interpolations with their own quotes */
const skipString = (s: string, i: number): number => {
  let k = i + 1;
  while (k < s.length) {
    const c = s[k];
    if (c === "\\") {
      k += 2;
    } else if (c === '"') {
      return k + 1;
    } else if (c === "$" && s[k + 1] === "{") {
      k = skipInterpolation(s, k + 2);
    } else {
      k++;
    }
  }
  return s.length;
};

/** index just after the `}` that closes an interpolation whose content starts at `i` */
const skipInterpolation = (s: string, i: number): number => {
  let depth = 1;
  let k = i;
  while (k < s.length && depth > 0) {
    const c = s[k];
    if (c === '"') {
      k = skipString(s, k);
      continue;
    }
    if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
    }
    k++;
  }
  return k;
};

/** index just after a heredoc (<<EOT … EOT) that starts at `i`, or -1 when `i` is not one */
const skipHeredoc = (s: string, i: number): number => {
  const m = /^<<-?([A-Za-z_][A-Za-z0-9_]*)[ \t]*\r?\n/.exec(s.slice(i, i + 80));
  if (!m) {
    return -1;
  }
  // the heredoc ends on the first line that holds only the marker (no regex is built from the input)
  let pos = i + m[0].length;
  while (pos < s.length) {
    let eol = s.indexOf("\n", pos);
    if (eol < 0) {
      eol = s.length;
    }
    const line = s.slice(pos, eol);
    if (line.trim() === m[1]) {
      return pos + line.trimEnd().length;
    }
    pos = eol + 1;
  }
  return s.length;
};

/** the text without # // and block comments (kept inside strings and heredocs), newlines preserved */
export const stripComments = (s: string): string => {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      const e = skipString(s, i);
      out += s.slice(i, e);
      i = e;
    } else if (c === "<" && s[i + 1] === "<") {
      const e = skipHeredoc(s, i);
      if (e < 0) {
        out += c;
        i++;
      } else {
        out += s.slice(i, e);
        i = e;
      }
    } else if (c === "#" || (c === "/" && s[i + 1] === "/")) {
      while (i < s.length && s[i] !== "\n") {
        i++;
      }
    } else if (c === "/" && s[i + 1] === "*") {
      const e = s.indexOf("*/", i + 2);
      const stop = e < 0 ? s.length : e + 2;
      out += s.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
};

/** index of the `}` that closes the `{` at `open` */
const matchBrace = (s: string, open: number): number => {
  let depth = 0;
  let i = open;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      i = skipString(s, i);
      continue;
    }
    if (c === "<" && s[i + 1] === "<") {
      const e = skipHeredoc(s, i);
      if (e >= 0) {
        i = e;
        continue;
      }
    }
    if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
    i++;
  }
  return s.length;
};

export type Block = { kind: string; labels: string[]; body: string };

/** the top level blocks: resource "t" "n" { … }, data, module, variable, output, provider, locals, terraform */
export const scanBlocks = (src: string): Block[] => {
  const blocks: Block[] = [];
  const re =
    /\b(resource|data|module|variable|output|provider|locals|terraform)\b((?:[ \t]+"[^"\n]*")*)[ \t]*\{/g;
  let i = 0;
  while (i < src.length) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) {
      break;
    }
    const open = m.index + m[0].length - 1;
    const close = matchBrace(src, open);
    blocks.push({
      kind: m[1],
      labels: [...m[2].matchAll(/"([^"\n]*)"/g)].map((x) => x[1]),
      body: src.slice(open + 1, close),
    });
    i = close + 1;
  }
  return blocks;
};

// ---- what each resource is --------------------------------------------------------------------------------------

// first match wins
const ROLE_RULES: [Role, RegExp][] = [
  [
    "function",
    /lambda_function|function_app|cloudfunctions|cloud_function|cloud_run|app_runner|container_app\b/,
  ],
  [
    "auth",
    /(^|_)(iam|kms|key_vault|secretsmanager|secret_manager|cognito|azuread|role_assignment|service_account|ssm_parameter)(_|$)/,
  ],
  ["cache", /elasticache|redis|memcache|memorydb/],
  [
    "database",
    /db_instance|rds_|aurora|dynamodb|cosmosdb|(^|_)sql_|mssql|postgresql|mysql|mariadb|redshift|bigquery|spanner|firestore|bigtable|documentdb|neptune|timestream|db_cluster/,
  ],
  [
    "queue",
    /(^|_)(sqs|sns_topic|kinesis|msk|eventhub|servicebus|pubsub|eventbridge|mq_broker|eventgrid)(_|$)/,
  ],
  [
    "storage",
    /s3_bucket|storage_account|storage_bucket|storage_container|(^|_)(efs|ebs|filestore|blob)(_|$)/,
  ],
  [
    "monitoring",
    /cloudwatch|(^|_)monitor(_|$)|logging_|log_analytics|application_insights|prometheus|grafana/,
  ],
  [
    "network",
    /(^|_)(vpc|subnet|subnetwork|security_group|nat_gateway|internet_gateway|route_table|route|network_interface|virtual_network|network_security_group|firewall|vnet|network_acl|eip)(_|$)/,
  ],
  [
    "proxy",
    /(^|_)(lb|alb|elb|loadbalancer|load_balancer|api_gateway|apigateway|apigatewayv2|cloudfront|front_door|application_gateway|cdn|route53|dns|ingress)(_|$)|route53|cloudfront/,
  ],
];

export const terraformRole = (type: string): Role => {
  for (const [role, re] of ROLE_RULES) {
    if (re.test(type)) {
      return role;
    }
  }
  return "app";
};

// plumbing that only adds noise to an architecture picture
const NOISE_TYPE =
  /^(random_|null_|time_|tls_|local_|template_|terraform_data|archive_)/;
const NOISE_DATA =
  /policy_document|caller_identity|(^|_)region$|availability_zones|partition|iam_session_context|aws_default_tags/;

const label = (kind: string, labels: string[]) => {
  if (kind === "module") {
    return `module.${labels[0]}`;
  }
  if (kind === "data") {
    return `data.${labels[0]}.${labels[1]}`;
  }
  return `${labels[0]}.${labels[1]}`;
};

const isWordChar = (c: string | undefined) => !!c && /\w/.test(c);

/** whether `address` appears in `body` as a whole reference, not as part of a longer name or attribute path */
const mentions = (body: string, address: string): boolean => {
  let from = 0;
  for (;;) {
    const at = body.indexOf(address, from);
    if (at < 0) {
      return false;
    }
    const before = body[at - 1];
    const after = body[at + address.length];
    if (
      !(isWordChar(before) || before === "." || before === "-") &&
      !(isWordChar(after) || after === "-")
    ) {
      return true;
    }
    from = at + 1;
  }
};

export type TerraformOptions = {
  /** also draw network (VPC, subnets, security groups…) and IAM/KMS resources */
  details?: boolean;
};

/** one resource, data source or module, however it was read (HCL text or plan/state JSON) */
export type TfEntry = {
  kind: "resource" | "data" | "module";
  address: string;
  /** the resource type, or "module" */
  type: string;
  name: string;
  /** modules: where the code comes from */
  source?: string;
  /** whether this entry refers to the thing at `address` */
  refersTo: (address: string) => boolean;
};

/** the filtering, naming and arrows that are the same for every way of reading Terraform */
export const entriesToGraph = (
  entries: TfEntry[],
  options: TerraformOptions = {},
): Graph => {
  type Item = { entry: TfEntry; node: GraphNode };
  const items: Item[] = [];
  const omitted: string[] = [];
  for (const e of entries) {
    if (
      e.kind !== "module" &&
      (NOISE_TYPE.test(e.type) ||
        (e.kind === "data" && NOISE_DATA.test(e.type)))
    ) {
      continue;
    }
    const role: Role = e.kind === "module" ? "app" : terraformRole(e.type);
    if (!options.details && (role === "network" || role === "auth")) {
      omitted.push(e.address);
      continue;
    }
    items.push({
      entry: e,
      node: {
        id: `tf:${e.address}`,
        role,
        dashed: e.kind === "data",
        lines: [
          `${e.kind === "module" ? "📦" : ROLE_STYLE[role].emoji} ${clip(
            e.name,
            24,
          )}`,
          clip(
            e.kind === "module"
              ? `module · ${e.source ?? ""}`
              : e.kind === "data"
              ? `data · ${e.type}`
              : e.type,
            30,
          ),
        ],
      },
    });
  }
  if (!items.length) {
    throw new Error(
      "Everything in there is network or IAM plumbing. Tick “Show network and IAM details” to draw it.",
    );
  }

  // an arrow from each entry to every other entry it refers to
  const edges: GraphEdge[] = [];
  for (const a of items) {
    for (const b of items) {
      if (a !== b && a.entry.refersTo(b.entry.address)) {
        edges.push({
          id: `dep:${a.node.id}>${b.node.id}`,
          from: a.node.id,
          to: b.node.id,
          kind: "depends",
        });
      }
    }
  }

  if (items.length > MAX_NODES) {
    throw new Error(
      `That is a lot to draw (${items.length} boxes). Paste fewer files, for example one module.`,
    );
  }
  return {
    nodes: items.map((i) => i.node),
    edges,
    ...(omitted.length
      ? {
          notes: [
            `Left out ${omitted.length} network or IAM resource${
              omitted.length > 1 ? "s" : ""
            } (tick “Show network and IAM details” to draw them)`,
          ],
        }
      : {}),
  };
};

export const parseTerraform = (
  text: string,
  options: TerraformOptions = {},
): Graph => {
  if (!text.trim()) {
    throw new Error("Paste Terraform files (.tf) first.");
  }
  const src = stripComments(text);
  const blocks = scanBlocks(src).filter((b) =>
    (b.kind === "resource" || b.kind === "data") && b.labels.length >= 2
      ? true
      : b.kind === "module" && b.labels.length >= 1,
  );
  if (!blocks.length) {
    throw new Error(
      "No Terraform resources, data sources or modules found. Paste .tf files with `resource` blocks.",
    );
  }
  const entries: TfEntry[] = blocks.map((b) => ({
    kind: b.kind as TfEntry["kind"],
    address: label(b.kind, b.labels),
    type: b.kind === "module" ? "module" : b.labels[0],
    name: b.labels[b.kind === "module" ? 0 : 1],
    source:
      b.kind === "module"
        ? /\bsource\s*=\s*"([^"]+)"/.exec(b.body)?.[1]
        : undefined,
    refersTo: (address) => mentions(b.body, address),
  }));
  return entriesToGraph(entries, options);
};
