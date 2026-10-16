// Puts an imported layout on the canvas: below whatever is already there, as one undo step, and fits the view to it.
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { layoutToSkeleton } from "./graph";

import type { Layout } from "./graph";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * `rightInset`: pixels on the right of the view that something covers (a panel), so the new diagram is fitted into
 * the free part to its left instead of hiding behind it.
 */
export const drawLayout = (
  api: ExcalidrawImperativeAPI,
  layout: Layout,
  rightInset = 0,
) => {
  // drop the new diagram below whatever is already on the canvas
  const live = api.getSceneElements();
  const offset = live.length
    ? {
        x: Math.min(...live.map((e) => e.x)),
        y: Math.max(...live.map((e) => e.y + e.height)) + 120,
      }
    : { x: 0, y: 0 };
  const created = convertToExcalidrawElements(
    // skeletons are plain objects; the converter validates them
    layoutToSkeleton(layout, offset) as any,
  );
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...created],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY, // so the import can be undone
  });
  const [bx1, by1, bx2, by2] = layout.bounds;
  // some air around the drawing, so it does not touch the edges of the view
  const pad = Math.max(30, 0.04 * Math.max(bx2 - bx1, by2 - by1));
  const [x1, y1, x2, y2] = [bx1 - pad, by1 - pad, bx2 + pad, by2 + pad];
  // fitting into (width - inset) pixels means the target is wider by inset / zoom, and zoom = (width - inset) / w
  const width = api.getAppState().width;
  const free = width - rightInset;
  const extra =
    rightInset > 0 && free > 100 ? (rightInset * (x2 - x1)) / free : 0;
  api.setViewport({
    target: [
      x1 + offset.x,
      y1 + offset.y,
      x2 + offset.x + extra,
      y2 + offset.y,
    ],
    fit: "scale-down",
  } as any);
};
