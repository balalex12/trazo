import { createServer, diagramName } from "./server";

import type { Files } from "./server";

const memory = (initial: Record<string, string> = {}) => {
  const store = new Map(Object.entries(initial));
  const files: Files = {
    list: async () => [...store.keys()].sort(),
    read: async (name) => {
      if (!store.has(name)) {
        throw Object.assign(new Error("nope"), { code: "ENOENT" });
      }
      return store.get(name)!;
    },
    write: async (name, text) => {
      store.set(name, text);
    },
  };
  return { files, store };
};

let n = 0;
const rpc = (
  handle: ReturnType<typeof createServer>,
  method: string,
  params?: Record<string, unknown>,
) => handle({ jsonrpc: "2.0", id: ++n, method, params });
const call = async (
  handle: ReturnType<typeof createServer>,
  name: string,
  args: Record<string, unknown> = {},
) => {
  const r = (await rpc(handle, "tools/call", { name, arguments: args })) as any;
  return {
    text: r.result.content[0].text as string,
    isError: !!r.result.isError,
  };
};

const COMPOSE =
  "services:\n  web:\n    image: nginx\n    ports: ['80:80']\n    depends_on: [api]\n  api:\n    image: node\n    depends_on: [db]\n  db:\n    image: postgres:16\n";

describe("protocol", () => {
  it("answers initialize with the client's protocol version when it is known", async () => {
    const { files } = memory();
    const h = createServer(files);
    const r = (await rpc(h, "initialize", {
      protocolVersion: "2024-11-05",
    })) as any;
    expect(r.result.protocolVersion).toBe("2024-11-05");
    expect(r.result.capabilities).toEqual({ tools: {} });
    expect(r.result.serverInfo.name).toBe("trazo");
    const other = (await rpc(h, "initialize", {
      protocolVersion: "1999-01-01",
    })) as any;
    expect(other.result.protocolVersion).toBe("2025-06-18");
  });

  it("lists its tools with schemas, answers ping, ignores notifications, rejects unknown methods", async () => {
    const h = createServer(memory().files);
    const list = (await rpc(h, "tools/list")) as any;
    expect(list.result.tools.map((t: any) => t.name)).toEqual([
      "trazo_import",
      "trazo_create_diagram",
      "trazo_describe",
      "trazo_edit",
      "trazo_list",
    ]);
    for (const t of list.result.tools) {
      expect(t.inputSchema.type).toBe("object");
      expect(t.description.length).toBeGreaterThan(20);
    }
    expect(((await rpc(h, "ping")) as any).result).toEqual({});
    expect(
      await h({ jsonrpc: "2.0", method: "notifications/initialized" }),
    ).toBeNull();
    const bad = (await rpc(h, "resources/list")) as any;
    expect(bad.error.code).toBe(-32601);
    expect(((await h({} as any)) as any).error.code).toBe(-32600);
  });
});

