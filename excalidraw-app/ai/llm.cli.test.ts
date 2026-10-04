import { PRESETS, listModels, saveLLMConfig, streamChat } from "./llm";

import type { LLMConfig } from "./llm";

const cfg = (patch: Partial<LLMConfig> = {}): LLMConfig => ({
  ...PRESETS.cli.config,
  apiKey: "tok123",
  cliAck: true,
  ...patch,
});

const reply = (status: number, body: unknown) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);

describe("CLI bridge provider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("is off in the preset until the user confirms", async () => {
    expect(PRESETS.cli.config.cliAck).toBe(false);
    saveLLMConfig(cfg({ cliAck: false }));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await streamChat({
      messages: [{ role: "user", content: "a to b" }],
    });
    expect(r.error?.message).toMatch(/Tick the box/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends the conversation to the bridge with the token and returns the unfenced answer", async () => {
    saveLLMConfig(cfg());
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        reply(200, { text: "```mermaid\nflowchart LR\n  A --> B\n```" }),
      );
    const chunks: string[] = [];
    const r = await streamChat({
      messages: [{ role: "user", content: "a to b" }],
      onChunk: (c: string) => chunks.push(c),
    });
    expect(r.error).toBeNull();
    expect(r.generatedResponse).toBe("flowchart LR\n  A --> B");
    expect(chunks.join("")).toBe("flowchart LR\n  A --> B");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:11500/run");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok123",
    );
    const body = JSON.parse(String(init.body));
    expect(body.tool).toBe("claude");
    expect(body.messages).toEqual([{ role: "user", content: "a to b" }]);
    expect(body.system).toContain("Mermaid");
  });

  it("explains a wrong token, a bridge that is not running and a CLI failure", async () => {
    saveLLMConfig(cfg());
    const ask = () =>
      streamChat({ messages: [{ role: "user", content: "x" }] });
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
      reply(401, { error: "Missing or wrong token." }),
    );
    expect((await ask()).error?.message).toMatch(/token is missing or wrong/);
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    expect((await ask()).error?.message).toMatch(/node tools\/cli-bridge\.mjs/);
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
      reply(502, { error: "claude was not found" }),
    );
    expect((await ask()).error?.message).toBe(
      "CLI bridge: claude was not found",
    );
  });

  it("lists the CLIs the bridge found", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      reply(200, { ok: true, tools: { claude: true, codex: false } }),
    );
    expect(await listModels(cfg())).toEqual(["claude"]);
  });

  it("says so when the bridge found no CLI or cannot be reached", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
      reply(200, { ok: true, tools: { claude: false, codex: false } }),
    );
    await expect(listModels(cfg())).rejects.toThrow(/neither claude nor codex/);
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    await expect(listModels(cfg())).rejects.toThrow(/Start it with/);
  });
});
