// ComposeModel -> positioned nodes/edges -> Excalidraw element skeletons. Pure, no DOM, so it is unit tested.
// Layout: left to right. Whoever nobody depends on (proxies, apps) is on the left; what they depend on (databases,
// caches, queues) is on the right. The published ports come from an "Internet" node, and each volume sits under the first service that mounts it.
import type { ComposeModel, ComposeService, Role } from "./compose";

export type LayoutNode = {
  id: string;
  kind: "service" | "internet" | "volume";
  role?: Role;
  lines: string[];
  x: number;
  y: number;
  width: number;
  height: number;
};
export type LayoutEdge = {
  id: string;
  from: string;
  to: string;
  kind: "ingress" | "depends" | "volume";
  label?: string;
};
export type Layout = {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  /** [minX, minY, maxX, maxY] */
  bounds: [number, number, number, number];
};

const W = 230;
const H = 96;
const GAP_X = 150;
const GAP_Y = 44;

export const ROLE_STYLE: Record<
  Role,
  { emoji: string; fill: string; stroke: string }
> = {
  proxy: { emoji: "🌐", fill: "#d0ebff", stroke: "#1971c2" },
  app: { emoji: "⚙️", fill: "#e5dbff", stroke: "#6741d9" },
  database: { emoji: "🗄️", fill: "#d3f9d8", stroke: "#2f9e44" },
  cache: { emoji: "⚡", fill: "#ffe8cc", stroke: "#e8590c" },
  queue: { emoji: "📨", fill: "#fff3bf", stroke: "#f08c00" },
  monitoring: { emoji: "📊", fill: "#c3fae8", stroke: "#0ca678" },
  auth: { emoji: "🔐", fill: "#ffe3e3", stroke: "#e03131" },
  storage: { emoji: "💾", fill: "#f1f3f5", stroke: "#495057" },
};

const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

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

/** column index of every service: 0 when nobody depends on it, else one more than the deepest dependent */
const levels = (model: ComposeModel): Map<string, number> => {
  const dependents = new Map<string, string[]>();
  for (const s of model.services) {
    for (const d of s.dependsOn) {
      dependents.set(d, [...(dependents.get(d) || []), s.name]);
    }
  }
  const memo = new Map<string, number>();
  const level = (name: string, path: string[]): number => {
    if (memo.has(name)) {
      return memo.get(name)!;
    }
    if (path.includes(name)) {
      return 0; // dependency cycle: do not loop forever
    }
    const ds = dependents.get(name) || [];
    const lvl = ds.length
      ? 1 + Math.max(...ds.map((d) => level(d, [...path, name])))
      : 0;
    memo.set(name, lvl);
    return lvl;
  };
  model.services.forEach((s) => level(s.name, []));
  return memo;
};

export const layoutCompose = (model: ComposeModel): Layout => {
  const lvl = levels(model);
  const hasIngress = model.services.some((s) => s.ports.length > 0);
  const shift = hasIngress ? 1 : 0;

  type Draft = Omit<LayoutNode, "x" | "y"> & { col: number };
  const drafts: Draft[] = [];
  if (hasIngress) {
    drafts.push({
      id: "internet",
      kind: "internet",
      lines: ["🌐 Internet"],
      width: 150,
      height: 70,
      col: 0,
    });
  }
  const sorted = [...model.services].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const s of sorted) {
    const col = (lvl.get(s.name) || 0) + shift;
    drafts.push({
      id: `svc:${s.name}`,
      kind: "service",
      role: s.role,
      lines: serviceLines(s),
      width: W,
      height: H,
      col,
    });
    // a volume goes right under the first service that mounts it, so its dashed line is short and crosses nothing
    for (const v of model.volumes) {
      if (sorted.find((o) => o.volumes.includes(v)) === s) {
        drafts.push({
          id: `vol:${v}`,
          kind: "volume",
          lines: [`💾 ${clip(v, 22)}`],
          width: 170,
          height: 60,
          col,
        });
      }
    }
  }

  const cols = new Map<number, Draft[]>();
  drafts.forEach((d) => cols.set(d.col, [...(cols.get(d.col) || []), d]));
  const heightOf = (items: Draft[]) =>
    items.reduce((sum, d) => sum + d.height, 0) + (items.length - 1) * GAP_Y;
  const tallest = Math.max(...[...cols.values()].map(heightOf));

  const nodes: LayoutNode[] = [];
  for (const [col, items] of [...cols.entries()].sort((a, b) => a[0] - b[0])) {
    let y = (tallest - heightOf(items)) / 2;
    for (const d of items) {
      const { col: _c, ...rest } = d;
      nodes.push({ ...rest, x: col * (W + GAP_X) + (W - d.width) / 2, y });
      y += d.height + GAP_Y;
    }
  }

  const edges: LayoutEdge[] = [];
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
        kind: "volume",
      });
    }
  }

  const xs = nodes.flatMap((n) => [n.x, n.x + n.width]);
  const ys = nodes.flatMap((n) => [n.y, n.y + n.height]);
  return {
    nodes,
    edges,
    bounds: [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    ],
  };
};

