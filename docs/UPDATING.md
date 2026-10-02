# Updating from Excalidraw upstream

This repository keeps Excalidraw's **full git history** and a remote called `upstream`, so improvements and security fixes can be merged. Keep our changes small and additive to make this painless.

```bash
git remote -v                       # upstream → https://github.com/excalidraw/excalidraw.git
git fetch upstream
git merge upstream/master           # (or: git rebase upstream/master)   — conflicts are expected in the files below
git config rerere.enabled true      # remember conflict resolutions between updates
```

After resolving conflicts:

```bash
node tools/build-library.js
docker compose build --no-cache
docker compose up -d
npm i --no-save puppeteer-core && node tools/audit/network-audit.cjs   # MUST report: no external hosts, no CSP violations
```

## Why the audit matters

Upstream adds features regularly. A new feature may bring a new analytics call, a new CDN font, a new hosted endpoint or a new "upgrade" link. **Every merge must be followed by the network audit** and a skim of `git diff upstream/master...HEAD --stat` for new `https://` strings:

```bash
git diff HEAD~1 -- . ':!yarn.lock' | grep -n "^+.*https\?://" | grep -v -E "w3.org|github.com|developer.mozilla"
```

## Conflict hotspots (files we patch)

| File | Our change |
| --- | --- |
| `excalidraw-app/App.tsx` | collab off, Plus/Share/AI backends removed, command palette, mounts `AnimationPanel`, `BrandDialogs`, library preload, `eid` handling is in the package App (below) |
| `excalidraw-app/index.html`, `index.tsx`, `sentry.ts`, `vite.config.mts` | no analytics/redirect/preconnect, local fonts, no service worker |
| `excalidraw-app/components/{AppMainMenu,AppWelcomeScreen,AppFooter,AI,TopErrorBoundary}.tsx` | rewritten / trimmed |
| `packages/excalidraw/components/App.tsx` | adds `eid` to viewer iframes |
| `packages/excalidraw/components/{LibraryMenuItems,LibraryMenuSection,LibraryMenuHeaderContent}.tsx`, `hooks/useLibraryItemSvg.ts` | library grouping, short names, images in thumbnails, Publish hidden |
| `packages/element/src/embeddable.ts` | ArcGIS URL recognition, localhost/arcgis allowed |
| `packages/excalidraw/fonts/ExcalidrawFontFace.ts` | CDN fallback removed |
| `scripts/woff2/woff2-vite-plugins.js` | fonts from `/` |
| `packages/excalidraw/renderer/interactiveScene.ts` | one canvas highlight color (`highlightPoint`) in the brand orange |
| `excalidraw-app/index.tsx` | imports `brand.scss` after the editor styles (new file: the palette) |
| `Dockerfile`, `docker-compose.yml`, `.env.production`, `.env.development`, `.gitignore`, `.dockerignore` | hardening / no hosted URLs |

Files **deleted** from upstream (a merge will report "deleted by us" if upstream edits them — keep them deleted): `.github/FUNDING.yml`, `crowdin.yml`, `vercel.json`, `firebase-project/`, `.github/assets/`, workflows `autorelease-excalidraw`, `publish-docker`, `sentry-production`, `locales-coverage`, `size-limit`, `lint`, `test`, `build-docker`, `cancel`, `semantic-pr-title`, `test-coverage-pr` (replaced by our `ci.yml`), and the promo images in `public/`.

## Tips

- If a conflict is in a file we _rewrote_ (menu, welcome screen), take upstream's version for new features you want, and re-apply our removals (no Plus/social/sign-up items).
- A TypeScript error after a merge usually means an upstream API changed. The Docker build runs `tsc`, so it fails loudly rather than silently.
- Security fixes in upstream dependencies: merge, rebuild, re-audit.
