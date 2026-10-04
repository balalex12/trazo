# CLI bridge (advanced, optional)

**Status: experimental, for advanced users.** It is a convenience for people who already work with Node.js and a signed-in CLI, not the main way to connect an AI. If you just want an AI in Trazo, a local model (Ollama, LM Studio) or an API key is simpler, and the MCP server (see [MCP.md](MCP.md)) lets Claude Desktop or Claude Code use their own subscription without any bridge. Lets "Text to diagram" use the **Claude Code** or **Codex** command-line tool you already have installed and signed in to, for people who have a subscription but no API key. It is off by default and does nothing until you install or start the bridge **and** tick a confirmation box in Trazo.

## Set it up once (no terminal to keep open)

1. You need **Node.js 18 or newer** on this computer (the bridge is a Node script; Trazo itself only needs Docker), and `claude` (Claude Code) and/or `codex` installed and signed in as you normally do. Check that the command works in your terminal.
2. In the Trazo folder run, once:

   ```
   node tools/cli-bridge.mjs --install
   ```

   It needs only Node 18 or newer. It starts the bridge now, hidden, and again at every login, so you never need a terminal for it. Then it opens Trazo with a **pairing link** that fills in the token for you.

3. Trazo opens **AI assistant settings** on the bridge connection with a message "Paired with the bridge". Tick the box that says you understand and press **Save & test**. The message tells you which model answered, for example `Answered by claude-sonnet-5-5 through your own claude`.
4. Use _Text to diagram_ as usual. Each request takes a few seconds longer than an API call, because a whole CLI starts for every answer.

Other commands:

| Command | What it does |
| --- | --- |
| `node tools/cli-bridge.mjs --status` | is the autostart installed, is the bridge running, which CLIs it sees |
| `node tools/cli-bridge.mjs --link --open` | prints and opens the pairing link again (for a new browser or after `--rotate`) |
| `node tools/cli-bridge.mjs --rotate` | makes a new token, restarts the bridge with it, and prints the new link |
| `node tools/cli-bridge.mjs --uninstall` | stops the bridge and removes the autostart |
| `node tools/cli-bridge.mjs` | runs it in the current terminal instead (Ctrl+C stops it) |

Options: `--port 11500`, `--origin http://localhost:3000` (repeat it to allow more pages; the first one is used in the pairing link), `--keep-env-auth` (see below), `--no-open` (with `--install`). In Trazo, **Detect the bridge** checks that it is there, which CLIs it found and whether the token is accepted.

Where the autostart lives: Windows, a hidden script in your Startup folder (`Trazo CLI Bridge.vbs`); macOS, a launch agent (`~/Library/LaunchAgents/com.trazo.cli-bridge.plist`); Linux, a user service (`~/.config/systemd/user/trazo-cli-bridge.service`). Windows is tested; macOS and Linux are written from their documentation and not tested yet. The token and a small log are in `~/.trazo/` (the token file is readable only by you).

## How the pairing link works

The link looks like `http://localhost:3000/#bridge=<token>`. Everything after `#` stays in your browser: it is never sent to any server. Trazo reads it, saves the token in the bridge connection, removes it from the address bar and opens the settings. A link may only point Trazo at `127.0.0.1` or `localhost`; anything else is ignored. The link is a password for your bridge, so do not post it. It does not give access to your provider account, only to the bridge, which also checks the page's origin.

## Which login does the CLI use?

Your **subscription login**, as long as nothing in the environment overrides it. Claude Code's own documentation says that in non-interactive mode (`claude -p`) an `ANTHROPIC_API_KEY` in the environment is "always used when present", and that `ANTHROPIC_AUTH_TOKEN` and the cloud-provider settings also come before the subscription login. If you have one of them set (for example in your system variables, for another tool), the bridge would silently bill that API account instead of your plan.

