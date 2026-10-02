// Builds public/arcgis.excalidrawlib (git-ignored: generated).
// Run from the repository root:
//   node tools/build-library.js
// Official Esri Architecture Center icons are committed in assets/esri-icons (CC BY 4.0, converted once with
// tools/visio_to_svg.py). Calcite glyphs are downloaded on demand by tools/fetch-calcite.mjs (not redistributed).
//
// Every item has a stable id "arcgis:<slug>" and a name "<Source · Category> / <Name>".
// The (patched) library panel groups items by the part before " / ".
// Image files travel in the top-level "files" map (loaded by excalidraw-app/App.tsx).
const fs = require("fs");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

// Calcite glyphs are fetched, not committed (license). Download them if any is missing.
if (!fs.existsSync("assets/calcite/utility-network.svg")) {
  console.log("Downloading Esri Calcite glyphs (not redistributed in this repo)...");
  execFileSync(process.execPath, ["tools/fetch-calcite.mjs"], { stdio: "inherit" });
}

const rid = () => crypto.randomBytes(8).toString("hex");
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const base = () => ({
  angle: 0, strokeWidth: 2, strokeStyle: "solid", roughness: 0, opacity: 100, fillStyle: "solid",
  seed: Math.floor(Math.random() * 1e9), version: 1, versionNonce: Math.floor(Math.random() * 1e9),
  isDeleted: false, boundElements: null, updated: 1, link: null, locked: false, frameId: null,
});
const BLUE = "#007ac2", TEAL = "#0f8b8d";
const CREATED = 1767225600000;

const ARCH = "Esri Architecture Center";
const CAT = {
  interactive: "Interactive ArcGIS Maps",
  un: "Utility Network (Esri Calcite icons)",
  general: `${ARCH} · General`,
  enterprise: `${ARCH} · Enterprise Components`,
  datastores: `${ARCH} · Data Stores`,
  it: `${ARCH} · IT Components`,
  containers: `${ARCH} · Containers & Labels`,
  usertypes: `${ARCH} · User Types`,
  personas: `${ARCH} · User Personas`,
  services: "Services & SDKs (Esri Calcite icons)",
};
const SET_TO_CAT = {
  "General": CAT.general, "Enterprise Components": CAT.enterprise, "Enterprise Data Stores": CAT.datastores,
  "IT Components": CAT.it, "Containers Labels": CAT.containers, "User Types": CAT.usertypes, "User Personas": CAT.personas,
};

const items = [];
const files = {};

function push(cat, name, elements) {
  items.push({ id: "arcgis:" + slug(cat + "-" + name), status: "published", created: CREATED, name: `${cat} / ${name}`, elements });
}

function registerSvg(svg) {
  const b64 = Buffer.from(svg, "utf-8").toString("base64");
  const fileId = crypto.createHash("sha1").update(svg).digest("hex");
  files[fileId] = { id: fileId, mimeType: "image/svg+xml", dataURL: "data:image/svg+xml;base64," + b64, created: CREATED, lastRetrieved: CREATED };
  return fileId;
}

function label(text) {
  // wrap at ~16 chars on spaces, max 3 lines
  const words = text.split(" "), lines = [""];
  for (const w of words) {
    const cur = lines[lines.length - 1];
    if ((cur + " " + w).trim().length > 16 && cur) lines.push(w); else lines[lines.length - 1] = (cur + " " + w).trim();
  }
  return lines.join("\n");
}

/** Item = icon image + English label, grouped. */
function iconItem(cat, name, svg, aspect, height = 64, color = "#1e1e1e") {
  const g = rid();
  const h = height, w = Math.min(Math.round(h * aspect), 220);
  const txt = label(name), lines = txt.split("\n");
  const fs_ = 14, th = Math.round(fs_ * 1.25 * lines.length);
  const tw = Math.max(...lines.map((l) => l.length)) * 8;
  const W = Math.max(w, tw, 90);
  const image = { ...base(), id: rid(), type: "image", x: (W - w) / 2, y: 0, width: w, height: h, groupIds: [g],
    strokeColor: "transparent", backgroundColor: "transparent", roundness: null, fileId: registerSvg(svg),
    status: "saved", scale: [1, 1], crop: null };
  const text = { ...base(), id: rid(), type: "text", groupIds: [g], strokeColor: color, backgroundColor: "transparent",
    text: txt, originalText: txt, fontSize: fs_, fontFamily: 2, textAlign: "center", verticalAlign: "top",
    width: tw, height: th, x: (W - tw) / 2, y: h + 6, containerId: null, autoResize: true, lineHeight: 1.25, roundness: null };
  push(cat, name, [image, text]);
}

function embed(cat, name, link, w = 760, h = 480) {
  const e = { ...base(), id: rid(), type: "embeddable", x: 0, y: 0, width: w, height: h, groupIds: [],
    strokeColor: BLUE, backgroundColor: "transparent", roundness: { type: 3 }, link };
  push(cat, name, [e]);
}

