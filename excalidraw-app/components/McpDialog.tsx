import { useEffect, useState } from "react";

import { EVENTS } from "../branding";

import {
  BUILD_COMMAND,
  claudeCodeCommand,
  claudeDesktopConfig,
  defaultFolder,
  desktopConfigPath,
  detectOs,
  folderProblem,
} from "./mcpCommands";

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
  width: "min(680px, 94vw)",
  maxHeight: "90vh",
  overflow: "auto",
  font: "14px system-ui, sans-serif",
  boxShadow: "0 8px 30px #0005",
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
const code: React.CSSProperties = {
  display: "block",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  padding: 8,
  margin: "6px 0",
  borderRadius: 6,
  background: "var(--color-surface-low, #8881)",
  font: "12px ui-monospace, Menlo, Consolas, monospace",
};
const input: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: 6,
  margin: "4px 0 6px",
  background: "var(--input-bg-color, var(--island-bg-color))",
  color: "var(--text-primary-color)",
  border: "1px solid var(--default-border-color, #8888)",
  borderRadius: 4,
  font: "13px ui-monospace, Menlo, Consolas, monospace",
};

const Copy = ({ text, disabled }: { text: string; disabled?: boolean }) => {
  const [done, setDone] = useState(false);
  return (
    <button
      style={ghost}
      disabled={disabled}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch (e) {
          /* the text is shown above: it can be selected and copied by hand */
        }
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
};

/** Step by step connection of Claude Code and Claude Desktop to the Trazo MCP server (see docs/MCP.md). */
export const McpDialog = () => {
  const os = detectOs(navigator.platform || "", navigator.userAgent || "");
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState(defaultFolder(os));
  const [client, setClient] = useState<"code" | "desktop">("code");

  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(EVENTS.openMcp, on);
    return () => window.removeEventListener(EVENTS.openMcp, on);
  }, []);

  if (!open) {
    return null;
  }
  const problem = folderProblem(folder);
  const command = problem ? "" : claudeCodeCommand(os, folder);
  const config = problem ? "" : claudeDesktopConfig(folder);

  return (
    <div style={overlay} onClick={() => setOpen(false)}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 6px" }}>Connect Claude (MCP)</h3>
        <div style={{ color: "#888", marginBottom: 10 }}>
          Lets Claude Code or Claude Desktop draw and edit Trazo diagrams as
          files in one folder, with <b>their own login</b> (no API key). The
          server runs in a container with no network and can only touch that
          folder. Nothing is sent from this page.
        </div>
        <b>1. Build it once</b> (in the Trazo folder, with Docker running)
        <code style={code}>{BUILD_COMMAND}</code>
        <Copy text={BUILD_COMMAND} />
        <div style={{ marginTop: 14 }}>
          <b>2. Choose the folder for your diagrams</b>
        </div>
        <input
          style={input}
          value={folder}
          spellCheck={false}
          onChange={(e) => setFolder(e.target.value)}
        />
        <div
          style={{
            color: problem ? "var(--color-danger, #c62828)" : "#888",
            fontSize: 12,
          }}
        >
          {problem ||
            "Use a folder made for this: the server can read and write the files in it."}
        </div>
        <div style={{ marginTop: 14 }}>
          <b>3. Connect your client</b>{" "}
          <select
            value={client}
            onChange={(e) => setClient(e.target.value as "code" | "desktop")}
            style={{ marginLeft: 6 }}
          >
            <option value="code">Claude Code</option>
            <option value="desktop">Claude Desktop</option>
          </select>
        </div>
        {client === "code" ? (
          <>
            <code style={code}>{command || "…"}</code>
            <Copy text={command} disabled={!!problem} />
            <div style={{ color: "#888", fontSize: 12, marginTop: 6 }}>
              Run it in a terminal, then open a <b>new</b> Claude Code session
              and type <code>/mcp</code>.
              {os === "windows" &&
                " On Windows PowerShell it must be claude.cmd (as shown): plain claude loses the -- and fails with “unknown option '-i'”."}
            </div>
          </>
        ) : (
          <>
            <div style={{ color: "#888", fontSize: 12, marginTop: 4 }}>
              Add this to <code>{desktopConfigPath(os)}</code> (Claude Desktop →
              Settings → Developer → Edit config), then quit Claude Desktop
              completely and open it again.
            </div>
            <code style={code}>{config || "…"}</code>
            <Copy text={config} disabled={!!problem} />
          </>
        )}
        <div style={{ color: "#888", fontSize: 12, margin: "14px 0 10px" }}>
          Then ask, for example: “Use Trazo to draw the architecture of this
          docker-compose.yml”. Open the files it writes with Menu → Open. More
          in docs/MCP.md.
        </div>
        <button style={ghost} onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
    </div>
  );
};
