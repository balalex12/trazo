// Canvas recorder: records the editor's CANVAS (not the screen) plus the microphone, all inside the browser.
// Every frame the editor's own canvases are composed onto one output canvas, a pointer highlight is drawn on top, and
// MediaRecorder encodes canvas + microphone into one file. Toolbars, panels, other windows and notifications are DOM,
// so they never appear in the video. Nothing is uploaded: the result is a Blob you download.

export type QualityPreset = "native" | "720p" | "1080p";

export type RecorderOptions = {
  /** the `.excalidraw` container holding the editor canvases */
  root: HTMLElement;
  preset: QualityPreset;
  fps?: number;
  mic: boolean;
  micDeviceId?: string;
  showPointer: boolean;
  /** also compose the interactive layer (selection boxes and handles) */
  showHandles: boolean;
};

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

// ---- recording ------------------------------------------------------------------------------------------------

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

export const startRecorder = async (
  opts: RecorderOptions,
): Promise<RecorderHandle> => {
  if (!canRecord()) {
    throw new Error(
      "This browser cannot record video (MediaRecorder is missing).",
    );
  }
  const fps = opts.fps ?? 30;
  const layers = () =>
    [...opts.root.querySelectorAll("canvas")].filter(
      (c) => opts.showHandles || !c.classList.contains("interactive"),
    );
  const reference = () =>
    layers().find((c) => c.classList.contains("static")) ?? layers()[0];
  const ref0 = reference();
  if (!ref0) {
    throw new Error("The canvas is not ready yet.");
  }

  const mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
  if (!mimeType) {
    throw new Error("This browser cannot encode MP4 or WebM video.");
  }

  // microphone first: if it fails nothing else has been started
  let micStream: MediaStream | null = null;
  if (opts.mic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
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

  const { width, height } = outputSize(ref0.width, ref0.height, opts.preset);
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d", { alpha: false })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  // pointer highlight (drawn on top, only while the pointer is over the canvas)
  const pointer = { x: 0, y: 0, inside: false, downAt: -1e9 };
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
  }

  // microphone level meter
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  const samples = new Float32Array(1024);
  if (micStream) {
    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    audioCtx.createMediaStreamSource(micStream).connect(analyser);
  }

  let raf = 0;
  const draw = () => {
    const ref = reference();
    if (ref) {
      const k = Math.min(out.width / ref.width, out.height / ref.height);
      const dw = ref.width * k;
      const dh = ref.height * k;
      const ox = (out.width - dw) / 2;
      const oy = (out.height - dh) / 2;
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, out.width, out.height);
      for (const c of layers()) {
        ctx.drawImage(c, ox, oy, dw, dh);
      }
      if (opts.showPointer) {
        const r = ref.getBoundingClientRect();
        const inside =
          pointer.x >= r.left &&
          pointer.x <= r.right &&
          pointer.y >= r.top &&
          pointer.y <= r.bottom;
        if (inside) {
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
    }
    raf = requestAnimationFrame(draw);
  };
  draw();

  const stream = out.captureStream(fps);
  micStream?.getAudioTracks().forEach((t) => stream.addTrack(t));
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: bitrateFor(width, height, fps),
    audioBitsPerSecond: 128_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) {
      chunks.push(e.data);
    }
  };
  recorder.start(1000);

  // elapsed time that does not count paused periods
  const startedAt = performance.now();
  let pausedAt = 0;
  let pausedTotal = 0;
  const elapsedMs = () =>
    (pausedAt || performance.now()) - startedAt - pausedTotal;

  const cleanup = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerdown", onDown, true);
    stream.getTracks().forEach((t) => t.stop());
    micStream?.getTracks().forEach((t) => t.stop());
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
            hasAudio: !!micStream,
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