describe("tools", () => {
  it("draws a diagram from a description, lays it out and writes the file", async () => {
    const { files, store } = memory();
    const h = createServer(files);
    const r = await call(h, "trazo_create_diagram", {
      output: "shop",
      nodes: [
        { id: "web", label: "Web", role: "proxy" },
        { id: "api", label: "API" },
        { id: "db", label: "Database", role: "database" },
      ],
      edges: [
        { from: "web", to: "api", label: "https" },
        { from: "api", to: "db" },
        { from: "api", to: "ghost" },
      ],
    });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("3 boxes and 2 arrows into shop.excalidraw");
    expect(r.text).toContain("Skipped");
    const doc = JSON.parse(store.get("shop.excalidraw")!);
    expect(doc.type).toBe("excalidraw");
    expect(doc.elements.filter((e: any) => e.type === "arrow")).toHaveLength(2);
    // and it reads back as the same graph
    const d = await call(h, "trazo_describe", { file: "shop" });
    const s = JSON.parse(d.text);
    expect(s.nodes.map((x: any) => x.label).sort()).toEqual([
      "API",
      "Database",
      "Web",
    ]);
    expect(s.nodes.find((x: any) => x.label === "Database").role).toBe(
      "database",
    );
    expect(s.edges).toHaveLength(2);
  });

  it("imports a docker-compose text and a file from the folder", async () => {
    const { files, store } = memory({ "docker-compose.yml": COMPOSE });
    const h = createServer(files);
    const fromText = await call(h, "trazo_import", {
      text: COMPOSE,
      output: "from-text",
    });
    expect(fromText.text).toContain("Detected Docker Compose");
    const fromFile = await call(h, "trazo_import", {
      files: ["docker-compose.yml"],
    });
    expect(fromFile.text).toContain(
      "docker-compose.excalidraw".replace("docker-compose", "compose"),
    );
    expect([...store.keys()].sort()).toEqual([
      "compose.excalidraw",
      "docker-compose.yml",
      "from-text.excalidraw",
    ]);
  });

  it("edits a file with the same operations as the agent panel", async () => {
    const { files, store } = memory();
    const h = createServer(files);
    await call(h, "trazo_create_diagram", {
      output: "d",
      nodes: [
        { id: "a", label: "API" },
        { id: "b", label: "Database", role: "database" },
      ],
      edges: [{ from: "a", to: "b" }],
    });
    const s = JSON.parse((await call(h, "trazo_describe", { file: "d" })).text);
    const api = s.nodes.find((x: any) => x.label === "API").id;
    const db = s.nodes.find((x: any) => x.label === "Database").id;
    const r = await call(h, "trazo_edit", {
      file: "d.excalidraw",
      ops: [
        {
          op: "add_node",
          id: "c",
          label: "Cache",
          role: "cache",
          between: [api, db],
        },
        { op: "delete_edge", from: api, to: db },
        { op: "add_edge", from: api, to: "c" },
        { op: "add_edge", from: "c", to: db },
        { op: "delete_node", id: "nope" },
      ],
    });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('Added "Cache"');
    expect(r.text).toContain("Not done:");
    const after = JSON.parse(
      (await call(h, "trazo_describe", { file: "d" })).text,
    );
    expect(after.nodes).toHaveLength(3);
    expect(after.edges).toHaveLength(2);
    expect(JSON.parse(store.get("d.excalidraw")!).type).toBe("excalidraw");
  });

  it("can write the edit to another file and leaves the original alone", async () => {
    const { files, store } = memory();
    const h = createServer(files);
    await call(h, "trazo_create_diagram", {
      output: "d",
      nodes: [{ id: "a", label: "A" }],
    });
    const before = store.get("d.excalidraw");
    await call(h, "trazo_edit", {
      file: "d",
      output: "copy",
      ops: [{ op: "add_node", label: "B" }],
    });
    expect(store.get("d.excalidraw")).toBe(before);
    expect(
      JSON.parse(store.get("copy.excalidraw")!).elements.length,
    ).toBeGreaterThan(JSON.parse(before!).elements.length);
  });

  it("does not touch the file when nothing could be done", async () => {
    const { files, store } = memory();
    const h = createServer(files);
    await call(h, "trazo_create_diagram", {
      output: "d",
      nodes: [{ id: "a", label: "A" }],
    });
    const before = store.get("d.excalidraw");
    const r = await call(h, "trazo_edit", {
      file: "d",
      ops: [{ op: "delete_node", id: "zzz" }],
    });
    expect(r.text).toContain("Nothing was changed.");
    expect(store.get("d.excalidraw")).toBe(before);
  });

  it("lists only the diagram files", async () => {
    const { files } = memory({
      "a.excalidraw": "{}",
      "notes.txt": "x",
      "B.EXCALIDRAW": "{}",
    });
    const r = await call(createServer(files), "trazo_list");
    expect(r.text).toBe("B.EXCALIDRAW\na.excalidraw");
    expect(
      (await call(createServer(memory().files), "trazo_list")).text,
    ).toContain("No .excalidraw files");
  });
});

