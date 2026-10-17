// What the app answers when a page asks to share a screen (the recorder's "Whole app" and "Canvas + maps" modes).
// In a browser the recorder accepts only "this tab". The app has no tab: its page hands over its own frame, which is
// the same thing (the page, nothing around it), and nothing else is on offer: no list of windows or screens, so no
// other program can be recorded. Pages of any other origin get nothing.
"use strict";

/**
 * @param {{ securityOrigin?: string, frame?: unknown }} request what Electron passes to the handler
 * @param {(origin: string) => boolean} isOurs
 * @returns {{ video?: unknown }}
 */
const chooseDisplayMedia = (request, isOurs) =>
  request && request.frame && isOurs(String(request.securityOrigin || ""))
    ? { video: request.frame }
    : {};

module.exports = { chooseDisplayMedia };
