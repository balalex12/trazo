// The common shape of every imported architecture (docker-compose, Kubernetes, Terraform): a small graph, laid out
// left to right and turned into Excalidraw element skeletons. Pure, no DOM, so it is unit tested.
//
// Layout: whoever nobody depends on (proxies, apps) is on the left; what they depend on (databases, caches, queues)
// is on the right. Entry points (the Internet) form the first column. "Attached" nodes (volumes, config, claims) sit
// right under the first node that uses them, so their dashed line is short and crosses nothing.

export type Role =
  | "proxy"
  | "app"
  | "database"
  | "cache"
  | "queue"
  | "monitoring"
  | "auth"
  | "storage"
  | "network"
  | "function";

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
  network: { emoji: "🧱", fill: "#dbe4ff", stroke: "#364fc8" },
  function: { emoji: "🧩", fill: "#ffdeeb", stroke: "#c2255c" },
};

export const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

export type GraphNode = {
  id: string;
  lines: string[];
  role?: Role;
  /** an entry point such as the Internet: always the first column */
  external?: boolean;
  /** placed under this node (a volume, a config map…), not in a column of its own */
  attachedTo?: string;
  dashed?: boolean;
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  /** ingress: from an entry point; depends: A needs B (arrow A to B); attach: dashed line to config or storage */
  kind: "ingress" | "depends" | "attach";
  label?: string;
};

export type Graph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** things worth telling the user (what was left out) */
  notes?: string[];
};

export type LayoutNode = {
  id: string;
  kind: "service" | "external" | "attached";
  role?: Role;
  dashed?: boolean;
  lines: string[];
  x: number;
  y: number;
  width: number;
  height: number;
};
export type LayoutEdge = GraphEdge;
export type Layout = {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  /** [minX, minY, maxX, maxY] */
  bounds: [number, number, number, number];
  notes?: string[];
};

const W = 230;
const H = 96;
const GAP_X = 150;
const GAP_Y = 44;

export const layoutGraph = (g: Graph): Layout => {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const edges = g.edges.filter((e) => byId.has(e.from) && byId.has(e.to));

  // attached only directly under an ordinary node; anything else becomes an ordinary node
  const isAttached = (n: GraphNode) => {
    const owner = n.attachedTo ? byId.get(n.attachedTo) : undefined;
    return !n.external && !!owner && !owner.external && !owner.attachedTo;
  };
  const externals = g.nodes.filter((n) => n.external);
  const main = g.nodes.filter((n) => !n.external && !isAttached(n));
  const mainIds = new Set(main.map((n) => n.id));

  // column of every ordinary node: 0 when nobody depends on it, else one more than its deepest dependent
  const dependents = new Map<string, string[]>();
  for (const e of edges) {
    if (e.kind === "depends" && mainIds.has(e.from) && mainIds.has(e.to)) {
      dependents.set(e.to, [...(dependents.get(e.to) || []), e.from]);
    }
  }
  const memo = new Map<string, number>();
  const level = (id: string, path: string[]): number => {
    if (memo.has(id)) {
      return memo.get(id)!;
    }
    if (path.includes(id)) {
      return 0; // dependency cycle: do not loop forever
    }
    const ds = dependents.get(id) || [];
    const lvl = ds.length
      ? 1 + Math.max(...ds.map((d) => level(d, [...path, id])))
      : 0;
    memo.set(id, lvl);
    return lvl;
  };
  main.forEach((n) => level(n.id, []));
  const shift = externals.length ? 1 : 0;

  type Draft = Omit<LayoutNode, "x" | "y"> & { col: number };
  const drafts: Draft[] = externals.map((n) => ({
    id: n.id,
    kind: "external",
    lines: n.lines,
    width: 150,
    height: 70,
    col: 0,
  }));
  for (const n of main) {
    const col = (memo.get(n.id) || 0) + shift;
    drafts.push({
      id: n.id,
      kind: "service",
      role: n.role,
      dashed: n.dashed,
      lines: n.lines,
      width: W,
      height: H,
      col,
    });
    for (const a of g.nodes) {
      if (isAttached(a) && a.attachedTo === n.id) {
        drafts.push({
          id: a.id,
          kind: "attached",
          lines: a.lines,
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
  const tallest = Math.max(0, ...[...cols.values()].map(heightOf));

  const nodes: LayoutNode[] = [];
  for (const [col, items] of [...cols.entries()].sort((a, b) => a[0] - b[0])) {
    let y = (tallest - heightOf(items)) / 2;
    for (const d of items) {
      const { col: _c, ...rest } = d;
      nodes.push({ ...rest, x: col * (W + GAP_X) + (W - d.width) / 2, y });
      y += d.height + GAP_Y;
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
    ...(g.notes?.length ? { notes: g.notes } : {}),
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
    const style = n.role ? ROLE_STYLE[n.role] : ROLE_STYLE.app;
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
    if (n.kind === "external") {
      return {
        ...base,
        type: "ellipse",
        backgroundColor: "#f1f3f5",
        strokeColor: "#495057",
      };
    }
    if (n.kind === "attached") {
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
      backgroundColor: style.fill,
      strokeColor: style.stroke,
      ...(n.dashed ? { strokeStyle: "dashed" } : {}),
    };
  });

  // a dashed line to a second box under the same owner would run through the first one: chain it from the box just above
  const lineFrom = (e: LayoutEdge): string => {
    const a = byId.get(e.from)!;
    const b = byId.get(e.to)!;
    if (
      e.kind !== "attach" ||
      b.kind !== "attached" ||
      b.x + b.width / 2 !== a.x + a.width / 2
    ) {
      return e.from;
    }
    const above = layout.nodes
      .filter(
        (n) =>
          n.kind === "attached" &&
          n.x + n.width / 2 === b.x + b.width / 2 &&
          n.y < b.y &&
          n.y > a.y &&
          n.id !== b.id,
      )
      .sort((p, q) => q.y - p.y)[0];
    return above ? above.id : e.from;
  };

  const arrows: Skeleton[] = layout.edges.map((e) => {
    const from = lineFrom(e);
    const [[sx, sy], [ex, ey]] = edgeEnds(byId.get(from)!, byId.get(e.to)!);
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
      strokeStyle: e.kind === "attach" ? "dashed" : "solid",
      startArrowhead: null,
      endArrowhead: e.kind === "attach" ? null : "arrow",
      start: { id: from },
      end: { id: e.to },
      ...(e.label ? { label: { text: e.label, fontSize: 14 } } : {}),
    };
  });
  return [...shapes, ...arrows];
};
