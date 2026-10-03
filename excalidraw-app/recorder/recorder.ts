// Recorder. Three things can be recorded (all inside the browser, nothing is uploaded):
//  - "canvas": only the editor canvas. Every frame the editor's own canvases are composed onto one output canvas, so
//    toolbars, panels and other windows never appear. Sharpest, needs no extra permission.
//  - "canvas-embeds": the same, plus the live image of embedded pages (maps, iframes). The browser does not let a page
//    read the pixels of an iframe, so the current TAB is captured (the browser asks) and only the rectangles of the
//    iframes are copied from it.
//  - "app": the whole tab as you see it, menus and panels included.
// MediaRecorder encodes the result together with the microphone into one file.

export type QualityPreset = "native" | "720p" | "1080p";
export type CaptureMode = "canvas" | "canvas-embeds" | "app";

export type RecorderOptions = {
  /** the `.excalidraw` container holding the editor canvases */
  root: HTMLElement;
  mode: CaptureMode;
  preset: QualityPreset;
  fps?: number;
  mic: boolean;
  micDeviceId?: string;
  /** highlight the pointer (canvas modes: drawn into the video; app mode: the page draws it) */
  showPointer: boolean;
  /** also compose the interactive layer (selection boxes and handles) */
  showHandles: boolean;
  /** called when the user stops sharing from the browser's own "Stop sharing" bar */
  onEnded?: () => void;
};

export type Streams = { mic: MediaStream | null; display: MediaStream | null };

export type Recording = {
  blob: Blob;
  mimeType: string;
  extension: "mp4" | "webm";
  durationMs: number;
  hasAudio: boolean;
  width: number;
  height: number;
};

export type RecorderHandle = {
  stop: () => Promise<Recording>;
  pause: () => void;
  resume: () => void;
  isPaused: () => boolean;
  elapsedMs: () => number;
  /** microphone level, 0..1 (0 when there is no microphone) */
  level: () => number;
};

// ---- pure helpers (unit tested) -------------------------------------------------------------------------------

/** best first: MP4 plays everywhere, WebM is the fallback */
export const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.640028,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export const pickMimeType = (
  isSupported: (type: string) => boolean,
): string | null => MIME_CANDIDATES.find(isSupported) ?? null;

export const extensionFor = (mimeType: string): "mp4" | "webm" =>
  mimeType.startsWith("video/mp4") ? "mp4" : "webm";

const MAX_PIXELS = 3840 * 2160;
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Output size for a canvas of `srcW`x`srcH` pixels. H.264 needs even sizes; huge canvases are capped at 4K. */
export const outputSize = (
  srcW: number,
  srcH: number,
  preset: QualityPreset,
): { width: number; height: number } => {
  let width = srcW;
  let height = srcH;
  if (preset !== "native") {
    height = preset === "720p" ? 720 : 1080;
    width = height * (srcW / srcH);
  }
  const over = (width * height) / MAX_PIXELS;
  if (over > 1) {
    width /= Math.sqrt(over);
    height /= Math.sqrt(over);
  }
  return { width: even(width), height: even(height) };
};

export const bitrateFor = (width: number, height: number, fps: number) =>
  Math.round(
    Math.min(40_000_000, Math.max(2_000_000, width * height * fps * 0.1)),
  );

const pad = (n: number) => String(n).padStart(2, "0");

export const formatElapsed = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
};

export const recordingFileName = (date: Date, extension: string) =>
  `trazo-recording-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}-${pad(date.getHours())}${pad(date.getMinutes())}.${extension}`;

export const humanSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export type Rect = { left: number; top: number; width: number; height: number };

/**
 * Where an embedded page (an iframe at `el`, in page coordinates) lands inside the output video, and which part of
 * the captured tab video to copy for it. `dest` is where the whole canvas (`canvas`, page coordinates) is drawn in
 * the output. Returns null when the iframe is not over the canvas.
 */
export const embedPlacement = (
  el: Rect,
  canvas: Rect,
  dest: { x: number; y: number; w: number; h: number },
  tab: { videoW: number; videoH: number; viewportW: number; viewportH: number },
) => {
  const left = Math.max(el.left, canvas.left);
  const top = Math.max(el.top, canvas.top);
  const right = Math.min(el.left + el.width, canvas.left + canvas.width);
  const bottom = Math.min(el.top + el.height, canvas.top + canvas.height);
  if (right <= left || bottom <= top) {
    return null;
  }
  const kx = dest.w / canvas.width;
  const ky = dest.h / canvas.height;
  const vx = tab.videoW / tab.viewportW;
  const vy = tab.videoH / tab.viewportH;
  return {
    sx: left * vx,
    sy: top * vy,
    sw: (right - left) * vx,
    sh: (bottom - top) * vy,
    dx: dest.x + (left - canvas.left) * kx,
    dy: dest.y + (top - canvas.top) * ky,
    dw: (right - left) * kx,
    dh: (bottom - top) * ky,
  };
};

