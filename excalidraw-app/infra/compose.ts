// docker-compose.yml -> a small model of the architecture (pure, no DOM). Deterministic: the file is read, nothing is
// guessed by a model. Layout and drawing live in graph.ts.
import { load } from "js-yaml";

import { ROLE_STYLE, clip } from "./graph";

import type { Graph, GraphEdge, GraphNode, Role } from "./graph";

export type { Role };

export type PortMapping = { host: string; container: string };

export type ComposeService = {
  name: string;
  image: string;
  /** built from a local Dockerfile instead of a published image */
  build: boolean;
  /** only ports published on the host */
  ports: PortMapping[];
  dependsOn: string[];
  /** named volumes only (bind mounts and anonymous volumes are skipped) */
  volumes: string[];
  role: Role;
};

export type ComposeModel = { services: ComposeService[]; volumes: string[] };

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// first match wins; matched against "<image> <service name>" in lower case
const ROLE_RULES: [Role, RegExp][] = [
  [
    "database",
    /postgres|mysql|mariadb|mongo|clickhouse|cassandra|cockroach|influx|timescale|couch|neo4j|elasticsearch|opensearch|sqlserver|mssql|oracle|db2|\bdb\b|database/,
  ],
  ["cache", /redis|memcache|valkey|dragonfly|\bcache\b/],
  [
    "queue",
    /rabbit|kafka|nats|activemq|redpanda|pulsar|mosquitto|mqtt|\bqueue\b|\bbroker\b/,
  ],
  [
    "proxy",
    /nginx|traefik|caddy|haproxy|envoy|apache|httpd|gateway|\bproxy\b|ingress/,
  ],
  [
    "monitoring",
    /grafana|prometheus|loki|kibana|jaeger|zipkin|alertmanager|telegraf|uptime|portainer|cadvisor|exporter/,
  ],
  ["auth", /keycloak|vault|authelia|authentik|oauth|\bauth\b|ldap|dex\b/],
  ["storage", /minio|\bs3\b|ceph|seaweed|nextcloud|registry/],
];

/** Anything not recognised is treated as an application service. */
export const detectRole = (name: string, image: string): Role => {
  const hay = `${image} ${name}`.toLowerCase();
  for (const [role, re] of ROLE_RULES) {
    if (re.test(hay)) {
      return role;
    }
  }
  return "app";
};

/** "8080:80", "127.0.0.1:8080:80/tcp", 80, { published: 8080, target: 80 } -> published mappings only */
const parsePort = (p: unknown): PortMapping | null => {
  if (isDict(p)) {
    const target = p.target;
    const published = p.published;
    return published !== undefined && target !== undefined
      ? { host: String(published), container: String(target) }
      : null;
  }
  if (typeof p !== "string" && typeof p !== "number") {
    return null;
  }
  const parts = String(p).split("/")[0].split(":");
  if (parts.length < 2) {
    return null; // "80": exposed to other containers only, not published
  }
  const container = parts[parts.length - 1];
  const host = parts[parts.length - 2];
  return host && container ? { host, container } : null;
};

const NOT_NAMED = /^[./~$]|[/\\]/;

const namedVolume = (v: unknown): string | null => {
  if (isDict(v)) {
    return v.type === "volume" && typeof v.source === "string"
      ? v.source
      : null;
  }
  if (typeof v !== "string") {
    return null;
  }
  const source = v.split(":")[0];
  return source && !NOT_NAMED.test(source) && v.includes(":") ? source : null;
};

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const dependsOnOf = (svc: Dict): string[] => {
  const d = svc.depends_on;
  const names = isDict(d) ? Object.keys(d) : asList(d).map(String);
  const links = asList(svc.links).map((l) => String(l).split(":")[0]);
  return [...new Set([...names, ...links])];
};

