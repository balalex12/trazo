import { useRef, useState } from "react";

import { askModel, describeConnection } from "../ai/llm";

import {
  AUTHOR_SYSTEM,
  COMPOSE_SIZES,
  buildAuthorTurn,
  extractHtml,
  finalizeComposition,
  repairTurn,
  validateComposition,
} from "./author";
import { describeSlides } from "./director";
import { downloadBlob } from "./exporter";

import type { Slide } from "./timeline";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** how many times the model is asked to fix a file that was refused */
const MAX_ATTEMPTS = 3;
const DURATIONS = [10, 15, 20, 30, 45, 60];

type Done = {
  html: string;
  warnings: string[];
  seconds: number;
  attempts: number;
};

/**
 * "Compose with AI": your own model writes a motion graphic as a HyperFrames composition. It is checked as text here
 * (and refused, with the reasons sent back to the model, if it could reach the network, use the clock or load
 * anything), then saved as a file. Nothing is run inside Trazo: `tools/hyperframes-render.mjs` checks and renders it
 * on your computer.
 */
export const ComposerPanel = ({
  slides,
  styles,
}: {
  slides: Slide[];
  styles: {
    btn: React.CSSProperties;
    ghost: React.CSSProperties;
    field: React.CSSProperties;
  };
}) => {
  const { btn, ghost, field } = styles;
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState("");
  const [format, setFormat] = useState("landscape");
  const [seconds, setSeconds] = useState(15);
  const [useSlides, setUseSlides] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<Done | null>(null);
  const abort = useRef<AbortController | null>(null);
  const conn = describeConnection();

  const generate = async () => {
    setError("");
    setDone(null);
    if (conn.active === "off") {
      setError(
        "The AI is off. Connect your own model in AI assistant settings (a local model, an API key or the CLI bridge) and try again.",
      );
      return;
    }
    if (!brief.trim() && !(useSlides && slides.length)) {
      setError("Say what the video is about, or use the text of your slides.");
      return;
    }
    const size = COMPOSE_SIZES[format];
    const expected = { width: size.width, height: size.height, seconds };
    const ctl = new AbortController();
    abort.current = ctl;
    const messages: { role: "user" | "assistant"; content: string }[] = [
      {
        role: "user",
        content: buildAuthorTurn({
          brief,
          width: size.width,
          height: size.height,
          seconds,
          slideTexts: useSlides
            ? describeSlides(slides).map((s) => s.texts)
            : undefined,
          slideNotes: useSlides
            ? describeSlides(slides).map((s) => ({
                caption: s.caption,
                script: s.script,
              }))
            : undefined,
        }),
      },
    ];
    try {
      let lastErrors: string[] = [];
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        setBusy(
          attempt === 1
            ? "Writing the composition…"
            : `Fixing it (attempt ${attempt} of ${MAX_ATTEMPTS})…`,
        );
        const answer = await askModel(
          AUTHOR_SYSTEM,
          messages,
          ctl.signal,
          12_000,
        );
        if (answer.error) {
          setError(answer.error);
          return;
        }
        const html = extractHtml(answer.text);
        const check = validateComposition(html, expected);
        if (!check.errors.length) {
          setDone({
            html: finalizeComposition(html, check.seconds ?? seconds),
            warnings: check.warnings,
            seconds: check.seconds ?? seconds,
            attempts: attempt,
          });
          return;
        }
        lastErrors = check.errors;
        messages.push(
          { role: "assistant", content: answer.text },
          { role: "user", content: repairTurn(check.errors) },
        );
      }
      setError(
        `The model could not make a file that passes the checks after ${MAX_ATTEMPTS} attempts. Last problems: ${lastErrors.join(
          "; ",
        )}. Try again, a more capable model, or a simpler brief.`,
      );
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setError(e?.message || String(e));
      }
    } finally {
      abort.current = null;
      setBusy("");
    }
  };

  if (!open) {
    return (
      <div style={{ margin: "0 0 8px" }}>
        <button
          style={ghost}
          title="Your own AI writes a motion graphic (a HyperFrames composition) that renders to video"
          onClick={() => setOpen(true)}
        >
          🎬 Compose with AI
        </button>
      </div>
    );
  }
  return (
    <div
      style={{
        border: "1px solid var(--default-border-color, #8884)",
        borderRadius: 8,
        padding: 8,
        margin: "0 0 8px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <strong style={{ flex: 1 }}>🎬 Compose with AI</strong>
        <button
          style={{ ...ghost, padding: "2px 8px" }}
          onClick={() => {
            abort.current?.abort();
            setOpen(false);
            setError("");
            setDone(null);
          }}
        >
          Close
        </button>
      </div>
      <textarea
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        placeholder="What is the video about? Tone, colors, audience, language… (optional if you use your slides)"
        rows={3}
        style={{ ...field, margin: "6px 0", resize: "vertical" }}
      />
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 6 }}>
        <label>
          Format
          <select
            style={field}
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          >
            {Object.entries(COMPOSE_SIZES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Length
          <select
            style={field}
            value={seconds}
            onChange={(e) => setSeconds(+e.target.value)}
          >
            {DURATIONS.map((d) => (
              <option key={d} value={d}>
                {d} s
              </option>
            ))}
          </select>
        </label>
      </div>
      <label
        style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}
      >
        <input
          type="checkbox"
          checked={useSlides}
          onChange={(e) => setUseSlides(e.target.checked)}
        />
        Build it from the text of my slides
      </label>
      <div
        style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}
      >
        <button style={btn} disabled={!!busy} onClick={generate}>
          {busy || "Compose"}
        </button>
        {busy && (
          <button style={ghost} onClick={() => abort.current?.abort()}>
            Cancel
          </button>
        )}
      </div>
      <div style={{ color: "#888", marginTop: 4 }}>
        {conn.active === "off"
          ? "The AI is off (AI assistant settings)."
          : conn.local
          ? `Runs on this computer (${conn.label}).`
          : `Sends your brief${
              useSlides ? " and the text of your slides" : ""
            } to ${conn.label}. Nothing else.`}
      </div>
      {error && (
        <div style={{ color: "var(--color-danger, #c62828)", marginTop: 6 }}>
          {error}
        </div>
      )}
      {done && (
        <div style={{ marginTop: 8 }}>
          <div>
            ✓ A {done.seconds} s composition,{" "}
            {Math.round(done.html.length / 1000)} KB
            {done.attempts > 1
              ? ` (fixed after ${done.attempts} attempts)`
              : ""}
            . It passed the text checks: no network, no clock, no randomness,
            nothing loaded from elsewhere.
          </div>
          {done.warnings.length > 0 && (
            <div style={{ color: "#888", marginTop: 4 }}>
              Notes: {done.warnings.join("; ")}.
            </div>
          )}
          <div style={{ marginTop: 6 }}>
            <button
              style={btn}
              onClick={() =>
                downloadBlob(
                  new Blob([done.html], { type: "text/html" }),
                  "composition.html",
                )
              }
            >
              Download composition.html
            </button>
          </div>
          <pre
            style={{
              margin: "8px 0 0",
              padding: 6,
              borderRadius: 6,
              background: "var(--color-surface-low, #f6f6f6)",
              whiteSpace: "pre-wrap",
              userSelect: "all",
            }}
          >
            {
              "node tools/hyperframes-render.mjs composition.html --check\nnode tools/hyperframes-render.mjs composition.html"
            }
          </pre>
          <div style={{ color: "#888", marginTop: 4 }}>
            Trazo only checked it as text and never ran it. The first command
            runs the real HyperFrames checks (layout, contrast, motion); the
            second renders the video on your computer. Read the file first if
            you do not trust the model.
          </div>
        </div>
      )}
    </div>
  );
};
