import { layoutGraph } from "./graph";
import { parseKubernetes, shortImage } from "./kubernetes";

const SAMPLE = `
apiVersion: v1
kind: ServiceAccount
metadata: { name: web, namespace: shop }
---
apiVersion: v1
kind: ConfigMap
metadata: { name: web-config, namespace: shop }
data: { A: "1" }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: web, namespace: shop }
spec:
  replicas: 3
  selector: { matchLabels: { app: web } }
  template:
    metadata: { labels: { app: web } }
    spec:
      containers:
        - name: web
          image: ghcr.io/acme/web:1.4.2
          env:
            - { name: DB_HOST, value: "postgres.shop.svc.cluster.local" }
            - name: API_KEY
              valueFrom: { secretKeyRef: { name: web-secret, key: key } }
          envFrom:
            - configMapRef: { name: web-config }
      volumes:
        - name: data
          persistentVolumeClaim: { claimName: web-data }
---
apiVersion: v1
kind: Service
metadata: { name: web, namespace: shop }
spec:
  selector: { app: web }
  ports: [{ port: 80, targetPort: 8080 }]
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: { name: web, namespace: shop }
spec:
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /
            backend: { service: { name: web, port: { number: 80 } } }
---
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: postgres, namespace: shop }
spec:
  replicas: 1
  selector: { matchLabels: { app: postgres } }
  template:
    metadata: { labels: { app: postgres } }
    spec:
      containers:
        - { name: db, image: postgres:16 }
  volumeClaimTemplates:
    - metadata: { name: data }
      spec: { resources: { requests: { storage: 10Gi } } }
---
apiVersion: v1
kind: Service
metadata: { name: postgres, namespace: shop }
spec:
  selector: { app: postgres }
  ports: [{ port: 5432 }]
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata: { name: web, namespace: shop }
spec:
  scaleTargetRef: { kind: Deployment, name: web }
  minReplicas: 2
  maxReplicas: 10
`;

describe("parseKubernetes", () => {
  const g = parseKubernetes(SAMPLE);
  const node = (id: string) => g.nodes.find((n) => n.id === id)!;
  const edge = (from: string, to: string) =>
    g.edges.find((e) => e.from === from && e.to === to);

  it("draws workloads, services, the ingress, config, secrets and claims", () => {
    expect(g.nodes.map((n) => n.id).sort()).toEqual(
      [
        "internet",
        "ing:shop/web",
        "svc:shop/web",
        "svc:shop/postgres",
        "wl:shop/web",
        "wl:shop/postgres",
        "cm:shop/web-config",
        "sec:shop/web-secret",
        "pvc:shop/web-data",
        "pvc:shop/data@postgres",
      ].sort(),
    );
  });

  it("colors by what it is", () => {
    expect(node("wl:shop/postgres").role).toBe("database");
    expect(node("wl:shop/web").role).toBe("app");
    expect(node("ing:shop/web").role).toBe("proxy");
    expect(node("svc:shop/web").role).toBe("network");
  });

  it("describes a workload: kind, replicas, image without registry, autoscaling", () => {
    const lines = node("wl:shop/web").lines;
    expect(lines[1]).toBe("Deployment · 3×");
    expect(lines).toContain("acme/web:1.4.2");
    expect(lines).toContain("autoscaled 2-10 replicas");
    expect(node("svc:shop/web").lines).toContain("80→8080");
    expect(node("ing:shop/web").lines).toContain("shop.example.com");
  });

  it("follows what Kubernetes defines: ingress, service, selector", () => {
    expect(edge("internet", "ing:shop/web")?.kind).toBe("ingress");
    const route = edge("ing:shop/web", "svc:shop/web");
    expect(route?.kind).toBe("depends");
    expect(route?.label).toBe("shop.example.com/");
    expect(edge("svc:shop/web", "wl:shop/web")?.kind).toBe("depends");
    expect(edge("svc:shop/postgres", "wl:shop/postgres")?.kind).toBe("depends");
  });

  it("infers a call from an environment variable that names a Service, and labels it", () => {
    const call = edge("wl:shop/web", "svc:shop/postgres");
    expect(call?.kind).toBe("depends");
    expect(call?.label).toBe("DB_HOST");
    // but not from a Service to the workload it already selects
    expect(edge("wl:shop/web", "svc:shop/web")).toBeUndefined();
  });

  it("puts config, secrets and claims under the workload that uses them, joined by dashed lines", () => {
    for (const id of [
      "cm:shop/web-config",
      "sec:shop/web-secret",
      "pvc:shop/web-data",
    ]) {
      expect(node(id).attachedTo).toBe("wl:shop/web");
      expect(edge("wl:shop/web", id)?.kind).toBe("attach");
    }
    expect(node("pvc:shop/data@postgres").attachedTo).toBe("wl:shop/postgres");
    expect(node("pvc:shop/data@postgres").lines[1]).toBe("PVC template · 10Gi");
  });

  it("says what it did not draw", () => {
    expect(g.notes).toEqual(["Not drawn: ServiceAccount"]);
  });

  it("lays the chain out left to right", () => {
    const l = layoutGraph(g);
    const x = (id: string) => l.nodes.find((n) => n.id === id)!.x;
    const chain = [
      "internet",
      "ing:shop/web",
      "svc:shop/web",
      "wl:shop/web",
      "svc:shop/postgres",
      "wl:shop/postgres",
    ];
    for (let i = 0; i < chain.length - 1; i++) {
      expect(x(chain[i])).toBeLessThan(x(chain[i + 1]));
    }
  });
});

