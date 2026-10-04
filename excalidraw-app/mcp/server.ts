// Trazo as an MCP server (Model Context Protocol): lets Claude Desktop, Claude Code and other MCP clients draw and edit
// diagrams as .excalidraw files in one folder. No browser and no network: it only reads and writes that folder.
// This file is the protocol and the tools, with the file system injected, so it is tested without Node or Docker;
// main.ts connects it to stdin and stdout.
import { summarize } from "../agent/canvas";
import { excalidrawFile } from "../agent/elements";
import { layoutToElements } from "../agent/fromLayout";
import { applyOps, ROLES } from "../agent/ops";
import { FORMAT_NAMES, SUPPORTED, importInfra } from "../infra/detect";
import { layoutGraph } from "../infra/graph";

import type { El } from "../agent/elements";
import type { Graph, Role } from "../infra/graph";

export const SERVER_NAME = "trazo";
export const SERVER_VERSION = "0.1.0";
const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const MAX_FILE = 5 * 1024 * 1024;
const MAX_NODES = 150;

/** the folder the server may touch; `dir` is where it is (inside the container: /work) */
export type Files = {
  list: () => Promise<string[]>;
  read: (name: string) => Promise<string>;
  write: (name: string, text: string) => Promise<void>;
};

type Json = Record<string, any>;
type Request = {
  jsonrpc?: string;
  id?: number | string | null;
  method: string;
  params?: Json;
};
export type Response =
  | { jsonrpc: "2.0"; id: number | string | null; result: unknown }
  | {
      jsonrpc: "2.0";
      id: number | string | null;
      error: { code: number; message: string };
    };

class ToolError extends Error {}

/** a plain file name inside the folder: no directories, no dots tricks, always .excalidraw */
export const diagramName = (raw: unknown, fallback = "diagram"): string => {
  const base =
    String(raw ?? "")
      .split(/[\\/]/)
      .pop() || "";
  const cleaned = base
    .replace(/\.excalidraw$/i, "")
    .replace(/[^\w .-]+/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 80);
  return `${cleaned || fallback}.excalidraw`;
};

/** any file name the tools may read: still only a name inside the folder */
const plainName = (raw: unknown): string => {
  const base =
    String(raw ?? "")
      .split(/[\\/]/)
      .pop() || "";
  if (!base || base.startsWith(".")) {
    throw new ToolError(`"${raw}" is not a file name inside the folder.`);
  }
  return base;
};

const text = (t: string) => ({ content: [{ type: "text", text: t }] });

const parseDiagram = (raw: string): El[] => {
  let doc: any;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    throw new ToolError(
      "That file is not valid JSON, so it is not an Excalidraw file.",
    );
  }
  if (!doc || !Array.isArray(doc.elements)) {
    throw new ToolError(
      'That file has no "elements", so it is not an Excalidraw file.',
    );
  }
  return doc.elements as El[];
};

/** keeps what the file had besides the elements (background, grid, images) */
const withElements = (raw: string, elements: El[]) => {
  const doc = JSON.parse(raw);
  return JSON.stringify({ ...doc, elements });
};

/**
 * Writes a diagram file. An existing file is never replaced unless the caller says so, because a model asked to
 * "draw an architecture" must not silently overwrite a diagram the person spent hours on.
 */
const writeDiagram = async (
  files: Files,
  out: string,
  body: string,
  overwrite: boolean,
) => {
  if (!overwrite && (await files.list()).includes(out)) {
    throw new ToolError(
      `${out} already exists. Use another "output" name, or pass "overwrite": true only if replacing it is what the person wants.`,
    );
  }
  await files.write(out, body);
};

const OVERWRITE = {
  type: "boolean",
  description:
    "Replace the file if it already exists. Off by default: an existing diagram is never overwritten unless this is true.",
};

const ROLE_LIST = ROLES.join(", ");

