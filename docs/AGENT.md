# Agent panel: ask an AI about your diagram, or have it edit it

**✦ Agent** (the button at the bottom, next to Animation; or the command palette: "Agent") opens a chat panel. You talk to **your own model**, the one you connected in **Menu → AI assistant settings** (a local model, an API key or the experimental [CLI bridge](CLI_BRIDGE.md)). Nothing is sent until you connect one, and the panel says, on top, which connection is in use and whether the text stays on your computer.

## What you can ask

- **Questions**: "Explain this diagram", "What is missing in this architecture?", "Which boxes depend on the database?". The answer appears in the panel and the canvas is not touched.
- **Changes**: "Add a cache between the API and the database", "Rename the selected box to Billing service", "Add a monitoring box and link it to the others", "Delete the queue", "Make the database green". **Select a box first** to say "this one" or "these".

## How a change happens

1. The model answers with a short message and a list of simple edits.
2. By default the panel **shows what it would do** ("Added Cache", "Linked API to Cache"…) with **Apply** and **Discard**. The canvas changes only when you press Apply.
3. Tick **Apply without asking** to skip the preview. The choice is remembered in this browser.
4. Either way, a change is **one step in the undo history**: **Ctrl+Z** undoes it and Ctrl+Shift+Z redoes it. Anything that was already on the canvas but not yet in the history (an import, for example) becomes its own step first, so undoing an agent change never undoes something else.

What the model can do is deliberately small: add a box (near another one, **between two** boxes, or at a position), add an arrow, rename a box or change its role (its color), move a box, delete a box or an arrow. Space is made when a box is put between two others, and the arrows of moved or resized boxes are drawn again. What it cannot do (draw by hand, restyle everything, edit images) it says. If the model asks for something that does not make sense (an id that is not on the canvas, linking a box twice), that part is skipped and listed under "Not done", and the rest still applies.

## What the model sees

Only **text**: for every box its name (the first line of its text), the other lines (for example the columns of a table), its role, position and size, which boxes are selected, and the arrows between boxes with their labels. Never the images, the pixels or the file. Icons that are groups (like the library's) count as one box named by their caption. At most 150 boxes are sent; the summary says how many were left out. Earlier turns of the chat (the last six) are sent too, so you can say "now link it to the queue".

With a **local** connection (Ollama or LM Studio on this computer) the text never leaves your machine. With a **cloud** connection (Ollama Cloud, OpenAI-compatible, Anthropic) or the **CLI bridge**, the text goes to that provider, like in their own app; the panel says so.

## Tips

- Name what you mean the way the boxes are named on the canvas ("the database", "orders"). The model matches names to boxes.
- For big diagrams, select the part you care about.
- If a model answers in plain text instead of the expected shape, the panel shows the text as an answer and changes nothing.
- Small local models can be unreliable with structured answers. If edits are often skipped, try a larger model.

## The same engine as the MCP server

The edits are the same operations the [MCP server](MCP.md) offers to Claude Desktop and Claude Code, in the same code (`excalidraw-app/agent/`), so a diagram edited from the panel and from an MCP client behave the same way.

## Where the code is

`excalidraw-app/components/AgentPanel.tsx` (the panel), `excalidraw-app/agent/` (`canvas.ts` the diagram as a graph, `ops.ts` the edits, `prompt.ts` the instructions and the reading of the answer, `elements.ts` and `fromLayout.ts` the diagram elements, without the editor), `excalidraw-app/ai/llm.ts` (the connection). Tests: `excalidraw-app/agent/agent.test.ts`.
