# HTML player and HyperFrames video

**Animation → Export HTML player** saves your slides as **one `.html` file** that is two things at once:

1. a **player** that works offline in any browser (a phone included): play, pause, scrub, previous / next slide, captions, narration, full screen, with the same transitions as the editor (Smart, Fade, Cut, Build, Pan);
2. a **[HyperFrames](https://github.com/heygen-com/hyperframes) composition**: HyperFrames is an open source (Apache 2.0) framework that renders HTML to video by asking a headless Chrome for each frame, one by one. Because the file is a composition, you can turn it into a **4K, 60 fps or transparent video, frame accurate and reproducible**, from your own machine.

![The player running in a browser](media/v5-html-player.png)

## Why this is different from Export MP4

|  | Export MP4 / GIF (in the browser) | HTML player | HyperFrames render of that file |
| --- | --- | --- | --- |
| Result | a video | a vector page you can open, share and embed | a video |
| Quality | what the browser's encoder gives at the width you chose | sharp at any size, selectable at any zoom | CRF 16 by default, up to 4K and 240 fps, ProRes with alpha, WebM, GIF, HLS, PNG sequence |
| Same picture every time | depends on the browser | yes | yes: each frame is requested by its time, never "played" |
| Narration | mixed into the MP4 | inside the file, in sync | mixed into the video with AAC |
| Needs | Chrome or Edge (WebCodecs) | any browser | Node 22, FFmpeg, Chrome (it runs on your machine) |

The picture is drawn by **Excalidraw's own SVG renderer** and Trazo's own timeline, bundled into the file, so a slide looks exactly like it does in the editor, hand-drawn strokes included. Nothing is fetched: slides, images, the fonts the slides use and the narration are all inside the file (about 350 KB plus your images and audio; the narration is 16 bit mono at 24 kHz, about 2.9 MB per minute).

Frames of the video that HyperFrames rendered from that file (1920 x 1080, with the narration track):

![Three frames of the rendered video](media/v5-hyperframes-frames.png)

## Use it

1. **Animation → Export HTML player.** It saves `animation.html` (the narration is included when you have recorded it and "Use my narration" is ticked). The size of the composition is the **Width** setting, with the aspect ratio of your first slide.
2. Open it in a browser. Click or `Space` plays and pauses, `←` `→` change slide, `C` toggles captions, `F` is full screen, `Home` goes back to the start. The controls fade out while it plays.
3. For a video, with Node.js 22+, FFmpeg and Chrome or Chromium installed:

```
node tools/hyperframes-render.mjs animation.html
node tools/hyperframes-render.mjs animation.html --size 1920x1080 --resolution 4k --fps 60 --quality delivery -o talk-4k.mp4
node tools/hyperframes-render.mjs animation.html --format webm
```

Options: `-o/--output`, `-f/--fps`, `-q/--quality draft|standard|looks|delivery`, `--format mp4|webm|mov|gif|png-sequence|hls`, `--size WxH` (the animation is drawn at this size, the slide centered in it), `--resolution 1080p|4k|…` (more pixels at the same layout; the aspect ratio must match, so use `--size 1920x1080 --resolution 4k` for 4K), `-w/--workers`, `--docker` (Chromium, fonts and FFmpeg pinned, identical on every machine). Set `PUPPETEER_EXECUTABLE_PATH` to use your own Chrome.

The script writes the narration out as a real file (HyperFrames mixes audio from files, not from `data:` URIs), renders in a temporary folder and removes it. It uses `hyperframes@0.8.162`, the version this was tested with.

## What was verified

Run against `hyperframes` 0.8.162 on Linux (Node 22, FFmpeg, headless Chrome 152):

- A composition with **no animation library at all** renders: Trazo registers its own seekable timeline in `window.__timelines["trazo"]` (`duration`, `seek`, `time`, `totalTime`, `progress`, `pause`, `paused`). HyperFrames' starter project loads GSAP from a CDN, which fails offline; this file has no external dependency.
- The frames are drawn **asynchronously** (the SVG renderer is async) and still come out right: a test with a timeline that only moves its element after a microtask and a timer produced the correct frame at 0.5 s, 1.0 s and 1.9 s.
- A real export from the app (three slides, Smart and Build transitions, captions, the Excalifont hand-drawn font inlined) renders to a 1280 x 800, 30 fps, 6.4 s H.264 video in 13 s, with the controls hidden and the captions in place; `--size 1920x1080` gives 1920 x 1080.
- **Narration** is mixed into an AAC track when it is a file. A `data:` URI is refused by HyperFrames ("Source not found for audio element"), which is why the render script extracts it.
- The page tells it is being rendered (`window.__hf` exists and `navigator.webdriver` is true) and hides the controls; add `?render` to the address to see the same view in a normal browser.

Not verified: GPU encoding, `--hdr`, `--docker`, Windows and macOS, very long animations, animations with many large images.

## Local-first notes

- The app itself never talks to HyperFrames; the render is a separate command you run.
- `npx` downloads the `hyperframes` package the first time (from the npm registry). That is the only network use, and it is in this optional tool.
- HyperFrames sends anonymous usage data and checks npm for updates unless told not to; the script sets `HYPERFRAMES_NO_TELEMETRY=1`, `DO_NOT_TRACK=1` and `HYPERFRAMES_NO_UPDATE_CHECK=1`.
- Your animation is never uploaded: rendering is local (the `cloud` and `lambda` commands of HyperFrames are not used).

## How it is built

`excalidraw-app/animation/htmlPlayer.ts` builds the file (pure, tested): the HyperFrames attributes (`data-composition-id`, `data-width`, `data-height`, `data-fps`, `data-duration`, a timed `class="clip"` stage), the payload (the slides as Excalidraw elements, the image files they use, the settings), the inlined fonts, the narration as an `<audio>` with `data-start` / `data-duration`, and the player script. The script is `excalidraw-app/animation/player/runtime.ts`: the real `timeline.ts` plus `exportToSvg`, bundled with esbuild by a small Vite plugin (`player/vitePlugin.ts`, `import … from "./runtime.ts?bundle"`) so it works the same in `yarn start` and in the production build. The font subsetting WebAssembly and the CJK font files are left out of that bundle (the app inlines the fonts, and the player draws with them as they are); it comes to about 310 KB.

## Using your AI with it (what is possible, what is next)

HyperFrames was made to be driven by AI agents (it installs "skills" for Claude Code, Codex and others that teach them to write compositions), and Trazo already has a connection to **your own** model (Ollama, LM Studio, an OpenAI-compatible server, Anthropic, or the CLI bridge) in `excalidraw-app/ai/llm.ts`. Two ways to join them, in order of risk:

1. **AI as director (low risk, planned):** the model reads the slides (titles, texts, element names) and proposes the video: a caption and a narration script per slide, how long each slide should stay, and which transition suits it. The answer is a small JSON that Trazo validates against a schema and shows as a preview; accepting it only fills the fields that already exist (`caption`, `holdMs`, `transition`). It writes no code, so a bad answer cannot break anything, and it works with a small local model.
2. **AI as author of HyperFrames compositions (higher ceiling, later):** the model writes HTML and animation code for motion graphics that Trazo's slides cannot express (kinetic titles, charts that grow, shader transitions). That needs a model that writes valid, deterministic code, a lint step (`hyperframes lint` / `check` exist for exactly this) and a repair loop, so it is better suited to a capable model than to a small one. The composition would then be rendered with the same script.

Both keep the rule that the model only ever sees what you chose to send, as with the rest of the AI features.
