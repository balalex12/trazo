import { useEffect, useRef, useState } from "react";
import {
  convertToExcalidrawElements,
  useExcalidrawAPI,
} from "@excalidraw/excalidraw";

import { EVENTS } from "../branding";
import { parseCompose } from "../infra/compose";
import { layoutCompose, layoutToSkeleton } from "../infra/layout";

const EXAMPLE = `services:
  proxy:
    image: nginx:alpine
    ports: ["80:80", "443:443"]
    depends_on: [web]
  web:
    build: ./web
    depends_on: [api]
  api:
    build: ./api
    depends_on: [db, cache, queue]
    volumes: [uploads:/data]
  worker:
    build: ./worker
    depends_on: [queue, db]
  db:
    image: postgres:16
    volumes: [pgdata:/var/lib/postgresql/data]
  cache:
    image: redis:7
  queue:
    image: rabbitmq:3
  grafana:
    image: grafana/grafana
    ports: ["3000:3000"]
    depends_on: [db]
volumes:
  pgdata:
  uploads:
`;

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "#0006",
  zIndex: 1100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const card: React.CSSProperties = {
  background: "var(--island-bg-color, #fff)",
  color: "var(--text-primary-color, #222)",
  borderRadius: 10,
  padding: 20,
  width: "min(640px, 94vw)",
  maxHeight: "90vh",
  overflow: "auto",
  font: "14px system-ui, sans-serif",
  boxShadow: "0 8px 30px #0005",
};
const area: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  height: 260,
  padding: 8,
  margin: "8px 0",
  font: "13px ui-monospace, Menlo, Consolas, monospace",
  background: "var(--input-bg-color, var(--island-bg-color))",
  color: "var(--text-primary-color)",
  border: "1px solid var(--default-border-color, #8888)",
  borderRadius: 4,
  resize: "vertical",
};
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

export const InfraDialog = () => {
  const api = useExcalidrawAPI();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const on = () => {
      setError("");
      setOpen(true);
    };
    window.addEventListener(EVENTS.openInfraImport, on);
    return () => window.removeEventListener(EVENTS.openInfraImport, on);
  }, []);

  if (!open) {
    return null;
  }

  const generate = () => {
    try {
      if (!api) {
        throw new Error("The editor is not ready yet.");
      }
      const layout = layoutCompose(parseCompose(text));
      // drop the new diagram below whatever is already on the canvas
      const live = api.getSceneElements();
      const offset = live.length
        ? {
            x: Math.min(...live.map((e) => e.x)),
            y: Math.max(...live.map((e) => e.y + e.height)) + 120,
          }
        : { x: 0, y: 0 };
      const created = convertToExcalidrawElements(
        // skeletons are plain objects; the converter validates them
        layoutToSkeleton(layout, offset) as any,
      );
      api.updateScene({
        elements: [...api.getSceneElementsIncludingDeleted(), ...created],
      });
      const [x1, y1, x2, y2] = layout.bounds;
      api.setViewport({
        target: [x1 + offset.x, y1 + offset.y, x2 + offset.x, y2 + offset.y],
        fit: "scale-down",
      } as any);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div style={overlay} onClick={() => setOpen(false)}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 6px" }}>Import infrastructure</h3>
        <div style={{ color: "#888", marginBottom: 6 }}>
          Paste a <code>docker-compose.yml</code> (or choose the file) and Trazo
          draws the architecture: services by role, published ports,
          dependencies and named volumes. It is read in your browser and nothing
          is sent anywhere. No AI involved.
        </div>
        <textarea
          style={area}
          value={text}
          spellCheck={false}
          placeholder="services:&#10;  web:&#10;    image: nginx&#10;    ports: ['80:80']"
          onChange={(e) => {
            setText(e.target.value);
            setError("");
          }}
        />
        <input
          ref={fileRef}
          type="file"
          accept=".yml,.yaml,text/yaml,text/plain"
          style={{ display: "none" }}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              setText(await f.text());
              setError("");
            }
            e.target.value = "";
          }}
        />
        {error && (
          <div
            style={{ color: "var(--color-danger, #c62828)", marginBottom: 8 }}
          >
            {error}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={btn} onClick={generate} disabled={!text.trim()}>
            Generate diagram
          </button>
          <button style={ghost} onClick={() => fileRef.current?.click()}>
            Choose file…
          </button>
          <button
            style={ghost}
            onClick={() => {
              setText(EXAMPLE);
              setError("");
            }}
          >
            Load example
          </button>
          <button style={ghost} onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
