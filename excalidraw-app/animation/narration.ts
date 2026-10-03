// Narration: record your voice while you present the animation, cut it into one clip per slide at the exact moments
// you pressed "next", keep the clips in this browser (IndexedDB) and mix them into one audio track for the MP4.
// Everything stays in the browser. The slide timeline adapts to the clips (see effectiveHold in timeline.ts), so
// voice and picture cannot drift apart.
import { createStore, del, getMany, set } from "idb-keyval";

import { narrationStarts, totalDurationMs } from "./timeline";

import type { Slide, TimelineSettings } from "./timeline";

// ---- pure helpers (unit tested) -------------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/**
 * Cuts one recording into clips. `starts[k]` is the time (s) at which clip k begins; clip k ends where clip k+1
 * begins, and the last one at `endSec`.
 */
export const splitNarration = (
  samples: Float32Array,
  sampleRate: number,
  starts: number[],
  endSec: number,
): Float32Array[] =>
  starts.map((start, k) => {
    const a = clamp(Math.round(start * sampleRate), 0, samples.length);
    const end = k + 1 < starts.length ? starts[k + 1] : endSec;
    const b = clamp(Math.round(end * sampleRate), 0, samples.length);
    return samples.slice(a, Math.max(a, b));
  });

/** 16-bit mono PCM WAV. Simple, lossless enough for speech, and trivial to read back for mixing. */
export const encodeWav = (
  samples: Float32Array,
  sampleRate: number,
): ArrayBuffer => {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const tag = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      v.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  tag(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, "data");
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const x = clamp(samples[i], -1, 1);
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return buf;
};

export const parseWav = (
  buf: ArrayBuffer,
): { samples: Float32Array; sampleRate: number } => {
  const v = new DataView(buf);
  const text = (o: number, n: number) =>
    String.fromCharCode(...new Uint8Array(buf, o, n));
  if (buf.byteLength < 44 || text(0, 4) !== "RIFF" || text(8, 4) !== "WAVE") {
    throw new Error("Not a WAV file.");
  }
  let sampleRate = 0;
  let o = 12;
  while (o + 8 <= buf.byteLength) {
    const id = text(o, 4);
    const size = v.getUint32(o + 4, true);
    if (id === "fmt ") {
      // inside the chunk: format at +8, channels at +10, bits per sample at +22
      if (
        v.getUint16(o + 8, true) !== 1 ||
        v.getUint16(o + 10, true) !== 1 ||
        v.getUint16(o + 22, true) !== 16
      ) {
        throw new Error("Only 16-bit mono PCM WAV is supported.");
      }
      sampleRate = v.getUint32(o + 12, true);
    } else if (id === "data") {
      const n = Math.floor(Math.min(size, buf.byteLength - o - 8) / 2);
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = v.getInt16(o + 8 + i * 2, true);
        samples[i] = x < 0 ? x / 0x8000 : x / 0x7fff;
      }
      return { samples, sampleRate };
    }
    o += 8 + size + (size % 2);
  }
  throw new Error("The WAV file has no audio data.");
};

export type MixItem = {
  startMs: number;
  samples: Float32Array;
  sampleRate: number;
};

/** Places every clip at its start time in one mono track of exactly `totalMs`, resampled to `outRate`. */
export const mixNarration = (
  items: MixItem[],
  totalMs: number,
  outRate = 48000,
): Float32Array => {
  const out = new Float32Array(
    Math.max(0, Math.round((totalMs / 1000) * outRate)),
  );
  for (const it of items) {
    if (!it.samples.length) {
      continue;
    }
    const ratio = it.sampleRate / outRate;
    const offset = Math.round((it.startMs / 1000) * outRate);
    const n = Math.floor(it.samples.length / ratio);
    for (let i = 0; i < n; i++) {
      const o = offset + i;
      if (o < 0) {
        continue;
      }
      if (o >= out.length) {
        break;
      }
      const src = i * ratio;
      const i0 = Math.floor(src);
      const f = src - i0;
      const a = it.samples[i0];
      const b = it.samples[Math.min(i0 + 1, it.samples.length - 1)];
      out[o] += a + (b - a) * f;
    }
  }
  for (let i = 0; i < out.length; i++) {
    out[i] = clamp(out[i], -1, 1); // clips never overlap, this only guards against rounding
  }
  return out;
};