So the bridge **removes** `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX` and `CLAUDE_CODE_USE_FOUNDRY` from the environment of the CLI it starts, unless you start it with `--keep-env-auth`. Two things it cannot remove: an `apiKeyHelper` set in your Claude Code settings file, and a `CLAUDE_CODE_OAUTH_TOKEN` (which is itself a subscription token). If you want API billing, use the Anthropic connection in Trazo instead, which is the normal API route.

## What it does and does not do

- It runs the CLI in its **non-interactive mode** (`claude -p` with JSON output, or `codex exec`), sends the diagram request on standard input and returns the text answer, the model that made it and a list-price cost estimate (a subscription is not billed per request).
- The CLI is started **with no tools** (Claude: `--tools ""`; Codex: read-only sandbox), in an **empty temporary folder**, so it cannot read your files or run commands. The folder is deleted afterwards.
- **Trazo never sees your login.** The CLI keeps its own credentials. The bridge does not read, store or forward them. The only secret the page holds is the bridge token, which gives access to the bridge and nothing else.
- Your diagram text goes to the provider through the CLI, as if you typed it in that tool.

## Security of the bridge itself

A local server that starts programs deserves care, so it is deliberately narrow:

- Listens on **127.0.0.1 only**.
- Every request needs an **allowed Origin** (by default `http://localhost:3000` and `http://127.0.0.1:3000`, so no other web page can use it) and a **local Host header** (this blocks DNS rebinding). Everything except `/hello` also needs the **token**. `/hello` only says that a bridge is here and which CLIs it found, and only to an allowed page.
- The command line of the CLI is a **constant**. Nothing from the browser is ever put in an argument: the prompt goes through stdin and there is no shell.
- One run at a time, requests limited to 1 MB, runs limited to 3 minutes.
- It logs the tool, model, sizes and time of each request, never the text.
- Starting at login means a small server is always listening on your machine. If you do not want that, use `--uninstall` and run it in a terminal only when you need it.

Still, anything that can run your signed-in CLI is sensitive: do not expose the port (do not forward it or bind it to another address) and treat the token like a password. `--rotate` replaces it.

## Terms of the providers: read this first

Providers set rules for subscription logins, and the rules change. At the time of writing, Anthropic's page on Claude Code legal and compliance says, in short, that developers building products should use API keys, that apps may not offer Claude.ai login or route requests through Free, Pro or Max credentials on behalf of their users, or collect those credentials, and that it does not prevent an end user from signing in to the **unmodified** Claude Code with their own subscription. The advertised limits of Pro and Max assume ordinary individual use. OpenAI's Codex documentation recommends an API key for automation and treats ChatGPT sign-in as an advanced option.

This bridge is built to stay on the user's side of that line (your own unmodified CLI, your own login, nothing collected), but **whether this kind of use is allowed for your plan is for you to check**, and the providers may change or enforce their terms at any time. Trazo does not ask anyone to use it, and it is not enabled unless you install it and tick the box. If in doubt, use a local model, an API key, or the MCP route (planned) where the official app uses your subscription.

## Several connections, nothing lost

Trazo keeps the settings of **each connection separately** (Ollama, Ollama Cloud, LM Studio, OpenAI-compatible, Anthropic, this bridge). Choosing another one in AI settings never erases the first one's address, model or key; **Save** makes the one shown the active one, and **Off** keeps all of them. Someone who updates from the old single setting keeps it, as the matching connection.

## Status of each CLI

- **Claude Code**: tested end to end on Windows with Claude Code 2.1.x: install and autostart, pairing link, detection, Save & test naming the model, and Text to diagram producing a styled diagram. `--bare` is not used, because bare mode ignores subscription logins.
- **Codex**: written from its documentation (`codex exec`, `-o`, `--sandbox read-only`, prompt on stdin) and **not tested yet**.

## Where the code is

`tools/cli-bridge.mjs` (the server and the commands, no dependencies), `excalidraw-app/ai/llm.ts` (connections, the `cli` provider, pairing), `excalidraw-app/components/BrandDialogs.tsx` (settings and pairing), tests in `excalidraw-app/ai/cliBridge.test.ts`, `llm.cli.test.ts` and `llm.profiles.test.ts`.