describe("parseKubernetes: other shapes", () => {
  it("shows a Service that an Ingress names but that was not pasted, dashed", () => {
    const g = parseKubernetes(`
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: { name: i }
spec:
  rules:
    - http:
        paths:
          - { path: /api, backend: { service: { name: api } } }
`);
    const stub = g.nodes.find((n) => n.id === "svc:default/api")!;
    expect(stub.dashed).toBe(true);
    expect(stub.lines[1]).toMatch(/not in what you pasted/);
  });

  it("sends a LoadBalancer or NodePort Service straight from the Internet", () => {
    const g = parseKubernetes(`
apiVersion: v1
kind: Service
metadata: { name: edge }
spec:
  type: LoadBalancer
  ports: [{ port: 443 }]
`);
    expect(g.edges.find((e) => e.from === "internet")?.label).toBe("443");
    expect(g.nodes.find((n) => n.id === "internet")?.external).toBe(true);
  });

  it("reads a List and CronJobs", () => {
    const g = parseKubernetes(`
apiVersion: v1
kind: List
items:
  - apiVersion: batch/v1
    kind: CronJob
    metadata: { name: nightly }
    spec:
      schedule: "0 3 * * *"
      jobTemplate:
        spec:
          template:
            spec:
              containers: [{ name: c, image: busybox }]
`);
    const n = g.nodes.find((x) => x.id === "wl:default/nightly")!;
    expect(n.role).toBe("function");
    expect(n.lines[1]).toBe("CronJob · 0 3 * * *");
  });

  it("names the namespace when there is more than one", () => {
    const g = parseKubernetes(`
apiVersion: v1
kind: Service
metadata: { name: a, namespace: one }
spec: { ports: [{ port: 1 }] }
---
apiVersion: v1
kind: Service
metadata: { name: a, namespace: two }
spec: { ports: [{ port: 1 }] }
`);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["svc:one/a", "svc:two/a"]);
    expect(g.nodes[0].lines).toContain("ns: one");
  });

  it("does not pick workloads from another namespace", () => {
    const g = parseKubernetes(`
apiVersion: v1
kind: Service
metadata: { name: s, namespace: one }
spec: { selector: { app: x }, ports: [{ port: 1 }] }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: d, namespace: two }
spec:
  template:
    metadata: { labels: { app: x } }
    spec: { containers: [{ name: c, image: i }] }
`);
    expect(g.edges.filter((e) => e.id.startsWith("sel:"))).toHaveLength(0);
  });
});

describe("parseKubernetes: errors", () => {
  it("explains a Helm template", () => {
    expect(() =>
      parseKubernetes(
        "apiVersion: v1\nkind: Service\nmetadata:\n  name: {{ .Release.Name }}\n",
      ),
    ).toThrow(/Helm/);
  });

  it("explains invalid YAML and empty input", () => {
    expect(() => parseKubernetes("a: [1, 2")).toThrow(/not valid YAML/);
    expect(() => parseKubernetes("  ")).toThrow(/Paste/);
  });

  it("asks for something it can draw", () => {
    expect(() =>
      parseKubernetes(
        "apiVersion: v1\nkind: ServiceAccount\nmetadata: { name: x }",
      ),
    ).toThrow(/No Kubernetes workloads/);
  });
});

describe("shortImage", () => {
  it("drops the registry host and the digest", () => {
    expect(shortImage("ghcr.io/org/app:1.2@sha256:abc")).toBe("org/app:1.2");
    expect(shortImage("localhost:5000/app")).toBe("app");
    expect(shortImage("postgres:16")).toBe("postgres:16");
    expect(shortImage("library/nginx")).toBe("library/nginx");
  });
});
