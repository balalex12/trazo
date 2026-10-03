import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  CaptureUpdateAction,
  loadFromBlob,
  restoreElements,
  serializeAsJSON,
} from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { MicSelect, useMics } from "../components/MicSelect";

import { downloadBlob, exportAnimation } from "./exporter";
import {
  buildNarrationTrack,
  deleteClip,
  loadNarrationMs,
  micError,
  openMic,
  saveClip,
  splitNarration,
  startMicCapture,
} from "./narration";
import {
  addNarrationToJson,
  readBundle,
  restoreNarration,
} from "./narrationFile";
import { outputSize, renderAtTime, renderBlend } from "./renderer";
import {
  DEFAULT_SETTINGS,
  getSlides,
  totalDurationMs,
  transitionMs,
  transitionModeOf,
} from "./timeline";

import type { ExportAudio, ExportFormat } from "./exporter";
import type { MicCapture } from "./narration";
import type { Slide, TimelineSettings } from "./timeline";

/* eslint-disable @typescript-eslint/no-explicit-any */

const SETTINGS_KEY = "anim-settings";
const uid = () =>
  (crypto as any).randomUUID?.().replace(/-/g, "").slice(0, 21) ??
  Math.random().toString(36).slice(2) + Date.now().toString(36);

const loadSettings = (): TimelineSettings => {
  try {
    return {
      ...DEFAULT_SETTINGS,
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"),
    };
  } catch (e) {
    return DEFAULT_SETTINGS;
  }
};

/** What a narration session recorded: the raw samples and the moment (s) each slide's clip began. */
type Narrated = {
  samples: Float32Array;
  sampleRate: number;
  endSec: number;
  /** starts[k] is when the clip of slide startIndex + k begins */
  starts: number[];
  startIndex: number;
};

