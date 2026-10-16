import {
  DEFAULT_SERVER_URL,
  STORAGE_KEY,
  loadEnvironment,
  parseServerUrl,
  saveEnvironment,
} from "./environment";

const ok = (raw: string) => {
  const r = parseServerUrl(raw);
  if (typeof r === "string") {
    throw new Error(r);
  }
  return r;
};

describe("parseServerUrl", () => {
  it("takes the default proxy address and completes a bare host", () => {
    expect(ok(DEFAULT_SERVER_URL).url).toBe(DEFAULT_SERVER_URL);
    expect(ok("127.0.0.1:3003").url).toBe("http://127.0.0.1:3003/lab");
    expect(ok("http://localhost:3003").url).toBe("http://localhost:3003/lab");
  });

  it("keeps the token for the session and drops it from what is remembered", () => {
    const r = ok("http://127.0.0.1:3003/lab?token=abc123&reset");
    expect(r.url).toContain("token=abc123");
    expect(r.clean).not.toContain("token");
    expect(r.clean).toContain("reset");
  });

  it("allows plain http only for this machine, https anywhere", () => {
    expect(parseServerUrl("http://jupyter.example.com/lab")).toMatch(
      /only for this machine/,
    );
    expect(parseServerUrl("http://192.168.1.20:8888/lab")).toMatch(
      /only for this machine/,
    );
    expect(ok("https://jupyter.example.com/lab").url).toBe(
      "https://jupyter.example.com/lab",
    );
  });

  it("refuses what is not an address, credentials and other schemes", () => {
    expect(parseServerUrl("")).toMatch(/Type the address/);
    expect(parseServerUrl("   ")).toMatch(/Type the address/);
    expect(parseServerUrl(["java", "script:alert(1)"].join(""))).toMatch(
      /http/,
    );
    expect(parseServerUrl("file:///etc/passwd")).toMatch(/http/);
    expect(parseServerUrl("data:text/html,<script>1</script>")).toMatch(/http/);
    expect(parseServerUrl("http://user:pw@127.0.0.1:3003/lab")).toMatch(
      /user name or password/,
    );
    expect(parseServerUrl("http://")).toMatch(/not a valid/);
  });
});

describe("remembering the environment", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
      data,
    };
  };

  it("starts in the browser", () => {
    expect(loadEnvironment(memory())).toEqual({ kind: "browser" });
  });

  it("round-trips a server without its token", () => {
    const m = memory();
    saveEnvironment(
      { kind: "server", url: "http://127.0.0.1:3003/lab?token=secret" },
      m,
    );
    expect(m.data.get(STORAGE_KEY)).not.toContain("secret");
    expect(loadEnvironment(m)).toEqual({
      kind: "server",
      url: "http://127.0.0.1:3003/lab",
    });
  });

  it("falls back to the browser for anything unusable", () => {
    for (const bad of [
      "not json",
      '{"kind":"server"}',
      '{"kind":"server","url":"javascript:1"}',
      '{"kind":"server","url":"http://evil.example/lab"}',
      "42",
    ]) {
      const m = memory();
      m.data.set(STORAGE_KEY, bad);
      expect(loadEnvironment(m)).toEqual({ kind: "browser" });
    }
    expect(
      loadEnvironment({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toEqual({ kind: "browser" });
    // saving to blocked storage does not throw
    expect(() =>
      saveEnvironment(
        { kind: "browser" },
        {
          setItem: () => {
            throw new Error("blocked");
          },
        },
      ),
    ).not.toThrow();
  });
});
