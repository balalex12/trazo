import { useEffect, useState } from "react";

import { BRAND, EVENTS } from "../branding";
import {
  OFF,
  PRESETS,
  checkBridge,
  getActiveProfileId,
  hasSavedProfile,
  listModels,
  loadProfile,
  pairBridge,
  parsePairingHash,
  saveProfile,
  setActiveProfile,
  testConnection,
} from "../ai/llm";

import type { LLMConfig, ProfileId } from "../ai/llm";

const NOTICE_KEY = "trazo-ai-notice";

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
  width: "min(560px, 92vw)",
  maxHeight: "86vh",
  overflow: "auto",
  font: "14px system-ui, sans-serif",
  boxShadow: "0 8px 30px #0005",
};
const field: React.CSSProperties = {
  width: "100%",
  padding: 6,
  boxSizing: "border-box",
  margin: "4px 0 10px",
  background: "var(--input-bg-color, var(--island-bg-color))",
  color: "var(--text-primary-color)",
  border: "1px solid var(--default-border-color, #8888)",
  borderRadius: 4,
};
const btn: React.CSSProperties = {
  padding: "7px 12px",
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

const useOpen = (event: string) => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(event, on);
    return () => window.removeEventListener(event, on);
  }, [event]);
  return [open, setOpen] as const;
};

const CREDITS: [string, string][] = [
  [
    "Excalidraw",
    `${BRAND.upstream.license}, ${BRAND.upstream.copyright}. This project is built on Excalidraw (${BRAND.upstream.url}).`,
  ],
  [
    "Esri ArcGIS Architecture Center icons",
    "CC BY 4.0, © Esri. Converted from the official Visio toolkit to SVG.",
  ],
  [
    "Esri Calcite UI icons",
    "Esri Master License Agreement, © Esri. Downloaded at build time, not redistributed.",
  ],
  [
    "ArcGIS Maps SDK for JavaScript",
    "© Esri, loaded at runtime from Esri's CDN only when a map is used.",
  ],
  ["mp4-muxer", "MIT, Vanilagy. MP4 export."],
  ["gifenc", "MIT, Matt DesLauriers. GIF export."],
];

const AboutDialog = () => {
  const [open, setOpen] = useOpen(EVENTS.openAbout);
  if (!open) {
    return null;
  }
  return (
    <div style={overlay} onClick={() => setOpen(false)}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: "0 0 4px" }}>{BRAND.name}</h2>
        <div style={{ color: "#888", marginBottom: 12 }}>{BRAND.tagline}</div>
        <p>
          <b>Local-first.</b> Your diagrams stay in this browser. The app makes
          no analytics or telemetry requests. It only contacts ArcGIS portals
          you add, the LLM you configure, and, if you click “Browse libraries”,
          the community libraries site.
        </p>
        <b>Credits &amp; licenses</b>
        <ul style={{ paddingLeft: 18 }}>
          {CREDITS.map(([n, d]) => (
            <li key={n}>
              <b>{n}</b>: {d}
            </li>
          ))}
        </ul>
        <p style={{ color: "#888", fontSize: 12 }}>
          Not affiliated with or endorsed by Excalidraw or Esri. “Esri” and
          “ArcGIS” are trademarks of Esri.
          {BRAND.repoUrl && (
            <>
              {" "}
              ·{" "}
              <a href={BRAND.repoUrl} target="_blank" rel="noopener noreferrer">
                Source code
              </a>
            </>
          )}
        </p>
        <button style={btn} onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
    </div>
  );
};

