// "Compose with AI": your own model writes a motion graphic as a HyperFrames composition (HTML, CSS and a few
// timeline calls), which `tools/hyperframes-render.mjs` turns into a video. This file is everything around the model:
// what it is told, the tiny timeline helper it builds on, and the checks that decide whether what it wrote may be
// saved. Pure (no DOM, no network).
//
// Safety first: the composition is never run inside Trazo. It is checked as text here, saved as a file, and only then
// rendered on your machine by HyperFrames, in a headless browser. The checks refuse anything that could reach the
// network, read or write storage, use the clock or randomness (which would also make frames differ between runs), or
// load code or media from somewhere else: a composition is self-contained, deterministic and offline, or it is
// rejected.

export type ComposeSize = { width: number; height: number };
export const COMPOSE_SIZES: Record<string, ComposeSize & { label: string }> = {
  landscape: {
    width: 1920,
    height: 1080,
    label: "Landscape 16:9 (1920 x 1080)",
  },
  portrait: { width: 1080, height: 1920, label: "Portrait 9:16 (1080 x 1920)" },
  square: { width: 1080, height: 1080, label: "Square 1:1 (1080 x 1080)" },
};
export const MIN_DURATION = 3;
export const MAX_DURATION = 120;
/** the biggest composition accepted, in characters */
export const MAX_HTML = 250_000;

/**
 * `trazoTimeline(id, seconds)`: the one animation helper a composition uses. Each `.add()` is a Web Animation that is
 * created paused and moved to a time by `seek`, so any frame can be asked for in any order and always looks the same
 * (HyperFrames renders by asking for each frame, it never plays the page). It is inserted into the file by
 * `finalizeComposition`; the model only calls it, so it cannot get it wrong.
 */
export const TIMELINE_HELPER = `(function () {
  window.trazoTimeline = function (id, seconds) {
    var now = 0;
    var anims = [];
    // for every element and CSS property: the earliest animation, which is the only one that also applies BEFORE its
    // start (so a later animation of the same property never shows its first keyframe too early)
    var first = new WeakMap();
    var RESERVED = { offset: 1, easing: 1, composite: 1 };
    var tl = {
      /** add(target, keyframes, { start, duration, easing, stagger }): target is a selector, an element or a list */
      add: function (target, keyframes, o) {
        o = o || {};
        var els = typeof target === "string" ? [].slice.call(document.querySelectorAll(target)) : target && target.length !== undefined ? [].slice.call(target) : [target];
        var duration = Math.max(1, (o.duration === undefined ? 0.5 : o.duration) * 1000);
        var props = {};
        keyframes.forEach(function (k) { Object.keys(k).forEach(function (p) { if (!RESERVED[p]) props[p] = 1; }); });
        els.forEach(function (el, i) {
          var delay = ((o.start || 0) + i * (o.stagger || 0)) * 1000;
          var seen = first.get(el) || {};
          first.set(el, seen);
          Object.keys(props).forEach(function (p) {
            var frames = keyframes.filter(function (k) { return k[p] !== undefined; }).map(function (k) {
              var f = {}; f[p] = k[p];
              if (k.offset !== undefined) f.offset = k.offset;
              return f;
            });
            if (frames.length < 2) return;
            var a = el.animate(frames, { duration: duration, delay: delay, easing: o.easing || "ease", fill: "forwards" });
            a.pause();
            a.currentTime = now * 1000;
            var prev = seen[p];
            if (!prev || delay < prev.delay) {
              a.effect.updateTiming({ fill: "both" });
              if (prev) prev.anim.effect.updateTiming({ fill: "forwards" });
              seen[p] = { delay: delay, anim: a };
            }
            anims.push(a);
          });
        });
        return tl;
      },
      duration: function () { return seconds; },
      totalDuration: function () { return seconds; },
      seek: function (t) {
        now = Math.max(0, Math.min(seconds, +t || 0));
        anims.forEach(function (a) { a.currentTime = now * 1000; });
        return tl;
      },
      time: function (t) { return t === undefined ? now : tl.seek(t); },
      totalTime: function (t) { return t === undefined ? now : tl.seek(t); },
      progress: function (p) { return p === undefined ? now / seconds : tl.seek(p * seconds); },
      pause: function () { return tl; },
      play: function () { return tl; },
      paused: function () { return true; },
      eventCallback: function () { return tl; }
    };
    window.__timelines = window.__timelines || {};
    window.__timelines[id] = tl;
    return tl;
  };
})();`;

