import { readFileSync } from "node:fs";
import vm from "node:vm";

import {
  AUTHOR_SYSTEM,
  MAX_HTML,
  TIMELINE_HELPER,
  buildAuthorTurn,
  extractHtml,
  finalizeComposition,
  repairTurn,
  validateComposition,
} from "./author";

/* eslint-disable @typescript-eslint/no-explicit-any */

const FORMAT = { width: 1920, height: 1080, seconds: 12 };

// docs/examples/cache-explainer.html is a finished composition: what a model wrote, plus the timeline helper
const example = readFileSync("docs/examples/cache-explainer.html", "utf8");
const helperBlock = `<script>\n${TIMELINE_HELPER}\n</script>\n`;
const modelOutput = example.replace(helperBlock, "");

describe("validateComposition", () => {
  it("accepts a good composition, the one in docs/examples as a model would write it", () => {
    expect(example).toContain(helperBlock);
    expect(modelOutput).not.toContain("window.trazoTimeline =");
    const check = validateComposition(modelOutput, FORMAT);
    expect(check).toEqual({ errors: [], warnings: [], seconds: 12 });
  });

  it("finalizing the model's file gives exactly the example (the docs stay in sync)", () => {
    expect(finalizeComposition(modelOutput, 12)).toBe(example);
  });

  const bad = (snippet: string) =>
    validateComposition(
      modelOutput.replace("</body>", `<script>${snippet}</script></body>`),
      FORMAT,
    ).errors;

  it.each([
    ["fetch('/x')", /network/],
    ["new WebSocket('x')", /network/],
    ["Math.random()", /randomness/],
    ["Date.now()", /clock/],
    ["new Date()", /clock/],
    ["performance.now()", /clock/],
    ["requestAnimationFrame(f)", /timers/],
    ["setTimeout(f, 10)", /timers/],
    ["setInterval(f, 10)", /timers/],
    ["eval('1')", /dynamic code/],
    ["new Function('1')", /dynamic code/],
    ["import('x')", /dynamic code/],
    ["localStorage.x", /storage/],
    ["document.cookie", /storage/],
    ["window.open('x')", /window, navigation/],
    ["navigator.userAgent", /window, navigation/],
    ["parent.postMessage(1)", /window, navigation/],
  ])("refuses %s", (code, why) => {
    expect(bad(code).join(" | ")).toMatch(why);
  });

  it.each([
    ['<img src="https://example.com/a.png">', /outside the file \(src=/],
    ['<img src="//cdn.example.com/a.png">', /outside the file \(src=/],
    ['<img src="a.png">', /outside the file \(src=/],
    ['<img srcset="https://x.test/a.png 1x">', /outside the file \(srcset=/],
    ['<a href="https://x.test/">x</a>', /outside the file \(href=/],
    ['<a href="javascript:alert(1)">x</a>', /outside the file \(href=/],
    [
      '<svg><use href="https://x.test/s.svg#a"></use></svg>',
      /outside the file \(href=/,
    ],
    ['<div style="background:url(https://x.test/a.png)"></div>', /url\(\)/],
    ["<style>@font-face{src:url(https://x.test/f.woff2)}</style>", /url\(\)/],
    ["<style>@import 'a.css';</style>", /@import/],
    ['<script src="a.js"></script>', /script from a file/],
    ['<link rel="stylesheet" href="a.css">', /forbidden element \(<link>/],
    ['<iframe src="about:blank"></iframe>', /forbidden element \(<iframe>/],
    ['<form action="x"></form>', /forbidden element \(<form>/],
    ['<video src="a.mp4"></video>', /forbidden element \(<video>/],
    ['<meta http-equiv="refresh" content="0;url=x">', /http-equiv/],
    ['<div onclick="x()"></div>', /inline event handler/],
    ['<div ONMOUSEOVER="x()"></div>', /inline event handler/],
  ])("refuses %s", (snippet, why) => {
    const errors = validateComposition(
      modelOutput.replace("</body>", `${snippet}</body>`),
      FORMAT,
    ).errors;
    expect(errors.join(" | ")).toMatch(why);
  });

  it("allows data: images and #fragments", () => {
    const html = modelOutput.replace(
      "</body>",
      '<img src="data:image/png;base64,AAAA"><svg><use href="#a"></use></svg><div style="background:url(data:image/png;base64,AAAA)"></div></body>',
    );
    expect(validateComposition(html, FORMAT).errors).toEqual([]);
  });

  // The file is read with the browser's own parser, so these tricks (the ones that fool a regular expression: end tags
  // with spaces, odd case, HTML-style comments in a script) are seen as the browser would see them.
  it.each([
    ["<script>fetch('x')</script >"],
    ["<script>fetch('x')</script\n>"],
    ["<SCRIPT>fetch('x')</SCRIPT>"],
    ["<ScRiPt>Math.random()</sCrIpT >"],
    ["<script>\n<!--\nfetch('x')\n-->\n</script>"],
    ["<script>//<!--\nnew Date()\n//--></script>"],
    ["<!<!-- -->--><script>eval('1')</script>"],
    ['<script type="text/plain">localStorage.x</script>'],
  ])("sees through %s", (snippet) => {
    const errors = validateComposition(
      modelOutput.replace("</body>", `${snippet}</body>`),
      FORMAT,
    ).errors;
    expect(errors.length).toBeGreaterThan(0);
  });

  it("does not take a forbidden word inside an HTML comment for code", () => {
    const html = modelOutput.replace(
      "</body>",
      "<!-- <script>fetch('x')</script> -->\n</body>",
    );
    expect(validateComposition(html, FORMAT).errors).toEqual([]);
  });

  it("does not mind the words in on-screen text, only in scripts", () => {
    const html = modelOutput.replace(
      "Slow reads?",
      "Date: fetch() and Math.random() explained",
    );
    expect(validateComposition(html, FORMAT).errors).toEqual([]);
  });

  it("ignores forbidden words in HTML comments", () => {
    const html = modelOutput.replace(
      "</body>",
      "<!-- no fetch(), no Math.random() -->\n</body>",
    );
    expect(validateComposition(html, FORMAT).errors).toEqual([]);
  });

  it("checks the structure: id, size, the timeline call and its length", () => {
    const e = (html: string, f = FORMAT) =>
      validateComposition(html, f).errors.join(" | ");
    expect(e("")).toMatch(/no HTML/);
    expect(e("<div>hi</div>")).toMatch(/not a complete HTML file/);
    expect(e(modelOutput.replace(/data-composition-id="main"/, ""))).toMatch(
      /data-composition-id/,
    );
    expect(
      e(modelOutput.replace('data-width="1920"', 'data-width="1280"')),
    ).toMatch(/must be 1920 and 1080 \(found 1280 and 1080\)/);
    expect(e(modelOutput.replace('trazoTimeline("main", 12)', "1"))).toMatch(
      /never calls trazoTimeline/,
    );
    expect(
      e(
        modelOutput.replace(
          'trazoTimeline("main", 12)',
          'trazoTimeline("other", 12)',
        ),
      ),
    ).toMatch(/must use the composition id "main"/);
    expect(
      e(
        modelOutput.replace(
          'trazoTimeline("main", 12)',
          'trazoTimeline("main", 900)',
        ),
      ),
    ).toMatch(/outside 3 to 120/);
    expect(
      e(
        modelOutput.replace(
          "<script>",
          "<script>window.__timelines['main'] = {};",
        ),
      ),
    ).toMatch(/own timeline/);
    expect(
      e(modelOutput.replace("<script>", "<script>function trazoTimeline(){}")),
    ).toMatch(/own timeline/);
  });

  it("warns, without refusing, about a different length and tiny text", () => {
    const c = validateComposition(
      modelOutput
        .replace('trazoTimeline("main", 12)', 'trazoTimeline("main", 10)')
        .replace("font-size: 44px", "font-size: 14px"),
      FORMAT,
    );
    expect(c.errors).toEqual([]);
    expect(c.warnings.join(" | ")).toMatch(/10 s, not the 12 s/);
    expect(c.warnings.join(" | ")).toMatch(/smaller than 24 px/);
  });

  it("refuses a file that is too big", () => {
    const big = modelOutput.replace(
      "</body>",
      `<!-- ${"x".repeat(MAX_HTML)} --></body>`,
    );
    expect(validateComposition(big, FORMAT).errors.join(" ")).toMatch(
      /too big/,
    );
  });
});

describe("finalizeComposition", () => {
  it("puts the helper before the first script, once, and the duration on the main element", () => {
    const html =
      '<html><body><div data-composition-id="m" data-width="1" data-height="1"></div><script>var tl = trazoTimeline("m", 5);</script></body></html>';
    const out = finalizeComposition(html, 5);
    expect(out).toContain('data-composition-id="m" data-duration="5"');
    expect(out.split("window.trazoTimeline = function").length).toBe(2);
    expect(out.indexOf("window.trazoTimeline")).toBeLessThan(
      out.indexOf('trazoTimeline("m", 5)'),
    );
  });
  it("adds the helper at the end of the body when there is no script", () => {
    expect(finalizeComposition("<html><body>x</body></html>", 4)).toContain(
      "window.trazoTimeline",
    );
  });
});

describe("the timeline helper", () => {
  it("is valid JavaScript that defines trazoTimeline and registers the timeline", () => {
    const win: any = {};
    vm.runInNewContext(TIMELINE_HELPER, { window: win, document: {} });
    expect(typeof win.trazoTimeline).toBe("function");
    const tl = win.trazoTimeline("t", 8);
    expect(win.__timelines.t).toBe(tl);
    expect(tl.duration()).toBe(8);
    expect(tl.seek(100).time()).toBe(8); // clamped to the length
    expect(tl.seek(-5).time()).toBe(0);
    expect(tl.progress(0.5).time()).toBe(4);
    expect(tl.paused()).toBe(true);
  });
});

describe("what the model is told", () => {
  it("shows the structure, the helper and the hard rules", () => {
    expect(AUTHOR_SYSTEM).toContain("trazoTimeline(");
    expect(AUTHOR_SYSTEM).toContain("data-composition-id");
    expect(AUTHOR_SYSTEM).toContain("box-sizing: border-box");
    expect(AUTHOR_SYSTEM).toMatch(/no Math\.random, Date/);
    expect(AUTHOR_SYSTEM).toContain("no http or https addresses");
  });

  it("gives the format and the slide texts", () => {
    const turn = buildAuthorTurn({
      brief: " A launch teaser ",
      width: 1080,
      height: 1920,
      seconds: 20,
      slideTexts: [["Shop", "Web | API"], [], ["Cache"]],
    });
    expect(turn).toContain("A launch teaser");
    expect(turn).toContain("1080 x 1920 px, 20 seconds");
    expect(turn).toContain("1. Shop | Web | API");
    expect(turn).toContain("3. Cache");
    expect(turn).not.toContain("2. ");
    expect(
      buildAuthorTurn({ brief: "", width: 1, height: 1, seconds: 3 }),
    ).toContain("(not given)");
  });

  it("puts what the author wrote for each slide before the labels of the drawing", () => {
    const turn = buildAuthorTurn({
      brief: "",
      width: 1920,
      height: 1080,
      seconds: 15,
      slideTexts: [["rng", "customers"], [], ["model"]],
      slideNotes: [
        { caption: "Cell 1: make the data", script: "We start with data." },
        { caption: "Cell 2: merge" },
        {},
      ],
    });
    expect(turn).toContain(
      "1. CAPTION: Cell 1: make the data | SCRIPT: We start with data. | LABELS ON THE SLIDE: rng | customers",
    );
    // a slide with a caption but no labels is still listed; one with only labels keeps them
    expect(turn).toContain("2. CAPTION: Cell 2: merge");
    expect(turn).toContain("3. LABELS ON THE SLIDE: model");
    expect(turn).toContain("the author's own words");
    // without notes the turn is the one it always was
    const plain = buildAuthorTurn({
      brief: "",
      width: 1,
      height: 1,
      seconds: 3,
      slideTexts: [["Shop"]],
    });
    expect(plain).toContain("(texts only; build the video");
    expect(plain).toContain("1. Shop");
    expect(plain).not.toContain("CAPTION");
  });

  it("reads the HTML out of a fence or from the doctype", () => {
    const html = "<!doctype html><html><body>x</body></html>";
    expect(
      extractHtml(`Here you go:\n\`\`\`html\n${html}\n\`\`\`\nEnjoy`),
    ).toBe(html);
    expect(extractHtml(`Sure.\n${html}`)).toBe(html);
    expect(extractHtml(`\`\`\`\n${html}\n\`\`\``)).toBe(html);
    expect(extractHtml("no html here")).toBe("no html here");
  });

  it("lists the reasons in the repair turn", () => {
    const t = repairTurn(["it uses Date", "no id"]);
    expect(t).toContain("- it uses Date");
    expect(t).toContain("- no id");
    expect(t).toContain("complete corrected HTML");
  });
});
