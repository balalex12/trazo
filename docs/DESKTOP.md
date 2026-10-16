# Trazo as a desktop app

![The desktop app](media/tour/13-desktop.png)

The same Trazo as in your browser or in Docker, in its own window, installed like any other program: **no Docker, no Node.js, no command line**. It is the site of the Docker image served by a small local server on `127.0.0.1:3000`, inside a window with no Node.js (the page cannot read your files or run programs). The security headers are the ones of `deploy/nginx/app.conf`, and nothing is contacted unless you connect something (an AI, an ArcGIS portal), exactly like the web version.

## What you download

Each [release](https://github.com/balalex12/trazo/releases) has, for the version `X.Y.Z`:

| System | File |
| --- | --- |
| **Windows** (x64, arm64) | `Trazo-Setup-X.Y.Z-<arch>.exe` (installer), `Trazo-Portable-X.Y.Z-x64.exe` (no install), `Trazo-X.Y.Z-win-x64.zip` |
| **Linux** (x64, arm64) | `Trazo-X.Y.Z-linux-<arch>.AppImage` (runs anywhere), `.deb` (Debian, Ubuntu), `.rpm` (Fedora, openSUSE), `.tar.gz` |
| **macOS** (Intel, Apple chip) | `Trazo-X.Y.Z-mac-<arch>.dmg` and `.zip` |
| any | `SHA256SUMS`: check what you downloaded with `sha256sum -c SHA256SUMS` |

The installers are **not signed** (a code signing certificate costs money and the project does not have one yet), so the system warns the first time:

- **Windows** SmartScreen: _More info → Run anyway_.
- **macOS** Gatekeeper: right click the app → _Open_; if it says the app is damaged, run `xattr -dr com.apple.quarantine /Applications/Trazo.app` once.
- **Linux** AppImage: `chmod +x Trazo-*.AppImage` and run it. On Ubuntu 24.04 and later the AppImage may need `--no-sandbox` (a system rule about unprivileged sandboxes); the `.deb` installs the rule that avoids that.

Verify the checksum if you want to be sure the file is the one the project built.

## What is different from the browser

- Your drawings and settings are stored by the app itself (in your user folder), not by a browser profile, and are not shared with it. **Save your work to a file** now and then, as everywhere.
- The Ollama Cloud connection works from the app, as in Docker.
- **Screen recording of the whole app** (a recorder mode that asks the system to share the screen) is not available in the desktop app yet; the canvas recorder, the MP4/GIF export and the narration work.
- Only one Trazo runs at a time, and port 3000 must be free (close Trazo in Docker first): the notebook site and the map viewer list that address as the one that may embed them.

## The notebook (optional)

The notebook panel runs Python in the app from a separate download, the **notebook pack** (`Trazo-Notebook-Pack-X.Y.Z.zip`, a few hundred MB: Pyodide and the data science packages, see [NOTEBOOKS.md](NOTEBOOKS.md)). Unzip it so that its `lab/` folder is inside a folder called `jupyterlite` in the app's data folder: in the app, **Help → Open the notebook pack folder** opens the right place. Restart Trazo. Without the pack everything else works and the notebook panel says it cannot find the site.

## Build it yourself

```bash
node tools/build-library.js --profile=public   # the library of what is published (no Calcite glyphs, see LIBRARIES.md)
yarn build:app:docker                          # the site, the way the Docker image builds it
node desktop/prepare.mjs                       # copies it into desktop/site
cd desktop && npm ci && npm run dist           # the installers of your system, in desktop/dist
```

`npm run dist` builds what the system can: on Linux the `.AppImage`, `.deb` (and the `.rpm` if `rpmbuild` is installed) and `.tar.gz`; Windows installers on Windows, macOS ones on a Mac. `npm start` opens the app without packing it. Use `--profile=public` for anything you give to other people; leave it out only for your own computer.

## Where the code is

`desktop/main.cjs` (the window, its permissions, the menu), `desktop/site-server.cjs` (the local server, tested in `tools/desktop-server.test.ts`), `desktop/prepare.mjs` (gets the site ready), `desktop/smoke.mjs` (the check CI runs on the built app) and the packaging in `desktop/package.json`. The desktop app has its own `package.json` and lock file: it adds nothing to the dependencies of the web app.

## Security of the window

No Node.js in the page, a sandboxed renderer, `contextIsolation`, the Electron fuses that turn off `RunAsNode`, `NODE_OPTIONS` and the inspector, only the clipboard, fullscreen and the microphone may be asked for (and only by the app's own origin), links open in your own browser, and the local server answers only to `127.0.0.1:3000` and only from the files it found when it started.
