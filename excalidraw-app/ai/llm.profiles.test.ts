import {
  PRESETS,
  checkBridge,
  getActiveProfileId,
  getLastCliMeta,
  hasSavedProfile,
  loadLLMConfig,
  loadProfile,
  pairBridge,
  parsePairingHash,
  profileIdFor,
  saveLLMConfig,
  saveProfile,
  setActiveProfile,
  streamChat,
  testConnection,
} from "./llm";

import type { LLMConfig } from "./llm";

const cloud: LLMConfig = {
  ...PRESETS.ollamacloud.config,
  model: "gpt-oss:120b",
  apiKey: "OLLAMA-SECRET",
};

const reply = (status: number, body: unknown) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("connections keep their own settings", () => {
  it("does not lose the Ollama Cloud key when another connection is saved", () => {
    saveProfile("ollamacloud", cloud);
    pairBridge("t".repeat(32));
    saveProfile("cli", { ...loadProfile("cli"), cliAck: true });
    expect(getActiveProfileId()).toBe("cli");
    expect(loadProfile("ollamacloud").apiKey).toBe("OLLAMA-SECRET");
    setActiveProfile("ollamacloud");
    expect(loadLLMConfig().apiKey).toBe("OLLAMA-SECRET");
  });

  it("turning the assistant off keeps every connection", () => {
    saveProfile("ollamacloud", cloud);
    setActiveProfile("off");
    expect(loadLLMConfig().provider).toBe("off");
    expect(hasSavedProfile("ollamacloud")).toBe(true);
    expect(loadProfile("ollamacloud").apiKey).toBe("OLLAMA-SECRET");
  });

  it("shows the preset defaults for a connection that was never saved", () => {
    expect(hasSavedProfile("anthropic")).toBe(false);
    expect(loadProfile("anthropic")).toEqual(PRESETS.anthropic.config);
  });

  it("keeps the single old setting of someone who updates", () => {
    localStorage.setItem("app-llm-config", JSON.stringify(cloud));
    expect(getActiveProfileId()).toBe("ollamacloud");
    expect(loadLLMConfig().apiKey).toBe("OLLAMA-SECRET");
    // and from then on it behaves like any other saved connection
    saveProfile("lmstudio", PRESETS.lmstudio.config);
    expect(loadProfile("ollamacloud").apiKey).toBe("OLLAMA-SECRET");
  });

  it("works from the compatibility helper too", () => {
    saveLLMConfig(cloud);
    expect(getActiveProfileId()).toBe("ollamacloud");
    saveLLMConfig({ ...cloud, provider: "off" });
    expect(getActiveProfileId()).toBe("off");
    expect(hasSavedProfile("ollamacloud")).toBe(true);
  });

  it("recognizes which connection a setting belongs to", () => {
    expect(profileIdFor(PRESETS.ollama.config)).toBe("ollama");
    expect(profileIdFor(PRESETS.lmstudio.config)).toBe("lmstudio");
    expect(profileIdFor(PRESETS.openai.config)).toBe("openai");
    expect(profileIdFor(PRESETS.anthropic.config)).toBe("anthropic");
    expect(profileIdFor(PRESETS.cli.config)).toBe("cli");
    expect(profileIdFor(cloud)).toBe("ollamacloud");
  });

  it("survives unreadable stored data", () => {
    localStorage.setItem("app-llm-profiles", "{not json");
    expect(getActiveProfileId()).toBe("off");
  });
});

