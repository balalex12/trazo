import {
  bitrateFor,
  embedPlacement,
  extensionFor,
  formatElapsed,
  humanSize,
  outputSize,
  pickMimeType,
  recordingFileName,
} from "./recorder";

describe("pickMimeType", () => {
  it("prefers MP4 with H.264 and AAC", () => {
    expect(pickMimeType(() => true)).toBe(
      "video/mp4;codecs=avc1.640028,mp4a.40.2",
    );
  });

  it("falls back to WebM when MP4 is not supported", () => {
    const webmOnly = (t: string) => t.startsWith("video/webm");
    expect(pickMimeType(webmOnly)).toBe("video/webm;codecs=vp9,opus");
    expect(pickMimeType((t) => t === "video/webm")).toBe("video/webm");
  });

  it("returns null when nothing is supported", () => {
    expect(pickMimeType(() => false)).toBeNull();
  });

  it("maps a mime type to a file extension", () => {
    expect(extensionFor("video/mp4;codecs=avc1")).toBe("mp4");
    expect(extensionFor("video/webm;codecs=vp9,opus")).toBe("webm");
  });
});

describe("outputSize", () => {
  it("keeps the canvas size for native, rounded to even numbers", () => {
    expect(outputSize(1301, 801, "native")).toEqual({
      width: 1302,
      height: 802,
    });
    expect(outputSize(1280, 720, "native")).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it("scales to the preset height keeping the aspect ratio", () => {
    expect(outputSize(1400, 700, "1080p")).toEqual({
      width: 2160,
      height: 1080,
    });
    expect(outputSize(1920, 1080, "720p")).toEqual({
      width: 1280,
      height: 720,
    });
  });

  it("never produces odd sizes (H.264 needs even)", () => {
    for (const [w, h] of [
      [1333, 777],
      [999, 1001],
      [1, 1],
    ]) {
      for (const p of ["native", "720p", "1080p"] as const) {
        const o = outputSize(w, h, p);
        expect(o.width % 2).toBe(0);
        expect(o.height % 2).toBe(0);
      }
    }
  });

  it("caps huge canvases at 4K pixels", () => {
    const o = outputSize(8000, 4500, "native");
    expect(o.width * o.height).toBeLessThanOrEqual(3840 * 2160 + 10000);
    expect(Math.abs(o.width / o.height - 8000 / 4500)).toBeLessThan(0.01);
  });
});

describe("bitrateFor", () => {
  it("is about 6 Mbps for 1080p30 and stays within bounds", () => {
    expect(bitrateFor(1920, 1080, 30)).toBeGreaterThan(5_000_000);
    expect(bitrateFor(1920, 1080, 30)).toBeLessThan(8_000_000);
    expect(bitrateFor(100, 100, 30)).toBe(2_000_000);
    expect(bitrateFor(7680, 4320, 60)).toBe(40_000_000);
  });
});

describe("formatting", () => {
  it("formats the elapsed time", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(65_400)).toBe("01:05");
    expect(formatElapsed(3_725_000)).toBe("1:02:05");
    expect(formatElapsed(-5)).toBe("00:00");
  });

  it("builds a file name from the local date", () => {
    expect(recordingFileName(new Date(2026, 9, 2, 8, 5), "mp4")).toBe(
      "trazo-recording-2026-10-02-0805.mp4",
    );
  });

  it("formats sizes", () => {
    expect(humanSize(500)).toBe("1 KB");
    expect(humanSize(2048)).toBe("2 KB");
    expect(humanSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("embedPlacement", () => {
  // canvas fills a 1000x600 area at (0,0) and is drawn 1:1 into a 1000x600 output;
  // the captured tab video is 2000x1200 for a 1000x600 viewport (device pixel ratio 2)
  const canvas = { left: 0, top: 0, width: 1000, height: 600 };
  const dest = { x: 0, y: 0, w: 1000, h: 600 };
  const tab = { videoW: 2000, videoH: 1200, viewportW: 1000, viewportH: 600 };

  it("copies the iframe area from the tab video and puts it where the iframe is", () => {
    const p = embedPlacement(
      { left: 100, top: 50, width: 400, height: 300 },
      canvas,
      dest,
      tab,
    )!;
    expect(p).toEqual({
      sx: 200,
      sy: 100,
      sw: 800,
      sh: 600,
      dx: 100,
      dy: 50,
      dw: 400,
      dh: 300,
    });
  });

  it("scales into a differently sized output and offsets by the letterbox", () => {
    const p = embedPlacement(
      { left: 100, top: 50, width: 400, height: 300 },
      canvas,
      { x: 20, y: 10, w: 500, h: 300 },
      tab,
    )!;
    expect(p.dx).toBe(20 + 100 * 0.5);
    expect(p.dy).toBe(10 + 50 * 0.5);
    expect(p.dw).toBe(200);
    expect(p.dh).toBe(150);
  });

  it("clips the part of an iframe that sticks out of the canvas", () => {
    const p = embedPlacement(
      { left: -100, top: 500, width: 300, height: 300 },
      canvas,
      dest,
      tab,
    )!;
    expect(p.dx).toBe(0);
    expect(p.dw).toBe(200);
    expect(p.dy).toBe(500);
    expect(p.dh).toBe(100);
  });

  it("ignores an iframe that is not over the canvas", () => {
    expect(
      embedPlacement(
        { left: 1200, top: 0, width: 100, height: 100 },
        canvas,
        dest,
        tab,
      ),
    ).toBeNull();
  });
});
