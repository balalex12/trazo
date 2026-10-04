<div align="center">

# <img src="docs/media/trazo-logo.svg" alt="Trazo logo" width="56" align="absmiddle"> Trazo

**Hand-drawn diagrams that move.** A local-first diagram studio: animate your slides into MP4 or GIF, generate diagrams with your own LLM, and keep everything on your machine. No telemetry.

<p>
<a href="https://github.com/balalex12/trazo/actions/workflows/ci.yml"><img src="https://github.com/balalex12/trazo/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status"></a>
<a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green" alt="License: MIT"></a>
<img src="https://img.shields.io/badge/TypeScript-5.9-3178c6" alt="TypeScript 5.9">
<img src="https://img.shields.io/badge/Node-%E2%89%A518-339933" alt="Node 18 or newer">
<img src="https://img.shields.io/badge/Local--first-100%25-cc440c" alt="Local-first">
<img src="https://img.shields.io/badge/Telemetry-none-cc440c" alt="No telemetry">
<img src="https://img.shields.io/badge/Runs%20with-Docker%20Compose-2496ed" alt="Runs with Docker Compose">
<img src="https://img.shields.io/badge/MCP-Claude%20Desktop%20%7C%20Claude%20Code-cc440c" alt="MCP server for Claude Desktop and Claude Code">
<a href="https://buymeacoffee.com/balalex12"><img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-balalex12-ffdd00?logo=buymeacoffee&logoColor=black" alt="Buy me a coffee"></a>
</p>

<img src="docs/media/v4-hero.gif" alt="A data platform built step by step with Trazo: new elements appear one by one, arrows draw themselves, captions, and a camera move to the last slide" width="720">

<sub>Made and exported to GIF with Trazo itself: new elements appear one by one, arrows draw themselves, captions fade in and the camera travels to the last slide. Elements that do not change stay perfectly still.</sub>

