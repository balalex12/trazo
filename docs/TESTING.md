# Tests

| What | Command | Where it runs |
| --- | --- | --- |
| Types | `yarn test:typecheck` | CI (`checks`) |
| Lint | `yarn test:code` | CI (`checks`) |
| Formatting of css, json, md, html, yml | `yarn test:other` | CI (`checks`) |
| Unit and component tests (vitest, jsdom) | `yarn test:app --watch=false` | CI (`checks`) |
| **Browser tests** (a real Chrome) | `yarn test:e2e` | CI (`e2e`, a separate job) |

## Browser tests

`tools/e2e/*.e2e.cjs` drive a real Chrome through `puppeteer-core` (already in the lockfile: no new dependency) and node's own test runner. `yarn test:e2e` starts the app (`vite`, port 3000) if it is not already running, runs the files one after another and stops what it started. About a minute without the notebook tests.

```
yarn test:e2e                              # everything
yarn test:e2e tools/e2e/import.e2e.cjs     # one file
E2E_APP_URL=http://127.0.0.1:3000 yarn test:e2e    # an app that is already running
CHROME_PATH=/path/to/chrome yarn test:e2e          # when Chrome is not in a usual place
```

What they check:

- **`app.e2e.cjs`**: the app starts; it makes **no request that leaves the machine** (also while its dialogs open); no page errors and no Content-Security-Policy violations; its own entries are in the menu; the **credits and licenses** (Excalidraw MIT, Esri, CC BY 4.0, "not affiliated") are in the About dialog. This is the local-first rule of [SECURITY.md](SECURITY.md) as a test that runs on every pull request.
- **`import.e2e.cjs`**: each of the ten import formats draws a diagram from its own example (boxes and arrows), the dialog closes, and one Ctrl+Z removes it; nonsense says what it cannot read and draws nothing; a notebook of another language is refused.
- **`notebook-panel.e2e.cjs`**: with no notebook site running, the panel opens, says how to start it, disables what needs it, and stays mounted (so a kernel would survive) when hidden; the iframe is sandboxed without top navigation.
- **`lite.e2e.cjs`**: with the notebook site built (`node tools/build-jupyterlite.mjs`, see [NOTEBOOKS.md](NOTEBOOKS.md)), it is served under its real policy (`tools/e2e/lite-server.cjs` reads the `_csp.conf` the build wrote) and the tests run Python (pandas, scikit-learn), draw the data flow of a notebook, light the boxes while a cell runs, check the table sizes, use the `trazo` module in both directions, send the canvas to the notebook, draft a notebook from the diagram compare the diagram with the notebook (marks, no pile-up, undo) and make slides from it (one per step, build transitions, seen by the Animation panel), with **no external request and no policy violation**. Skipped when the site is not built, which is why the CI of every pull request (which does not build the 350 MB Pyodide download) does not run it. Run it on your machine before changing `excalidraw-app/notebook/`, `tools/lite-bridge.js` or `tools/lite-python/`, or on GitHub: **Actions → Notebook tests → Run workflow** builds the site and runs the whole browser suite (`.github/workflows/notebook-tests.yml`, manual only).

- **`jupyter.e2e.cjs`**: the panel connected to a **real Jupyter server** through `tools/jupyter-proxy.mjs`, with its real kernel: the page gets the bridge and may be embedded, Jupyter's own login still applies, other host names get 421, the address is remembered without the token, a notebook is diagrammed, its cells light up and show sizes while the real kernel runs, the `trazo` module draws, reads the canvas and draws a map, and the selector goes back to the browser's Python. Skipped unless `E2E_JUPYTER_PYTHON` points to a Python with `jupyterlab`, `ipykernel`, `pandas` and `scikit-learn`; CI installs nothing, so it does not run there.

The nginx container itself is not part of these tests (no Docker in them): the policy it sends is the same text the tests apply.

## Writing one

Use `tools/e2e/lib.cjs`: `openApp()` gives a page with the editor ready and a record of every request that left the machine, every console error and every policy violation (`seen`); `elements(page)` lists what is on the canvas; `waitFor` polls (do not use fixed sleeps to wait for something). A test that cannot fail is worth nothing: break the code on purpose once and see it fail.
