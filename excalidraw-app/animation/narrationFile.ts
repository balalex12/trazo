// Narration inside the drawing file. The clips normally live in this browser only (IndexedDB). "Save drawing with
// narration" writes a normal .excalidraw file with one extra top-level field, `trazoNarration`, that Excalidraw itself
// ignores, so the file still opens anywhere. "Open drawing with narration" reads the drawing and puts the clips back,
// matched by slide (frame) id. The audio is the same 16-bit WAV the app stores, gzip-compressed when the browser can.
import { createStore, getMany, set } from "idb-keyval";

import { encodeWav, parseWav } from "./narration";

export const NARRATION_FIELD = "trazoNarration";

export type PackedClip = {
  sampleRate: number;
  durationMs: number;
  /** how `data` was packed before the base64 step */
  enc: "gzip" | "none";
  data: string;
};

export type NarrationBundle = { version: 1; clips: Record<string, PackedClip> };

export const toBase64 = (bytes: Uint8Array): string => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
};

export const fromBase64 = (text: string): Uint8Array => {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
};

const pipe = async (
  bytes: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> => {
  const source = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
  const out = source.pipeThrough(
    stream as ReadableWritablePair<Uint8Array, Uint8Array>,
  );
  return new Uint8Array(await new Response(out).arrayBuffer());
};

export const packClip = async (
  samples: Float32Array,
  sampleRate: number,
): Promise<PackedClip> => {
  const wav = new Uint8Array(encodeWav(samples, sampleRate));
  const durationMs = Math.round((samples.length / sampleRate) * 1000);
  if (typeof CompressionStream === "function") {
    return {
      sampleRate,
      durationMs,
      enc: "gzip",
      data: toBase64(await pipe(wav, new CompressionStream("gzip"))),
    };
  }
  return { sampleRate, durationMs, enc: "none", data: toBase64(wav) };
};

export const unpackClip = async (
  clip: PackedClip,
): Promise<{ samples: Float32Array; sampleRate: number }> => {
  let bytes = fromBase64(clip.data);
  if (clip.enc === "gzip") {
    if (typeof DecompressionStream !== "function") {
      throw new Error("This browser cannot unpack the narration in the file.");
    }
    bytes = await pipe(bytes, new DecompressionStream("gzip"));
  }
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return parseWav(copy);
};

/** the bundle from the text of a saved drawing, or null when the file carries no narration */
export const readBundle = (text: string): NarrationBundle | null => {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const b = (json as Record<string, unknown> | null)?.[NARRATION_FIELD] as
    | Partial<NarrationBundle>
    | undefined;
  if (!b || b.version !== 1 || !b.clips || typeof b.clips !== "object") {
    return null;
  }
  const clips: Record<string, PackedClip> = {};
  for (const [id, c] of Object.entries(b.clips)) {
    if (
      c &&
      typeof c.data === "string" &&
      typeof c.sampleRate === "number" &&
      (c.enc === "gzip" || c.enc === "none")
    ) {
      clips[id] = {
        sampleRate: c.sampleRate,
        durationMs: Number(c.durationMs) || 0,
        enc: c.enc,
        data: c.data,
      };
    }
  }
  return Object.keys(clips).length ? { version: 1, clips } : null;
};

/** `drawingJson` plus the narration of these slides (as saved on this device) */
export const addNarrationToJson = async (
  drawingJson: string,
  frameIds: string[],
): Promise<{ json: string; clips: number }> => {
  const found = await getMany<{ wav: Blob; sampleRate: number }>(
    frameIds,
    createStore("trazo-narration", "clips"),
  );
  const clips: Record<string, PackedClip> = {};
  for (let i = 0; i < frameIds.length; i++) {
    const c = found[i];
    if (c) {
      const { samples, sampleRate } = parseWav(await c.wav.arrayBuffer());
      clips[frameIds[i]] = await packClip(samples, sampleRate);
    }
  }
  const count = Object.keys(clips).length;
  if (!count) {
    return { json: drawingJson, clips: 0 };
  }
  const doc = JSON.parse(drawingJson);
  const bundle: NarrationBundle = { version: 1, clips };
  doc[NARRATION_FIELD] = bundle;
  return { json: JSON.stringify(doc, null, 2), clips: count };
};

/** stores the clips of a bundle for the slides that exist; returns how many were restored and how many had no slide */
export const restoreNarration = async (
  bundle: NarrationBundle,
  frameIds: string[],
): Promise<{ restored: number; unmatched: number }> => {
  const wanted = new Set(frameIds);
  let restored = 0;
  let unmatched = 0;
  const db = createStore("trazo-narration", "clips");
  for (const [id, packed] of Object.entries(bundle.clips)) {
    if (!wanted.has(id)) {
      unmatched++;
      continue;
    }
    const { samples, sampleRate } = await unpackClip(packed);
    await set(
      id,
      {
        wav: new Blob([encodeWav(samples, sampleRate)], { type: "audio/wav" }),
        durationMs: Math.round((samples.length / sampleRate) * 1000),
        sampleRate,
      },
      db,
    );
    restored++;
  }
  return { restored, unmatched };
};