const AISettingsDialog = () => {
  const [open, setOpen] = useOpen(EVENTS.openAISettings);
  const [profile, setProfile] = useState<ProfileId | "off">("off");
  const [cfg, setCfg] = useState<LLMConfig>(OFF);
  const [status, setStatus] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const show = (id: ProfileId | "off") => {
    setProfile(id);
    setCfg(id === "off" ? OFF : loadProfile(id));
    setModels([]);
  };
  useEffect(() => {
    if (open) {
      show(getActiveProfileId());
      // a pairing link leaves a message for this dialog to show once
      let notice = "";
      try {
        notice = sessionStorage.getItem(NOTICE_KEY) || "";
        sessionStorage.removeItem(NOTICE_KEY);
      } catch (e) {
        /* ignore */
      }
      setStatus(notice);
    }
  }, [open]);
  if (!open) {
    return null;
  }
  const set = (patch: Partial<LLMConfig>) => setCfg({ ...cfg, ...patch });
  const persist = () => {
    if (profile === "off") {
      setActiveProfile("off");
    } else {
      saveProfile(profile, cfg);
    }
  };
  const save = () => {
    persist();
    setStatus(
      profile === "off" ? "Saved. The assistant is off." : "Saved and active.",
    );
  };
  const connection = (
    <>
      <label>
        Connection
        <select
          style={field}
          value={profile}
          onChange={(e) => {
            show(e.target.value as ProfileId | "off");
            setStatus("");
          }}
        >
          <option value="off">Off (nothing is sent)</option>
          {(Object.keys(PRESETS) as ProfileId[]).map((k) => (
            <option key={k} value={k}>
              {PRESETS[k].label}
              {hasSavedProfile(k) ? " ✔ saved" : ""}
            </option>
          ))}
        </select>
      </label>
      <div style={{ color: "#888", fontSize: 12, margin: "-4px 0 10px" }}>
        Each connection keeps its own settings (address, model, key), so trying
        another one never erases the first. <b>Save</b> makes the one shown here
        the active one.
      </div>
    </>
  );
  if (profile === "off") {
    return (
      <div style={overlay} onClick={() => setOpen(false)}>
        <div style={card} onClick={(e) => e.stopPropagation()}>
          <h2 style={{ margin: "0 0 4px" }}>AI assistant (optional)</h2>
          <div style={{ color: "#888", marginBottom: 12 }}>
            Off by default: nothing is sent anywhere. Pick a connection to use
            your own LLM in “Text to diagram”.
          </div>
          {connection}
          <div style={{ display: "flex", gap: 8 }}>
            <button style={btn} onClick={save}>
              Save
            </button>
            <button style={ghost} onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          {status && <div style={{ marginTop: 10 }}>{status}</div>}
        </div>
      </div>
    );
  }
  return (
    <div style={overlay} onClick={() => setOpen(false)}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: "0 0 4px" }}>AI assistant (optional)</h2>
        <div style={{ color: "#888", marginBottom: 12 }}>
          Connect your own LLM for “Text to diagram” (menu → Text to diagram).
          Off by default: nothing is sent until you configure it. The key stays
          in this browser and is only sent to the URL below.
        </div>
        {connection}
        {cfg.provider === "cli" && (
          <div
            style={{
              background:
                "color-mix(in srgb, var(--color-primary) 14%, transparent)",
              padding: 8,
              borderRadius: 6,
              fontSize: 12,
              marginBottom: 10,
            }}
          >
            <b>Experimental and advanced, off until you turn it on.</b> It needs
            Node.js on this computer (the bridge is a Node script). Uses the{" "}
            <code>claude</code> or <code>codex</code> command you already have
            installed and signed in to. Easiest: run{" "}
            <code>node tools/cli-bridge.mjs --install</code> once. It starts the
            bridge by itself at every login (hidden, no terminal to keep open)
            and opens Trazo with a link that fills in the token for you. Then
            tick the box. Trazo never sees your login: the CLI keeps it. The CLI
            runs with no tools, in an empty folder, and your diagram text goes
            to that provider like in its own app. Check that your plan allows
            this use (see docs/CLI_BRIDGE.md).
            <label
              style={{
                display: "flex",
                gap: 6,
                alignItems: "center",
                marginTop: 6,
              }}
            >
              <input
                type="checkbox"
                checked={!!cfg.cliAck}
                onChange={(e) => set({ cliAck: e.target.checked })}
              />
              I understand and want to use my own Claude Code or Codex through
              the local bridge.
            </label>
            <button
              style={{ ...ghost, marginTop: 8 }}
              onClick={async () => {
                setStatus("Looking for the bridge…");
                try {
                  const r = await checkBridge(cfg);
                  const found = Object.entries(r.tools)
                    .map(([name, ok]) => `${name} ${ok ? "✔" : "not found"}`)
                    .join(", ");
                  const token =
                    r.tokenOk === undefined
                      ? "No token yet: open the link the bridge prints (node tools/cli-bridge.mjs --link --open)."
                      : r.tokenOk
                      ? "The token is accepted."
                      : "The token is wrong or old: open the pairing link again (node tools/cli-bridge.mjs --link --open).";
                  setStatus(`Bridge found. ${found}. ${token}`);
                } catch (e: any) {
                  setStatus(e.message);
                }
              }}
            >
              Detect the bridge
            </button>
          </div>
        )}
        <label>
          Base URL
          <input
            style={field}
            value={cfg.baseUrl}
            onChange={(e) => set({ baseUrl: e.target.value })}
            placeholder="http://localhost:11434/v1"
          />
        </label>
        <label>
          Model
          <div style={{ display: "flex", gap: 6 }}>
            <input
              style={{ ...field, flex: 1 }}
              list="llm-models"
              value={cfg.model}
              onChange={(e) => set({ model: e.target.value })}
              placeholder={
                cfg.provider === "cli" ? "claude or codex" : "llama3.1"
              }
            />
            <button
              style={{ ...ghost, margin: "4px 0 10px", whiteSpace: "nowrap" }}
              onClick={async () => {
                setStatus("Loading models…");
                try {
                  const m = await listModels(cfg);
                  setModels(m);
                  setStatus(
                    `${m.length} models available. Pick one from the field.`,
                  );
                } catch (e: any) {
                  setStatus(e.message);
                }
              }}
            >
              Load models
            </button>
          </div>
          <datalist id="llm-models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <label>
          {cfg.provider === "cli"
            ? "Bridge token (printed by the bridge)"
            : "API key (leave empty for local servers)"}
          <input
            style={field}
            type="password"
            value={cfg.apiKey}
            onChange={(e) => set({ apiKey: e.target.value })}
            autoComplete="off"
          />
        </label>
        {cfg.baseUrl.includes("/llm/ollama-cloud") && (
          <div
            style={{
              background:
                "color-mix(in srgb, var(--color-primary) 14%, transparent)",
              padding: 8,
              borderRadius: 6,
              fontSize: 12,
              marginBottom: 10,
            }}
          >
            <b>Ollama Cloud.</b> Create an API key at{" "}
            <code>ollama.com/settings/keys</code> (copy it here). Your prompts
            are sent to <b>ollama.com</b> through this app's local server (
            <code>/llm/ollama-cloud</code>); the key is stored only in this
            browser. Use <i>Load models</i> to see the cloud models available to
            you.
          </div>
        )}
        {cfg.provider !== "cli" && (
          <div style={{ color: "#888", fontSize: 12, marginBottom: 10 }}>
            Ollama needs <code>OLLAMA_ORIGINS={location.origin}</code> to accept
            requests from this page. Remote providers also need their host
            allowed in the app's Content-Security-Policy (see docs/SECURITY.md).
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button style={btn} onClick={save}>
            Save
          </button>
          <button
            style={ghost}
            onClick={async () => {
              persist();
              setStatus("Testing…");
              setStatus(await testConnection());
            }}
          >
            Save &amp; test
          </button>
          <button style={ghost} onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
        {status && <div style={{ marginTop: 10 }}>{status}</div>}
      </div>
    </div>
  );
};

/**
 * Opens from the link the CLI bridge prints: Trazo reads the token from the part after # (it never goes to a server),
 * stores it in the CLI connection, clears the address bar and opens the settings so you only tick the box.
 */
const BridgePairing = () => {
  useEffect(() => {
    // on load, and when the link is opened in a tab that already has Trazo (only the part after # changes)
    const run = () => {
      const pair = parsePairingHash(window.location.hash);
      if (!pair) {
        return;
      }
      pairBridge(pair.token, pair.url);
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
      try {
        sessionStorage.setItem(
          NOTICE_KEY,
          "Paired with the bridge. Tick the box to turn it on, then press Save & test.",
        );
      } catch (e) {
        /* ignore */
      }
      setTimeout(
        () => window.dispatchEvent(new Event(EVENTS.openAISettings)),
        0,
      );
    };
    run();
    window.addEventListener("hashchange", run);
    return () => window.removeEventListener("hashchange", run);
  }, []);
  return null;
};

export const BrandDialogs = () => (
  <>
    <AboutDialog />
    <AISettingsDialog />
    <BridgePairing />
  </>
);
