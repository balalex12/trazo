# Contributing

Thanks for helping! This project is a derivative of [Excalidraw](https://github.com/excalidraw/excalidraw) (MIT) — please
keep the credits intact (README, About dialog, `LICENSE`, `THIRD_PARTY_NOTICES.md`).

## Ground rules

1. **Local-first is a feature.** A change must not add network requests to the app by default (analytics, CDNs, hosted
   APIs, update checks). Anything that contacts a server must be user-initiated and documented in
   [docs/SECURITY.md](docs/SECURITY.md). Run `tools/audit/network-audit.cjs` before opening a PR.
2. **Respect licenses.** Do not commit assets whose license forbids redistribution or modification (e.g. Esri Calcite
   glyphs are fetched at build time, never committed). New icon/library sources need their license in
   `THIRD_PARTY_NOTICES.md`.
3. **Keep upstream merges cheap.** Prefer new files over edits to upstream files; when you must edit one, keep the diff
   small and add it to the hotspot table in [docs/UPDATING.md](docs/UPDATING.md).
4. **No trademarks in names.** Don't put "Excalidraw", "Esri" or "ArcGIS" in project/feature product names.

## Development

```bash
yarn install            # Node 20+
yarn start              # dev server (the ArcGIS viewer is a separate static page: serve /viewer on :3001)
yarn test:typecheck     # TypeScript (the Docker build also runs it)
yarn test:update        # upstream unit tests
node tools/build-library.js
docker compose up -d --build
```

The viewer (`viewer/`) has no build step: edit and reload. The animation module is in `excalidraw-app/animation/`; the
LLM connector in `excalidraw-app/ai/`. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Pull requests

- One topic per PR, with a short description of *why*.
- Update the docs you touched. Screenshots/GIFs for UI changes are welcome.
- Conventional commit style is appreciated (`feat:`, `fix:`, `docs:`, `chore:`).
- By contributing you agree that your contribution is licensed under the MIT license of this project.

## Reporting bugs / security

Bugs: open an issue with steps to reproduce, browser, and whether you use ArcGIS Online or Enterprise (version).
Vulnerabilities: see [SECURITY.md](SECURITY.md) — please don't file them publicly.

## Good first issues

Look at [docs/ROADMAP.md](docs/ROADMAP.md): font license audit, i18n for the new dialogs, Playwright tests, new
library sections (with licenses), reference-architecture templates.
