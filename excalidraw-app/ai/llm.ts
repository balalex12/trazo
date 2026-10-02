// Opt-in LLM connector for "Text to diagram". Nothing is sent anywhere until the user configures a
// provider (default: off). Works with any OpenAI-compatible server (Ollama, LM Studio, llama.cpp,
// vLLM, OpenAI, ...) and with the Anthropic Messages API. The API key stays in this browser's
// localStorage and is only sent to the base URL configured here.
import { RequestError } from "@excalidraw/excalidraw/errors";

import type { TTTDDialog } from "@excalidraw/excalidraw/components/TTDDialog/types";

export type LLMProvider = "off" | "openai" | "anthropic";
export type LLMConfig = {
  provider: LLMProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
};

export const PRESETS: Record<string, { label: string; config: LLMConfig }> = {
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

const KEY = "app-llm-config";
export const OFF: LLMConfig = {
  provider: "off",
  baseUrl: "",
  model: "",
  apiKey: "",
};

export const loadLLMConfig = (): LLMConfig => {
  try {
    return { ...OFF, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch (e) {
    return OFF;
  }
};
export const saveLLMConfig = (c: LLMConfig) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch (e) {
    /* ignore */
  }
};

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

export const streamChat = async (
  props: TTTDDialog.OnTextSubmitProps,
): Promise<Ret> => {
  const cfg = loadLLMConfig();
  if (cfg.provider === "off" || !cfg.baseUrl) {
    return fail(
      "The AI assistant is off. Open the menu → “AI assistant settings” and connect your own LLM (for example Ollama, running locally).",
      400,
    );
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
        system: SYSTEM_PROMPT,
        messages: props.messages,
        stream: true,
      }
    : {
        model: cfg.model,
        temperature: 0.2,
        stream: true,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...props.messages,
        ],
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
        ? " — the API key is missing or invalid."
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

/**
 * Lists the models the configured server offers (for the settings dialog). Tries the OpenAI-compatible
 * `GET {base}/models` first, then Ollama's native `GET {base without /v1}/api/tags` (public on Ollama Cloud).
 */
export const listModels = async (cfg: LLMConfig): Promise<string[]> => {
  const base = cfg.baseUrl.replace(/\/+$/, "");
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
  return r.error ? r.error.message : "Connected ✔ — the model answered.";
};
