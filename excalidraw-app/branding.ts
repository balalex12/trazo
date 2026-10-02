// Single source of truth for the project identity. Rename the project by editing this file
// (and docs/BRANDING.md lists the other places: README, package names, Docker image name).
export const BRAND = {
  name: "Trazo",
  tagline: "Local-first diagram studio for architecture, data, GIS and ML",
  /** Repository URL shown in the About dialog and error reports; empty hides the link. */
  repoUrl: "https://github.com/balalex12/trazo",
  upstream: {
    name: "Excalidraw",
    url: "https://github.com/excalidraw/excalidraw",
    license: "MIT",
    copyright: "Copyright (c) 2020 Excalidraw",
  },
} as const;

/** Custom DOM events used to open the dialogs from menu items without prop drilling. */
export const EVENTS = {
  openAbout: "brand:open-about",
  openAISettings: "brand:open-ai-settings",
} as const;
