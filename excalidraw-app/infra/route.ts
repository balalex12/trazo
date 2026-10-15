// Elbow routing for imported diagrams: every arrow is a polyline of horizontal and vertical segments that goes around
// the boxes instead of through them. Pure (no DOM), so it is unit tested.
//
// How: an arrow leaves its box through the middle of the side that faces the other box (several arrows on one side
// are spread along it), then an A* search runs over a small grid made of the lines that run just outside every box.
// Bends cost extra and segments another arrow already uses cost more, so routes are short, have few corners and do not
// pile up on top of each other. If no route exists the caller keeps a straight line.

import type { Layout, LayoutEdge, LayoutNode } from "./graph";

type Pt = [number, number];
type Side = "left" | "right" | "top" | "bottom";

/** how far from a box the first and last corner of an arrow sit */
const MARGIN = 18;
/** the visible gap between an arrowhead (or tail) and the border of its box */
const GAP = 6;
const BEND_COST = 70;
const SHARED_COST = 0.7;
/** extra lanes outside each box, so parallel arrows do not have to share one line */
const LANE_STEP = 14;
const LANES = 3;

const DIRS: Pt[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const OUT: Record<Side, number> = { right: 0, bottom: 1, left: 2, top: 3 };

const centerOf = (n: LayoutNode): Pt => [n.x + n.width / 2, n.y + n.height / 2];

/** the side of `a` that faces `b` and the side of `b` that faces `a` */
const facingSides = (a: LayoutNode, b: LayoutNode): [Side, Side] => {
  if (b.x >= a.x + a.width) {
    return ["right", "left"];
  }
  if (b.x + b.width <= a.x) {
    return ["left", "right"];
  }
  return centerOf(b)[1] >= centerOf(a)[1]
    ? ["bottom", "top"]
    : ["top", "bottom"];
};

/** the point of a box border at `t` (0..1) along `side`, pushed out by `gap` */
const portPoint = (n: LayoutNode, side: Side, t: number, gap: number): Pt => {
  const [cx, cy] = centerOf(n);
  const horizontal = side === "left" || side === "right";
  const sign = side === "right" || side === "bottom" ? 1 : -1;
  if (n.kind === "external") {
    // an ellipse: follow its curve so the arrow does not float away from it
    const a = n.width / 2;
    const b = n.height / 2;
    if (horizontal) {
      const y = n.y + n.height * t;
      const k = Math.sqrt(Math.max(0, 1 - ((y - cy) / b) ** 2));
      return [cx + sign * (a * k + gap), y];
    }
    const x = n.x + n.width * t;
    const k = Math.sqrt(Math.max(0, 1 - ((x - cx) / a) ** 2));
    return [x, cy + sign * (b * k + gap)];
  }
  return horizontal
    ? [sign > 0 ? n.x + n.width + gap : n.x - gap, n.y + n.height * t]
    : [n.x + n.width * t, sign > 0 ? n.y + n.height + gap : n.y - gap];
};

type Plan = {
  edge: LayoutEdge;
  from: LayoutNode;
  to: LayoutNode;
  fromSide: Side;
  toSide: Side;
  fromT: number;
  toT: number;
};

/** the dash line to a second attached box is drawn from the box above it (see drawFrom), so the caller passes it in */
const planPorts = (
  edges: { edge: LayoutEdge; from: LayoutNode; to: LayoutNode }[],
): Plan[] => {
  const plans: Plan[] = edges.map((e) => {
    const [fromSide, toSide] = facingSides(e.from, e.to);
    return { ...e, fromSide, toSide, fromT: 0.5, toT: 0.5 };
  });
  // arrows that share a side of a box are spread along it, in the order of where they go, so they do not cross
  const groups = new Map<string, { plan: Plan; end: "from" | "to" }[]>();
  for (const p of plans) {
    for (const end of ["from", "to"] as const) {
      const node = p[end];
      const side = end === "from" ? p.fromSide : p.toSide;
      const key = `${node.id}|${side}`;
      groups.set(key, [...(groups.get(key) || []), { plan: p, end }]);
    }
  }
  for (const [key, members] of groups) {
    if (members.length < 2) {
      continue;
    }
    const side = key.split("|").pop() as Side;
    const horizontal = side === "left" || side === "right";
    const other = (m: { plan: Plan; end: "from" | "to" }) =>
      centerOf(m.end === "from" ? m.plan.to : m.plan.from)[horizontal ? 1 : 0];
    members.sort((a, b) => other(a) - other(b));
    members.forEach((m, i) => {
      const t = 0.18 + (0.64 * (i + 0.5)) / members.length;
      if (m.end === "from") {
        m.plan.fromT = t;
      } else {
        m.plan.toT = t;
      }
    });
  }
  return plans;
};

class Heap {
  private a: { k: number; v: number }[] = [];
  get size() {
    return this.a.length;
  }
  push(k: number, v: number) {
    const a = this.a;
    a.push({ k, v });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].k <= a[i].k) {
        break;
      }
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].k < a[m].k) {
          m = l;
        }
        if (r < a.length && a[r].k < a[m].k) {
          m = r;
        }
        if (m === i) {
          break;
        }
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