describe("pairing link", () => {
  const token = "0123456789abcdef0123456789abcdef0123456789abcdef";

  it("reads the token and a local address", () => {
    expect(parsePairingHash(`#bridge=${token}`)).toEqual({
      token,
      url: undefined,
    });
    expect(
      parsePairingHash(
        `#bridge=${token}&url=${encodeURIComponent("http://127.0.0.1:11555")}`,
      ),
    ).toEqual({ token, url: "http://127.0.0.1:11555" });
  });

  it("refuses a bad token and an address that is not this computer", () => {
    expect(parsePairingHash("")).toBeNull();
    expect(parsePairingHash("#room=abc,def")).toBeNull();
    expect(parsePairingHash("#bridge=short")).toBeNull();
    expect(
      parsePairingHash("#bridge=has spaces in it, not valid!!"),
    ).toBeNull();
    expect(
      parsePairingHash(
        `#bridge=${token}&url=${encodeURIComponent("https://evil.example")}`,
      ),
    ).toBeNull();
    expect(
      parsePairingHash(
        `#bridge=${token}&url=${encodeURIComponent(
          "http://evil.example:11500",
        )}`,
      ),
    ).toBeNull();
  });

  it("stores the token in the CLI connection without confirming it for the user", () => {
    pairBridge(token, "http://127.0.0.1:11555");
    const c = loadProfile("cli");
    expect(c.apiKey).toBe(token);
    expect(c.baseUrl).toBe("http://127.0.0.1:11555");
    expect(c.cliAck).toBe(false);
    expect(getActiveProfileId()).toBe("cli");
  });

  it("keeps a confirmation that was already given when it pairs again", () => {
    saveProfile("cli", { ...PRESETS.cli.config, cliAck: true, apiKey: "old" });
    pairBridge(token);
    expect(loadProfile("cli").cliAck).toBe(true);
    expect(loadProfile("cli").apiKey).toBe(token);
  });
});

describe("checking the bridge", () => {
  const cfg = { ...PRESETS.cli.config, apiKey: "tok" };

  it("reports the CLIs it found and whether the token is accepted", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        reply(200, { bridge: "trazo-cli-bridge", tools: { claude: true } }),
      )
      .mockImplementationOnce(() => reply(200, { ok: true }));
    expect(await checkBridge(cfg)).toEqual({
      tools: { claude: true },
      tokenOk: true,
    });
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() =>
        reply(200, { bridge: "trazo-cli-bridge", tools: {} }),
      )
      .mockImplementationOnce(() => reply(401, {}));
    expect((await checkBridge(cfg)).tokenOk).toBe(false);
  });

  it("does not check a token when there is none", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      reply(200, { bridge: "trazo-cli-bridge", tools: {} }),
    );
    expect((await checkBridge({ ...cfg, apiKey: "" })).tokenOk).toBeUndefined();
  });

  it("explains a missing bridge, a refused origin and something else on the port", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    await expect(checkBridge(cfg)).rejects.toThrow(/--install/);
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() => reply(403, {}));
    await expect(checkBridge(cfg)).rejects.toThrow(/does not allow/);
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
      reply(200, { hello: "world" }),
    );
    await expect(checkBridge(cfg)).rejects.toThrow(/not the Trazo bridge/);
  });
});

describe("Save and test names the model that answered", () => {
  it("says which model, through which CLI, and that a plan is not billed per request", async () => {
    saveProfile("cli", { ...PRESETS.cli.config, apiKey: "tok", cliAck: true });
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      reply(200, {
        text: "flowchart LR\n A-->B",
        tool: "claude",
        model: "claude-sonnet-5-5",
        costUsd: 0.0221,
      }),
    );
    const msg = await testConnection();
    expect(getLastCliMeta()).toMatchObject({ model: "claude-sonnet-5-5" });
    expect(msg).toContain("claude-sonnet-5-5");
    expect(msg).toContain("through your own claude");
    expect(msg).toContain("$0.022 at list price");
    expect(msg).toContain("not billed per request");
  });

  it("forgets the CLI details when another connection answers", async () => {
    saveProfile("cli", { ...PRESETS.cli.config, apiKey: "tok", cliAck: true });
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
      reply(200, { text: "flowchart LR\n A-->B", tool: "claude" }),
    );
    await streamChat({ messages: [{ role: "user", content: "x" }] });
    expect(getLastCliMeta()).not.toBeNull();
    saveProfile("ollama", PRESETS.ollama.config);
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    await streamChat({ messages: [{ role: "user", content: "x" }] });
    expect(getLastCliMeta()).toBeNull();
  });
});
