# Bring your own LLM (Text to diagram)

Nothing is sent anywhere until you configure a provider. **Menu → AI assistant settings…** (or command palette).
Then open *Text to diagram* (command palette → "text to diagram") and describe a diagram. The model answers in
**Mermaid**, which Excalidraw converts into editable shapes (flowcharts, sequence, class and ER diagrams — good for
architectures, data pipelines, ETL/ML flows, data models).

| Provider | Base URL | Notes |
|---|---|---|
| Ollama (local) | `http://localhost:11434/v1` | start with `OLLAMA_ORIGINS=http://localhost:3000` so the page may call it |
| LM Studio (local) | `http://localhost:1234/v1` | enable CORS in its server settings |
| OpenAI-compatible | your URL | vLLM, llama.cpp server, OpenAI… API key if required |
| Anthropic (Claude) | `https://api.anthropic.com` | needs an API key; sent with `anthropic-dangerous-direct-browser-access` (browser calls) |

Config and key are stored in this browser (`localStorage` key `app-llm-config`) and sent only to the base URL.
Use **Save & test** to check connectivity.

**Remote hosts and the CSP.** The app's `connect-src` allows `localhost`/`127.0.0.1` on any port. To call a remote
host add it to `connect-src` in `scripts/csp-hashes.mjs` and rebuild (see [SECURITY.md](SECURITY.md)).

## How it works

`excalidraw-app/ai/llm.ts` implements Excalidraw's `onTextSubmit` contract: it sends a system prompt (Mermaid only,
diagram-type guidance) plus the chat messages, reads the SSE stream (OpenAI `choices[].delta.content` or Anthropic
`content_block_delta`), strips ```mermaid fences while streaming, and returns the final Mermaid text.

Tested against a mock OpenAI-compatible streaming server (request shape, streaming, fenced output → rendered
diagram). Not yet tested against real Ollama/LM Studio/OpenAI/Anthropic endpoints — reports welcome.

## Ideas (roadmap)

Diagram-to-code with a vision model, "explain this architecture", generating animation slides from a description,
ArcGIS-aware prompts (service topologies, Utility Network concepts).