describe("failures are answers the model can read", () => {
  const h = () =>
    createServer(
      memory({ "bad.excalidraw": "not json", "empty.excalidraw": "{}" }).files,
    );

  it("explains a missing file, a broken file and bad input", async () => {
    const server = h();
    expect(
      (await call(server, "trazo_describe", { file: "missing" })).text,
    ).toContain("does not exist");
    expect(
      (await call(server, "trazo_describe", { file: "bad" })).text,
    ).toContain("not valid JSON");
    expect(
      (await call(server, "trazo_describe", { file: "empty" })).text,
    ).toContain('no "elements"');
    expect((await call(server, "trazo_import", {})).text).toContain(
      'Give "text" or "files"',
    );
    expect(
      (await call(server, "trazo_import", { text: "hello world" })).text,
    ).toContain("could not recognise");
    expect(
      (await call(server, "trazo_create_diagram", { output: "x", nodes: [] }))
        .text,
    ).toContain("at least one node");
    expect(
      (
        await call(server, "trazo_create_diagram", {
          output: "x",
          nodes: [
            { id: "a", label: "A" },
            { id: "a", label: "B" },
          ],
        })
      ).text,
    ).toContain("used twice");
    expect(
      (
        await call(server, "trazo_create_diagram", {
          output: "x",
          nodes: [{ id: "a" }],
        })
      ).text,
    ).toContain("id and a label");
    expect((await call(server, "nope")).isError).toBe(true);
    for (const r of [
      await call(server, "trazo_describe", { file: "missing" }),
      await call(server, "trazo_import", {}),
    ]) {
      expect(r.isError).toBe(true);
    }
  });

  it("only ever uses names inside the folder", async () => {
    expect(diagramName("../../etc/passwd")).toBe("passwd.excalidraw");
    expect(diagramName("a\\b\\c.excalidraw")).toBe("c.excalidraw");
    expect(diagramName("..")).toBe("diagram.excalidraw");
    expect(diagramName(".hidden")).toBe("hidden.excalidraw");
    expect(diagramName("we/ird na$me!")).toBe("ird na_me_.excalidraw");
    expect(diagramName("")).toBe("diagram.excalidraw");
    expect(diagramName(undefined, "kubernetes")).toBe("kubernetes.excalidraw");
    const { files } = memory({ ".secret": "x" });
    const r = await call(createServer(files), "trazo_import", {
      files: ["../../.secret"],
    });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("is not a file name");
  });
});

describe("existing diagrams are protected", () => {
  const nodes = [{ id: "a", label: "A" }];

  it("never overwrites a file unless asked to", async () => {
    const { files, store } = memory();
    const h = createServer(files);
    await call(h, "trazo_create_diagram", { output: "d", nodes });
    const first = store.get("d.excalidraw");
    const again = await call(h, "trazo_create_diagram", {
      output: "d",
      nodes: [{ id: "x", label: "Different" }],
    });
    expect(again.isError).toBe(true);
    expect(again.text).toContain("already exists");
    expect(store.get("d.excalidraw")).toBe(first);
    const forced = await call(h, "trazo_create_diagram", {
      output: "d",
      nodes: [{ id: "x", label: "Different" }],
      overwrite: true,
    });
    expect(forced.isError).toBe(false);
    expect(store.get("d.excalidraw")).not.toBe(first);
    // the same protection for imports
    await call(h, "trazo_import", { text: COMPOSE, output: "s" });
    const clash = await call(h, "trazo_import", { text: COMPOSE, output: "s" });
    expect(clash.isError).toBe(true);
    expect(
      (
        await call(h, "trazo_import", {
          text: COMPOSE,
          output: "s",
          overwrite: true,
        })
      ).isError,
    ).toBe(false);
  });

  it("keeps the previous version when it edits a file in place", async () => {
    const { files, store } = memory();
    const h = createServer(files);
    await call(h, "trazo_create_diagram", { output: "d", nodes });
    const before = store.get("d.excalidraw")!;
    const r = await call(h, "trazo_edit", {
      file: "d",
      ops: [{ op: "add_node", label: "B" }],
    });
    expect(r.text).toContain("previous version is in d.excalidraw.bak");
    expect(store.get("d.excalidraw.bak")).toBe(before);
    expect(store.get("d.excalidraw")).not.toBe(before);
    // the backup is not listed as a diagram
    expect((await call(h, "trazo_list")).text).toBe("d.excalidraw");
  });

  it("does not replace another existing file when editing into a different name", async () => {
    const { files, store } = memory();
    const h = createServer(files);
    await call(h, "trazo_create_diagram", { output: "d", nodes });
    await call(h, "trazo_create_diagram", { output: "other", nodes });
    const other = store.get("other.excalidraw");
    const r = await call(h, "trazo_edit", {
      file: "d",
      output: "other",
      ops: [{ op: "add_node", label: "B" }],
    });
    expect(r.isError).toBe(true);
    expect(store.get("other.excalidraw")).toBe(other);
    expect(store.has("d.excalidraw.bak")).toBe(false);
  });
});
