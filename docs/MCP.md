# MCP server: let Claude draw and edit your diagrams

Trazo includes an **MCP server** (Model Context Protocol). Connect it to **Claude Desktop**, **Claude Code** or any other MCP client and you can say things like "draw the architecture of this docker-compose.yml", "turn this SQL schema into an ER diagram" or "add a cache between the API and the database in shop.excalidraw". The client uses **its own login** (for example your Claude subscription, through the official app), so you do not need an API key, and Trazo never sees any credentials.

It works on **`.excalidraw` files in one folder**, which you then open in Trazo (**Menu → Open**). It does not need Trazo to be running, and it has **no network access at all**.

## Set it up

The quickest way: in Trazo open **Menu → Connect Claude (MCP)…**. It asks for your diagrams folder and writes the exact commands for your system, with copy buttons. The same steps by hand:

1. Build the image once (it is built from this repository, like the app, and nothing is downloaded except the pinned base images and the packages in `yarn.lock`):

   ```
   docker compose --profile mcp build mcp
   ```

2. Pick **a folder made for your diagrams** (for example `C:\Users\you\Documents\Trazo`). It is mounted as `/work`: the server can read and write the files in it, and nothing else. Do not use your home folder or a code repository. To have it draw a file such as `docker-compose.yml` or `schema.sql`, copy that file into the folder.

3. Tell your client how to start it.

   **Claude Desktop**: Settings → Developer → Edit config, and add:

   ```json
   {
     "mcpServers": {
       "trazo": {
         "command": "docker",
         "args": [
           "run",
           "-i",
           "--rm",
           "--network",
           "none",
           "--read-only",
           "--cap-drop",
           "ALL",
           "--security-opt",
           "no-new-privileges:true",
           "-v",
           "C:\\Users\\you\\Documents\\Trazo:/work",
           "trazo-mcp:local"
         ]
       }
     }
   }
   ```

   Restart Claude Desktop. On macOS or Linux use a path like `/Users/you/Trazo:/work`.

   **Claude Code**:

   ```
   claude mcp add --scope user trazo -- docker run -i --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true -v "C:\Users\you\Documents\Trazo:/work" trazo-mcp:local
   ```

   `--scope user` makes it available in every project (leave it out to use it only in the current one). Check it with `claude mcp list`, then open a **new** Claude Code session and type `/mcp`. On first use Claude Code asks permission for each tool.

   **Windows PowerShell:** type `claude.cmd` instead of `claude`. `claude` there is a PowerShell script, and PowerShell removes the `--` before it reaches Claude Code, which then fails with `unknown option '-i'`.

   Other clients that start MCP servers over stdio take the same command.

The client starts the container when it needs it and stops it afterwards. `docker compose up` does not start it.

## What it can do

| Tool | What it does |
| --- | --- |
| `trazo_import` | draws a diagram from text or from files in the folder: docker-compose, Kubernetes, Terraform (HCL or JSON), OpenAPI, SQL, dbt manifest, n8n workflow (see [IMPORT.md](IMPORT.md)). The format is detected |
| `trazo_create_diagram` | draws a diagram you describe: boxes with a role (the color) and arrows between them, laid out left to right |
| `trazo_describe` | reads a `.excalidraw` file as a graph: boxes with ids, labels and roles, and the arrows |
| `trazo_edit` | changes a file: add, rename, recolor, move or delete boxes, add or remove arrows. The same operations the [agent panel](AGENT.md) uses |
| `trazo_list` | lists the `.excalidraw` files in the folder |

Things to try: "Use Trazo to draw the architecture in docker-compose.yml", "Describe shop.excalidraw and tell me what is missing", "In shop.excalidraw put a message queue between the API and the worker", "Make me a diagram of how login works with a browser, an API, a database and an identity provider".

## Good to know

- **It edits files, not the open tab.** After the client changes a file, open it again in Trazo (Menu → Open). Editing the live canvas is planned (see the roadmap).
- Edits keep everything else in the file (background, images, frames), and only the boxes and arrows the operations touch change. Operations that cannot be done are reported with the reason, never guessed.
- A file is only written when something was actually changed, and written whole (a crash cannot leave half a file).
- **Nothing is overwritten by accident.** Drawing into a name that already exists is refused unless the call says `overwrite: true`, and editing a file in place keeps the previous version next to it as `<name>.excalidraw.bak`.
- The diagram text, not the pictures, is what the client reads.

## Security

- The container has **no network** (`--network none`), a **read-only** filesystem, **no capabilities** and runs as an **unprivileged user**. It can only touch the mounted folder.
- File names are reduced to a plain name inside that folder: `../` tricks, absolute paths and hidden files are refused.
- Files over 5 MB are refused; at most 150 boxes per drawn diagram and 50 operations per edit.
- What the AI client sees is what the tools return (summaries of your diagrams, results), under that client's own terms and privacy settings. Trazo itself sends nothing anywhere.
- Using your Claude subscription through the **official Claude app or Claude Code** this way is the normal route: the client signs in, not Trazo. This is different from the experimental [CLI bridge](CLI_BRIDGE.md), which is why MCP is the recommended way to use a subscription.

## Where the code is

`excalidraw-app/mcp/server.ts` (protocol and tools, tested without Docker), `main.ts` (stdin/stdout and the folder), `excalidraw-app/agent/` (the diagram code shared with the agent panel), `Dockerfile.mcp` and the `mcp` service in `docker-compose.yml`. Tests: `excalidraw-app/mcp/server.test.ts` and `excalidraw-app/agent/agent.test.ts`.
