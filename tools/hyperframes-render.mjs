#!/usr/bin/env node
// Renders an exported Trazo animation (animation.html, "Export HTML player") to a video with HyperFrames, locally.
//
//   node tools/hyperframes-render.mjs animation.html [options]
//
//   -o, --output <file>        where to write the video (default: next to the input, same name)
//   -f, --fps <n>              frames per second (default: the one chosen at export, usually 30)
//   -q, --quality <q>          draft | standard | looks | delivery            (HyperFrames default: looks)
//       --format <f>           mp4 | webm | mov | gif | png-sequence | hls    (default: mp4)
//       --size <WxH>           draw the animation at this size, e.g. 1920x1080 (the slide is centered in it)
//       --resolution <r>       1080p | 4k | ...: render at a higher pixel density than --size (aspect must match)
//   -w, --workers <n|auto>     parallel Chrome processes (default: auto)
//       --docker               render inside Docker (pinned Chromium and fonts: identical on every machine)
//   -h, --help
//
// It needs Node.js 22+, FFmpeg and a Chrome/Chromium (HyperFrames drives it; set PUPPETEER_EXECUTABLE_PATH to use
// your own). The first run downloads the `hyperframes` npm package (pinned below) with npx: that is the only network
// use, it happens in this optional tool and never in the app. HyperFrames' anonymous telemetry and update check are
// switched off, and the animation file itself is never uploaded anywhere.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";

/** the HyperFrames version this was tested against (render, custom timeline, audio mix) */
export const HYPERFRAMES_VERSION = "0.8.162";

const USAGE = readFileSync(new URL(import.meta.url), "utf8")
  .split("\n")
  .slice(1, 17)
  .map((l) => l.replace(/^\/\/ ?/, ""))
  .join("\n");

/**
 * The composition that HyperFrames renders: the exported file with the narration (a data: URI, which the player
 * plays itself) written out as a real file, because HyperFrames mixes audio from files. `size` re-sizes the stage.
 * Pure: returns the new html and the files to write next to it.
 */
const PAYLOAD_START = "window.__TRAZO_PAYLOAD__=";
const PAYLOAD_END = ";</script>";

/** the player's data is a JSON literal in the file: set the size it draws at */
const setPayloadSize = (html, w, h) => {
  const from = html.indexOf(PAYLOAD_START);
  const to = from < 0 ? -1 : html.indexOf(PAYLOAD_END, from);
  if (to < 0) return html;
  const payload = JSON.parse(html.slice(from + PAYLOAD_START.length, to));
  payload.width = w;
  payload.height = h;
  return (
    html.slice(0, from + PAYLOAD_START.length) +
    JSON.stringify(payload).replace(/</g, "\\u003c") +
    html.slice(to)
  );
};

export const prepareComposition = (html, { size } = {}) => {
  const files = {};
  let out = html.replace(
    /(<audio\b[^>]*?\bsrc=")data:audio\/wav;base64,([A-Za-z0-9+/=]+)(")/,
    (_m, a, b64, c) => {
      files["narration.wav"] = Buffer.from(b64, "base64");
      return `${a}narration.wav${c}`;
    },
  );
  if (size) {
    const [w, h] = size;
    out = out
      .replace(/data-width="\d+" data-height="\d+"/, `data-width="${w}" data-height="${h}"`)
      .replace(/(id="trazo-root"[^>]*style=")width:\d+px;height:\d+px/, `$1width:${w}px;height:${h}px`)
      .replace(/:root\{--w:\d+px;--h:\d+px\}/, `:root{--w:${w}px;--h:${h}px}`)
      ;
    out = setPayloadSize(out, w, h);
  }
  return { html: out, files };
};

export const parseArgs = (argv) => {
  const o = { input: "", output: "", flags: [], size: null, docker: false };
  const take = (i, name) => {
    if (i + 1 >= argv.length) throw new Error(`${name} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") o.help = true;
    else if (a === "-o" || a === "--output") o.output = take(i++, a);
    else if (a === "-f" || a === "--fps") o.flags.push("--fps", take(i++, a));
    else if (a === "-q" || a === "--quality") o.flags.push("--quality", take(i++, a));
    else if (a === "--format") o.flags.push("--format", (o.format = take(i++, a)));
    else if (a === "--resolution") o.flags.push("--resolution", take(i++, a));
    else if (a === "-w" || a === "--workers") o.flags.push("--workers", take(i++, a));
    else if (a === "--docker") o.docker = true;
    else if (a === "--size") {
      const m = /^(\d{2,5})x(\d{2,5})$/.exec(take(i++, a));
      if (!m) throw new Error("--size must look like 1920x1080");
      o.size = [Number(m[1]), Number(m[2])];
    } else if (a.startsWith("-")) throw new Error(`Unknown option ${a}`);
    else if (!o.input) o.input = a;
    else throw new Error(`Unexpected argument ${a}`);
  }
  return o;
};

const main = () => {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
    if (o.help || !o.input) {
      console.log(USAGE);
      process.exit(o.help ? 0 : 1);
    }
  } catch (e) {
    console.error(`${e.message}\n\n${USAGE}`);
    process.exit(1);
  }
  if (Number(process.versions.node.split(".")[0]) < 22) {
    console.error(`HyperFrames needs Node.js 22 or newer (this is ${process.versions.node}).`);
    process.exit(1);
  }
  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0) {
    console.error("FFmpeg was not found. Install it (for example: apt install ffmpeg, brew install ffmpeg) and try again.");
    process.exit(1);
  }
  const input = resolve(o.input);
  const ext = { mp4: ".mp4", webm: ".webm", mov: ".mov", gif: ".gif" }[o.format || "mp4"];
  const output = resolve(o.output || join(dirname(input), basename(input, extname(input)) + (ext || "")));
  const { html, files } = prepareComposition(readFileSync(input, "utf8"), { size: o.size });
  if (!/data-composition-id="trazo"/.test(html)) {
    console.error(`${o.input} is not a Trazo animation (use Animation > Export HTML player).`);
    process.exit(1);
  }
  const dir = mkdtempSync(join(tmpdir(), "trazo-hyperframes-"));
  try {
    writeFileSync(join(dir, "index.html"), html);
    for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, name), data);
    const args = ["--yes", `hyperframes@${HYPERFRAMES_VERSION}`, "render", dir, "--output", output, ...o.flags];
    if (o.docker) args.push("--docker");
    console.log(`Rendering ${basename(input)} with HyperFrames ${HYPERFRAMES_VERSION}...`);
    // HyperFrames sends anonymous usage data and checks npm for updates unless told not to: Trazo is local-first,
    // so both are switched off (DO_NOT_TRACK is the cross-tool convention).
    const env = { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", DO_NOT_TRACK: "1", HYPERFRAMES_NO_UPDATE_CHECK: "1" };
    const r = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", args, { stdio: "inherit", env });
    if (r.status !== 0) process.exit(r.status || 1);
    console.log(`Done: ${output}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  main();
}