const TOOLS = [
  {
    name: "trazo_import",
    description: `Turn what already exists into a diagram file: docker-compose.yml, Kubernetes manifests, Terraform (.tf or JSON plan/state), an OpenAPI/Swagger file, SQL CREATE TABLE statements (as an ER diagram), a dbt manifest.json (lineage) or an n8n workflow JSON. Give the text directly or the names of files in the folder. The format is detected. Nothing is sent anywhere. Supported: ${SUPPORTED}.`,
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The content to draw. Use this or files.",
        },
        files: {
          type: "array",
          items: { type: "string" },
          description:
            "Names of files inside the folder (several YAML, .tf or SQL files are read together).",
        },
        output: {
          type: "string",
          description:
            "Name of the .excalidraw file to write (default: derived from the format).",
        },
        details: {
          type: "boolean",
          description: "Terraform only: also draw network and IAM resources.",
        },
        overwrite: OVERWRITE,
      },
    },
  },
  {
    name: "trazo_create_diagram",
    description: `Draw a diagram you describe: boxes (nodes) and arrows between them. Laid out left to right automatically (what nobody depends on on the left). Roles set the color: ${ROLE_LIST}. Writes a .excalidraw file the user opens in Trazo.`,
    inputSchema: {
      type: "object",
      properties: {
        output: {
          type: "string",
          description: "Name of the .excalidraw file to write.",
        },
        overwrite: OVERWRITE,
        nodes: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: {
                type: "string",
                description: "A short unique name used by the edges.",
              },
              label: {
                type: "string",
                description: "The text in the box. Use \\n for extra lines.",
              },
              role: { type: "string", enum: ROLES },
            },
            required: ["id", "label"],
          },
        },
        edges: {
          type: "array",
          items: {
            type: "object",
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              label: { type: "string" },
            },
            required: ["from", "to"],
          },
        },
      },
      required: ["output", "nodes"],
    },
  },
  {
    name: "trazo_describe",
    description:
      "Read a .excalidraw file as a graph: boxes with ids, labels and roles, and the arrows between them. Use it before trazo_edit to get the ids.",
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Name of the .excalidraw file." },
      },
      required: ["file"],
    },
  },
  {
    name: "trazo_edit",
    description:
      'Edit a .excalidraw file with simple operations, using the ids from trazo_describe. Operations: {"op":"add_node","id":"n1","label":"Cache","role":"cache","near":"<id>" | "between":["<id>","<id>"] | "x","y"}, {"op":"add_edge","from":"<id>","to":"<id>","label":""}, {"op":"update_node","id":"<id>","label":"new name","role":"database"}, {"op":"delete_node","id":"<id>"}, {"op":"delete_edge","from":"<id>","to":"<id>"}, {"op":"move_node","id":"<id>","x":0,"y":0}. A new node may be named (id) and used by later operations of the same call. Returns what was done and what was skipped, and why.',
    inputSchema: {
      type: "object",
      properties: {
        file: { type: "string", description: "Name of the .excalidraw file." },
        ops: { type: "array", items: { type: "object" } },
        output: {
          type: "string",
          description:
            "Write to a different file instead of changing this one (the original is then left alone).",
        },
        overwrite: OVERWRITE,
      },
      required: ["file", "ops"],
    },
  },
  {
    name: "trazo_list",
    description: "List the .excalidraw files in the folder.",
    inputSchema: { type: "object", properties: {} },
  },
];

