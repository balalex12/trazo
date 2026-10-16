// Design against reality: the diagram on the canvas is what you planned, the notebook is what the code really does.
// This compares the two and says what is planned but not in the notebook, what the notebook does that is not drawn,
// and which arrows have no code behind them or no drawing. Deterministic and local (no AI): boxes are matched by
// name, and only when the match is clear. The comparison itself is pure; the scene edits are at the bottom.
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { layoutGraph, layoutToSkeleton } from "../infra/graph";

import type { CanvasIndex, NodeInfo } from "../agent/canvas";
import type { Graph, GraphNode } from "../infra/graph";

/* eslint-disable @typescript-eslint/no-explicit-any */

const STOP = new Set(["df", "data", "table", "file", "the", "a", "of", "and"]);

/** a name without its icon, folder, extension and punctuation: "📥 data/Customers.csv" -> "customers" */
export const normalizeName = (name: string): string =>
  name
    .replace(/^[^\p{L}\p{N}_]+/u, "")
    .split("\n")[0]
    .replace(/^.*[\\/]/, "")
    .replace(/\.[A-Za-z0-9]{2,8}$/, "")
    .toLowerCase()
    .replace(/\s*\(\d+\)$/, "") // a re-read name: "df (2)"
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");

const tokens = (key: string) =>
  new Set(key.split("_").filter((t) => t && !STOP.has(t)));

/**
 * How well two names match: 1 for the same name, a fraction when all the words of the shorter one are in the longer
 * one ("model" in "churn model"), 0 for no match.
 */
export const similarity = (a: string, b: string): number => {
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) {
    return 0;
  }
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  if ([...small].some((t) => t.length < 3) && small.size === 1) {
    return 0; // a one-letter word ("x", "y") is not a clear match for anything but itself
  }
  return [...small].every((t) => big.has(t)) ? small.size / big.size : 0;
};

export type Drift = {
  /** diagram box key -> notebook node id, for the boxes that match */
  matched: Map<string, string>;
  /** boxes drawn that the notebook does not have */
  plannedOnly: NodeInfo[];
  /** nodes of the notebook that are not drawn */
  codeOnly: GraphNode[];
  /** arrows drawn between two matched boxes where the notebook has no path (by index of the diagram's edge) */
  arrowsWithoutCode: { arrow: any; from: string; to: string }[];
  /** data flows of the notebook between two matched boxes where the drawing has no path */
  flowsNotDrawn: { from: string; to: string }[];
};

/** the name a drawn box goes by: the variable it was drawn for (certain), or the first line of its text */
const boxName = (n: NodeInfo): { name: string; fromVariable: boolean } => {
  const v = n.members
    .map((m: any) => m.customData?.trazo?.var)
    .find((x: unknown) => typeof x === "string");
  return typeof v === "string"
    ? { name: normalizeName(v), fromVariable: true }
    : { name: normalizeName(n.label), fromVariable: false };
};

const reaches = (
  edges: { from: string; to: string }[],
  from: string,
  to: string,
): boolean => {
  const seen = new Set([from]);
  const todo = [from];
  while (todo.length) {
    const at = todo.pop()!;
    for (const e of edges) {
      if (e.from === at && !seen.has(e.to)) {
        if (e.to === to) {
          return true;
        }
        seen.add(e.to);
        todo.push(e.to);
      }
    }
  }
  return false;
};

/**
 * Compares the diagram with the data flow of a notebook (the graph `parseNotebook` makes). Each drawn box is matched
 * with its best notebook node by name; a box and a node that are equally good candidates for each other's best are
 * left unmatched rather than guessed.
 */