// ---- Player (full screen) ------------------------------------------------
// auto: plays the animation (with the narration when there is one). manual: you move with the keys.
// narrate: like manual, but your voice is recorded and every "next" marks where a slide's clip begins.
const Player = ({
  slides,
  files,
  settings,
  mode,
  audio,
  mic,
  startIndex = 0,
  onNarrated,
  onClose,
}: {
  slides: Slide[];
  files: any;
  settings: TimelineSettings;
  mode: "auto" | "manual" | "narrate";
  audio?: ExportAudio | null;
  mic?: MediaStream;
  startIndex?: number;
  onNarrated?: (r: Narrated) => void;
  onClose: () => void;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState("");
  // keep the latest callbacks and inputs without restarting the playback effect on every parent render
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onNarratedRef = useRef(onNarrated);
  onNarratedRef.current = onNarrated;
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const micRef = useRef(mic);
  micRef.current = mic;
  const startIndexRef = useRef(startIndex);
  startIndexRef.current = startIndex;
  const dims = useMemo(() => {
    const f = slides[0].frame;
    const aspect = f.width / f.height;
    const cssW = Math.min(window.innerWidth, window.innerHeight * aspect);
    const cssH = cssW / aspect;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // render at the real on-screen pixel size (vector re-render, so it stays crisp)
    const px = outputSize(slides, Math.min(2560, Math.round(cssW * dpr)));
    return { cssW, cssH, ...px };
  }, [slides]);
  const opts = useMemo(
    () => ({ slides, files, settings, width: dims.width, height: dims.height }),
    [slides, files, settings, dims],
  );

  useEffect(() => {
    let alive = true;
    let raf = 0;
    const canvas = canvasRef.current!;

    // render helper: only one render in flight, latest request wins
    let busy = false;
    let pending: (() => Promise<any>) | null = null;
    const run = (fn: () => Promise<any>) => {
      pending = fn;
      if (busy) {
        return;
      }
      busy = true;
      (async () => {
        while (pending && alive) {
          const job = pending;
          pending = null;
          await job().catch(() => {});
        }
        busy = false;
      })();
    };

    let cleanupAudio: (() => void) | null = null;
    let cleanupNarration: (() => void) | null = null;

    if (mode === "auto") {
      const total = totalDurationMs(slides, settings);
      const track = audioRef.current;
      if (track) {
        const ctx = new AudioContext();
        const buffer = ctx.createBuffer(
          1,
          track.samples.length,
          track.sampleRate,
        );
        buffer.copyToChannel(new Float32Array(track.samples), 0);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start();
        cleanupAudio = () => {
          try {
            source.stop();
          } catch (e) {
            /* already stopped */
          }
          void ctx.close();
        };
      }
      const start = performance.now();
      const tick = (now: number) => {
        if (!alive) {
          return;
        }
        const t = now - start;
        run(() => renderAtTime(opts, Math.min(t, total), canvas));
        setHud(`${Math.min(100, Math.round((t / total) * 100))}%`);
        if (t < total) {
          raf = requestAnimationFrame(tick);
        } else {
          setHud("done · Esc to close");
        }
      };
      raf = requestAnimationFrame(tick);
    } else {
      const narrate = mode === "narrate";
      const n = slides.length;
      let cur =
        narrate && startIndexRef.current > 0 ? startIndexRef.current - 1 : 0;
      let animating = false;
      let capture: MicCapture | null = null;
      let finished = false;
      let timer: any = null;
      // starts[k]: when the clip of slide startIndex + k begins (slide 0 begins with the recording)
      const starts: number[] =
        narrate && startIndexRef.current === 0 ? [0] : [];
      const status = () => {
        if (!narrate) {
          return `${cur + 1} / ${n}  ·  ← → to navigate · Esc to exit`;
        }
        const level = capture ? Math.round(capture.level() * 8) : 0;
        const meter = `${"|".repeat(level)}${"·".repeat(8 - level)}`;
        const secs = Math.floor(capture ? capture.nowSec() : 0);
        return `● REC ${secs} s  ·  slide ${
          cur + 1
        } / ${n}  ·  mic ${meter}  ·  → next slide  ·  Esc to finish and save`;
      };
      run(() => renderBlend(opts, cur, cur, 0, canvas));
      setHud(status());

      const finish = () => {
        if (finished) {
          return;
        }
        finished = true;
        clearInterval(timer);
        if (capture) {
          const r = capture.stop();
          capture = null;
          onNarratedRef.current?.({
            ...r,
            starts,
            startIndex: startIndexRef.current,
          });
        } else {
          micRef.current?.getTracks().forEach((t) => t.stop());
        }
        onCloseRef.current();
      };
      if (narrate) {
        (canvas as any).__finish = finish;
        cleanupNarration = () => {
          clearInterval(timer);
          if (!finished) {
            capture?.stop();
            micRef.current?.getTracks().forEach((t) => t.stop());
          }
        };
        (async () => {
          for (let k = 3; k > 0; k--) {
            setHud(
              `Narration starts in ${k}…  speak, and press → whenever you want the next slide`,
            );
            await new Promise((r) => setTimeout(r, 1000));
            if (!alive) {
              return;
            }
          }
          capture = startMicCapture(micRef.current!);
          timer = setInterval(() => setHud(status()), 150);
        })();
      }

      const go = (delta: number) => {
        if (narrate && (!capture || delta < 0)) {
          return; // not recording yet, or going back (a recording only moves forward)
        }
        const target = cur + delta;
        if (animating) {
          return;
        }
        if (narrate && target >= n) {
          finish(); // "next" on the last slide ends the narration
          return;
        }
        if (target < 0 || target >= n) {
          return;
        }
        if (narrate) {
          starts.push(capture!.nowSec()); // the clip of the slide we are entering starts right now
        }
        const from = cur;
        // each transition has its own length: a "cut" is instant, "build" lasts as long as it has things to show
        const dur = transitionMs(slides[from], slides[target], settings);
        if (dur <= 0) {
          cur = target;
          run(() => renderBlend(opts, target, target, 0, canvas));
          setHud(status());
          return;
        }
        animating = true;
        const t0 = performance.now();
        const step = (now: number) => {
          if (!alive) {
            return;
          }
          const t = Math.min(1, (now - t0) / dur);
          run(() => renderBlend(opts, from, target, t, canvas));
          if (t < 1) {
            raf = requestAnimationFrame(step);
          } else {
            cur = target;
            animating = false;
            setHud(status());
          }
        };
        raf = requestAnimationFrame(step);
      };
      (canvas as any).__go = go;
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        if (mode === "narrate") {
          (canvas as any).__finish?.(); // saves what was recorded
        } else {
          onCloseRef.current();
        }
        return;
      }
      if (mode === "auto") {
        return;
      }
      const go = (canvas as any).__go as (d: number) => void;
      if (
        ["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(e.key)
      ) {
        e.stopPropagation();
        e.preventDefault();
        go(1);
      } else if (
        ["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(e.key)
      ) {
        e.stopPropagation();
        e.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      cleanupAudio?.();
      cleanupNarration?.();
      window.removeEventListener("keydown", onKey, true);
    };
  }, [mode, opts, slides, settings]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#111",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onClick={() => {
        if (mode !== "auto") {
          (canvasRef.current as any)?.__go?.(1);
        }
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: dims.cssW, height: dims.cssH, background: "#fff" }}
      />
      {hud && (
        <div
          style={{
            position: "absolute",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            maxWidth: "92%",
            textAlign: "center",
            color: "#fff",
            background: "rgba(0, 0, 0, 0.75)",
            padding: "6px 14px",
            borderRadius: 999,
            font: mode === "narrate" ? "15px system-ui" : "12px system-ui",
            pointerEvents: "none",
            zIndex: 2, // above the canvas (the editor styles give every canvas its own stacking level)
          }}
        >
          {hud}
        </div>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (mode === "narrate") {
            (canvasRef.current as any)?.__finish?.();
          } else {
            onClose();
          }
        }}
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          zIndex: 2,
          background: "#333",
          color: "#fff",
          border: 0,
          borderRadius: 4,
          padding: "6px 10px",
          cursor: "pointer",
        }}
      >
        ✕
      </button>
    </div>
  );
};

