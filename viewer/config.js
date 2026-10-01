// Configuración global del visor. Todo se puede sobreescribir por query string en el link del embed:
//   ?id=mapa1&portal=https://gis.empresa.com/portal&webmap=<itemId>&layers=<url|itemId>,<url|itemId>&trace=1
window.ARCGIS_CONFIG = {
  // ArcGIS Online por defecto. Para Enterprise: "https://gis.empresa.com/portal"
  portalUrl: "https://www.arcgis.com",
  // App ID (OAuth 2.0) registrado en el portal. Redirect URI a registrar:
  //   http://localhost:3001/oauth-callback.html
  // Sin esto solo se ven capas públicas.
  oauthAppId: "",
  // OPCIONAL: App IDs por portal Enterprise (cada portal tiene los suyos). Sin esto, el SDK
  // muestra su login nativo de usuario/contraseña, que funciona con cualquier portal.
  //   "https://gis.empresa.com/portal": "AbCdEf123456"
  oauthApps: {},
  // API key (opcional; necesaria para basemaps "arcgis/*"). No la pongas en el link del embed.
  apiKey: "",
  center: [0, 20],
  zoom: 2,
  basemap: "streets-vector"
};
