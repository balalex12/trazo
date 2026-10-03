// Smart-animate style timeline: frames (Excalidraw "Frame" tool) are slides, ordered by y then x.
// Elements are matched between slides by `customData.animKey` (set by "Duplicate slide") and
// interpolated: position, size, angle, opacity, colors, font size, line points.
// Elements present in only one slide fade out / in (or are revealed in order in the "build" mode).

/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;

export type Slide = { frame: El; name: string; children: El[] };
export type Easing =
  | "linear"
  | "easeInOut"
  | "easeOut"
  | "easeInOutCubic"
  | "easeOutBack"
  | "spring";
export type TimelineSettings = {
  transitionMs: number;
  holdMs: number;
  easing: Easing;
  /**
   * Length of the recorded narration of each slide, by frame id. Not a user setting (never saved with them):
   * the panel fills it from the stored clips. A slide stays at least as long as its narration.
   */
  narrationMs?: Record<string, number>;
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
  easeInOutCubic: (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  // overshoots a little and settles
  easeOutBack: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  // damped oscillation, normalised so it ends exactly at 1
  spring: (t) => {
    const f = (x: number) => 1 - Math.exp(-6 * x) * Math.cos(10 * x);
    return f(t) / f(1);
  },
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
  const ch = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  const r = ch(lerp(from[0], to[0], t));
  const g = ch(lerp(from[1], to[1], t));
  const bl = ch(lerp(from[2], to[2], t));
  const al = Math.min(1, Math.max(0, lerp(from[3], to[3], t)));
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
 *  - build: like smart, but the NEW elements appear one after another and arrows draw themselves
 *  - pan:   the camera travels over the canvas from the previous slide to this one
 */
export type TransitionMode = "smart" | "fade" | "cut" | "build" | "pan";
export const TRANSITION_MODES: TransitionMode[] = [
  "smart",
  "fade",
  "cut",
  "build",
  "pan",
];
export const transitionModeOf = (slide: Slide): TransitionMode => {
  const v = slide.frame.customData?.transition;
  return v === "fade" || v === "cut" || v === "build" || v === "pan"
    ? v
    : "smart";
};

// ---- pairing of elements between two slides -----------------------------
type Pairing = { pairs: Map<El, El>; matchedB: Set<El> };

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

const pairSlides = (A: Slide, B: Slide): Pairing => {
  const pairs = new Map<El, El>();
  const matchedB = new Set<El>();
  // 1) pair by animKey (set by "Duplicate slide")…
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
  return { pairs, matchedB };
};

// ---- "build": new elements appear one after another ---------------------
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * The new elements of B grouped into pieces that appear together: a group, or a bound text with its
 * container. Returns the piece index of every new element, in order of first appearance in the scene.
 */
export const revealUnits = (
  B: Slide,
  matchedB: Set<El>,
): { unitOf: Map<El, number>; count: number } => {
  const keyOf = (e: El): string => {
    const container = e.containerId
      ? B.children.find((x) => x.id === e.containerId)
      : undefined;
    const target = container ?? e;
    const g = target.groupIds;
    return Array.isArray(g) && g.length ? g[g.length - 1] : target.id;
  };
  const index = new Map<string, number>();
  const unitOf = new Map<El, number>();
  for (const e of B.children) {
    if (matchedB.has(e)) {
      continue;
    }
    const k = keyOf(e);
    if (!index.has(k)) {
      index.set(k, index.size);
    }
    unitOf.set(e, index.get(k)!);
  }
  return { unitOf, count: index.size };
};

const BUILD_MS_PER_UNIT = 450;

/** Duration of the transition from slide `A` into slide `B`. */
export const transitionMs = (
  A: Slide,
  B: Slide,
  s: TimelineSettings,
): number => {
  const mode = transitionModeOf(B);
  if (mode === "cut") {
    return 0;
  }
  if (mode === "build") {
    const { count } = revealUnits(B, pairSlides(A, B).matchedB);
    return count
      ? Math.min(
          10_000,
          Math.max(s.transitionMs, count * BUILD_MS_PER_UNIT + 500),
        )
      : s.transitionMs;
  }
  return s.transitionMs;
};

/** Silence kept after the last word of a narration before the next slide starts. */
export const NARRATION_TAIL_MS = 400;

/**
 * How long slide `i` stays on screen once entered. The narration of a slide starts when the transition INTO it
 * starts, so the slide (transition + hold) must last as long as the clip plus a short tail.
 */
export const effectiveHold = (
  slides: Slide[],
  i: number,
  s: TimelineSettings,
): number => {
  const base = holdOf(slides[i], s);
  const narration = s.narrationMs?.[slides[i].frame.id];
  if (!narration) {
    return base;
  }
  const trans = i > 0 ? transitionMs(slides[i - 1], slides[i], s) : 0;
  return Math.max(base, narration + NARRATION_TAIL_MS - trans);
};

/** Sequence: hold(0) → transition(0→1) → hold(1) → … → hold(n-1). */
export const totalDurationMs = (slides: Slide[], s: TimelineSettings) =>
  slides.reduce(
    (sum, sl, i) =>
      sum +
      effectiveHold(slides, i, s) +
      (i > 0 ? transitionMs(slides[i - 1], sl, s) : 0),
    0,
  );

/** Time (ms) at which the transition into each slide starts: where that slide's narration clip is placed. */
export const narrationStarts = (
  slides: Slide[],
  s: TimelineSettings,
): number[] => {
  const out: number[] = [];
  let t = 0;
  for (let i = 0; i < slides.length; i++) {
    out.push(t);
    const trans = i > 0 ? transitionMs(slides[i - 1], slides[i], s) : 0;
    t += trans + effectiveHold(slides, i, s);
  }
  return out;
};

export const sampleAt = (
  timeMs: number,
  slides: Slide[],
  s: TimelineSettings,
): Sample => {
  const n = slides.length;
  let t = Math.max(0, timeMs);
  for (let i = 0; i < n; i++) {
    const hold = effectiveHold(slides, i, s);
    if (t <= hold || i === n - 1) {
      return { a: i, b: i, t: 0 };
    }
    t -= hold;
    const tr = transitionMs(slides[i], slides[i + 1], s);
    if (tr > 0 && t <= tr) {
      return { a: i, b: i + 1, t: t / tr };
    }
    t -= tr;
  }
  return { a: Math.max(0, n - 1), b: Math.max(0, n - 1), t: 0 };
};

const DRAW_TYPES = new Set(["arrow", "line", "freedraw"]);

/** The first `fraction` (by length) of a polyline, so a line can "draw itself". Always at least two points. */
export const truncatePoints = (
  points: number[][],
  fraction: number,
): number[][] => {
  if (points.length < 2) {
    return points;
  }
  const f = clamp01(fraction);
  const lens = points
    .slice(1)
    .map((pt, i) => Math.hypot(pt[0] - points[i][0], pt[1] - points[i][1]));
  const total = lens.reduce((a, b) => a + b, 0);
  if (f >= 1 || total === 0) {
    return points;
  }
  let remaining = total * f;
  const out: number[][] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const len = lens[i - 1];
    if (remaining >= len) {
      out.push(points[i]);
      remaining -= len;
    } else {
      const k = len ? remaining / len : 0;
      out.push([
        lerp(points[i - 1][0], points[i][0], k),
        lerp(points[i - 1][1], points[i][1], k),
      ]);
      break;
    }
  }
  if (out.length < 2) {
    out.push([points[0][0], points[0][1]]);
  }
  return out;
};

/** A new element at reveal progress `q` (0..1): lines draw themselves, everything else fades in. */
const revealElement = (e: El, q: number): El => {
  const k = clamp01(q);
  if (DRAW_TYPES.has(e.type) && Array.isArray(e.points)) {
    const pts = truncatePoints(e.points, k);
    const xs = pts.map((pt) => pt[0]);
    const ys = pts.map((pt) => pt[1]);
    return {
      ...e,
      points: pts,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      opacity: k <= 0 ? 0 : e.opacity,
    };
  }
  return { ...e, opacity: e.opacity * k };
};

// ---- "pan": the camera travels over the canvas ----------------------------
/** Camera rectangle (canvas coordinates) at eased progress `p`, with a small zoom-out on long trips. */
export const panViewport = (A: Slide, B: Slide, p: number) => {
  const ax = A.frame.x + A.frame.width / 2;
  const ay = A.frame.y + A.frame.height / 2;
  const bx = B.frame.x + B.frame.width / 2;
  const by = B.frame.y + B.frame.height / 2;
  const span = Math.max(
    A.frame.width,
    A.frame.height,
    B.frame.width,
    B.frame.height,
  );
  const trip = Math.hypot(bx - ax, by - ay);
  const zoomOut = Math.min(1.5, trip / (span * 2)); // 0 for neighbours at the same place, up to +150%
  const z = 1 + zoomOut * Math.sin(Math.PI * clamp01(p));
  const w = lerp(A.frame.width, B.frame.width, p) * z;
  const h = lerp(A.frame.height, B.frame.height, p) * z;
  const cx = lerp(ax, bx, p);
  const cy = lerp(ay, by, p);
  return { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
};

// ---- captions -----------------------------------------------------------
export const captionOf = (slide: Slide): string => {
  const v = slide.frame.customData?.caption;
  return typeof v === "string" ? v.trim() : "";
};

/** Caption to show at progress `p` of A→B and how opaque it is: the old one fades out, then the new one fades in. */
export const captionAt = (
  A: Slide,
  B: Slide,
  p: number,
): { text: string; alpha: number } => {
  const ca = captionOf(A);
  const cb = captionOf(B);
  if (ca === cb) {
    return { text: ca, alpha: 1 };
  }
  return p < 0.5
    ? { text: ca, alpha: clamp01(1 - p * 2) }
    : { text: cb, alpha: clamp01((p - 0.5) * 2) };
};

/** Greedy word wrap into at most `maxLines` lines (an ellipsis marks cut text). */
export const wrapText = (
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
  maxLines = 3,
): string[] => {
  const lines: string[] = [];
  let line = "";
  let cut = false;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (!line || measure(next) <= maxWidth) {
      line = next;
    } else if (lines.length + 1 >= maxLines) {
      cut = true;
      break;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) {
    lines.push(line);
  }
  if (cut) {
    lines[lines.length - 1] = `${lines[lines.length - 1]}…`;
  }
  return lines;
};

/**
 * Elements for the synthetic scene at transition progress `p` (already eased), in frame-relative
 * coordinates: frame at (0,0), every child has frameId "__anim_frame__". `rawT` is the linear progress,
 * used for the order of the "build" mode.
 */
export const buildScene = (
  A: Slide,
  B: Slide,
  p: number,
  rawT: number = p,
): { frame: El; elements: El[] } => {
  const FRAME_ID = "__anim_frame__";
  const mode = transitionModeOf(B);
  const clampOpacity = (e: El) => ({
    ...e,
    opacity: Math.min(100, Math.max(0, e.opacity)), // overshooting easings must not go out of range
  });

  if (mode === "pan") {
    const vp = panViewport(A, B, p);
    return {
      frame: {
        ...A.frame,
        id: FRAME_ID,
        x: 0,
        y: 0,
        width: vp.width,
        height: vp.height,
        name: null,
      },
      elements: [...A.children, ...B.children].map((e) => ({
        ...e,
        x: e.x - vp.x,
        y: e.y - vp.y,
        frameId: FRAME_ID,
      })),
    };
  }

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
  const { pairs, matchedB } = pairSlides(A, B);
  const fadeOut = mode === "build" ? 1 - clamp01(rawT / 0.3) : 1 - p;

  for (const ea of A.children) {
    const eb = pairs.get(ea);
    if (!eb) {
      // fades out
      const a = rel(A, ea);
      out.push({ ...a, frameId: FRAME_ID, opacity: a.opacity * fadeOut });
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

  const { unitOf, count } = revealUnits(B, matchedB);
  // each piece gets its own window of the transition; windows overlap when there are many pieces
  const dur = count <= 1 ? 1 : Math.min(0.6, Math.max(0.15, 2 / count));
  const step = count <= 1 ? 0 : (1 - dur) / (count - 1);
  for (const eb of B.children) {
    if (matchedB.has(eb)) {
      continue;
    }
    const b = { ...rel(B, eb), frameId: FRAME_ID };
    if (mode === "build") {
      const q = (rawT - (unitOf.get(eb) ?? 0) * step) / dur;
      out.push(revealElement(b, EASE.easeOut(clamp01(q))));
    } else {
      out.push({ ...b, opacity: b.opacity * p }); // fades in
    }
  }
  return { frame, elements: out.map(clampOpacity) };
};
