import { encodeWav, mixNarration, parseWav, splitNarration } from "./narration";

const ramp = (n: number) => Float32Array.from({ length: n }, (_, i) => i / n);

describe("splitNarration", () => {
  // 10 samples per second, 4 seconds of audio where every sample equals its index
  const samples = Float32Array.from({ length: 40 }, (_, i) => i);

  it("cuts a clip per start, each one ending where the next begins", () => {
    const clips = splitNarration(samples, 10, [0, 1, 2.5], 4);
    expect(clips.map((c) => c.length)).toEqual([10, 15, 15]);
    expect(clips[0][0]).toBe(0);
    expect(clips[1][0]).toBe(10);
    expect(clips[2][0]).toBe(25);
    expect(clips[2][14]).toBe(39);
  });

  it("starts the first clip later when narration begins on a later slide", () => {
    const clips = splitNarration(samples, 10, [1.5, 3], 4);
    expect(clips[0][0]).toBe(15);
    expect(clips[0]).toHaveLength(15);
    expect(clips[1]).toHaveLength(10);
  });

  it("never reads outside the recording", () => {
    const clips = splitNarration(samples, 10, [0, 3.9], 9);
    expect(clips[1]).toHaveLength(1);
    expect(splitNarration(samples, 10, [5], 6)[0]).toHaveLength(0);
  });
});

describe("WAV", () => {
  it("writes a valid header and reads the audio back", () => {
    const src = ramp(100);
    const buf = encodeWav(src, 24000);
    expect(buf.byteLength).toBe(44 + 200);
    const back = parseWav(buf);
    expect(back.sampleRate).toBe(24000);
    expect(back.samples).toHaveLength(100);
    for (let i = 0; i < 100; i++) {
      expect(Math.abs(back.samples[i] - src[i])).toBeLessThan(1 / 16384);
    }
  });

  it("clips out-of-range samples instead of wrapping", () => {
    const back = parseWav(encodeWav(Float32Array.from([2, -2, 0.5]), 8000));
    expect(back.samples[0]).toBeCloseTo(1, 3);
    expect(back.samples[1]).toBeCloseTo(-1, 3);
    expect(back.samples[2]).toBeCloseTo(0.5, 3);
  });

  it("refuses files that are not 16-bit mono WAV", () => {
    expect(() => parseWav(new ArrayBuffer(10))).toThrow(/WAV/);
    const stereo = encodeWav(ramp(4), 8000);
    new DataView(stereo).setUint16(22, 2, true);
    expect(() => parseWav(stereo)).toThrow(/mono/);
  });
});

describe("mixNarration", () => {
  const ones = (n: number) => new Float32Array(n).fill(0.5);

  it("is exactly as long as the animation", () => {
    expect(mixNarration([], 2500, 1000)).toHaveLength(2500);
  });

  it("puts each clip at its start time and leaves silence elsewhere", () => {
    const out = mixNarration(
      [
        { startMs: 1000, samples: ones(500), sampleRate: 1000 },
        { startMs: 3000, samples: ones(200), sampleRate: 1000 },
      ],
      4000,
      1000,
    );
    expect(out[999]).toBe(0);
    expect(out[1000]).toBe(0.5);
    expect(out[1499]).toBe(0.5);
    expect(out[1500]).toBe(0);
    expect(out[3000]).toBe(0.5);
    expect(out[3199]).toBe(0.5);
    expect(out[3200]).toBe(0);
  });

  it("resamples a clip to the output rate keeping its duration", () => {
    const out = mixNarration(
      [{ startMs: 0, samples: ones(1000), sampleRate: 1000 }],
      2000,
      2000,
    );
    // 1 s of audio at 1 kHz becomes 1 s at 2 kHz: 2000 samples of 0.5
    expect(out[1999]).toBeCloseTo(0.5, 5);
    expect(out[2000]).toBe(0);
    expect(out).toHaveLength(4000);
  });

  it("keeps the sound inside -1..1 and ignores what falls outside the animation", () => {
    const out = mixNarration(
      [
        {
          startMs: 0,
          samples: new Float32Array(10).fill(0.9),
          sampleRate: 1000,
        },
        {
          startMs: 0,
          samples: new Float32Array(10).fill(0.9),
          sampleRate: 1000,
        },
        { startMs: 5000, samples: ones(10), sampleRate: 1000 },
      ],
      100,
      1000,
    );
    expect(out[0]).toBe(1);
    expect(out).toHaveLength(100);
  });
});
