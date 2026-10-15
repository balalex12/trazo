// @ts-expect-error plain ES module, not part of the typechecked sources
import {
  HYPERFRAMES_VERSION,
  parseArgs,
  prepareComposition,
} from "./hyperframes-render.mjs";
import { buildPlayerHtml } from "../excalidraw-app/animation/htmlPlayer";
import {
  DEFAULT_SETTINGS,
  getSlides,
} from "../excalidraw-app/animation/timeline";

/* eslint-disable @typescript-eslint/no-explicit-any */

const slides = getSlides([
  {
    id: "f1",
    type: "frame",
    x: 0,
    y: 0,
    width: 800,
    height: 500,
    isDeleted: false,
  },
  {
    id: "f2",
    type: "frame",
    x: 0,
    y: 700,
    width: 800,
    height: 500,
    isDeleted: false,
  },
] as any);

const html = (audio = false) =>
  buildPlayerHtml({
    title: "t",
    slides,
    files: {},
    settings: { ...DEFAULT_SETTINGS },
    width: 1280,
    height: 800,
    fps: 30,
    background: "#fff",
    fontCss: "",
    runtime: "",
    audio: audio
      ? { samples: new Float32Array([0, 0.25, -0.25, 0.5]), sampleRate: 24000 }
      : null,
  });

describe("prepareComposition", () => {
  it("writes the narration out as a file, because HyperFrames mixes audio from files", () => {
    const { html: out, files } = prepareComposition(html(true));
    expect(out).toMatch(/<audio id="trazo-audio"[^>]*src="narration\.wav"/);
    expect(out).not.toContain("data:audio");
    const wav = files["narration.wav"] as Buffer;
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.length).toBe(44 + 4 * 2);
  });

  it("leaves a file without narration alone", () => {
    const original = html(false);
    const { html: out, files } = prepareComposition(original);
    expect(out).toBe(original);
    expect(files).toEqual({});
  });

  it("re-sizes the stage everywhere it is stored", () => {
    const { html: out } = prepareComposition(html(), { size: [1920, 1080] });
    expect(out).toContain('data-width="1920" data-height="1080"');
    expect(out).toContain('style="width:1920px;height:1080px"');
    expect(out).toContain(":root{--w:1920px;--h:1080px}");
    const payload = JSON.parse(
      out.split('id="trazo-payload">')[1].split("</script>")[0],
    );
    expect([payload.width, payload.height]).toEqual([1920, 1080]);
    expect(out).not.toContain("1280");
  });
});

describe("parseArgs", () => {
  it("reads the options", () => {
    const o = parseArgs([
      "a.html",
      "-o",
      "out.mp4",
      "--fps",
      "60",
      "-q",
      "delivery",
      "--size",
      "1920x1080",
      "--resolution",
      "4k",
      "--docker",
    ]);
    expect(o.input).toBe("a.html");
    expect(o.output).toBe("out.mp4");
    expect(o.size).toEqual([1920, 1080]);
    expect(o.docker).toBe(true);
    expect(o.flags).toEqual([
      "--fps",
      "60",
      "--quality",
      "delivery",
      "--resolution",
      "4k",
    ]);
  });

  it("refuses what it does not know", () => {
    expect(() => parseArgs(["a.html", "--nope"])).toThrow(/Unknown option/);
    expect(() => parseArgs(["a.html", "--size", "big"])).toThrow(/1920x1080/);
    expect(() => parseArgs(["a.html", "-o"])).toThrow(/needs a value/);
    expect(() => parseArgs(["a.html", "b.html"])).toThrow(/Unexpected/);
  });

  it("pins the HyperFrames version it was tested with", () => {
    expect(HYPERFRAMES_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
