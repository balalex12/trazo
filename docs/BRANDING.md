# Branding and renaming

Working name: **Trazo** ("stroke / trace" in Spanish). The name is centralised so it can change in minutes.

## Where the name lives

| Place | What to change |
|---|---|
| `excalidraw-app/branding.ts` | `BRAND.name`, `tagline`, `repoUrl` (currently https://github.com/balalex12/trazo) |
| `excalidraw-app/index.html` | `<title>`, `<h1 class="visually-hidden">` |
| `excalidraw-app/components/AppWelcomeScreen.tsx` | logo mark (inline SVG) |
| `public/manifest.webmanifest`, favicons | app name and icons (still upstream's — replace with your own) |
| `docker-compose.yml` | `name:`, `container_name`, `image` |
| `README.md`, `docs/*`, `CONTRIBUTING.md` | text |

## Rules for any name you pick

- **Do not** include "Excalidraw", "Esri" or "ArcGIS" in the project or repository name, logo or domain.
- Keep the credits: the About dialog, README, `LICENSE` and `THIRD_PARTY_NOTICES.md` must keep naming Excalidraw (MIT) and Esri (icons).
- Check availability: GitHub org/user, npm, domain, and a trademark search in your country.

## Visual identity

The mark (a stroke ending in a node) is original artwork. App icons (`public/favicon.*`, `android-chrome-*`,
`apple-touch-icon.png`, `maskable_icon_*`) are generated from it by `tools/make-icons.cjs`; edit `MARK`/`BG` there to
restyle and re-run (`npm i --no-save puppeteer-core`). Replace with a designer's artwork before a public 1.0.
