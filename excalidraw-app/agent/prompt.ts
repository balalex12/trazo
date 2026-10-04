// Talking to the model: what we tell it, how the canvas is shown to it, and how its answer is read.
// The answer is a short JSON: a message for the person and a list of simple operations (see ops.ts).
import { ROLES } from "./ops";

import type { Summary } from "./canvas";

export const AGENT_SYSTEM = `You are the assistant inside Trazo, a diagram editor. You can answer questions about the diagram on the canvas and edit it.

The canvas is given as JSON: "nodes" (boxes, icons and texts, each with an id, a label that is its name, sometimes "details" with the other lines of its text such as the columns of a table, a position and a size), "edges" (arrows between node ids, with an optional label), "frames" (slides), and "selected" (the node ids the user has selected, if any). When the user says "this" or "these", they mean the selected nodes.

Reply with ONLY a JSON object, nothing before or after it, in this shape:
{"message": "<one or two short sentences for the user>", "ops": [ ... ]}

"ops" is a list of edits, possibly empty (for questions and explanations, answer in "message" and leave "ops" empty). The only operations you may use:
- {"op":"add_node","id":"n1","label":"Cache","role":"cache","near":"<node id>"}  adds a box. "id" is a name of your choice that later operations of this same reply can use. Put it "near" a node, or "between":["<id>","<id>"] two nodes (space is made for it), or give "x" and "y".
- {"op":"add_edge","from":"<id>","to":"<id>","label":"optional"}  adds an arrow from one node to another.
- {"op":"update_node","id":"<id>","label":"new text","role":"database"}  renames a box and/or changes its role (color). Both fields are optional.
- {"op":"delete_node","id":"<id>"}  deletes a box and its arrows.
- {"op":"delete_edge","from":"<id>","to":"<id>"}  removes the arrow between two nodes.
- {"op":"move_node","id":"<id>","x":0,"y":0}  moves a box.

Roles (they set the color): ${ROLES.join(", ")}. Use "app" when unsure.

Rules:
- Use the node ids exactly as they appear in the canvas. Never invent ids for existing nodes.
- To put a box between two linked nodes: add_node with "between", delete_edge for the old arrow, then add_edge twice (from the first to the new box, and from the new box to the second).
- Do only what was asked. Do not delete or rename anything the user did not mention.
- Keep labels short, in the language the user writes in.
- If a request cannot be done with these operations, say so in "message" and leave "ops" empty.`;

/** the user turn: the canvas as it is right now, then the request */
export const buildUserTurn = (summary: Summary, request: string): string =>
  `CANVAS:\n${JSON.stringify(summary)}\n\nREQUEST:\n${request.trim()}`;

export type AgentReply = {
  message: string;
  ops: unknown[];
  /** the model answered in plain text instead of the JSON shape; the text is shown as the message */
  plain: boolean;
};

/** Models wrap JSON in fences or add a sentence around it; take the object, or fall back to showing the text. */
export const parseAgentReply = (raw: string): AgentReply => {
  const text = raw.trim();
  const unfenced = text
    .replace(/^```[a-zA-Z]*\s*/, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const first = unfenced.indexOf("{");
  const last = unfenced.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      const j = JSON.parse(unfenced.slice(first, last + 1));
      if (j && typeof j === "object" && !Array.isArray(j)) {
        return {
          message: typeof j.message === "string" ? j.message : "",
          ops: Array.isArray(j.ops) ? j.ops : [],
          plain: false,
        };
      }
    } catch (e) {
      /* not JSON: show the text */
    }
  }
  return { message: text, ops: [], plain: true };
};
