import { n8nRole, parseN8n, shortType } from "./n8n";

const wf = {
  name: "Lead intake",
  nodes: [
    { name: "Webhook", type: "n8n-nodes-base.webhook" },
    { name: "Valid?", type: "n8n-nodes-base.if" },
    { name: "Save lead", type: "n8n-nodes-base.postgres" },
    { name: "Reject", type: "n8n-nodes-base.set" },
    { name: "Tell sales", type: "n8n-nodes-base.slack" },
    { name: "Old step", type: "n8n-nodes-base.httpRequest", disabled: true },
    { name: "Note", type: "n8n-nodes-base.stickyNote" },
    { name: "Agent", type: "@n8n/n8n-nodes-langchain.agent" },
    { name: "Chat model", type: "@n8n/n8n-nodes-langchain.lmChatOpenAi" },
  ],
  connections: {
    Webhook: { main: [[{ node: "Valid?", type: "main", index: 0 }]] },
    "Valid?": {
      main: [
        [{ node: "Save lead", type: "main", index: 0 }],
        [{ node: "Reject", type: "main", index: 0 }],
      ],
    },
    "Save lead": {
      main: [
        [
          { node: "Tell sales", type: "main", index: 0 },
          { node: "Agent", type: "main", index: 0 },
        ],
      ],
    },
    "Chat model": {
      ai_languageModel: [
        [{ node: "Agent", type: "ai_languageModel", index: 0 }],
      ],
    },
    Ghost: { main: [[{ node: "Webhook", type: "main", index: 0 }]] },
  },
};

describe("parseN8n", () => {
  const g = parseN8n(JSON.stringify(wf));
  const edge = (from: string, to: string) =>
    g.edges.find((e) => e.from === `n8n:${from}` && e.to === `n8n:${to}`);

  it("draws a box per node and skips sticky notes", () => {
    expect(g.nodes).toHaveLength(8);
    expect(g.nodes.some((n) => n.id === "n8n:Note")).toBe(false);
    expect(g.notes).toEqual(["Not drawn: 1 sticky note"]);
  });

  it("draws arrows in the direction the data goes", () => {
    expect(edge("Webhook", "Valid?")).toBeDefined();
    expect(edge("Save lead", "Tell sales")).toBeDefined();
    expect(edge("Save lead", "Agent")).toBeDefined();
    // connections from a node that does not exist are ignored
    expect(g.edges.some((e) => e.from === "n8n:Ghost")).toBe(false);
  });

  it("labels the branches of an If and the parts of an AI agent", () => {
    expect(edge("Valid?", "Save lead")?.label).toBe("true");
    expect(edge("Valid?", "Reject")?.label).toBe("false");
    expect(edge("Chat model", "Agent")?.label).toBe("model");
    expect(edge("Webhook", "Valid?")?.label).toBeUndefined();
  });

  it("colors by what the node does and marks disabled ones dashed", () => {
    const n = (name: string) => g.nodes.find((x) => x.id === `n8n:${name}`)!;
    expect(n("Webhook").role).toBe("trigger");
    expect(n("Valid?").role).toBe("function");
    expect(n("Save lead").role).toBe("database");
    expect(n("Tell sales").role).toBe("queue");
    expect(n("Agent").role).toBe("app");
    expect(n("Old step").dashed).toBe(true);
    expect(n("Old step").lines[1]).toBe("Http Request (disabled)");
  });

  it("takes the first workflow of an exported list", () => {
    expect(parseN8n(JSON.stringify([wf, wf])).nodes).toHaveLength(8);
  });

  it("explains what is wrong", () => {
    expect(() => parseN8n("nope")).toThrow(/valid JSON/);
    expect(() => parseN8n("{}")).toThrow(/n8n workflow/);
    expect(() =>
      parseN8n(JSON.stringify({ nodes: [], connections: {} })),
    ).toThrow(/no nodes/);
  });
});

describe("helpers", () => {
  it("shortens types", () => {
    expect(shortType("n8n-nodes-base.httpRequest")).toBe("httpRequest");
    expect(shortType("@n8n/n8n-nodes-langchain.agent")).toBe("agent");
  });
  it("recognizes triggers by name", () => {
    expect(n8nRole("n8n-nodes-base.scheduleTrigger")).toBe("trigger");
    expect(n8nRole("n8n-nodes-base.manualTrigger")).toBe("trigger");
    expect(n8nRole("n8n-nodes-base.redis")).toBe("cache");
  });
});
