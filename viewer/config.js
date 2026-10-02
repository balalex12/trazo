// Global viewer settings. Most can be overridden per map through the embed link's query string:
//   ?portal=https://gis.company.com/portal&item=<itemId>&layers=<url|itemId>,<url|itemId>&center=<lon>,<lat>&zoom=<n>&trace=1
window.ARCGIS_CONFIG = {
  // ArcGIS Online by default. For ArcGIS Enterprise use e.g. "https://gis.company.com/portal"
  // (or add portals from the viewer's top bar: no config needed).
  portalUrl: "https://www.arcgis.com",
  // OAuth 2.0 app id registered in the portal (optional). Redirect URI to register:
  //   http://localhost:3001/oauth-callback.html
  // Without it the SDK shows its native username/password dialog, which works with any portal.
  oauthAppId: "",
  // Optional: OAuth app ids per Enterprise portal (each portal has its own).
  //   "https://gis.company.com/portal": "AbCdEf123456"
  oauthApps: {},
  // API key (optional; needed for "arcgis/*" basemaps). Never put it in a map link: links are stored in the diagram.
  apiKey: "",
  // Initial view: the whole world. Override with your area of work, or per map with ?center=lon,lat&zoom=n
  center: [0, 20],
  zoom: 2,
  basemap: "streets-vector"
};