export type Skeleton = Record<string, unknown>;

/** where a straight line between the centers of two nodes leaves the first box and enters the second (with a small gap) */
export const edgeEnds = (
  a: LayoutNode,
  b: LayoutNode,
): [[number, number], [number, number]] => {
  const ca = [a.x + a.width / 2, a.y + a.height / 2];
  const cb = [b.x + b.width / 2, b.y + b.height / 2];
  const dx = cb[0] - ca[0];
  const dy = cb[1] - ca[1];
  const edge = (n: LayoutNode, ux: number, uy: number): [number, number] => {
    const hw = n.width / 2 + 6;
    const hh = n.height / 2 + 6;
    const k = Math.min(
      ux ? hw / Math.abs(ux) : Infinity,
      uy ? hh / Math.abs(uy) : Infinity,
    );
    return [n.x + n.width / 2 + ux * k, n.y + n.height / 2 + uy * k];
  };
  return [edge(a, dx, dy), edge(b, -dx, -dy)];
};

/** Plain element skeletons for `convertToExcalidrawElements`; `offset` moves the whole diagram. */
export const layoutToSkeleton = (
  layout: Layout,
  offset: { x: number; y: number } = { x: 0, y: 0 },
): Skeleton[] => {
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const shapes: Skeleton[] = layout.nodes.map((n) => {
    const style = n.role ? ROLE_STYLE[n.role] : null;
    const base = {
      id: n.id,
      x: n.x + offset.x,
      y: n.y + offset.y,
      width: n.width,
      height: n.height,
      strokeWidth: 2,
      fillStyle: "solid",
      label: {
        text: n.lines.join("\n"),
        fontSize: 16,
        textAlign: "center",
        verticalAlign: "middle",
      },
    };
    if (n.kind === "internet") {
      return {
        ...base,
        type: "ellipse",
        backgroundColor: "#f1f3f5",
        strokeColor: "#495057",
      };
    }
    if (n.kind === "volume") {
      return {
        ...base,
        type: "rectangle",
        roundness: { type: 3 },
        backgroundColor: "#fff9db",
        strokeColor: "#f08c00",
        strokeStyle: "dashed",
      };
    }
    return {
      ...base,
      type: "rectangle",
      roundness: { type: 3 },
      backgroundColor: style!.fill,
      strokeColor: style!.stroke,
    };
  });

  const arrows: Skeleton[] = layout.edges.map((e) => {
    const [[sx, sy], [ex, ey]] = edgeEnds(byId.get(e.from)!, byId.get(e.to)!);
    return {
      type: "arrow",
      id: e.id,
      x: sx + offset.x,
      y: sy + offset.y,
      width: Math.abs(ex - sx),
      height: Math.abs(ey - sy),
      points: [
        [0, 0],
        [ex - sx, ey - sy],
      ],
      strokeColor: "#495057",
      strokeStyle: e.kind === "volume" ? "dashed" : "solid",
      startArrowhead: null,
      endArrowhead: e.kind === "volume" ? null : "arrow",
      start: { id: e.from },
      end: { id: e.to },
      ...(e.label ? { label: { text: e.label, fontSize: 14 } } : {}),
    };
  });
  return [...shapes, ...arrows];
};
