import { useEffect, useState } from "react";

import { BRAND, EVENTS } from "../branding";
import { PRESETS, listModels, loadLLMConfig, saveLLMConfig, testConnection } from "../ai/llm";

import type { LLMConfig } from "../ai/llm";

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, background: "#0006", zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center",
};
const card: React.CSSProperties = {
  background: "var(--island-bg-color, #fff)", color: "var(--text-primary-color, #222)", borderRadius: 10, padding: 20,
  width: "min(560px, 92vw)", maxHeight: "86vh", overflow: "auto", font: "14px system-ui, sans-serif", boxShadow: "0 8px 30px #0005",
};
const field: React.CSSProperties = { width: "100%", padding: 6, boxSizing: "border-box", margin: "4px 0 10px" };
const btn: React.CSSProperties = { padding: "7px 12px", border: "1px solid #6965db", background: "#6965db", color: "#fff", borderRadius: 6, cursor: "pointer" };
const ghost: React.CSSProperties = { ...btn, background: "transparent", color: "#6965db" };

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
  ["Excalidraw", `${BRAND.upstream.license} — ${BRAND.upstream.copyright}. This project is built on Excalidraw (${BRAND.upstream.url}).`],
  ["Esri ArcGIS Architecture Center icons", "CC BY 4.0 — © Esri. Converted from the official Visio toolkit to SVG."],
  ["Esri Calcite UI icons", "Esri Master License Agreement — © Esri. Downloaded at build time, not redistributed."],
  ["ArcGIS Maps SDK for JavaScript", "© Esri, loaded at runtime from Esri's CDN only when a map is used."],
  ["mp4-muxer", "MIT — Vanilagy. MP4 export."],
  ["gifenc", "MIT — Matt DesLauriers. GIF export."],
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
          <b>Local-first.</b> Your diagrams stay in this browser. The app makes no analytics or telemetry requests. It only
          contacts ArcGIS portals you add, the LLM you configure, and — if you click “Browse libraries” — the community
          libraries site.
        </p>
        <b>Credits &amp; licenses</b>
        <ul style={{ paddingLeft: 18 }}>
          {CREDITS.map(([n, d]) => (
            <li key={n}><b>{n}</b> — {d}</li>
          ))}
        </ul>
        <p style={{ color: "#888", fontSize: 12 }}>
          Not affiliated with or endorsed by Excalidraw or Esri. “Esri” and “ArcGIS” are trademarks of Esri.
          {BRAND.repoUrl && (<> · <a href={BRAND.repoUrl} target="_blank" rel="noopener noreferrer">Source code</a></>)}
        </p>
        <button style={btn} onClick={() => setOpen(false)}>Close</button>
      </div>
    </div>
  );
};

const AISettingsDialog = () => {
  const [open, setOpen] = useOpen(EVENTS.openAISettings);
  const [cfg, setCfg] = useState<LLMConfig>(loadLLMConfig);
  const [status, setStatus] = useState("");
  const [models, setModels] = useState<string[]>([]);
  useEffect(() => {
    if (open) {
      setCfg(loadLLMConfig());
      setStatus("");
      setModels([]);
    }
  }, [open]);
  if (!open) {
    return null;
  }
  const set = (patch: Partial<LLMConfig>) => setCfg({ ...cfg, ...patch });
  const save = () => {
    saveLLMConfig(cfg);
    setStatus("Saved.");
  };
  return (
    <div style={overlay} onClick={() => setOpen(false)}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: "0 0 4px" }}>AI assistant (optional)</h2>
        <div style={{ color: "#888", marginBottom: 12 }}>
          Connect your own LLM for “Text to diagram” (menu → Text to diagram). Off by default: nothing is sent until you
          configure it. The key stays in this browser and is only sent to the URL below.
        </div>
        <label>Preset
          <select style={field} value="" onChange={(e) => e.target.value && setCfg(PRESETS[e.target.value].config)}>
            <option value="">— choose to fill the fields —</option>
            {Object.entries(PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
          </select>
        </label>
        <label>Provider
          <select style={field} value={cfg.provider} onChange={(e) => set({ provider: e.target.value as any })}>
            <option value="off">Off</option>
            <option value="openai">OpenAI-compatible (Ollama, LM Studio, vLLM, OpenAI…)</option>
            <option value="anthropic">Anthropic (Claude)</option>
          </select>
        </label>
        <label>Base URL<input style={field} value={cfg.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="http://localhost:11434/v1" /></label>
        <label>Model
          <div style={{ display: "flex", gap: 6 }}>
            <input style={{ ...field, flex: 1 }} list="llm-models" value={cfg.model} onChange={(e) => set({ model: e.target.value })} placeholder="llama3.1" />
            <button
              style={{ ...ghost, margin: "4px 0 10px", whiteSpace: "nowrap" }}
              onClick={async () => {
                setStatus("Loading models…");
                try { const m = await listModels(cfg); setModels(m); setStatus(`${m.length} models available — pick one from the field.`); }
                catch (e: any) { setStatus(e.message); }
              }}
            >Load models</button>
          </div>
          <datalist id="llm-models">{models.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        <label>API key (leave empty for local servers)<input style={field} type="password" value={cfg.apiKey} onChange={(e) => set({ apiKey: e.target.value })} autoComplete="off" /></label>
        {cfg.baseUrl.includes("/llm/ollama-cloud") && (
          <div style={{ background: "#6965db18", padding: 8, borderRadius: 6, fontSize: 12, marginBottom: 10 }}>
            <b>Ollama Cloud.</b> Create an API key at <code>ollama.com/settings/keys</code> (copy it here). Your prompts are sent
            to <b>ollama.com</b> through this app's local server (<code>/llm/ollama-cloud</code>); the key is stored only in this
            browser. Use <i>Load models</i> to see the cloud models available to you.
          </div>
        )}
        <div style={{ color: "#888", fontSize: 12, marginBottom: 10 }}>
          Ollama needs <code>OLLAMA_ORIGINS={location.origin}</code> to accept requests from this page. Remote providers also
          need their host allowed in the app's Content-Security-Policy (see docs/SECURITY.md).
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={btn} onClick={save}>Save</button>
          <button style={ghost} onClick={async () => { saveLLMConfig(cfg); setStatus("Testing…"); setStatus(await testConnection()); }}>Save &amp; test</button>
          <button style={ghost} onClick={() => setOpen(false)}>Close</button>
        </div>
        {status && <div style={{ marginTop: 10 }}>{status}</div>}
      </div>
    </div>
  );
};

export const BrandDialogs = () => (
  <>
    <AboutDialog />
    <AISettingsDialog />
  </>
);
