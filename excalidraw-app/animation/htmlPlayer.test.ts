import {
  buildPlayerHtml,
  encodeWav,
  resample,
  scriptJson,
  toBase64,
  usedFiles,
} from "./htmlPlayer";
import { DEFAULT_SETTINGS, getSlides, totalDurationMs } from "./timeline";

/* eslint-disable @typescript-eslint/no-explicit-any */

const frame = (id: string, y: number, extra: any = {}) => ({
  id,
  type: "frame",
  x: 0,
  y,
  width: 800,
  height: 500,
  name: id,
  isDeleted: false,
  customData: extra,
});
const box = (id: string, frameId: string, y: number, extra: any = {}) => ({
  id,
  type: "rectangle",
  frameId,
  x: 20,
  y: y + 20,
  width: 100,
  height: 60,
  isDeleted: false,
  ...extra,
});

const slides = getSlides([
  frame("f1", 0, { caption: "A </script><b>caption</b>" }),
  box("a", "f1", 0),
  box("img", "f1", 0, { type: "image", fileId: "file-1" }),
  frame("f2", 700),
  box("b", "f2", 700),
] as any);
const files = {
  "file-1": { id: "file-1", dataURL: "data:image/png;base64,AAAA" },
  "file-2": { id: "file-2", dataURL: "data:image/png;base64,BBBB" },
};

const build = (extra: any = {}) =>
  buildPlayerHtml({
    title: 'Tom & "Jerry" <demo>',
    slides,
    files,
    settings: { ...DEFAULT_SETTINGS },
    width: 1280,
    height: 720,
    fps: 30,
    background: "#ffffff",
    fontCss:
      '@font-face{font-family:"Test";src:url(data:font/woff2;base64,AA==)}',
    runtime: "/* player */ window.__ran = 1;",
    ...extra,
  });

describe("buildPlayerHtml", () => {
  const html = build();

  it("is a HyperFrames composition: id, size, fps, duration, a timed clip", () => {
    const secs = totalDurationMs(slides, DEFAULT_SETTINGS) / 1000;
    expect(html).toContain('data-composition-id="trazo"');
    expect(html).toContain('data-width="1280" data-height="720" data-fps="30"');
    expect(html).toContain(`data-duration="${secs}"`);
    expect(html).toMatch(/id="trazo-stage" class="clip" data-start="0"/);
  });

  it("is one self-contained file: the runtime, the data and the fonts are inside", () => {
    expect(html).toContain("window.__ran = 1");
    expect(html).toContain('id="trazo-payload"');
    expect(html).toContain('font-family:"Test"');
    // nothing is fetched: no external script, stylesheet, image or font
    expect(html).not.toMatch(/(src|href)="https?:/);
    expect(html).not.toMatch(/@import/);
  });

  it("escapes the title and keeps text from breaking out of the script elements", () => {
    expect(html).toContain(
      "<title>Tom &amp; &quot;Jerry&quot; &lt;demo&gt;</title>",
    );
    const data = html.split('id="trazo-payload">')[1].split("</script>")[0];
    expect(data).not.toContain("</script");
    const payload = JSON.parse(data);
    expect(payload.slides[0].frame.customData.caption).toBe(
      "A </script><b>caption</b>",
    );
    expect(payload.width).toBe(1280);
    expect(payload.slides).toHaveLength(2);
  });

  it("carries only the image files the slides use", () => {
    expect(Object.keys(usedFiles(slides, files))).toEqual(["file-1"]);
    const payload = JSON.parse(
      html.split('id="trazo-payload">')[1].split("</script>")[0],
    );
    expect(Object.keys(payload.files)).toEqual(["file-1"]);
  });

  it("has the player controls", () => {
    for (const id of ["prev", "play", "next", "scrub", "time", "cc", "full"]) {
      expect(html).toContain(`id="trazo-${id}"`);
    }
  });

  it("adds the narration as an audio element timed like the composition", () => {
    expect(html).not.toContain("<audio");
    const withAudio = build({
      audio: {
        samples: new Float32Array([0, 0.5, -0.5, 1]),
        sampleRate: 24000,
      },
    });
    expect(withAudio).toMatch(
      /<audio id="trazo-audio"[^>]*data-start="0" data-duration="[\d.]+" data-track-index="1" src="data:audio\/wav;base64,/,
    );
    expect(withAudio).toContain('"hasAudio":true');
  });
});

describe("helpers", () => {
  it("writes a valid 16-bit mono WAV", () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2]), 24000);
    const text = (a: number, n: number) =>
      String.fromCharCode(...wav.subarray(a, a + n));
    const view = new DataView(wav.buffer);
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(46, true)).toBe(0x7fff);
    expect(view.getInt16(48, true)).toBe(-0x8000);
    expect(view.getInt16(50, true)).toBe(0x7fff); // clipped, not wrapped
  });

  it("encodes base64 in chunks without a size limit", () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 251);
    expect(atob(toBase64(big)).length).toBe(200_000);
    expect(toBase64(new Uint8Array([104, 105]))).toBe("aGk=");
  });

  it("resamples to the new rate", () => {
    const one = new Float32Array(48000).fill(0.5);
    expect(resample(one, 48000, 24000)).toHaveLength(24000);
    expect(resample(one, 48000, 48000)).toBe(one);
    expect(resample(new Float32Array([0, 1]), 2, 4)[1]).toBeCloseTo(0.5);
  });

  it("makes JSON safe for a script element", () => {
    const text = scriptJson({ a: "</script><!-- \u2028" });
    expect(text).not.toContain("<");
    expect(JSON.parse(text).a).toBe("</script><!-- \u2028");
  });
});