// ---- acquiring the streams (asks the browser for permissions) ---------------------------------------------------

export const canRecord = () =>
  typeof MediaRecorder !== "undefined" &&
  typeof HTMLCanvasElement !== "undefined" &&
  "captureStream" in HTMLCanvasElement.prototype;

const micError = (e: unknown) => {
  const name = (e as DOMException)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") {
    return new Error(
      "The microphone is blocked. Allow it in the browser's site settings, or untick “Record microphone” to record without sound.",
    );
  }
  if (name === "NotFoundError") {
    return new Error(
      "No microphone was found. Connect one, or untick “Record microphone”.",
    );
  }
  return new Error(
    `Could not open the microphone: ${(e as Error)?.message ?? e}`,
  );
};

export const releaseStreams = (s: Streams) => {
  s.mic?.getTracks().forEach((t) => t.stop());
  s.display?.getTracks().forEach((t) => t.stop());
};

/**
 * Asks for the microphone and, for the tab modes, for the tab to share. Call it from a click (the browser needs a
 * user gesture for screen sharing) BEFORE the countdown.
 */
export const acquireStreams = async (
  opts: Pick<RecorderOptions, "mode" | "mic" | "micDeviceId" | "fps">,
): Promise<Streams> => {
  if (!canRecord()) {
    throw new Error(
      "This browser cannot record video (MediaRecorder is missing).",
    );
  }
  const streams: Streams = { mic: null, display: null };
  if (opts.mic) {
    try {
      streams.mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: opts.micDeviceId ? { exact: opts.micDeviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (e) {
      throw micError(e);
    }
  }
  if (opts.mode !== "canvas") {
    try {
      streams.display = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: opts.fps ?? 30,
          // ask for the tab's real pixel size (up to 4K); otherwise the browser picks a small default
          width: {
            ideal: Math.round(window.innerWidth * window.devicePixelRatio),
            max: 3840,
          },
          height: {
            ideal: Math.round(window.innerHeight * window.devicePixelRatio),
            max: 2160,
          },
        },
        audio: false,
        // Chrome: offer this tab first, do not offer other windows or monitors
        preferCurrentTab: true,
        selfBrowserSurface: "include",
        surfaceSwitching: "exclude",
      } as DisplayMediaStreamOptions);
    } catch {
      releaseStreams(streams);
      throw new Error(
        "Sharing was cancelled or blocked. Choose this tab in the browser's dialog, or pick “Canvas only”.",
      );
    }
    const surface = streams.display
      .getVideoTracks()[0]
      ?.getSettings().displaySurface;
    // only this tab: sharing a window or a whole screen would record other apps and private content too
    if (surface && surface !== "browser") {
      releaseStreams(streams);
      throw new Error(
        "Please share this browser tab (not a window or a whole screen). Try again and choose the tab, or pick “Canvas only”.",
      );
    }
  }
  return streams;
};

// ---- recording ------------------------------------------------------------------------------------------------

