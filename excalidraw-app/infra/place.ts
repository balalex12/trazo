// Puts an imported layout on the canvas: below whatever is already there, as one undo step, and fits the view to it.
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { layoutToSkeleton } from "./graph";

import type { Layout } from "./graph";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const drawLayout = (api: ExcalidrawImperativeAPI, layout: Layout) => {
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
  const [x1, y1, x2, y2] = layout.bounds;
  api.setViewport({
    target: [x1 + offset.x, y1 + offset.y, x2 + offset.x, y2 + offset.y],
    fit: "scale-down",
  } as any);
};