// ---- recording the microphone ---------------------------------------------------------------------------------

export type MicCapture = {
  /** seconds since the first captured sample, on the audio clock (what the clip boundaries are measured on) */
  nowSec: () => number;
  /** microphone level, 0..1 */
  level: () => number;
  stop: () => { samples: Float32Array; sampleRate: number; endSec: number };
};

export const micError = (e: unknown) => {
  const name = (e as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "The microphone is blocked. Allow it in the browser's site settings and try again.";
  }
  if (name === "NotFoundError") {
    return "No microphone was found. Connect one and try again.";
  }
  return `Could not open the microphone: ${(e as Error)?.message ?? e}`;
};

export const openMic = () =>
  navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
    video: false,
  });

/**
 * Captures raw samples (no lossy encoding in between) and counts them, so a moment is a sample position:
 * clip boundaries are exact, not "about when the browser started its recorder".
 */
export const startMicCapture = (stream: MediaStream): MicCapture => {
  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0; // the processor only runs when connected, but we do not want to hear ourselves
  source.connect(processor);
  processor.connect(mute);
  mute.connect(ctx.destination);

  const chunks: Float32Array[] = [];
  let origin: number | null = null;
  let lastLevel = 0;
  processor.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0);
    if (origin === null) {
      // the block that just arrived ends about now, so sample 0 was captured one block ago
      origin = ctx.currentTime - data.length / ctx.sampleRate;
    }
    chunks.push(new Float32Array(data));
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }
    lastLevel = Math.min(1, Math.sqrt(sum / data.length) * 4);
  };

  return {
    nowSec: () => (origin === null ? 0 : Math.max(0, ctx.currentTime - origin)),
    level: () => lastLevel,
    stop: () => {
      processor.onaudioprocess = null;
      source.disconnect();
      processor.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      const sampleRate = ctx.sampleRate;
      void ctx.close();
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const samples = new Float32Array(total);
      let at = 0;
      for (const c of chunks) {
        samples.set(c, at);
        at += c.length;
      }
      return { samples, sampleRate, endSec: total / sampleRate };
    },
  };
};

// ---- storage (IndexedDB, in this browser only) ----------------------------------------------------------------

type StoredClip = { wav: Blob; durationMs: number; sampleRate: number };
const store = () => createStore("trazo-narration", "clips");

export const saveClip = async (
  frameId: string,
  samples: Float32Array,
  sampleRate: number,
) => {
  const clip: StoredClip = {
    wav: new Blob([encodeWav(samples, sampleRate)], { type: "audio/wav" }),
    durationMs: Math.round((samples.length / sampleRate) * 1000),
    sampleRate,
  };
  await set(frameId, clip, store());
};

export const deleteClip = (frameId: string) => del(frameId, store());

/** Length (ms) of the stored clip of each of these frames; frames without a clip are left out. */
export const loadNarrationMs = async (
  frameIds: string[],
): Promise<Record<string, number>> => {
  const found = await getMany<StoredClip>(frameIds, store());
  const out: Record<string, number> = {};
  frameIds.forEach((id, i) => {
    const c = found[i];
    if (c && c.durationMs > 0) {
      out[id] = c.durationMs;
    }
  });
  return out;
};

/**
 * One mono track the length of the whole animation with every slide's clip at its place, or null when there is no
 * narration. `settings` must carry `narrationMs` so the slide lengths match the clips.
 */
export const buildNarrationTrack = async (
  slides: Slide[],
  settings: TimelineSettings,
  outRate = 48000,
): Promise<{ samples: Float32Array; sampleRate: number } | null> => {
  const ids = slides.map((s) => s.frame.id);
  const starts = narrationStarts(slides, settings);
  const found = await getMany<StoredClip>(ids, store());
  const items: MixItem[] = [];
  for (let i = 0; i < ids.length; i++) {
    const c = found[i];
    if (c) {
      const wav = parseWav(await c.wav.arrayBuffer());
      items.push({ startMs: starts[i], ...wav });
    }
  }
  if (!items.length) {
    return null;
  }
  return {
    samples: mixNarration(items, totalDurationMs(slides, settings), outRate),
    sampleRate: outRate,
  };
};
