import { detectRole, parseCompose } from "./compose";
import { layoutCompose, layoutToSkeleton } from "./layout";

const SAMPLE = `
services:
  proxy:
    image: nginx:alpine
    ports:
      - "80:80"
      - "127.0.0.1:8443:443/tcp"
    depends_on: [api]
  api:
    build: ./api
    ports:
      - 3000
    depends_on:
      db:
        condition: service_healthy
      cache: {}
    volumes:
      - uploads:/data
      - ./local:/src
      - /var/run/docker.sock:/var/run/docker.sock
      - type: volume
        source: logs
        target: /logs
  db:
    image: postgres:16
    volumes:
      - pgdata:/var/lib/postgresql/data
  cache:
    image: redis:7
volumes:
  pgdata:
  uploads:
  logs:
  unused:
`;

describe("parseCompose", () => {
  const model = parseCompose(SAMPLE);
  const svc = (n: string) => model.services.find((s) => s.name === n)!;

  it("reads services, images and builds", () => {
    expect(model.services.map((s) => s.name)).toEqual([
      "proxy",
      "api",
      "db",
      "cache",
    ]);
    expect(svc("proxy").image).toBe("nginx:alpine");
    expect(svc("api").build).toBe(true);
    expect(svc("api").image).toBe("(built from source)");
  });

  it("keeps only published ports and ignores IPs and protocols", () => {
    expect(svc("proxy").ports).toEqual([
      { host: "80", container: "80" },
      { host: "8443", container: "443" },
    ]);
    expect(svc("api").ports).toEqual([]);
  });

  it("reads depends_on as a list or as a map", () => {
    expect(svc("proxy").dependsOn).toEqual(["api"]);
    expect(svc("api").dependsOn.sort()).toEqual(["cache", "db"]);
  });

  it("keeps named volumes only, declared first, skipping unused ones", () => {
    expect(svc("api").volumes.sort()).toEqual(["logs", "uploads"]);
    expect(model.volumes).toEqual(["pgdata", "uploads", "logs"]);
  });

  it("detects roles from the image and the name", () => {
    expect(svc("proxy").role).toBe("proxy");
    expect(svc("db").role).toBe("database");
    expect(svc("cache").role).toBe("cache");
    expect(svc("api").role).toBe("app");
    expect(detectRole("events", "bitnami/kafka")).toBe("queue");
    expect(detectRole("dash", "grafana/grafana")).toBe("monitoring");
  });

  it("supports YAML anchors and merge keys", () => {
    const m = parseCompose(`
x-common: &common
  image: node:20
services:
  a: { <<: *common }
  b: { <<: *common }
`);
    expect(m.services.map((s) => s.image)).toEqual(["node:20", "node:20"]);
  });

  it("explains what is wrong with bad input", () => {
    expect(() => parseCompose("   ")).toThrow(/Paste/);
    expect(() => parseCompose("a: [1, 2")).toThrow(/not valid YAML/);
    expect(() => parseCompose("version: '3'")).toThrow(/services/);
    expect(() => parseCompose("services: {}")).toThrow(/empty/);
  });

  it("ignores depends_on entries that point to unknown services", () => {
    const m = parseCompose(
      "services:\n  a:\n    image: x\n    depends_on: [ghost, a]\n",
    );
    expect(m.services[0].dependsOn).toEqual([]);
  });
});

