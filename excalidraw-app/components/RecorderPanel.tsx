import { useEffect, useRef, useState } from "react";

import {
  acquireStreams,
  canRecord,
  formatElapsed,
  humanSize,
  recordingFileName,
  releaseStreams,
  startRecorder,
} from "../recorder/recorder";

import { MicSelect, useMics } from "./MicSelect";

import type {
  CaptureMode,
  QualityPreset,
  RecorderHandle,
  Recording,
  Streams,
} from "../recorder/recorder";

type Phase = "idle" | "countdown" | "recording" | "review";

const btn: React.CSSProperties = {
  padding: "6px 12px",
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
const card: React.CSSProperties = {
  position: "fixed",
  bottom: 64,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 21,
  width: 360,
  maxWidth: "94vw",
  boxSizing: "border-box",
  background: "var(--island-bg-color)",
  border: "1px solid var(--default-border-color, #8884)",
  borderRadius: 10,
  boxShadow: "0 4px 18px #0003",
  padding: 12,
  font: "13px system-ui, sans-serif",
  color: "var(--text-primary-color)",
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
const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  margin: "8px 0",
};

const MODE_HELP: Record<CaptureMode, string> = {
  canvas:
    "Only the canvas: no menus, panels or other windows. The sharpest option. No extra permission needed (maps and embedded pages appear as an empty box).",
  "canvas-embeds":
    "The canvas plus the live image of maps and embedded pages. Your browser will ask which tab to share: choose this tab.",
  app: "The whole tab as you see it, with menus and panels. Your browser will ask which tab to share: choose this tab.",
};

/** Orange ring that follows the pointer. In "whole app" mode the page itself is captured, so the page draws it. */
const PointerRing = () => {
  const ring = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let downAt = -1e9;
    let raf = 0;
    const move = (e: PointerEvent) => {
      if (ring.current) {
        ring.current.style.transform = `translate(${e.clientX - 16}px, ${
          e.clientY - 16
        }px)`;
        ring.current.style.opacity = "1";
      }
    };
    const down = (e: PointerEvent) => {
      move(e);
      downAt = performance.now();
    };
    const animate = () => {
      const t = (performance.now() - downAt) / 450;
      if (ring.current) {
        ring.current.style.boxShadow =
          t < 1
            ? `0 0 0 ${4 + 30 * t}px rgba(204, 68, 12, ${0.5 * (1 - t)})`
            : "none";
      }
      raf = requestAnimationFrame(animate);
    };
    animate();
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerdown", down, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerdown", down, true);
    };
  }, []);
  return (
    <div
      ref={ring}
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        width: 32,
        height: 32,
        borderRadius: "50%",
        background: "rgba(204, 68, 12, 0.28)",
        border: "2px solid rgba(204, 68, 12, 0.9)",
        boxSizing: "border-box",
        pointerEvents: "none",
        opacity: 0,
        zIndex: 1300,
      }}
    />
  );
};

