# Bring your own LLM (Text to diagram)

Nothing is sent anywhere until you configure a provider. **Menu → AI assistant settings…** (or command palette). Then open _Text to diagram_ (command palette → "text to diagram") and describe a diagram. The model answers in **Mermaid**, which Excalidraw converts into editable shapes (flowcharts, sequence, class and ER diagrams, good for architectures, data pipelines, ETL/ML flows, data models).

| Provider | Base URL | Notes |
| --- | --- | --- |
| Ollama (local) | `http://localhost:11434/v1` | start with `OLLAMA_ORIGINS=http://localhost:3000` so the page may call it |
| **Ollama Cloud** | `/llm/ollama-cloud/v1` (preset) | needs an API key from `ollama.com/settings/keys`; goes through this app's local pass-through (see below) |
| LM Studio (local) | `http://localhost:1234/v1` | enable CORS in its server settings |
| OpenAI-compatible | your URL | vLLM, llama.cpp server, OpenAI… API key if required |
| Anthropic (Claude) | `https://api.anthropic.com` | needs an API key; sent with `anthropic-dangerous-direct-browser-access` (browser calls) |

### Ollama Cloud

Ollama Cloud (`https://ollama.com`, OpenAI-compatible at `/v1`, Bearer API key) sends **no CORS headers**, so a web page cannot call it directly. Trazo's nginx therefore exposes a same-origin pass-through, `/llm/ollama-cloud/*` → `https://ollama.com/*` (`deploy/nginx/app.conf`). Choose the **Ollama Cloud** preset, paste your key, press **Load models** (the model list is public) and **Save & test**.

- Your prompt and conversation are sent to ollama.com. Choose this provider only if you accept that. Nothing is sent otherwise.
- The key travels from your browser in the `Authorization` header and is **not** stored on the server. It is kept in this browser (`localStorage`).
- The proxy only reaches `ollama.com`, only `GET`/`POST`, strips cookies/origin/referer, and limits bodies to 1 MB. It resolves the host per request, so the stack still starts offline.
- Verified: model listing through the proxy, the 401 from ollama.com without a key, blocked methods. The authenticated chat itself needs your key; report if anything differs.

Config and key are stored in this browser (`localStorage` key `app-llm-config`) and sent only to the base URL. Use **Save & test** to check connectivity.

**Remote hosts and the CSP.** The app's `connect-src` allows `localhost`/`127.0.0.1` on any port. To call a remote host add it to `connect-src` in `scripts/csp-hashes.mjs` and rebuild (see [SECURITY.md](SECURITY.md)).

## Styling diagrams (colors, symbols)

Diagrams are Mermaid, drawn as hand-drawn shapes. Verified in the app (Mermaid tab):

| Works | Does not render |
| --- | --- |
| `classDef` / `style` **fill and stroke colors** (hex), stroke width, dashed borders (`stroke-dasharray`) | link colors (`linkStyle stroke:`), text colors, font weight |
| **Emoji in labels** as symbols (👤 🌐 🖥️ 🗄️ 🔒 🤖 🗺️ …) | cylinder `[( )]`, hexagon `{{ }}`, parallelogram: drawn as rectangles |
| `subgraph` groups, also colored/dashed with `style` |  |
| rounded `( )`, stadium `([ ])`, diamond `{ }`, circle `(( ))` |  |
| dashed `-.->` and thick `==>` arrows, edge labels `-->\|text\|` |  |

The built-in system prompt already asks the model for this palette, so plain prompts come out colored: green users, blue gateways, purple core services, yellow data stores, red security, gray external, teal analytics/ML, one emoji per node, layers as dashed groups. A complete hand-written example you can paste in the **Mermaid** tab: [`docs/examples/arcgis-enterprise-styled.mmd`](examples/arcgis-enterprise-styled.mmd).

Prompts that exploit it:

> ArcGIS Enterprise deployment with a DMZ and a private network. Users (green) go through a load balancer to two Web Adaptors (blue) inside a dashed DMZ group, then to Portal and Hosting Server (purple) and to a Data Store and an Enterprise Geodatabase (yellow) in a private group. Use thick arrows for the main flow and a dashed arrow for feature-layer storage. Add a red "WAF" node in front of the load balancer.

> Utility Network data flow: field crews (green) edit in Field Maps, edits go to a branch-versioned feature service (purple), a topology validation job (teal) runs nightly, and results feed a trace dashboard (blue). Failed validations go to a red "Error queue". Use emojis for each node.

> Medallion lakehouse: sources (gray), bronze/silver/gold layers (yellow, in a dashed group), Spark jobs (purple), data quality checks (red, diamonds), ML feature store (teal) and BI dashboards (blue). Label the arrows between layers.

## How it works

`excalidraw-app/ai/llm.ts` implements Excalidraw's `onTextSubmit` contract: it sends a system prompt (Mermaid only, diagram-type guidance) plus the chat messages, reads the SSE stream (OpenAI `choices[].delta.content` or Anthropic `content_block_delta`), strips ```mermaid fences while streaming, and returns the final Mermaid text.

Tested against a mock OpenAI-compatible streaming server (request shape, streaming, fenced output → rendered diagram). Not yet tested against real Ollama/LM Studio/OpenAI/Anthropic endpoints, reports welcome.

## Ideas (roadmap)

Diagram-to-code with a vision model, "explain this architecture", generating animation slides from a description, ArcGIS-aware prompts (service topologies, Utility Network concepts).
