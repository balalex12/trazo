import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import ExcalidrawApp from "./App";

window.__EXCALIDRAW_SHA__ = import.meta.env.VITE_APP_GIT_SHA;
const rootElement = document.getElementById("root")!;
const root = createRoot(rootElement);

// Local-first build: no service worker (avoids stale caches) and no telemetry. Remove any worker
// registered by earlier versions.
navigator.serviceWorker?.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
window.caches?.keys().then((keys) => keys.forEach((k) => window.caches.delete(k)));

root.render(
  <StrictMode>
    <ExcalidrawApp />
  </StrictMode>,
);
