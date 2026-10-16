import { useRef, useState } from "react";

import { CaptureUpdateAction } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { askModel, describeConnection } from "../ai/llm";

import {
  DIRECTOR_SYSTEM,
  buildDirectorTurn,
  describeSlides,
  parseDirection,
  patchFor,
} from "./director";
import { transitionMs } from "./timeline";

import type { Direction } from "./director";
import type { Slide, TimelineSettings } from "./timeline";

/* eslint-disable @typescript-eslint/no-explicit-any */

type Fields = {
  caption: boolean;
  script: boolean;
  holdMs: boolean;
  transition: boolean;
};

/**
 * "Direct with AI": asks your own model for captions, a narration script, hold times and transitions, shows what it
 * proposes slide by slide, and applies only what you tick. The model never edits the drawing itself.
 */
export const DirectorPanel = ({
  excalidrawAPI,
  slides,
  settings,
  styles,
  onDone,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
  slides: Slide[];
  settings: TimelineSettings;
  styles: {
    btn: React.CSSProperties;
    ghost: React.CSSProperties;
    field: React.CSSProperties;
  };
  onDone: (message: string) => void;
}) => {
  const { btn, ghost, field } = styles;
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [proposal, setProposal] = useState<Direction | null>(null);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [fields, setFields] = useState<Fields>({
    caption: true,
    script: true,
    holdMs: true,
    transition: true,
  });
  const abort = useRef<AbortController | null>(null);
  const conn = describeConnection();

  const propose = async () => {
    setError("");
    setProposal(null);
    if (slides.length < 2) {
      setError("You need at least 2 slides (frames) first.");
      return;
    }
    if (conn.active === "off") {
      setError(
        "The AI is off. Connect your own model in AI assistant settings (a local model, an API key or the CLI bridge) and try again.",
      );
      return;
    }
    setBusy(true);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const answer = await askModel(
        DIRECTOR_SYSTEM,
        [
          {
            role: "user",
            content: buildDirectorTurn(describeSlides(slides), note),
          },
        ],
        ctl.signal,
      );
      if (answer.error) {
        setError(answer.error);
        return;
      }
      const d = parseDirection(answer.text, slides.length);
      if (!d.items.length) {
        setError(
          d.dropped[0] ||
            "The model had nothing to change. Try a more specific note.",
        );
        return;
      }
      setSkip(new Set());
      setProposal(d);
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setError(e?.message || String(e));
      }
    } finally {
      abort.current = null;
      setBusy(false);
    }
  };

  const apply = () => {
    if (!proposal) {
      return;
    }
    const byFrame = new Map<string, Record<string, any>>();
    let changed = 0;
    for (const item of proposal.items) {
      if (skip.has(item.index)) {
        continue;
      }
      const slide = slides[item.index];
      const into =
        item.index > 0
          ? transitionMs(slides[item.index - 1], slide, settings)
          : 0;
      byFrame.set(
        slide.frame.id,
        patchFor(item, slide.frame.customData, into, fields),
      );
      changed++;
    }
    if (!changed) {
      return;
    }
    const all = excalidrawAPI.getSceneElementsIncludingDeleted() as any[];
    excalidrawAPI.updateScene({
      elements: all.map((e) =>
        byFrame.has(e.id)
          ? {
              ...e,
              customData: byFrame.get(e.id),
              version: e.version + 1,
              versionNonce: Math.floor(Math.random() * 2 ** 31),
            }
          : e,
      ),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY, // so it can be undone
    });
    setProposal(null);
    onDone(
      `Applied the AI's direction to ${changed} slide${
        changed === 1 ? "" : "s"
      }. Undo with Ctrl+Z.`,
    );
  };

  if (!open) {
    return (
      <div style={{ margin: "0 0 8px" }}>
        <button
          style={ghost}
          title="Your own AI proposes captions, a narration script, hold times and transitions from what is on your slides"
          onClick={() => setOpen(true)}
        >
          ✨ Direct with AI
        </button>
      </div>
    );
  }
  const tick = (key: keyof Fields, label: string) => (
    <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <input
        type="checkbox"
        checked={fields[key]}
        onChange={(e) => setFields({ ...fields, [key]: e.target.checked })}
      />
      {label}
    </label>
  );
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
        <strong style={{ flex: 1 }}>✨ Direct with AI</strong>
        <button
          style={{ ...ghost, padding: "2px 8px" }}
          onClick={() => {
            abort.current?.abort();
            setOpen(false);
            setProposal(null);
            setError("");
          }}
        >
          Close
        </button>
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Who is it for, what tone, what language, how long? (optional)"
        rows={2}
        style={{ ...field, margin: "6px 0", resize: "vertical" }}
      />
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button style={btn} disabled={busy} onClick={propose}>
          {busy ? "Thinking…" : "Propose"}
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
          ? `Runs on this computer (${conn.label}). The text of your slides never leaves it.`
          : `Sends the text of your slides to ${conn.label}. Nothing else.`}
      </div>
      {error && (
        <div style={{ color: "var(--color-danger, #c62828)", marginTop: 6 }}>
          {error}
        </div>
      )}
      {proposal && (
        <div style={{ marginTop: 8 }}>
          {proposal.message && (
            <div style={{ marginBottom: 6 }}>{proposal.message}</div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {tick("caption", "Captions")}
            {tick("script", "Scripts")}
            {tick("holdMs", "Hold times")}
            {tick("transition", "Transitions")}
          </div>
          <div
            style={{
              maxHeight: 220,
              overflow: "auto",
              margin: "6px 0",
              display: "grid",
              gap: 6,
            }}
          >
            {proposal.items.map((item) => (
              <label
                key={item.index}
                style={{
                  display: "flex",
                  gap: 6,
                  alignItems: "flex-start",
                  background: "var(--color-surface-low, #f6f6f6)",
                  borderRadius: 6,
                  padding: 6,
                }}
              >
                <input
                  type="checkbox"
                  checked={!skip.has(item.index)}
                  onChange={(e) => {
                    const next = new Set(skip);
                    if (e.target.checked) {
                      next.delete(item.index);
                    } else {
                      next.add(item.index);
                    }
                    setSkip(next);
                  }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong>
                    {item.index + 1}. {slides[item.index].name}
                  </strong>
                  {fields.transition && item.transition && (
                    <span style={{ color: "#888" }}> · {item.transition}</span>
                  )}
                  {fields.holdMs && item.holdMs !== undefined && (
                    <span style={{ color: "#888" }}> · {item.holdMs} ms</span>
                  )}
                  {fields.caption && item.caption && (
                    <div>💬 {item.caption}</div>
                  )}
                  {fields.script && item.script && (
                    <div style={{ color: "#888" }}>🎙 {item.script}</div>
                  )}
                </span>
              </label>
            ))}
          </div>
          {proposal.dropped.length > 0 && (
            <div style={{ color: "#888", marginBottom: 6 }}>
              Ignored: {proposal.dropped.join("; ")}.
            </div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <button style={btn} onClick={apply}>
              Apply
            </button>
            <button style={ghost} onClick={() => setProposal(null)}>
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
