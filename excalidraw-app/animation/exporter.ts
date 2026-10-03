import { renderAtTime } from "./renderer";
import { sampleAt, totalDurationMs } from "./timeline";

import type { RenderOptions } from "./renderer";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ExportFormat = "mp4" | "gif";
/** Mono narration track as long as the whole animation (MP4 only: a GIF cannot carry sound). */
export type ExportAudio = { samples: Float32Array; sampleRate: number };
export type ExportProgress = (done: number, total: number) => void;

// Muxer libraries are vendored in /public/vendor (no yarn.lock changes needed).
const vendor = (name: string) =>
  import(/* @vite-ignore */ `/vendor/${name}`) as Promise<any>;

const frameKey = (opts: RenderOptions, timeMs: number) => {
  const s = sampleAt(timeMs, opts.slides, opts.settings);
  return s.a === s.b ? `h${s.a}` : `${s.a}-${s.b}-${s.t.toFixed(4)}`;
};

export const exportAnimation = async (
  format: ExportFormat,
  opts: RenderOptions,
  fps: number,
  onProgress: ExportProgress,
  signal: { cancelled: boolean },
  audio?: ExportAudio | null,
): Promise<Blob> => {
  const total = Math.max(
    1,
    Math.ceil((totalDurationMs(opts.slides, opts.settings) / 1000) * fps),
  );
  return format === "mp4"
    ? exportMp4(opts, fps, total, onProgress, signal, audio)
    : exportGif(opts, fps, total, onProgress, signal);
};

