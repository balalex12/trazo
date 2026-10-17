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
| 🎞️ **Diagrams that move** | Frames are slides. Duplicate a slide, change things, and elements **animate between slides** (position, size, colour, opacity…). You can **narrate it with your voice**: talk while it builds, press → for the next slide, and the MP4 keeps voice and picture in sync. Each slide has its own timing, transition (smart, fade, cut, **build** where elements appear one by one and arrows draw themselves, or **pan** where the camera travels over the canvas) and caption, and unchanged elements stay still. Preview, present with ← →, and **export MP4 or GIF**, rendered in your browser, nothing uploaded. Or **export one offline HTML player** that [HyperFrames](docs/HYPERFRAMES.md) can render to 4K or 60 fps video, and let **your own AI direct it** (captions, narration scripts, timing, transitions, with a local voice) or **compose** a motion graphic. |
| 🤖 **Bring your own LLM** | "Text to diagram" connects to **your** model: Ollama / LM Studio locally, **Ollama Cloud**, any OpenAI-compatible server, or Anthropic. Off by default; nothing is sent until you configure it. Output is a Mermaid diagram turned into editable shapes, colored by role with symbols (see [docs/AI.md](docs/AI.md#styling-diagrams-colors-symbols)). |
| ✨ **Agent panel** | A chat inside Trazo that **explains your diagram or edits it** with your own model: "add a cache between the API and the database", "rename this box", "what is missing here?". It shows what it will do before it does it, and every change is one **Ctrl+Z** away (see [docs/AGENT.md](docs/AGENT.md)). |
| 🔌 **MCP server** | Let **Claude Desktop, Claude Code** or any MCP client draw and edit Trazo diagrams with their own login, no API key needed. A tiny container with **no network** that only touches one folder (see [docs/MCP.md](docs/MCP.md)). |
| 🎙️ **Record while you explain** | **⏺ Record** captures just the canvas, the canvas with live maps, or the whole app, with your microphone and a highlighted pointer, and gives you an MP4 or WebM. Made in your browser, nothing uploaded (see [docs/RECORDER.md](docs/RECORDER.md)). |
| 🏗️ **Import to diagram** | Paste a `docker-compose.yml`, **Kubernetes**, **Terraform** (`.tf` or JSON), an **OpenAPI** file, **SQL** `CREATE TABLE`s or **SQL queries** (how a `SELECT`/`WITH`/`UPDATE` runs, step by step), any **JSON** (its shape), a **dbt** `manifest.json`, an **n8n** workflow or a **Jupyter notebook** (where the data goes: reads, cleaning, models, files written) and get it drawn for you: architecture by role, API by tag, tables with their keys, lineage, workflow steps. Read in your browser, **no AI and no network**, so the same file always gives the same diagram (see [docs/IMPORT.md](docs/IMPORT.md)). |
| 🐍 **Python notebooks in the browser** | Optional **JupyterLite**: Jupyter notebooks whose Python (pandas, scikit-learn, matplotlib, GeoPandas…) runs **inside the tab** through WebAssembly. Built once, served from your own machine, **no network** even while it runs. It opens as a panel **inside Trazo**: **Diagram this notebook** draws where its data goes (and the boxes light up and show real table sizes while you run it), **Draft notebook from diagram** writes the first cells from a diagram, **Compare with notebook** marks what is planned but not coded and what is coded but not drawn, **Slides from notebook** turns the analysis into an animated explainer (one slide per step), and an `import trazo` module lets Python draw graphs and GeoPandas maps on the canvas and read it back (see [docs/NOTEBOOKS.md](docs/NOTEBOOKS.md)). Need your own packages or a GPU? The same panel can use **a Jupyter server you run** (selector in the panel + a small local proxy, never the default, with a warning that it is not sandboxed). |
| 🔒 **Local-first and hardened** | No analytics, no Sentry, no CDN, no service worker, no hosted collaboration. Strict Content-Security-Policy, read-only containers, ports bound to `127.0.0.1`. One `docker compose` and it runs on your machine. See [docs/SECURITY.md](docs/SECURITY.md), and verify it yourself. |
| 🧩 **Icon packs by source** | 450+ components grouped **by source**, never mixed, each credited to its author: architecture and system design, data processing, deep learning, networking, UML/ER, Microsoft Fabric… from 16 curated **community libraries** (downloaded from the official catalog at build time), plus **63 own neutral icons** (GIS & spatial data, data engineering, machine learning) and the **GIS pack** below. |
| 🗺️ **GIS pack: live maps and Esri icons** | Embed interactive ArcGIS maps in the canvas: add layers by URL or item ID, browse _My content_ or search any portal, open Web Maps, sketch on top. Works with **ArcGIS Online and any number of ArcGIS Enterprise portals** at once. Official **Esri Architecture Center** icons and Utility Network concepts. Optional Utility Network trace (needs a Web Map with a Utility Network). |

<p align="center"><img src="docs/media/tour/01-draw.png" alt="A data platform diagram in light mode" width="860"><br><sub><b>1. Draw</b>: the hand-drawn editor, light mode</sub></p>

<p align="center"><img src="docs/media/tour/02-dark.png" alt="The same diagram in dark mode" width="860"><br><sub><b>2. Dark mode</b>: the same drawing, theme-aware interface</sub></p>

<p align="center"><img src="docs/media/tour/03-imports.png" alt="Compose, Kubernetes, Terraform, OpenAPI, SQL and a notebook turned into diagrams" width="860"><br><sub><b>3. Import</b>: Compose, Kubernetes, Terraform, OpenAPI, SQL and notebooks become diagrams, offline and without AI</sub></p>

<p align="center"><img src="docs/media/tour/04-library.png" alt="Icon library grouped by source" width="860"><br><sub><b>4. Library</b>: icons grouped by source, never mixed, each credited</sub></p>

<p align="center"><img src="docs/media/tour/05-notebook.png" alt="A notebook panel next to the diagram of its data flow" width="860"><br><sub><b>5. Notebooks</b>: Python runs in the tab; the diagram shows where the data goes</sub></p>

<p align="center"><img src="docs/media/tour/07-compare.png" alt="Planned diagram compared with the notebook" width="860"><br><sub><b>6. Compare</b>: what is planned but not coded, and the reverse</sub></p>

<p align="center"><img src="docs/media/tour/06-map.png" alt="A GeoPandas map drawn on the canvas next to its notebook" width="860"><br><sub><b>7. Maps from Python</b>: <code>trazo.map</code> draws a GeoDataFrame as an editable hand-drawn map with a legend</sub></p>
<p align="center"><img src="docs/media/tour/06-live-map.png" alt="A live ArcGIS map inside the canvas" width="860"><br><sub><b>8. Live maps</b>: GIS pack, an interactive ArcGIS map inside the canvas</sub></p>

<p align="center"><img src="docs/media/tour/08-slides.png" alt="Slides generated from a notebook" width="860"><br><sub><b>9. Slides</b>: an analysis turned into an animated explainer</sub></p>

<p align="center"><img src="docs/media/tour/09-narrated-video.png" alt="Frames of a narrated MP4" width="860"><br><sub><b>10. Narrated video</b>: MP4 with your voice or a local one, made in the browser</sub></p>

<p align="center"><img src="docs/media/tour/10-agent.png" alt="Agent panel drawing a diagram" width="860"><br><sub><b>11. Agent</b>: asks, explains and edits with your own model (Ctrl+Z undoes it)</sub></p>

<p align="center"><img src="docs/media/tour/11-director.png" alt="AI director proposal applied" width="860"><br><sub><b>12. Direct with AI</b>: a proposal for the animation you review first</sub></p>

<p align="center"><img src="docs/media/tour/12-compose.png" alt="Frames of an AI-composed video" width="860"><br><sub><b>13. Compose</b>: slides, captions and narration from one diagram</sub></p>

<p align="center"><img src="docs/media/tour/13-desktop.png" alt="The desktop app" width="860"><br><sub><b>14. Desktop app</b>: the same Trazo as a Windows, macOS or Linux app</sub></p>

<details>
<summary>See the GIS pack animated</summary>

<img src="docs/media/v4-animation-arcgis.gif" alt="An ArcGIS Enterprise architecture built step by step with Trazo" width="720">

</details>

<div align="center">

**Trazo is free and I build it in my spare time.** If it saved you an hour, you can buy me a coffee:

<a href="https://buymeacoffee.com/balalex12"><img src="https://img.buymeacoffee.com/button-api/?text=Buy%20me%20a%20coffee&emoji=%E2%98%95&slug=balalex12&button_colour=FFDD00&font_colour=000000&font_family=Cookie&outline_colour=000000&coffee_colour=ffffff" alt="Buy me a coffee" height="48"></a>

</div>

### Quick start

**No setup:** download the desktop app for Windows, Linux or macOS from the [releases](https://github.com/balalex12/trazo/releases) ([how](docs/DESKTOP.md)), or run the published image: `docker run -d --name trazo --restart unless-stopped -p 127.0.0.1:3000:80 ghcr.io/balalex12/trazo:latest`. The downloads use the public icon library; to build everything yourself (the full library, the notebook), use Docker:

You only need **Docker** (with Compose v2). No Node.js, no account.

```bash
git clone https://github.com/balalex12/trazo.git && cd trazo

docker compose up -d --build                     # the whole installation: first build takes a few minutes

# open http://localhost:3000
```

Stop with `docker compose down`. Everything listens on `127.0.0.1` only. Full guide, removing and troubleshooting: **[docs/INSTALL.md](docs/INSTALL.md)**.

**Updating:** Trazo never checks for updates by itself (no network by default). Watch the repository's releases, and update with the line for your install: **[How to update](docs/INSTALL.md#how-to-update)** (installers, `.deb`/`.rpm`, AppImage, Docker image, web zip, source).

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
| `trazo:local` | the whole product in one image: the app (port 3000), the map viewer (3001) and the Python notebooks (3002, see [docs/NOTEBOOKS.md](docs/NOTEBOOKS.md)) | always, with `docker compose up` |
| `trazo-mcp:local` | the MCP server | only if you built it (`docker compose --profile mcp build mcp`), and only while Claude is using it. No ports, no network |

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
| [docs/HYPERFRAMES.md](docs/HYPERFRAMES.md) | HTML player export, 4K / 60 fps video with HyperFrames, and your own AI as director and composer |
| [docs/RECORDER.md](docs/RECORDER.md) | Recording the canvas with your voice |
| [docs/NOTEBOOKS.md](docs/NOTEBOOKS.md) | Python notebooks in the browser (JupyterLite): setup, what is included, how it stays offline |
| [docs/IMPORT.md](docs/IMPORT.md) | docker-compose, Kubernetes, Terraform, OpenAPI, SQL (schemas and queries), dbt, n8n, Jupyter notebooks and any JSON to diagram |
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

### Recorrido

Las capturas del recorrido (dibujar, importar, biblioteca, notebooks, mapas, diapositivas, video narrado, agente y app de escritorio) están en la sección en inglés de arriba, en el mismo orden.

### Inicio rápido

Solo necesitas **Docker** (con Compose v2). Sin Node.js y sin cuenta.

```bash
git clone https://github.com/balalex12/trazo.git && cd trazo
docker compose up -d --build                     # toda la instalación: la primera vez tarda unos minutos
# abre http://localhost:3000
```

Todo escucha solo en `127.0.0.1`. Guía completa, desinstalar y problemas comunes: [docs/INSTALL.md](docs/INSTALL.md) (en inglés).

**Actualizar:** Trazo nunca busca actualizaciones por su cuenta (no usa la red por defecto). Sigue los lanzamientos del repositorio y actualiza con la línea de tu instalación: [Cómo actualizar](docs/INSTALL.md#how-to-update) (instaladores, `.deb`/`.rpm`, AppImage, imagen Docker, zip web, código fuente).

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
