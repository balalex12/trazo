# Install, update and run Trazo

Trazo runs on your own computer. Pick the way that suits you; they are all the same Trazo.

| You are | Do this | Details |
| --- | --- | --- |
| **Just a user** | Download the **desktop app** for Windows, Linux or macOS from the [releases](https://github.com/balalex12/trazo/releases) | [DESKTOP.md](DESKTOP.md) |
| **Docker user** | `docker run -d --name trazo --restart unless-stopped -p 127.0.0.1:3000:80 ghcr.io/balalex12/trazo:latest`, then open http://localhost:3000 | [Docker image](#docker-image) |
| **Self-hosting, no Docker** | the `Trazo-Web-X.Y.Z.zip` of a release: unzip, `node serve.cjs` (Node.js 18+) | [Web zip](#web-zip) |
| **Expert / developer** | build it from the repository: Docker Compose (everything) or Node.js (dev server) | [From the source](#from-the-source-for-experts) |

The downloads are built with the **public icon library** (without the Esri Calcite glyphs and the libraries with third-party brand logos, see [LIBRARIES.md](LIBRARIES.md)); building from the repository gives you the full one. Every release has a `SHA256SUMS` file to check what you downloaded: `sha256sum -c SHA256SUMS --ignore-missing` (Linux), `shasum -a 256 -c SHA256SUMS --ignore-missing` (macOS), `Get-FileHash <file>` (Windows PowerShell) and compare by eye.

## How to update

Trazo **never checks for updates by itself** (it makes no network request on its own). To know when there is a new version, use **Watch → Custom → Releases** on the [GitHub repository](https://github.com/balalex12/trazo), or look at the releases page now and then. Your drawings are not touched by an update: they live in the app's storage (desktop app, browser) or in your own files. Save your work to a file first anyway.

| How you installed it | To update |
| --- | --- |
| **Windows installer** (`Trazo-Setup-...exe`) | download the new `Trazo-Setup-X.Y.Z-<arch>.exe` and run it: it replaces the old version |
| **Windows portable** / **zip** | download the new file and use it in place of the old one (delete the old one) |
| **macOS** (`.dmg`) | open the new `.dmg` and drag Trazo to Applications, replacing the old one |
| **Linux `.deb`** | `sudo apt install ./Trazo-X.Y.Z-linux-<arch>.deb` |
| **Linux `.rpm`** | `sudo dnf install ./Trazo-X.Y.Z-linux-<arch>.rpm` (or `sudo zypper install ./...` on openSUSE) |
| **Linux AppImage** / **`.tar.gz`** | download the new file, make it executable again (`chmod +x`), delete the old one |
| **Docker image** | `docker pull ghcr.io/balalex12/trazo:latest && docker rm -f trazo && docker run -d --name trazo --restart unless-stopped -p 127.0.0.1:3000:80 ghcr.io/balalex12/trazo:latest` |
| **Web zip** | unzip the new `Trazo-Web-X.Y.Z.zip` (it makes its own folder) and run `node serve.cjs` there; delete the old folder |
| **Docker Compose, from the source** | `git pull`, then `docker compose up -d --build` (it rebuilds the icon libraries, the app, the map viewer and the notebooks that changed) |
| **Node.js dev server, from the source** | `git pull`, `yarn`, then `yarn start` |
| **MCP image** (Claude Code / Desktop) | from the source: `git pull`, then `docker compose --profile mcp build mcp`; from the registry: `docker pull ghcr.io/balalex12/trazo-mcp:latest` |
| **Notebook pack** | see [NOTEBOOKS.md](NOTEBOOKS.md): rebuild it from the source, or unzip the new `Trazo-Notebook-Pack-X.Y.Z.zip` of the release over the old one (see [DESKTOP.md](DESKTOP.md)) |

To go back to a previous version, install that release's file instead (every release stays on the releases page) or pin the Docker tag: `ghcr.io/balalex12/trazo:X.Y.Z`.

## Docker image

```bash
docker run -d --name trazo --restart unless-stopped -p 127.0.0.1:3000:80 ghcr.io/balalex12/trazo:latest
```

Open **http://localhost:3000**. `127.0.0.1:` in front of the port means only this computer can reach it. Stop it with `docker stop trazo`, start it again with `docker start trazo`, remove it with `docker rm -f trazo`. Images exist for `amd64` and `arm64`. Pin a version (`:X.Y.Z`) if you do not want `latest` to move.

## Web zip

You need **Node.js 18 or newer** and nothing else (no `npm install`):

```bash
unzip Trazo-Web-X.Y.Z.zip && cd Trazo-Web-X.Y.Z
node serve.cjs            # http://127.0.0.1:3000 ; another port: node serve.cjs 8080
```

It is the same local server as the desktop app, with the same security headers, bound to `127.0.0.1`. To run it as a service, use your system's usual way (systemd, launchd, a scheduled task) with `node /full/path/serve.cjs`.

## From the source (for experts)

Pick one. Both give you the **full** icon library (it is downloaded at build time from the official sources, see [LIBRARIES.md](LIBRARIES.md)).

### A. Docker Compose (recommended: everything, hardened)

**You only need Docker.** No Node.js, no account, no cloud.

- **Docker** with Compose v2: Docker Desktop on Windows or macOS, or Docker Engine on Linux. Check with `docker compose version`.
- About 4 GB of free disk space and a few minutes for the first build.

```bash
git clone https://github.com/balalex12/trazo.git
cd trazo

docker compose up -d --build                     # the whole installation: the first build takes a few minutes
```

Open **http://localhost:3000**. That one command builds, **inside Docker**, the icon libraries (Esri Calcite glyphs, the Esri Architecture Center icons and the community libraries), the app, the ArcGIS map viewer and the Python notebooks, and starts them. Nothing is installed or run on your computer apart from Docker.

- The build downloads the icon libraries from their official sources and Pyodide (about 230 MB, checked against pinned hashes) for the notebooks. It is the only part that needs the internet, it happens while building, and it is cached for the next build. The running containers need no network.
- The app (3000), the map viewer (3001) and the Python notebooks (3002) listen on `127.0.0.1` only: nobody else on your network can reach them. Containers are read-only, run without extra privileges and have no write access outside their temporary folders.

| To              | Run                                             |
| --------------- | ----------------------------------------------- |
| stop            | `docker compose down`                           |
| start again     | `docker compose up -d`                          |
| update          | `git pull`, then `docker compose up -d --build` |
| follow the logs | `docker compose logs -f`                        |

### B. Node.js, no Docker (dev server)

For working on the code, with hot reload. It is **not** hardened like A (no security headers, Vite dev server): use it on your own machine only.

- **Node.js 18 or newer** and **Yarn 1.22** (`corepack enable` gives you the right one).

```bash
git clone https://github.com/balalex12/trazo.git
cd trazo
yarn                          # install the dependencies
node tools/build-library.js   # once: icon libraries (needs Node.js 20+ and the internet)
yarn start                    # http://localhost:3000
```

Before sending a change: `yarn test:typecheck`, `yarn test:code`, `yarn test:other` and, after any UI change, `yarn test:e2e` ([TESTING.md](TESTING.md)).

### C. Build the installers yourself

Everything for Electron is in `desktop/` and has its own `package.json`: see [DESKTOP.md](DESKTOP.md). The release workflow (`.github/workflows/release.yml`) does exactly that for every platform.

### D. Serve it behind your own web server

Build the site (`yarn build:app:docker`, output in `excalidraw-app/build`) and use `deploy/nginx/app.conf` as the starting point: it has the Content-Security-Policy and the other headers, and `scripts/csp-hashes.mjs` computes the script hashes of your build. Check the result with `tools/audit/network-audit.cjs` ([SECURITY.md](SECURITY.md)).

## What works out of the box

Drawing, the icon libraries, the GIS pack, **animation and MP4/GIF export**, **narration**, the **recorder** and **Import to diagram** (docker-compose, Kubernetes, Terraform, OpenAPI, SQL, dbt, n8n, Jupyter notebooks) need nothing else. They run in your browser and send nothing anywhere.

## Add an AI (optional)

Everything with AI is off until you connect a model. Pick the simplest option that fits you:

| You have | Do this | Effort |
| --- | --- | --- |
| nothing, and you want it free and private | install [Ollama](https://ollama.com) and pull a model; in Trazo: **Menu → AI assistant settings**, connection **Ollama (local)**. See [AI.md](AI.md) for the one setting Ollama needs | easy |
| an API key (OpenAI-compatible, Anthropic, Ollama Cloud) | **Menu → AI assistant settings**, choose the connection, paste the key | easy |
| a Claude subscription (Claude Desktop or Claude Code) | use the **MCP server** below: the official app does the thinking with its own login | guided |
| a signed-in Claude Code or Codex and Node.js, and you know what you are doing | the experimental [CLI bridge](CLI_BRIDGE.md) | advanced |

Once a model is connected you get two things: **Text to diagram** and the **✦ Agent** panel (see [AGENT.md](AGENT.md)). Each connection keeps its own settings, so you can switch between them without losing any.

## Let Claude draw in Trazo (MCP, optional)

`docker compose up` runs the Trazo image (`trazo:local`): the app (port 3000), the map viewer (port 3001) and the Python notebooks (port 3002). The MCP server is a **separate image** (`trazo-mcp:local`) that is **not** started that way: you build it once, and your Claude app starts it on demand (it has no ports and no network, and stops when Claude is done). To build everything at once, including the MCP image: `docker compose --profile mcp build`.

For **Claude Code** or **Claude Desktop**, with their own login and no API key. Trazo guides you:

1. In Trazo open **Menu → Connect Claude (MCP)…** and follow the three steps. It writes the exact commands for your system, with a copy button.
2. Step 1 builds a small image once: `docker compose --profile mcp build mcp`.
3. Step 2 is the folder where your diagrams will go. Use a folder made for it (see [SECURITY.md](SECURITY.md)).
4. Step 3 is one command for Claude Code, or a few lines for Claude Desktop.

Details and troubleshooting are in [MCP.md](MCP.md).

## Where your data lives

In **your browser** (diagrams, settings) and in the files you save. There is no server database. Browsers can clear their storage, so **save your work to a file** now and then (Menu → Save to). Narration is kept in the browser too; use _Save drawing with narration_ in the Animation panel to take it with the file. The MCP folder holds only the files Claude writes there.

## Remove it

```bash
docker compose --profile mcp down --rmi all    # stops it and removes the images used here
```

If you installed the MCP server in Claude, remove that too (`claude mcp remove trazo`, or delete the `trazo` entry in Claude Desktop's config). If you ever installed the CLI bridge: `node tools/cli-bridge.mjs --uninstall`. Delete the repository folder to remove the rest.

## If something does not work

| Symptom | Likely cause and fix |
| --- | --- |
| `Cannot connect to the Docker daemon` | Docker Desktop is not running. Start it and try again |
| the page does not open | wait for the build to finish (`docker compose ps` shows `healthy`); check that nothing else uses port 3000 |
| the first build is very slow or runs out of memory | give Docker at least 4 GB of memory (Docker Desktop → Settings → Resources) |
| the icon libraries are missing or only a few appear | run the `setup` step again, then `docker compose up -d --build` |
| a change from `git pull` does not show | `docker compose up -d --build` (the app is rebuilt from the source, it is not a download) |
| Claude cannot start the MCP server | Docker must be running; the image must be named `trazo-mcp:local` (rebuild with step 1); the folder must exist |
| `unknown option '-i'` adding the MCP server in PowerShell | use `claude.cmd` instead of `claude` (the dialog already does) |

More: [SECURITY.md](SECURITY.md) (what is hardened and how to check it), [UPDATING.md](UPDATING.md) (staying in sync with Excalidraw).