export const startRecorder = async (
  opts: RecorderOptions,
  streams: Streams,
): Promise<RecorderHandle> => {
  const fps = opts.fps ?? 30;
  const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
  if (!mimeType) {
    releaseStreams(streams);
    throw new Error("This browser cannot encode MP4 or WebM video.");
  }
  const layers = () =>
    [...opts.root.querySelectorAll("canvas")].filter(
      (c) => opts.showHandles || !c.classList.contains("interactive"),
    );
  const reference = () =>
    layers().find((c) => c.classList.contains("static")) ?? layers()[0];

  // microphone level meter
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  const samples = new Float32Array(1024);
  if (streams.mic) {
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    audioCtx.createMediaStreamSource(streams.mic).connect(analyser);
  }

  let raf = 0;
  const cleanups: (() => void)[] = [];
  let videoStream: MediaStream;
  let width = 0;
  let height = 0;

  if (opts.mode === "app") {
    // the whole tab goes straight to the encoder
    videoStream = new MediaStream(streams.display!.getVideoTracks());
    const s = videoStream.getVideoTracks()[0].getSettings();
    width = s.width ?? 0;
    height = s.height ?? 0;
  } else {
    const ref0 = reference();
    if (!ref0) {
      releaseStreams(streams);
      throw new Error("The canvas is not ready yet.");
    }
    ({ width, height } = outputSize(ref0.width, ref0.height, opts.preset));
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d", { alpha: false })!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // live image of the tab, only used to copy the rectangles of embedded pages
    let tab: HTMLVideoElement | null = null;
    if (opts.mode === "canvas-embeds" && streams.display) {
      tab = document.createElement("video");
      tab.muted = true;
      tab.playsInline = true;
      tab.srcObject = streams.display;
      await tab.play().catch(() => {});
    }

    // pointer highlight (drawn on top, only while the pointer is over the canvas)
    const pointer = { x: 0, y: 0, downAt: -1e9 };
    const onMove = (e: PointerEvent) => {
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    };
    const onDown = (e: PointerEvent) => {
      onMove(e);
      pointer.downAt = performance.now();
    };
    if (opts.showPointer) {
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerdown", onDown, true);
      cleanups.push(() => {
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerdown", onDown, true);
      });
    }

    const draw = () => {
      const ref = reference();
      if (ref) {
        const k = Math.min(out.width / ref.width, out.height / ref.height);
        const dw = ref.width * k;
        const dh = ref.height * k;
        const ox = (out.width - dw) / 2;
        const oy = (out.height - dh) / 2;
        const r = ref.getBoundingClientRect();
        ctx.fillStyle = "#111";
        ctx.fillRect(0, 0, out.width, out.height);
        for (const c of layers()) {
          ctx.drawImage(c, ox, oy, dw, dh);
        }
        if (tab && tab.videoWidth) {
          for (const f of opts.root.querySelectorAll("iframe")) {
            const p = embedPlacement(
              f.getBoundingClientRect(),
              r,
              { x: ox, y: oy, w: dw, h: dh },
              {
                videoW: tab.videoWidth,
                videoH: tab.videoHeight,
                viewportW: window.innerWidth,
                viewportH: window.innerHeight,
              },
            );
            if (p) {
              ctx.drawImage(
                tab,
                p.sx,
                p.sy,
                p.sw,
                p.sh,
                p.dx,
                p.dy,
                p.dw,
                p.dh,
              );
            }
          }
        }
        if (
          opts.showPointer &&
          pointer.x >= r.left &&
          pointer.x <= r.right &&
          pointer.y >= r.top &&
          pointer.y <= r.bottom
        ) {
          const px = ox + ((pointer.x - r.left) / r.width) * dw;
          const py = oy + ((pointer.y - r.top) / r.height) * dh;
          const u = Math.max(1, out.height / 720); // keeps the size proportional to the video
          const since = performance.now() - pointer.downAt;
          ctx.save();
          ctx.fillStyle = "rgba(204, 68, 12, 0.28)";
          ctx.beginPath();
          ctx.arc(px, py, 16 * u, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(204, 68, 12, 0.9)";
          ctx.lineWidth = 2 * u;
          ctx.stroke();
          if (since < 450) {
            const t = since / 450;
            ctx.strokeStyle = `rgba(204, 68, 12, ${0.8 * (1 - t)})`;
            ctx.lineWidth = 3 * u;
            ctx.beginPath();
            ctx.arc(px, py, (16 + 34 * t) * u, 0, Math.PI * 2);
            ctx.stroke();
          }
          ctx.restore();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    cleanups.push(() => {
      cancelAnimationFrame(raf);
      if (tab) {
        tab.srcObject = null;
      }
    });
    videoStream = out.captureStream(fps);
  }

  const stream = new MediaStream(videoStream.getVideoTracks());
  streams.mic?.getAudioTracks().forEach((t) => stream.addTrack(t));
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: bitrateFor(width || 1920, height || 1080, fps),
    audioBitsPerSecond: 128_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) {
      chunks.push(e.data);
    }
  };
  recorder.start(1000);

  // the browser's own "Stop sharing" bar ends the capture: stop recording too
  streams.display?.getVideoTracks()[0]?.addEventListener("ended", () => {
    opts.onEnded?.();
  });

  // elapsed time that does not count paused periods
  const startedAt = performance.now();
  let pausedAt = 0;
  let pausedTotal = 0;
  const elapsedMs = () =>
    (pausedAt || performance.now()) - startedAt - pausedTotal;

  const cleanup = () => {
    cleanups.forEach((fn) => fn());
    stream.getTracks().forEach((t) => t.stop());
    releaseStreams(streams);
    void audioCtx?.close();
  };

  return {
    isPaused: () => pausedAt !== 0,
    elapsedMs,
    level: () => {
      if (!analyser) {
        return 0;
      }
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) {
        sum += samples[i] * samples[i];
      }
      return Math.min(1, Math.sqrt(sum / samples.length) * 4);
    },
    pause: () => {
      if (!pausedAt && recorder.state === "recording") {
        recorder.pause();
        pausedAt = performance.now();
      }
    },
    resume: () => {
      if (pausedAt && recorder.state === "paused") {
        recorder.resume();
        pausedTotal += performance.now() - pausedAt;
        pausedAt = 0;
      }
    },
    stop: () =>
      new Promise<Recording>((resolve, reject) => {
        const durationMs = elapsedMs();
        recorder.onstop = () => {
          cleanup();
          if (!chunks.length) {
            reject(new Error("Nothing was recorded."));
            return;
          }
          resolve({
            blob: new Blob(chunks, { type: mimeType.split(";")[0] }),
            mimeType,
            extension: extensionFor(mimeType),
            durationMs,
            hasAudio: !!streams.mic,
            width,
            height,
          });
        };
        recorder.onerror = () => {
          cleanup();
          reject(new Error("The recorder failed."));
        };
        if (recorder.state === "inactive") {
          recorder.onstop?.(new Event("stop"));
        } else {
          recorder.stop();
        }
      }),
  };
};
