// "Direct with AI": your own model reads what is on each slide and proposes the video around it: a caption and a
// narration script per slide, how long each should stay, and which transition suits it. Pure (no DOM, no network):
// this file builds what the model is told, reads what it answers, and checks every field before anything touches the
// drawing. The model never writes code and never edits the canvas: its answer is a small JSON of values for the fields
// that already exist (caption, hold time, transition, script), and each value is validated and shown for approval.
import { TRANSITION_MODES, animKey } from "./timeline";

import type { Slide, TransitionMode } from "./timeline";

/* eslint-disable @typescript-eslint/no-explicit-any */

export const MAX_CAPTION = 120;
export const MAX_SCRIPT = 600;
export const MIN_HOLD_MS = 600;
export const MAX_HOLD_MS = 20_000;

// ---- what the model is shown ----------------------------------------------------------------------------------
export type SlideBrief = {
  slide: number;
  name: string;
  /** the texts on the slide, in reading order (labels, titles, arrow labels) */
  texts: string[];
  /** counts by kind of shape, for example { rectangle: 3, arrow: 2 } */
  shapes: Record<string, number>;
  /** what is new compared with the previous slide */
  added?: string[];
  removed?: string[];
  moved?: number;
  /** what the slide already has (the model should keep it unless asked) */
  caption?: string;
  script?: string;
};

const clean = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

const textsOf = (slide: Slide): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of [...slide.children].sort(
    (a: any, b: any) => a.y - b.y || a.x - b.x,
  )) {
    const t = e.type === "text" ? clean(String(e.text ?? ""), 90) : "";
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out.slice(0, 14);
};

export const describeSlides = (slides: Slide[]): SlideBrief[] =>
  slides.map((slide, i) => {
    const shapes: Record<string, number> = {};
    for (const e of slide.children as any[]) {
      if (e.type !== "text") {
        shapes[e.type] = (shapes[e.type] || 0) + 1;
      }
    }
    const brief: SlideBrief = {
      slide: i + 1,
      name: slide.name,
      texts: textsOf(slide),
      shapes,
    };
    const caption = slide.frame.customData?.caption;
    const script = slide.frame.customData?.script;
    if (typeof caption === "string" && caption.trim()) {
      brief.caption = clean(caption, MAX_CAPTION);
    }
    if (typeof script === "string" && script.trim()) {
      brief.script = clean(script, MAX_SCRIPT);
    }
    if (i > 0) {
      const prev = slides[i - 1];
      const before = new Map<string, any>(
        (prev.children as any[]).map((e) => [animKey(e), e]),
      );
      const now = new Map<string, any>(
        (slide.children as any[]).map((e) => [animKey(e), e]),
      );
      const label = (e: any) =>
        e.type === "text"
          ? clean(String(e.text ?? ""), 60)
          : `a ${String(e.type)}`;
      const added = [...now]
        .filter(([k]) => !before.has(k))
        .map(([, e]) => label(e));
      const removed = [...before]
        .filter(([k]) => !now.has(k))
        .map(([, e]) => label(e));
      let moved = 0;
      for (const [k, e] of now) {
        const b = before.get(k);
        if (
          b &&
          (Math.abs(e.x - slide.frame.x - (b.x - prev.frame.x)) > 1 ||
            Math.abs(e.y - slide.frame.y - (b.y - prev.frame.y)) > 1)
        ) {
          moved++;
        }
      }
      if (added.length) {
        brief.added = added.slice(0, 8);
      }
      if (removed.length) {
        brief.removed = removed.slice(0, 8);
      }
      if (moved) {
        brief.moved = moved;
      }
    }
    return brief;
  });

export const DIRECTOR_SYSTEM = `You are the video director inside Trazo, a diagram editor whose slides become an animated explainer video. You are given the slides (what is written on each one and what changed since the previous slide) and, optionally, a note from the author about the audience, tone, language or length. Propose the captions, the narration script, how long each slide stays on screen and the transition into each slide.

Reply with ONLY a JSON object, nothing before or after it, in this shape:
{"message": "<one short sentence about the approach>", "slides": [{"slide": 1, "caption": "...", "script": "...", "holdMs": 3500, "transition": "build"}]}

Fields of each item (all optional except "slide"; leave out what should stay as it is):
- "slide": the slide number, starting at 1.
- "caption": the line shown at the bottom of the slide. At most ${MAX_CAPTION} characters, about 12 words. It supports what the viewer sees, it does not repeat the slide title.
- "script": what a narrator says over this slide, in 1 to 3 natural spoken sentences, at most ${MAX_SCRIPT} characters. No markdown, no stage directions, no emoji. Write numbers and abbreviations the way they are said.
- "holdMs": how long the slide stays still after it has appeared, in milliseconds, from ${MIN_HOLD_MS} to ${MAX_HOLD_MS}. Longer for dense slides.
- "transition": how the slide is entered, one of:
  "smart" (matching elements move and morph, new ones fade in: for steps that rearrange what was there),
  "build" (new elements appear one by one and arrows draw themselves: best when the slide ADDS things to explain a flow),
  "fade" (a soft cross-fade: for a change of topic that keeps the same layout),
  "cut" (instant: for title cards or unrelated slides),
  "pan" (the camera travels to a slide placed elsewhere on the canvas: for zooming into a detail).
  The first slide has no transition into it: leave it out there.

Rules:
- Write in the language of the slides, unless the author's note asks for another.
- Use only what is on the slides. Do not invent products, numbers or claims that are not there.
- The script of slide N should tell what is NEW on slide N (the "added" list), so the story advances: set the scene on the first slide, one idea per slide, close on the last.
- Keep what the author already wrote ("caption" and "script" given in a slide) unless the note asks to change it: then omit that field.
- Never mention slide numbers or the word "slide" in captions or scripts.`;

