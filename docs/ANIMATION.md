# Animated slides and video export

Open **🎞 Animation** (bottom center of the editor).

1. **Slides are frames.** Press `F` and draw a frame; put your content inside it. Slides are ordered by y position (then x).
2. **Duplicate slide** copies the selected frame (or the last one) _below_ it and links every copy to its original with `customData.animKey`.
3. Change things in the new slide: move, resize, recolour, change opacity or font size, add or delete elements.
4. **▶ Preview** plays the whole animation; **⛶ Present** is manual (`→`/`Space`/click = next, `←` = previous, `Esc` = exit).
5. **Export MP4** (H.264) or **Export GIF**. Settings: transition (ms), default hold (ms), easing, FPS, width.
   **Per-slide hold:** each row of the slide list has its own _ms_ field (type a value, press Enter). Empty = use the default hold. It is stored in the frame's `customData.holdMs`, so it is saved with the drawing and copied by _Duplicate slide_.

## How it animates

Elements with the same `animKey` are interpolated in frame-relative coordinates: position, size, angle, opacity, stroke and fill colour, stroke width, font size and the points of lines/arrows (when the point count matches). Elements that exist in only one slide fade out/in. Slides of different sizes interpolate their size.

Rendering uses Excalidraw's own exporter at the target size (vector re-render, so Preview/Present/exports are sharp at any resolution). Hold frames are rendered once and reused.

## Export details

- **MP4**: browser WebCodecs `VideoEncoder` (H.264, tries High/Main/Baseline) + vendored `mp4-muxer`. Needs a browser with H.264 encoding (Chrome/Edge). Output size = chosen width × proportional height (even numbers).
- **GIF**: vendored `gifenc`, per-frame palette, identical frames merged. Capped at 15 fps / 800 px.
- Nothing leaves your browser. Cancel any time.

## Limits

- Interactive map embeds render as a placeholder (use _Copy image_ in the map).
- Matching is by `animKey`; slides not created with _Duplicate slide_ animate only through elements you link manually (`customData.animKey`).
- No audio yet — see [ROADMAP.md](ROADMAP.md) (narration/music, ideas inspired by HeyGen's Hyperframes).

## Inspiration

Idea of "frames as slides + automatic interpolation" is inspired by _Excalidraw Smart Presentation_ (MIT, https://github.com/excalidraw-smart-presentation). No code was copied: it is a fork of an older Excalidraw base with a fixed 300 ms linear transition and no export, so this module was implemented natively.