function calcite(cat, name, file, color) {
  // Embedded byte-for-byte as downloaded (Esri MLA: redistribution without modification). The label text
  // carries the section color; the glyph keeps Calcite's default (black).
  const svg = fs.readFileSync(`assets/calcite/${file}.svg`, "utf-8");
  iconItem(cat, name, svg, 1, 64, color);
}

// 1. Interactive maps
embed(CAT.interactive, "Interactive Map", "http://localhost:3001/", 760, 480);

// 2. Utility Network
[
  ["Utility Network", "utility-network"], ["Utility Network Service", "utility-network-layer"],
  ["Domain Network", "layer-set"], ["Tier", "layers"], ["Subnetwork", "topology"],
  ["Subnetwork Controller", "geometric-network"], ["Device", "switch"], ["Line", "layer-line"],
  ["Junction", "connection-middle"], ["Assembly", "cube"], ["Structure", "layer-points"],
  ["Terminal", "connection-end-right"], ["Association: Connectivity", "link"],
  ["Association: Containment", "group-layers"], ["Association: Attachment", "nodes-link"],
  ["Trace", "trace-path"], ["Network Topology Validation", "validate-utility-network-topology"],
].forEach(([n, f]) => calcite(CAT.un, n, f, TEAL));

// 3. Official Esri Architecture Center icons (converted from the Visio toolkit)
const index = JSON.parse(fs.readFileSync("assets/esri-icons/index.json", "utf-8"));
const FIXES = { "Business An Server": "Business Analyst Server", "Geoprocess Server": "Geoprocessing Server",
  "Web Adpator - JAVA": "Web Adaptor - Java", "License Manger": "License Manager", "Spatiotemp Big Data Store": "Spatiotemporal Big Data Store",
  "Workflow Mgr Server": "Workflow Manager Server", "Raster Analytics": "Raster Analytics Server",
  "Multiple Role Data Store": "Multi-Role Data Store", "Data Process Server": "Data Processing Server" };
const SKIP = new Set(["GIS URL", "GIS URL Vertical", "Context URL", "URL Context Path Verical"]);
const ORDER = ["General", "Enterprise Components", "Enterprise Data Stores", "IT Components", "Containers Labels", "User Types", "User Personas"];
const sorted = [...index].sort((a, b) => ORDER.indexOf(a.set) - ORDER.indexOf(b.set));
for (const ic of sorted) {
  if (SKIP.has(ic.name)) continue;
  const cat = SET_TO_CAT[ic.set];
  if (!cat) continue;
  if (ic.set === "Containers Labels") continue; // built below as native rectangles
  const svg = fs.readFileSync(`assets/esri-icons/${ic.file}`, "utf-8");
  const name = FIXES[ic.name] || ic.name;
  iconItem(cat, name, svg, ic.aspect, 64);
}

// Containers: outline-only boxes in the Visio toolkit (line pattern/color from the originals),
// so they are native Excalidraw rectangles with a title instead of near-invisible SVG hairlines.
function container(name, strokeStyle, color, svg, aspect = 1) {
  const g = rid();
  const w = 360, h = 240, ih = 40, iw = Math.round(ih * aspect);
  const rect = { ...base(), id: rid(), type: "rectangle", x: 0, y: 0, width: w, height: h, groupIds: [g],
    strokeColor: color, backgroundColor: "transparent", fillStyle: "solid", strokeStyle, strokeWidth: 2, roundness: null };
  const image = { ...base(), id: rid(), type: "image", x: 14, y: 12, width: iw, height: ih, groupIds: [g],
    strokeColor: "transparent", backgroundColor: "transparent", roundness: null, fileId: registerSvg(svg),
    status: "saved", scale: [1, 1], crop: null };
  const text = { ...base(), id: rid(), type: "text", groupIds: [g], strokeColor: color, backgroundColor: "transparent",
    text: name, originalText: name, fontSize: 18, fontFamily: 2, textAlign: "left", verticalAlign: "middle",
    width: name.length * 10, height: 23, x: 14 + iw + 10, y: 12 + (ih - 23) / 2, containerId: null, autoResize: true,
    lineHeight: 1.25, roundness: null };
  push(CAT.containers, name, [rect, image, text]);
}
const glyph = (file) => fs.readFileSync(`assets/calcite/${file}.svg`, "utf-8"); // unmodified (see calcite())
const enterpriseIcon = index.find((i) => i.name === "ArcGIS Enterprise");
container("Data Center", "solid", "#000000", glyph("all-servers"));
container("Private Network", "dotted", "#000000", glyph("server-lock"));
container("Public Subnet", "dashed", "#000000", glyph("globe"));
container("Private Subnet", "dashed", "#000000", glyph("lock"));
container("Base ArcGIS Enterprise", "dashed", "#595959",
  fs.readFileSync(`assets/esri-icons/${enterpriseIcon.file}`, "utf-8"), enterpriseIcon.aspect);
