// Which Python the notebook panel runs on: the one in this browser (WebAssembly, the default, sandboxed) or a Jupyter
// server the user runs (their own packages, GDAL, GPUs… and real code on their machine, see docs/NOTEBOOKS.md). The
// choice is remembered; the address is remembered without its token (Jupyter's token is a credential: it lives only
// in memory for the session, and Jupyter itself keeps the login in a cookie).

export type Environment = { kind: "browser" } | { kind: "server"; url: string };

export const STORAGE_KEY = "trazo-notebook-env";

/** where `node tools/jupyter-proxy.mjs` listens by default */
export const DEFAULT_SERVER_URL = "http://127.0.0.1:3003/lab";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

export type ServerUrl = {
  /** the address to load in the panel, token included */
  url: string;
  /** the same without the token: what is shown and remembered */
  clean: string;
};

/**
 * The Jupyter address a person typed, or a sentence saying why it cannot be used. Plain http is only for this machine
 * (a proxy on localhost); anything else must be https. No user names or passwords in the address.
 */
export const parseServerUrl = (raw: string): ServerUrl | string => {
  const text = raw.trim();
  if (!text) {
    return `Type the address of your Jupyter, for example ${DEFAULT_SERVER_URL}`;
  }
  let u: URL;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `http://${text}`);
  } catch {
    return "That is not a valid address.";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return "The address must start with http:// or https://.";
  }
  if (u.username || u.password) {
    return "Do not put a user name or password in the address.";
  }
  if (u.protocol === "http:" && !LOOPBACK.has(u.hostname)) {
    return "Plain http is only for this machine (localhost or 127.0.0.1). Use https for another one.";
  }
  if (u.pathname === "/" || u.pathname === "") {
    u.pathname = "/lab";
  }
  const clean = new URL(u.toString());
  clean.searchParams.delete("token");
  clean.hash = "";
  return { url: u.toString(), clean: clean.toString() };
};

export const loadEnvironment = (
  storage: Pick<Storage, "getItem"> | undefined = safeStorage(),
): Environment => {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (raw) {
      const v = JSON.parse(raw);
      if (v && v.kind === "server" && typeof v.url === "string") {
        const parsed = parseServerUrl(v.url);
        if (typeof parsed !== "string") {
          return { kind: "server", url: parsed.clean };
        }
      }
    }
  } catch {
    /* storage can be blocked or hold something else: the default is the safe answer */
  }
  return { kind: "browser" };
};

export const saveEnvironment = (
  env: Environment,
  storage: Pick<Storage, "setItem"> | undefined = safeStorage(),
): void => {
  try {
    // never the token, even if one slipped into the address
    const value =
      env.kind === "server"
        ? (() => {
            const parsed = parseServerUrl(env.url);
            return typeof parsed === "string"
              ? { kind: "browser" }
              : { kind: "server", url: parsed.clean };
          })()
        : { kind: "browser" };
    storage?.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* private window or blocked storage: the choice just lasts for this session */
  }
};

function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
