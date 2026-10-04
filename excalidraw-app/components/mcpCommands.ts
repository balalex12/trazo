// The commands that connect Claude Code and Claude Desktop to the Trazo MCP server (docs/MCP.md), written for the
// person's own system and folder so they only copy and paste. Pure, so it is tested.
export type Os = "windows" | "mac" | "linux";

export const IMAGE = "trazo-mcp:local";
export const BUILD_COMMAND = "docker compose --profile mcp build mcp";

export const detectOs = (platform: string, userAgent = ""): Os => {
  const s = `${platform} ${userAgent}`.toLowerCase();
  if (s.includes("win")) {
    return "windows";
  }
  if (s.includes("mac") || s.includes("iphone") || s.includes("ipad")) {
    return "mac";
  }
  return "linux";
};

export const defaultFolder = (os: Os): string =>
  os === "windows"
    ? "C:\\Users\\<you>\\Documents\\Trazo"
    : os === "mac"
    ? "/Users/<you>/Trazo"
    : "/home/<you>/Trazo";

/** why this folder cannot go into a command, or "" when it can */
export const folderProblem = (folder: string): string => {
  const f = folder.trim();
  if (!f) {
    return "Type the folder where your diagrams will live.";
  }
  if (/["'`\r\n$]/.test(f)) {
    return "The folder cannot contain quotes, $ or line breaks.";
  }
  if (f.includes("<you>")) {
    return "Replace <you> with your user name (or type any other folder).";
  }
  if (f.includes(":/work")) {
    return "Type only the folder on your computer.";
  }
  return "";
};

/** the docker arguments, one per element; the same for every client */
const dockerArgs = (folder: string) => [
  "run",
  "-i",
  "--rm",
  "--network",
  "none",
  "--read-only",
  "--cap-drop",
  "ALL",
  "--security-opt",
  "no-new-privileges:true",
  "-v",
  `${folder.trim()}:/work`,
  IMAGE,
];

/** Claude Code. On Windows PowerShell `claude` is a script that drops the `--`, so the .cmd is used. */
export const claudeCodeCommand = (os: Os, folder: string): string => {
  const args = dockerArgs(folder);
  const quoted = args.map((a) => (a.includes(":/work") ? `"${a}"` : a));
  return `${
    os === "windows" ? "claude.cmd" : "claude"
  } mcp add --scope user trazo -- docker ${quoted.join(" ")}`;
};

/** What goes inside claude_desktop_config.json */
export const claudeDesktopConfig = (folder: string): string =>
  JSON.stringify(
    {
      mcpServers: { trazo: { command: "docker", args: dockerArgs(folder) } },
    },
    null,
    2,
  );

export const desktopConfigPath = (os: Os): string =>
  os === "windows"
    ? "%APPDATA%\\Claude\\claude_desktop_config.json"
    : os === "mac"
    ? "~/Library/Application Support/Claude/claude_desktop_config.json"
    : "~/.config/Claude/claude_desktop_config.json";
