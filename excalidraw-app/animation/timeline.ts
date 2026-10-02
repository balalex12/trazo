// Smart-animate style timeline: frames (Excalidraw "Frame" tool) are slides, ordered by y then x.
// Elements are matched between slides by `customData.animKey` (set by "Duplicate slide") and
// interpolated: position, size, angle, opacity, colors, font size, line points.
// Elements present in only one slide fade out / in.

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

export type Slide = { frame: El; name: string; children: El[] };
export type Easing = "linear" | "easeInOut" | "easeOut";
export type TimelineSettings = {
  transitionMs: number;
  holdMs: number;
  easing: Easing;
};
export type Sample = { a: number; b: number; t: number };

export const DEFAULT_SETTINGS: TimelineSettings = {
  transitionMs: 900,
  holdMs: 1500,
  easing: "easeInOut",
};

export const getSlides = (elements: readonly El[]): Slide[] => {
  const live = elements.filter((e) => !e.isDeleted);
  const frames = live
    .filter((e) => e.type === "frame")
    .sort((a, b) => a.y - b.y || a.x - b.x);
  return frames.map((frame, i) => ({
    frame,
    name: frame.name || `Slide ${i + 1}`,
    children: live.filter((e) => e.frameId === frame.id),
  }));
};

export const animKey = (el: El): string => el.customData?.animKey ?? el.id;

const EASE: Record<Easing, (t: number) => number> = {
  linear: (t) => t,
  easeInOut: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
};
export const ease = (e: Easing, t: number) =>
  EASE[e](Math.min(1, Math.max(0, t)));

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---- colors -----------------------------------------------------------
type RGBA = [number, number, number, number];
const parseColor = (c: string | undefined): RGBA | null => {
  if (!c) {
    return null;
  }
  if (c === "transparent") {
    return [0, 0, 0, 0];
  }
  const m = c.match(/^#([0-9a-f]{3,8})$/i);
  if (!m) {
    return null;
  }
  let h = m[1];
  if (h.length === 3 || h.length === 4) {
    h = h
      .split("")
      .map((x) => x + x)
      .join("");
  }
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
};
const lerpColor = (a: string, b: string, t: number): string => {
  if (a === b) {
    return a;
  }
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) {
    return t < 0.5 ? a : b;
  }
  // when one side is transparent, keep the other side's rgb so it fades instead of going dark
  const from: RGBA = ca[3] === 0 ? [cb[0], cb[1], cb[2], 0] : ca;
  const to: RGBA = cb[3] === 0 ? [ca[0], ca[1], ca[2], 0] : cb;
  const r = Math.round(lerp(from[0], to[0], t));
  const g = Math.round(lerp(from[1], to[1], t));
  const bl = Math.round(lerp(from[2], to[2], t));
  const al = lerp(from[3], to[3], t);
  return al >= 0.999
    ? `#${[r, g, bl].map((x) => x.toString(16).padStart(2, "0")).join("")}`
    : al <= 0.001
    ? "transparent"
    : `rgba(${r},${g},${bl},${al.toFixed(3)})`;
};

// ---- sampling ---------------------------------------------------------
/** A slide's own hold (stored on its frame as `customData.holdMs`) or the global default. */
export const holdOf = (slide: Slide, s: TimelineSettings): number => {
  const v = slide.frame.customData?.holdMs;
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : s.holdMs;
};

/**
 * How a slide is entered (stored on its frame as `customData.transition`):
 *  - smart: matching elements move/morph, new ones fade in, removed ones fade out (default)
 *  - fade:  nothing moves; the previous slide cross-fades into this one (identical elements stay put)
 *  - cut:   instant switch, no transition time
 */
export type TransitionMode = "smart" | "fade" | "cut";
export const TRANSITION_MODES: TransitionMode[] = ["smart", "fade", "cut"];
export const transitionModeOf = (slide: Slide): TransitionMode => {
  const v = slide.frame.customData?.transition;
  return v === "fade" || v === "cut" ? v : "smart";
};
/** Duration of the transition INTO `slide`. */
const transitionInto = (slide: Slide, s: TimelineSettings) =>
  transitionModeOf(slide) === "cut" ? 0 : s.transitionMs;

/** Sequence: hold(0) → transition(0→1) → hold(1) → … → hold(n-1). */
export const totalDurationMs = (slides: Slide[], s: TimelineSettings) =>
  slides.reduce(
    (sum, sl, i) => sum + holdOf(sl, s) + (i > 0 ? transitionInto(sl, s) : 0),
    0,
  );

export const sampleAt = (
  timeMs: number,
  slides: Slide[],
  s: TimelineSettings,
): Sample => {
  const n = slides.length;
  let t = Math.max(0, timeMs);
  for (let i = 0; i < n; i++) {
    const hold = holdOf(slides[i], s);
    if (t <= hold || i === n - 1) {
      return { a: i, b: i, t: 0 };
    }
    t -= hold;
    const tr = transitionInto(slides[i + 1], s);
    if (tr > 0 && t <= tr) {
      return { a: i, b: i + 1, t: t / tr };
    }
    t -= tr;
  }
  return { a: Math.max(0, n - 1), b: Math.max(0, n - 1), t: 0 };
};

