# CLAUDE.md

## Project Structure

Excalidraw is a **monorepo** with a clear separation between the core library and the application:

- **`packages/excalidraw/`** - Main React component library published to npm as `@excalidraw/excalidraw`
- **`excalidraw-app/`** - Full-featured web application (excalidraw.com) that uses the library
- **`packages/`** - Core packages: `@excalidraw/common`, `@excalidraw/element`, `@excalidraw/math`, `@excalidraw/utils`
- **`examples/`** - Integration examples (NextJS, browser script)

## Development Workflow

1. **Package Development**: Work in `packages/*` for editor features
2. **App Development**: Work in `excalidraw-app/` for app-specific features
3. **Testing**: Always run `yarn test:update` before committing
4. **Type Safety**: Use `yarn test:typecheck` to verify TypeScript

## Development Commands

```bash
yarn test:typecheck  # TypeScript type checking
yarn test:update     # Run all tests (with snapshot updates)
yarn fix             # Auto-fix formatting and linting issues
```

## Architecture Notes

### Package System

- Uses Yarn workspaces for monorepo management
- Internal packages use path aliases (see `vitest.config.mts`)
- Build system uses esbuild for packages, Vite for the app
- TypeScript throughout with strict configuration

---

# Fork notes (Trazo) — read this first when working on this fork

This repository is a **derivative of Excalidraw** (MIT) published as an independent, **local-first** project (working
name *Trazo*, see `excalidraw-app/branding.ts`). The sections above describe upstream's structure; this section is what
is different here.

## Non-negotiable rules
1. **Local-first.** The app must make no network requests by default (no analytics, CDN, hosted APIs). After any change
   run `node tools/audit/network-audit.cjs` (needs `npm i --no-save puppeteer-core`); it must print *none / none / 0*.
2. **Credits stay.** Never remove Excalidraw's credit/license (README, `LICENSE`, About dialog in
   `components/BrandDialogs.tsx`, `THIRD_PARTY_NOTICES.md`). Keep Esri attribution (CC BY 4.0 icons).
3. **Licenses.** Esri Calcite glyphs are fetched at build time (`tools/fetch-calcite.mjs`), embedded **unmodified**, and
   never committed (`assets/calcite/` is git-ignored). Do not put "Excalidraw/Esri/ArcGIS" in product names.
4. **Small, additive upstream diffs.** Prefer new files. Every edited upstream file is listed in `docs/UPDATING.md`.

## Where things are
- `docs/` — ARCHITECTURE, SECURITY, UPDATING, LOCAL_FIRST_CHANGES, VIEWER, ANIMATION, AI, LIBRARIES, BRANDING, ROADMAP.
- `viewer/` ArcGIS viewer (static, port 3001; no build step) · `excalidraw-app/animation/` slides + MP4/GIF ·
  `excalidraw-app/ai/llm.ts` LLM connector · `tools/` library builder, icon conversion, Calcite fetch, audit, icons.
- `deploy/nginx/` configs · `scripts/csp-hashes.mjs` (build-time CSP from inline-script hashes; lives in upstream's
  `scripts/` because `.dockerignore` only includes that folder).

## How to build / run / test
```
node tools/build-library.js          # fetch Calcite + generate public/arcgis.excalidrawlib (git-ignored)
docker compose up -d --build         # app :3000, viewer :3001, both 127.0.0.1 only; TypeScript errors fail the build
```
The viewer folder is mounted read-only: edit `viewer/*` and reload, no rebuild. Test with headless Chrome through
`puppeteer-core` (install into a scratch dir, NOT in the repo). Library panel: `.sidebar-trigger`; menu:
`.main-menu-trigger`; library items: `.library-unit__dragger`.

## Gotchas learned the hard way
- Embedded iframes lack `allow-modals`: `confirm()/prompt()/alert()` silently do nothing — use inline UI.
- `ExcalidrawFontFace` appended an `esm.sh` fallback to every font; fixed. Re-check after upstream merges.
- `vite-plugin-pwa` injects service-worker registration by itself unless `injectRegister:false`.
- Library items cannot carry image files; the generated library has a top-level `files` map that `App.tsx` registers and
  `useLibraryItemSvg.ts` uses for thumbnails.
- `IdentityManager` credentials are in-memory only; the viewer persists them in `localStorage` and `credential.destroy()`
  is asynchronous (save/refresh after it finishes).
- Only a `WebMap` exposes `utilityNetworks`; a plain Map + UN service cannot use the trace widget.
- A bash heredoc containing regexes with backslashes inside Python is error-prone: write patch scripts with the Write tool.
- Removing `rm -f dir/*` style commands may be blocked by the sandbox: use new output dirs instead of deleting.

## Open items (see docs/ROADMAP.md)
Community-library loader (waiting for the maintainer's exported libraries), per-font license audit, Playwright suite,
self-hosted ArcGIS SDK, validation against a real private Enterprise portal and a real Utility Network web map.
