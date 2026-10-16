// Narration from the slides' scripts, for tools/hyperframes-render.mjs: a voice for each slide's script (made
// locally by HyperFrames' text to speech, Kokoro-82M), placed on the timeline where its slide begins, with the slide
// lengthened to fit. The timeline maths is the app's own (excalidraw-app/animation/timeline.ts), bundled on the fly,
// so what is rendered here matches what the player computes.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const animation = resolve(here, "../excalidraw-app/animation");

/** the app's timeline and player helpers, bundled to plain JS and imported */
export const loadModules = async () => {
  const { build } = await import("esbuild"); // only the command line needs it
  const result = await build({
    stdin: {
      contents: `export * from "./timeline.ts"; export { encodeWav, resample, toBase64 } from "./htmlPlayer.ts";`,
      resolveDir: animation,
      sourcefile: "narrate-entry.ts",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    logLevel: "error",
  });
  const code = result.outputFiles[0].text;
  return import(
    `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
  );
};

/** a few good defaults: the voice HyperFrames suggests for each language */
export const VOICES = {
  "en-us": "af_heart",
  "en-gb": "bf_emma",
  es: "ef_dora",
  "fr-fr": "ff_siwis",
  pt: "pf_dora",
  "pt-br": "pf_dora",
  it: "if_sara",
  hi: "hf_alpha",
  ja: "jf_alpha",
  zh: "zf_xiaobei",
};

/** samples (mono, -1..1) and rate of a PCM or float WAV */
export const readWav = (bytes) => {
  const b = Buffer.from(bytes);
  if (
    b.toString("ascii", 0, 4) !== "RIFF" ||
    b.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("The text to speech did not produce a WAV file.");
  }
  let at = 12;
  let fmt = null;
  while (at + 8 <= b.length) {
    const id = b.toString("ascii", at, at + 4);
    const size = b.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt ") {
      fmt = {
        format: b.readUInt16LE(body),
        channels: b.readUInt16LE(body + 2),
        rate: b.readUInt32LE(body + 4),
        bits: b.readUInt16LE(body + 14),
      };
    } else if (id === "data" && fmt) {
      const step = (fmt.bits / 8) * fmt.channels;
      const n = Math.floor(Math.min(size, b.length - body) / step);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const o = body + i * step; // the first channel is the voice
        out[i] =
          fmt.format === 3
            ? b.readFloatLE(o)
            : fmt.bits === 16
            ? b.readInt16LE(o) / 32768
            : fmt.bits === 24
            ? b.readIntLE(o, 3) / 8388608
            : fmt.bits === 32
            ? b.readInt32LE(o) / 2147483648
            : (b.readUInt8(o) - 128) / 128;
      }
      return { samples: out, rate: fmt.rate };
    }
    at = body + size + (size % 2);
  }
  throw new Error("That WAV file has no audio data.");
};

const PAYLOAD_START = "window.__TRAZO_PAYLOAD__=";
const PAYLOAD_END = ";</script>";

export const readPayload = (html) => {
  const from = html.indexOf(PAYLOAD_START);
  const to = from < 0 ? -1 : html.indexOf(PAYLOAD_END, from);
  if (to < 0) throw new Error("This is not a Trazo animation file.");
  return {
    payload: JSON.parse(html.slice(from + PAYLOAD_START.length, to)),
    from: from + PAYLOAD_START.length,
    to,
  };
};

/** the slides that have a script, in order: [{ index, frameId, script }] */
export const scriptedSlides = (payload) =>
  payload.slides
    .map((s, index) => ({
      index,
      frameId: s.frame.id,
      script:
        typeof s.frame.customData?.script === "string"
          ? s.frame.customData.script.trim()
          : "",
    }))
    .filter((s) => s.script);

/**
 * Puts the narration into the composition. `clips` is [{ frameId, samples, rate }]: the voice of each scripted slide.
 * Each slide is lengthened to the length of its clip (plus the app's usual short tail), the clips are mixed into one
 * track at the moment their slide begins, and the track becomes the composition's <audio>. Pure apart from the
 * modules it is given, so it can be tested with made-up clips.
 */
export const narrateComposition = (html, clips, modules) => {
  const { payload, from, to } = readPayload(html);
  const rate = 24000;
  const narrationMs = {};
  const voices = clips.map((c) => {
    const samples = modules.resample(c.samples, c.rate, rate);
    narrationMs[c.frameId] = Math.round((samples.length / rate) * 1000);
    return { frameId: c.frameId, samples };
  });
  const settings = { ...payload.settings, narrationMs };
  const slides = payload.slides;
  const total = modules.totalDurationMs(slides, settings);
  const starts = modules.narrationStarts(slides, settings);
  const track = new Float32Array(Math.ceil((total / 1000) * rate));
  for (const v of voices) {
    const index = slides.findIndex((s) => s.frame.id === v.frameId);
    const at = Math.round((starts[index] / 1000) * rate);
    for (let i = 0; i < v.samples.length && at + i < track.length; i++) {
      track[at + i] += v.samples[i];
    }
  }
  for (let i = 0; i < track.length; i++)
    track[i] = Math.max(-1, Math.min(1, track[i]));
  const wav = Buffer.from(modules.encodeWav(track, rate));

  const secs = Math.round(total) / 1000;
  const next = { ...payload, settings, hasAudio: true };
  let out =
    html.slice(0, from) +
    JSON.stringify(next).replace(/</g, "\\u003c") +
    html.slice(to);
  out = out.replace(/data-duration="[\d.]+"/g, `data-duration="${secs}"`);
  out = out.replace(/<audio id="trazo-audio"[^>]*><\/audio>/, "");
  out = out.replace(
    "<script>window.__TRAZO_PAYLOAD__=",
    `<audio id="trazo-audio" preload="auto" data-start="0" data-duration="${secs}" data-track-index="1" src="narration.wav"></audio>\n<script>window.__TRAZO_PAYLOAD__=`,
  );
  return {
    html: out,
    files: { "narration.wav": wav },
    totalMs: total,
    narrationMs,
  };
};

/** the same file with the narration inside it (a data: URI), to keep as a player that speaks */
export const withEmbeddedAudio = (html, wav, modules) =>
  html.replace(
    'src="narration.wav"',
    `src="data:audio/wav;base64,${modules.toBase64(wav)}"`,
  );

/** one voice clip per scripted slide, with HyperFrames' local text to speech */
export const synthesize = (
  slides,
  { version, voice, lang, speed, env = process.env },
) => {
  const dir = mkdtempSync(join(tmpdir(), "trazo-tts-"));
  const clips = [];
  try {
    for (const s of slides) {
      const out = join(dir, `slide-${s.index + 1}.wav`);
      const args = [
        "--yes",
        `hyperframes@${version}`,
        "tts",
        s.script,
        "--output",
        out,
      ];
      if (voice) args.push("--voice", voice);
      if (lang) args.push("--lang", lang);
      if (speed) args.push("--speed", String(speed));
      console.log(
        `  voice for slide ${s.index + 1}: ${
          s.script.length > 60 ? `${s.script.slice(0, 57)}...` : s.script
        }`,
      );
      const r = spawnSync(
        process.platform === "win32" ? "npx.cmd" : "npx",
        args,
        {
          encoding: "utf8",
          env: {
            ...env,
            HYPERFRAMES_NO_TELEMETRY: "1",
            DO_NOT_TRACK: "1",
            HYPERFRAMES_NO_UPDATE_CHECK: "1",
          },
        },
      );
      if (r.status !== 0) {
        const text = `${r.stdout || ""}${r.stderr || ""}`.replace(
          /\x1b\[[0-9;?]*[A-Za-z]/g,
          "",
        );
        if (/kokoro-onnx/.test(text)) {
          throw new Error(
            "The local text to speech needs Python with two packages: pip install kokoro-onnx soundfile\n" +
              "(or point HYPERFRAMES_PYTHON at a Python that has them). The first run also downloads the voice model.",
          );
        }
        throw new Error(
          `Text to speech failed for slide ${s.index + 1}:\n${text
            .trim()
            .split("\n")
            .slice(-6)
            .join("\n")}`,
        );
      }
      const { samples, rate } = readWav(readFileSync(out));
      clips.push({ frameId: s.frameId, samples, rate });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  return clips;
};
