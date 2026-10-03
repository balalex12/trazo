import {
  NARRATION_FIELD,
  fromBase64,
  packClip,
  readBundle,
  toBase64,
  unpackClip,
} from "./narrationFile";

describe("base64", () => {
  it("round trips bytes, including a long buffer", () => {
    const bytes = new Uint8Array(100_000).map((_, i) => (i * 7) % 256);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });
});

describe("packClip / unpackClip", () => {
  it("brings a clip back with its rate and (to 16 bits) its samples", async () => {
    const samples = new Float32Array(4800).map((_, i) =>
      Math.sin((i / 48) * Math.PI),
    );
    const packed = await packClip(samples, 48000);
    expect(packed.durationMs).toBe(100);
    expect(["gzip", "none"]).toContain(packed.enc);
    const back = await unpackClip(packed);
    expect(back.sampleRate).toBe(48000);
    expect(back.samples.length).toBe(samples.length);
    for (let i = 0; i < samples.length; i += 97) {
      expect(Math.abs(back.samples[i] - samples[i])).toBeLessThan(0.001);
    }
  });

  it("is smaller than the raw WAV when it can compress", async () => {
    const quiet = new Float32Array(48000);
    const packed = await packClip(quiet, 48000);
    if (packed.enc === "gzip") {
      expect(fromBase64(packed.data).length).toBeLessThan(2000);
    }
  });
});

describe("readBundle", () => {
  const clip = { sampleRate: 48000, durationMs: 10, enc: "none", data: "AAAA" };

  it("reads the narration out of a drawing file", () => {
    const text = JSON.stringify({
      type: "excalidraw",
      elements: [],
      [NARRATION_FIELD]: { version: 1, clips: { f1: clip } },
    });
    expect(readBundle(text)).toEqual({ version: 1, clips: { f1: clip } });
  });

  it("returns null for a plain drawing, a wrong version, broken clips or text that is not JSON", () => {
    expect(readBundle(JSON.stringify({ type: "excalidraw" }))).toBeNull();
    expect(
      readBundle(
        JSON.stringify({
          [NARRATION_FIELD]: { version: 2, clips: { f1: clip } },
        }),
      ),
    ).toBeNull();
    expect(
      readBundle(
        JSON.stringify({
          [NARRATION_FIELD]: { version: 1, clips: { f1: { data: 3 } } },
        }),
      ),
    ).toBeNull();
    expect(readBundle("not json")).toBeNull();
  });

  it("keeps the good clips and drops the broken ones", () => {
    const text = JSON.stringify({
      [NARRATION_FIELD]: {
        version: 1,
        clips: { ok: clip, bad: { enc: "zip", data: "x", sampleRate: 1 } },
      },
    });
    expect(Object.keys(readBundle(text)!.clips)).toEqual(["ok"]);
  });
});
