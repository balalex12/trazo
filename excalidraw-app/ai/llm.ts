// Opt-in LLM connector for "Text to diagram". Nothing is sent anywhere until the user configures a
// provider (default: off). Works with any OpenAI-compatible server (Ollama, LM Studio, llama.cpp,
// vLLM, OpenAI, ...) and with the Anthropic Messages API. The API key stays in this browser's
// localStorage and is only sent to the base URL configured here.
import { RequestError } from "@excalidraw/excalidraw/errors";

import type { TTTDDialog } from "@excalidraw/excalidraw/components/TTDDialog/types";

export type LLMProvider = "off" | "openai" | "anthropic" | "cli";
export type LLMConfig = {
  provider: LLMProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** "cli" only: the user confirmed they understand what the bridge does (see docs/CLI_BRIDGE.md) */
  cliAck?: boolean;
};

export type ProfileId =
  | "ollama"
  | "ollamacloud"
  | "lmstudio"
  | "openai"
  | "cli"
  | "anthropic";

export const PRESETS: Record<ProfileId, { label: string; config: LLMConfig }> =
  {
    ollama: {
      label: "Ollama (local)",
      config: {
        provider: "openai",
        baseUrl: "http://localhost:11434/v1",
        model: "llama3.1",
        apiKey: "",
      },
    },
    // Ollama Cloud (https://ollama.com): browsers cannot call it directly (no CORS), so the app's nginx forwards
    // /llm/ollama-cloud/* to ollama.com (deploy/nginx/app.conf). The API key (ollama.com/settings/keys) stays in the browser.
    ollamacloud: {
      label: "Ollama Cloud (ollama.com)",
      config: {
        provider: "openai",
        baseUrl: "/llm/ollama-cloud/v1",
        model: "gpt-oss:120b",
        apiKey: "",
      },
    },
    lmstudio: {
      label: "LM Studio (local)",
      config: {
        provider: "openai",
        baseUrl: "http://localhost:1234/v1",
        model: "",
        apiKey: "",
      },
    },
    openai: {
      label: "OpenAI-compatible (custom URL)",
      config: {
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        model: "",
        apiKey: "",
      },
    },
    // Advanced and opt-in: the Claude Code or Codex CLI the user already has, through a small local bridge they start
    // themselves (tools/cli-bridge.mjs). The "key" here is the bridge's random token, not a provider credential.
    cli: {
      label: "Your own Claude Code or Codex (experimental, advanced)",
      config: {
        provider: "cli",
        baseUrl: "http://127.0.0.1:11500",
        model: "claude",
        apiKey: "",
        cliAck: false,
      },
    },
    anthropic: {
      label: "Anthropic (Claude)",
      config: {
        provider: "anthropic",
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-5-5",
        apiKey: "",
      },
    },
  };

const LEGACY_KEY = "app-llm-config";
const STORE_KEY = "app-llm-profiles";
export const OFF: LLMConfig = {
  provider: "off",
  baseUrl: "",
  model: "",
  apiKey: "",
};

/**
 * Every connection keeps its own settings (URL, model, key), so trying another one never wipes the first.
 * `active` says which one is in use; "off" keeps all of them and uses none.
 */
type Store = {
  active: ProfileId | "off";
  profiles: Partial<Record<ProfileId, LLMConfig>>;
};

/** which connection a configuration belongs to, from what it points at */
export const profileIdFor = (c: LLMConfig): ProfileId => {
  if (c.provider === "cli") {
    return "cli";
  }
  if (c.provider === "anthropic") {
    return "anthropic";
  }
  if (c.baseUrl.includes("/llm/ollama-cloud")) {
    return "ollamacloud";
  }
  if (c.baseUrl.includes(":11434")) {
    return "ollama";
  }
  if (c.baseUrl.includes(":1234")) {
    return "lmstudio";
  }
  return "openai";
};