container("Logical Grouping", "dotted", "#595959", glyph("group-layers"));

// 4. Services & SDKs without an official Architecture Center icon
[
  ["Feature Service", "feature-layer"], ["Map Service", "layer-map-service"], ["Vector Tile Service", "layer-vector-tile"],
  ["Maps SDK for JavaScript", "code"], ["Experience Builder", "apps"],
].forEach(([n, f]) => calcite(CAT.services, n, f, BLUE));

// Content fingerprint: MUST stay identical to excalidraw-app/libraryFingerprint.ts
function fingerprint(elements) {
  const str = JSON.stringify(elements.map((e) => [e.type, Math.round(e.width), Math.round(e.height), e.text || "", (e.points || []).length]));
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// 5. Community libraries (libraries/community.json). Downloaded from the official catalog at build time, never
//    committed. Each library becomes its own section "Community · <name> (<author>)" so sources never mix.
//    --profile=public (or LIBRARY_PROFILE=public) skips libraries flagged brandLogos (third-party trademarks).
const profile = process.env.LIBRARY_PROFILE || (process.argv.includes("--profile=public") ? "public" : "local");
const communityOriginalIds = []; // ids of the same items as imported by users earlier: the app purges those copies
const communityFingerprints = new Set(); // ...and copies recognised by content (their ids differ)
let communityCount = 0;
if (fs.existsSync("libraries/community.json")) {
  const man = JSON.parse(fs.readFileSync("libraries/community.json", "utf-8"));
  const wanted = man.libraries.filter((l) => !(profile === "public" && l.brandLogos));
  if (wanted.some((l) => !fs.existsSync(`assets/community/${l.slug}.excalidrawlib`))) {
    console.log("Downloading community libraries from the official catalog (not redistributed in this repo)...");
    try {
      execFileSync(process.execPath, ["tools/fetch-community-libraries.mjs"], { stdio: "inherit" });
    } catch (e) {
      console.warn("Some community libraries could not be downloaded; continuing with the ones available.");
    }
  }
  for (const lib of wanted) {
    const f = `assets/community/${lib.slug}.excalidrawlib`;
    if (!fs.existsSync(f)) continue;
    const json = JSON.parse(fs.readFileSync(f, "utf-8"));
    const raw = json.libraryItems || json.library || [];
    const cat = `Community · ${lib.name} (${lib.authors.map((a) => a.name).join(", ")})`;
    raw.forEach((it, i) => {
      const els = Array.isArray(it) ? it : it.elements;
      if (!els || !els.length) return;
      const origId = !Array.isArray(it) && it.id ? it.id : null;
      if (origId) communityOriginalIds.push(origId);
      communityFingerprints.add(fingerprint(els));
      const name = (!Array.isArray(it) && it.name) || `Item ${i + 1}`;
      items.push({ id: `lib:${lib.slug}:${origId || i}`, status: "published", created: CREATED, name: `${cat} / ${name}`, elements: els });
      communityCount++;
    });
  }
  console.log(`Community libraries (${profile} profile): ${communityCount} items from ${wanted.length} libraries`);
}

// Names of previous versions of this library (random ids) so the app can purge stale copies on load.
const legacy = [
  "Portal for ArcGIS", "ArcGIS Online", "ArcGIS Server", "Data Store", "Enterprise Geodatabase",
  "File Geodatabase", "Feature Service", "Map Service", "Vector Tile Service", "Image Service",
  "Geoprocessing Service", "ArcGIS Pro", "Web App Builder / Experience Builder",
  "ArcGIS Maps SDK for JavaScript", "ArcPy / ArcGIS API for Python", "Web Adaptor",
  "Survey123 / Field Maps", "Mapa ArcGIS (interactivo)", "Mapa ArcGIS con Web Map",
  "UN: Trazado interactivo (Web Map con Utility Network)", "Utility Network", "Domain Network", "Tier",
  "Subnetwork", "Subnetwork Controller", "UN Device", "UN Line", "UN Junction", "UN Assembly",
  "UN Structure", "UN Terminal", "UN Association - Connectivity", "UN Association - Containment",
  "UN Association - Attachment", "UN Trace", "UN Network Topology", "UN Service",
];

const out = JSON.stringify({ type: "excalidrawlib", version: 2, source: "local-arcgis-lib",
  legacyNames: legacy, communityOriginalIds, communityFingerprints: [...communityFingerprints], libraryItems: items, files });
fs.writeFileSync("public/arcgis.excalidrawlib", out);
console.log("OK:", items.length, "items,", Object.keys(files).length, "image files,", (out.length / 1024).toFixed(0), "KB");
