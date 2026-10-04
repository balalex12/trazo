import {
  BUILD_COMMAND,
  claudeCodeCommand,
  claudeDesktopConfig,
  defaultFolder,
  desktopConfigPath,
  detectOs,
  folderProblem,
} from "./mcpCommands";

describe("MCP connection commands", () => {
  it("recognizes the system", () => {
    expect(detectOs("Win32")).toBe("windows");
    expect(detectOs("MacIntel")).toBe("mac");
    expect(detectOs("Linux x86_64")).toBe("linux");
    expect(detectOs("", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(
      "windows",
    );
  });

  it("builds the Claude Code command, with claude.cmd on Windows only", () => {
    const win = claudeCodeCommand(
      "windows",
      "C:\\Users\\ana\\Documents\\Trazo",
    );
    expect(
      win.startsWith(
        "claude.cmd mcp add --scope user trazo -- docker run -i --rm",
      ),
    ).toBe(true);
    expect(win).toContain(
      '-v "C:\\Users\\ana\\Documents\\Trazo:/work" trazo-mcp:local',
    );
    expect(win).toContain("--network none --read-only --cap-drop ALL");
    const mac = claudeCodeCommand("mac", "/Users/ana/Trazo");
    expect(
      mac.startsWith("claude mcp add --scope user trazo -- docker run"),
    ).toBe(true);
    expect(mac).toContain('-v "/Users/ana/Trazo:/work"');
  });

  it("builds a Claude Desktop config that is valid JSON with the path escaped", () => {
    const text = claudeDesktopConfig("C:\\Users\\ana\\Documents\\Trazo");
    const json = JSON.parse(text);
    expect(json.mcpServers.trazo.command).toBe("docker");
    expect(json.mcpServers.trazo.args).toContain(
      "C:\\Users\\ana\\Documents\\Trazo:/work",
    );
    expect(json.mcpServers.trazo.args.slice(-1)[0]).toBe("trazo-mcp:local");
    expect(json.mcpServers.trazo.args).toEqual(
      expect.arrayContaining(["--network", "none", "--read-only"]),
    );
  });

  it("gives the build command, the config file path and a default folder per system", () => {
    expect(BUILD_COMMAND).toBe("docker compose --profile mcp build mcp");
    expect(desktopConfigPath("windows")).toContain("%APPDATA%");
    expect(desktopConfigPath("mac")).toContain("Application Support");
    expect(defaultFolder("windows")).toContain("<you>");
  });

  it("refuses a folder that cannot go safely into a command", () => {
    expect(folderProblem("")).toMatch(/Type the folder/);
    expect(folderProblem("C:\\Users\\<you>\\Trazo")).toMatch(/Replace <you>/);
    expect(folderProblem('C:\\a" && calc && "')).toMatch(/quotes/);
    expect(folderProblem("/tmp/$(whoami)")).toMatch(/quotes/);
    expect(folderProblem("/home/ana\nrm -rf")).toMatch(/line breaks/);
    expect(folderProblem("/home/ana/Trazo:/work")).toMatch(/only the folder/);
    expect(folderProblem("C:\\Users\\ana\\Documents\\Trazo")).toBe("");
    expect(folderProblem("/Users/ana/My Diagrams")).toBe("");
  });
});