export const AUTHOR_SYSTEM = `You write short motion graphics as HyperFrames compositions: one self-contained HTML file that is rendered to video frame by frame. You are given a brief, the size and length of the video and, optionally, the texts of the author's diagram slides. Reply with ONLY the complete HTML file (it may be inside one \`\`\`html fence), nothing else.

Structure to follow exactly:
<!doctype html>
<html><head><meta charset="utf-8"><style> * { box-sizing: border-box; } ...all CSS here... </style></head>
<body>
<div id="stage" data-composition-id="main" data-start="0" data-duration="DURATION" data-width="WIDTH" data-height="HEIGHT">
  ...all visible elements here, positioned with CSS (position:absolute inside #stage)...
</div>
<script>
var tl = trazoTimeline("main", DURATION);
tl.add("#title", [{ opacity: 0, transform: "translateY(40px)" }, { opacity: 1, transform: "none" }], { start: 0.3, duration: 0.8, easing: "cubic-bezier(.2,.8,.2,1)" });
</script>
</body></html>

Use the real numbers given for DURATION, WIDTH and HEIGHT. The helper trazoTimeline is provided for you: do not define it and do not load any library.

How animation works:
- tl.add(target, keyframes, options) animates one element (or every match of a CSS selector, or a list of elements). "keyframes" is a Web Animations keyframe array: [{...from}, {...to}] with CSS properties in camelCase (opacity, transform, width, height, color, backgroundColor, clipPath, strokeDashoffset, filter...). Options: start (seconds from the beginning of the video), duration (seconds), easing (a CSS easing such as "ease-out", "linear" or "cubic-bezier(...)"), stagger (seconds between the elements of a selector).
- An element is shown in the first keyframe of its EARLIEST animation before that animation starts, and keeps the last keyframe of each animation after it ends. So to make something appear at 2 s, animate opacity from 0 to 1 starting at 2; to remove it later, add a second animation (opacity 1 to 0) starting when it should go. Animate opacity together with visibility ("hidden" and "visible") for whole scenes that must not catch clicks or overlap checks.
- Draw a line or arrow: give the SVG path style="stroke-dasharray:LENGTH" and animate strokeDashoffset from LENGTH to 0.
- Everything must be on screen only for as long as it is meant to be: finish the last animation before the end and leave the final picture readable for at least 1.5 seconds.

Hard rules (a file that breaks one is rejected):
- Everything is in this one file: no external fonts, images, scripts, stylesheets or links; no http or https addresses anywhere. Use system fonts (font-family: system-ui, "Segoe UI", Roboto, sans-serif), inline SVG and CSS for graphics, data: URIs only if you must.
- Deterministic and offline: no Math.random, Date, performance.now, requestAnimationFrame, setTimeout, setInterval, fetch, XMLHttpRequest, eval, import(), storage, cookies or timers of any kind. The only script is the one that calls trazoTimeline.
- No forms, iframes, objects, embeds or inline event handlers (onclick=...).
- Use box-sizing: border-box on everything and keep every box inside the frame.
- Text must be readable on video: at least 28 px at this size, strong contrast, inside the frame with a safe margin of 5%.
- Keep it simple and well made: one idea per scene, a clear hierarchy, 3 to 5 colors, generous spacing. Write the on-screen texts in the language of the brief.`;

/** the user turn: the brief, the format and what the author's slides say */
export const buildAuthorTurn = (o: {
  brief: string;
  width: number;
  height: number;
  seconds: number;
  slideTexts?: string[][];
  /** what the author (or the director) wrote for each slide, by position: their words come before the drawing's labels */
  slideNotes?: { caption?: string; script?: string }[];
}): string => {
  const notes = o.slideNotes || [];
  const written = notes.some((n) => n?.caption || n?.script);
  const slides = (o.slideTexts || [])
    .map((t, i) => {
      const parts: string[] = [];
      if (notes[i]?.caption) {
        parts.push(`CAPTION: ${notes[i].caption}`);
      }
      if (notes[i]?.script) {
        parts.push(`SCRIPT: ${notes[i].script}`);
      }
      if (t.length) {
        parts.push(`${written ? "LABELS ON THE SLIDE: " : ""}${t.join(" | ")}`);
      }
      return `${i + 1}. ${parts.join(" | ")}`;
    })
    .filter((l) => l.length > 3);
  return `BRIEF:\n${
    o.brief.trim() ||
    "(none: make a clean, friendly explainer of the slides below)"
  }

FORMAT: ${o.width} x ${o.height} px, ${o.seconds} seconds (DURATION = ${
    o.seconds
  }, WIDTH = ${o.width}, HEIGHT = ${o.height}).

${
  slides.length
    ? `THE AUTHOR'S DIAGRAM, slide by slide (${
        written
          ? "the captions and scripts are the author's own words: tell the story with them and use them as the headlines; the labels are only what is written on the drawing, use the ones that help and do not copy them all. "
          : "texts only; "
      }build the video from this content and add nothing that is not in it):\n${slides.join(
        "\n",
      )}`
    : "THE AUTHOR'S DIAGRAM: (not given)"
}`;
};

