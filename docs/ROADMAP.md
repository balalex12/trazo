# Roadmap and known limits

Status legend: ✅ done · 🧪 done but needs real-world validation · 🔜 next · 💡 idea

## Done
- ✅ Local-first: no telemetry/CDN/hosted services, strict CSP, hardened containers, network audit script
- ✅ ArcGIS viewer: items/layers/services, any-host URL recognition, portal browser, sketch, multi-portal UI
- ✅ Library: 150+ English components grouped by source; official Esri icons; per-source sections
- ✅ Animated slides, Preview/Present, MP4 + GIF export (browser-only)
- ✅ Opt-in LLM connector (OpenAI-compatible + Anthropic) for Text to diagram
- ✅ Own identity (name, welcome mark, app icons, PWA manifest), About & credits
- ✅ Community libraries as per-source sections (16 libraries, 311 items; downloaded at build time, public profile without brand-logo libraries)

## Needs real-world validation 🧪
- Sign-in against a **private ArcGIS Enterprise** (username/password and OAuth) and multi-portal sessions
- **Utility Network trace** with a real Web Map containing a Utility Network
- LLM connector against real Ollama / LM Studio / OpenAI / Anthropic endpoints
- MP4 export on browsers other than Chrome/Edge (WebCodecs H.264 availability)

## Next 🔜
- Per-font license audit and a complete `THIRD_PARTY_NOTICES`
- Committed browser test suite (the checks used during development, as Playwright tests) + CI
- Self-hosted ArcGIS SDK option (fully offline except for map data)
- Release workflow: GHCR image on tag, changelog, versioning; pin the viewer's nginx image by digest
- Replace the remaining upstream docs (`dev-docs/`, `examples/`) or move them out of the root
- Spanish/English UI strings for the new dialogs (i18n)
- Animation: audio narration / music; richer easing; animate map viewpoints between slides

## Ideas 💡
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
