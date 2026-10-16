// A Python notebook next to the canvas. The notebook is JupyterLite (Python in the browser through WebAssembly) in an
// iframe served from this machine, see docs/NOTEBOOKS.md. The panel stays mounted when it is hidden, so the kernel and
// its variables survive. Two things connect it to the diagram, both through the bridge (notebook/protocol.ts):
// "Diagram this notebook" draws the flow of data of the notebook that is open (without downloading it), and
// "Send diagram to notebook" adds a cell with the diagram as pandas tables.
import { useCallback, useEffect, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { buildIndex } from "../agent/canvas";
import { EVENTS } from "../branding";
import { importInfra } from "../infra/detect";
import { layoutGraph } from "../infra/graph";
import { drawBuilt, drawLayout } from "../infra/place";
import {
  jupyterLiteOrigin,
  jupyterLiteUrl,
  openNotebookSite,
} from "../notebook/liteUrl";
import { mapToSkeleton } from "../notebook/geomap";
import { clearRun, parseKernelOp, showRun, showVars } from "../notebook/live";
import {
  PROTOCOL,
  diagramToPython,
  parseReply,
  snapshotOf,
} from "../notebook/protocol";
import { diagramToCells } from "../notebook/scaffold";

import { useMobileBarOffset } from "./useMobileBarOffset";

import type { El } from "../agent/elements";
import type { Reply, Request, RunCell } from "../notebook/protocol";

const REQUEST_TIMEOUT_MS = 8000;
/** how long to wait for the site before saying how to start it */
const READY_TIMEOUT_MS = 12000;

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

type Pending = {
  resolve: (r: Reply) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export const NotebookPanel = ({
  excalidrawAPI,
}: {
  excalidrawAPI: ExcalidrawImperativeAPI;
}) => {
  useMobileBarOffset();
  const [open, setOpen] = useState(false);
  /** the iframe is created the first time the panel opens, then kept (it holds the kernel) */
  const [mounted, setMounted] = useState(false);
  const [ready, setReady] = useState(false);
  const [slow, setSlow] = useState(false);
  const [wide, setWide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(
    null,
  );
  const frame = useRef<HTMLIFrameElement>(null);
  const pending = useRef(new Map<string, Pending>());
  const origin = useRef<string>(jupyterLiteOrigin());
  const counter = useRef(0);
  /** the colours of the boxes that are lit while their cell runs, and the cells as last reported */
  const lit = useRef(
    new Map<string, { strokeColor: string; strokeWidth: number }>(),
  );
  const lastRun = useRef<RunCell[]>([]);
  /** the notebooks (kernels) that imported the `trazo` module: they get the canvas whenever it changes */
  const modules = useRef(new Set<string>());
  const pushAll = useRef<() => void>(() => undefined);
  const unlight = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** the handler of the latest render, so the one message listener never works with stale state */
  const onEvent = useRef<(reply: Reply) => void>(() => undefined);

  useEffect(() => {
    const on = () => {
      setOpen(true);
      setMounted(true);
    };
    window.addEventListener(EVENTS.openNotebook, on);
    return () => window.removeEventListener(EVENTS.openNotebook, on);
  }, []);

  // replies from the notebook: only from our iframe, only from the notebook site's origin, only well-formed ones
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== origin.current
      ) {
        return;
      }
      const reply = parseReply(event.data);
      if (!reply) {
        return;
      }
      if (reply.type === "ready") {
        setReady(true);
        return;
      }
      if (
        reply.type === "run" ||
        reply.type === "vars" ||
        reply.type === "kernel"
      ) {
        onEvent.current(reply);
        return;
      }
      const wait = pending.current.get(reply.id);
      if (wait) {
        clearTimeout(wait.timer);
        pending.current.delete(reply.id);
        if (reply.type === "error") {
          wait.reject(new Error(reply.message));
        } else {
          wait.resolve(reply);
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // a notebook that imported `trazo` gets a fresh copy of the canvas after every change (a notebook can only receive
  // messages between cells, so it reads the copy instead of asking)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const off = excalidrawAPI.onChange(() => {
      if (!modules.current.size) {
        return;
      }
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => pushAll.current(), 350);
    });
    return () => {
      off();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [excalidrawAPI]);

  // if the site never says it is ready, say how to start it
  useEffect(() => {
    if (!mounted || ready) {
      return;
    }
    const t = setTimeout(() => setSlow(true), READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [mounted, ready]);

  const ask = useCallback(
    (build: (id: string) => Request): Promise<Reply> =>
      new Promise((resolve, reject) => {
        const target = frame.current?.contentWindow;
        if (!target) {
          reject(new Error("The notebook is not open."));
          return;
        }
        counter.current += 1;
        const id = `r${counter.current}`;
        const timer = setTimeout(() => {
          pending.current.delete(id);
          reject(
            new Error(
              "The notebook did not answer. Is it still loading? Open a notebook in the panel and try again.",
            ),
          );
        }, REQUEST_TIMEOUT_MS);
        pending.current.set(id, { resolve, reject, timer });
        target.postMessage(build(id), origin.current);
      }),
    [],
  );

  const run = async (job: () => Promise<string>) => {
    setBusy(true);
    setNote(null);
    try {
      setNote({ text: await job() });
    } catch (e) {
      setNote({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  const diagramNotebook = () =>
    run(async () => {
      const reply = await ask((id) => ({
        proto: PROTOCOL,
        type: "get-notebook",
        id,
      }));
      if (reply.type !== "notebook") {
        throw new Error("Unexpected answer from the notebook.");
      }
      const { layout } = importInfra(reply.text);
      drawLayout(excalidrawAPI, layout, panelWidth());
      return `Drew the data flow of ${reply.path} (${layout.nodes.length} boxes). Ctrl+Z undoes it.`;
    });

  const sendDiagram = () =>
    run(async () => {
      const index = buildIndex(
        excalidrawAPI.getSceneElementsIncludingDeleted() as unknown as El[],
      );
      const source = diagramToPython(index);
      if (!source) {
        throw new Error("There is nothing on the canvas to send.");
      }
      const reply = await ask((id) => ({
        proto: PROTOCOL,
        type: "insert-cell",
        id,
        source,
      }));
      if (reply.type !== "inserted") {
        throw new Error("Unexpected answer from the notebook.");
      }
      return `Added a cell with ${index.nodes.size} boxes and ${index.edges.length} arrows to ${reply.path}. Run it when you want.`;
    });

  /** the pixels of the view the panel covers (while it is shown), for fitting a drawing next to it */
  const panelWidth = () =>
    open ? (frame.current?.parentElement?.offsetWidth ?? 0) + 32 : 0;

  const index = () =>
    buildIndex(
      excalidrawAPI.getSceneElementsIncludingDeleted() as unknown as El[],
    );

  /** the canvas as the `trazo` module sees it: every box and arrow, and those of the selected boxes */
  const pushState = (commId: string) => {
    const idx = index();
    const keys = new Set<string>();
    Object.keys(excalidrawAPI.getAppState().selectedElementIds).forEach(
      (id) => {
        const key = idx.nodeOf.get(id);
        if (key) {
          keys.add(key);
        }
      },
    );
    const pick = (snap: ReturnType<typeof snapshotOf>) => ({
      nodes: snap.nodes,
      edges: snap.edges,
    });
    tell(commId, {
      op: "state",
      canvas: pick(snapshotOf(idx)),
      selected: pick(snapshotOf(idx, keys)),
    });
  };

  const tell = (commId: string, data: unknown) =>
    frame.current?.contentWindow?.postMessage(
      { proto: PROTOCOL, type: "kernel-reply", commId, data } as Request,
      origin.current,
    );

  // what the notebook reports on its own: cells running, variables, and what the `trazo` Python module asks for
  pushAll.current = () => modules.current.forEach(pushState);
  onEvent.current = (reply) => {
    if (reply.type === "run") {
      showRun(excalidrawAPI, reply.cells, lastRun.current, lit.current);
      lastRun.current = reply.cells;
      // the box of a cell that just finished stays green for a moment, then goes back to its own colours
      if (unlight.current) {
        clearTimeout(unlight.current);
      }
      unlight.current = setTimeout(() => {
        if (!lastRun.current.some((c) => c.state === "running")) {
          clearRun(excalidrawAPI, lit.current);
        }
      }, 1200);
    } else if (reply.type === "vars") {
      showVars(excalidrawAPI, reply.vars);
    } else if (reply.type === "kernel") {
      const op = parseKernelOp(reply.data);
      if (op === null) {
        return;
      }
      if (typeof op === "string") {
        setNote({ text: `Python → Trazo: ${op}`, error: true });
      } else if (op.op === "draw") {
        try {
          const layout = layoutGraph(op.graph);
          drawLayout(excalidrawAPI, layout, panelWidth());
          setNote({
            text: `Python drew ${op.title ? `“${op.title}”` : "a graph"} (${
              layout.nodes.length
            } boxes). Ctrl+Z undoes it.`,
          });
        } catch (e) {
          setNote({ text: (e as Error).message, error: true });
        }
      } else if (op.op === "map") {
        try {
          drawBuilt(
            excalidrawAPI,
            (offset) => mapToSkeleton(op.map, offset),
            panelWidth(),
          );
          setNote({
            text: `Python drew ${
              op.map.title ? `“${op.map.title}”` : "a map"
            } (${op.map.shapes.length} shapes). Ctrl+Z undoes it.`,
          });
        } catch (e) {
          setNote({ text: (e as Error).message, error: true });
        }
      } else {
        // the module was imported in a notebook: send it the canvas now, and again whenever it changes
        modules.current.add(reply.commId);
        pushState(reply.commId);
      }
    }
  };

  const draftNotebook = () =>
    run(async () => {
      const cells = diagramToCells(index());
      if (!cells) {
        throw new Error(
          "There is nothing on the canvas to turn into a notebook.",
        );
      }
      let path = "";
      for (const source of cells) {
        const reply = await ask((id) => ({
          proto: PROTOCOL,
          type: "insert-cell",
          id,
          source,
        }));
        if (reply.type === "inserted") {
          path = reply.path;
        }
      }
      return `Added ${cells.length} cells to ${path}: a first draft from the diagram, with a TODO where it could not tell. Nothing was run.`;
    });

  if (!mounted) {
    return (
      <PanelButton
        onClick={() => {
          setOpen(true);
          setMounted(true);
        }}
      />
    );
  }

  return (
    <>
      {!open && <PanelButton onClick={() => setOpen(true)} />}
      <div
        style={{
          position: "fixed",
          top: 64,
          right: 16,
          bottom: "calc(72px + var(--trazo-mobile-bar-offset, 0px))",
          width: wide ? "min(1000px, 74vw)" : "min(640px, 48vw)",
          minWidth: 320,
          // above Excalidraw's own mobile bottom toolbar (--zIndex-ui-bottom: 60), or it hides behind it
          zIndex: 61,
          display: open ? "flex" : "none",
          flexDirection: "column",
          background: "var(--island-bg-color)",
          color: "var(--text-primary-color)",
          border: "1px solid var(--default-border-color, #8884)",
          borderRadius: 10,
          boxShadow: "0 4px 18px #0003",
          font: "13px system-ui, sans-serif",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 10px",
            flexWrap: "wrap",
          }}
        >
          <b style={{ flex: 1, minWidth: 90 }}>🐍 Notebook</b>
          <button
            style={{ ...ghost, padding: "3px 9px" }}
            disabled={busy || !ready}
            onClick={diagramNotebook}
            title="Draw where the data goes in the notebook that is open (reads, tables, models, files written). The notebook is only read, not run."
          >
            Diagram this notebook
          </button>
          <button
            style={{ ...ghost, padding: "3px 9px" }}
            disabled={busy || !ready}
            onClick={sendDiagram}
            title="Add a cell to the open notebook with the boxes and arrows of this diagram as pandas tables (it is not run)"
          >
            Send diagram to notebook
          </button>
          <button
            style={{ ...ghost, padding: "3px 9px" }}
            disabled={busy || !ready}
            onClick={draftNotebook}
            title="Write a first draft of a notebook from the diagram: one cell per box, in the order the data flows. Nothing is run."
          >
            Draft notebook from diagram
          </button>
          <button
            style={{ ...ghost, padding: "3px 9px" }}
            onClick={() => setWide((w) => !w)}
            title={wide ? "Make the panel narrower" : "Make the panel wider"}
          >
            ⇔
          </button>
          <button
            style={{ ...ghost, padding: "3px 9px" }}
            onClick={openNotebookSite}
            title="Open the notebook in its own tab"
          >
            ↗
          </button>
          <button
            style={{ ...ghost, padding: "3px 9px" }}
            onClick={() => setOpen(false)}
            title="Hide the panel (the notebook keeps running)"
          >
            ✕
          </button>
        </div>
        {note && (
          <div
            style={{
              padding: "0 10px 6px",
              color: note.error ? "#c92a2a" : "#888",
            }}
          >
            {note.text}
          </div>
        )}
        {slow && !ready && (
          <div style={{ padding: "0 10px 8px", color: "#888" }}>
            The notebook site does not answer at <code>{jupyterLiteUrl()}</code>
            . Build it once and start it:
            <pre style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>
              {
                "node tools/build-jupyterlite.mjs\ndocker compose --profile lite up -d"
              }
            </pre>
            (see docs/NOTEBOOKS.md)
          </div>
        )}
        <iframe
          ref={frame}
          src={jupyterLiteUrl()}
          title="Python notebook"
          // its own origin, so it cannot read Trazo's storage; it may run scripts and keep its own files
          sandbox="allow-scripts allow-same-origin allow-downloads allow-forms allow-popups allow-modals"
          style={{ flex: 1, border: "none", background: "#fff" }}
        />
      </div>
    </>
  );
};

const PanelButton = ({ onClick }: { onClick: () => void }) => (
  <button
    onClick={onClick}
    style={{
      ...btn,
      position: "fixed",
      bottom: "calc(16px + var(--trazo-mobile-bar-offset, 0px))",
      right: "calc(50% + 148px)",
      // above Excalidraw's own mobile bottom toolbar (--zIndex-ui-bottom: 60), or it hides behind it
      zIndex: 61,
      boxShadow: "0 2px 8px #0003",
    }}
    title="Python notebook next to the canvas (runs in your browser, nothing is sent anywhere)"
  >
    🐍 Notebook
  </button>
);