_Built on [Excalidraw](https://github.com/excalidraw/excalidraw) (MIT). Not affiliated with or endorsed by Excalidraw or Esri._

[English](#english) · [Español](#español)

</div>

---

## English

### Why Trazo?

Excalidraw is a great hand-drawn whiteboard. Trazo keeps everything that makes it great and adds what technical teams keep asking for:

|  |  |
| --- | --- |
| 🎞️ **Diagrams that move** | Frames are slides. Duplicate a slide, change things, and elements **animate between slides** (position, size, colour, opacity…). You can **narrate it with your voice**: talk while it builds, press → for the next slide, and the MP4 keeps voice and picture in sync. Each slide has its own timing, transition (smart, fade, cut, **build** where elements appear one by one and arrows draw themselves, or **pan** where the camera travels over the canvas) and caption, and unchanged elements stay still. Preview, present with ← →, and **export MP4 or GIF**, rendered in your browser, nothing uploaded. |
| 🤖 **Bring your own LLM** | "Text to diagram" connects to **your** model: Ollama / LM Studio locally, **Ollama Cloud**, any OpenAI-compatible server, or Anthropic. Off by default; nothing is sent until you configure it. Output is a Mermaid diagram turned into editable shapes, colored by role with symbols (see [docs/AI.md](docs/AI.md#styling-diagrams-colors-symbols)). |
| ✨ **Agent panel** | A chat inside Trazo that **explains your diagram or edits it** with your own model: "add a cache between the API and the database", "rename this box", "what is missing here?". It shows what it will do before it does it, and every change is one **Ctrl+Z** away (see [docs/AGENT.md](docs/AGENT.md)). |
| 🔌 **MCP server** | Let **Claude Desktop, Claude Code** or any MCP client draw and edit Trazo diagrams with their own login, no API key needed. A tiny container with **no network** that only touches one folder (see [docs/MCP.md](docs/MCP.md)). |
| 🎙️ **Record while you explain** | **⏺ Record** captures just the canvas, the canvas with live maps, or the whole app, with your microphone and a highlighted pointer, and gives you an MP4 or WebM. Made in your browser, nothing uploaded (see [docs/RECORDER.md](docs/RECORDER.md)). |
| 🏗️ **Import to diagram** | Paste a `docker-compose.yml`, **Kubernetes**, **Terraform** (`.tf` or JSON), an **OpenAPI** file, **SQL** `CREATE TABLE`s, a **dbt** `manifest.json` or an **n8n** workflow and get it drawn for you: architecture by role, API by tag, tables with their keys, lineage, workflow steps. Read in your browser, **no AI and no network**, so the same file always gives the same diagram (see [docs/IMPORT.md](docs/IMPORT.md)). |
| 🔒 **Local-first and hardened** | No analytics, no Sentry, no CDN, no service worker, no hosted collaboration. Strict Content-Security-Policy, read-only containers, ports bound to `127.0.0.1`. One `docker compose` and it runs on your machine. See [docs/SECURITY.md](docs/SECURITY.md), and verify it yourself. |
| 🧩 **Icon packs by source** | 450+ components grouped **by source**, never mixed, each credited to its author: architecture and system design, data processing, deep learning, networking, UML/ER, Microsoft Fabric… from 16 curated **community libraries** (downloaded from the official catalog at build time), plus the **GIS pack** below. |
| 🗺️ **GIS pack: live maps and Esri icons** | Embed interactive ArcGIS maps in the canvas: add layers by URL or item ID, browse _My content_ or search any portal, open Web Maps, sketch on top. Works with **ArcGIS Online and any number of ArcGIS Enterprise portals** at once. Official **Esri Architecture Center** icons and Utility Network concepts. Optional Utility Network trace (needs a Web Map with a Utility Network). |

<table>
<tr>
<td><img src="docs/media/v4-editor-light.png" alt="A data platform diagram in light mode"><br><sub><b>Light mode</b>: a data platform from events to dashboards</sub></td>
<td><img src="docs/media/v4-editor-dark.png" alt="The same diagram in dark mode"><br><sub><b>Dark mode</b>: same drawing, theme-aware UI</sub></td>
</tr>
<tr>
<td><img src="docs/media/v4-text-to-diagram.png" alt="Text to diagram with your own LLM"><br><sub><b>Text to diagram</b> with your own LLM: colors, symbols and groups</sub></td>
<td><img src="docs/media/v4-library.png" alt="Library grouped by source"><br><sub><b>Library</b> grouped by source, never mixed</sub></td>
</tr>
<tr>
<td><img src="docs/media/v4-animation-panel.png" alt="The animation panel: a transition, a caption and a narration clip for every slide"><br><sub><b>Animate and narrate</b>: a transition, a caption and your own voice for each slide</sub></td>
<td><img src="docs/media/v4-recorder-panel.png" alt="The recorder: canvas only, canvas with live maps, or the whole app"><br><sub><b>Record</b>: the canvas, the canvas with live maps, or the whole app, with your microphone</sub></td>
</tr>
<tr>
<td><img src="docs/media/v4-agent-panel.png" alt="The agent panel putting a connection pooler between the API and the database"><br><sub><b>Agent</b>: ask or edit with your own model. It shows what it will do, makes room, and Ctrl+Z undoes it</sub></td>
<td><img src="docs/media/v4-mcp-connect.png" alt="The Connect Claude dialog with the commands for Claude Code"><br><sub><b>Connect Claude (MCP)</b>: three guided steps, the exact commands for your system</sub></td>
</tr>
<tr>
<td><img src="docs/media/v4-mcp-diagram.png" alt="A diagram drawn by Claude Code through the MCP server and opened in Trazo"><br><sub>Drawn by <b>Claude Code</b> through the MCP server from a docker-compose file, then edited by it</sub></td>
<td><img src="docs/media/v4-ai-connections.png" alt="AI assistant settings with one saved setting per connection"><br><sub><b>One saved setting per connection</b>: trying another model never erases the first</sub></td>
</tr>
<tr>
<td><img src="docs/media/v4-import-compose.png" alt="A docker-compose file turned into an architecture diagram"><br><sub><b>Docker Compose</b>: services by role, ports and volumes</sub></td>
<td><img src="docs/media/v4-import-kubernetes.png" alt="Kubernetes manifests turned into an architecture diagram"><br><sub><b>Kubernetes</b>: ingress, services, workloads, config and claims</sub></td>
</tr>
<tr>
<td><img src="docs/media/v4-import-terraform.png" alt="Terraform files turned into an architecture diagram"><br><sub><b>Terraform</b>: resources and the references between them (HCL or JSON)</sub></td>
<td><img src="docs/media/v4-import-openapi.png" alt="An OpenAPI file turned into a diagram of endpoints by tag and schemas"><br><sub><b>OpenAPI</b>: endpoints by tag, schemas and security</sub></td>
</tr>
<tr>
<td><img src="docs/media/v4-import-sql-dark.png" alt="SQL CREATE TABLE statements turned into an entity relationship diagram"><br><sub><b>SQL</b>: tables with their keys and foreign keys</sub></td>
<td><img src="docs/media/v4-import-dbt.png" alt="A dbt manifest turned into a lineage graph"><br><sub><b>dbt</b>: lineage from sources to dashboards, colored by layer</sub></td>
</tr>
<tr>
<td><img src="docs/media/v4-import-n8n.png" alt="An n8n workflow turned into a flow diagram"><br><sub><b>n8n</b>: the workflow, with true and false branches</sub></td>
<td><img src="docs/media/v4-import-kubernetes-dark.png" alt="The Kubernetes diagram in dark mode"><br><sub>Dark mode too. All of it offline, no AI</sub></td>
</tr>
<tr>
<td><img src="docs/media/v4-map-embed.png" alt="Interactive ArcGIS map in the canvas"><br><sub><b>GIS pack</b>: a live map inside the canvas (ArcGIS Online or any Enterprise portal)</sub></td>
<td><img src="docs/media/v4-arcgis-architecture.png" alt="An ArcGIS Enterprise architecture with official Esri icons"><br><sub><b>GIS pack</b>: an ArcGIS Enterprise architecture with official Esri icons</sub></td>
</tr>
</table>

<details>
<summary>See the GIS pack animated</summary>

<img src="docs/media/v4-animation-arcgis.gif" alt="An ArcGIS Enterprise architecture built step by step with Trazo" width="720">

</details>

<div align="center">

**Trazo is free and I build it in my spare time.** If it saved you an hour, you can buy me a coffee:

<a href="https://buymeacoffee.com/balalex12"><img src="https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=%E2%98%95&slug=balalex12&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" alt="Buy me a coffee" height="48"></a>

</div>

### Quick start

You only need **Docker** (with Compose v2). No Node.js, no account.

```bash
git clone https://github.com/balalex12/trazo.git && cd trazo

docker compose --profile setup run --rm setup   # once: downloads the icon libraries
docker compose up -d --build                     # first build takes a few minutes

# open http://localhost:3000
```

Stop with `docker compose down`. Everything listens on `127.0.0.1` only. Full guide, updating, removing and troubleshooting: **[docs/INSTALL.md](docs/INSTALL.md)**.

**What you get right away**, with nothing else to set up: drawing, the icon libraries, animation with MP4/GIF export, narration, the recorder and _Import to diagram_. They run in your browser and send nothing anywhere.

**Add what you want, when you want it** (each one is optional):

| I want to… | Do this | Needs |
| --- | --- | --- |
| ask an AI about my diagram or have it edit it (✦ Agent, Text to diagram) | **Menu → AI assistant settings** and connect a model: a local one like Ollama (private, free) or an API key | nothing more for Ollama's app; see [docs/AI.md](docs/AI.md) |
| let **Claude Code or Claude Desktop** draw and edit my diagrams, with their own login | **Menu → Connect Claude (MCP)…**: three guided steps with the exact commands for your system | Docker (already there) |
| use my signed-in Claude Code or Codex as the AI (experimental) | the [CLI bridge](docs/CLI_BRIDGE.md) | Node.js 18+ |

#### Use it with Claude Code or Claude Desktop (MCP)

The MCP server is a **separate small image** (`trazo-mcp:local`). `docker compose up` does **not** start it: your Claude app starts it on demand and it stops by itself. So there are two things to do, once:

```bash
docker compose --profile mcp build mcp      # 1. builds the MCP image (about 2 minutes)
```

2. In Trazo open **Menu → Connect Claude (MCP)…**. It asks for a folder for your diagrams and shows the exact command (Claude Code) or the few lines (Claude Desktop) for your system, with a copy button. Run or paste it, restart your Claude app, and ask: _"Use Trazo to draw the architecture of this docker-compose.yml"_. Open the files it writes with **Menu → Open**. Docker has to be running when you use it. More in [docs/MCP.md](docs/MCP.md).

What Docker runs:

| Image | What it is | When it runs |
| --- | --- | --- |
| `trazo-app:local` | the Trazo app (port 3000) | always, with `docker compose up` |
| `nginx` (viewer) | the map viewer (port 3001) | always, with `docker compose up` |
| `trazo-mcp:local` | the MCP server | only if you built it, and only while Claude is using it. No ports, no network |

Is it safe? Read [docs/SECURITY.md](docs/SECURITY.md): what is hardened, what the optional parts can and cannot do, and how to check it yourself.

### What talks to the network?

| When | Contacts | Why |
| --- | --- | --- |
| Opening the app, drawing, saving, animating, exporting | **nothing** | fully local (verified: 0 external hosts, 0 CSP violations, 0 service workers) |
| You use an interactive map | `js.arcgis.com`, Esri basemaps, **the portals you add** | an ArcGIS map needs them |
| You connect an AI and use _Text to diagram_ or the ✦ Agent | **the address you set** (e.g. `http://localhost:11434`, which stays on your computer); with the _Ollama Cloud_ preset, `ollama.com` through the local pass-through | the text of your request and, for the agent, of your diagram (never images) |
| Claude Desktop or Claude Code use the MCP server | **nothing from Trazo**: its container has no network. Your Claude app sees what the tools return | see [docs/MCP.md](docs/MCP.md) |
| You click _Browse libraries_ | `libraries.excalidraw.com` | optional community libraries (a normal link) |

### Documentation

|  |  |
| --- | --- |
| [docs/INSTALL.md](docs/INSTALL.md) | Install, update, remove and troubleshoot; what is optional |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How it is built and why |
| [docs/SECURITY.md](docs/SECURITY.md) | Threat model, hardening, how to verify |
| [docs/VIEWER.md](docs/VIEWER.md) | ArcGIS viewer: portals, sign-in, layers, Utility Network |
| [docs/ANIMATION.md](docs/ANIMATION.md) | Slides, transitions, MP4/GIF export |
| [docs/RECORDER.md](docs/RECORDER.md) | Recording the canvas with your voice |
| [docs/IMPORT.md](docs/IMPORT.md) | docker-compose, Kubernetes, Terraform, OpenAPI, SQL, dbt and n8n to diagram |
| [docs/AI.md](docs/AI.md) | Connecting Ollama / LM Studio / OpenAI-compatible / Claude |
| [docs/AGENT.md](docs/AGENT.md) | The agent panel: ask or edit your diagram with AI |
| [docs/MCP.md](docs/MCP.md) | The MCP server for Claude Desktop and Claude Code |
| [docs/CLI_BRIDGE.md](docs/CLI_BRIDGE.md) | Experimental: use your own Claude Code or Codex CLI |
| [docs/LIBRARIES.md](docs/LIBRARIES.md) | Icon sources, adding your own libraries, licensing rules |
| [docs/UPDATING.md](docs/UPDATING.md) | Staying in sync with Excalidraw upstream |
| [docs/LOCAL_FIRST_CHANGES.md](docs/LOCAL_FIRST_CHANGES.md) | Everything removed/changed vs. Excalidraw |
| [docs/BRANDING.md](docs/BRANDING.md) | Renaming the project |
| [docs/ROADMAP.md](docs/ROADMAP.md) | What is next, known limits |

### Credits and licenses

- **Excalidraw**: © 2020 Excalidraw, MIT. This project is a derivative work; the upstream license and copyright are kept in [LICENSE](LICENSE) and the full upstream git history is preserved.
- **Esri ArcGIS Architecture Center icons**: © Esri, CC BY 4.0, converted from the official Visio toolkit to SVG.
- **Esri Calcite UI icons**: © Esri, Esri Master License Agreement. **Downloaded at build time, embedded unmodified, never committed here.**
- **Community libraries**: authors credited in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); MIT via the Excalidraw libraries catalog; downloaded at build time, **not committed** (`--profile=public` skips the ones with third-party brand logos).
- **ArcGIS Maps SDK for JavaScript**: © Esri, loaded at runtime from Esri's CDN.
- **mp4-muxer**, **gifenc**: MIT (vendored, hashes in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).

Full list: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). "Esri" and "ArcGIS" are trademarks of Esri; "Excalidraw" is a trademark of its owners; this project uses them only to describe compatibility.

### Status

Trazo is young. Verified end-to-end with automated browser tests: local-first behaviour, library, map embed, animation + MP4/GIF export, multi-portal UI, LLM connector. The maintainer has also validated it by hand against **a private ArcGIS Enterprise portal** (sign-in, content browsing) and with **a real LLM** (text to diagram). **Still pending validation: the Utility Network trace** with a real Web Map, please report what you find. See [docs/ROADMAP.md](docs/ROADMAP.md).

### Contributing

Issues and PRs welcome, see [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

---

## Español

### ¿Qué es Trazo?

**Diagramas dibujados a mano que se mueven.** Un estudio de diagramas **local-first** construido sobre [Excalidraw](https://github.com/excalidraw/excalidraw) (MIT). Conserva su estilo dibujado a mano y añade:

- 🎞️ **Diagramas que se mueven**: puedes **narrarlos con tu voz** (hablas mientras se construyen, pulsas → para pasar a la siguiente y el MP4 mantiene la voz sincronizada con la imagen). Cada diapositiva tiene su propio tiempo, su transición (inteligente, fundido, corte, construcción con elementos que aparecen uno a uno y flechas que se dibujan solas, o cámara que viaja por el lienzo) y su subtítulo; lo que no cambia se queda quieto. Exporta a **MP4 o GIF** sin salir de tu navegador.
- 🤖 **Tu propio LLM** (Ollama, LM Studio, compatible con OpenAI, Claude) para pasar de texto a diagrama. Apagado por defecto.
- 🔒 **Local y endurecido**: sin analítica, sin telemetría, sin CDN, sin colaboración alojada; política de seguridad estricta y contenedores de solo lectura. Un solo `docker compose`.
- 🧩 **Paquetes de íconos por fuente**: más de 450 componentes agrupados por fuente y con sus autores acreditados (arquitectura y diseño de sistemas, procesamiento de datos, aprendizaje profundo, redes, UML/ER, Microsoft Fabric…).
- 🗺️ **Paquete GIS**: mapas ArcGIS vivos dentro del lienzo, con capas por URL o ID, búsqueda en el portal, Web Maps y dibujo encima. Funciona con **ArcGIS Online y varios ArcGIS Enterprise a la vez**. Incluye los íconos oficiales de Esri Architecture Center y trazado de Utility Network opcional.

### Inicio rápido

Solo necesitas **Docker** (con Compose v2). Sin Node.js y sin cuenta.

```bash
git clone https://github.com/balalex12/trazo.git && cd trazo
docker compose --profile setup run --rm setup   # una vez: descarga las librerías de iconos
docker compose up -d --build                     # la primera vez tarda unos minutos
# abre http://localhost:3000
```

Todo escucha solo en `127.0.0.1`. Guía completa, actualizar, desinstalar y problemas comunes: [docs/INSTALL.md](docs/INSTALL.md) (en inglés).

**Para usarlo con Claude Code o Claude Desktop (MCP):** el servidor MCP es una imagen aparte (`trazo-mcp:local`) que `docker compose up` **no** arranca; tu app de Claude la arranca cuando la necesita. Una sola vez: `docker compose --profile mcp build mcp` y luego, en Trazo, **Menú → Connect Claude (MCP)…**, que te da el comando exacto para tu sistema con botón de copiar. Detalles en [docs/MCP.md](docs/MCP.md) (en inglés).

Sin configurar nada tienes: dibujo, librerías de iconos, animación con exportación a MP4/GIF, narración, grabador e _Import to diagram_. Opcional, cuando quieras: una IA propia para el **panel ✦ Agent** (Menú → AI assistant settings, por ejemplo Ollama local), y que **Claude Code o Claude Desktop** dibujen y editen tus diagramas con su propio inicio de sesión (Menú → Connect Claude (MCP), tres pasos guiados). Seguridad: [docs/SECURITY.md](docs/SECURITY.md).

### Privacidad y red

La app, el dibujo, la animación y la exportación **no hacen ninguna conexión externa**. Solo se conecta a Esri y a los portales que añadas cuando usas un mapa, a la URL de tu LLM si lo configuras, y a `libraries.excalidraw.com` si pulsas _Browse libraries_. Cómo verificarlo: [docs/SECURITY.md](docs/SECURITY.md).

### Créditos y licencias

Excalidraw (MIT, © 2020 Excalidraw) · íconos de Esri Architecture Center (CC BY 4.0, © Esri) · íconos Calcite (licencia de Esri, se descargan al construir y **no** se redistribuyen) · 16 librerías comunitarias con sus autores acreditados (se descargan del catálogo oficial al construir; el perfil `--profile=public` omite las que traen logos de marcas) · ArcGIS Maps SDK (© Esri, se carga en ejecución) · mp4-muxer y gifenc (MIT). Detalle en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Proyecto independiente, no afiliado ni respaldado por Excalidraw ni por Esri.

### Estado

Joven. Probado de punta a punta con pruebas automáticas de navegador (modo local, librería, mapa, animación y exportación, interfaz multi-portal, conector LLM). El mantenedor también lo validó a mano contra **un portal ArcGIS Enterprise privado** (inicio de sesión y exploración de contenido) y con **un LLM real** (texto a diagrama). **Pendiente de validar: el trazado de Utility Network** con un Web Map real; se agradecen reportes. Ver [docs/ROADMAP.md](docs/ROADMAP.md).

<div align="center">

**Trazo es gratis y lo construyo en mis ratos libres.** Si te ahorró tiempo, puedes invitarme un café:

<a href="https://buymeacoffee.com/balalex12"><img src="https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=%E2%98%95&slug=balalex12&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" alt="Buy me a coffee" height="48"></a>

</div>
