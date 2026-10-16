// Puts a Jupyter server you run yourself (JupyterLab on your machine, in a container, in a conda environment…) next to
// the Trazo canvas: this small local proxy adds the bridge script (tools/lite-bridge.js) to JupyterLab's page and lets
// the Trazo app embed it, so the notebook panel works the same as with the notebook in the browser, but with YOUR
// Python (GDAL, PyTorch, your data and packages).
//
//   jupyter lab --no-browser --LabApp.expose_app_in_browser=True            # in your environment; it prints a URL with a token
//   node tools/jupyter-proxy.mjs --target http://127.0.0.1:8888             # then, in Trazo: Notebook > Jupyter server
//   (open http://127.0.0.1:3003/lab?token=<the token Jupyter printed>)
//
// This runs real code on the machine that runs that Jupyter: nothing sandboxes it. The proxy therefore:
//   - listens on 127.0.0.1 only, and answers only to requests whose Host is itself (so a web page cannot reach it
//     through DNS rebinding),
//   - forwards the target's own authentication untouched (Jupyter's token stays Jupyter's: the proxy adds no login and
//     never keeps the token),
//   - refuses a target that is not on this machine unless you say --allow-remote-target,
//   - changes the target's answers in only two ways: it lets the Trazo origins embed the page (frame-ancestors) and
//     it adds the bridge script.
//   Nothing else is read, logged or stored.
import { readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PARENT_ORIGINS } from "./build-jupyterlite.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULTS = { target: "http://127.0.0.1:8888", port: 3003 };

/** a hostname that means "this machine" */
export const isLoopbackHost = (host) =>
  ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host) ||
  /^127\.\d+\.\d+\.\d+$/.test(host);