/** Number field that keeps its own draft while typing and commits on blur/Enter (the slide list refreshes late). */
const CaptionInput = ({
  value,
  style,
  onCommit,
}: {
  value: string | undefined;
  style: React.CSSProperties;
  onCommit: (v: string) => void;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null) {
      onCommit(draft);
      setDraft(null);
    }
  };
  return (
    <input
      type="text"
      title="Caption shown at the bottom of this slide in the preview and in the exported video. Empty = none."
      placeholder="Caption (optional)"
      value={draft ?? value ?? ""}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
      }}
      style={style}
    />
  );
};

const HoldInput = ({
  value,
  placeholder,
  style,
  onCommit,
}: {
  value: number | undefined;
  placeholder: string;
  style: React.CSSProperties;
  onCommit: (v: string) => void;
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === undefined ? "" : String(value));
  const commit = () => {
    if (draft !== null) {
      onCommit(draft);
      setDraft(null);
    }
  };
  return (
    <input
      type="number"
      min={0}
      step={500}
      title="Hold for this slide (ms). Empty = default Hold."
      placeholder={placeholder}
      value={shown}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        }
      }}
      style={style}
    />
  );
};

// ---- Panel ---------------------------------------------------------------
export const AnimationPanel = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
}) => {
  const [open, setOpen] = useState(false);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [settings, setSettings] = useState<TimelineSettings>(loadSettings);
  const [fps, setFps] = useState(30);
  const [width, setWidth] = useState(1280);
  const [player, setPlayer] = useState<null | {
    mode: "auto" | "manual" | "narrate";
    slides: Slide[];
    files: any;
    audio?: ExportAudio | null;
    mic?: MediaStream;
    startIndex?: number;
  }>(null);
  const [job, setJob] = useState<null | {
    format: ExportFormat;
    done: number;
    total: number;
  }>(null);
  const [error, setError] = useState("");
  const cancel = useRef({ cancelled: false });
  // narration: length (ms) of the stored clip of each slide, and whether to use it
  const [clips, setClips] = useState<Record<string, number>>({});
  const [withNarration, setWithNarration] = useState(true);
  const micChoice = useMics();
  const [note, setNote] = useState("");
  const openRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      /* ignore */
    }
  }, [settings]);

  // keep the slide list in sync (throttled)
  useEffect(() => {
    let timer: any = null;
    const refresh = () =>
      setSlides(
        getSlides(excalidrawAPI.getSceneElementsIncludingDeleted() as any),
      );
    refresh();
    const off = excalidrawAPI.onChange(() => {
      clearTimeout(timer);
      timer = setTimeout(refresh, 300);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, [excalidrawAPI]);

  const slideIds = slides.map((sl) => sl.frame.id).join(",");
  const refreshClips = useCallback(async (ids: string[]) => {
    try {
      setClips(await loadNarrationMs(ids));
    } catch (e) {
      setClips({});
    }
  }, []);
  useEffect(() => {
    void refreshClips(slideIds ? slideIds.split(",") : []);
  }, [slideIds, refreshClips]);
  // the timeline the player and the exports use: slides last at least as long as their narration
  const timeline = useMemo<TimelineSettings>(
    () => ({ ...settings, narrationMs: withNarration ? clips : undefined }),
    [settings, clips, withNarration],
  );

  const snapshot = useCallback(
    () => getSlides(excalidrawAPI.getSceneElementsIncludingDeleted() as any),
    [excalidrawAPI],
  );

  const duplicateSlide = () => {
    const current = snapshot();
    if (!current.length) {
      setError(
        "Create a slide first: press F (Frame tool) and drag a rectangle on the canvas.",
      );
      return;
    }
    const selected = excalidrawAPI.getAppState().selectedElementIds;
    const slide =
      current.find((s) => selected[s.frame.id]) ?? current[current.length - 1];
    const all = excalidrawAPI.getSceneElementsIncludingDeleted() as any[];
    const src = [slide.frame, ...slide.children];
    const idMap = new Map<string, string>(src.map((e) => [e.id, uid()]));
    const groupMap = new Map<string, string>();
    const mapGroup = (g: string) => {
      if (!groupMap.has(g)) {
        groupMap.set(g, uid());
      }
      return groupMap.get(g)!;
    };
    const bottom = Math.max(...current.map((s) => s.frame.y + s.frame.height));
    const dy = bottom + 80 - slide.frame.y;
    const remap = (id: string | null | undefined) =>
      id ? idMap.get(id) ?? null : null;
    const bump = (n: string) =>
      /\d+$/.test(n) ? n.replace(/\d+$/, (m) => String(+m + 1)) : `${n} 2`;

    const clones = src.map((e: any) => {
      const c: any = {
        ...e,
        id: idMap.get(e.id)!,
        y: e.y + dy,
        index: null,
        version: 1,
        versionNonce: Math.floor(Math.random() * 2 ** 31),
        frameId: remap(e.frameId),
        groupIds: (e.groupIds || []).map(mapGroup),
        customData: {
          ...(e.customData || {}),
          animKey: e.customData?.animKey ?? e.id,
        },
      };
      if (e.type === "frame") {
        c.name = bump(e.name || `Slide ${current.length}`);
      }
      if ("containerId" in e) {
        c.containerId = remap(e.containerId);
      }
      if (e.boundElements) {
        c.boundElements = e.boundElements.map((b: any) => ({
          ...b,
          id: idMap.get(b.id) ?? b.id,
        }));
      }
      if (e.startBinding) {
        c.startBinding = {
          ...e.startBinding,
          elementId:
            idMap.get(e.startBinding.elementId) ?? e.startBinding.elementId,
        };
      }
      if (e.endBinding) {
        c.endBinding = {
          ...e.endBinding,
          elementId:
            idMap.get(e.endBinding.elementId) ?? e.endBinding.elementId,
        };
      }
      return c;
    });
    const restored = restoreElements(clones as any, null);
    const newFrameId = idMap.get(slide.frame.id)!;
    excalidrawAPI.updateScene({
      elements: [...all, ...restored] as any,
      appState: { selectedElementIds: { [newFrameId]: true } } as any,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    const nf = restored.find((e: any) => e.id === newFrameId);
    if (nf) {
      excalidrawAPI.setViewport({
        target: [nf.x, nf.y, nf.x + nf.width, nf.y + nf.height],
        fit: "scale-down",
      } as any);
    }
    setError("");
  };

  const play = async (mode: "auto" | "manual") => {
    const s = snapshot();
    if (s.length < 2) {
      setError(
        "You need at least 2 slides (frames). Use “Duplicate slide” to create the next one.",
      );
      return;
    }
    setError("");
    const audio =
      mode === "auto" && withNarration && Object.keys(clips).length
        ? await buildNarrationTrack(s, timeline)
        : null;
    setPlayer({ mode, slides: s, files: excalidrawAPI.getFiles(), audio });
  };

  // record your voice while you present: "next" marks where each slide's clip begins
  const narrate = async (startIndex: number) => {
    const s = snapshot();
    if (s.length < 2) {
      setError(
        "You need at least 2 slides (frames). Use “Duplicate slide” to create the next one.",
      );
      return;
    }
    setError("");
    let mic: MediaStream;
    try {
      mic = await openMic(micChoice.deviceId || undefined);
      // device names are only available once the microphone has been allowed
      micChoice.refresh();
    } catch (e) {
      setError(micError(e));
      return;
    }
    setPlayer({
      mode: "narrate",
      slides: s,
      files: excalidrawAPI.getFiles(),
      startIndex,
      mic,
    });
  };

  const saveNarration = async (r: Narrated, list: Slide[]) => {
    const parts = splitNarration(r.samples, r.sampleRate, r.starts, r.endSec);
    for (let k = 0; k < parts.length; k++) {
      const slide = list[r.startIndex + k];
      // a slide passed in a blink (an accidental double press) keeps whatever narration it had
      if (slide && parts[k].length >= r.sampleRate * 0.3) {
        await saveClip(slide.frame.id, parts[k], r.sampleRate);
      }
    }
    await refreshClips(list.map((sl) => sl.frame.id));
  };

  const removeNarration = async (frameId: string) => {
    await deleteClip(frameId);
    await refreshClips(slides.map((sl) => sl.frame.id));
  };

  // the drawing as a normal .excalidraw file, with the narration of every slide inside
  const saveWithNarration = async () => {
    setError("");
    setNote("");
    try {
      const plain = serializeAsJSON(
        excalidrawAPI.getSceneElements(),
        excalidrawAPI.getAppState(),
        excalidrawAPI.getFiles(),
        "local",
      );
      const { json, clips: n } = await addNarrationToJson(
        plain,
        snapshot().map((sl) => sl.frame.id),
      );
      downloadBlob(
        new Blob([json], { type: "application/json" }),
        "drawing-with-narration.excalidraw",
      );
      setNote(
        n
          ? `Saved the drawing with ${n} narration clip${n === 1 ? "" : "s"}.`
          : "Saved the drawing. There is no narration to include yet.",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // replaces the canvas with a saved drawing and puts its narration back
  const openWithNarration = async (file: File) => {
    setError("");
    setNote("");
    try {
      const bundle = readBundle(await file.text());
      const loaded = await loadFromBlob(file, null, null);
      excalidrawAPI.updateScene({
        elements: loaded.elements,
        appState: { viewBackgroundColor: loaded.appState.viewBackgroundColor },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      excalidrawAPI.addFiles(Object.values(loaded.files));
      excalidrawAPI.setViewport({
        target: loaded.elements.filter((el) => !el.isDeleted),
        fit: "scale-down",
      } as any);
      const ids = getSlides(loaded.elements as any).map((sl) => sl.frame.id);
      if (!bundle) {
        setNote("Opened the drawing. The file has no narration.");
        return;
      }
      const { restored, unmatched } = await restoreNarration(bundle, ids);
      await refreshClips(ids);
      setNote(
        `Opened the drawing and restored ${restored} narration clip${
          restored === 1 ? "" : "s"
        }${unmatched ? ` (${unmatched} had no matching slide)` : ""}.`,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const doExport = async (format: ExportFormat) => {
    const s = snapshot();
    if (s.length < 2) {
      setError("You need at least 2 slides (frames) to export an animation.");
      return;
    }
    setError("");
    cancel.current = { cancelled: false };
    const fpsUsed = format === "gif" ? Math.min(fps, 15) : fps;
    const px = outputSize(s, format === "gif" ? Math.min(width, 800) : width);
    // a GIF cannot carry sound, so it keeps the plain timing; the MP4 follows the narration
    const useNarration =
      format === "mp4" && withNarration && Object.keys(clips).length > 0;
    const opts = {
      slides: s,
      files: excalidrawAPI.getFiles(),
      settings: useNarration ? timeline : settings,
      width: px.width,
      height: px.height,
    };
    setJob({ format, done: 0, total: 1 });
    try {
      const audio = useNarration
        ? await buildNarrationTrack(s, timeline)
        : null;
      const blob = await exportAnimation(
        format,
        opts,
        fpsUsed,
        (done, total) => setJob({ format, done, total }),
        cancel.current,
        audio,
      );
      downloadBlob(blob, `animation.${format}`);
    } catch (e: any) {
      if (e?.message !== "Export cancelled") {
        setError(e?.message || String(e));
      }
    } finally {
      setJob(null);
    }
  };

  const num = (v: string, d: number) =>
    Number.isFinite(+v) && +v >= 0 ? +v : d;
  const totalSec = (totalDurationMs(slides, timeline) / 1000).toFixed(1);

  // Per-slide settings live on the frame's customData (holdMs, transition); null/undefined = use the default.
  const setSlideData = (frameId: string, key: string, value: unknown) => {
    const all = excalidrawAPI.getSceneElementsIncludingDeleted() as any[];
    excalidrawAPI.updateScene({
      elements: all.map((e) => {
        if (e.id !== frameId) {
          return e;
        }
        const { [key]: _old, ...rest } = e.customData || {};
        return {
          ...e,
          customData:
            value === null || value === undefined
              ? rest
              : { ...rest, [key]: value },
          version: e.version + 1,
          versionNonce: Math.floor(Math.random() * 2 ** 31),
        };
      }) as any,
    });
  };
  const setSlideHold = (frameId: string, value: string) => {
    const v = value.trim() === "" ? null : Math.max(0, Math.round(+value));
    if (v === null || Number.isFinite(v)) {
      setSlideData(frameId, "holdMs", v);
    }
  };

  const card: React.CSSProperties = {
    position: "fixed",
    bottom: 64,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 20,
    width: 420,
    background: "var(--island-bg-color)",
    border: "1px solid var(--default-border-color, #8884)",
    borderRadius: 10,
    boxShadow: "0 4px 18px #0003",
    padding: 12,
    font: "13px system-ui, sans-serif",
    color: "var(--text-primary-color)",
  };
  const btn: React.CSSProperties = {
    padding: "6px 10px",
    border: "1px solid var(--color-primary)",
    background: "var(--color-primary)",
    color: "var(--color-icon-white, #fff)",
    borderRadius: 6,
    cursor: "pointer",
  };
  const ghost: React.CSSProperties = {
    ...btn,
    background: "transparent",
    color: "var(--color-primary)",
  };
  const field: React.CSSProperties = {
    width: "100%",
    padding: 4,
    boxSizing: "border-box",
    background: "var(--input-bg-color, var(--island-bg-color))",
    color: "var(--text-primary-color)",
    border: "1px solid var(--default-border-color, #8888)",
    borderRadius: 4,
  };

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        style={{
          ...btn,
          position: "fixed",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 20,
          boxShadow: "0 2px 8px #0003",
        }}
        title="Slides, animation preview, presentation mode and MP4/GIF export"
      >
        🎞 Animation
      </button>
      {open && (
        <div style={card}>
          <b>Animation</b>
          <div style={{ color: "#888", margin: "4px 0 8px" }}>
            Slides = frames (press <kbd>F</kbd>). “Duplicate slide” copies the
            selected one below it; changed elements animate between slides,
            new/removed ones fade.
          </div>
          <div
            style={{
              maxHeight: 290, // room for about four slides before it scrolls
              overflow: "auto",
              background: "var(--color-surface-low, #f6f6f6)",
              padding: 6,
              borderRadius: 6,
            }}
          >
            {slides.length === 0 && <i>No slides yet.</i>}
            {slides.map((s, i) => (
              <div key={s.frame.id} style={{ marginBottom: 4 }}>
                <div
                  onClick={() =>
                    excalidrawAPI.setViewport({
                      target: s.frame,
                      fit: "scale-down",
                    } as any)
                  }
                  style={{
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <span style={{ flex: 1 }}>
                    {i + 1}. {s.name}{" "}
                    <span style={{ color: "#888" }}>
                      ({s.children.length} elements)
                    </span>
                  </span>
                  {i > 0 && (
                    <select
                      title={
                        "How this slide is entered.\nSmart: matching elements move, new ones fade in.\nFade: nothing moves, cross-fade (identical elements stay put).\nCut: instant.\nBuild: new elements appear one after another and arrows draw themselves.\nPan: the camera travels over the canvas to this slide."
                      }
                      value={transitionModeOf(s)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        setSlideData(
                          s.frame.id,
                          "transition",
                          e.target.value === "smart" ? null : e.target.value,
                        )
                      }
                      style={{ ...field, width: 74 }}
                    >
                      <option value="smart">Smart</option>
                      <option value="fade">Fade</option>
                      <option value="cut">Cut</option>
                      <option value="build">Build</option>
                      <option value="pan">Pan</option>
                    </select>
                  )}
                  <HoldInput
                    value={s.frame.customData?.holdMs}
                    placeholder={String(settings.holdMs)}
                    onCommit={(v) => setSlideHold(s.frame.id, v)}
                    style={{ ...field, width: 78 }}
                  />
                  <span style={{ color: "#888" }}>ms</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    marginTop: 2,
                  }}
                >
                  <CaptionInput
                    value={s.frame.customData?.caption}
                    onCommit={(v) =>
                      setSlideData(s.frame.id, "caption", v.trim() || null)
                    }
                    style={{ ...field, width: "auto", flex: 1 }}
                  />
                  <button
                    style={{ ...ghost, padding: "2px 6px" }}
                    title="Record your narration from this slide on (you present, and → moves to the next slide)"
                    onClick={(e) => {
                      e.stopPropagation();
                      void narrate(i);
                    }}
                  >
                    🎙
                  </button>
                  {clips[s.frame.id] && (
                    <>
                      <span style={{ color: "#888", whiteSpace: "nowrap" }}>
                        {(clips[s.frame.id] / 1000).toFixed(1)} s
                      </span>
                      <button
                        style={{ ...ghost, padding: "2px 6px" }}
                        title="Delete the narration of this slide"
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeNarration(s.frame.id);
                        }}
                      >
                        ✕
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, margin: "8px 0" }}>
            <button style={btn} onClick={duplicateSlide}>
              Duplicate slide
            </button>
            <button style={ghost} onClick={() => play("auto")}>
              ▶ Preview
            </button>
            <button style={ghost} onClick={() => play("manual")}>
              ⛶ Present
            </button>
            <button
              style={ghost}
              title="Present and record your voice: each slide gets its own narration clip"
              onClick={() => narrate(0)}
            >
              🎙 Narrate
            </button>
          </div>
          <MicSelect
            style={{ ...field, marginBottom: 8 }}
            mics={micChoice.mics}
            deviceId={micChoice.deviceId}
            onChange={micChoice.choose}
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 6,
            }}
          >
            <label>
              Transition (ms)
              <input
                style={field}
                type="number"
                value={settings.transitionMs}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    transitionMs: num(e.target.value, 900),
                  })
                }
              />
            </label>
            <label>
              Hold, default (ms)
              <input
                style={field}
                type="number"
                value={settings.holdMs}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    holdMs: num(e.target.value, 1500),
                  })
                }
              />
            </label>
            <label>
              Easing
              <select
                style={field}
                value={settings.easing}
                onChange={(e) =>
                  setSettings({ ...settings, easing: e.target.value as any })
                }
              >
                <option value="easeInOut">Ease in-out</option>
                <option value="easeInOutCubic">Ease in-out (strong)</option>
                <option value="easeOut">Ease out</option>
                <option value="easeOutBack">Overshoot</option>
                <option value="spring">Spring</option>
                <option value="linear">Linear</option>
              </select>
            </label>
            <label>
              FPS
              <select
                style={field}
                value={fps}
                onChange={(e) => setFps(+e.target.value)}
              >
                {[10, 15, 24, 30, 60].map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <label>
              Width (px)
              <select
                style={field}
                value={width}
                onChange={(e) => setWidth(+e.target.value)}
              >
                {[480, 640, 800, 1280, 1920].map((w) => (
                  <option key={w}>{w}</option>
                ))}
              </select>
            </label>
            <div style={{ alignSelf: "end", color: "#888" }}>
              {slides.length >= 2 ? `${totalSec}s total` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button
              style={btn}
              disabled={!!job}
              onClick={() => doExport("mp4")}
            >
              Export MP4
            </button>
            <button
              style={btn}
              disabled={!!job}
              onClick={() => doExport("gif")}
            >
              Export GIF
            </button>
            {job && (
              <button
                style={ghost}
                onClick={() => (cancel.current.cancelled = true)}
              >
                Cancel
              </button>
            )}
          </div>
          {Object.keys(clips).length > 0 && (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 6,
              }}
            >
              <input
                type="checkbox"
                checked={withNarration}
                onChange={(e) => setWithNarration(e.target.checked)}
              />
              Use my narration (Preview and MP4; a GIF has no sound)
            </label>
          )}
          <div style={{ color: "#888", marginTop: 4 }}>
            GIF is capped at 15 fps / 800 px. Interactive maps are exported as a
            placeholder (use “Copy image” in the map).
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button
              style={ghost}
              title="Save a .excalidraw file that also holds your narration, so it travels with the drawing"
              onClick={saveWithNarration}
            >
              Save drawing with narration
            </button>
            <button
              style={ghost}
              title="Replace the canvas with a saved drawing and restore its narration"
              onClick={() => openRef.current?.click()}
            >
              Open drawing with narration…
            </button>
            <input
              ref={openRef}
              type="file"
              accept=".excalidraw,application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) {
                  void openWithNarration(f);
                }
              }}
            />
          </div>
          {note && <div style={{ color: "#888", marginTop: 4 }}>{note}</div>}
          {job && (
            <div style={{ marginTop: 6 }}>
              <div
                style={{
                  height: 6,
                  background: "var(--color-surface-low, #eee)",
                  borderRadius: 3,
                }}
              >
                <div
                  style={{
                    height: 6,
                    width: `${(job.done / job.total) * 100}%`,
                    background: "var(--color-primary)",
                    borderRadius: 3,
                  }}
                />
              </div>
              <small>
                Rendering {job.format.toUpperCase()} … {job.done}/{job.total}{" "}
                frames
              </small>
            </div>
          )}
          {error && (
            <div
              style={{ color: "var(--color-danger, #c62828)", marginTop: 6 }}
            >
              {error}
            </div>
          )}
        </div>
      )}
      {player && (
        <Player
          {...player}
          settings={timeline}
          onNarrated={(r) => {
            void saveNarration(r, player.slides);
          }}
          onClose={() => setPlayer(null)}
        />
      )}
    </>
  );
};
