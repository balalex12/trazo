import { useEffect, useRef, useState } from "react";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { summarize } from "../agent/canvas";
import { applyOps } from "../agent/ops";
import { AGENT_SYSTEM, buildUserTurn, parseAgentReply } from "../agent/prompt";
import { askModel, describeConnection } from "../ai/llm";
import { EVENTS } from "../branding";

import type { El } from "../agent/elements";

type Msg = {
  role: "user" | "assistant";
  text: string;
  applied?: string[];
  skipped?: string[];
  /** the edits waiting for the user's OK */
  pending?: unknown[];
  state?: "applied" | "discarded";
};

const AUTO_KEY = "trazo-agent-auto-apply";
const HISTORY_TURNS = 6;

const SUGGESTIONS = [
  "Explain this diagram",
  "What is missing in this architecture?",
  "Add a monitoring box and link it to the others",
];

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

const readAuto = () => {
  try {
    return localStorage.getItem(AUTO_KEY) === "1";
  } catch (e) {
    return false;
  }
};

export const AgentPanel = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
}) => {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(readAuto);
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [msgs, busy]);

  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(EVENTS.openAgent, on);
    return () => window.removeEventListener(EVENTS.openAgent, on);
  }, []);

  const conn = open ? describeConnection() : null;

  const currentElements = () =>
    excalidrawAPI.getSceneElementsIncludingDeleted() as unknown as El[];

  /** applies the edits to the canvas as one undoable step; returns what was done */
  const commit = (ops: unknown[]) => {
    // anything not yet recorded in the undo history (an import, for example) becomes its own step first, so
    // Ctrl+Z after an agent change undoes only the agent's change
    excalidrawAPI.updateScene({
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    const before = currentElements();
    const r = applyOps(before, ops);
    const known = new Set(before.map((e) => e.id));
    excalidrawAPI.updateScene({
      elements: r.elements as any,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    // select what was added, so it is easy to see
    const added = r.elements.filter(
      (e) => !known.has(e.id) && e.type !== "text" && e.type !== "arrow",
    );
    if (added.length) {
      excalidrawAPI.updateScene({
        appState: {
          selectedElementIds: Object.fromEntries(
            added.map((e) => [e.id, true]),
          ),
        } as any,
      });
    }
    return r;
  };

  const send = async (text: string) => {
    const request = text.trim();
    if (!request || busy) {
      return;
    }
    setInput("");
    const history = msgs
      .slice(-HISTORY_TURNS)
      .map((m) => ({ role: m.role, content: m.text }));
    setMsgs((m) => [...m, { role: "user", text: request }]);
    if (describeConnection().active === "off") {
      setMsgs((m) => [
        ...m,
        {
          role: "assistant",
          text: "The AI is off. Connect your own model in AI assistant settings (a local model, an API key or the CLI bridge) and ask again.",
        },
      ]);
      return;
    }
    setBusy(true);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const els = currentElements();
      const selected = Object.keys(
        excalidrawAPI.getAppState().selectedElementIds,
      );
      const turn = buildUserTurn(summarize(els, selected), request);
      const answer = await askModel(
        AGENT_SYSTEM,
        [...history, { role: "user", content: turn }],
        ctl.signal,
      );
      if (answer.error) {
        setMsgs((m) => [...m, { role: "assistant", text: answer.error! }]);
        return;
      }
      const reply = parseAgentReply(answer.text);
      if (!reply.ops.length) {
        setMsgs((m) => [
          ...m,
          { role: "assistant", text: reply.message || "Nothing to change." },
        ]);
        return;
      }
      // dry run on a copy: tells what would happen without touching the canvas
      const dry = applyOps(els, reply.ops);
      if (!dry.applied.length) {
        setMsgs((m) => [
          ...m,
          {
            role: "assistant",
            text: reply.message || "I could not make that change.",
            skipped: dry.skipped,
          },
        ]);
        return;
      }
      if (auto) {
        const done = commit(reply.ops);
        setMsgs((m) => [
          ...m,
          {
            role: "assistant",
            text: reply.message || "Done.",
            applied: done.applied,
            skipped: done.skipped,
            state: "applied",
          },
        ]);
      } else {
        setMsgs((m) => [
          ...m,
          {
            role: "assistant",
            text: reply.message || "Here is what I would change.",
            applied: dry.applied,
            skipped: dry.skipped,
            pending: reply.ops,
          },
        ]);
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setMsgs((m) => [
          ...m,
          {
            role: "assistant",
            text: `Something went wrong: ${e?.message || e}`,
          },
        ]);
      }
    } finally {
      setBusy(false);
      abort.current = null;
    }
  };

  const resolve = (index: number, accept: boolean) => {
    const target = msgs[index];
    if (!target?.pending) {
      return;
    }
    let note: Partial<Msg> = { state: "discarded" };
    if (accept) {
      // applied to the canvas as it is now, in case it changed while the answer was shown
      const done = commit(target.pending);
      note = { state: "applied", applied: done.applied, skipped: done.skipped };
    }
    setMsgs((m) =>
      m.map((x, i) =>
        i === index ? { ...x, pending: undefined, ...note } : x,
      ),
    );
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          ...btn,
          position: "fixed",
          bottom: 16,
          right: "calc(50% + 62px)",
          zIndex: 20,
          boxShadow: "0 2px 8px #0003",
        }}
        title="Ask an AI about this diagram or have it edit the diagram (your own model)"
      >
        ✦ Agent
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 64,
        right: 16,
        bottom: 72,
        width: 360,
        zIndex: 20,
        display: "flex",
        flexDirection: "column",
        background: "var(--island-bg-color)",
        color: "var(--text-primary-color)",
        border: "1px solid var(--default-border-color, #8884)",
        borderRadius: 10,
        boxShadow: "0 4px 18px #0003",
        font: "13px system-ui, sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "10px 12px 4px",
          gap: 8,
        }}
      >
        <b style={{ flex: 1 }}>✦ Agent</b>
        {msgs.length > 0 && (
          <button
            style={{ ...ghost, padding: "2px 8px" }}
            onClick={() => setMsgs([])}
          >
            Clear
          </button>
        )}
        <button
          style={{ ...ghost, padding: "2px 8px" }}
          onClick={() => setOpen(false)}
          title="Close"
        >
          ✕
        </button>
      </div>
      <div style={{ padding: "0 12px 6px", color: "#888", fontSize: 12 }}>
        {conn?.active === "off" ? (
          <>
            The AI is off.{" "}
            <button
              style={{
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                color: "var(--color-primary)",
                font: "inherit",
                textDecoration: "underline",
              }}
              onClick={() =>
                window.dispatchEvent(new Event(EVENTS.openAISettings))
              }
            >
              Connect your own model
            </button>
            .
          </>
        ) : (
          <>
            Using <b>{conn?.label}</b>.{" "}
            {conn?.local
              ? "The diagram text stays on this computer."
              : "The text of the diagram (labels and links, never images) is sent to that provider."}
          </>
        )}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "4px 12px" }}>
        {msgs.length === 0 && (
          <div style={{ color: "#888" }}>
            Ask a question about the diagram, or ask for a change: “add a cache
            between the API and the database”. Select a box first to say “this
            one”. Every change can be undone with Ctrl+Z.
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                marginTop: 10,
              }}
            >
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  style={{ ...ghost, textAlign: "left" }}
                  onClick={() => send(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div
            key={i}
            style={{
              margin: "8px 0",
              padding: "8px 10px",
              borderRadius: 8,
              whiteSpace: "pre-wrap",
              background:
                m.role === "user"
                  ? "color-mix(in srgb, var(--color-primary) 14%, transparent)"
                  : "var(--color-surface-low, #8881)",
            }}
          >
            {m.text}
            {m.applied && m.applied.length > 0 && (
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {m.applied.map((a, k) => (
                  <li key={k}>{a}</li>
                ))}
              </ul>
            )}
            {m.skipped && m.skipped.length > 0 && (
              <div style={{ color: "#888", marginTop: 6 }}>
                Not done:
                <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>
                  {m.skipped.map((a, k) => (
                    <li key={k}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
            {m.pending && (
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button style={btn} onClick={() => resolve(i, true)}>
                  Apply
                </button>
                <button style={ghost} onClick={() => resolve(i, false)}>
                  Discard
                </button>
              </div>
            )}
            {m.state === "applied" && (
              <div style={{ color: "#888", marginTop: 6 }}>
                Applied. Ctrl+Z undoes it.
              </div>
            )}
            {m.state === "discarded" && (
              <div style={{ color: "#888", marginTop: 6 }}>Discarded.</div>
            )}
          </div>
        ))}
        {busy && (
          <div style={{ color: "#888", margin: "8px 0" }}>Thinking…</div>
        )}
        <div ref={endRef} />
      </div>

      <div
        style={{
          padding: "6px 12px 10px",
          borderTop: "1px solid var(--default-border-color, #8884)",
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
            e.stopPropagation(); // typing here must not trigger editor shortcuts
          }}
          placeholder="Ask or request a change…"
          rows={3}
          style={{
            width: "100%",
            boxSizing: "border-box",
            resize: "none",
            padding: 8,
            font: "13px system-ui, sans-serif",
            background: "var(--input-bg-color, var(--island-bg-color))",
            color: "var(--text-primary-color)",
            border: "1px solid var(--default-border-color, #8888)",
            borderRadius: 6,
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 6,
          }}
        >
          <label
            style={{
              display: "flex",
              gap: 4,
              alignItems: "center",
              flex: 1,
              fontSize: 12,
            }}
            title="Skip the preview and change the canvas right away. Ctrl+Z still undoes it."
          >
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => {
                setAuto(e.target.checked);
                try {
                  localStorage.setItem(AUTO_KEY, e.target.checked ? "1" : "0");
                } catch (err) {
                  /* ignore */
                }
              }}
            />
            Apply without asking
          </label>
          {busy ? (
            <button style={ghost} onClick={() => abort.current?.abort()}>
              Stop
            </button>
          ) : (
            <button
              style={btn}
              onClick={() => send(input)}
              disabled={!input.trim()}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