/** the HTML in a model's answer: inside a fence, or from <!doctype / <html on */
export const extractHtml = (raw: string): string => {
  const fenced = /```(?:html)?\s*\n([^]*?)```/i.exec(raw);
  const text = (fenced ? fenced[1] : raw).trim();
  const start = text.search(/<!doctype html|<html[\s>]/i);
  return (start >= 0 ? text.slice(start) : text).trim();
};

export type Check = {
  errors: string[];
  warnings: string[];
  seconds: number | null;
};

/** What may not appear in its scripts (the words are fine in on-screen text). */
const SCRIPT_RULES: [RegExp, string][] = [
  [
    /https?:\/\/|(?:^|[^:\w])\/\/[a-z0-9.-]+\.[a-z]{2,}\//i,
    "a script contains an http or https address (everything must be inside the file)",
  ],
  [
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts|Worker|SharedWorker)\b/,
    "it uses the network or workers",
  ],
  [
    /\b(?:eval|Function)\s*\(|\bnew\s+Function\b|\bimport\s*\(/,
    "it runs dynamic code (eval, new Function, import())",
  ],
  [
    /\bMath\.random\b|\bcrypto\.getRandomValues\b/,
    "it uses randomness (frames would differ between runs)",
  ],
  [
    /\bDate\b|\bperformance\.now\b/,
    "it reads the clock (Date, performance.now)",
  ],
  [
    /\brequestAnimationFrame\b|\bsetTimeout\b|\bsetInterval\b|\bsetImmediate\b|\bqueueMicrotask\b/,
    "it uses timers or requestAnimationFrame (use trazoTimeline instead)",
  ],
  [
    /\b(?:localStorage|sessionStorage|indexedDB|document\.cookie|caches)\b/,
    "it uses storage or cookies",
  ],
  [
    /\b(?:window\.open|postMessage|navigator|location|history\.|parent\.|top\.)\b/,
    "it uses window, navigation or parent access",
  ],
];

/** attributes that point at a file or address: only `#fragment` and `data:` values are allowed */
const URL_ATTRIBUTES = new Set([
  "src",
  "href",
  "xlink:href",
  "poster",
  "data",
  "action",
  "formaction",
  "srcset",
  "background",
  "ping",
  "cite",
  "manifest",
]);
/** elements that load or embed something, or navigate */
const FORBIDDEN_TAGS = new Set([
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "portal",
  "form",
  "base",
  "link",
  "audio",
  "video",
  "source",
  "track",
]);

/** CSS (a <style> element or a style attribute) that loads anything from outside the file */
const cssProblems = (css: string): string[] => {
  const out: string[] = [];
  if (/@import\b/i.test(css)) {
    out.push("it uses @import");
  }
  if (/url\(\s*(?!["']?\s*(?:data:|#))/i.test(css)) {
    out.push("a CSS url() points to something outside the file");
  }
  return out;
};

/**
 * Checks a composition. `errors` stop it being saved; `warnings` are shown. The file is read with the browser's own
 * HTML parser (an inert document: nothing in it runs or loads), so the checks see the same elements, attributes and
 * script text that a browser would, whatever tricks with comments, end tags or case the file plays.
 */
export const validateComposition = (
  html: string,
  expected: { width: number; height: number; seconds?: number },
): Check => {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!html.trim()) {
    return { errors: ["The model returned no HTML."], warnings, seconds: null };
  }
  if (typeof DOMParser === "undefined") {
    return {
      errors: [
        "This environment cannot parse HTML, so the file cannot be checked.",
      ],
      warnings,
      seconds: null,
    };
  }
  if (html.length > MAX_HTML) {
    errors.push(
      `it is too big (${Math.round(html.length / 1000)} KB; the limit is ${
        MAX_HTML / 1000
      } KB)`,
    );
  }
  if (!/^\s*(?:<!doctype html|<html[\s>])/i.test(html)) {
    errors.push(
      "it is not a complete HTML file (it must start with <!doctype html>)",
    );
  }
  const doc = new DOMParser().parseFromString(html, "text/html");
  const problems = new Set<string>();
  const css: string[] = [];
  const scripts: string[] = [];

  for (const el of Array.from(doc.querySelectorAll("*"))) {
    const tag = el.localName.toLowerCase();
    if (FORBIDDEN_TAGS.has(tag)) {
      problems.add(
        `it uses a forbidden element (<${tag}>: nothing may be embedded, linked or loaded)`,
      );
    }
    if (tag === "meta" && el.hasAttribute("http-equiv")) {
      problems.add("it uses <meta http-equiv>");
    }
    if (tag === "style") {
      css.push(el.textContent || "");
    }
    if (tag === "script") {
      if (el.hasAttribute("src")) {
        problems.add("it loads a script from a file or address");
      }
      scripts.push(el.textContent || "");
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith("on")) {
        problems.add("it has an inline event handler (onclick=...)");
      } else if (URL_ATTRIBUTES.has(name)) {
        if (value && !value.startsWith("#") && !/^data:/i.test(value)) {
          problems.add(
            `it loads or links something outside the file (${name}="${value.slice(
              0,
              40,
            )}")`,
          );
        }
      } else if (name === "style") {
        css.push(value);
      }
    }
  }
  for (const text of css) {
    cssProblems(text).forEach((p) => problems.add(p));
  }
  const code = scripts.join("\n");
  for (const [re, why] of SCRIPT_RULES) {
    if (re.test(code)) {
      problems.add(why);
    }
  }
  errors.push(...problems);

  const root = doc.querySelector("[data-composition-id]");
  const id = root?.getAttribute("data-composition-id") || undefined;
  if (!id) {
    errors.push(
      'the main element has no data-composition-id (for example data-composition-id="main")',
    );
  }
  const w = root?.getAttribute("data-width");
  const h = root?.getAttribute("data-height");
  if (Number(w) !== expected.width || Number(h) !== expected.height) {
    errors.push(
      `data-width and data-height must be ${expected.width} and ${
        expected.height
      } (found ${w ?? "none"} and ${h ?? "none"})`,
    );
  }
  const call = /trazoTimeline\s*\(\s*["']([^"']+)["']\s*,\s*([\d.]+)\s*\)/.exec(
    code,
  );
  let seconds: number | null = null;
  if (!call) {
    errors.push(
      'it never calls trazoTimeline("id", seconds), so nothing is animated',
    );
  } else {
    seconds = Number(call[2]);
    if (id && call[1] !== id) {
      errors.push(
        `trazoTimeline("${call[1]}", ...) must use the composition id "${id}"`,
      );
    }
    if (!(seconds >= MIN_DURATION && seconds <= MAX_DURATION)) {
      errors.push(
        `the length ${call[2]} s is outside ${MIN_DURATION} to ${MAX_DURATION} seconds`,
      );
    } else if (
      expected.seconds &&
      Math.abs(seconds - expected.seconds) > 0.01
    ) {
      warnings.push(
        `the length is ${seconds} s, not the ${expected.seconds} s that was asked`,
      );
    }
  }
  if (
    /\bfunction\s+trazoTimeline\b|window\.trazoTimeline\s*=|__timelines\s*\[[^\]]+\]\s*=/.test(
      code,
    )
  ) {
    errors.push(
      "it defines its own timeline; use the trazoTimeline helper that is provided",
    );
  }
  const tiny = [
    ...css.join("\n").matchAll(/font-size\s*:\s*(\d+(?:\.\d+)?)px/gi),
  ].filter((m) => Number(m[1]) < 24);
  if (tiny.length) {
    warnings.push(
      `some text is smaller than 24 px (${tiny[0][1]} px): it will be hard to read on video`,
    );
  }
  return { errors, warnings, seconds };
};

/** The file as it will be saved: the timeline helper in, and the duration on the main element. */
export const finalizeComposition = (html: string, seconds: number): string => {
  let out = html;
  if (
    !/data-duration\s*=/.test(
      out.slice(0, out.indexOf("data-composition-id") + 400),
    )
  ) {
    out = out.replace(
      /(data-composition-id\s*=\s*["'][^"']+["'])/,
      `$1 data-duration="${seconds}"`,
    );
  }
  const helper = `<script>\n${TIMELINE_HELPER}\n</script>\n`;
  const firstScript = out.search(/<script\b/i);
  if (firstScript >= 0) {
    return out.slice(0, firstScript) + helper + out.slice(firstScript);
  }
  const bodyEnd = out.search(/<\/body>/i);
  return bodyEnd >= 0
    ? out.slice(0, bodyEnd) + helper + out.slice(bodyEnd)
    : out + helper;
};

/** what to tell the model when its file was refused */
export const repairTurn = (errors: string[]): string =>
  `Your file was refused for these reasons:\n${errors
    .map((e) => `- ${e}`)
    .join(
      "\n",
    )}\n\nReturn the complete corrected HTML file, following all the rules, and nothing else.`;