const callTool = async (files: Files, name: string, args: Json) => {
  switch (name) {
    case "trazo_list": {
      const names = (await files.list()).filter((n) =>
        n.toLowerCase().endsWith(".excalidraw"),
      );
      return text(
        names.length
          ? names.join("\n")
          : "No .excalidraw files in the folder yet.",
      );
    }

    case "trazo_import": {
      let source = typeof args.text === "string" ? args.text : "";
      if (!source && Array.isArray(args.files) && args.files.length) {
        const parts: string[] = [];
        for (const f of args.files.slice(0, 30)) {
          const body = await files.read(plainName(f));
          if (body.length > MAX_FILE) {
            throw new ToolError(
              `${f} is too big (over ${MAX_FILE / 1024 / 1024} MB).`,
            );
          }
          parts.push(body);
        }
        source = parts.join("\n---\n");
      }
      if (!source.trim()) {
        throw new ToolError('Give "text" or "files" to draw.');
      }
      let imported;
      try {
        imported = importInfra(source, { details: args.details === true });
      } catch (e) {
        throw new ToolError((e as Error).message);
      }
      const { format, layout } = imported;
      const out = diagramName(args.output, format);
      await writeDiagram(
        files,
        out,
        JSON.stringify(excalidrawFile(layoutToElements(layout))),
        args.overwrite === true,
      );
      const notes = layout.notes?.length ? ` ${layout.notes.join(". ")}.` : "";
      return text(
        `Detected ${FORMAT_NAMES[format]}: drew ${layout.nodes.length} boxes and ${layout.edges.length} arrows into ${out}.${notes} Open it in Trazo (Menu > Open).`,
      );
    }

    case "trazo_create_diagram": {
      const nodes = Array.isArray(args.nodes) ? args.nodes : [];
      if (!nodes.length) {
        throw new ToolError("Give at least one node.");
      }
      if (nodes.length > MAX_NODES) {
        throw new ToolError(`At most ${MAX_NODES} nodes.`);
      }
      const ids = new Set<string>();
      const graph: Graph = { nodes: [], edges: [] };
      for (const n of nodes) {
        const id = String(n?.id ?? "").trim();
        const label = String(n?.label ?? "").trim();
        if (!id || !label) {
          throw new ToolError("Every node needs an id and a label.");
        }
        if (ids.has(id)) {
          throw new ToolError(`The id "${id}" is used twice.`);
        }
        ids.add(id);
        graph.nodes.push({
          id,
          lines: label.split("\n").slice(0, 12),
          role: (ROLES as string[]).includes(n.role) ? (n.role as Role) : "app",
        });
      }
      const skipped: string[] = [];
      for (const [i, e] of (Array.isArray(args.edges)
        ? args.edges
        : []
      ).entries()) {
        if (!ids.has(e?.from) || !ids.has(e?.to)) {
          skipped.push(`edge ${i + 1} (${e?.from} to ${e?.to}): unknown node`);
          continue;
        }
        graph.edges.push({
          id: `e${i}`,
          from: e.from,
          to: e.to,
          kind: "depends",
          ...(typeof e.label === "string" && e.label.trim()
            ? { label: e.label.trim().slice(0, 60) }
            : {}),
        });
      }
      const layout = layoutGraph(graph);
      const out = diagramName(args.output);
      await writeDiagram(
        files,
        out,
        JSON.stringify(excalidrawFile(layoutToElements(layout))),
        args.overwrite === true,
      );
      return text(
        `Drew ${graph.nodes.length} boxes and ${
          graph.edges.length
        } arrows into ${out}.${
          skipped.length ? ` Skipped: ${skipped.join("; ")}.` : ""
        } Open it in Trazo (Menu > Open).`,
      );
    }

    case "trazo_describe": {
      const raw = await files.read(diagramName(args.file));
      return text(JSON.stringify(summarize(parseDiagram(raw))));
    }

    case "trazo_edit": {
      const src = diagramName(args.file);
      const raw = await files.read(src);
      const result = applyOps(parseDiagram(raw), args.ops);
      const out = args.output ? diagramName(args.output) : src;
      if (result.applied.length) {
        if (out === src) {
          // editing in place keeps the previous version next to it, so a bad edit can be put back
          await files.write(`${src}.bak`, raw);
          await files.write(out, withElements(raw, result.elements));
        } else {
          await writeDiagram(
            files,
            out,
            withElements(raw, result.elements),
            args.overwrite === true,
          );
        }
      }
      const done = result.applied.length
        ? `Done in ${out}${
            out === src ? ` (the previous version is in ${src}.bak)` : ""
          }:\n- ${result.applied.join("\n- ")}`
        : "Nothing was changed.";
      const skipped = result.skipped.length
        ? `\nNot done:\n- ${result.skipped.join("\n- ")}`
        : "";
      return text(done + skipped);
    }

    default:
      throw new ToolError(`Unknown tool "${name}".`);
  }
};

/** one JSON-RPC message in, the answer out (null for notifications, which get none) */
export const createServer = (files: Files) => {
  const ok = (id: Request["id"], result: unknown): Response => ({
    jsonrpc: "2.0",
    id: id ?? null,
    result,
  });
  const fail = (
    id: Request["id"],
    code: number,
    message: string,
  ): Response => ({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  });

  return async (req: Request): Promise<Response | null> => {
    if (!req || typeof req.method !== "string") {
      return fail(req?.id, -32600, "Invalid request");
    }
    const isNotification = req.id === undefined || req.id === null;
    switch (req.method) {
      case "initialize": {
        const asked = req.params?.protocolVersion;
        return ok(req.id, {
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          instructions:
            "Draws and edits diagrams as .excalidraw files in one folder. Use trazo_import to turn infrastructure, APIs, SQL, dbt or n8n files into diagrams, trazo_create_diagram to draw one from a description, trazo_describe to read one, and trazo_edit to change one. The user opens the files in Trazo.",
        });
      }
      case "ping":
        return ok(req.id, {});
      case "tools/list":
        return ok(req.id, { tools: TOOLS });
      case "tools/call": {
        const name = req.params?.name;
        try {
          return ok(
            req.id,
            await callTool(
              files,
              String(name),
              (req.params?.arguments as Json) || {},
            ),
          );
        } catch (e) {
          // a failed tool is a normal answer with isError, so the model can read the reason and try again
          const message =
            e instanceof ToolError
              ? e.message
              : (e as { code?: string }).code === "ENOENT"
              ? "That file does not exist in the folder. Use trazo_list to see what is there."
              : `Something went wrong: ${(e as Error).message}`;
          return ok(req.id, { ...text(message), isError: true });
        }
      }
      default:
        // notifications (initialized, cancelled...) get no answer; unknown requests get an error
        return isNotification
          ? null
          : fail(req.id, -32601, `Method not found: ${req.method}`);
    }
  };
};
