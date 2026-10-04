# Install and run Trazo

Trazo runs on your own computer, in Docker. **You only need Docker.** No Node.js, no account, no cloud.

## What you need

- **Docker** with Compose v2: Docker Desktop on Windows or macOS, or Docker Engine on Linux. Check with `docker compose version`.
- About 4 GB of free disk space and a few minutes for the first build.
- A modern browser (Chrome or Edge give you everything, including MP4 export; others work for drawing and the rest).

## Install (3 commands)

```bash
git clone https://github.com/balalex12/trazo.git
cd trazo

docker compose --profile setup run --rm setup   # once: downloads the icon libraries
docker compose up -d --build                     # first build takes a few minutes
```

Open **http://localhost:3000**. That is the whole installation.

- The `setup` step downloads the icon libraries (Esri Calcite glyphs and the community libraries, at build time, from their official sources) and writes them into the folder. It is the only step that needs the internet, and it runs in a throwaway container. If you have Node.js 20+ you can run `node tools/build-library.js` instead.
- The app and the map viewer listen on `127.0.0.1` only (ports 3000 and 3001): nobody else on your network can reach them.

Daily use:

| To          | Run                                             |
| ----------- | ----------------------------------------------- |
| stop        | `docker compose down`                           |
| start again | `docker compose up -d`                          |
| update      | `git pull`, then `docker compose up -d --build` |

## What works out of the box

Drawing, the icon libraries, the GIS pack, **animation and MP4/GIF export**, **narration**, the **recorder** and **Import to diagram** (docker-compose, Kubernetes, Terraform, OpenAPI, SQL, dbt, n8n) need nothing else. They run in your browser and send nothing anywhere.

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

`docker compose up` runs the app (`trazo-app:local`, port 3000) and the map viewer (port 3001). The MCP server is a **separate image** (`trazo-mcp:local`) that is **not** started that way: you build it once, and your Claude app starts it on demand (it has no ports and no network, and stops when Claude is done). To build everything at once, including the MCP image: `docker compose --profile mcp build`.

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
docker compose --profile mcp --profile setup down --rmi all    # stops it and removes the images used here
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
