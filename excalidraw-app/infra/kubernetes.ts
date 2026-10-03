// Kubernetes manifests -> architecture graph (pure, no DOM). Deterministic: the YAML is read and the relations that
// Kubernetes itself defines are followed (selectors, ingress backends, references to config and claims). One thing is
// inferred and says so on the arrow: a workload that names a Service in an environment variable value.
import { loadAll } from "js-yaml";

import { detectRole } from "./compose";
import { MAX_NODES, ROLE_STYLE, clip } from "./graph";

import type { Graph, GraphEdge, GraphNode, Role } from "./graph";

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string =>
  typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
const get = (o: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((acc, k) => (isDict(acc) ? acc[k] : undefined), o);
const dict = (v: unknown): Dict => (isDict(v) ? v : {});

const WORKLOADS = new Set([
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "ReplicaSet",
  "Job",
  "CronJob",
  "Pod",
]);
const HANDLED = new Set([
  ...WORKLOADS,
  "Service",
  "Ingress",
  "ConfigMap",
  "Secret",
  "PersistentVolumeClaim",
  "HorizontalPodAutoscaler",
]);

type Res = { kind: string; name: string; ns: string; raw: Dict };

const podTemplate = (r: Res): Dict => {
  if (r.kind === "Pod") {
    return r.raw;
  }
  const tpl =
    r.kind === "CronJob"
      ? get(r.raw, "spec", "jobTemplate", "spec", "template")
      : get(r.raw, "spec", "template");
  return dict(tpl);
};

const labelsOf = (tpl: Dict): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(dict(get(tpl, "metadata", "labels")))) {
    out[k] = str(v);
  }
  return out;
};

type PodInfo = {
  images: string[];
  /** [env var name, value] of plain values, to find the Services a workload talks to */
  env: [string, string][];
  configMaps: string[];
  secrets: string[];
  claims: string[];
};

const podInfo = (r: Res): PodInfo => {
  const spec = dict(get(podTemplate(r), "spec"));
  const info: PodInfo = {
    images: [],
    env: [],
    configMaps: [],
    secrets: [],
    claims: [],
  };
  const add = (list: string[], name: unknown) => {
    const n = str(name);
    if (n && !list.includes(n)) {
      list.push(n);
    }
  };
  for (const c of [
    ...asList(spec.containers),
    ...asList(spec.initContainers),
  ]) {
    const cont = dict(c);
    if (asList(spec.containers).includes(c)) {
      add(info.images, cont.image);
    }
    for (const e of asList(cont.env)) {
      const env = dict(e);
      if (typeof env.value === "string") {
        info.env.push([str(env.name), env.value]);
      }
      add(info.configMaps, get(env, "valueFrom", "configMapKeyRef", "name"));
      add(info.secrets, get(env, "valueFrom", "secretKeyRef", "name"));
    }
    for (const f of asList(cont.envFrom)) {
      add(info.configMaps, get(f, "configMapRef", "name"));
      add(info.secrets, get(f, "secretRef", "name"));
    }
  }
  for (const v of asList(spec.volumes)) {
    const vol = dict(v);
    add(info.configMaps, get(vol, "configMap", "name"));
    add(info.secrets, get(vol, "secret", "secretName"));
    add(info.claims, get(vol, "persistentVolumeClaim", "claimName"));
    for (const src of asList(get(vol, "projected", "sources"))) {
      add(info.configMaps, get(src, "configMap", "name"));
      add(info.secrets, get(src, "secret", "name"));
    }
  }
  return info;
};

/** "ghcr.io/org/app:1.2@sha256:…" -> "org/app:1.2" (no registry host, no digest) */
export const shortImage = (image: string) => {
  const [ref] = image.split("@");
  const parts = ref.split("/");
  return parts.length > 1 && /[.:]/.test(parts[0])
    ? parts.slice(1).join("/")
    : ref;
};

const portLine = (ports: unknown[]) =>
  clip(
    ports
      .map((p) => {
        const port = str(get(p, "port"));
        const target = str(get(p, "targetPort")) || port;
        return port === target ? port : `${port}→${target}`;
      })
      .filter(Boolean)
      .join(", "),
    30,
  );

const HELM_HELP =
  "This looks like a Helm template ({{ … }}). Render it first with `helm template`, then paste the result.";

