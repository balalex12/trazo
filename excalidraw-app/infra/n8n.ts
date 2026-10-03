// n8n workflow JSON (a workflow exported from n8n) to a flow graph: one box per node, one arrow per connection, in the
// direction the data goes, so triggers are on the left. Pure and deterministic, nothing is executed.
import { MAX_NODES, ROLE_STYLE, clip } from "./graph";

import type { Graph, GraphEdge, GraphNode, Role } from "./graph";

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** "n8n-nodes-base.httpRequest" -> "httpRequest"; "@n8n/n8n-nodes-langchain.agent" -> "agent" */
export const shortType = (type: string): string =>
  type.split(".").pop() || type;

/** "httpRequest" -> "Http Request" */
const words = (t: string): string =>
  t
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());

const rules: [Role, RegExp][] = [
  [
    "trigger",
    /trigger$|^(webhook|cron|schedule|manualtrigger|start|form|chattrigger|errortrigger)$/i,
  ],
  ["cache", /^(redis|memorybuffer)/i],
  [
    "database",
    /^(postgres|mysql|mongodb|microsoftsql|supabase|airtable|googlesheets|notion|baserow|nocodb|snowflake|bigquery|oracle|questdb|timescaledb|crateDb|elasticsearch|mariadb)/i,
  ],
  [
    "queue",
    /^(slack|telegram|discord|emailsend|gmail|twilio|mattermost|whatsapp|microsofteams|sendgrid|mailchimp|rabbitmq|kafka|mqtt|amqp|sns|sqs|pushover|line|signal|matrix)/i,
  ],
  [
    "storage",
    /^(s3|awss3|googledrive|dropbox|ftp|sftp|minio|onedrive|box|nextcloud|readbinaryfile|writebinaryfile)/i,
  ],
  ["proxy", /^(httprequest|respondtowebhook|graphql|rssfeedread|html)/i],
  [
    "function",
    /^(if|switch|merge|filter|splitinbatches|set|code|function|functionitem|itemlists|aggregate|splitout|wait|noop|stopanderror|executeworkflow|sort|limit|removeduplicates|comparedatasets|datetime|crypto|editfields|summarize)$/i,
  ],
];

export const n8nRole = (type: string): Role => {
  const t = shortType(type);
  for (const [role, re] of rules) {
    if (re.test(t)) {
      return role;
    }
  }
  return "app";
};

const CONNECTION_LABEL: Record<string, string> = {
  ai_languageModel: "model",
  ai_tool: "tool",
  ai_memory: "memory",
  ai_embedding: "embeddings",
  ai_vectorStore: "vector store",
  ai_document: "documents",
  ai_textSplitter: "splitter",
  ai_outputParser: "parser",
  ai_retriever: "retriever",
};

export const parseN8n = (text: string): Graph => {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("That is not valid JSON.");
  }
  // an export can be one workflow or a list of them: take the first
  const wf = Array.isArray(doc) ? doc[0] : doc;
  if (!isDict(wf) || !Array.isArray(wf.nodes) || !isDict(wf.connections)) {
    throw new Error(
      "That does not look like an n8n workflow (it needs `nodes` and `connections`).",
    );
  }
  const raw = wf.nodes.filter(isDict);
  // sticky notes are comments on the canvas, not part of the flow
  const real = raw.filter((n) => !/stickyNote$/i.test(str(n.type)));
  if (!real.length) {
    throw new Error("That n8n workflow has no nodes.");
  }
  if (real.length > MAX_NODES) {
    throw new Error(
      `That is a lot to draw (${real.length} nodes). Export a smaller workflow or split it.`,
    );
  }
  const idOf = (name: string) => `n8n:${name}`;
  const byName = new Map(real.map((n) => [str(n.name), n]));
  const nodes: GraphNode[] = real.map((n) => {
    const type = str(n.type);
    const role = n8nRole(type);
    const disabled = n.disabled === true;
    return {
      id: idOf(str(n.name)),
      role,
      dashed: disabled,
      lines: [
        `${ROLE_STYLE[role].emoji} ${clip(str(n.name), 26)}`,
        clip(`${words(shortType(type))}${disabled ? " (disabled)" : ""}`, 32),
      ],
    };
  });

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const [from, kinds] of Object.entries(wf.connections)) {
    if (!byName.has(from) || !isDict(kinds)) {
      continue;
    }
    const fromType = shortType(str(byName.get(from)!.type));
    for (const [kind, outputs] of Object.entries(kinds)) {
      if (!Array.isArray(outputs)) {
        continue;
      }
      outputs.forEach((targets, outputIndex) => {
        if (!Array.isArray(targets)) {
          return;
        }
        for (const t of targets) {
          const to = isDict(t) ? str(t.node) : "";
          if (!byName.has(to) || to === from) {
            continue;
          }
          let label = CONNECTION_LABEL[kind];
          if (!label && kind === "main") {
            if (/^if$/i.test(fromType)) {
              label = outputIndex === 0 ? "true" : "false";
            } else if (/^switch$/i.test(fromType)) {
              label = `output ${outputIndex}`;
            }
          }
          const id = `flow:${from}>${to}:${kind}:${outputIndex}`;
          if (!seen.has(id)) {
            seen.add(id);
            edges.push({
              id,
              from: idOf(from),
              to: idOf(to),
              kind: "depends",
              ...(label ? { label } : {}),
            });
          }
        }
      });
    }
  }
  const stickies = raw.length - real.length;
  return {
    nodes,
    edges,
    flow: true,
    ...(stickies
      ? {
          notes: [
            `Not drawn: ${stickies} sticky note${stickies > 1 ? "s" : ""}`,
          ],
        }
      : {}),
  };
};