export const RecorderPanel = () => {
  const [phase, setPhase] = useState<Phase>("idle");
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<CaptureMode>("canvas");
  const [hideBar, setHideBar] = useState(false);
  const [preset, setPreset] = useState<QualityPreset>("native");
  const [mic, setMic] = useState(true);
  const micChoice = useMics();
  const [showPointer, setShowPointer] = useState(true);
  const [showHandles, setShowHandles] = useState(false);
  const [error, setError] = useState("");
  const [count, setCount] = useState(3);
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const [result, setResult] = useState<{ rec: Recording; url: string } | null>(
    null,
  );
  const handle = useRef<RecorderHandle | null>(null);
  const cancelled = useRef(false);
  const stopRef = useRef<() => void>(() => {});

  // refresh the timer and the microphone meter while recording
  useEffect(() => {
    if (phase !== "recording") {
      return;
    }
    const id = setInterval(() => setTick((t) => t + 1), 100);
    return () => clearInterval(id);
  }, [phase]);

  // free the video URL when it is replaced or the panel goes away
  useEffect(
    () => () => {
      if (result) {
        URL.revokeObjectURL(result.url);
      }
    },
    [result],
  );

  const begin = async () => {
    setError("");
    const root = document.querySelector<HTMLElement>(".excalidraw");
    if (!root) {
      setError("The canvas is not ready yet.");
      return;
    }
    cancelled.current = false;
    // permissions first, while the click is fresh (screen sharing needs a user gesture)
    let streams: Streams;
    try {
      streams = await acquireStreams({
        mode,
        mic,
        micDeviceId: micChoice.deviceId || undefined,
      });
      // device names are only available once the microphone has been allowed
      micChoice.refresh();
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    setOpen(false);
    setPhase("countdown");
    for (let n = 3; n > 0; n--) {
      setCount(n);
      await new Promise((r) => setTimeout(r, 1000));
      if (cancelled.current) {
        releaseStreams(streams);
        setPhase("idle");
        return;
      }
    }
    try {
      handle.current = await startRecorder(
        {
          root,
          mode,
          preset,
          mic,
          showPointer,
          showHandles,
          onEnded: () => stopRef.current(),
        },
        streams,
      );
      setPaused(false);
      setPhase("recording");
    } catch (e) {
      setError((e as Error).message);
      setPhase("idle");
      setOpen(true);
    }
  };

  const stop = async () => {
    const h = handle.current;
    if (!h) {
      return;
    }
    handle.current = null;
    try {
      const rec = await h.stop();
      setResult({ rec, url: URL.createObjectURL(rec.blob) });
      setPhase("review");
    } catch (e) {
      setError((e as Error).message);
      setPhase("idle");
      setOpen(true);
    }
  };

  stopRef.current = () => {
    void stop();
  };

  // stop from the keyboard (the bar can be hidden in "whole app" mode)
  useEffect(() => {
    if (phase !== "recording") {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.code === "KeyR") {
        e.preventDefault();
        stopRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [phase]);

  const download = () => {
    if (!result) {
      return;
    }
    const a = document.createElement("a");
    a.href = result.url;
    a.download = recordingFileName(new Date(), result.rec.extension);
    a.click();
  };

  const discard = () => {
    setResult(null);
    setPhase("idle");
  };

  if (!canRecord()) {
    return null;
  }

  const h = handle.current;
  void tick; // re-render on every timer tick

  return (
    <>
      {phase === "idle" && (
        <button
          onClick={() => setOpen(!open)}
          style={{
            ...btn,
            position: "fixed",
            bottom: 16,
            left: "calc(50% + 62px)",
            zIndex: 20,
            boxShadow: "0 2px 8px #0003",
          }}
          title="Record the canvas with your voice (nothing is uploaded)"
        >
          ⏺ Record
        </button>
      )}

      {phase === "idle" && open && (
        <div style={card}>
          <b>Record</b>
          <div style={{ color: "#888", margin: "4px 0 8px" }}>
            Records the canvas, or the whole app, with your microphone. The
            video is made in your browser and never leaves it.
          </div>
          <label style={{ display: "block", margin: "8px 0" }}>
            What to record
            <select
              style={field}
              value={mode}
              onChange={(e) => setMode(e.target.value as CaptureMode)}
            >
              <option value="canvas">Canvas only</option>
              <option value="canvas-embeds">
                Canvas and embedded pages (maps)
              </option>
              <option value="app">Whole app (menus and panels too)</option>
            </select>
          </label>
          <div style={{ color: "#888", margin: "-2px 0 8px" }}>
            {MODE_HELP[mode]}
          </div>
          <label style={{ display: "block", margin: "8px 0" }}>
            Quality
            <select
              style={field}
              disabled={mode === "app"}
              title={
                mode === "app"
                  ? "The whole app is recorded at the tab's own size"
                  : undefined
              }
              value={preset}
              onChange={(e) => setPreset(e.target.value as QualityPreset)}
            >
              <option value="native">
                Native (sharpest, same size as the canvas)
              </option>
              <option value="1080p">1080p</option>
              <option value="720p">720p (smaller file)</option>
            </select>
          </label>
          <label style={row}>
            <input
              type="checkbox"
              checked={mic}
              onChange={(e) => setMic(e.target.checked)}
            />
            Record microphone
          </label>
          {mic && (
            <MicSelect
              style={{ ...field, marginBottom: 6 }}
              mics={micChoice.mics}
              deviceId={micChoice.deviceId}
              onChange={micChoice.choose}
            />
          )}
          <label style={row}>
            <input
              type="checkbox"
              checked={showPointer}
              onChange={(e) => setShowPointer(e.target.checked)}
            />
            Highlight the pointer and clicks
          </label>
          {mode !== "app" && (
            <label style={row}>
              <input
                type="checkbox"
                checked={showHandles}
                onChange={(e) => setShowHandles(e.target.checked)}
              />
              Show selection boxes and handles
            </label>
          )}
          {mode === "app" && (
            <label style={row}>
              <input
                type="checkbox"
                checked={hideBar}
                onChange={(e) => setHideBar(e.target.checked)}
              />
              Hide the recording bar (stop with Alt+Shift+R)
            </label>
          )}
          <div style={{ color: "#888" }}>
            Tip: for the sharpest video use a big window or full screen, and
            keep this tab visible while recording.
          </div>
          {error && (
            <div
              style={{ color: "var(--color-danger, #c62828)", marginTop: 8 }}
            >
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button style={btn} onClick={begin}>
              Start (3 s countdown)
            </button>
            <button style={ghost} onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
        </div>
      )}

      {phase === "countdown" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1200,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#0005",
            color: "#fff",
            font: "bold 120px system-ui, sans-serif",
          }}
        >
          {count}
          <button
            style={{
              ...ghost,
              color: "#fff",
              borderColor: "#fff",
              fontSize: 16,
            }}
            onClick={() => {
              cancelled.current = true;
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {phase === "recording" && mode === "app" && showPointer && (
        <PointerRing />
      )}

      {phase === "recording" && h && !(mode === "app" && hideBar) && (
        <div
          style={{
            position: "fixed",
            // bottom center: the top center is taken by the editor toolbar
            bottom: 64,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1200,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 12px",
            borderRadius: 999,
            background: "#222",
            color: "#fff",
            font: "13px system-ui, sans-serif",
            boxShadow: "0 4px 18px #0006",
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: paused ? "#999" : "#e03131",
            }}
          />
          <b style={{ fontVariantNumeric: "tabular-nums" }}>
            {paused ? "PAUSED" : "REC"} {formatElapsed(h.elapsedMs())}
          </b>
          {mic && (
            <span
              title="Microphone level"
              style={{
                width: 60,
                height: 6,
                borderRadius: 3,
                background: "#555",
                overflow: "hidden",
              }}
            >
              <span
                style={{
                  display: "block",
                  height: "100%",
                  width: `${Math.round(h.level() * 100)}%`,
                  background: "#69db7c",
                }}
              />
            </span>
          )}
          <button
            style={{
              ...ghost,
              color: "#fff",
              borderColor: "#888",
              padding: "3px 10px",
            }}
            onClick={() => {
              if (paused) {
                h.resume();
              } else {
                h.pause();
              }
              setPaused(!paused);
            }}
          >
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            style={{
              ...btn,
              background: "#e03131",
              borderColor: "#e03131",
              padding: "3px 10px",
            }}
            onClick={stop}
          >
            Stop
          </button>
        </div>
      )}

      {phase === "review" && result && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1200,
            background: "#0006",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              ...card,
              position: "static",
              transform: "none",
              width: "min(760px, 94vw)",
              bottom: "auto",
            }}
          >
            <b>Your recording</b>
            <video
              src={result.url}
              controls
              style={{
                width: "100%",
                margin: "8px 0",
                borderRadius: 6,
                background: "#111",
              }}
            />
            <div style={{ color: "#888" }}>
              {formatElapsed(result.rec.durationMs)} · {result.rec.width}×
              {result.rec.height} · {result.rec.extension.toUpperCase()} ·{" "}
              {humanSize(result.rec.blob.size)} ·{" "}
              {result.rec.hasAudio ? "with microphone" : "no sound"}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button style={btn} onClick={download}>
                Download
              </button>
              <button style={ghost} onClick={discard}>
                Discard
              </button>
              <button
                style={ghost}
                onClick={() => {
                  discard();
                  setOpen(true);
                }}
              >
                Record again
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