export const parseKubernetes = (text: string): Graph => {
  if (!text.trim()) {
    throw new Error("Paste Kubernetes manifests (YAML) first.");
  }
  let docs: unknown[];
  try {
    docs = loadAll(text);
  } catch (e) {
    if (/\{\{.*\}\}/.test(text)) {
      throw new Error(HELM_HELP);
    }
    throw new Error(
      `That is not valid YAML: ${(e as Error).message.split("\n")[0]}`,
    );
  }

  const all: Res[] = [];
  const take = (d: unknown) => {
    if (!isDict(d) || typeof d.kind !== "string") {
      return;
    }
    if (d.kind === "List" || d.kind.endsWith("List")) {
      asList(d.items).forEach(take);
      return;
    }
    const name = str(get(d, "metadata", "name"));
    if (name) {
      all.push({
        kind: d.kind,
        name,
        ns: str(get(d, "metadata", "namespace")) || "default",
        raw: d,
      });
    }
  };
  docs.forEach(take);

  const of = (...kinds: string[]) => all.filter((r) => kinds.includes(r.kind));
  const workloads = all.filter((r) => WORKLOADS.has(r.kind));
  const services = of("Service");
  const ingresses = of("Ingress");
  if (!workloads.length && !services.length && !ingresses.length) {
    // a Helm template can still be valid YAML (`name: {{ .Release.Name }}`) and then yields nothing
    throw new Error(
      /\{\{.*\}\}/.test(text)
        ? HELM_HELP
        : "No Kubernetes workloads, Services or Ingresses found. Paste manifests such as Deployments, StatefulSets, Services and Ingresses.",
    );
  }

  const multiNs = new Set(all.map((r) => r.ns)).size > 1;
  const id = (prefix: string, ns: string, name: string) =>
    `${prefix}:${ns}/${name}`;
  const nsLine = (r: { ns: string }) => (multiNs ? [`ns: ${r.ns}`] : []);

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();
  const addNode = (n: GraphNode) => {
    if (!nodeIds.has(n.id)) {
      nodeIds.add(n.id);
      nodes.push(n);
    }
  };
  const edgeIds = new Set<string>();
  const addEdge = (e: GraphEdge) => {
    if (!edgeIds.has(e.id)) {
      edgeIds.add(e.id);
      edges.push(e);
    }
  };

  // autoscaling: a line on the workload it targets
  const hpa = new Map<string, string>();
  for (const h of of("HorizontalPodAutoscaler")) {
    const ref = dict(get(h.raw, "spec", "scaleTargetRef"));
    const min = str(get(h.raw, "spec", "minReplicas")) || "1";
    const max = str(get(h.raw, "spec", "maxReplicas"));
    if (str(ref.name) && max) {
      hpa.set(
        id("wl", h.ns, str(ref.name)),
        `autoscaled ${min}-${max} replicas`,
      );
    }
  }

  // ---- workloads
  const infos = new Map<string, PodInfo>();
  for (const w of workloads) {
    const info = podInfo(w);
    const wid = id("wl", w.ns, w.name);
    infos.set(wid, info);
    const role: Role =
      w.kind === "Job" || w.kind === "CronJob"
        ? "function"
        : detectRole(w.name, info.images.join(" "));
    const replicas = str(get(w.raw, "spec", "replicas"));
    const second =
      w.kind === "CronJob"
        ? `CronJob · ${str(get(w.raw, "spec", "schedule"))}`
        : replicas && w.kind !== "DaemonSet"
        ? `${w.kind} · ${replicas}×`
        : w.kind;
    addNode({
      id: wid,
      role,
      lines: [
        `${ROLE_STYLE[role].emoji} ${clip(w.name, 24)}`,
        clip(second, 30),
        ...(info.images.length
          ? [clip(info.images.map(shortImage).join(", "), 30)]
          : []),
        ...(hpa.has(wid) ? [hpa.get(wid)!] : []),
        ...nsLine(w),
      ],
    });
  }

  // ---- services (and the workloads their selectors pick)
  const hasInternet = { value: false };
  const entry = () => {
    if (!hasInternet.value) {
      hasInternet.value = true;
      addNode({ id: "internet", lines: ["🌐 Internet"], external: true });
    }
  };
  const serviceId = (ns: string, name: string) => id("svc", ns, name);
  for (const s of services) {
    const type = str(get(s.raw, "spec", "type")) || "ClusterIP";
    const ports = portLine(asList(get(s.raw, "spec", "ports")));
    const sid = serviceId(s.ns, s.name);
    addNode({
      id: sid,
      role: "network",
      lines: [
        `${ROLE_STYLE.network.emoji} ${clip(s.name, 24)}`,
        `Service · ${type}`,
        ...(ports ? [ports] : []),
        ...nsLine(s),
      ],
    });
    if (type === "LoadBalancer" || type === "NodePort") {
      entry();
      addEdge({
        id: `in:${sid}`,
        from: "internet",
        to: sid,
        kind: "ingress",
        label: ports,
      });
    }
    const selector = dict(get(s.raw, "spec", "selector"));
    const keys = Object.keys(selector);
    if (keys.length) {
      for (const w of workloads.filter((x) => x.ns === s.ns)) {
        const labels = labelsOf(podTemplate(w));
        if (keys.every((k) => labels[k] === str(selector[k]))) {
          addEdge({
            id: `sel:${sid}>${id("wl", w.ns, w.name)}`,
            from: sid,
            to: id("wl", w.ns, w.name),
            kind: "depends",
          });
        }
      }
    }
  }
  // a Service that an Ingress names but that was not pasted: shown dashed
  const ensureService = (ns: string, name: string) => {
    const sid = serviceId(ns, name);
    addNode({
      id: sid,
      role: "network",
      dashed: true,
      lines: [
        `${ROLE_STYLE.network.emoji} ${clip(name, 24)}`,
        "Service (not in what you pasted)",
        ...nsLine({ ns }),
      ],
    });
    return sid;
  };

  // ---- ingresses
  for (const ing of ingresses) {
    const iid = id("ing", ing.ns, ing.name);
    const rules = asList(get(ing.raw, "spec", "rules"));
    const hosts = [
      ...new Set(rules.map((r) => str(get(r, "host"))).filter(Boolean)),
    ];
    addNode({
      id: iid,
      role: "proxy",
      lines: [
        `${ROLE_STYLE.proxy.emoji} ${clip(ing.name, 24)}`,
        "Ingress",
        clip(hosts.join(", ") || "any host", 30),
        ...nsLine(ing),
      ],
    });
    entry();
    addEdge({
      id: `in:${iid}`,
      from: "internet",
      to: iid,
      kind: "ingress",
      label: clip(hosts.join(", "), 24),
    });
    let n = 0;
    const route = (backend: unknown, label: string) => {
      const name =
        str(get(backend, "service", "name")) ||
        str(get(backend, "serviceName"));
      if (name) {
        addEdge({
          id: `ing:${iid}>${name}:${n++}`,
          from: iid,
          to: nodeIds.has(serviceId(ing.ns, name))
            ? serviceId(ing.ns, name)
            : ensureService(ing.ns, name),
          kind: "depends",
          label: clip(label, 24),
        });
      }
    };
    for (const r of rules) {
      for (const p of asList(get(r, "http", "paths"))) {
        route(
          get(p, "backend"),
          `${str(get(r, "host"))}${str(get(p, "path")) || "/"}`,
        );
      }
    }
    route(get(ing.raw, "spec", "defaultBackend"), "default");
  }

  // ---- config, secrets and claims: dashed boxes under the first workload that uses them
  const claims = new Map<string, Res>(
    of("PersistentVolumeClaim").map((c) => [id("pvc", c.ns, c.name), c]),
  );
  for (const w of workloads) {
    const wid = id("wl", w.ns, w.name);
    const info = infos.get(wid)!;
    const attach = (nid: string, lines: string[]) => {
      addNode({ id: nid, lines, attachedTo: wid });
      addEdge({
        id: `att:${wid}>${nid}`,
        from: wid,
        to: nid,
        kind: "attach",
      });
    };
    for (const name of info.configMaps) {
      attach(id("cm", w.ns, name), [`📄 ${clip(name, 22)}`, "ConfigMap"]);
    }
    for (const name of info.secrets) {
      attach(id("sec", w.ns, name), [`🔑 ${clip(name, 22)}`, "Secret"]);
    }
    for (const name of info.claims) {
      const pvc = claims.get(id("pvc", w.ns, name));
      const size = str(
        get(pvc?.raw, "spec", "resources", "requests", "storage"),
      );
      attach(id("pvc", w.ns, name), [
        `💾 ${clip(name, 22)}`,
        `PVC${size ? ` · ${size}` : ""}`,
      ]);
    }
    for (const t of asList(get(w.raw, "spec", "volumeClaimTemplates"))) {
      const name = str(get(t, "metadata", "name"));
      if (name) {
        const size = str(get(t, "spec", "resources", "requests", "storage"));
        attach(`pvc:${w.ns}/${name}@${w.name}`, [
          `💾 ${clip(name, 22)}`,
          `PVC template${size ? ` · ${size}` : ""}`,
        ]);
      }
    }
  }

  // ---- inferred: a workload that names a Service in an environment variable value
  for (const w of workloads) {
    const wid = id("wl", w.ns, w.name);
    for (const s of services.filter(
      (x) => x.ns === w.ns && x.name.length >= 3,
    )) {
      const sid = serviceId(s.ns, s.name);
      if (edgeIds.has(`sel:${sid}>${wid}`)) {
        continue; // the Service in front of this very workload
      }
      for (const [envName, value] of infos.get(wid)!.env) {
        const tokens = value.split(/[^a-zA-Z0-9.-]+/);
        if (tokens.some((t) => t === s.name || t.startsWith(`${s.name}.`))) {
          addEdge({
            id: `env:${wid}>${sid}`,
            from: wid,
            to: sid,
            kind: "depends",
            label: clip(envName, 20),
          });
          break;
        }
      }
    }
  }

  if (nodes.length > MAX_NODES) {
    throw new Error(
      `That is a lot to draw (${nodes.length} boxes). Paste fewer manifests, for example one namespace or one app.`,
    );
  }

  const ignored = new Map<string, number>();
  for (const r of all) {
    if (!HANDLED.has(r.kind)) {
      ignored.set(r.kind, (ignored.get(r.kind) || 0) + 1);
    }
  }
  const notes = [...ignored.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([k, n]) => `${k}${n > 1 ? ` ×${n}` : ""}`);
  return {
    nodes,
    edges,
    ...(notes.length ? { notes: [`Not drawn: ${notes.join(", ")}`] } : {}),
  };
};
