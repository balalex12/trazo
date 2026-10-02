# ArcGIS viewer

A standalone page (`viewer/`, served on `http://localhost:3001`) that is embedded in the canvas as an iframe. It uses
the ArcGIS Maps SDK for JavaScript (4.31) loaded from `js.arcgis.com`.

## Using it

Insert **Interactive ArcGIS Maps / Interactive Map** from the library, or **paste an ArcGIS URL** on the canvas:

| You paste | Result |
|---|---|
| `…/home/item.html?id=<id>`, `…/home/webmap/viewer.html?webmap=<id>`, `…/apps/mapviewer/index.html?webmap=<id>`, `…/sharing/rest/content/items/<id>` (any host) | the item opens in the viewer with the portal taken from the URL |
| `…/rest/services/…/FeatureServer/0`, `MapServer`, `ImageServer`, `VectorTileServer` | the service is added as a layer |
| Experience Builder / Dashboards / Instant Apps / StoryMaps / Web AppBuilder URLs | embedded directly (sandboxed iframe) |

Inside the map: **＋** *Add layer / open item* (item ID, item URL or service URL), **Browse portal content**
(*My content* or search the portal; click to add/open), basemap gallery, layer list, search, scale bar, **Sketch**
(drawings persist), **Copy image** (paste into the canvas to draw on top with Excalidraw tools).

## Portals and sign-in

Top bar: **portal selector** (● signed in / ○ not), **＋** add an ArcGIS Enterprise portal (e.g.
`https://gis.company.com/portal`), **−** remove it, **Sign in / Sign out** (for the active portal), **UN Trace**,
**Copy image**.

- Several portals can be signed in simultaneously (one credential per server). Each map remembers its active portal; each layer remembers the portal it came from.
- Without an OAuth app id the SDK shows its native **username/password** dialog — works with any portal. For SSO/SAML register an OAuth app in the portal (redirect URI `http://localhost:3001/oauth-callback.html`) and add its id to `viewer/config.js` → `oauthApps` (per portal).
- Credentials are saved in `localStorage` (`arcgis-credentials`) so a reload does not sign you out. See [SECURITY.md](SECURITY.md) §4.
- The portal must allow requests from `http://localhost:3001` (CORS) — the default for ArcGIS.

## Link parameters

`?item=<id>` (or `webmap`), `?portal=<url>`, `?layers=<url|id>,…`, `?basemap=<id>`, `?trace=1`, `?eid=<id>` (state key;
set automatically per canvas element). Never put tokens in a link.

## Utility Network trace

The trace widget needs a **Web Map that has a Utility Network registered** — a plain map with a Utility Network layer
added from a service is *not enough* (the SDK exposes `utilityNetworks` only on `WebMap`). The panel line
*Map type: Web Map — … (has Utility Network)* tells you. If the map has one, the widget shows automatically; otherwise
**UN Trace** explains what is missing.

**Status:** the multi-portal UI, item/layer resolution, browsing and persistence are tested against public portals, and sign-in and
content browsing were validated by the maintainer against a private ArcGIS Enterprise portal. The trace itself has **not** been
tested with real data yet.

## Limits

- Web Scenes (3D) are not supported.
- Layers and sketches live in the browser (`arcgis-embed:<eid>`), not in the exported `.excalidraw` file.
- A map embed is a live iframe: it is exported as a placeholder in animations (use *Copy image*).