export const parseCompose = (text: string): ComposeModel => {
  if (!text.trim()) {
    throw new Error("Paste the contents of a docker-compose.yml first.");
  }
  let doc: unknown;
  try {
    doc = load(text);
  } catch (e) {
    throw new Error(
      `That is not valid YAML: ${(e as Error).message.split("\n")[0]}`,
    );
  }
  if (!isDict(doc) || !isDict(doc.services)) {
    throw new Error(
      "No `services:` section found. This looks like something other than a docker-compose file.",
    );
  }
  const names = Object.keys(doc.services);
  if (!names.length) {
    throw new Error("The `services:` section is empty.");
  }
  const declaredVolumes = isDict(doc.volumes) ? Object.keys(doc.volumes) : [];
  const usedVolumes = new Set<string>();

  const services = names.map((name): ComposeService => {
    const raw = doc.services as Dict;
    const svc = isDict(raw[name]) ? (raw[name] as Dict) : {};
    const image =
      typeof svc.image === "string"
        ? svc.image
        : isDict(svc.build) || typeof svc.build === "string"
        ? "(built from source)"
        : "";
    const volumes = [
      ...new Set(
        asList(svc.volumes)
          .map(namedVolume)
          .filter((v): v is string => !!v),
      ),
    ];
    volumes.forEach((v) => usedVolumes.add(v));
    return {
      name,
      image,
      build: svc.build !== undefined,
      ports: asList(svc.ports)
        .map(parsePort)
        .filter((p): p is PortMapping => !!p),
      dependsOn: dependsOnOf(svc).filter(
        (d) => names.includes(d) && d !== name,
      ),
      volumes,
      role: detectRole(name, typeof svc.image === "string" ? svc.image : ""),
    };
  });

  // keep declaration order of named volumes, then any used but not declared
  const volumes = [
    ...declaredVolumes.filter((v) => usedVolumes.has(v)),
    ...[...usedVolumes].filter((v) => !declaredVolumes.includes(v)),
  ];
  return { services, volumes };
};

const serviceLines = (s: ComposeService): string[] => {
  const lines = [`${ROLE_STYLE[s.role].emoji} ${clip(s.name, 24)}`];
  if (s.image) {
    lines.push(clip(s.image, 30));
  }
  if (s.ports.length) {
    lines.push(
      clip(s.ports.map((p) => `${p.host}→${p.container}`).join(", "), 30),
    );
  }
  return lines;
};

/** The compose file as a graph: services, the Internet when ports are published, volumes under their first user. */
export const composeToGraph = (model: ComposeModel): Graph => {
  const sorted = [...model.services].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  if (sorted.some((s) => s.ports.length)) {
    nodes.push({ id: "internet", lines: ["🌐 Internet"], external: true });
  }
  for (const s of sorted) {
    nodes.push({ id: `svc:${s.name}`, role: s.role, lines: serviceLines(s) });
  }
  for (const v of model.volumes) {
    const owner = sorted.find((o) => o.volumes.includes(v));
    nodes.push({
      id: `vol:${v}`,
      lines: [`💾 ${clip(v, 22)}`],
      attachedTo: owner ? `svc:${owner.name}` : undefined,
    });
  }
  for (const s of sorted) {
    if (s.ports.length) {
      edges.push({
        id: `in:${s.name}`,
        from: "internet",
        to: `svc:${s.name}`,
        kind: "ingress",
        label: clip(
          s.ports.map((p) => `${p.host}→${p.container}`).join(", "),
          24,
        ),
      });
    }
    for (const d of s.dependsOn) {
      edges.push({
        id: `dep:${s.name}>${d}`,
        from: `svc:${s.name}`,
        to: `svc:${d}`,
        kind: "depends",
      });
    }
    for (const v of s.volumes) {
      edges.push({
        id: `vol:${s.name}>${v}`,
        from: `svc:${s.name}`,
        to: `vol:${v}`,
        kind: "attach",
      });
    }
  }
  return { nodes, edges };
};
