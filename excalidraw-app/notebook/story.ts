// A diagram drawn from a notebook becomes the slides of an explainer: one slide per step of the analysis (per code
// cell that made something), each showing everything built so far with the new boxes of that step to appear one after
// another (the "build" transition of the animation panel). The slides are ordinary frames, so the animation panel
// plays, exports (MP4, GIF, HTML player) and narrates them like any others, and the AI director can write their
// captions. No AI here: the captions are plain descriptions of what each cell added. The plan is pure; the scene
// edit is at the bottom.
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  restoreElements,
} from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { El } from "../agent/elements";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const MAX_STEPS = 24;
export const MAX_CAPTION = 120;
const PAD = 60;
const ASPECT = 16 / 9;
const GAP = 120;
const HOLD_MS = 2800;

export type Step = {
  /** the code cell (its position among the code cells) the boxes of this step come from */
  cell: number;
  caption: string;
  /** every element shown on this slide: the boxes built so far, their texts and the arrows between them */
  ids: string[];
  /** the ones that are new on this slide */
  added: string[];
};

export type StoryPlan = {
  steps: Step[];
  /** the area the whole diagram covers: x, y, width, height */
  bounds: { x: number; y: number; width: number; height: number };
};

const metaCell = (e: El): number | undefined =>
  typeof e.customData?.trazo?.cell === "number"
    ? e.customData.trazo.cell
    : undefined;

const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

/** "📊 df" -> "df" */
const plain = (s: string) => s.replace(/^[^\p{L}\p{N}_]+/u, "").trim();

/** what a step added, in a line: "df: merge, dropna · model: fit on X_train" */
const describe = (boxes: El[], textOf: (box: El) => string[]): string => {
  const parts = boxes.map((b) => {
    const lines = textOf(b);
    const name = plain(lines[0] ?? "");
    const ops = lines.find((l) => l.startsWith("↳"))?.replace(/^↳\s*/, "");
    return ops ? `${name}: ${ops}` : name;
  });
  return clip(parts.filter(Boolean).join(" · "), MAX_CAPTION);
};

/**
 * The slides for the diagram on the canvas, or a sentence saying why there is nothing to make. A box belongs to a step
 * through the code cell it was drawn from (`customData.trazo.cell`), so this works on diagrams made by "Diagram this
 * notebook" or by the Notebook import.
 */
export const planStory = (elements: readonly El[]): StoryPlan | string => {
  const live = elements.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  const boxes = live.filter(
    (e) =>
      e.type !== "text" &&
      e.type !== "arrow" &&
      metaCell(e) !== undefined &&
      !e.customData?.trazoBadge,
  );
  if (!boxes.length) {
    return "There is no diagram from a notebook on the canvas. Draw one first with “Diagram this notebook”.";
  }
  const cells = [...new Set(boxes.map((b) => metaCell(b)!))].sort(
    (a, b) => a - b,
  );
  if (cells.length < 2) {
    return "All the boxes come from one cell, so there is nothing to show step by step.";
  }
  if (cells.length > MAX_STEPS) {
    return `That notebook has ${cells.length} steps with boxes; the limit for slides is ${MAX_STEPS}.`;
  }
  const textsOf = (box: El) =>
    live
      .filter((t) => t.type === "text" && t.containerId === box.id)
      .flatMap((t) => String(t.text ?? "").split("\n"));
  const textElementsOf = (id: string) =>
    live
      .filter((t) => t.type === "text" && t.containerId === id)
      .map((t) => t.id);

  const arrows = live.filter((e) => e.type === "arrow");
  const steps: Step[] = [];
  let shown = new Set<string>();
  for (const cell of cells) {
    const added = boxes.filter((b) => metaCell(b) === cell);
    const boxIds = new Set(
      boxes.filter((b) => metaCell(b)! <= cell).map((b) => b.id),
    );
    const ids: string[] = [];
    for (const id of boxIds) {
      ids.push(id, ...textElementsOf(id));
    }
    for (const a of arrows) {
      if (
        boxIds.has(a.startBinding?.elementId) &&
        boxIds.has(a.endBinding?.elementId)
      ) {
        ids.push(a.id, ...textElementsOf(a.id));
      }
    }
    const now = new Set(ids);
    const before = shown;
    steps.push({
      cell,
      caption: `Cell ${cell}: ${describe(added, textsOf)}`,
      ids,
      added: ids.filter((id) => !before.has(id)),
    });
    shown = now;
  }

  const used = new Set(steps[steps.length - 1].ids);
  const els = [...used].map((id) => byId.get(id)!).filter(Boolean);
  const x1 = Math.min(...els.map((e) => e.x));
  const y1 = Math.min(...els.map((e) => e.y));
  const x2 = Math.max(...els.map((e) => e.x + e.width));
  const y2 = Math.max(...els.map((e) => e.y + e.height));
  return { steps, bounds: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } };
};

