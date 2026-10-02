# Roadmap and known limits

Status legend: ✅ done · 🧪 done but needs real-world validation · 🔜 next · 💡 idea

## Done

- ✅ Local-first: no telemetry/CDN/hosted services, strict CSP, hardened containers, network audit script
- ✅ ArcGIS viewer: items/layers/services, any-host URL recognition, portal browser, sketch, multi-portal UI
- ✅ Library: 150+ English ArcGIS components grouped by source (official Esri icons), plus the community libraries below
- ✅ Animated slides, Preview/Present, MP4 + GIF export (browser-only)
- ✅ Animation timing per slide (own hold time) and a transition type per slide (Smart, Fade, Cut); identical elements never move or blink
- ✅ Brand color (orange ink) with light and dark themes, including our own panels and dialogs
- ✅ Per-font license audit (see `THIRD_PARTY_NOTICES.md`)
- ✅ Opt-in LLM connector (OpenAI-compatible, Ollama Cloud via local pass-through, Anthropic) for Text to diagram
- ✅ Own identity (name, welcome mark, app icons, PWA manifest), About & credits
- ✅ Community libraries as per-source sections (16 libraries, 311 items; downloaded at build time, public profile without brand-logo libraries)

## Needs real-world validation 🧪

- OAuth sign-in (username/password sign-in and content browsing against a private Enterprise were validated by the maintainer)
- **Utility Network trace** with a real Web Map containing a Utility Network
- LLM connector against LM Studio / OpenAI / Anthropic endpoints (validated by the maintainer with one real LLM)
- MP4 export on browsers other than Chrome/Edge (WebCodecs H.264 availability)

## Next 🔜

- Replace Liberation Sans 1.05 (GPL v2 with font exception) with Liberation Sans 2.x (OFL), and ship the OFL 1.1 text next to the fonts
- Committed browser test suite (the checks used during development, as Playwright tests) + CI
- Self-hosted ArcGIS SDK option (fully offline except for map data)
- Source releases with a changelog and versioning; pin the viewer's nginx image by digest. **No prebuilt Docker image is published on purpose:** everyone builds locally, which keeps the Esri Calcite icons (Esri MLA) out of anything we redistribute. If a public image is ever wanted, build it with `--profile=public` and without the Calcite sections (see [LIBRARIES.md](LIBRARIES.md))
- Replace the remaining upstream docs (`dev-docs/`, `examples/`) or move them out of the root
- Spanish/English UI strings for the new dialogs (i18n)
- Animation: audio narration / music; richer easing; animate map viewpoints between slides

## Ideas 💡

- **Self-hosted / local-network collaboration**: reuse the dormant collab code (socket.io + storage) against a server you run yourself (never a third-party service by default), documented in SECURITY.md before it ships
- Export slides to a HyperFrames composition for narration/overlays (Apache-2.0 tool by HeyGen)
- Diagram-to-code and "explain this architecture" with a vision-capable model
- ArcGIS-aware templates: Enterprise deployment topologies, Utility Network data models, ML/data platform reference architectures
- Mermaid/diagram import from ArcGIS Architecture Center reference architectures
- Optional encrypted sync to a self-hosted store (never a hosted service by default)

## Known limits

- Map embeds are live iframes: exported as a placeholder in video; layers/sketches are not part of the `.excalidraw` file
- Web Scenes (3D) are not supported in the viewer
- Interpolation: line points interpolate only when the point count matches
- GIF capped at 15 fps / 800 px
- `style-src 'unsafe-inline'` and `frame-src https:` in the CSP (documented trade-offs in SECURITY.md)
