// ArcGIS viewer logic (kept out of index.html so the Content-Security-Policy needs no inline scripts).
require(["esri/config", "esri/Map", "esri/WebMap", "esri/views/MapView", "esri/Graphic",
         "esri/layers/Layer", "esri/layers/GraphicsLayer", "esri/portal/PortalItem",
         "esri/identity/OAuthInfo", "esri/identity/IdentityManager", "esri/widgets/Search",
         "esri/widgets/BasemapGallery", "esri/widgets/Expand", "esri/widgets/Sketch",
         "esri/widgets/LayerList", "esri/widgets/ScaleBar", "esri/widgets/UtilityNetworkTrace",
         "esri/portal/Portal", "esri/portal/PortalQueryParams"],
function (esriConfig, Map, WebMap, MapView, Graphic, Layer, GraphicsLayer, PortalItem, OAuthInfo,
          IdentityManager, Search, BasemapGallery, Expand, Sketch, LayerList, ScaleBar, UtilityNetworkTrace,
          Portal, PortalQueryParams) {

  const cfg = window.ARCGIS_CONFIG || {};
  const AGOL = "https://www.arcgis.com";
  const q = new URLSearchParams(location.search);
  const param = (k, d) => q.get(k) || d;
  const embedId = param("eid", param("id", "default"));
  const storeKey = "arcgis-embed:" + embedId;
  // "https://host/portal/home/..." or ".../sharing/rest" -> "https://host/portal"
  const normPortal = (u) => u.trim().replace(/[?#].*$/, "").replace(/\/(home|sharing|apps)(\/.*)?$/i, "").replace(/\/+$/, "");
  const msg = (t, ms = 4000) => { const m = document.getElementById("msg"); m.textContent = t; m.style.display = "block"; setTimeout(() => m.style.display = "none", ms); };

  // One-time migration: state saved under the old shared ?id= key moves to the first element that claims it.
  try {
    const legacyKey = "arcgis-embed:" + param("id", "default");
    if (param("eid", "") && !localStorage.getItem(storeKey) && localStorage.getItem(legacyKey)) {
      const legacy = JSON.parse(localStorage.getItem(legacyKey));
      if (!legacy.claimedBy) {
        localStorage.setItem(storeKey, JSON.stringify(legacy));
        localStorage.setItem(legacyKey, JSON.stringify({ claimedBy: param("eid", "") }));
      }
    }
  } catch (e) {}

  const store = {
    load() { try { return JSON.parse(localStorage.getItem(storeKey)) || {}; } catch (e) { return {}; } },
    save(patch) { try { localStorage.setItem(storeKey, JSON.stringify({ ...store.load(), ...patch })); } catch (e) {} }
  };

  // --- Portals: ArcGIS Online + any number of Enterprise portals (shared by all maps) ---
  const PORTALS_KEY = "arcgis-portals";
  let portals = [];
  try { portals = JSON.parse(localStorage.getItem(PORTALS_KEY)) || []; } catch (e) {}
  if (!Array.isArray(portals)) portals = [];
  const ensureAGOL = () => { if (!portals.some((p) => p.url === AGOL)) portals.unshift({ name: "ArcGIS Online", url: AGOL }); };
  const savePortals = () => { try { localStorage.setItem(PORTALS_KEY, JSON.stringify(portals)); } catch (e) {} };
  const hostName = (u) => { try { return new URL(u).hostname; } catch (e) { return u; } };
  const addPortal = (url, name) => { if (!portals.some((p) => p.url === url)) { portals.push({ name: name || hostName(url), url }); savePortals(); } };
  ensureAGOL();

  // Active portal: link ?portal= wins, then the one saved for this map, then config default.
  let portalUrl = normPortal(param("portal", store.load().portal || cfg.portalUrl || AGOL)) || AGOL;
  addPortal(portalUrl);
  esriConfig.portalUrl = portalUrl;
  if (cfg.apiKey) esriConfig.apiKey = cfg.apiKey;
  const portalName = (u) => (portals.find((p) => p.url === u) || { name: hostName(u) }).name;

  // --- Authentication ---
  // The SDK keeps credentials in memory only, so they are saved to localStorage and restored on load.
  // IdentityManager keeps one credential per server, so several portals can be signed in at once.
  // With an OAuth App ID configured for a portal -> OAuth popup; otherwise the SDK shows its native
  // username/password dialog whenever a resource asks for credentials.
  const CRED_KEY = "arcgis-credentials";
  try { const saved = localStorage.getItem(CRED_KEY); if (saved) IdentityManager.initialize(JSON.parse(saved)); } catch (e) {}
  const saveCreds = () => {
    try {
      const j = IdentityManager.toJSON();
      if (j.credentials && j.credentials.length) localStorage.setItem(CRED_KEY, JSON.stringify(j));
      else localStorage.removeItem(CRED_KEY);
    } catch (e) {}
  };
  IdentityManager.on("credential-create", saveCreds);
  window.addEventListener("beforeunload", saveCreds);

  const appIds = { ...(cfg.oauthApps || {}) };
  if (cfg.oauthAppId) appIds[AGOL] = appIds[AGOL] || cfg.oauthAppId;
  const oauthInfos = Object.entries(appIds).filter(([, id]) => id).map(([url, appId]) =>
    new OAuthInfo({ appId, portalUrl: normPortal(url), popup: true, popupCallbackUrl: location.origin + "/oauth-callback.html" }));
  if (oauthInfos.length) IdentityManager.registerOAuthInfos(oauthInfos);

  const credentialFor = (url) => IdentityManager.credentials.find((c) => c.userId && (c.server || "").toLowerCase().startsWith(url.toLowerCase()));
  const loginBtn = document.getElementById("login"), psel = document.getElementById("psel"), prem = document.getElementById("prem");
  const refreshPortalUI = () => {
    psel.innerHTML = "";
    portals.forEach((p) => {
      const o = document.createElement("option"); o.value = p.url;
      o.textContent = (credentialFor(p.url) ? "● " : "○ ") + p.name; psel.appendChild(o);
    });
    psel.value = portalUrl;
    const c = credentialFor(portalUrl);
    loginBtn.textContent = c ? "Sign out (" + c.userId + ")" : "Sign in";
    prem.style.display = portalUrl === AGOL ? "none" : "";
    const small = document.getElementById("pportal"); if (small) small.textContent = "Portal: " + portalName(portalUrl) + " (" + portalUrl + ")";
  };
  refreshPortalUI();
  IdentityManager.on("credential-create", refreshPortalUI);
  { const c = credentialFor(portalUrl); console.log("[viewer v6] portal:", portalUrl, "| session:", c ? c.userId : "none");
    if (c) setTimeout(() => msg("Session restored for " + c.userId + " on " + portalName(portalUrl), 3000), 1500); }

  function setPortal(url) {
    portalUrl = url; esriConfig.portalUrl = url; store.save({ portal: url });
    refreshPortalUI();
    const bres = document.getElementById("bres"), bstatus = document.getElementById("bstatus");
    if (bres) bres.innerHTML = "";
    if (bstatus) bstatus.textContent = "Portal: " + portalName(url) + ". Press Search to list its content.";
    msg("Active portal: " + portalName(url));
  }
  psel.onchange = () => setPortal(psel.value);
  // credential.destroy() removes it asynchronously: save/refresh only after it is gone.
  const signOut = (c) => { c.destroy(); setTimeout(() => { saveCreds(); refreshPortalUI(); }, 250); };
  loginBtn.onclick = async () => {
    const c = credentialFor(portalUrl);
    if (c) { signOut(c); msg("Signed out of " + portalName(portalUrl)); return; }
    try {
      await IdentityManager.getCredential(portalUrl + "/sharing");
      saveCreds(); refreshPortalUI();
      msg("Signed in as " + (credentialFor(portalUrl) || {}).userId + " on " + portalName(portalUrl) + ". Open the portal browser to pick layers.", 6000);
      if (window.__refreshBrowser) window.__refreshBrowser();
    } catch (e) { msg("Sign-in cancelled or failed: " + e.message); }
  };
  prem.onclick = () => {
    if (portalUrl === AGOL) return;
    const c = credentialFor(portalUrl); if (c) signOut(c);
    portals = portals.filter((p) => p.url !== portalUrl); savePortals();
    setPortal(AGOL);
  };

  // Add Enterprise portal (inline form: dialogs like prompt() are blocked inside Excalidraw iframes)
  const pform = document.getElementById("pform"), pstatus = document.getElementById("pstatus");
  document.getElementById("padd").onclick = () => { pform.style.display = pform.style.display === "block" ? "none" : "block"; pstatus.textContent = ""; };
  document.getElementById("pcancel").onclick = () => { pform.style.display = "none"; };
  document.getElementById("pok").onclick = async () => {
    const raw = document.getElementById("purl").value; if (!raw.trim()) return;
    const url = normPortal(/^https?:\/\//i.test(raw.trim()) ? raw : "https://" + raw.trim());
    pstatus.textContent = "Checking " + url + " …";
    let note = "";
    try {
      const r = await fetch(url + "/sharing/rest/info?f=json");
      const j = await r.json();
      if (j.error || !(j.currentVersion || j.owningSystemUrl || j.authInfo)) { pstatus.textContent = "That URL does not look like an ArcGIS portal (no /sharing/rest/info)."; return; }
    } catch (e) { note = " (could not verify it: network or CORS; added anyway)"; }
    addPortal(url, document.getElementById("pname").value.trim());
    pform.style.display = "none"; document.getElementById("purl").value = ""; document.getElementById("pname").value = "";
    setPortal(url);
    if (note) msg("Portal added" + note, 7000);
  };

  // --- Base map + sketch layer ---
  const sketchLayer = new GraphicsLayer({ title: "Dibujo", listMode: "hide" });
  const map0 = new Map({ basemap: param("basemap", cfg.basemap || "streets-vector"), layers: [sketchLayer] });
  // Initial view: ?center=lon,lat&zoom=n override the config defaults
  const centerParam = param("center", "").split(",").map(Number);
  const startCenter = centerParam.length === 2 && centerParam.every(Number.isFinite) ? centerParam : cfg.center;
  const startZoom = Number.isFinite(Number(param("zoom", ""))) && param("zoom", "") !== "" ? Number(param("zoom", "")) : cfg.zoom;
  const view = new MapView({ container: "view", map: map0, center: startCenter, zoom: startZoom });

  const LAYER_TYPES = ["Feature Service", "Map Service", "Image Service", "Vector Tile Service", "WMS", "WMTS", "KML", "GeoJson", "CSV", "Scene Service"];
  const isItemId = (s) => /^[0-9a-f]{32}$/i.test(s);
  const idFrom = (s) => { const m = s.match(/[0-9a-f]{32}/i); return m ? m[0] : ""; };
  let traceWanted = param("trace", "") === "1";
  let currentMapIsWebMap = false;
  let currentMapTitle = "";

  // Layer sources are service URLs, or "<portalUrl>||<itemId>" so each item remembers its portal.
  const parseSource = (src) => {
    if (src.includes("||")) { const [p, id] = src.split("||"); return { portal: p, id }; }
    return isItemId(src) ? { portal: portalUrl, id: src } : null;
  };
  async function addLayerTo(map, src) {
    const item = parseSource(src);
    const layer = item
      ? await Layer.fromPortalItem({ portalItem: { id: item.id, portal: { url: item.portal } } })
      : await Layer.fromArcGISServerUrl({ url: src });
    map.add(layer, 0);
    return layer;
  }

  // Resolve a portal item: Web Map -> replaces the map; layer -> added; app -> navigates to the item.
  async function openItem(itemId, itemPortal, { persist = false } = {}) {
    const item = new PortalItem({ id: itemId, portal: { url: itemPortal } });
    await item.load();
    if (item.type === "Web Map") {
      const wm = new WebMap({ portalItem: item });
      wm.add(sketchLayer);
      view.map = wm; currentMapIsWebMap = true; currentMapTitle = item.title || itemId;
      if (persist) store.save({ item: itemId, itemPortal });
      await view.when();
      let hasUN = false;
      try { hasUN = !!(wm.utilityNetworks && wm.utilityNetworks.length); } catch (e) {}
      if (traceWanted || hasUN) addTrace();
      return "webmap";
    }
    if (LAYER_TYPES.includes(item.type)) {
      await addLayerTo(view.map, itemPortal + "||" + itemId);
      return "layer";
    }
    if (item.type === "Web Scene") throw new Error("Web Scenes (3D) are not supported in this 2D viewer.");
    if (item.url) { if (persist) store.save({ item: itemId, itemPortal }); location.replace(item.url); return "app"; }
    throw new Error("Unsupported item type: " + item.type);
  }

  const hasUtilityNetwork = () => { try { return !!(view.map && view.map.utilityNetworks && view.map.utilityNetworks.length); } catch (e) { return false; } };
  document.getElementById("trace").onclick = () => {
    if (!currentMapIsWebMap) {
      return msg("UN Trace needs a Web Map. What is open now is a basic map with layers added from services/items. " +
        "Open Browse portal content, set the type to Web Map and open one that contains your Utility Network " +
        "(or create it in Map Viewer: add the Utility Network layers and save the map).", 14000);
    }
    if (!hasUtilityNetwork()) {
      return msg("This Web Map (" + currentMapTitle + ") has no Utility Network registered, so there is nothing to trace. " +
        "In Map Viewer add the Utility Network layer to the map and save it, then open it here.", 14000);
    }
    traceWanted = true; addTrace(); renderList();
  };
  let traceAdded = false;
  function addTrace() {
    if (traceAdded) return; traceAdded = true;
    view.ui.add(new Expand({ view, content: new UtilityNetworkTrace({ view }), expandIconClass: "esri-icon-network", expanded: true }), "top-right");
  }

  // --- Sources: ?item= / ?webmap= (main item), ?layers= (layers) + those added from the panels ---
  const linkItem = idFrom(param("item", param("webmap", "")));
  const mainItem = () => linkItem ? { id: linkItem, portal: portalUrl, fromLink: true }
    : (store.load().item ? { id: store.load().item, portal: store.load().itemPortal || portalUrl } : null);
  let layerSources = [...new Set([...(param("layers", "").split(",").filter(Boolean)), ...(store.load().layers || [])])];

  view.when(async () => {
    const mi = mainItem();
    if (mi) {
      try { await openItem(mi.id, mi.portal); } catch (e) { msg("Could not open item: " + e.message + " (signed in to " + portalName(mi.portal) + "?)", 9000); }
    }
    for (const src of layerSources) {
      try { await addLayerTo(view.map, src); } catch (e) { msg("Could not load " + src + ": " + e.message, 7000); }
    }
    if (traceWanted && !currentMapIsWebMap) msg("Utility Network: use a Web Map item that contains Utility Network layers.", 9000);
    renderList();
  });

  // --- Panel: accepts item ID, portal item URL or service URL ---
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = '<b>Add layer / open item</b><br>' +
    '<input id="lsrc" placeholder="Item ID, item URL or service URL" />' +
    '<button id="ladd">Add</button><div id="mapkind" style="margin:6px 0;padding:5px;background:#f3f3f3"></div><ul id="llist" style="padding-left:16px"></ul>' +
    '<button id="lreset" title="Remove the item, added layers and drawings of this map">Reset this map</button><br>' +
    '<small id="pportal"></small>';
  const renderList = () => {
    const ul = panel.querySelector("#llist"); ul.innerHTML = "";
    const mi = mainItem();
    if (mi) {
      const li = document.createElement("li");
      const span = document.createElement("span"); span.textContent = "Item: " + mi.id + " (" + portalName(mi.portal) + ")";
      li.appendChild(span);
      if (!mi.fromLink) {
        const a = document.createElement("a"); a.href = "#"; a.textContent = "remove";
        a.onclick = (ev) => { ev.preventDefault(); store.save({ item: "", itemPortal: "" }); location.reload(); };
        li.appendChild(a);
      } else { const em = document.createElement("em"); em.textContent = "(from link)"; li.appendChild(em); }
      ul.appendChild(li);
    }
    layerSources.forEach((s, i) => {
      const it = parseSource(s);
      const li = document.createElement("li");
      const span = document.createElement("span"); span.textContent = it ? it.id + " (" + portalName(it.portal) + ")" : s;
      const a = document.createElement("a"); a.href = "#"; a.textContent = "remove";
      a.onclick = (ev) => { ev.preventDefault(); layerSources.splice(i, 1); store.save({ layers: layerSources }); renderList(); msg("Reload the map to apply."); };
      li.append(span, a); ul.appendChild(li);
    });
    const small = panel.querySelector("#pportal"); small.textContent = "Portal: " + portalName(portalUrl) + " (" + portalUrl + ")";
    const kind = panel.querySelector("#mapkind");
    const n = view.map && view.map.layers ? view.map.layers.length - 1 : 0; // minus the sketch layer
    kind.textContent = currentMapIsWebMap
      ? "Map type: Web Map, " + currentMapTitle + (hasUtilityNetwork() ? " (has Utility Network)" : " (no Utility Network found)")
      : "Map type: basic map + " + Math.max(n, 0) + " added layer(s). Not a Web Map.";
  };
  renderList();
  // Reset this map: two clicks instead of confirm() (dialogs are blocked inside Excalidraw iframes)
  const resetBtn = panel.querySelector("#lreset"); let resetArmed = false;
  resetBtn.onclick = () => {
    if (!resetArmed) { resetArmed = true; resetBtn.textContent = "Click again to confirm"; setTimeout(() => { resetArmed = false; resetBtn.textContent = "Reset this map"; }, 4000); return; }
    try { localStorage.removeItem(storeKey); } catch (e) {}
    location.reload();
  };
  async function addSource(raw) {
    const itemId = /\/rest\/services\//i.test(raw) ? "" : idFrom(raw);
    if (itemId) {
      const kind = await openItem(itemId, portalUrl, { persist: true });
      if (kind === "layer") { layerSources.push(portalUrl + "||" + itemId); store.save({ layers: layerSources }); }
    } else {
      await addLayerTo(view.map, raw); layerSources.push(raw); store.save({ layers: layerSources });
    }
    renderList();
  }
  panel.querySelector("#ladd").onclick = async () => {
    const input = panel.querySelector("#lsrc"); const raw = input.value.trim(); if (!raw) return;
    try { await addSource(raw); input.value = ""; }
    catch (e) { msg("Error: " + e.message + " (does it require signing in to " + portalName(portalUrl) + "?)", 7000); }
  };

  // --- Portal browser: My content / search the active portal, click to add ---
  const browse = document.createElement("div");
  browse.className = "panel browse";
  browse.innerHTML = '<b>Browse portal content</b>' +
    '<select id="bmode"><option value="mine">My content</option><option value="search">Search the portal</option></select>' +
    '<input id="bq" placeholder="Search text (optional)" />' +
    '<select id="btype"><option value="">Any layer or map</option><option>Web Map</option><option>Feature Service</option>' +
    '<option>Map Service</option><option>Vector Tile Service</option><option>Image Service</option></select>' +
    '<label style="font-size:12px"><input id="borg" type="checkbox" style="width:auto"> Only my organization (search)</label><br>' +
    '<button id="bgo">Search</button><div id="bstatus" style="font-size:12px;margin-top:4px"></div><div class="results" id="bres"></div>';
  const LAYERISH = ["Web Map", "Feature Service", "Map Service", "Vector Tile Service", "Image Service"];
  async function runBrowse() {
    const status = browse.querySelector("#bstatus"), res = browse.querySelector("#bres");
    res.innerHTML = ""; status.textContent = "Loading from " + portalName(portalUrl) + "…";
    try {
      const portal = new Portal({ url: portalUrl, authMode: "auto" });
      await portal.load();
      const mode = browse.querySelector("#bmode").value, text = browse.querySelector("#bq").value.trim();
      const type = browse.querySelector("#btype").value;
      let items = [];
      if (mode === "mine") {
        if (!portal.user) { status.textContent = "Not signed in to " + portalName(portalUrl) + ". Use the Sign in button."; return; }
        const r = await portal.user.fetchItems({ num: 100 });
        items = r.items.filter((i) => (type ? i.type === type : LAYERISH.includes(i.type)) &&
          (!text || (i.title + " " + (i.tags || []).join(" ")).toLowerCase().includes(text.toLowerCase())));
      } else {
        const types = type ? [type] : LAYERISH;
        let query = (text ? "(" + text + ") AND " : "") + "(" + types.map((t) => 'type:"' + t + '"').join(" OR ") + ")";
        if (browse.querySelector("#borg").checked && portal.user) query += " AND orgid:" + portal.user.orgId;
        const r = await portal.queryItems(new PortalQueryParams({ query, num: 40, sortField: "modified", sortOrder: "desc" }));
        items = r.results;
      }
      status.textContent = portalName(portalUrl) + ": " + items.length + " item(s)" + (portal.user ? ", signed in as " + portal.user.username : ", anonymous");
      items.forEach((it) => {
        const row = document.createElement("div"); row.className = "row";
        const info = document.createElement("div");
        const t = document.createElement("span"); t.textContent = it.title;
        const sm = document.createElement("small"); sm.textContent = it.type + " · " + (it.owner || "");
        info.append(t, sm);
        const btn = document.createElement("button"); btn.textContent = it.type === "Web Map" ? "Open" : "Add";
        btn.onclick = async () => { try { await addSource(it.id); msg("Added: " + it.title); } catch (e) { msg("Error: " + e.message, 7000); } };
        row.append(info, btn); res.appendChild(row);
      });
    } catch (e) { status.textContent = "Error: " + e.message; }
  }
  window.__refreshBrowser = runBrowse;
  browse.querySelector("#bgo").onclick = runBrowse;
  view.ui.add(new Expand({ view, content: panel, expandIconClass: "esri-icon-plus-circled", expandTooltip: "Add layer" }), "top-left");
  view.ui.add(new Expand({ view, content: browse, expandIconClass: "esri-icon-collection", expandTooltip: "Browse portal content" }), "top-left");
  view.ui.add(new Search({ view }), "top-left");
  view.ui.add(new Expand({ view, content: new LayerList({ view }), expandIconClass: "esri-icon-layers" }), "top-left");
  view.ui.add(new Expand({ view, content: new BasemapGallery({ view }), expandIconClass: "esri-icon-basemap" }), "top-left");
  view.ui.add(new ScaleBar({ view }), "bottom-left");

  // --- Sketch with per-embed persistence ---
  (store.load().sketch || []).forEach(j => { try { sketchLayer.add(Graphic.fromJSON(j)); } catch (e) {} });
  const persistSketch = () => store.save({ sketch: sketchLayer.graphics.toArray().map(g => g.toJSON()) });
  const sketch = new Sketch({ view, layer: sketchLayer, creationMode: "update" });
  sketch.on("create", (e) => { if (e.state === "complete") persistSketch(); });
  sketch.on("update", (e) => { if (e.state === "complete") persistSketch(); });
  sketch.on("delete", persistSketch);
  view.ui.add(sketch, "bottom-right");

  // --- Screenshot to draw on top inside Excalidraw ---
  document.getElementById("copy").onclick = async () => {
    try {
      const s = await view.takeScreenshot({ format: "png" });
      const blob = await (await fetch(s.dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      msg("Image copied. Paste it into Excalidraw (Ctrl+V) and draw on top.");
    } catch (e) { msg("Could not copy: " + e.message); }
  };
});
