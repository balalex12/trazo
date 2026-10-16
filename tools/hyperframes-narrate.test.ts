// @ts-expect-error plain ES module, not part of the typechecked sources
import {
  narrateComposition,
  readPayload,
  readWav,
  scriptedSlides,
  withEmbeddedAudio,
} from "./hyperframes-narrate.mjs";
import {
  buildPlayerHtml,
  encodeWav,
  resample,
  toBase64,
} from "../excalidraw-app/animation/htmlPlayer";
import {
  DEFAULT_SETTINGS,
  getSlides,
  narrationStarts,
  totalDurationMs,
} from "../excalidraw-app/animation/timeline";

// the command line bundles these same two files with esbuild (loadModules); the tests import them directly
const loadModules = async () => ({
  encodeWav,
  resample,
  toBase64,
  narrationStarts,
  totalDurationMs,
});

/* eslint-disable @typescript-eslint/no-explicit-any */

const frame = (id: string, y: number, customData?: any) => ({
  id,
  type: "frame",
  x: 0,
  y,
  width: 800,
  height: 500,
  name: id,
  isDeleted: false,
  customData,
});
const slides = getSlides([
  frame("f1", 0, { script: "Hello there." }),
  frame("f2", 700),
  frame("f3", 1400, { script: "  And goodbye.  " }),
] as any);
const html = buildPlayerHtml({
  title: "t",
  slides,
  files: {},
  settings: { ...DEFAULT_SETTINGS, holdMs: 1000, transitionMs: 500 },
  width: 1280,
  height: 800,
  fps: 30,
  background: "#fff",
  fontCss: "",
  runtime: "",
});
const tone = (seconds: number, rate = 24000, level = 0.5) =>
  new Float32Array(Math.round(seconds * rate)).fill(level);

describe("scriptedSlides / readPayload", () => {
  it("finds the slides that have a script, trimmed", () => {
    expect(scriptedSlides(readPayload(html).payload)).toEqual([
      { index: 0, frameId: "f1", script: "Hello there." },
      { index: 2, frameId: "f3", script: "And goodbye." },
    ]);
  });
  it("refuses a file that is not a Trazo animation", () => {
    expect(() => readPayload("<html></html>")).toThrow(/not a Trazo animation/);
  });
});

describe("readWav", () => {
  it("reads 16-bit PCM and float WAV files", () => {
    const wav = encodeWav(new Float32Array([0, 0.5, -0.5]), 22050);
    const { samples, rate } = readWav(wav);
    expect(rate).toBe(22050);
    expect(samples[1]).toBeCloseTo(0.5, 2);
    expect(samples[2]).toBeCloseTo(-0.5, 2);
    // float32 mono
    const f = Buffer.alloc(44 + 8);
    f.write("RIFF", 0);
    f.writeUInt32LE(36 + 8, 4);
    f.write("WAVEfmt ", 8);
    f.writeUInt32LE(16, 16);
    f.writeUInt16LE(3, 20);
    f.writeUInt16LE(1, 22);
    f.writeUInt32LE(24000, 24);
    f.writeUInt32LE(96000, 28);
    f.writeUInt16LE(4, 32);
    f.writeUInt16LE(32, 34);
    f.write("data", 36);
    f.writeUInt32LE(8, 40);
    f.writeFloatLE(0.25, 44);
    f.writeFloatLE(-1, 48);
    expect(readWav(f).samples[0]).toBeCloseTo(0.25);
  });
  it("explains what it cannot read", () => {
    expect(() => readWav(Buffer.from("not a wav file at all"))).toThrow(
      /did not produce a WAV/,
    );
  });
});

describe("narrateComposition", () => {
  it("lengthens a slide to its clip, places each clip where its slide begins and adds the audio", async () => {
    const modules = await loadModules();
    // slide 1 holds 1 s but its clip is 3 s: the slide must grow; slide 3's clip is short
    const {
      html: out,
      files,
      totalMs,
      narrationMs,
    } = narrateComposition(
      html,
      [
        { frameId: "f1", samples: tone(3), rate: 24000 },
        { frameId: "f3", samples: tone(0.4, 24000, -0.5), rate: 24000 },
      ],
      modules,
    );
    expect(narrationMs).toEqual({ f1: 3000, f3: 400 });
    // hold(1) = clip + 0.4 s tail = 3.4 s; slide 2: 0.5 + 1 s; slide 3: 0.5 + 1 s
    expect(totalMs).toBe(3400 + 1500 + 1500);
    expect(out).toContain('data-duration="6.4"');
    expect(out).not.toContain('data-duration="4"');
    expect(out).toMatch(/<audio id="trazo-audio"[^>]*src="narration\.wav"/);
    expect(readPayload(out).payload.hasAudio).toBe(true);
    expect(readPayload(out).payload.settings.narrationMs).toEqual({
      f1: 3000,
      f3: 400,
    });

    const { samples, rate } = readWav(files["narration.wav"]);
    expect(rate).toBe(24000);
    expect(samples.length).toBe(Math.ceil(6.4 * 24000));
    const at = (s: number) => samples[Math.round(s * 24000)];
    expect(at(0.5)).toBeCloseTo(0.5, 1); // slide 1's voice
    expect(at(3.2)).toBeCloseTo(0, 2); // the tail after it
    // slide 3 begins at 3.4 + 1.5 = 4.9 s
    expect(at(4.8)).toBeCloseTo(0, 2);
    expect(at(5.0)).toBeCloseTo(-0.5, 1);
    expect(at(5.5)).toBeCloseTo(0, 2);
  });

  it("brings a clip made at another sample rate to 24 kHz", async () => {
    const modules = await loadModules();
    const { files } = narrateComposition(
      html,
      [{ frameId: "f1", samples: tone(1, 48000), rate: 48000 }],
      modules,
    );
    expect(readWav(files["narration.wav"]).rate).toBe(24000);
  });

  it("keeps the audio inside the file for a player that speaks", async () => {
    const modules = await loadModules();
    const n = narrateComposition(
      html,
      [{ frameId: "f1", samples: tone(0.5), rate: 24000 }],
      modules,
    );
    const portable = withEmbeddedAudio(
      n.html,
      n.files["narration.wav"],
      modules,
    );
    expect(portable).toContain('src="data:audio/wav;base64,UklGR');
    expect(portable).not.toContain("narration.wav");
  });
});