const uniqueSorted = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (!out.length || v - out[out.length - 1] > 0.001) {
      out.push(v);
    }
  }
  return out;
};

const indexOfValue = (arr: number[], v: number) => {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v - 0.0005) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
};

/** removes points that sit in the middle of a straight run */
const simplify = (pts: Pt[]): Pt[] => {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (
      last &&
      Math.abs(last[0] - p[0]) < 0.01 &&
      Math.abs(last[1] - p[1]) < 0.01
    ) {
      continue;
    }
    out.push(p);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3);
      const straight =
        (Math.abs(a[0] - b[0]) < 0.01 && Math.abs(b[0] - c[0]) < 0.01) ||
        (Math.abs(a[1] - b[1]) < 0.01 && Math.abs(b[1] - c[1]) < 0.01);
      if (!straight) {
        break;
      }
      out.splice(out.length - 2, 1);
    }
  }
  return out;
};

/**
 * One polyline (in layout coordinates) per edge id: orthogonal, going around every box. An edge that cannot be routed
 * is missing from the result, and the caller draws it straight. `endpoints` maps an edge id to the box its line really
 * starts from (see `drawFrom`).
 */
export const routeEdges = (
  layout: Layout,
  startOf: (e: LayoutEdge) => string = (e) => e.from,
): Map<string, Pt[]> => {
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const usable = layout.edges
    .map((edge) => ({
      edge,
      from: byId.get(startOf(edge)),
      to: byId.get(edge.to),
    }))
    .filter(
      (e): e is { edge: LayoutEdge; from: LayoutNode; to: LayoutNode } =>
        !!e.from && !!e.to && e.from.id !== e.to.id,
    );
  const result = new Map<string, Pt[]>();
  if (!usable.length) {
    return result;
  }
  const plans = planPorts(usable);

  // the grid: lines just outside every box, plus the exact ports
  const xsRaw: number[] = [];
  const ysRaw: number[] = [];
  for (const n of layout.nodes) {
    for (let k = 0; k < LANES; k++) {
      const d = MARGIN + k * LANE_STEP;
      xsRaw.push(n.x - d, n.x + n.width + d);
      ysRaw.push(n.y - d, n.y + n.height + d);
    }
  }
  const ports = plans.map((p) => {
    const a0 = portPoint(p.from, p.fromSide, p.fromT, GAP);
    const b0 = portPoint(p.to, p.toSide, p.toT, GAP);
    const stub = (pt: Pt, node: LayoutNode, side: Side): Pt => {
      // the stub reaches the line MARGIN away from the box border, not from the (curved) ellipse
      const horizontal = side === "left" || side === "right";
      const sign = side === "right" || side === "bottom" ? 1 : -1;
      return horizontal
        ? [sign > 0 ? node.x + node.width + MARGIN : node.x - MARGIN, pt[1]]
        : [pt[0], sign > 0 ? node.y + node.height + MARGIN : node.y - MARGIN];
    };
    return {
      a0,
      b0,
      a1: stub(a0, p.from, p.fromSide),
      b1: stub(b0, p.to, p.toSide),
    };
  });
  for (const pr of ports) {
    xsRaw.push(pr.a1[0], pr.b1[0]);
    ysRaw.push(pr.a1[1], pr.b1[1]);
  }
  const xs = uniqueSorted(xsRaw);
  const ys = uniqueSorted(ysRaw);
  const nx = xs.length;
  const ny = ys.length;

  // blocked[ y * nx + x ]: the point is inside a box (plus margin); hBlock / vBlock: the segment to the next point
  // (right / down) crosses one
  const inflate = MARGIN - 1;
  const pointBlocked = new Uint8Array(nx * ny);
  const hBlock = new Uint8Array(nx * ny);
  const vBlock = new Uint8Array(nx * ny);
  for (const n of layout.nodes) {
    const x1 = n.x - inflate;
    const x2 = n.x + n.width + inflate;
    const y1 = n.y - inflate;
    const y2 = n.y + n.height + inflate;
    // indexes of the grid lines strictly inside the rectangle
    let xa = indexOfValue(xs, x1);
    while (xa < nx && xs[xa] <= x1) {
      xa++;
    }
    let xb = indexOfValue(xs, x2);
    while (xb >= 0 && xs[xb] >= x2) {
      xb--;
    }
    let ya = indexOfValue(ys, y1);
    while (ya < ny && ys[ya] <= y1) {
      ya++;
    }
    let yb = indexOfValue(ys, y2);
    while (yb >= 0 && ys[yb] >= y2) {
      yb--;
    }
    for (let yi = Math.max(0, ya - 1); yi <= Math.min(ny - 1, yb + 1); yi++) {
      for (let xi = Math.max(0, xa - 1); xi <= Math.min(nx - 1, xb + 1); xi++) {
        const inX = xi >= xa && xi <= xb;
        const inY = yi >= ya && yi <= yb;
        if (inX && inY) {
          pointBlocked[yi * nx + xi] = 1;
        }
        // horizontal segment xi -> xi+1 along row yi
        if (inY && xs[xi + 1] !== undefined && xs[xi + 1] > x1 && xs[xi] < x2) {
          hBlock[yi * nx + xi] = 1;
        }
        // vertical segment yi -> yi+1 along column xi
        if (inX && ys[yi + 1] !== undefined && ys[yi + 1] > y1 && ys[yi] < y2) {
          vBlock[yi * nx + xi] = 1;
        }
      }
    }
  }

  const hUsed = new Uint8Array(nx * ny);
  const vUsed = new Uint8Array(nx * ny);
  const states = nx * ny * 4;
  const dist = new Float64Array(states);
  const prev = new Int32Array(states);
  const stamp = new Int32Array(states);
  let run = 0;

  const solve = (
    start: Pt,
    startDir: number,
    goal: Pt,
    forbiddenLastDir: number,
  ): Pt[] | null => {
    run++;
    const sx = indexOfValue(xs, start[0]);
    const sy = indexOfValue(ys, start[1]);
    const gx = indexOfValue(xs, goal[0]);
    const gy = indexOfValue(ys, goal[1]);
    const heap = new Heap();
    const h = (xi: number, yi: number) =>
      Math.abs(xs[xi] - xs[gx]) + Math.abs(ys[yi] - ys[gy]);
    const startState = (sy * nx + sx) * 4 + startDir;
    stamp[startState] = run;
    dist[startState] = 0;
    prev[startState] = -1;
    heap.push(h(sx, sy), startState);
    let found = -1;
    let guard = 0;
    while (heap.size && guard++ < 400000) {
      const { k, v } = heap.pop();
      const d = v & 3;
      const cell = v >> 2;
      const xi = cell % nx;
      const yi = (cell - xi) / nx;
      if (k - h(xi, yi) > dist[v] + 1e-6) {
        continue; // stale entry
      }
      if (xi === gx && yi === gy && d !== forbiddenLastDir) {
        found = v;
        break;
      }
      for (let nd = 0; nd < 4; nd++) {
        if (nd === (d + 2) % 4) {
          continue; // no U-turns
        }
        const [dx, dy] = DIRS[nd];
        const x2 = xi + dx;
        const y2 = yi + dy;
        if (x2 < 0 || y2 < 0 || x2 >= nx || y2 >= ny) {
          continue;
        }
        if (pointBlocked[y2 * nx + x2]) {
          continue;
        }
        // the segment between the two grid points
        const sIdx = dx > 0 || dy > 0 ? yi * nx + xi : y2 * nx + x2;
        if (dx !== 0 ? hBlock[sIdx] : vBlock[sIdx]) {
          continue;
        }
        const len = Math.abs(xs[x2] - xs[xi]) + Math.abs(ys[y2] - ys[yi]);
        const used = dx !== 0 ? hUsed[sIdx] : vUsed[sIdx];
        const cost =
          len * (1 + SHARED_COST * used) + (nd !== d ? BEND_COST : 0);
        const ns = (y2 * nx + x2) * 4 + nd;
        const nd2 = dist[v] + cost;
        if (stamp[ns] !== run || nd2 < dist[ns]) {
          stamp[ns] = run;
          dist[ns] = nd2;
          prev[ns] = v;
          heap.push(nd2 + h(x2, y2), ns);
        }
      }
    }
    if (found < 0) {
      return null;
    }
    const path: Pt[] = [];
    for (let s = found; s >= 0; s = prev[s]) {
      const cell = s >> 2;
      const xi = cell % nx;
      path.push([xs[xi], ys[(cell - xi) / nx]]);
    }
    return path.reverse();
  };

  const markUsed = (pts: Pt[]) => {
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const xi0 = indexOfValue(xs, Math.min(ax, bx));
      const xi1 = indexOfValue(xs, Math.max(ax, bx));
      const yi0 = indexOfValue(ys, Math.min(ay, by));
      const yi1 = indexOfValue(ys, Math.max(ay, by));
      if (ay === by) {
        for (let xi = xi0; xi < xi1; xi++) {
          hUsed[yi0 * nx + xi] = Math.min(250, hUsed[yi0 * nx + xi] + 1);
        }
      } else {
        for (let yi = yi0; yi < yi1; yi++) {
          vUsed[yi * nx + xi0] = Math.min(250, vUsed[yi * nx + xi0] + 1);
        }
      }
    }
  };

  // short edges first: they have few choices, long ones go around them
  const order = plans
    .map((p, i) => ({
      i,
      len:
        Math.abs(centerOf(p.from)[0] - centerOf(p.to)[0]) +
        Math.abs(centerOf(p.from)[1] - centerOf(p.to)[1]),
    }))
    .sort((a, b) => a.len - b.len);
  for (const { i } of order) {
    const p = plans[i];
    const pr = ports[i];
    const path = solve(
      pr.a1,
      OUT[p.fromSide],
      pr.b1,
      OUT[p.toSide], // arriving in the direction the target's outside faces would mean a U-turn at its stub
    );
    if (!path) {
      continue;
    }
    const full = simplify([pr.a0, ...path, pr.b0]);
    markUsed(path);
    result.set(p.edge.id, full);
  }
  return result;
};