const readStore = (): Store => {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && typeof s === "object" && s.profiles) {
        return { active: s.active || "off", profiles: s.profiles };
      }
    }
    // first run after the update: keep what the single old setting held
    const old = {
      ...OFF,
      ...JSON.parse(localStorage.getItem(LEGACY_KEY) || "{}"),
    };
    if (old.provider !== "off" && old.baseUrl) {
      const id = profileIdFor(old);
      return { active: id, profiles: { [id]: old } };
    }
  } catch (e) {
    /* unreadable: start empty */
  }
  return { active: "off", profiles: {} };
};

const writeStore = (s: Store) => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(s));
  } catch (e) {
    /* ignore */
  }
};

export const getActiveProfileId = (): ProfileId | "off" => readStore().active;

/** the saved settings of a connection, or the preset's defaults when it was never saved */
export const loadProfile = (id: ProfileId): LLMConfig => ({
  ...PRESETS[id].config,
  ...readStore().profiles[id],
});

export const hasSavedProfile = (id: ProfileId): boolean =>
  !!readStore().profiles[id];

/** saves the settings of one connection and makes it the active one */
export const saveProfile = (id: ProfileId, c: LLMConfig) => {
  const s = readStore();
  writeStore({ active: id, profiles: { ...s.profiles, [id]: c } });
};

export const setActiveProfile = (id: ProfileId | "off") => {
  const s = readStore();
  writeStore({ ...s, active: id });
};

/** the settings in use right now (what "Text to diagram" calls) */
export const loadLLMConfig = (): LLMConfig => {
  const s = readStore();
  return s.active === "off" ? OFF : loadProfile(s.active);
};

export const saveLLMConfig = (c: LLMConfig) => {
  if (c.provider === "off") {
    setActiveProfile("off");
  } else {
    saveProfile(profileIdFor(c), c);
  }
};

// ---- pairing with the CLI bridge ------------------------------------------------------------------------------------

