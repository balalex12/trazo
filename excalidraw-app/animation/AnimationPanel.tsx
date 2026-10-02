import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CaptureUpdateAction, restoreElements } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { downloadBlob, exportAnimation } from "./exporter";
import { outputSize, renderAtTime, renderBlend } from "./renderer";
import { DEFAULT_SETTINGS, getSlides, totalDurationMs } from "./timeline";

import type { ExportFormat } from "./exporter";
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

// ---- Player (full screen) ------------------------------------------------
const Player = ({
  slides,
  files,
  settings,
  mode,
  onClose,
}: {
  slides: Slide[];
  files: any;
  settings: TimelineSettings;
  mode: "auto" | "manual";
  onClose: () => void;
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hud, setHud] = useState("");
  // keep the latest onClose without restarting the playback effect on every parent render
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
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

    if (mode === "auto") {
      const total = totalDurationMs(slides, settings);
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
      let cur = 0;
      let animating = false;
      run(() => renderBlend(opts, 0, 0, 0, canvas));
      setHud(`1 / ${slides.length}  ·  ← → to navigate · Esc to exit`);
      const go = (delta: number) => {
        const target = cur + delta;
        if (animating || target < 0 || target >= slides.length) {
          return;
        }
        animating = true;
        const from = cur;
        const t0 = performance.now();
        const step = (now: number) => {
          if (!alive) {
            return;
          }
          const t = Math.min(1, (now - t0) / settings.transitionMs);
          run(() => renderBlend(opts, from, target, t, canvas));
          if (t < 1) {
            raf = requestAnimationFrame(step);
          } else {
            cur = target;
            animating = false;
            setHud(
              `${cur + 1} / ${slides.length}  ·  ← → to navigate · Esc to exit`,
            );
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
        onCloseRef.current();
        return;
      }
      if (mode !== "manual") {
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
        if (mode === "manual") {
          (canvasRef.current as any)?.__go?.(1);
        }
      }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: dims.cssW, height: dims.cssH, background: "#fff" }}
      />
      <div
        style={{
          position: "absolute",
          bottom: 10,
          left: 0,
          right: 0,
          textAlign: "center",
          color: "#aaa",
          font: "12px system-ui",
        }}
      >
        {hud}
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        style={{
          position: "absolute",
          top: 12,
          right: 12,
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
    mode: "auto" | "manual";
    slides: Slide[];
    files: any;
  }>(null);
  const [job, setJob] = useState<null | {
    format: ExportFormat;
    done: number;
    total: number;
  }>(null);
  const [error, setError] = useState("");
  const cancel = useRef({ cancelled: false });

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

  const play = (mode: "auto" | "manual") => {
    const s = snapshot();
    if (s.length < 2) {
      setError(
        "You need at least 2 slides (frames). Use “Duplicate slide” to create the next one.",
      );
      return;
    }
    setError("");
    setPlayer({ mode, slides: s, files: excalidrawAPI.getFiles() });
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
    const opts = {
      slides: s,
      files: excalidrawAPI.getFiles(),
      settings,
      width: px.width,
      height: px.height,
    };
    setJob({ format, done: 0, total: 1 });
    try {
      const blob = await exportAnimation(
        format,
        opts,
        fpsUsed,
        (done, total) => setJob({ format, done, total }),
        cancel.current,
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
  const totalSec = (totalDurationMs(slides, settings) / 1000).toFixed(1);

  // Per-slide hold lives on the frame (customData.holdMs); empty = use the global default.
  const setSlideHold = (frameId: string, value: string) => {
    const v = value.trim() === "" ? null : Math.max(0, Math.round(+value));
    if (v !== null && !Number.isFinite(v)) {
      return;
    }
    const all = excalidrawAPI.getSceneElementsIncludingDeleted() as any[];
    excalidrawAPI.updateScene({
      elements: all.map((e) => {
        if (e.id !== frameId) {
          return e;
        }
        const { holdMs: _old, ...rest } = e.customData || {};
        return {
          ...e,
          customData: v === null ? rest : { ...rest, holdMs: v },
          version: e.version + 1,
          versionNonce: Math.floor(Math.random() * 2 ** 31),
        };
      }) as any,
    });
  };

  const card: React.CSSProperties = {
    position: "fixed",
    bottom: 64,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 20,
    width: 380,
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
              maxHeight: 130,
              overflow: "auto",
              background: "var(--color-surface-low, #f6f6f6)",
              padding: 6,
              borderRadius: 6,
            }}
          >
            {slides.length === 0 && <i>No slides yet.</i>}
            {slides.map((s, i) => (
              <div
                key={s.frame.id}
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
                <HoldInput
                  value={s.frame.customData?.holdMs}
                  placeholder={String(settings.holdMs)}
                  onCommit={(v) => setSlideHold(s.frame.id, v)}
                  style={{ ...field, width: 78 }}
                />
                <span style={{ color: "#888" }}>ms</span>
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
          </div>
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
                <option value="easeOut">Ease out</option>
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
          <div style={{ color: "#888", marginTop: 4 }}>
            GIF is capped at 15 fps / 800 px. Interactive maps are exported as a
            placeholder (use “Copy image” in the map).
          </div>
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
          settings={settings}
          onClose={() => setPlayer(null)}
        />
      )}
    </>
  );
};