const uid = () =>
  (crypto as any).randomUUID?.().replace(/-/g, "").slice(0, 21) ??
  Math.random().toString(36).slice(2) + Date.now().toString(36);

/**
 * Adds the slides under everything else as one undo step: for each step a frame with copies of its elements (same
 * positions, `animKey` of the original so the animation panel morphs and builds between slides), a caption, the
 * "build" transition and a hold time. Returns how many slides were made.
 */
export const makeSlides = (
  api: ExcalidrawImperativeAPI,
  plan: StoryPlan,
): number => {
  const scene = api.getSceneElementsIncludingDeleted() as any[];
  const live = scene.filter((e) => !e.isDeleted);
  const byId = new Map(live.map((e) => [e.id, e]));
  // a video is 16:9: the frame is the diagram plus a margin, widened or heightened to that shape and centered on it,
  // so the picture fills the screen instead of being a thin strip in the middle
  let frameW = plan.bounds.width + PAD * 2;
  let frameH = plan.bounds.height + PAD * 2;
  if (frameW / frameH > ASPECT) {
    frameH = frameW / ASPECT;
  } else {
    frameW = frameH * ASPECT;
  }
  const left = plan.bounds.x + plan.bounds.width / 2 - frameW / 2;
  const top = plan.bounds.y + plan.bounds.height / 2 - frameH / 2;
  const bottom = Math.max(...live.map((e) => e.y + e.height));
  const created: any[] = [];

  plan.steps.forEach((step, i) => {
    const frameY = bottom + GAP + i * (frameH + GAP);
    const dy = frameY - top;
    const frameId = uid();
    const idMap = new Map(step.ids.map((id) => [id, uid()]));
    const groupMap = new Map<string, string>();
    const mapGroup = (g: string) => {
      if (!groupMap.has(g)) {
        groupMap.set(g, uid());
      }
      return groupMap.get(g)!;
    };
    const remap = (id: string | null | undefined) =>
      id ? idMap.get(id) ?? null : null;
    const [made] = convertToExcalidrawElements([
      {
        type: "frame",
        id: frameId,
        x: left,
        y: frameY,
        width: frameW,
        height: frameH,
        name: `Step ${i + 1} · cell ${step.cell}`,
        children: [],
      } as any,
    ]) as any[];
    // the converter makes its own id: the copies point at this one, so it is set here
    const frame: any = { ...made, id: frameId };
    frame.customData = {
      caption: step.caption,
      // the first slide is simply there; each next one builds on the previous
      transition: i === 0 ? "cut" : "build",
      holdMs: HOLD_MS,
    };
    created.push(frame);
    for (const id of step.ids) {
      const e = byId.get(id);
      if (!e) {
        continue;
      }
      const c: any = {
        ...e,
        id: idMap.get(id)!,
        y: e.y + dy,
        index: null,
        version: 1,
        versionNonce: Math.floor(Math.random() * 2 ** 31),
        frameId,
        groupIds: (e.groupIds || []).map(mapGroup),
        customData: {
          ...(e.customData || {}),
          animKey: e.customData?.animKey ?? e.id,
        },
      };
      if ("containerId" in e) {
        c.containerId = remap(e.containerId);
      }
      if (e.boundElements) {
        c.boundElements = e.boundElements
          .map((b: any) => ({ ...b, id: idMap.get(b.id) ?? null }))
          .filter((b: any) => b.id);
      }
      for (const k of ["startBinding", "endBinding"] as const) {
        if (e[k]) {
          const target = idMap.get(e[k].elementId);
          c[k] = target ? { ...e[k], elementId: target } : null;
        }
      }
      created.push(c);
    }
  });

  const restored = restoreElements(created as any, null);
  api.updateScene({
    elements: [...scene, ...restored] as any,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  const frames = restored.filter((e: any) => e.type === "frame");
  const first = frames[0];
  const last = frames[frames.length - 1];
  if (first && last) {
    api.setViewport({
      target: [first.x, first.y, first.x + first.width, last.y + last.height],
      fit: "scale-down",
    } as any);
  }
  return plan.steps.length;
};