describe("layoutCompose", () => {
  const layout = layoutCompose(parseCompose(SAMPLE));
  const node = (id: string) => layout.nodes.find((n) => n.id === id)!;

  it("puts dependents on the left and their dependencies on the right", () => {
    expect(node("internet").x).toBeLessThan(node("svc:proxy").x);
    expect(node("svc:proxy").x).toBeLessThan(node("svc:api").x);
    expect(node("svc:api").x).toBeLessThan(node("svc:db").x);
    expect(node("svc:db").x).toBe(node("svc:cache").x);
  });

  it("puts a volume right under the service that mounts it", () => {
    const db = node("svc:db");
    const vol = node("vol:pgdata");
    expect(vol.x + vol.width / 2).toBe(db.x + db.width / 2);
    expect(vol.y).toBeGreaterThan(db.y + db.height);
    // and nothing else sits between them, so the dashed line crosses no other box
    const between = layout.nodes.filter(
      (n) =>
        n !== db &&
        n !== vol &&
        n.x < db.x + db.width &&
        n.x + n.width > db.x &&
        n.y > db.y &&
        n.y < vol.y,
    );
    expect(between).toEqual([]);
  });

  it("never overlaps two nodes", () => {
    for (const a of layout.nodes) {
      for (const b of layout.nodes) {
        if (a === b) {
          continue;
        }
        const apart =
          a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y;
        expect(apart).toBe(true);
      }
    }
  });

  it("creates ingress, dependency and volume edges", () => {
    const kinds = (k: string) =>
      layout.edges.filter((e) => e.kind === k).length;
    expect(kinds("ingress")).toBe(1); // only the proxy publishes ports
    expect(kinds("depends")).toBe(3); // proxy->api, api->db, api->cache
    expect(kinds("volume")).toBe(3); // api->uploads, api->logs, db->pgdata
    expect(layout.edges.find((e) => e.kind === "ingress")!.label).toBe(
      "80→80, 8443→443",
    );
  });

  it("has no Internet node when nothing is published", () => {
    const l = layoutCompose(parseCompose("services:\n  a:\n    image: x\n"));
    expect(l.nodes.map((n) => n.id)).toEqual(["svc:a"]);
  });

  it("survives dependency cycles", () => {
    const l = layoutCompose(
      parseCompose(
        "services:\n  a:\n    image: x\n    depends_on: [b]\n  b:\n    image: y\n    depends_on: [a]\n",
      ),
    );
    expect(l.nodes).toHaveLength(2);
  });
});

describe("layoutToSkeleton", () => {
  const layout = layoutCompose(parseCompose(SAMPLE));
  const sk = layoutToSkeleton(layout, { x: 100, y: 200 });

  it("makes one shape per node and one arrow per edge, bound by id", () => {
    expect(sk.filter((e) => e.type !== "arrow")).toHaveLength(
      layout.nodes.length,
    );
    const arrows = sk.filter((e) => e.type === "arrow");
    expect(arrows).toHaveLength(layout.edges.length);
    const ids = new Set(layout.nodes.map((n) => n.id));
    for (const a of arrows) {
      expect(ids.has((a.start as { id: string }).id)).toBe(true);
      expect(ids.has((a.end as { id: string }).id)).toBe(true);
    }
  });

  it("draws every arrow from the border of its source to the border of its target", () => {
    const near = (v: number, target: number, tol: number) =>
      Math.abs(v - target) <= tol;
    for (const e of layout.edges) {
      const a = layout.nodes.find((n) => n.id === e.from)!;
      const b = layout.nodes.find((n) => n.id === e.to)!;
      const arrow = sk.find((s) => s.id === e.id)!;
      const pts = arrow.points as number[][];
      const start = [(arrow.x as number) - 100, (arrow.y as number) - 200];
      const end = [start[0] + pts[1][0], start[1] + pts[1][1]];
      // the end points must be just outside the boxes (within the 6px gap), not at the box centers or far away
      const outside = (n: typeof a, p: number[]) =>
        p[0] >= n.x - 7 &&
        p[0] <= n.x + n.width + 7 &&
        p[1] >= n.y - 7 &&
        p[1] <= n.y + n.height + 7;
      expect(outside(a, start)).toBe(true);
      expect(outside(b, end)).toBe(true);
      expect(near(Math.abs(pts[1][0]), arrow.width as number, 0.001)).toBe(
        true,
      );
      expect(near(Math.abs(pts[1][1]), arrow.height as number, 0.001)).toBe(
        true,
      );
    }
  });

  it("gives arrows different directions instead of one horizontal line", () => {
    const dirs = new Set(
      sk
        .filter((s) => s.type === "arrow")
        .map((s) => Math.sign((s.points as number[][])[1][1])),
    );
    expect(dirs.size).toBeGreaterThan(1);
  });

  it("applies the offset", () => {
    const first = layout.nodes[0];
    const shape = sk.find((e) => e.id === first.id)!;
    expect(shape.x).toBe(first.x + 100);
    expect(shape.y).toBe(first.y + 200);
  });
});
