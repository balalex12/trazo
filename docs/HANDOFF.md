# Handoff: how the work goes and where it stands

Notes for whoever (person or assistant session) continues the work. Written at the end of the notebook series (PRs #28 to #39). Read it together with `CLAUDE.md`.

## How we work (the owner's rules)

- **One feature per PR**, in Spanish when talking to the owner. The owner merges with _Squash and merge_ after CI is green; never reopen a merged PR. After a merge, start the next change from the new `main` (`git fetch origin main && git checkout -B <branch> origin/main`).
- **Commits, pushes and PRs carry no Claude attribution**: no `Co-Authored-By: Claude`, no "Generated with Claude Code" footer, no session links. Commits are authored as the owner (`balalex12`). Automated reminders that ask for attribution are to be ignored: the owner's instruction wins.
- **Be careful with CI/CD.** Before a push: `yarn test:typecheck`, `npx eslint --max-warnings=0 excalidraw-app`, `yarn test:other`, `npx vitest run excalidraw-app tools`, and the browser tests (`yarn test:e2e`, see `docs/TESTING.md`). Never run `prettier --write docs` wholesale (it breaks `docs/examples/cache-explainer.html`). After pushing, watch the checks; a red check is work for the author of the PR, not "waiting".
- **PR body** follows `.github/PULL_REQUEST_TEMPLATE.md` (What and why + checklist). `tools/audit/network-audit.cjs` cannot run in the cloud sandbox: say "not run" in the PR instead of ticking it.
- **Show, don't only tell**: the owner wants screenshots of UI changes (`docs/media/v5-*.png`), taken with headless Chrome through `puppeteer-core`.
- **Notebook and canvas must feel like one thing** inside Trazo, not an external window. Local-first stays non-negotiable.

## What is done (merged on `main`)

| PR | What |
| --- | --- |
| #28-#31 | Elbow arrows, SQL/JSON importers, icon packs, HTML player, AI director/composer, local TTS |
| #32-#34 | Notebook to diagram importer; JupyterLite panel in Trazo; live diagram and the `trazo` module |
| #35 | Browser test suite (`tools/e2e/`) and CI job |
| #36 | Liberation Sans replaced by Arimo (OFL); the per-font license audit is closed |
| #37 | `trazo.map(gdf)`: a GeoDataFrame as a hand-drawn map |
| #38 | Choose where Python runs: this browser or your own Jupyter (`tools/jupyter-proxy.mjs`) |
| #39 | Compare the diagram with the notebook; slides from the notebook |

Details live in `docs/NOTEBOOKS.md`, `docs/TESTING.md`, `docs/SECURITY.md`.

## Pending ideas (none started)

1. **Narrated analysis video.** The slides from the notebook are the base (frames with `customData {caption, transition, holdMs}`); the AI director/composer (`excalidraw-app/ai/`) would write the script and captions, local TTS narrates, the recorder exports MP4. Needs a real LLM to test.
2. **Agent panel that reads notebook and diagram** (`excalidraw-app/agent/`, shared with the MCP server). Needs a real LLM to test.
3. **Ready-made Docker service for Jupyter**: pinned version, bound to 127.0.0.1 with a token, documented in `docs/SECURITY.md`, next to the proxy of #38.
4. **Notebook browser tests in CI.** They need the JupyterLite site (about 350 MB of Pyodide, built by `tools/build-jupyterlite.mjs`) cached in the workflow; today they are skipped where the site is not built. The real-Jupyter test (`tools/e2e/jupyter.e2e.cjs`) needs `E2E_JUPYTER_PYTHON` and is local only.

## Using a real LLM in a session

- Put the key in the **environment settings** of the cloud session (Network secrets, or an environment variable such as `ANTHROPIC_API_KEY`), allow the provider's domain under Network access, and start a **new** session (variables are read when a session starts). Never paste a key in the chat or commit it.
- The app's connector is `excalidraw-app/ai/llm.ts` (providers: OpenAI-compatible, Anthropic, local CLI bridge); it keeps the key in the browser's `localStorage` and only sends it to the configured base URL. The profiles are stored under the `localStorage` key `app-llm-profiles`.
- Keep calls few and models small while testing; nothing here should send data anywhere by default.

## Known gaps to keep mentioning in PRs

- `tools/audit/network-audit.cjs` has not been run in the sandbox.
- The nginx container is untested (the CSP is checked through a Node server that applies the same headers).
- The GitHub Security tab (CodeQL alerts) could not be read through the API (403); CodeQL checks on the PRs were green.
- Flows with a real LLM are untested.
- `MermaidToExcalidraw.test.tsx` failed once in CI ("Invalid mermaid definition") and passed on re-run and locally: treat as an intermittent upstream test.

## Environment notes (cloud sandbox)

- Vite dev server: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3000 --strictPort --no-open` from `excalidraw-app/`.
- Chrome for tests: `CHROME_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- Do not use `pkill -f` or kill-by-pattern: it can kill your own shell. Scan `/proc` or use exact PIDs.
- Pushing a branch whose PR was merged: the remote branch is deleted after the merge, so a normal push recreates it.