/** What the proxy was asked for, or throws with a sentence for the person who started it */
export const parseOptions = (argv) => {
  const opts = {
    ...DEFAULTS,
    parents: [...PARENT_ORIGINS],
    allowRemoteTarget: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value.`);
      return argv[++i];
    };
    if (arg === "--target") opts.target = value();
    else if (arg === "--port") opts.port = Number(value());
    else if (arg === "--parent") opts.parents.push(value().replace(/\/+$/, ""));
    else if (arg === "--allow-remote-target") opts.allowRemoteTarget = true;
    else
      throw new Error(
        `Unknown option ${arg}. Options: --target URL, --port N, --parent ORIGIN, --allow-remote-target.`,
      );
  }
  let target;
  try {
    target = new URL(opts.target);
  } catch {
    throw new Error(`--target is not a URL: ${opts.target}`);
  }
  if (target.protocol !== "http:") {
    throw new Error(
      "--target must be an http:// URL (the proxy talks to Jupyter directly; use a local address or a tunnel).",
    );
  }
  if (!isLoopbackHost(target.hostname) && !opts.allowRemoteTarget) {
    throw new Error(
      `${target.hostname} is not on this machine. A remote Jupyter runs code elsewhere and sends your canvas there: add --allow-remote-target if that is what you want.`,
    );
  }
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) {
    throw new Error("--port must be a number between 1 and 65535.");
  }
  opts.targetUrl = target;
  return opts;
};

/** the bridge script with the Trazo origins filled in */
export const bridgeSource = (parents) =>
  readFileSync(path.join(here, "lite-bridge.js"), "utf8").replace(
    "__TRAZO_PARENT_ORIGINS__",
    JSON.stringify(parents),
  );

/** Jupyter's Content-Security-Policy with the Trazo origins allowed to embed the page (its other directives stay) */
export const allowEmbedding = (csp, parents) => {
  const ancestors = `frame-ancestors 'self' ${parents.join(" ")}`;
  if (!csp) return ancestors;
  const directives = csp
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean);
  const without = directives.filter((d) => !/^frame-ancestors\b/i.test(d));
  return [...without, ancestors].join("; ");
};

/** The page of JupyterLab with the bridge loaded (a script of its own origin, so no policy needs changing) */
export const injectBridge = (html) =>
  html.includes("/trazo-bridge.js")
    ? html
    : html.replace(
        /<\/head>/i,
        '<script defer src="/trazo-bridge.js"></script></head>',
      );

export const createProxy = (opts) => {
  const target = opts.targetUrl;
  const targetPort = Number(target.port || 80);
  const source = bridgeSource(opts.parents);
  const own = (host) =>
    host === `127.0.0.1:${opts.port}` || host === `localhost:${opts.port}`;

  const server = http.createServer((req, res) => {
    // a request for another name (DNS rebinding) gets nothing
    if (!own(req.headers.host)) {
      res.writeHead(421, { "Content-Type": "text/plain" });
      res.end("Misdirected request");
      return;
    }
    const pathname = req.url.split("?")[0];
    if (pathname === "/trazo-bridge.js") {
      res.writeHead(200, {
        "Content-Type": "application/javascript",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(source);
      return;
    }
    const upstream = http.request(
      {
        host: target.hostname,
        port: targetPort,
        method: req.method,
        path: req.url,
        // the Host and Origin are passed on as they came (Jupyter compares them), the page is asked uncompressed
        headers: { ...req.headers, "accept-encoding": "identity" },
      },
      (answer) => {
        const headers = { ...answer.headers };
        delete headers["x-frame-options"];
        if (
          headers["content-security-policy"] !== undefined ||
          /^\/(lab|tree|notebooks|doc|edit|consoles|terminals)\b/.test(pathname)
        ) {
          headers["content-security-policy"] = allowEmbedding(
            headers["content-security-policy"],
            opts.parents,
          );
        }
        const isPage =
          /text\/html/i.test(headers["content-type"] || "") &&
          /^\/(lab|doc)\b/.test(pathname);
        if (!isPage) {
          res.writeHead(answer.statusCode, headers);
          answer.pipe(res);
          return;
        }
        const chunks = [];
        answer.on("data", (c) => chunks.push(c));
        answer.on("end", () => {
          const body = Buffer.from(
            injectBridge(Buffer.concat(chunks).toString("utf8")),
            "utf8",
          );
          delete headers["content-length"];
          delete headers["transfer-encoding"];
          res.writeHead(answer.statusCode, {
            ...headers,
            "content-length": body.length,
          });
          res.end(body);
        });
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent)
        res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Could not reach the Jupyter server");
    });
    req.pipe(upstream);
  });

  // WebSockets (the kernels' channels): the handshake and then the bytes are passed on as they are
  server.on("upgrade", (req, socket, head) => {
    if (!own(req.headers.host)) {
      socket.write(
        "HTTP/1.1 421 Misdirected Request\r\nConnection: close\r\n\r\n",
        () => socket.destroy(),
      );
      return;
    }
    const upstream = net.connect(targetPort, target.hostname, () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2)
        lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head && head.length) upstream.write(head);
      socket.pipe(upstream);
      upstream.pipe(socket);
    });
    const close = () => {
      socket.destroy();
      upstream.destroy();
    };
    // when either side goes away, so does the other (a closed browser tab must not leave a connection to Jupyter)
    for (const end of [upstream, socket]) {
      end.on("error", close);
      end.on("end", close); // a WebSocket does not need a half-open connection: a FIN closes both sides
      end.on("close", close);
    }
  });
  return server;
};

const main = () => {
  let opts;
  try {
    opts = parseOptions(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  const server = createProxy(opts);
  server.listen(opts.port, "127.0.0.1", () => {
    console.log(
      `Trazo's Jupyter proxy: http://127.0.0.1:${opts.port}  ->  ${opts.targetUrl.origin}`,
    );
    console.log(
      `Open  http://127.0.0.1:${opts.port}/lab?token=<your Jupyter token>  in Trazo (Notebook > Jupyter server).`,
    );
    console.log(`Allowed to embed it: ${opts.parents.join(", ")}`);
    if (!isLoopbackHost(opts.targetUrl.hostname)) {
      console.log(
        `WARNING: ${opts.targetUrl.hostname} is not on this machine.`,
      );
    }
  });
};

if (import.meta.url === `file://${process.argv[1]}`) main();