/** the token (and the address, when it is not the default) from a link like #bridge=TOKEN&url=... */
export const parsePairingHash = (
  hash: string,
): { token: string; url?: string } | null => {
  const p = new URLSearchParams(hash.replace(/^#/, ""));
  const token = p.get("bridge") || "";
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
    return null;
  }
  let url: string | undefined;
  const raw = p.get("url");
  if (raw) {
    try {
      const u = new URL(raw);
      // only this computer: a link must never point the token at some other host
      if (
        u.protocol === "http:" &&
        (u.hostname === "127.0.0.1" || u.hostname === "localhost")
      ) {
        url = u.origin;
      } else {
        return null;
      }
    } catch (e) {
      return null;
    }
  }
  return { token, url };
};

/** stores the token in the CLI connection and makes it active; the user still has to tick the confirmation box */
export const pairBridge = (token: string, url?: string) => {
  const prev = loadProfile("cli");
  saveProfile("cli", {
    ...prev,
    baseUrl: url || prev.baseUrl || PRESETS.cli.config.baseUrl,
    apiKey: token,
  });
};

export type BridgeCheck = {
  /** which CLIs the bridge found on this computer */
  tools: Record<string, boolean>;
  /** undefined when no token was given to check; otherwise whether the bridge accepted it */
  tokenOk?: boolean;
};

/** Is a bridge there (no token needed), and does it accept the token we have? */
export const checkBridge = async (cfg: LLMConfig): Promise<BridgeCheck> => {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  let hello: Response;
  try {
    hello = await fetch(`${base}/hello`);
  } catch (e) {
    throw new Error(
      `No bridge answered at ${base}. Is it installed or running? (node tools/cli-bridge.mjs --install)`,
    );
  }
  if (hello.status === 403) {
    throw new Error(
      `A bridge is there but it does not allow ${location.origin}. Start it with --origin ${location.origin}.`,
    );
  }
  const j = await hello.json().catch(() => null);
  if (!j?.bridge) {
    throw new Error(
      `Something answered at ${base}, but it is not the Trazo bridge.`,
    );
  }
  if (!cfg.apiKey) {
    return { tools: j.tools || {} };
  }
  const health = await fetch(`${base}/health`, {
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
  }).catch(() => null);
  return { tools: j.tools || {}, tokenOk: health?.ok === true };
};

/** what the last bridge answer said about itself, for the "Save & test" message */
let lastCliMeta: { tool?: string; model?: string; costUsd?: number } | null =
  null;
export const getLastCliMeta = () => lastCliMeta;

export const SYSTEM_PROMPT = `You turn a description into a diagram written in Mermaid syntax.
Rules:
- Output ONLY Mermaid code. No explanations, no markdown fences.
- Choose the best type: flowchart (architecture, data pipelines, ETL, ML pipelines, GIS workflows),
  sequenceDiagram (interactions between systems), classDiagram (models), erDiagram (database / data models).
- Prefer "flowchart LR" or "flowchart TD" with short, clear node labels and subgraphs for layers or tiers.
- Use only syntax valid in Mermaid v10. Keep node ids simple (letters/digits).

Styling for flowcharts (rendered as hand-drawn shapes; only the styles below are honoured):
- Define 3-6 classes with classDef using hex fill and stroke, and assign EVERY node with ":::class".
  Palette (fill/stroke): green #d3f9d8/#2f9e44 (users, clients), blue #d0ebff/#1971c2 (gateways, edge, apps),
  purple #e5dbff/#6741d9 (core services, compute), yellow #ffec99/#f08c00 (data stores),
  red #ffe3e3/#e03131 (security, risks, alerts), gray #f1f3f5/#868e96 (external, optional),
  teal #c3fae8/#0ca678 (analytics, ML).
- Start node labels with one relevant emoji as a symbol: 👤 users, 🌐 web/gateway, 🖥️ servers, 🗄️ databases,
  ☁️ cloud, 🔒 security, 📊 analytics, 🤖 ML, 🗺️ maps/GIS, 📡 sensors/streams, ⚙️ jobs.
- Group layers with subgraph and style the group: style G fill:#f8f9fa,stroke:#868e96,stroke-dasharray:5 5
- Use ==> for the main flow and -.-> for optional/async flows; label important edges: A -->|text| B
- Do NOT use link colors, text colors, or cylinder/hexagon shapes (they are not rendered). Rounded ([ ]), ( ),
  diamonds { } and circles (( )) are fine. Keep labels short.`;

/**
 * LLMs often wrap code in ```mermaid fences despite instructions. Strip them from the raw text; while
 * streaming (final=false) also hold back a trailing partial fence so the preview never sees backticks.
 */
const unfence = (raw: string, final: boolean) => {
  const t = raw.replace(/^\s*```[a-zA-Z]*[ \t]*\n?/, "");
  return final
    ? t.replace(/\n?```\s*$/, "").trim()
    : t.replace(/\n?`{0,3}$/, "");
};

type Ret = TTTDDialog.OnTextSubmitRetValue;

const fail = (message: string, status = 500): Ret => ({
  error: new RequestError({ message, status }),
  generatedResponse: null,
});

/** Reads an SSE response and calls `onData` with each `data:` payload. */
async function readSSE(
  res: Response,
  onData: (data: string) => void,
  signal?: AbortSignal,
) {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("The LLM server returned no stream.");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    if (signal?.aborted) {
      await reader.cancel();
      return;
    }
    const { done, value } = await reader.read();
    if (done) {
      return;
    }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data:")) {
        onData(line.slice(5).trim());
      }
    }
  }
}

/** Asks the local CLI bridge (tools/cli-bridge.mjs) to run the user's own Claude Code or Codex. One JSON answer. */
const runViaBridge = async (
  cfg: LLMConfig,
  props: TTTDDialog.OnTextSubmitProps,
  system: string,
): Promise<Ret> => {
  if (!cfg.cliAck) {
    return fail(
      "Tick the box in AI assistant settings to confirm you want to use your own Claude Code or Codex through the local bridge.",
      400,
    );
  }
  const base = cfg.baseUrl.replace(/\/+$/, "");
  let res: Response;
  try {
    res = await fetch(`${base}/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        tool: cfg.model || "claude",
        system,
        messages: props.messages,
      }),
      signal: props.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      return fail("Cancelled", 499);
    }
    return fail(
      `Could not reach the CLI bridge at ${base}. Start it with: node tools/cli-bridge.mjs (and check that ${location.origin} is one of its allowed origins).`,
      0,
    );
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return fail(
      res.status === 401
        ? "The bridge token is missing or wrong. Copy it again from the terminal where the bridge is running."
        : `CLI bridge: ${data?.error || `HTTP ${res.status}`}`,
      res.status,
    );
  }
  props.onStreamCreated?.();
  lastCliMeta = {
    tool: data.tool,
    model: data.model,
    costUsd: typeof data.costUsd === "number" ? data.costUsd : undefined,
  };
  const text = unfence(String(data.text || ""), true);
  if (!text) {
    return fail("The CLI returned an empty answer.", 502);
  }
  props.onChunk?.(text);
  return { generatedResponse: text, error: null };
};

