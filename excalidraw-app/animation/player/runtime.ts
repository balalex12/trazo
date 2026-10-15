// The Trazo animation player: the code that runs INSIDE the exported .html file.
//
// It is bundled (esbuild, see bundle.mjs) together with the real timeline (../timeline.ts) and Excalidraw's own SVG
// renderer, so a slide looks exactly like it does in the editor, hand-drawn strokes included, at any size. The file
// is two things at once:
//  1. a standalone player for any browser (play, pause, scrub, slides, captions, narration, full screen), and
//  2. a HyperFrames composition: the root carries data-composition-id / data-width / data-height / data-fps and a
//     seekable timeline is registered in window.__timelines, so `hyperframes render` can turn it into a 4K or 60 fps
//     video, deterministically, frame by frame.
// Nothing is fetched: slides, images, fonts and the narration are all inside the file.

import { exportToSvg } from "@excalidraw/excalidraw/scene/export";

import {
  buildScene,
  captionAt,
  captionOf,
  ease,
  narrationStarts,
  sampleAt,
  totalDurationMs,
  transitionMs,
} from "../timeline";

import type { Slide, TimelineSettings } from "../timeline";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type PlayerPayload = {
  v: 1;
  title: string;
  /** output size in px; the composition is this big */
  width: number;
  height: number;
  fps: number;
  background: string;
  settings: TimelineSettings;
  slides: Slide[];
  /** the image files the slides use, by file id */
  files: Record<string, any>;
  /** @font-face rules with the fonts inlined */
  fontCss: string;
  /** true when the page has an <audio id="trazo-audio"> narration track */
  hasAudio: boolean;
};

const $ = (id: string) => document.getElementById(id) as HTMLElement;

