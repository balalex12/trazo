// Builds the exported animation as ONE .html file: a standalone player and, at the same time, a HyperFrames
// composition (see player/runtime.ts for what runs inside). Pure: no DOM, so it is unit tested. The app gives it the
// slides, the image files, the inlined font faces, the optional narration and the bundled player script.
import { totalDurationMs } from "./timeline";

import type { PlayerPayload } from "./player/runtime";
import type { Slide, TimelineSettings } from "./timeline";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type PlayerAudio = { samples: Float32Array; sampleRate: number };

export type PlayerInput = {
  title: string;
  slides: Slide[];
  files: Record<string, any>;
  settings: TimelineSettings;
  width: number;
  height: number;
  fps: number;
  background: string;
  /** @font-face rules with the fonts of the slides inlined */
  fontCss: string;
  audio?: PlayerAudio | null;
  /** the bundled player script (excalidraw-app/animation/player/runtime.ts) */
  runtime: string;
};

/** JSON that is safe inside a <script> element */
export const scriptJson = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(new RegExp("\\u2028", "g"), "\\u2028")
    .replace(new RegExp("\\u2029", "g"), "\\u2029");

const escapeHtml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** 16-bit mono PCM WAV */
export const encodeWav = (samples: Float32Array, sampleRate: number) => {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return bytes;
};

export const toBase64 = (bytes: Uint8Array) => {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
};

/** Mono samples at `rate` from a track at another rate (linear interpolation; speech does not need more). */
export const resample = (
  samples: Float32Array,
  from: number,
  to: number,
): Float32Array => {
  if (from === to) {
    return samples;
  }
  const n = Math.floor((samples.length * to) / from);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const at = (i * from) / to;
    const k = Math.floor(at);
    const f = at - k;
    out[i] =
      samples[k] * (1 - f) +
      (samples[Math.min(k + 1, samples.length - 1)] ?? 0) * f;
  }
  return out;
};

/** The image files a set of slides really uses (the scene may hold many more). */
export const usedFiles = (slides: Slide[], files: Record<string, any>) => {
  const out: Record<string, any> = {};
  for (const s of slides) {
    for (const e of s.children) {
      if (e.type === "image" && e.fileId && files[e.fileId]) {
        out[e.fileId] = files[e.fileId];
      }
    }
  }
  return out;
};

const css = (height: number) => {
  const cap = Math.max(14, Math.round(height * 0.04));
  return `
:root{--bg:#141317;--bar:rgba(20,19,23,.82);--fg:#f4f1ec;--muted:#aaa49b;--accent:#ff7a3d;color-scheme:dark}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,"Segoe UI",Roboto,sans-serif;overflow:hidden}
#trazo-viewport{position:fixed;left:0;right:0;top:0;bottom:60px;cursor:pointer}
:fullscreen #trazo-viewport{bottom:0}
#trazo-root{position:absolute;left:50%;top:50%;transform-origin:center;background:#fff;overflow:hidden}
#trazo-stage,#trazo-stage svg{position:absolute;inset:0;width:100%;height:100%;display:block}
#trazo-caption{position:absolute;left:50%;bottom:5%;transform:translateX(-50%);max-width:84%;padding:${Math.round(
    cap * 0.5,
  )}px ${Math.round(cap * 0.8)}px;border-radius:${Math.round(
    cap * 0.4,
  )}px;background:rgba(0,0,0,.68);color:#fff;font:${cap}px/1.3 system-ui,"Segoe UI",Roboto,sans-serif;text-align:center;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;pointer-events:none}
#trazo-caption:empty{display:none}
.no-captions #trazo-caption{display:none}
#trazo-bar{position:fixed;left:0;right:0;bottom:0;display:flex;align-items:center;gap:8px;padding:0 max(14px,env(safe-area-inset-right)) 0 max(14px,env(safe-area-inset-left));background:var(--bar);backdrop-filter:blur(8px);height:60px;transition:opacity .2s,transform .2s}
:fullscreen #trazo-bar{opacity:0;transform:translateY(100%)}
:fullscreen #trazo-bar.show,:fullscreen #trazo-bar:focus-within{opacity:1;transform:none}
#trazo-bar button{min-width:40px;height:40px;border:0;border-radius:8px;background:transparent;color:var(--fg);font:inherit;font-size:16px;cursor:pointer}
#trazo-bar button:hover{background:rgba(255,255,255,.1)}
#trazo-bar button[aria-pressed="true"]{color:var(--accent)}
#trazo-bar :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
#trazo-scrub{flex:1;min-width:80px;accent-color:var(--accent);height:40px}
#trazo-time,#trazo-slide{color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
@media(max-width:560px){#trazo-slide{display:none}}
.rendering #trazo-bar{display:none}
.rendering,.rendering body{overflow:hidden}
.rendering #trazo-viewport{position:absolute;left:0;top:0;right:auto;bottom:auto;width:${"var(--w)"};height:${"var(--h)"}}
.rendering #trazo-root{left:0;top:0;transform:none!important}
@media(prefers-reduced-motion:reduce){#trazo-bar{transition:none}}
`;
};

export const buildPlayerHtml = (input: PlayerInput): string => {
  const { slides, settings, width, height, fps } = input;
  const ms = totalDurationMs(slides, settings);
  const secs = Math.round(ms) / 1000;
  const payload: PlayerPayload = {
    v: 1,
    title: input.title,
    width,
    height,
    fps,
    background: input.background,
    settings,
    slides,
    files: usedFiles(slides, input.files),
    fontCss: input.fontCss,
    hasAudio: !!input.audio,
  };
  const audio = input.audio
    ? `<audio id="trazo-audio" preload="auto" data-start="0" data-duration="${secs}" data-track-index="1" src="data:audio/wav;base64,${toBase64(
        encodeWav(input.audio.samples, input.audio.sampleRate),
      )}"></audio>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Trazo animation player">
<title>${escapeHtml(input.title)}</title>
<style>${input.fontCss.replace(/<\/style/gi, "<\\/style")}</style>
<style>:root{--w:${width}px;--h:${height}px}${css(height)}</style>
</head>
<body>
<div id="trazo-viewport">
  <div id="trazo-root" data-composition-id="trazo" data-start="0" data-duration="${secs}" data-width="${width}" data-height="${height}" data-fps="${fps}" style="width:${width}px;height:${height}px">
    <div id="trazo-stage" class="clip" data-start="0" data-duration="${secs}" data-track-index="0"></div>
    <div id="trazo-caption"></div>
  </div>
</div>
<div id="trazo-bar" role="group" aria-label="Player controls">
  <button id="trazo-prev" aria-label="Previous slide">⏮</button>
  <button id="trazo-play" aria-label="Play">▶</button>
  <button id="trazo-next" aria-label="Next slide">⏭</button>
  <input id="trazo-scrub" type="range" min="0" max="1000" value="0" aria-label="Position">
  <span id="trazo-time">0:00 / 0:00</span>
  <span id="trazo-slide"></span>
  <button id="trazo-cc" aria-label="Captions" aria-pressed="true">CC</button>
  <button id="trazo-mute" aria-label="Narration on or off">🔊</button>
  <button id="trazo-full" aria-label="Full screen">⛶</button>
</div>
${audio}
<script>window.__TRAZO_PAYLOAD__=${scriptJson(payload)};</script>
<script>${input.runtime.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>
`;
};
