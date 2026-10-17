// A check of a built app (CI, Linux, inside xvfb-run): starts the app as it is, asks the page to share its screen the
// way the recorder does, records 1.5 s and checks that video came out and that it is the page ("browser"), which is
// what the recorder accepts.
//
//   xvfb-run -a desktop/node_modules/.bin/electron desktop/capture-check.cjs --no-sandbox
"use strict";
const { app, BrowserWindow } = require("electron");

require("./main.cjs");

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const page = `(async () => {
  const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false,
    preferCurrentTab: true, selfBrowserSurface: "include", surfaceSwitching: "exclude" });
  const t = s.getVideoTracks()[0];
  const st = t.getSettings();
  const chunks = [];
  const r = new MediaRecorder(s, { mimeType: "video/webm" });
  r.ondataavailable = (e) => chunks.push(e.data);
  r.start(250);
  await new Promise((x) => setTimeout(x, 1500));
  r.stop();
  await new Promise((x) => (r.onstop = x));
  t.stop();
  return JSON.stringify({ surface: st.displaySurface, width: st.width, height: st.height,
    bytes: chunks.reduce((a, c) => a + c.size, 0), innerWidth: window.innerWidth, innerHeight: window.innerHeight });
})()`;

app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 80 && !win; i++) {
    win = BrowserWindow.getAllWindows()[0];
    await wait(250);
  }
  const fail = (m) => {
    console.error(`FAIL: ${m}`);
    app.exit(1);
  };
  if (!win) return fail("the app opened no window");
  await wait(4000); // the page has to be up
  let r;
  try {
    r = JSON.parse(await win.webContents.executeJavaScript(page, true));
  } catch (e) {
    return fail(
      `the page could not share its screen: ${(e && e.message) || e}`,
    );
  }
  if (r.surface && r.surface !== "browser")
    return fail(
      `the shared surface is "${r.surface}", the recorder accepts only the page`,
    );
  if (r.width !== r.innerWidth || r.height !== r.innerHeight)
    return fail(
      `the video is ${r.width}x${r.height}, the page ${r.innerWidth}x${r.innerHeight}`,
    );
  if (r.bytes < 1000) return fail(`no video came out (${r.bytes} bytes)`);
  console.log(
    `OK: the page shares itself (${r.width}x${r.height}) and records ${r.bytes} bytes of video.`,
  );
  app.exit(0);
});
