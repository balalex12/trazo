import { exportToCanvas } from "@excalidraw/excalidraw";

import { buildScene, ease, sampleAt } from "./timeline";

import type { Slide, TimelineSettings } from "./timeline";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type RenderOptions = {
  slides: Slide[];
  files: any;
  settings: TimelineSettings;
  /** output size in px (the canvas is cleared and the slide drawn "contain"-fit) */
  width: number;
  height: number;
  background?: string;
};

/**
 * Output size that keeps the first slide's aspect ratio, even numbers (H.264 needs that).
 * NOT capped to the slide's own size: the scene is re-rendered as vectors at this size,
 * so larger outputs stay sharp instead of being a stretched bitmap.
 */
export const outputSize = (slides: Slide[], maxWidth: number) => {
  const f = slides[0].frame;
  const w = Math.max(2, Math.round(maxWidth));
  const h = Math.round((w * f.height) / f.width);
  return { width: w - (w % 2), height: h - (h % 2) };
};

/** Draws slide `a`→`b` at eased progress onto `target` (created if omitted). */
export const renderBlend = async (
  opts: RenderOptions,
  a: number,
  b: number,
  rawT: number,
  target?: HTMLCanvasElement,
): Promise<HTMLCanvasElement> => {
  const { slides, files, settings, width, height } = opts;
  const p = a === b ? 0 : ease(settings.easing, rawT);
  const { frame, elements } = buildScene(slides[a], slides[b], p);
  const bg = opts.background ?? "#ffffff";

  const src = await exportToCanvas({
    elements: [frame, ...elements] as any,
    appState: { exportBackground: true, viewBackgroundColor: bg },
    files,
    exportPadding: 0,
    exportingFrame: frame,
    getDimensions: (w: number, h: number) => {
      const scale = Math.min(width / w, height / h);
      return {
        width: Math.max(1, Math.round(w * scale)),
        height: Math.max(1, Math.round(h * scale)),
        scale,
      };
    },
  } as any);

  const out = target ?? document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(src, (width - src.width) / 2, (height - src.height) / 2);
  return out;
};

export const renderAtTime = (
  opts: RenderOptions,
  timeMs: number,
  target?: HTMLCanvasElement,
) => {
  const s = sampleAt(timeMs, opts.slides.length, opts.settings);
  return renderBlend(opts, s.a, s.b, s.t, target);
};