/** the user turn: the slides as they are, then the author's note */
export const buildDirectorTurn = (briefs: SlideBrief[], note: string): string =>
  `SLIDES:\n${JSON.stringify(briefs)}\n\nAUTHOR'S NOTE:\n${
    note.trim() || "(none: use your judgment)"
  }`;

// ---- what the model answers -----------------------------------------------------------------------------------
export type DirectionItem = {
  /** 0-based index of the slide */
  index: number;
  caption?: string;
  script?: string;
  holdMs?: number;
  transition?: TransitionMode;
};

export type Direction = {
  message: string;
  items: DirectionItem[];
  /** things in the answer that were ignored, in words (shown to the person) */
  dropped: string[];
};

const stripFences = (raw: string) =>
  raw
    .trim()
    .replace(/^```[a-zA-Z]*\s*/, "")
    .replace(/\s*```\s*$/, "")
    .trim();

/**
 * Reads the answer. Models wrap JSON in fences or add a sentence around it; the object is taken from the first `{` to
 * the last `}`. Every field is checked: wrong types, unknown slides, out-of-range times and unknown transitions are
 * dropped (and listed), never "fixed" into something the model did not say, except clamping a hold time.
 */
export const parseDirection = (raw: string, slideCount: number): Direction => {
  const text = stripFences(raw);
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  const fail = (why: string): Direction => ({
    message: "",
    items: [],
    dropped: [why],
  });
  if (first < 0 || last <= first) {
    return fail("The model did not answer with a JSON object.");
  }
  let j: any;
  try {
    j = JSON.parse(text.slice(first, last + 1));
  } catch (e) {
    return fail("The model's answer is not valid JSON.");
  }
  if (!j || typeof j !== "object" || !Array.isArray(j.slides)) {
    return fail('The answer has no "slides" list.');
  }
  const dropped: string[] = [];
  const byIndex = new Map<number, DirectionItem>();
  for (const raw of j.slides.slice(0, 200)) {
    const n = Number(raw?.slide);
    if (!raw || !Number.isInteger(n) || n < 1 || n > slideCount) {
      dropped.push(`an entry for slide ${String(raw?.slide)} (no such slide)`);
      continue;
    }
    const item: DirectionItem = { index: n - 1 };
    if (typeof raw.caption === "string") {
      const c = raw.caption.replace(/\s+/g, " ").trim();
      if (c) {
        item.caption = c.slice(0, MAX_CAPTION);
      }
    } else if (raw.caption !== undefined) {
      dropped.push(`the caption of slide ${n} (not text)`);
    }
    if (typeof raw.script === "string") {
      const s = raw.script.replace(/\s+/g, " ").trim();
      if (s) {
        item.script = s.slice(0, MAX_SCRIPT);
      }
    } else if (raw.script !== undefined) {
      dropped.push(`the script of slide ${n} (not text)`);
    }
    if (raw.holdMs !== undefined) {
      const h = Number(raw.holdMs);
      if (Number.isFinite(h)) {
        item.holdMs =
          Math.round(Math.min(MAX_HOLD_MS, Math.max(MIN_HOLD_MS, h)) / 100) *
          100;
      } else {
        dropped.push(`the hold time of slide ${n} (not a number)`);
      }
    }
    if (raw.transition !== undefined) {
      if (n === 1) {
        dropped.push("a transition for slide 1 (nothing comes before it)");
      } else if (TRANSITION_MODES.includes(raw.transition)) {
        item.transition = raw.transition;
      } else {
        dropped.push(
          `the transition of slide ${n} ("${String(raw.transition).slice(
            0,
            20,
          )}" is not one of ${TRANSITION_MODES.join(", ")})`,
        );
      }
    }
    if (Object.keys(item).length > 1) {
      byIndex.set(item.index, { ...byIndex.get(item.index), ...item });
    }
  }
  return {
    message:
      typeof j.message === "string"
        ? j.message.replace(/\s+/g, " ").trim().slice(0, 240)
        : "",
    items: [...byIndex.values()].sort((a, b) => a.index - b.index),
    dropped,
  };
};

// ---- applying it ------------------------------------------------------------------------------------------------
/** About 2.5 spoken words per second, plus a breath: how long a script takes to say, in ms. */
export const estimateSpeechMs = (script: string): number => {
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  return words ? Math.round((words / 2.5) * 1000) + 400 : 0;
};

/**
 * The customData of a frame after applying `item`: only the fields the item has change (`null` removes one). A hold
 * time is raised, never lowered, so the slide stays on screen as long as the script takes to say.
 */
export const patchFor = (
  item: DirectionItem,
  current: Record<string, any> | undefined,
  transitionInMs = 0,
  fields: {
    caption: boolean;
    script: boolean;
    holdMs: boolean;
    transition: boolean;
  } = {
    caption: true,
    script: true,
    holdMs: true,
    transition: true,
  },
): Record<string, any> => {
  const next: Record<string, any> = { ...(current || {}) };
  if (fields.caption && item.caption !== undefined) {
    next.caption = item.caption;
  }
  const script = fields.script ? item.script : undefined;
  if (script !== undefined) {
    next.script = script;
  }
  if (fields.holdMs && (item.holdMs !== undefined || script !== undefined)) {
    const spoken = script
      ? Math.max(0, estimateSpeechMs(script) - transitionInMs)
      : 0;
    const wanted = Math.max(item.holdMs ?? 0, spoken);
    if (wanted > 0) {
      next.holdMs = Math.min(MAX_HOLD_MS, Math.round(wanted / 100) * 100);
    }
  }
  if (fields.transition && item.transition !== undefined) {
    if (item.transition === "smart") {
      delete next.transition;
    } else {
      next.transition = item.transition;
    }
  }
  return next;
};
