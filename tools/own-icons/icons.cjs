// Trazo's own icon packs: GIS and spatial data, data engineering, machine learning.
//
// Every glyph is drawn here from a few geometric primitives (lines, rectangles, circles, paths) on a 64 x 64 grid,
// in one stroke style per pack. They are original, neutral drawings: no logo, no screenshot, no copy of any vendor's
// artwork, so they carry no third-party license (MIT, like the rest of the repository). Item names may mention tools
// such as FME, GeoPandas or GDAL only to say what a glyph stands for (so search finds it); the drawings are generic.
//
// Used by tools/build-library.js. `node tools/own-icons/sheet.cjs` renders a contact sheet to check them.

const W = 64;

/** the drawing kit for one pack: accent color, a light tint of it, and a neutral ink */
const kit = (accent, tint) => {
  const INK = "#495057";
  const stroke = (k) => (k === "i" ? INK : k === "w" ? "#ffffff" : accent);
  const fill = (f) =>
    f === "t" ? tint : f === "w" ? "#ffffff" : f === "a" ? accent : f === "i" ? INK : "none";
  const attrs = (o = {}) =>
    `fill="${fill(o.f)}" stroke="${stroke(o.k)}" stroke-width="${o.sw || 3}"` +
    `${o.dash ? ' stroke-dasharray="4 4"' : ""} stroke-linecap="round" stroke-linejoin="round"` +
    `${o.op ? ` opacity="${o.op}"` : ""}`;
  const n = (v) => Math.round(v * 100) / 100;
  const k = {
    rect: (x, y, w, h, o = {}) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${o.r ?? 3}" ${attrs(o)}/>`,
    circ: (cx, cy, r, o = {}) => `<circle cx="${cx}" cy="${cy}" r="${r}" ${attrs(o)}/>`,
    ell: (cx, cy, rx, ry, o = {}) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" ${attrs(o)}/>`,
    line: (x1, y1, x2, y2, o = {}) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${attrs({ ...o, f: "" })}/>`,
    path: (d, o = {}) => `<path d="${d}" ${attrs(o)}/>`,
    poly: (pts, o = {}) =>
      `<path d="M${pts.map((p) => p.join(" ")).join(" L")}${o.open ? "" : " Z"}" ${attrs(o)}/>`,
    dot: (cx, cy, r = 2.6, o = {}) => `<circle cx="${cx}" cy="${cy}" r="${r}" ${attrs({ f: "a", ...o, sw: 1 })}/>`,
    arrow: (x1, y1, x2, y2, o = {}) => {
      const a = Math.atan2(y2 - y1, x2 - x1);
      const h = o.head || 7;
      const p = (da) => [n(x2 - h * Math.cos(a + da)), n(y2 - h * Math.sin(a + da))];
      const [l, r] = [p(0.5), p(-0.5)];
      return (
        `<path d="M${x1} ${y1} L${x2} ${y2} M${l[0]} ${l[1]} L${x2} ${y2} L${r[0]} ${r[1]}" ` +
        `${attrs({ ...o, f: "" })}/>`
      );
    },
    /** a flat database cylinder with `bands` rings */
    cyl: (cx, top, w, h, bands = 1, o = {}) => {
      const rx = w / 2;
      const ry = Math.min(6, h / 5);
      let s = `<path d="M${cx - rx} ${top + ry} V${top + h - ry} A${rx} ${ry} 0 0 0 ${cx + rx} ${top + h - ry} V${top + ry}" ${attrs({ f: "t", ...o })}/>`;
      s += k.ell(cx, top + ry, rx, ry, { f: "t", ...o });
      for (let b = 1; b <= bands; b++) {
        const y = top + ry + ((h - 2 * ry) * b) / (bands + 1);
        s += `<path d="M${cx - rx} ${n(y)} A${rx} ${ry} 0 0 0 ${cx + rx} ${n(y)}" ${attrs({ ...o, f: "" })}/>`;
      }
      return s;
    },
    /** a table: x, y, width, height, rows, cols, header row filled */
    table: (x, y, w, h, rows, cols, o = {}) => {
      let s = k.rect(x, y, w, h, { f: "w", ...o, r: 3 });
      s += `<rect x="${x}" y="${y}" width="${w}" height="${n(h / rows)}" rx="3" ${attrs({ f: "t", ...o })}/>`;
      for (let r = 2; r < rows; r++) s += k.line(x, n(y + (h * (r - 1)) / rows), x + w, n(y + (h * (r - 1)) / rows), { ...o, sw: 2 });
      for (let c = 1; c < cols; c++) s += k.line(n(x + (w * c) / cols), y, n(x + (w * c) / cols), y + h, { ...o, sw: 2 });
      return s;
    },
    /** a page with a folded corner and `lines` text lines */
    doc: (x, y, w, h, lines = 3, o = {}) => {
      const f = 9;
      let s = `<path d="M${x} ${y + 3} Q${x} ${y} ${x + 3} ${y} H${x + w - f} L${x + w} ${y + f} V${y + h - 3} Q${x + w} ${y + h} ${x + w - 3} ${y + h} H${x + 3} Q${x} ${y + h} ${x} ${y + h - 3} Z" ${attrs({ f: "w", ...o })}/>`;
      s += `<path d="M${x + w - f} ${y} V${y + f} H${x + w}" ${attrs({ ...o, f: "" })}/>`;
      for (let i = 0; i < lines; i++) s += k.line(x + 6, y + 16 + i * 8, x + w - 6 - (i === lines - 1 ? 8 : 0), y + 16 + i * 8, { ...o, sw: 2 });
      return s;
    },
    /** a map pin whose head is centered at (cx, cy) */
    pin: (cx, cy, s = 1, o = {}) =>
      `<path d="M${cx} ${n(cy + 15 * s)} C${n(cx - 12 * s)} ${n(cy + 2 * s)} ${n(cx - 11 * s)} ${n(cy - 12 * s)} ${cx} ${n(cy - 12 * s)} C${n(cx + 11 * s)} ${n(cy - 12 * s)} ${n(cx + 12 * s)} ${n(cy + 2 * s)} ${cx} ${n(cy + 15 * s)} Z" ${attrs({ f: "t", ...o })}/>` +
      k.circ(cx, n(cy - 2 * s), n(4 * s), { f: "w", ...o, sw: 2 }),
    /** a gear: ring with teeth */
    gear: (cx, cy, r, o = {}) => {
      let s = "";
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i;
        s += k.line(n(cx + (r - 1) * Math.cos(a)), n(cy + (r - 1) * Math.sin(a)), n(cx + (r + 5) * Math.cos(a)), n(cy + (r + 5) * Math.sin(a)), { ...o, sw: 4 });
      }
      return s + k.circ(cx, cy, r, { f: "t", ...o }) + k.circ(cx, cy, r / 3, { f: "w", ...o, sw: 2 });
    },
    cloud: (x, y, s = 1, o = {}) =>
      `<path d="M${x + 10 * s} ${y + 22 * s} H${x + 40 * s} A${8 * s} ${8 * s} 0 0 0 ${x + 40 * s} ${y + 6 * s} A${10 * s} ${10 * s} 0 0 0 ${x + 22 * s} ${y - 2 * s} A${12 * s} ${12 * s} 0 0 0 ${x + 10 * s} ${y + 22 * s} Z" transform="translate(0 0)" ${attrs({ f: "t", ...o })}/>`,
    /** an n x n grid of cells; `shade` lists the cell indexes (row * n + col) that are filled */
    grid: (x, y, size, cells, shade = [], o = {}) => {
      const c = size / cells;
      let s = "";
      shade.forEach((i) => {
        s += `<rect x="${n(x + (i % cells) * c)}" y="${n(y + Math.floor(i / cells) * c)}" width="${n(c)}" height="${n(c)}" fill="${accent}" opacity="0.55" stroke="none"/>`;
      });
      s += k.rect(x, y, size, size, { ...o, f: "", r: 2 });
      for (let i = 1; i < cells; i++) {
        s += k.line(n(x + i * c), y, n(x + i * c), y + size, { ...o, sw: 1.6 });
        s += k.line(x, n(y + i * c), x + size, n(y + i * c), { ...o, sw: 1.6 });
      }
      return s;
    },
    /** small graph nodes joined by lines: [[x, y], ...], edges [[i, j], ...] */
    graph: (pts, edges, r = 4.5, o = {}) =>
      edges.map(([a, b]) => k.line(pts[a][0], pts[a][1], pts[b][0], pts[b][1], { sw: 2.4, ...o })).join("") +
      pts.map(([x, y]) => k.circ(x, y, r, { f: "t", ...o })).join(""),
    clock: (cx, cy, r, o = {}) =>
      k.circ(cx, cy, r, { f: "w", ...o }) + k.line(cx, cy, cx, cy - r * 0.6, { ...o, sw: 2.4 }) + k.line(cx, cy, cx + r * 0.45, cy + r * 0.2, { ...o, sw: 2.4 }),
    bars: (x, y, heights, bw = 7, gap = 4, o = {}) =>
      heights.map((h, i) => k.rect(x + i * (bw + gap), y - h, bw, h, { f: "t", r: 1.5, ...o })).join(""),
  };
  return k;
};

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W}" width="${W}" height="${W}" fill="none">${body}</svg>`;

// ---------------------------------------------------------------------------------------------------------------
// GIS and spatial data
// ---------------------------------------------------------------------------------------------------------------
const gis = (() => {
  const k = kit("#2b8a3e", "#d3f9d8");
  const poly1 = [[10, 22], [26, 10], [44, 14], [52, 30], [40, 50], [18, 46]];
  return [
    ["Vector layer", k.poly(poly1, { f: "t" }) + poly1.map(([x, y]) => k.dot(x, y)).join("")],
    ["Raster layer", k.grid(10, 10, 44, 6, [1, 2, 8, 9, 10, 15, 16, 22, 23, 28, 29, 35], { k: "a" })],
    ["Point cloud", [[14, 40], [22, 24], [30, 44], [36, 18], [44, 34], [50, 48], [20, 52], [48, 14], [32, 32], [12, 16]].map(([x, y]) => k.dot(x, y, 3.2)).join("") + k.rect(6, 6, 52, 52, { dash: true, f: "", r: 6, sw: 2 })],
    ["Coordinate reference system", k.circ(32, 32, 22, { f: "t" }) + k.ell(32, 32, 9, 22, { f: "" , sw: 2}) + k.line(10, 32, 54, 32, { sw: 2 }) + k.path("M13 20 Q32 26 51 20", { sw: 2 }) + k.path("M13 44 Q32 38 51 44", { sw: 2 })],
    ["Reprojection", k.poly([[6, 22], [22, 22], [22, 44], [6, 44]], { f: "t" }) + k.arrow(26, 33, 38, 33, { k: "i" }) + k.poly([[42, 20], [58, 26], [58, 44], [42, 46]], { f: "t" })],
    ["Spatial join", k.poly([[8, 14], [34, 14], [34, 38], [8, 38]], { f: "t" }) + k.circ(40, 38, 15, { f: "w", k: "i" }) + k.dot(40, 38, 3, { k: "i", f: "i" }) + k.dot(20, 26, 3)],
    ["Buffer", k.circ(32, 32, 24, { dash: true, f: "t" }) + k.circ(32, 32, 14, { dash: true, f: "w" }) + k.dot(32, 32, 4)],
    ["Clip", k.poly([[8, 22], [26, 8], [50, 14], [56, 36], [38, 54], [14, 46]], { f: "t", op: 0.6 }) + k.rect(18, 18, 30, 28, { k: "i", dash: true, f: "", r: 2 }) + k.path("M18 30 L30 18 L48 22 L48 40 L34 46 L18 40 Z", { f: "a", sw: 1.5, op: 0.5 })],
    ["Dissolve", k.poly([[6, 14], [28, 14], [28, 34], [6, 34]], { f: "t" }) + k.poly([[28, 14], [50, 14], [50, 34], [28, 34]], { f: "t", op: 0.6 }) + k.arrow(32, 40, 32, 50, { k: "i" }) + k.poly([[6, 52], [50, 52]], { open: true })],
    ["Geocoder", k.pin(26, 24, 1) + k.circ(44, 44, 9, { f: "w", k: "i" }) + k.line(51, 51, 58, 58, { k: "i", sw: 4 })],
    ["Tile pyramid", k.grid(28, 3, 8, 1, [0]) + k.grid(24, 15, 16, 2, [0, 3]) + k.grid(18, 35, 28, 4, [0, 5, 10, 15, 3, 12])],
    ["Spatial ETL workspace (FME-style)", k.rect(4, 22, 14, 20, { f: "t" }) + k.rect(25, 22, 14, 20, { f: "w", k: "i" }) + k.rect(46, 22, 14, 20, { f: "t" }) + k.arrow(18, 32, 25, 32, { head: 5 }) + k.arrow(39, 32, 46, 32, { head: 5 }) + k.line(32, 22, 32, 14, { k: "i", sw: 2 }) + k.circ(32, 11, 3, { f: "w", k: "i", sw: 2 })],
    ["Reader (spatial source)", k.doc(10, 6, 34, 46, 3) + k.arrow(36, 52, 56, 52, { k: "i", head: 6, sw: 3 }) + k.dot(22, 38, 3)],
    ["Writer (spatial target)", k.doc(8, 6, 34, 46, 3) + k.arrow(46, 52, 62, 52, { head: 6 }) + k.path("M16 40 L24 32 L30 38 L36 30", { open: true, sw: 2 })],
    ["Transformer", k.gear(32, 32, 12, { }) + k.arrow(4, 32, 14, 32, { head: 5, k: "i" }) + k.arrow(50, 32, 60, 32, { head: 5, k: "i" })],
    ["GeoDataFrame (GeoPandas-style)", k.table(6, 8, 46, 40, 4, 3) + k.pin(48, 44, 0.8)],
    ["Raster translate / warp (GDAL-style)", k.grid(6, 18, 28, 4, [0, 5, 10, 15], { k: "i" }) + k.arrow(36, 32, 46, 32, { head: 5 }) + k.poly([[48, 16], [60, 20], [58, 44], [46, 42]], { f: "t" }) + k.line(52, 24, 52, 38, { sw: 1.6 })],
    ["GeoJSON file", k.doc(8, 6, 36, 48, 0) + k.path("M20 22 Q15 22 15 27 V30 Q15 33 12 34 Q15 35 15 38 V41 Q15 46 20 46", { open: true, sw: 2.4, k: "i" }) + k.path("M32 22 Q37 22 37 27 V30 Q37 33 40 34 Q37 35 37 38 V41 Q37 46 32 46", { open: true, sw: 2.4, k: "i" }) + k.pin(48, 44, 0.75)],
    ["GeoPackage", k.poly([[32, 6], [56, 18], [56, 44], [32, 58], [8, 44], [8, 18]], { f: "t" }) + k.path("M8 18 L32 31 L56 18 M32 31 V58", { open: true, sw: 2 }) + k.dot(32, 20, 3)],
    ["Shapefile set", k.doc(18, 4, 30, 38, 0, { k: "i" }) + k.doc(12, 12, 30, 38, 0, { k: "i" }) + k.doc(6, 20, 30, 38, 2) + k.poly([[12, 30], [20, 26], [28, 32]], { open: true, sw: 2 })],
    ["Cloud-optimized raster", k.cloud(8, 22, 1) + k.grid(30, 30, 24, 3, [0, 4, 8], {})],
    ["Spatial index", k.rect(6, 6, 52, 52, { f: "", r: 4 }) + k.rect(12, 12, 24, 22, { k: "i", f: "t", sw: 2 }) + k.rect(26, 24, 26, 26, { f: "", sw: 2, dash: true }) + k.dot(20, 20, 2.4) + k.dot(30, 28, 2.4) + k.dot(44, 40, 2.4) + k.dot(16, 46, 2.4)],
    ["Raster calculator (map algebra)", k.grid(6, 10, 30, 3, [0, 4, 8], {}) + k.line(40, 24, 56, 24, { k: "i" }) + k.line(48, 16, 48, 32, { k: "i" }) + k.path("M40 46 H56", { k: "i", open: true }) + k.grid(34, 40, 22, 2, [1, 2], {})],
  ].map(([name, body]) => ({ name, svg: svg(body) }));
})();

// ---------------------------------------------------------------------------------------------------------------
// Data engineering
// ---------------------------------------------------------------------------------------------------------------
const data = (() => {
  const k = kit("#1971c2", "#d0ebff");
  return [
    ["Data source", k.cyl(32, 8, 38, 40, 1) + k.arrow(32, 52, 32, 60, { k: "i", head: 5 })],
    ["Data lake", k.path("M6 28 Q16 22 26 28 T46 28 T60 28 V50 Q60 56 54 56 H12 Q6 56 6 50 Z", { f: "t" }) + k.path("M6 38 Q16 32 26 38 T46 38 T60 38", { open: true, sw: 2 }) + k.path("M6 47 Q16 41 26 47 T46 47 T60 47", { open: true, sw: 2 }) + k.cloud(16, 4, 0.7, { k: "i", f: "w", sw: 2.4 })],
    ["Data warehouse", k.cyl(18, 22, 24, 34, 2) + k.cyl(46, 22, 24, 34, 2) + k.rect(8, 8, 48, 10, { f: "w" }) + k.line(14, 13, 50, 13, { sw: 2, k: "i" })],
    ["Batch job", k.clock(26, 32, 18) + k.gear(48, 46, 7, { sw: 2.4 })],
    ["Stream", k.path("M4 18 Q16 8 28 18 T52 18", { open: true }) + k.path("M4 32 Q16 22 28 32 T52 32", { open: true, k: "i" }) + k.path("M4 46 Q16 36 28 46 T52 46", { open: true }) + k.arrow(52, 32, 61, 32, { head: 5, k: "i" })],
    ["Message queue / topic", k.rect(4, 22, 12, 20, { f: "t", r: 2 }) + k.rect(20, 22, 12, 20, { f: "t", r: 2 }) + k.rect(36, 22, 12, 20, { f: "w", r: 2, k: "i" }) + k.arrow(50, 32, 61, 32, { head: 5 })],
    ["Pipeline", k.rect(4, 24, 16, 16, { f: "t" }) + k.rect(24, 24, 16, 16, { f: "t" }) + k.rect(44, 24, 16, 16, { f: "t" }) + k.line(20, 32, 24, 32, { k: "i" }) + k.line(40, 32, 44, 32, { k: "i" }) + k.line(4, 50, 60, 50, { k: "i", dash: true, sw: 2 })],
    ["DAG (orchestration)", k.graph([[10, 32], [28, 14], [28, 50], [46, 32], [58, 32]], [[0, 1], [0, 2], [1, 3], [2, 3], [3, 4]], 5.5)],
    ["Transform (SQL / dbt-style)", k.rect(6, 12, 52, 40, { f: "t" }) + k.path("M22 26 L14 32 L22 38", { open: true, k: "i" }) + k.path("M42 26 L50 32 L42 38", { open: true, k: "i" }) + k.line(34, 24, 30, 40, { sw: 2.4 })],
    ["Schema registry", k.table(6, 10, 34, 34, 4, 2) + k.rect(36, 34, 22, 22, { f: "w", k: "i" }) + k.path("M42 45 L46 49 L53 41", { open: true, sw: 2.6 })],
    ["Data catalog", k.path("M10 10 H46 Q50 10 50 14 V54 H14 Q10 54 10 50 Z", { f: "t" }) + k.line(18, 22, 42, 22, { sw: 2 }) + k.line(18, 30, 42, 30, { sw: 2 }) + k.circ(46, 44, 9, { f: "w", k: "i" }) + k.line(53, 51, 60, 58, { k: "i", sw: 4 })],
    ["Data quality check", k.path("M32 6 L54 14 V32 C54 44 44 52 32 58 C20 52 10 44 10 32 V14 Z", { f: "t" }) + k.path("M22 32 L29 39 L43 24", { open: true, sw: 3.4 })],
    ["Partition", k.table(6, 8, 52, 22, 3, 4) + k.arrow(20, 34, 12, 46, { head: 5, k: "i" }) + k.arrow(44, 34, 52, 46, { head: 5, k: "i" }) + k.rect(4, 48, 20, 12, { f: "t", r: 2 }) + k.rect(40, 48, 20, 12, { f: "t", r: 2 })],
    ["Change data capture (CDC)", k.table(6, 10, 34, 40, 4, 2) + k.poly([[48, 14], [58, 32], [38, 32]], { f: "t" }) + k.arrow(48, 38, 48, 56, { head: 5, k: "i" })],
    ["Lakehouse table", k.rect(8, 8, 48, 12, { f: "t" }) + k.rect(8, 24, 48, 12, { f: "w" }) + k.rect(8, 40, 48, 12, { f: "t" }) + k.line(14, 14, 30, 14, { sw: 2, k: "i" }) + k.line(14, 30, 30, 30, { sw: 2, k: "i" }) + k.line(14, 46, 30, 46, { sw: 2, k: "i" })],
    ["Notebook", k.rect(10, 6, 44, 52, { f: "w", r: 4 }) + k.rect(16, 14, 32, 12, { f: "t", r: 2, sw: 2 }) + k.rect(16, 32, 32, 12, { f: "t", r: 2, sw: 2 }) + k.line(4, 14, 10, 14, { k: "i", sw: 2 }) + k.line(4, 32, 10, 32, { k: "i", sw: 2 }) + k.line(4, 50, 10, 50, { k: "i", sw: 2 })],
    ["Dashboard", k.rect(4, 8, 56, 48, { f: "w", r: 4 }) + k.bars(14, 46, [10, 20, 14, 26], 7, 4, { sw: 2 }) + k.circ(46, 24, 7, { f: "t", sw: 2 }) + k.line(40, 40, 54, 40, { sw: 2, k: "i" })],
    ["API / ingestion endpoint", k.rect(6, 14, 34, 36, { f: "t" }) + k.path("M16 28 L12 32 L16 36", { open: true, k: "i", sw: 2.4 }) + k.path("M30 28 L34 32 L30 36", { open: true, k: "i", sw: 2.4 }) + k.arrow(44, 32, 60, 32, { head: 6 })],
    ["Object storage", k.path("M8 18 H56 L50 56 H14 Z", { f: "t" }) + k.ell(32, 18, 24, 6, { f: "w" }) + k.line(22, 34, 42, 34, { sw: 2 }) + k.line(24, 44, 40, 44, { sw: 2 })],
    ["Columnar file (Parquet-style)", k.rect(8, 8, 12, 48, { f: "t", r: 2 }) + k.rect(26, 8, 12, 48, { f: "w", r: 2 }) + k.rect(44, 8, 12, 48, { f: "t", r: 2 }) + k.line(11, 20, 17, 20, { sw: 2 }) + k.line(29, 30, 35, 30, { sw: 2 }) + k.line(47, 40, 53, 40, { sw: 2 })],
    ["Data lineage", k.rect(4, 22, 14, 20, { f: "t" }) + k.rect(25, 8, 14, 16, { f: "t" }) + k.rect(25, 40, 14, 16, { f: "t" }) + k.rect(46, 22, 14, 20, { f: "w", k: "i" }) + k.path("M18 28 L25 16 M18 36 L25 48 M39 16 L46 28 M39 48 L46 36", { open: true, sw: 2.4, k: "i" })],
  ].map(([name, body]) => ({ name, svg: svg(body) }));
})();

// ---------------------------------------------------------------------------------------------------------------
// Machine learning
// ---------------------------------------------------------------------------------------------------------------
const ml = (() => {
  const k = kit("#7048e8", "#e5dbff");
  const net = (x) => [[x, 14], [x, 32], [x, 50]];
  return [
    ["Dataset", k.cyl(32, 6, 36, 20, 0) + k.cyl(32, 22, 36, 20, 0) + k.cyl(32, 38, 36, 20, 0)],
    ["Feature store", k.table(6, 8, 36, 36, 4, 3) + k.rect(34, 34, 24, 24, { f: "t" }) + k.path("M40 46 H52 M46 40 V52", { open: true, k: "i" })],
    ["Training job", k.gear(26, 32, 13) + k.arrow(46, 50, 60, 50, { head: 5, k: "i" }) + k.path("M46 14 Q54 14 54 22", { open: true, sw: 2.4, k: "i" })],
    ["Model (neural network)", k.graph([...net(10), ...net(32), ...net(54)].map((p) => p), [[0, 3], [0, 4], [1, 3], [1, 4], [1, 5], [2, 4], [2, 5], [3, 6], [3, 7], [4, 6], [4, 7], [4, 8], [5, 7], [5, 8]], 4.5)],
    ["Model registry", k.rect(6, 12, 40, 40, { f: "t" }) + k.graph([[16, 24], [26, 40], [36, 24]], [[0, 1], [1, 2]], 3.4, { sw: 2 }) + k.path("M44 28 L58 28 L58 46 L51 52 L44 46 Z", { f: "w", k: "i" }) + k.dot(51, 36, 2.4, { f: "i", k: "i" })],
    ["Inference endpoint", k.rect(6, 10, 36, 44, { f: "t" }) + k.line(12, 22, 36, 22, { sw: 2 }) + k.line(12, 32, 36, 32, { sw: 2 }) + k.dot(14, 44, 2.4) + k.arrow(44, 32, 60, 32, { head: 6, k: "i" })],
    ["Evaluation", k.rect(6, 8, 52, 48, { f: "w", r: 4 }) + k.path("M12 46 L24 32 L34 38 L50 18", { open: true }) + k.circ(46, 46, 8, { f: "t", sw: 2.4 }) + k.path("M42 46 L45 49 L51 43", { open: true, sw: 2.4, k: "i" })],
    ["Hyperparameter tuning", k.line(10, 18, 54, 18, { k: "i" }) + k.line(10, 32, 54, 32, { k: "i" }) + k.line(10, 46, 54, 46, { k: "i" }) + k.circ(24, 18, 6, { f: "t" }) + k.circ(42, 32, 6, { f: "t" }) + k.circ(30, 46, 6, { f: "t" })],
    ["Experiment tracking", k.path("M24 6 H40 M28 6 V22 L14 48 Q12 54 18 54 H46 Q52 54 50 48 L36 22 V6", { f: "t", open: false }) + k.line(20, 40, 44, 40, { sw: 2 }) + k.dot(30, 47, 2.6) + k.dot(38, 46, 2)],
    ["Embeddings / vector store", [[14, 44], [22, 30], [30, 38], [40, 20], [48, 32], [52, 46], [24, 16]].map(([x, y]) => k.dot(x, y, 3.4)).join("") + k.arrow(8, 56, 8, 8, { k: "i", head: 5, sw: 2.4 }) + k.arrow(8, 56, 58, 56, { k: "i", head: 5, sw: 2.4 })],
    ["Labeling", k.rect(6, 12, 40, 40, { f: "t" }) + k.circ(20, 28, 4, { f: "w", sw: 2 }) + k.path("M10 44 L22 34 L32 42 L42 32", { open: true, sw: 2 }) + k.path("M44 28 L58 28 L58 46 L51 52 L44 46 Z", { f: "w", k: "i" })],
    ["ML pipeline", k.rect(4, 22, 14, 20, { f: "t" }) + k.rect(25, 22, 14, 20, { f: "t" }) + k.rect(46, 22, 14, 20, { f: "t" }) + k.arrow(18, 32, 25, 32, { head: 5, k: "i" }) + k.arrow(39, 32, 46, 32, { head: 5, k: "i" }) + k.path("M53 46 Q32 60 11 46", { open: true, dash: true, sw: 2, k: "i" })],
    ["Drift monitoring", k.path("M6 40 Q16 16 26 34 T46 30 T58 22", { open: true }) + k.line(6, 54, 58, 54, { k: "i", sw: 2 }) + k.path("M46 8 L56 24 H36 Z", { f: "t" }) + k.line(46, 14, 46, 19, { sw: 2.4 }) + k.dot(46, 22, 1.4)],
    ["A/B test", k.rect(4, 22, 12, 20, { f: "w", k: "i" }) + k.arrow(16, 28, 28, 18, { head: 5, k: "i" }) + k.arrow(16, 36, 28, 46, { head: 5, k: "i" }) + k.rect(30, 8, 28, 18, { f: "t" }) + k.rect(30, 38, 28, 18, { f: "t" }) + k.line(38, 17, 50, 17, { sw: 2 }) + k.line(38, 47, 50, 47, { sw: 2 })],
    ["Batch prediction", k.table(4, 10, 24, 34, 4, 2) + k.arrow(30, 27, 38, 27, { head: 5, k: "i" }) + k.rect(40, 10, 20, 34, { f: "t" }) + k.line(44, 20, 56, 20, { sw: 2 }) + k.line(44, 28, 56, 28, { sw: 2 }) + k.line(44, 36, 56, 36, { sw: 2 }) + k.line(4, 54, 60, 54, { k: "i", dash: true, sw: 2 })],
    ["LLM / prompt", k.path("M8 10 H56 Q58 10 58 12 V38 Q58 40 56 40 H30 L18 52 V40 H8 Q6 40 6 38 V12 Q6 10 8 10 Z", { f: "t" }) + k.line(14, 20, 50, 20, { sw: 2.4 }) + k.line(14, 29, 38, 29, { sw: 2.4 })],
    ["Retrieval-augmented generation (RAG)", k.doc(4, 8, 24, 34, 2, { k: "i" }) + k.doc(10, 14, 24, 34, 2) + k.arrow(36, 34, 42, 34, { head: 5, k: "i" }) + k.path("M44 14 H60 V36 H52 L46 44 V36 H44 Z", { f: "t" })],
    ["Fine-tuning", k.gear(24, 32, 12) + k.line(46, 10, 46, 54, { k: "i" }) + k.circ(46, 24, 5, { f: "w", k: "i" }) + k.line(56, 10, 56, 54, { k: "i" }) + k.circ(56, 40, 5, { f: "w", k: "i" })],
    ["AI agent (tool loop)", k.circ(32, 32, 10, { f: "t" }) + k.path("M32 8 A24 24 0 0 1 56 32", { open: true, k: "i", sw: 2.4 }) + k.path("M32 56 A24 24 0 0 1 8 32", { open: true, k: "i", sw: 2.4 }) + k.arrow(54, 26, 56, 32, { head: 4, k: "i" }) + k.arrow(10, 38, 8, 32, { head: 4, k: "i" }) + k.rect(26, 4, 12, 8, { f: "w", r: 2, sw: 2 }) + k.rect(26, 52, 12, 8, { f: "w", r: 2, sw: 2 })],
  ].map(([name, body]) => ({ name, svg: svg(body) }));
})();

module.exports = {
  sections: [
    { key: "gis", title: "Trazo · GIS & Spatial Data", accent: "#2b8a3e", icons: gis },
    { key: "data", title: "Trazo · Data Engineering", accent: "#1971c2", icons: data },
    { key: "ml", title: "Trazo · Machine Learning", accent: "#7048e8", icons: ml },
  ],
};
