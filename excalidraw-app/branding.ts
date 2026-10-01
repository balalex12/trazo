// Single source of truth for the project identity. Rename the project by editing this file
// (and docs/BRANDING.md lists the other places: README, package names, Docker image name).
export const BRAND = {
  name: "Trazo",
  tagline: "Local-first diagram studio for architecture, data, GIS and ML",
  /** Set to the public repository URL before publishing; empty hides the link in the About dialog. */
  repoUrl: "",
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
