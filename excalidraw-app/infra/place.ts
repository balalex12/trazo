// Puts an imported layout on the canvas: below whatever is already there, as one undo step, and fits the view to it.
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { layoutToSkeleton } from "./graph";

import type { Skeleton } from "./graph";

import type { Layout } from "./graph";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Where new drawings go: below whatever is already on the canvas (or at the origin when it is empty) */
const freeSpot = (api: ExcalidrawImperativeAPI) => {
  const live = api.getSceneElements();
  return live.length
    ? {
        x: Math.min(...live.map((e) => e.x)),
        y: Math.max(...live.map((e) => e.y + e.height)) + 120,
      }
    : { x: 0, y: 0 };
};

/**
 * Adds skeletons built for `offset` as one undo step and fits the view to `bounds` (their area, offset included).
 * `rightInset`: pixels on the right of the view that something covers (a panel), so the drawing is fitted into the
 * free part to its left instead of hiding behind it.
 */
const place = (
  api: ExcalidrawImperativeAPI,
  skeletons: Skeleton[],
  bounds: [number, number, number, number],
  rightInset: number,
) => {
  const created = convertToExcalidrawElements(
    // skeletons are plain objects; the converter validates them
    skeletons as any,
  );
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...created],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY, // so the import can be undone
  });
  const [bx1, by1, bx2, by2] = bounds;
  // some air around the drawing, so it does not touch the edges of the view
  const pad = Math.max(30, 0.04 * Math.max(bx2 - bx1, by2 - by1));
  const [x1, y1, x2, y2] = [bx1 - pad, by1 - pad, bx2 + pad, by2 + pad];
  // fitting into (width - inset) pixels means the target is wider by inset / zoom, and zoom = (width - inset) / w
  const width = api.getAppState().width;
  const free = width - rightInset;
  const extra =
    rightInset > 0 && free > 100 ? (rightInset * (x2 - x1)) / free : 0;
  api.setViewport({
    target: [x1, y1, x2 + extra, y2],
    fit: "scale-down",
  } as any);
};

export const drawLayout = (
  api: ExcalidrawImperativeAPI,
  layout: Layout,
  rightInset = 0,
) => {
  const offset = freeSpot(api);
  const [x1, y1, x2, y2] = layout.bounds;
  place(
    api,
    layoutToSkeleton(layout, offset),
    [x1 + offset.x, y1 + offset.y, x2 + offset.x, y2 + offset.y],
    rightInset,
  );
};

/** Draws what `build` makes for the free spot (skeletons and the area they cover), fitted next to a panel */
export const drawBuilt = (
  api: ExcalidrawImperativeAPI,
  build: (offset: { x: number; y: number }) => {
    skeleton: Skeleton[];
    bounds: [number, number, number, number];
  },
  rightInset = 0,
) => {
  const { skeleton, bounds } = build(freeSpot(api));
  place(api, skeleton, bounds, rightInset);
};