/** Same look and place (frame-relative) → the element must not animate at all. */
const signature = (e: El, frame: El): string => {
  const r = (v: number) => (Math.round(v * 2) / 2).toString();
  return [
    e.type,
    r(e.x - frame.x),
    r(e.y - frame.y),
    r(e.width),
    r(e.height),
    r(e.angle ?? 0),
    e.strokeColor,
    e.backgroundColor,
    e.strokeWidth,
    e.opacity,
    e.text ?? "",
    e.fontSize ?? "",
    Array.isArray(e.points)
      ? e.points.map((q: number[]) => `${r(q[0])},${r(q[1])}`).join(";")
      : "",
  ].join("|");
};

/**
 * Elements for the synthetic scene at transition progress `p` (already eased), in frame-relative
 * coordinates: frame at (0,0), every child has frameId "__anim_frame__".
 */
export const buildScene = (
  A: Slide,
  B: Slide,
  p: number,
): { frame: El; elements: El[] } => {
  const FRAME_ID = "__anim_frame__";
  const frame = {
    ...A.frame,
    id: FRAME_ID,
    x: 0,
    y: 0,
    width: lerp(A.frame.width, B.frame.width, p),
    height: lerp(A.frame.height, B.frame.height, p),
    name: null,
  };
  const rel = (s: Slide, e: El) => ({
    ...e,
    x: e.x - s.frame.x,
    y: e.y - s.frame.y,
  });
  const useB = p >= 0.5;
  const out: El[] = [];
  const mode = transitionModeOf(B);

  // 1) pair elements by animKey (set by "Duplicate slide")…
  const pairs = new Map<El, El>();
  const matchedB = new Set<El>();
  const bByKey = new Map<string, El[]>();
  B.children.forEach((e) => {
    const k = animKey(e);
    bByKey.set(k, [...(bByKey.get(k) || []), e]);
  });
  for (const ea of A.children) {
    const eb = (bByKey.get(animKey(ea)) || []).find(
      (e) => !matchedB.has(e) && e.type === ea.type,
    );
    if (eb) {
      pairs.set(ea, eb);
      matchedB.add(eb);
    }
  }
  // 2) …then pair identical leftovers (copy/pasted content has no animKey) so they stay put instead of blinking
  const bBySig = new Map<string, El[]>();
  B.children
    .filter((e) => !matchedB.has(e))
    .forEach((e) => {
      const k = signature(e, B.frame);
      bBySig.set(k, [...(bBySig.get(k) || []), e]);
    });
  for (const ea of A.children) {
    if (pairs.has(ea)) {
      continue;
    }
    const eb = bBySig.get(signature(ea, A.frame))?.shift();
    if (eb) {
      pairs.set(ea, eb);
      matchedB.add(eb);
    }
  }

  for (const ea of A.children) {
    const eb = pairs.get(ea);
    if (!eb) {
      // fades out
      const a = rel(A, ea);
      out.push({ ...a, frameId: FRAME_ID, opacity: a.opacity * (1 - p) });
      continue;
    }
    const a = rel(A, ea);
    const b = rel(B, eb);
    if (mode === "fade" && signature(ea, A.frame) !== signature(eb, B.frame)) {
      // "fade": never move, cross-fade the two versions in place
      out.push({ ...a, frameId: FRAME_ID, opacity: a.opacity * (1 - p) });
      out.push({ ...b, frameId: FRAME_ID, opacity: b.opacity * p });
      continue;
    }
    const base = useB ? b : a;
    const next: El = {
      ...base,
      frameId: FRAME_ID,
      x: lerp(a.x, b.x, p),
      y: lerp(a.y, b.y, p),
      width: lerp(a.width, b.width, p),
      height: lerp(a.height, b.height, p),
      angle: lerp(a.angle, b.angle, p),
      opacity: lerp(a.opacity, b.opacity, p),
      strokeColor: lerpColor(a.strokeColor, b.strokeColor, p),
      backgroundColor: lerpColor(a.backgroundColor, b.backgroundColor, p),
      strokeWidth: lerp(a.strokeWidth, b.strokeWidth, p),
    };
    if (typeof a.fontSize === "number" && typeof b.fontSize === "number") {
      next.fontSize = lerp(a.fontSize, b.fontSize, p);
    }
    if (
      Array.isArray(a.points) &&
      Array.isArray(b.points) &&
      a.points.length === b.points.length
    ) {
      next.points = a.points.map((pt: number[], i: number) => [
        lerp(pt[0], b.points[i][0], p),
        lerp(pt[1], b.points[i][1], p),
      ]);
    }
    out.push(next);
  }
  for (const eb of B.children) {
    if (matchedB.has(eb)) {
      continue;
    }
    const b = rel(B, eb);
    out.push({ ...b, frameId: FRAME_ID, opacity: b.opacity * p }); // fades in
  }
  return { frame, elements: out };
};