// ---- MP4 (WebCodecs H.264 + mp4-muxer) ----------------------------------
async function exportMp4(
  opts: RenderOptions,
  fps: number,
  total: number,
  onProgress: ExportProgress,
  signal: { cancelled: boolean },
  audio?: ExportAudio | null,
) {
  const VE = (window as any).VideoEncoder;
  const VF = (window as any).VideoFrame;
  if (!VE || !VF) {
    throw new Error(
      "This browser has no WebCodecs (VideoEncoder). Use Chrome/Edge, or export a GIF.",
    );
  }
  const { width, height } = opts;
  let config: any = null;
  for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42001f"]) {
    const c = { codec, width, height, bitrate: 6_000_000, framerate: fps };
    try {
      if ((await VE.isConfigSupported(c)).supported) {
        config = c;
        break;
      }
    } catch (e) {
      /* try next */
    }
  }
  if (!config) {
    throw new Error(
      "H.264 encoding is not available in this browser. Export a GIF instead.",
    );
  }

  // narration: AAC when the browser has it, otherwise Opus
  let audioConfig: any = null;
  if (audio) {
    const AE = (window as any).AudioEncoder;
    if (!AE || !(window as any).AudioData) {
      throw new Error(
        "This browser cannot encode audio (WebCodecs AudioEncoder). Export without narration, or use Chrome/Edge.",
      );
    }
    for (const [codec, muxCodec] of [
      ["mp4a.40.2", "aac"],
      ["opus", "opus"],
    ]) {
      const c = {
        codec,
        sampleRate: audio.sampleRate,
        numberOfChannels: 1,
        bitrate: 128_000,
      };
      try {
        if ((await AE.isConfigSupported(c)).supported) {
          audioConfig = { ...c, muxCodec };
          break;
        }
      } catch (e) {
        /* try next */
      }
    }
    if (!audioConfig) {
      throw new Error(
        "No audio codec (AAC or Opus) is available for MP4 in this browser. Export without narration.",
      );
    }
  }

  const { Muxer, ArrayBufferTarget } = await vendor("mp4-muxer.js");
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width, height },
    ...(audioConfig
      ? {
          audio: {
            codec: audioConfig.muxCodec,
            numberOfChannels: 1,
            sampleRate: audio!.sampleRate,
          },
        }
      : {}),
    fastStart: "in-memory",
  });
  let encError: any = null;
  const encoder = new VE({
    output: (chunk: any, meta: any) => muxer.addVideoChunk(chunk, meta),
    error: (e: any) => {
      encError = e;
    },
  });
  encoder.configure(config);

  // audio is fed in step with the video so both tracks are interleaved in the file
  let audioEncoder: any = null;
  let audioError: any = null;
  let audioPos = 0;
  if (audio && audioConfig) {
    const { muxCodec: _m, ...cfg } = audioConfig;
    audioEncoder = new (window as any).AudioEncoder({
      output: (chunk: any, meta: any) => muxer.addAudioChunk(chunk, meta),
      error: (e: any) => {
        audioError = e;
      },
    });
    audioEncoder.configure(cfg);
  }
  const feedAudio = (untilSample: number) => {
    if (!audio || !audioEncoder) {
      return;
    }
    const end = Math.min(untilSample, audio.samples.length);
    while (audioPos < end) {
      const n = Math.min(4096, end - audioPos);
      const data = new Float32Array(
        audio.samples.subarray(audioPos, audioPos + n),
      );
      const chunk = new (window as any).AudioData({
        format: "f32",
        sampleRate: audio.sampleRate,
        numberOfFrames: n,
        numberOfChannels: 1,
        timestamp: Math.round((audioPos / audio.sampleRate) * 1e6),
        data,
      });
      audioEncoder.encode(chunk);
      chunk.close();
      audioPos += n;
    }
  };

  const canvas = document.createElement("canvas");
  let lastKey = "";
  for (let i = 0; i < total; i++) {
    if (signal.cancelled) {
      encoder.close();
      audioEncoder?.close();
      throw new Error("Export cancelled");
    }
    if (encError || audioError) {
      throw encError || audioError;
    }
    const timeMs = (i / fps) * 1000;
    const key = frameKey(opts, timeMs);
    if (key !== lastKey) {
      await renderAtTime(opts, timeMs, canvas); // identical hold frames reuse the canvas
      lastKey = key;
    }
    const frame = new VF(canvas, {
      timestamp: Math.round((i * 1e6) / fps),
      duration: Math.round(1e6 / fps),
    });
    encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    if (audio) {
      feedAudio(Math.round(((i + 1) / fps) * audio.sampleRate));
    }
    while (encoder.encodeQueueSize > 8) {
      await new Promise((r) => setTimeout(r, 4)); // backpressure
    }
    if (i % 3 === 0) {
      onProgress(i + 1, total);
      await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
    }
  }
  if (audio && audioEncoder) {
    feedAudio(audio.samples.length);
    await audioEncoder.flush();
    audioEncoder.close();
    if (audioError) {
      throw audioError;
    }
  }
  await encoder.flush();
  encoder.close();
  muxer.finalize();
  onProgress(total, total);
  return new Blob([muxer.target.buffer], { type: "video/mp4" });
}

// ---- GIF (gifenc) --------------------------------------------------------
async function exportGif(
  opts: RenderOptions,
  fps: number,
  total: number,
  onProgress: ExportProgress,
  signal: { cancelled: boolean },
) {
  const { GIFEncoder, quantize, applyPalette } = await vendor("gifenc.js");
  const { width, height } = opts;
  const gif = GIFEncoder();
  const canvas = document.createElement("canvas");
  const delay = Math.round(1000 / fps);

  // group consecutive identical frames (holds) into one GIF frame with a longer delay
  let i = 0;
  while (i < total) {
    if (signal.cancelled) {
      throw new Error("Export cancelled");
    }
    const key = frameKey(opts, (i / fps) * 1000);
    let j = i + 1;
    while (j < total && frameKey(opts, (j / fps) * 1000) === key) {
      j++;
    }
    await renderAtTime(opts, (i / fps) * 1000, canvas);
    const data = canvas
      .getContext("2d")!
      .getImageData(0, 0, width, height).data;
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), width, height, {
      palette,
      delay: delay * (j - i),
    });
    i = j;
    onProgress(i, total);
    await new Promise((r) => setTimeout(r, 0));
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: "image/gif" });
}

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
};
