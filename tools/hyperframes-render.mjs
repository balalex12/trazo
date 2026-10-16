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
//       --tts                  speak each slide's narration script with a local voice (Kokoro, via HyperFrames) and
//                              put it in the video: slides stay on screen as long as their script takes to say
//       --voice <id>           voice for --tts (default for the language, e.g. ef_dora for Spanish)
//       --lang <code>          language for --tts: en-us, en-gb, es, fr-fr, it, pt-br, hi, ja, zh (default en-us)
//       --speed <x>            speech speed for --tts (default 1.0)
//       --save-player <file>   also save the animation with that narration inside it, as a player that speaks
//   -w, --workers <n|auto>     parallel Chrome processes (default: auto)
//       --docker               render inside Docker (pinned Chromium and fonts: identical on every machine)
//       --check                check the composition with HyperFrames (lint, runtime, layout, motion, contrast) instead
//                              of rendering it; add --json for the machine-readable report
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
import { pathToFileURL } from "node:url";

import {
  VOICES,
  loadModules,
  narrateComposition,
  scriptedSlides,
  readPayload,
  synthesize,
  withEmbeddedAudio,
} from "./hyperframes-narrate.mjs";

/** the HyperFrames version this was tested against (render, custom timeline, audio mix) */
export const HYPERFRAMES_VERSION = "0.8.162";

const USAGE = readFileSync(new URL(import.meta.url), "utf8")
  .split("\n")
  .slice(1, 26)
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
      .replace(
        /data-width="\d+" data-height="\d+"/,
        `data-width="${w}" data-height="${h}"`,
      )
      .replace(
        /(id="trazo-root"[^>]*style=")width:\d+px;height:\d+px/,
        `$1width:${w}px;height:${h}px`,
      )
      .replace(/:root\{--w:\d+px;--h:\d+px\}/, `:root{--w:${w}px;--h:${h}px}`);
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
    else if (a === "-q" || a === "--quality")
      o.flags.push("--quality", take(i++, a));
    else if (a === "--format")
      o.flags.push("--format", (o.format = take(i++, a)));
    else if (a === "--resolution") o.flags.push("--resolution", take(i++, a));
    else if (a === "-w" || a === "--workers")
      o.flags.push("--workers", take(i++, a));
    else if (a === "--docker") o.docker = true;
    else if (a === "--tts") o.tts = true;
    else if (a === "--check") o.check = true;
    else if (a === "--json") o.json = true;
    else if (a === "--voice") o.voice = take(i++, a);
    else if (a === "--lang") o.lang = take(i++, a);
    else if (a === "--speed") {
      o.speed = Number(take(i++, a));
      if (!(o.speed >= 0.5 && o.speed <= 2))
        throw new Error("--speed must be between 0.5 and 2");
    } else if (a === "--save-player") o.savePlayer = take(i++, a);
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

const main = async () => {
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
    console.error(
      `HyperFrames needs Node.js 22 or newer (this is ${process.versions.node}).`,
    );
    process.exit(1);
  }
  if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0) {
    console.error(
      "FFmpeg was not found. Install it (for example: apt install ffmpeg, brew install ffmpeg) and try again.",
    );
    process.exit(1);
  }
  const input = resolve(o.input);
  const ext = { mp4: ".mp4", webm: ".webm", mov: ".mov", gif: ".gif" }[
    o.format || "mp4"
  ];
  const output = resolve(
    o.output ||
      join(dirname(input), basename(input, extname(input)) + (ext || "")),
  );
  let { html, files } = prepareComposition(readFileSync(input, "utf8"), {
    size: o.size,
  });
  // a Trazo animation (Export HTML player) or any other HyperFrames composition, for example one written by
  // "Compose with AI": both have a composition id
  if (!/data-composition-id\s*=\s*["'][^"']+["']/.test(html)) {
    console.error(
      `${o.input} is not a HyperFrames composition (it has no data-composition-id). Use Animation > Export HTML player or Compose with AI.`,
    );
    process.exit(1);
  }
  if (o.tts) {
    if (!/window\.__TRAZO_PAYLOAD__=/.test(html)) {
      console.error(
        "--tts needs a Trazo animation (Export HTML player): it speaks the narration scripts of its slides.",
      );
      process.exit(1);
    }
    const slides = scriptedSlides(readPayload(html).payload);
    if (!slides.length) {
      console.error(
        "No slide has a narration script. Write one in the slide list (or use ✨ Direct with AI) and export again.",
      );
      process.exit(1);
    }
    try {
      console.log(
        `Making ${slides.length} voice clip${
          slides.length === 1 ? "" : "s"
        } on this computer...`,
      );
      const voice = o.voice || (o.lang ? VOICES[o.lang] : undefined);
      const clips = synthesize(slides, {
        version: HYPERFRAMES_VERSION,
        voice,
        lang: o.lang,
        speed: o.speed,
      });
      const modules = await loadModules();
      const narrated = narrateComposition(html, clips, modules);
      html = narrated.html;
      files = { ...files, ...narrated.files };
      console.log(
        `Narration: ${(narrated.totalMs / 1000).toFixed(1)} s in all.`,
      );
      if (o.savePlayer) {
        writeFileSync(
          resolve(o.savePlayer),
          withEmbeddedAudio(html, files["narration.wav"], modules),
        );
        console.log(`Saved the narrated player: ${resolve(o.savePlayer)}`);
      }
    } catch (e) {
      console.error(e.message);
      process.exit(1);
    }
  }
  const dir = mkdtempSync(join(tmpdir(), "trazo-hyperframes-"));
  try {
    writeFileSync(join(dir, "index.html"), html);
    for (const [name, data] of Object.entries(files))
      writeFileSync(join(dir, name), data);
    const pkg = `hyperframes@${HYPERFRAMES_VERSION}`;
    const args = o.check
      ? ["--yes", pkg, "check", dir, ...(o.json ? ["--json"] : [])]
      : ["--yes", pkg, "render", dir, "--output", output, ...o.flags];
    if (o.docker && !o.check) args.push("--docker");
    if (!o.json) {
      console.log(
        `${o.check ? "Checking" : "Rendering"} ${basename(
          input,
        )} with HyperFrames ${HYPERFRAMES_VERSION}...`,
      );
    }
    // HyperFrames sends anonymous usage data and checks npm for updates unless told not to: Trazo is local-first,
    // so both are switched off (DO_NOT_TRACK is the cross-tool convention).
    const env = {
      ...process.env,
      HYPERFRAMES_NO_TELEMETRY: "1",
      DO_NOT_TRACK: "1",
      HYPERFRAMES_NO_UPDATE_CHECK: "1",
    };
    const r = spawnSync(
      process.platform === "win32" ? "npx.cmd" : "npx",
      args,
      { stdio: "inherit", env },
    );
    if (r.status !== 0) process.exit(r.status || 1);
    if (!o.check) console.log(`Done: ${output}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// run only when started directly. Compare file URLs: on Windows the path of this file is not
// the pathname of its URL ("C:\x" against "/C:/x"), and a wrong comparison made the tool do nothing, silently.
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main();
}
