// Where the Python notebooks (JupyterLite, docs/NOTEBOOKS.md) are served. It is a separate small site on the same
// machine, not a part of this app, so the app only needs to know the address to open in a new tab.

/**
 * The notebook site: the same host as the app on port 3002 (the `lite` service of docker-compose.yml), unless
 * VITE_APP_JUPYTERLITE_ORIGIN says otherwise (a build-time setting, for a different port or a domain behind a proxy).
 */
export const jupyterLiteUrl = (
  location: Pick<Location, "protocol" | "hostname"> = window.location,
  configured: string | undefined = (
    import.meta.env as Record<string, string | undefined>
  ).VITE_APP_JUPYTERLITE_ORIGIN,
): string => {
  const origin = configured?.trim()
    ? configured.trim().replace(/\/+$/, "")
    : `${location.protocol}//${location.hostname}:3002`;
  return `${origin}/lab/index.html`;
};

/** The origin of the notebook site: the only one the panel talks to and the only one its iframe may load. */
export const jupyterLiteOrigin = (url: string = jupyterLiteUrl()): string =>
  new URL(url).origin;

/** Opens the notebook site in a new tab (no opener, no referrer: it is another origin). */
export const openNotebookSite = () => {
  window.open(jupyterLiteUrl(), "_blank", "noopener,noreferrer");
};
