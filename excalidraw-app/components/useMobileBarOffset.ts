import { useEffect } from "react";

const VAR_NAME = "--trazo-mobile-bar-offset";

let watchers = 0;
let observer: ResizeObserver | null = null;
let mutationObserver: MutationObserver | null = null;

const measure = () => {
  const bar = document.querySelector<HTMLElement>(".App-bottom-bar");
  const height = bar ? bar.getBoundingClientRect().height : 0;
  document.documentElement.style.setProperty(VAR_NAME, `${height}px`);
};

const start = () => {
  measure();
  // Both are standard in every real browser Trazo targets; guarded here because test
  // environments (jsdom) don't implement ResizeObserver, and this must degrade to "do nothing
  // live" there rather than throw and break whichever component mounts first.
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(measure);
  }
  if (typeof MutationObserver === "undefined") {
    return;
  }
  // Excalidraw's own mobile toolbar (.App-bottom-bar) only exists in the DOM on narrow
  // viewports (see packages/excalidraw/components/MobileMenu.tsx); watch for it appearing,
  // disappearing or resizing, so trigger buttons below never land on top of it.
  mutationObserver = new MutationObserver(() => {
    const bar = document.querySelector<HTMLElement>(".App-bottom-bar");
    observer?.disconnect();
    if (bar) {
      observer?.observe(bar);
    }
    measure();
  });
  mutationObserver.observe(document.body, { childList: true, subtree: true });
  const bar = document.querySelector<HTMLElement>(".App-bottom-bar");
  if (bar) {
    observer?.observe(bar);
  }
};

const stop = () => {
  observer?.disconnect();
  mutationObserver?.disconnect();
  observer = null;
  mutationObserver = null;
  document.documentElement.style.removeProperty(VAR_NAME);
};

/**
 * Keeps `--trazo-mobile-bar-offset` on the document root equal to the live height of
 * Excalidraw's own mobile bottom toolbar (0 when it isn't rendered, i.e. on desktop). Any
 * fixed-position trigger button anchored to the bottom of the screen can then use
 * `bottom: calc(<base> + var(--trazo-mobile-bar-offset, 0px))` to always sit above it, instead
 * of guessing a breakpoint or a fixed offset that only works for one screen size.
 */
export const useMobileBarOffset = () => {
  useEffect(() => {
    if (watchers === 0) {
      start();
    }
    watchers++;
    return () => {
      watchers--;
      if (watchers === 0) {
        stop();
      }
    };
  }, []);
};
