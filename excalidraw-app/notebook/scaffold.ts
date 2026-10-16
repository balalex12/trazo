// The importer the other way round: a data-flow diagram on the canvas becomes the first draft of a notebook, one code
// cell per box in the order the data flows, with the loading, the steps and the saving it can tell from the boxes and
// leaves a TODO where it cannot. No AI: the same diagram always gives the same cells. The cells are not run.
import type { CanvasIndex, NodeInfo } from "../agent/canvas";

/** how to read a file, by its extension; the second item is an import it needs */
const READERS: Record<string, [string, string?]> = {
  csv: ['pd.read_csv("{f}")'],
  tsv: ['pd.read_csv("{f}", sep="\\t")'],
  txt: ['pd.read_csv("{f}")'],
  parquet: ['pd.read_parquet("{f}")'],
  json: ['pd.read_json("{f}")'],
  xlsx: ['pd.read_excel("{f}")'],
  xls: ['pd.read_excel("{f}")'],
  geojson: ['gpd.read_file("{f}")', "import geopandas as gpd"],
  gpkg: ['gpd.read_file("{f}")', "import geopandas as gpd"],
  shp: ['gpd.read_file("{f}")', "import geopandas as gpd"],
  tif: ['rasterio.open("{f}")', "import rasterio"],
  tiff: ['rasterio.open("{f}")', "import rasterio"],
};

const WRITERS: Record<string, string> = {
  csv: '{v}.to_csv("{f}", index=False)',
  tsv: '{v}.to_csv("{f}", sep="\\t", index=False)',
  parquet: '{v}.to_parquet("{f}")',
  json: '{v}.to_json("{f}")',
  xlsx: '{v}.to_excel("{f}", index=False)',
  geojson: '{v}.to_file("{f}", driver="GeoJSON")',
  gpkg: '{v}.to_file("{f}", driver="GPKG")',
  pkl: 'pd.to_pickle({v}, "{f}")',
};

/** a Python string literal (JSON strings are valid ones) */
const py = (s: string) => JSON.stringify(s);

/** "📥 customers.csv" -> "customers.csv": the name of a box without its leading icon */
const plain = (label: string) => label.replace(/^[^\p{L}\p{N}_]+/u, "").trim();

const extensionOf = (name: string): string | null => {
  const m = /\.([A-Za-z0-9]{2,8})$/.exec(name);
  return m ? m[1].toLowerCase() : null;
};

/** a valid, readable, unique Python name for a box */
const nameFor = (label: string, taken: Set<string>): string => {
  let base = plain(label)
    .replace(/\.[A-Za-z0-9]{2,8}$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base || /^\d/.test(base)) {
    base = `df_${base}`.replace(/_$/, "");
  }
  if (
    [
      "class",
      "def",
      "for",
      "if",
      "in",
      "is",
      "not",
      "or",
      "and",
      "import",
      "from",
      "as",
      "with",
      "lambda",
      "return",
      "pass",
      "del",
      "none",
      "true",
      "false",
    ].includes(base)
  ) {
    base = `${base}_df`;
  }
  let name = base;
  for (let i = 2; taken.has(name); i++) {
    name = `${base}_${i}`;
  }
  taken.add(name);
  return name;
};

/** the boxes in the order the data flows (upstream first); boxes in a cycle follow in the order they sit on the canvas */
const flowOrder = (index: CanvasIndex): NodeInfo[] => {
  const nodes = [...index.nodes.values()].sort(
    (a, b) => a.box.x - b.box.x || a.box.y - b.box.y,
  );
  const incoming = new Map<string, Set<string>>(
    nodes.map((n) => [n.key, new Set()]),
  );
  for (const e of index.edges) {
    if (incoming.has(e.from) && incoming.has(e.to) && e.from !== e.to) {
      incoming.get(e.to)!.add(e.from);
    }
  }
  const done = new Set<string>();
  const out: NodeInfo[] = [];
  while (out.length < nodes.length) {
    const next =
      nodes.find(
        (n) =>
          !done.has(n.key) &&
          [...incoming.get(n.key)!].every((k) => done.has(k)),
      ) ?? nodes.find((n) => !done.has(n.key))!;
    done.add(next.key);
    out.push(next);
  }
  return out;
};

/** the comment lines that say what a box is: its name and its details (a table's columns, an operation) */
const describe = (n: NodeInfo): string[] => {
  const lines = [`# ${plain(n.label)}`];
  const details = n.details
    .split("\n")
    .map((d) => d.trim())
    .filter(Boolean);
  const columns = details
    .filter((d) => d.startsWith("·"))
    .map((d) => d.replace(/^·\s*/, "").split(/\s{2,}/)[0]);
  const other = details.filter((d) => !d.startsWith("·"));
  other.forEach((d) => lines.push(`# ${d}`));
  if (columns.length) {
    lines.push(`# columns: ${columns.join(", ")}`);
  }
  return lines;
};

/**
 * The cells of the first draft of the notebook for the diagram (the first one has the imports), or null when the
 * canvas has no boxes.
 */
export const diagramToCells = (index: CanvasIndex): string[] | null => {
  if (!index.nodes.size) {
    return null;
  }
  const order = flowOrder(index);
  const taken = new Set<string>();
  const vars = new Map(order.map((n) => [n.key, nameFor(n.label, taken)]));
  const upstream = (n: NodeInfo) => [
    ...new Set(
      index.edges
        .filter((e) => e.to === n.key && vars.has(e.from))
        .map((e) => e.from),
    ),
  ];
  const downstream = (n: NodeInfo) =>
    index.edges.filter((e) => e.from === n.key && vars.has(e.to));

  const imports = new Set(["import pandas as pd"]);
  const cells: string[] = [];
  for (const n of order) {
    const v = vars.get(n.key)!;
    const ups = upstream(n).map((k) => vars.get(k)!);
    const file = plain(n.label);
    const ext = extensionOf(file);
    const lines = describe(n);

    let echo = v;
    if (!ups.length) {
      const reader = ext ? READERS[ext] : undefined;
      if (reader) {
        if (reader[1]) {
          imports.add(reader[1]);
        }
        lines.push(`${v} = ${reader[0].replace("{f}", file)}`);
        // a first look at what was loaded (a raster dataset has no head)
        echo = ext === "tif" || ext === "tiff" ? v : `${v}.head()`;
      } else {
        lines.push(`${v} = pd.DataFrame()  # TODO: load ${py(file)}`);
      }
    } else if (!downstream(n).length && ext && WRITERS[ext]) {
      // the end of the flow, named like a file: write what comes in
      lines.push(WRITERS[ext].replace("{v}", ups[0]).replace("{f}", file));
      echo = "";
    } else if (ups.length === 1) {
      lines.push(
        `${v} = ${ups[0]}.copy()  # TODO: the step "${plain(n.label)}"`,
      );
    } else {
      lines.push(
        `${v} = ${ups[0]}.merge(${
          ups[1]
        }, on="TODO", how="left")  # TODO: join ${ups.join(", ")}`,
      );
      ups.slice(2).forEach((u) => lines.push(`# also uses ${u}`));
    }
    if (
      n.role === "function" &&
      /model|forest|regress|classif|cluster|boost/i.test(n.label)
    ) {
      lines.push("# TODO: fit the model here (from sklearn import ...)");
    }
    if (echo) {
      lines.push(echo);
    }
    cells.push(lines.join("\n"));
  }
  return [[...imports].sort().join("\n"), ...cells];
};
