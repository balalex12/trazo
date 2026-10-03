# Roadmap and known limits

Status legend: ✅ done · 🧪 done but needs real-world validation · 🔜 next · 💡 idea

## Direction

Trazo is **"hand-drawn diagrams that move"**: draw it, animate it, explain it, export it, all on your own machine. GIS is one icon and map pack among others, not the identity of the project. Features are picked by one question: does it help someone explain a technical system with a diagram?

## Done

- ✅ Local-first: no telemetry/CDN/hosted services, strict CSP, hardened containers, network audit script
- ✅ Animated slides, Preview/Present, MP4 + GIF export (browser-only)
- ✅ Animation timing per slide (own hold time) and a transition type per slide (Smart, Fade, Cut); identical elements never move or blink
- ✅ Canvas recorder: the canvas plus your microphone to MP4/WebM, in the browser
- ✅ Infrastructure to diagram: `docker-compose.yml` to an architecture diagram, offline and deterministic
- ✅ Opt-in LLM connector (OpenAI-compatible, Ollama Cloud via local pass-through, Anthropic) for Text to diagram
- ✅ Library grouped by source: 150+ English ArcGIS components (official Esri icons) plus 16 community libraries (311 items; downloaded at build time, public profile without brand-logo libraries)
- ✅ GIS pack: ArcGIS viewer (items/layers/services, any-host URL recognition, portal browser, sketch, multi-portal UI)
- ✅ Brand color (orange ink) with light and dark themes, including our own panels and dialogs
- ✅ Own identity (name, welcome mark, app icons, PWA manifest), About and credits
- ✅ Per-font license audit (see `THIRD_PARTY_NOTICES.md`)

## Needs real-world validation 🧪

- OAuth sign-in (username/password sign-in and content browsing against a private Enterprise were validated by the maintainer)
- **Utility Network trace** with a real Web Map containing a Utility Network
- LLM connector against LM Studio / OpenAI / Anthropic endpoints (validated by the maintainer with one real LLM)
- MP4 export on browsers other than Chrome/Edge (WebCodecs H.264 availability)

## Next 🔜

Ordered by value for the direction above. Each item ships as its own pull request, with a short demo GIF.

1. **Infrastructure to diagram, no LLM needed.** `docker-compose.yml` is done (see [INFRA.md](INFRA.md)). Next: Kubernetes manifests and Terraform plan JSON, with the same deterministic, offline approach. Later: OpenAPI, SQL DDL to ER, dbt lineage.
2. **Canvas recorder with narration**, first version done (see [RECORDER.md](RECORDER.md)): records the canvas, not the screen, with the microphone, in the browser. Next: choose the microphone device, record a played slide animation with narration, and a crisper "re-render at a larger size" mode.
3. **Deeper animation.** Arrows that draw themselves, reveal-in-order, camera moves between regions, captions, richer easing, and a self-contained HTML player as an alternative to video.
4. **LLM that edits and explains the diagram you already have** ("add a cache between the API and the database", "explain this flow"), with your own model.
5. **More packs.** GIS tools (FME, GeoPandas, GDAL/OGR, PostGIS, QGIS), data engineering (Spark, Airflow, dbt, Kafka-style streams), ML and deep learning (scikit-learn, PyTorch, TensorFlow, MLflow). Public packs use **original neutral icons labelled with the tool name**, never vendor logos; logos can be added in a local profile under each vendor's brand guidelines. Packs live in a manifest per pack so anyone can contribute one with a pull request, and the build can include only the packs you want (`--packs=...`).
6. **Python notebooks, in two steps.** First, an embedded **JupyterLite** (Python running in the browser through WebAssembly): no server, no code executed on the host, nothing leaves the page. Which GIS and ML libraries are available there has to be checked before promising any. Second, optionally, a separate Jupyter container for the full Python environment. It means running arbitrary code, so it would be off by default, bound to `127.0.0.1` with a token, in its own service, and documented in `SECURITY.md` before it ships.

Housekeeping:

- Replace Liberation Sans 1.05 (GPL v2 with font exception) with Liberation Sans 2.x (OFL), and ship the OFL 1.1 text next to the fonts
- Committed browser test suite (the checks used during development, as Playwright tests) + CI
- Self-hosted ArcGIS SDK option (fully offline except for map data)
- Source releases with a changelog and versioning; pin the viewer's nginx image by digest. **No prebuilt Docker image is published on purpose:** everyone builds locally, which keeps the Esri Calcite icons (Esri MLA) out of anything we redistribute. If a public image is ever wanted, build it with `--profile=public` and without the Calcite sections (see [LIBRARIES.md](LIBRARIES.md))
- Replace the remaining upstream docs (`dev-docs/`, `examples/`) or move them out of the root
- Spanish/English UI strings for the new dialogs (i18n)

## Ideas 💡

- **Self-hosted / local-network collaboration**: reuse the dormant collab code (socket.io + storage) against a server you run yourself (never a third-party service by default), documented in SECURITY.md before it ships
- Export slides to a HyperFrames composition for narration/overlays (Apache-2.0 tool by HeyGen)
- Animate map viewpoints between slides, and capture the real map into exported video
- Templates: Enterprise deployment topologies, Utility Network data models, cloud, data platform and ML reference architectures
- Import from Mermaid, PlantUML and draw.io files
- Optional encrypted sync to a self-hosted store (never a hosted service by default)

## Known limits

- Map embeds are live iframes: exported as a placeholder in video; layers/sketches are not part of the `.excalidraw` file
- Web Scenes (3D) are not supported in the viewer
- Interpolation: line points interpolate only when the point count matches
- GIF capped at 15 fps / 800 px
- `style-src 'unsafe-inline'` and `frame-src https:` in the CSP (documented trade-offs in SECURITY.md)
