import {
  bitrateFor,
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