/**
 * `opts.system` replaces the Mermaid instructions, so other features (the agent panel) can use the same connection.
 */
export const streamChat = async (
  props: TTTDDialog.OnTextSubmitProps,
  opts: { system?: string } = {},
): Promise<Ret> => {
  const system = opts.system ?? SYSTEM_PROMPT;
  const cfg = loadLLMConfig();
  if (cfg.provider === "off" || !cfg.baseUrl) {
    return fail(
      "The AI assistant is off. Open the menu → “AI assistant settings” and connect your own LLM (for example Ollama, running locally).",
      400,
    );
  }
  lastCliMeta = null;
  if (cfg.provider === "cli") {
    return runViaBridge(cfg, props, system);
  }
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const isClaude = cfg.provider === "anthropic";
  const url = isClaude ? `${base}/v1/messages` : `${base}/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (isClaude) {
    headers["x-api-key"] = cfg.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true"; // required for calls made from a browser
  } else if (cfg.apiKey) {
    headers.Authorization = `Bearer ${cfg.apiKey}`;
  }
  const body = isClaude
    ? {
        model: cfg.model,
        max_tokens: 4096,
        system,
        messages: props.messages,
        stream: true,
      }
    : {
        model: cfg.model,
        temperature: 0.2,
        stream: true,
        messages: [{ role: "system", content: system }, ...props.messages],
      };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: props.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      return fail("Cancelled", 499);
    }
    return fail(
      `Could not reach the LLM at ${base}. Is it running, and does it allow requests from ${location.origin} (CORS)? For Ollama start it with OLLAMA_ORIGINS=${location.origin}.`,
      0,
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const hint =
      res.status === 401 || res.status === 403
        ? ": the API key is missing or invalid."
        : "";
    return fail(
      `LLM error ${res.status}${hint} ${text.slice(0, 300)}`,
      res.status,
    );
  }

  props.onStreamCreated?.();
  let out = "";
  let emitted = 0;
  try {
    await readSSE(
      res,
      (data) => {
        if (data === "[DONE]") {
          return;
        }
        try {
          const j = JSON.parse(data);
          const delta = isClaude
            ? (j.type === "content_block_delta" ? j.delta?.text : "") || ""
            : j.choices?.[0]?.delta?.content || "";
          if (delta) {
            out += delta;
            const visible = unfence(out, false);
            if (visible.length > emitted) {
              props.onChunk?.(visible.slice(emitted));
              emitted = visible.length;
            }
          }
        } catch (e) {
          /* ignore keep-alive / partial lines */
        }
      },
      props.signal,
    );
  } catch (e: any) {
    return fail(e?.message || "The LLM stream failed.", 500);
  }
  const cleaned = unfence(out, true);
  if (cleaned.length > emitted) {
    props.onChunk?.(cleaned.slice(emitted));
  }
  return cleaned
    ? { generatedResponse: cleaned, error: null }
    : fail("The LLM returned an empty answer.", 502);
};

/** One question to the connection in use, with your own instructions; the whole answer at once. */
export const askModel = async (
  system: string,
  messages: TTTDDialog.OnTextSubmitProps["messages"],
  signal?: AbortSignal,
): Promise<{ text: string; error?: string }> => {
  const r = await streamChat({ messages, signal }, { system });
  return r.error
    ? { text: "", error: r.error.message }
    : { text: r.generatedResponse ?? "" };
};

/** Which connection is in use and whether what you type stays on this computer (for a privacy line in the UI). */
export const describeConnection = (): {
  active: ProfileId | "off";
  label: string;
  local: boolean;
} => {
  const cfg = loadLLMConfig();
  const active = getActiveProfileId();
  if (active === "off" || cfg.provider === "off") {
    return { active: "off", label: "Off", local: true };
  }
  let local = false;
  try {
    const host = new URL(cfg.baseUrl, location.origin).hostname;
    // the bridge hands the text to a cloud provider through the CLI, even though the address is local
    local =
      cfg.provider !== "cli" && (host === "localhost" || host === "127.0.0.1");
  } catch (e) {
    /* not a URL: treat as remote */
  }
  return { active, label: PRESETS[active].label, local };
};

/**
 * Lists the models the configured server offers (for the settings dialog). Tries the OpenAI-compatible
 * `GET {base}/models` first, then Ollama's native `GET {base without /v1}/api/tags` (public on Ollama Cloud).
 */
export const listModels = async (cfg: LLMConfig): Promise<string[]> => {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  if (cfg.provider === "cli") {
    // the bridge says which of the two CLIs it found on this computer
    try {
      const res = await fetch(`${base}/health`, {
        headers: { Authorization: `Bearer ${cfg.apiKey}` },
      });
      if (res.status === 401) {
        throw new Error("The bridge token is missing or wrong.");
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const j = await res.json();
      const found = Object.entries(j.tools || {})
        .filter(([, ok]) => ok)
        .map(([name]) => name);
      if (!found.length) {
        throw new Error(
          "The bridge is running but found neither claude nor codex on this computer.",
        );
      }
      return found;
    } catch (e: any) {
      throw new Error(
        e?.message?.startsWith("The bridge") || e?.message?.startsWith("HTTP")
          ? e.message
          : "Could not reach the bridge. Start it with: node tools/cli-bridge.mjs",
      );
    }
  }
  const headers: Record<string, string> = {};
  if (cfg.apiKey) {
    headers.Authorization = `Bearer ${cfg.apiKey}`;
  }
  const attempts: [string, (j: any) => string[]][] = [
    [`${base}/models`, (j) => (j.data || []).map((m: any) => m.id)],
  ];
  if (base.endsWith("/v1")) {
    attempts.push([
      `${base.slice(0, -3)}/api/tags`,
      (j) => (j.models || []).map((m: any) => m.name || m.model),
    ]);
  }
  let lastError = "";
  for (const [url, pick] of attempts) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const names = pick(await res.json()).filter(Boolean);
      if (names.length) {
        return [...new Set(names)].sort();
      }
    } catch (e: any) {
      lastError = e?.message || "network error";
    }
  }
  throw new Error(
    `Could not list models (${
      lastError || "empty list"
    }). You can still type the model name.`,
  );
};

/** Quick connectivity check used by the settings dialog. */
export const testConnection = async (): Promise<string> => {
  const r = await streamChat({
    messages: [{ role: "user", content: "flowchart with two nodes A to B" }],
  });
  if (r.error) {
    return r.error.message;
  }
  const m = getLastCliMeta();
  if (m) {
    // the bridge reports which model the CLI used; the cost is the list-price equivalent, a subscription is not billed per request
    const who = m.model || m.tool || "the CLI";
    const cost =
      m.costUsd !== undefined
        ? ` (about $${m.costUsd.toFixed(
            3,
          )} at list price; a subscription is not billed per request)`
        : "";
    return `Connected ✔. Answered by ${who} through your own ${
      m.tool || "CLI"
    }${cost}.`;
  }
  return "Connected ✔. The model answered.";
};