const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const start = () => {
  // the data is a JavaScript literal in the file (window.__TRAZO_PAYLOAD__), not text read back from the page
  const payload: PlayerPayload = (window as any).__TRAZO_PAYLOAD__;
  const { slides, settings, files, width, height, background } = payload;
  const total = Math.max(1, totalDurationMs(slides, settings));
  const root = $("trazo-root");
  const stage = $("trazo-stage");
  const captionEl = $("trazo-caption");
  const audio = payload.hasAudio
    ? ($("trazo-audio") as HTMLAudioElement)
    : null;

  // Rendering for a video (HyperFrames drives a headless browser) must not show the player controls.
  const rendering =
    typeof (window as any).__hf !== "undefined" ||
    !!navigator.webdriver ||
    /[?&]render\b/.test(location.search);
  document.documentElement.classList.toggle("rendering", rendering);

  // fonts are loaded once, before the first frame, so no frame is drawn with a fallback face
  const families = [
    ...payload.fontCss.matchAll(/font-family:\s*"?([^";]+)"?/g),
  ];
  const fontsReady = Promise.all(
    [...new Set(families.map((m) => m[1].trim()))].map((f) =>
      (document as any).fonts?.load(`20px "${f}"`).catch(() => undefined),
    ),
  )
    .then(() => (document as any).fonts?.ready)
    .catch(() => undefined);

  // ---- drawing one frame ---------------------------------------------------
  let token = 0;
  let busy = false;
  let pending: number | null = null;
  let current = 0;

  const draw = async (ms: number) => {
    const mine = ++token;
    await fontsReady;
    const s = sampleAt(ms, slides, settings);
    const moving = s.a !== s.b;
    const p = moving ? ease(settings.easing, s.t) : 0;
    const { frame, elements } = buildScene(
      slides[s.a],
      slides[s.b],
      p,
      moving ? s.t : 0,
    );
    const svg = await exportToSvg(
      [frame, ...elements] as any,
      {
        exportBackground: true,
        viewBackgroundColor: background,
        exportPadding: 0,
      },
      files,
      { exportingFrame: frame, skipInliningFonts: true } as any,
    );
    if (mine !== token) {
      return; // a newer frame was asked for while this one was being drawn
    }
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
    stage.replaceChildren(svg);
    const cap = moving
      ? captionAt(slides[s.a], slides[s.b], s.t)
      : { text: captionOf(slides[s.a]), alpha: 1 };
    captionEl.textContent = cap.text;
    captionEl.style.opacity = cap.text ? String(Math.min(1, cap.alpha)) : "0";
    current = ms;
    syncUi(s.a, s.b, s.t);
  };

  /** draws `ms`; while one frame is being drawn only the newest request is kept */
  const show = async (ms: number) => {
    const at = Math.min(total, Math.max(0, ms));
    if (busy) {
      pending = at;
      return;
    }
    busy = true;
    try {
      await draw(at);
      while (pending !== null) {
        const next = pending;
        pending = null;
        await draw(next);
      }
    } finally {
      busy = false;
    }
  };

  // ---- HyperFrames: a seekable timeline ---------------------------------------
  // Same shape as the animation timelines HyperFrames expects (seconds in, seconds out). The renderer never plays it,
  // it asks for each frame by time, so the answer for a given time is always the same picture.
  const timeline: any = {};
  const jump = (ms: number) => {
    show(ms);
    return timeline;
  };
  Object.assign(timeline, {
    duration: () => total / 1000,
    totalDuration: () => total / 1000,
    pause: () => timeline,
    play: () => timeline,
    paused: () => true,
    time: (v?: number) => (v === undefined ? current / 1000 : jump(v * 1000)),
    totalTime: (v?: number) =>
      v === undefined ? current / 1000 : jump(v * 1000),
    progress: (v?: number) =>
      v === undefined ? current / total : jump(v * total),
    seek: (t: number) => jump(t * 1000),
    eventCallback: () => timeline,
  });
  (window as any).__timelines = (window as any).__timelines || {};
  (window as any).__timelines[root.dataset.compositionId || "trazo"] = timeline;

  // ---- standalone player ---------------------------------------------------------
  const bar = $("trazo-bar");
  const scrub = $("trazo-scrub") as HTMLInputElement;
  const timeEl = $("trazo-time");
  const slideEl = $("trazo-slide");
  const playBtn = $("trazo-play");
  const ccBtn = $("trazo-cc");
  const muteBtn = $("trazo-mute");
  const viewport = $("trazo-viewport");
  let playing = false;
  let t0 = 0; // performance.now() when `base` was current
  let base = 0;
  let raf = 0;
  let idle = 0;

  // the moment each slide is fully shown (end of the transition into it)
  const slideAt = (a: number, b: number, t: number) => (t >= 0.5 ? b : a);
  function syncUi(a: number, b: number, t: number) {
    scrub.value = String(Math.round((current / total) * 1000));
    timeEl.textContent = `${fmt(current)} / ${fmt(total)}`;
    slideEl.textContent = `${slideAt(a, b, t) + 1} / ${slides.length}`;
  }

  const fit = () => {
    const k = Math.min(
      viewport.clientWidth / width,
      viewport.clientHeight / height,
    );
    root.style.transform = `translate(-50%, -50%) scale(${k})`;
  };

  const setPlaying = (on: boolean) => {
    playing = on;
    playBtn.textContent = on ? "❚❚" : "▶";
    playBtn.setAttribute("aria-label", on ? "Pause" : "Play");
    cancelAnimationFrame(raf);
    if (audio) {
      if (on) {
        audio.currentTime = current / 1000;
        audio.play().catch(() => undefined);
      } else {
        audio.pause();
      }
    }
    if (on) {
      if (current >= total) {
        current = 0;
      }
      base = current;
      t0 = performance.now();
      const tick = () => {
        const ms = base + (performance.now() - t0);
        if (ms >= total) {
          show(total);
          setPlaying(false);
          return;
        }
        show(ms);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    wake();
  };

  const seekTo = (ms: number) => {
    base = ms;
    t0 = performance.now();
    current = ms;
    if (audio) {
      audio.currentTime = ms / 1000;
    }
    show(ms);
  };

  /** the time where slide `i` is fully shown: its transition in has ended */
  const slideTime = (i: number) =>
    narrationStarts(slides, settings)[i] +
    (i > 0 ? transitionMs(slides[i - 1], slides[i], settings) : 0);
  const currentSlide = () => {
    const s = sampleAt(current, slides, settings);
    return s.t >= 0.5 ? s.b : s.a;
  };
  const go = (delta: number) => {
    const i = Math.min(slides.length - 1, Math.max(0, currentSlide() + delta));
    seekTo(slideTime(i));
  };

  const wake = () => {
    bar.classList.add("show");
    clearTimeout(idle);
    if (playing) {
      idle = window.setTimeout(() => bar.classList.remove("show"), 2500);
    }
  };

  playBtn.addEventListener("click", () => setPlaying(!playing));
  $("trazo-prev").addEventListener("click", () => go(-1));
  $("trazo-next").addEventListener("click", () => go(1));
  scrub.addEventListener("input", () => seekTo((+scrub.value / 1000) * total));
  ccBtn.addEventListener("click", () => {
    const off = document.documentElement.classList.toggle("no-captions");
    ccBtn.setAttribute("aria-pressed", String(!off));
  });
  muteBtn.addEventListener("click", () => {
    if (audio) {
      audio.muted = !audio.muted;
      muteBtn.textContent = audio.muted ? "🔇" : "🔊";
    }
  });
  if (!audio) {
    muteBtn.hidden = true;
  }
  $("trazo-full").addEventListener("click", () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen?.().catch(() => undefined);
    }
  });
  viewport.addEventListener("click", () => setPlaying(!playing));
  document.addEventListener("pointermove", wake);
  document.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "k") {
      e.preventDefault();
      setPlaying(!playing);
    } else if (e.key === "ArrowRight") {
      go(1);
    } else if (e.key === "ArrowLeft") {
      go(-1);
    } else if (e.key === "f") {
      $("trazo-full").click();
    } else if (e.key === "c") {
      ccBtn.click();
    } else if (e.key === "Home") {
      seekTo(0);
    }
  });
  window.addEventListener("resize", fit);

  fit();
  show(0);
  wake();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start);
} else {
  start();
}