export const compare = (index: CanvasIndex, notebook: Graph): Drift => {
  const boxes = [...index.nodes.values()];
  const nodes = notebook.nodes;
  const nodeKey = new Map(nodes.map((n) => [n.id, normalizeName(n.lines[0])]));

  // every candidate pair, best first
  const pairs: { box: NodeInfo; node: GraphNode; score: number }[] = [];
  for (const box of boxes) {
    const { name, fromVariable } = boxName(box);
    for (const node of nodes) {
      const same = name !== "" && name === nodeKey.get(node.id);
      // a box drawn from this very variable is a better match than a box that only has the same words
      const score =
        fromVariable && same ? 2 : similarity(name, nodeKey.get(node.id)!);
      if (score > 0) {
        pairs.push({ box, node, score });
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const matched = new Map<string, string>();
  const takenNodes = new Set<string>();
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    if (matched.has(p.box.key) || takenNodes.has(p.node.id)) {
      continue;
    }
    // another pair of the same score for this box or this node means the name does not decide: leave both
    const tie = pairs.some(
      (q, j) =>
        j !== i &&
        q.score === p.score &&
        !matched.has(q.box.key) &&
        !takenNodes.has(q.node.id) &&
        (q.box.key === p.box.key || q.node.id === p.node.id),
    );
    if (tie) {
      continue;
    }
    matched.set(p.box.key, p.node.id);
    takenNodes.add(p.node.id);
  }

  const nodeOfBox = (key: string) => matched.get(key);
  const boxOfNode = new Map([...matched].map(([b, n]) => [n, b]));

  const arrowsWithoutCode = index.edges
    .filter((e) => nodeOfBox(e.from) && nodeOfBox(e.to))
    .filter(
      (e) => !reaches(notebook.edges, nodeOfBox(e.from)!, nodeOfBox(e.to)!),
    )
    .map((e) => ({ arrow: e.arrow, from: e.from, to: e.to }));

  const drawn = index.edges.map((e) => ({ from: e.from, to: e.to }));
  const flowsNotDrawn = notebook.edges
    .filter((e) => boxOfNode.has(e.from) && boxOfNode.has(e.to))
    .filter(
      (e) => !reaches(drawn, boxOfNode.get(e.from)!, boxOfNode.get(e.to)!),
    )
    .map((e) => ({ from: boxOfNode.get(e.from)!, to: boxOfNode.get(e.to)! }));

  return {
    matched,
    plannedOnly: boxes.filter((b) => !matched.has(b.key)),
    codeOnly: nodes.filter((n) => !takenNodes.has(n.id)),
    arrowsWithoutCode,
    flowsNotDrawn,
  };
};

/** One sentence for the panel */
export const summarize = (d: Drift, drawn: number): string => {
  const parts = [`${d.matched.size} of ${drawn} boxes are in the notebook`];
  if (d.plannedOnly.length) {
    parts.push(
      `${d.plannedOnly.length} planned but not in the code (red, dashed)`,
    );
  }
  if (d.codeOnly.length) {
    parts.push(
      `${d.codeOnly.length} in the code but not drawn (added in orange)`,
    );
  }
  if (d.arrowsWithoutCode.length) {
    parts.push(
      `${d.arrowsWithoutCode.length} arrow${
        d.arrowsWithoutCode.length > 1 ? "s" : ""
      } without code behind`,
    );
  }
  if (d.flowsNotDrawn.length) {
    parts.push(
      `${d.flowsNotDrawn.length} data flow${
        d.flowsNotDrawn.length > 1 ? "s" : ""
      } not drawn`,
    );
  }
  if (parts.length === 1 && d.matched.size === drawn) {
    return "The diagram and the notebook agree.";
  }
  return `${parts.join("; ")}.`;
};

/* --- scene edits ------------------------------------------------------------------------------------------------ */

const PLANNED = { strokeColor: "#e03131", strokeStyle: "dashed" };
const ADDED_STROKE = "#e8590c";

const bump = (el: any, change: Record<string, unknown>) => ({
  ...el,
  ...change,
  version: el.version + 1,
  versionNonce: Math.floor(Math.random() * 2 ** 31),
  updated: Date.now(),
});

/**
 * Marks the result on the canvas as one undo step: planned-only boxes and arrows without code in dashed red, the
 * code-only nodes added below in dashed orange. Marks from a previous comparison are removed first, so comparing
 * again after a change shows the new state and never piles up.
 */
export const markDrift = (api: ExcalidrawImperativeAPI, drift: Drift): void => {
  const marked = new Set<string>();
  for (const b of drift.plannedOnly) {
    // the box's shapes: the shape that arrows attach to, and any other shape of it (not its text)
    b.members
      .filter((m: any) => m.type !== "text")
      .forEach((m: any) => marked.add(m.id));
  }
  drift.arrowsWithoutCode.forEach((a) => marked.add(a.arrow.id));

  const scene = api.getSceneElementsIncludingDeleted() as readonly any[];
  // what a previous comparison added (and the texts inside those shapes)
  const oldAdded = new Set(
    scene.filter((e) => e.customData?.trazoDriftAdded).map((e) => e.id),
  );
  const next = scene.map((el) => {
    // forget a previous comparison
    if (
      !el.isDeleted &&
      (oldAdded.has(el.id) || (el.containerId && oldAdded.has(el.containerId)))
    ) {
      return bump(el, { isDeleted: true });
    }
    const prev = el.customData?.trazoDrift;
    let out = el;
    if (prev) {
      const { trazoDrift, ...rest } = el.customData;
      out = bump(el, {
        ...prev,
        customData: Object.keys(rest).length ? rest : undefined,
      });
    }
    if (marked.has(el.id) && !el.isDeleted) {
      return bump(out, {
        ...PLANNED,
        strokeWidth: Math.max(out.strokeWidth ?? 1, 2),
        customData: {
          ...(out.customData || {}),
          trazoDrift: {
            strokeColor: out.strokeColor,
            strokeStyle: out.strokeStyle,
            strokeWidth: out.strokeWidth,
          },
        },
      });
    }
    return out;
  });

  // what the code does and is not drawn: a small diagram of those nodes (no arrows between them) under everything
  let added: any[] = [];
  if (drift.codeOnly.length) {
    const live = scene.filter((e) => !e.isDeleted);
    const offset = live.length
      ? {
          x: Math.min(...live.map((e) => e.x)),
          y: Math.max(...live.map((e) => e.y + e.height)) + 100,
        }
      : { x: 0, y: 0 };
    const graph: Graph = {
      nodes: drift.codeOnly.map((n) => ({
        ...n,
        dashed: true,
        meta: undefined,
      })),
      edges: [],
      flow: true,
    };
    const skeletons = layoutToSkeleton(layoutGraph(graph), offset).map(
      (s: any) =>
        s.type === "arrow"
          ? s
          : {
              ...s,
              strokeColor: ADDED_STROKE,
              strokeStyle: "dashed",
              customData: { trazoDriftAdded: true },
            },
    );
    added = convertToExcalidrawElements(skeletons as any) as any[];
    added.forEach((a) => {
      a.customData = { ...(a.customData || {}), trazoDriftAdded: true };
    });
  }
  api.updateScene({
    elements: [...next, ...added] as any,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};
