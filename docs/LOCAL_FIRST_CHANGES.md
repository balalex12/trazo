# Changes versus upstream Excalidraw

Everything removed or changed so that the app is local-first. Base commit: see `git merge-base HEAD upstream/master`.

## Removed (no hosted service is contacted)

| Removed | Where it was | Why |
|---|---|---|
| Simple Analytics script + legacy Google Analytics block | `excalidraw-app/index.html` | telemetry, even though `VITE_APP_ENABLE_TRACKING=false` |
| Google Fonts `preconnect` | `index.html` | opens a connection to Google |
| Redirect to `app.excalidraw.com` for Excalidraw+ users | `index.html` | hosted service |
| Fonts from `excalidraw.nyc3.cdn.digitaloceanspaces.com` | `scripts/woff2/woff2-vite-plugins.js` | CDN; fonts are bundled and served from this origin |
| `esm.sh` font fallback URL | `packages/excalidraw/fonts/ExcalidrawFontFace.ts` | was added to every `@font-face`; CSP revealed it |
| Sentry error reporting | `excalidraw-app/sentry.ts` (now empty) | telemetry |
| Service worker / PWA registration | `index.tsx`, `vite.config.mts` (`injectRegister:false`) | stale caches; old workers are unregistered |
| Live collaboration (`isCollabDisabled = true`), Share dialog, shareable-link export | `excalidraw-app/App.tsx` | hosted socket server + Firebase + `json.excalidraw.com` |
| Excalidraw+ banner, menu link, sign-up/in, "Export to Excalidraw+", command-palette entries | `App.tsx`, `AppMainMenu.tsx`, `AppWelcomeScreen.tsx` | commercial promotion / hosted service |
| Social links (GitHub, X, Discord, YouTube) in menu and command palette | `AppMainMenu.tsx`, `App.tsx` | point to Excalidraw's accounts |
| Encrypted-icon footer link | `AppFooter.tsx` | link to Excalidraw+ blog |
| Sidebar promos (comments, presentation) + images | `public/` | Excalidraw+ promotion |
| Hosted AI backend (`oss-ai.excalidraw.com`), diagram-to-code plugin | `components/AI.tsx` | replaced by the opt-in LLM connector (`ai/llm.ts`) |
| Library "Publish" menu entry (when no backend is configured) | `LibraryMenuHeaderContent.tsx` | submits to a hosted function |
| Hosted URLs/keys in env files | `.env.production`, `.env.development` | blanked |
| `og-image`, `sitemap.xml`, SEO meta, `robots.txt` allow rules | `public/`, `index.html` | `robots: Disallow /`, `noindex` (it is a private tool) |
| Funding, Crowdin, Vercel, Firebase, Sentry, Docker Hub / npm publishing workflows | `.github/`, root | upstream infrastructure |

## Kept on purpose

- **"Browse libraries"** link and the `#addLibrary=` import flow (`VITE_APP_LIBRARY_URL`): a user-initiated link to the community libraries site.
- Upstream `lint`, `test`, `test-coverage-pr`, `semantic-pr-title`, `cancel`, `build-docker` workflows.
- `dev-docs/` and `examples/` (upstream documentation of the npm package; unused here).
- Package names `@excalidraw/*` (internal monorepo workspaces; renaming them would make every merge painful).

## Added

See [ARCHITECTURE.md](ARCHITECTURE.md) §2. In short: ArcGIS viewer, ArcGIS library, animation + export, LLM connector,
branding/About/AI settings dialogs, hardened Docker setup, tools.

## Changed behaviour you might notice

- The UI says **Trazo** (title, welcome logo, About). Excalidraw's logo is no longer displayed; credits remain in the About dialog, README, LICENSE and THIRD_PARTY_NOTICES.
- The command palette only has local commands.
- Pasting an ArcGIS item/service URL creates an interactive map instead of a link card.
