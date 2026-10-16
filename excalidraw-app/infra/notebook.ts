// A Jupyter notebook (.ipynb) to a data lineage diagram: where the data comes from (files, URLs, databases), which
// variables hold it, how each one is derived from the others (merge, groupby, train_test_split, predict…), which
// models are trained on what, and what is written out (files, charts). The structure of each table is read from what
// the notebook already shows: the columns of `df.head()` and `df.info()` outputs, and from the code (`usecols`,
// `DataFrame({...})`, `df["new"] = ...`, `.assign(...)`, column selections).
//
// A small Python reader written for this (no Python, no kernel, nothing is run): it splits the code into statements,
// follows assignments and calls, and ignores what it does not know. Python notebooks only. Deterministic and offline.
import { MAX_NODES, clip } from "./graph";

import type { Graph, GraphEdge, GraphNode, Role } from "./graph";

/* eslint-disable @typescript-eslint/no-explicit-any */

const MAX_COLUMNS = 7;
const MAX_STATEMENTS = 5000;

// ---- reading Python ---------------------------------------------------------------------------------------------
type Stmt = { text: string; indent: number };

/** logical statements: comments dropped, strings and brackets kept whole, `;` and line ends split, magics skipped */
export const splitStatements = (src: string): Stmt[] => {
  const out: Stmt[] = [];
  let cur = "";
  let depth = 0;
  let i = 0;
  const push = () => {
    const raw = cur;
    cur = "";
    const text = raw.trim();
    if (text && !/^[%!?]/.test(text)) {
      out.push({ text, indent: /^[ \t]*/.exec(raw)![0].length });
    }
  };
  while (i < src.length && out.length < MAX_STATEMENTS) {
    const c = src[i];
    if (c === "#") {
      while (i < src.length && src[i] !== "\n") {
        i++;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      const triple = src.startsWith(c.repeat(3), i);
      const q = triple ? c.repeat(3) : c;
      let j = i + q.length;
      while (j < src.length) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src.startsWith(q, j)) {
          j += q.length;
          break;
        }
        if (!triple && src[j] === "\n") {
          break;
        }
        j++;
      }
      cur += src.slice(i, j);
      i = j;
      continue;
    }
    if (c === "\\" && src[i + 1] === "\n") {
      cur += " ";
      i += 2;
      continue;
    }
    if ("([{".includes(c)) {
      depth++;
    } else if (")]}".includes(c)) {
      depth = Math.max(0, depth - 1);
    }
    if ((c === "\n" || c === ";") && depth === 0) {
      push();
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  push();
  return out;
};

/** the text with the inside of every string literal blanked out (same length, so positions still match): `"a, b"` -> `"    "` */
const blank = (s: string): string =>
  s.replace(
    /([rbfuRBFU]{0,2})("""[^]*?"""|'''[^]*?'''|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/g,
    (_m, p, q) => {
      const quote =
        q.startsWith(q[0].repeat(3)) && q.length >= 6 ? q[0].repeat(3) : q[0];
      const inner = q.slice(quote.length, q.length - quote.length);
      return `${p}${quote}${inner.replace(/[^\n]/g, " ")}${quote}`;
    },
  );

/** the string literals of a piece of code, in order */
const literals = (s: string): string[] =>
  [
    ...s.matchAll(
      /(?:[rbfuRBFU]{0,2})(?:"""([^]*?)"""|'''([^]*?)'''|"((?:\\.|[^"\\\n])*)"|'((?:\\.|[^'\\\n])*)')/g,
    ),
  ].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4] ?? "");

/** index of the first top-level `=` that assigns (not ==, <=, >=, !=, +=, :=), or -1 */
const assignAt = (s: string): number => {
  let depth = 0;
  const b = blank(s);
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if ("([{".includes(c)) {
      depth++;
    } else if (")]}".includes(c)) {
      depth--;
    } else if (c === "=" && depth === 0) {
      if (b[i + 1] === "=" || "=!<>+-*/%&|^@:".includes(b[i - 1] || " ")) {
        if (b[i + 1] === "=") {
          i++;
        }
        continue;
      }
      return i;
    }
  }
  return -1;
};

const splitTop = (s: string, sep: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  const b = blank(s);
  for (let i = 0; i < b.length; i++) {
    if ("([{".includes(b[i])) {
      depth++;
    } else if (")]}".includes(b[i])) {
      depth--;
    } else if (b[i] === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((p) => p.trim()).filter(Boolean);
};

// ---- what the code means ---------------------------------------------------------------------------------------------
const READ_FN =
  /\b(?:read_(?:csv|parquet|excel|json|sql|sql_query|sql_table|file|feather|pickle|table|hdf|orc|fwf|stata|sas|spss|html|xml|gbq)|load_dataset|open_dataset|open_mfdataset|from_file|from_csv|imread|loadtxt|genfromtxt|fetch_\w+|read_raster|read_vector|read_geojson)\s*\(/;
const QUALIFIED_OPEN =
  /\b(?:rasterio\.open|xr\.open_dataset|xarray\.open_dataset|np\.load|numpy\.load|joblib\.load|pickle\.load|torch\.load|gdal\.Open|ogr\.Open|fiona\.open|h5py\.File|netCDF4\.Dataset)\s*\(/;
const SPARK_READ =
  /\.read\b[^]*?\.(?:csv|parquet|json|load|table|jdbc|orc|text)\s*\(/;
const WEB_READ =
  /\b(?:requests|httpx)\.(?:get|post)\s*\(|\burlopen\s*\(|\burlretrieve\s*\(/;
const CONSTRUCTOR =
  /\b(?:pd|pandas|gpd|geopandas|dd|dask\.dataframe|pl|polars|np|numpy|xr|xarray)\.(?:DataFrame|GeoDataFrame|Series|array|zeros|ones|arange|linspace|empty|full|random\.\w+|Dataset|DataArray|LazyFrame)\s*\(/;
const MODEL_MODULES =
  /^(?:sklearn|xgboost|lightgbm|catboost|statsmodels|torch|tensorflow|keras|transformers|prophet|pycaret|imblearn|scipy\.cluster|scipy\.optimize)/;
const SINK_METHODS =
  /\.(to_csv|to_parquet|to_excel|to_json|to_sql|to_pickle|to_feather|to_file|to_hdf|to_orc|to_stata|to_netcdf|to_zarr|to_postgis|to_markdown|savefig|save|write_csv|write_parquet)\s*\(/;
const SINK_FUNCS =
  /\b(?:joblib\.dump|pickle\.dump|np\.save|np\.savez|numpy\.save|torch\.save|json\.dump|dump)\s*\(/;
const CHART_CALLS =
  /\b(?:plt|ax|sns|px|go|alt|hv|folium|fig)\.\w+\s*\(|\.plot(?:\.\w+)?\s*\(|\.hist\s*\(|\.boxplot\s*\(|\.explore\s*\(/;
const TRIVIAL_METHODS = new Set([
  "copy",
  "head",
  "tail",
  "reset_index",
  "values",
  "to_numpy",
  "astype",
  "sample",
  "info",
  "describe",
  "shape",
  "columns",
  "index",
  "dtypes",
  "iloc",
  "loc",
  "get",
  "items",
  "keys",
  "format",
  "join_str",
  "append",
  "len",
  "print",
  "round",
  "lower",
  "upper",
  "strip",
  "split",
  "isin",
]);

const base = (path: string): string => {
  const p = (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(path) ? path.split(/[?#]/)[0] : path
  ).replace(/\/+$/, "");
  const name = p.split("/").pop() || p;
  return name || path;
};

type Kind = "source" | "frame" | "array" | "model" | "sink" | "chart";
type NodeInfo = {
  id: string;
  kind: Kind;
  name: string;
  /** a short description of what it is: DataFrame, GeoDataFrame, RandomForestClassifier… */
  what: string;
  cell: number;
  /** the position of its code cell among the code cells (1 for the first): stable, unlike the execution count */
  ord: number;
  heading: string;
  ops: string[];
  cols: Map<string, string>; // column -> dtype ("" when unknown)
  notes: string[];
};

/** column names (and types) shown by an output: `df.head()` as HTML or text, `df.info()`, `df.columns`, `df.dtypes` */
export const columnsFromOutput = (
  text: string,
  html = "",
): [string, string][] => {
  const out: [string, string][] = [];
  const head = /<thead>([^]*?)<\/thead>/i.exec(html);
  if (head) {
    const ths = [...head[1].matchAll(/<th[^>]*>([^<]*)<\/th>/gi)].map((m) =>
      m[1].trim(),
    );
    ths.forEach((t, i) => {
      if (t || i > 0) {
        out.push([t, ""]);
      }
    });
    if (out.length) {
      return out.filter(([n]) => n).slice(0, 60);
    }
  }
  // df.info(): " 0   name    1000 non-null   object"
  for (const m of text.matchAll(/^\s*\d+\s+(\S+)\s+\d+\s+non-null\s+(\S+)/gm)) {
    out.push([m[1], m[2]]);
  }
  if (out.length) {
    return out.slice(0, 60);
  }
  // df.columns: Index(['a', 'b'], dtype='object')
  const idx = /Index\(\s*\[([^\]]*)\]/.exec(text);
  if (idx) {
    return literals(idx[1])
      .map((n) => [n, ""] as [string, string])
      .slice(0, 60);
  }
  // df.dtypes: "name    object" lines ending with dtype: object
  const dt = text
    .split("\n")
    .filter((l) =>
      /^\S+\s+(?:int|float|object|bool|datetime|category|string|geometry|uint)\w*(?:\[.*\])?\s*$/.test(
        l,
      ),
    );
  if (dt.length >= 2 && /dtype:/.test(text)) {
    return dt.map((l) => {
      const [n, t] = l.trim().split(/\s+/);
      return [n, t] as [string, string];
    });
  }
  // df.head() as text: the first line is the header: "   id   name   price"
  const lines = text.split("\n").filter((l) => l.trim());
  if (
    lines.length >= 2 &&
    /^\s+\S/.test(lines[0]) &&
    /^\s*\d+\s/.test(lines[1])
  ) {
    return lines[0]
      .trim()
      .split(/\s{2,}|\s+/)
      .filter(Boolean)
      .map((n) => [n, ""] as [string, string])
      .slice(0, 60);
  }
  return [];
};

const text = (v: unknown): string =>
  Array.isArray(v) ? v.join("") : typeof v === "string" ? v : "";

/** how the columns of the inputs carry over to the result of an expression */
const inheritMode = (rb: string): "join" | "all" | "none" | "unknown" => {
  if (/merge|\.join\(|concat|sjoin|overlay|combine/.test(rb)) {
    return "join";
  }
  if (
    /groupby|\.agg\(|aggregate|pivot|melt|describe|value_counts|\.size\(|\.count\(|crosstab|unstack|\.stack\(|resample|\.mean\(|\.sum\(|\.median\(|\.std\(|\.max\(|\.min\(/.test(
      rb,
    )
  ) {
    return "none";
  }
  if (
    /dropna|fillna|query|sort_|drop_duplicates|reset_index|\.copy\(|sample|\.head|\.tail|filter|rename|astype|\.loc\[|\.iloc\[|\[\s*\w+\s*\[|to_crs|buffer|clip|set_index|assign|apply|\.map\(|replace|round|\.where\(|\.mask\(|reindex|explode|drop\(|\[\s*\[/.test(
      rb,
    )
  ) {
    return "all";
  }
  return "unknown";
};

/** the columns an aggregation names: the group keys and the aggregated columns (`agg({"total": "sum"})`, `agg(n=("id", "count"))`) */
const aggregateColumns = (expr: string): string[] => {
  const out: string[] = [];
  const g = /groupby\(\s*(\[[^\]]*\]|"[^"]+"|'[^']+')/.exec(expr);
  if (g) {
    out.push(...literals(g[1]));
  }
  const d = /\.agg(?:regate)?\(\s*\{([^}]*)\}/.exec(expr);
  if (d) {
    for (const m of d[1].matchAll(/["']([^"']+)["']\s*:/g)) {
      out.push(m[1]);
    }
  }
  const named = /\.agg(?:regate)?\(([^{}]*)\)/.exec(expr);
  if (named) {
    for (const m of named[1].matchAll(/(?:^|,)\s*([A-Za-z_]\w*)\s*=\s*\(/g)) {
      out.push(m[1]);
    }
  }
  return [...new Set(out)];
};

export const parseNotebook = (raw: string): Graph => {
  let nb: any;
  try {
    nb = JSON.parse(raw);
  } catch (e) {
    throw new Error(`That is not valid JSON: ${(e as Error).message}`);
  }
  if (!nb || !Array.isArray(nb.cells)) {
    throw new Error("That does not look like a Jupyter notebook (no cells).");
  }
  const lang = String(
    nb.metadata?.language_info?.name ||
      nb.metadata?.kernelspec?.language ||
      "python",
  ).toLowerCase();
  if (lang !== "python") {
    throw new Error(
      `Only Python notebooks can be read (this one is ${lang}). Export it as a script or paste the Python code in a Python notebook.`,
    );
  }

  const nodes = new Map<string, NodeInfo>();
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  /** the node that currently holds each variable */
  const vars = new Map<string, NodeInfo>();
  const versions = new Map<string, number>();
  const modelClasses = new Set<string>();
  const notes: string[] = [];
  let seq = 0;
  let heading = "";
  let ordinal = 0;
  let skippedCells = 0;

  const addNode = (
    kind: Kind,
    name: string,
    what: string,
    cell: number,
  ): NodeInfo => {
    if (nodes.size >= MAX_NODES) {
      throw new Error(
        `That notebook has too many steps to draw (over ${MAX_NODES}). Try a part of it.`,
      );
    }
    const n: NodeInfo = {
      id: `nb${++seq}`,
      kind,
      name,
      what,
      cell,
      ord: ordinal,
      heading,
      ops: [],
      cols: new Map(),
      notes: [],
    };
    nodes.set(n.id, n);
    return n;
  };
  const link = (from: NodeInfo, to: NodeInfo, label?: string) => {
    if (from === to) {
      return;
    }
    const key = `${from.id}>${to.id}`;
    if (edgeKeys.has(key)) {
      return;
    }
    edgeKeys.add(key);
    edges.push({
      id: `e${edges.length}:${key}`,
      from: from.id,
      to: to.id,
      kind: "depends",
      ...(label ? { label: clip(label, 24) } : {}),
    });
  };
  /** a variable gets a node; a name that is assigned fresh again gets a new one (df (2)) */
  const bindVar = (
    name: string,
    kind: Kind,
    what: string,
    cell: number,
    fresh: boolean,
  ): NodeInfo => {
    const existing = vars.get(name);
    if (existing && !fresh && existing.kind !== "source") {
      return existing;
    }
    const v = (versions.get(name) || 0) + 1;
    versions.set(name, v);
    const n = addNode(kind, v > 1 ? `${name} (${v})` : name, what, cell);
    vars.set(name, n);
    return n;
  };

  const depsOf = (expr: string): NodeInfo[] => {
    const found: NodeInfo[] = [];
    const b = blank(expr);
    for (const m of b.matchAll(/(?<![.\w])([A-Za-z_]\w*)\b(?!\s*=[^=])/g)) {
      const n = vars.get(m[1]);
      if (n && !found.includes(n)) {
        found.push(n);
      }
    }
    return found;
  };
  const opsOf = (expr: string): string[] => {
    const b = blank(expr);
    const seen: string[] = [];
    for (const m of b.matchAll(/(\.)?\b([A-Za-z_]\w*)\s*\(/g)) {
      const f = m[2];
      if (
        TRIVIAL_METHODS.has(f) ||
        /^[A-Z]/.test(f) ||
        (!m[1] && vars.has(f)) ||
        [
          "list",
          "dict",
          "set",
          "str",
          "int",
          "float",
          "len",
          "range",
          "sorted",
          "tuple",
          "zip",
          "enumerate",
          "print",
          "isinstance",
          "min",
          "max",
          "sum",
          "abs",
          "any",
          "all",
        ].includes(f)
      ) {
        continue;
      }
      if (!seen.includes(f)) {
        seen.push(f);
      }
    }
    return seen.slice(0, 4);
  };
  const columnsIn = (expr: string, node: NodeInfo) => {
    const colsParam = /\b(?:usecols|columns)\s*=\s*\[([^\]]*)\]/.exec(expr);
    if (colsParam) {
      literals(colsParam[1]).forEach((c) =>
        node.cols.set(c, node.cols.get(c) || ""),
      );
    }
    const dict = /\bDataFrame\s*\(\s*\{([^}]*)\}/.exec(blankNested(expr));
    if (dict) {
      const orig = /\bDataFrame\s*\(\s*\{([^]*?)\}\s*[,)]/.exec(expr);
      for (const k of (orig ? orig[1] : dict[1]).matchAll(
        /["']([^"']+)["']\s*:/g,
      )) {
        node.cols.set(k[1], "");
      }
    }
    for (const m of expr.matchAll(/\.assign\s*\(([^]*?)\)\s*(?:\.|$)/g)) {
      for (const k of m[1].matchAll(/(?:^|,)\s*([A-Za-z_]\w*)\s*=(?!=)/g)) {
        node.cols.set(k[1], "");
      }
    }
    const sel = /\[\[([^\]]+)\]\]\s*$/.exec(expr.trim());
    if (sel) {
      const names = literals(sel[1]);
      if (names.length) {
        const keep = new Map<string, string>();
        names.forEach((c) => keep.set(c, node.cols.get(c) || ""));
        node.cols = keep;
      }
    }
  };
  const blankNested = (s: string) => s;

  const cellOf = (c: any, i: number) => ({ src: text(c.source), i });

  for (const [ci, cell] of nb.cells.entries()) {
    if (cell.cell_type === "markdown") {
      const h = /^\s{0,3}#{1,4}\s+(.+?)\s*#*\s*$/m.exec(text(cell.source));
      if (h) {
        heading = clip(h[1].replace(/[*_`]/g, ""), 30);
      }
      continue;
    }
    if (cell.cell_type !== "code") {
      continue;
    }
    ordinal++;
    const cellNo =
      typeof cell.execution_count === "number" ? cell.execution_count : ordinal;
    const { src } = cellOf(cell, ci);
    const stmts = splitStatements(src);
    let skipBelow: number | null = null;
    let touched = false;
    let lastExpr = "";
    let chartNode: NodeInfo | null = null;

    for (const st of stmts) {
      if (skipBelow !== null) {
        if (st.indent > skipBelow) {
          continue;
        }
        skipBelow = null;
      }
      const s = st.text;
      if (/^(?:async\s+)?def\s|^class\s/.test(s)) {
        skipBelow = st.indent;
        continue;
      }
      // imports: remember which names are models
      const fromImp = /^from\s+([\w.]+)\s+import\s+(.+)$/.exec(s);
      if (fromImp) {
        if (MODEL_MODULES.test(fromImp[1])) {
          fromImp[2]
            .replace(/[()]/g, "")
            .split(",")
            .forEach((p) => {
              const [name, alias] = p.trim().split(/\s+as\s+/);
              if (/^[A-Z]/.test(alias || name)) {
                modelClasses.add(alias || name);
              }
            });
        }
        continue;
      }
      if (/^import\s/.test(s)) {
        continue;
      }
      const at = assignAt(s);
      const sinkCall = SINK_METHODS.test(blank(s)) || SINK_FUNCS.test(blank(s));

      if (at >= 0 && !sinkCall) {
        const lhs = s
          .slice(0, at)
          .replace(/:\s*[\w[\], .]+$/, "")
          .trim();
        const rhs = s.slice(at + 1).trim();
        const rb = blank(rhs);
        const targets = splitTop(lhs.replace(/^\(|\)$/g, ""), ",");
        // df["new"] = ... / df.col = ...: a column added to a variable
        const sub =
          /^([A-Za-z_]\w*)\s*(?:\[\s*["']([^"']+)["']\s*\]|\.([A-Za-z_]\w*))$/.exec(
            lhs,
          );
        if (sub && vars.has(sub[1])) {
          const node = vars.get(sub[1])!;
          const col = sub[2] ?? sub[3];
          node.cols.set(col, node.cols.get(col) || "");
          const others = depsOf(rhs).filter((d) => d !== node);
          others.forEach((d) => link(d, node, `+${col}`));
          const ops = opsOf(rhs);
          if (ops.length) {
            node.ops.push(...ops.filter((o) => !node.ops.includes(o)));
          }
          touched = true;
          continue;
        }
        const names = targets.filter((t) => /^[A-Za-z_]\w*$/.test(t));
        if (!names.length) {
          continue;
        }
        const deps = depsOf(rhs);
        const selfRef = names.some((nm) =>
          deps.includes(vars.get(nm) as NodeInfo),
        );

        // a source: a read of a file, a database, a URL
        const isRead =
          READ_FN.test(rb) ||
          QUALIFIED_OPEN.test(rb) ||
          SPARK_READ.test(rb) ||
          WEB_READ.test(rb);
        if (isRead && !deps.length) {
          const lits = literals(rhs).filter((l) => l.length > 1);
          const label = lits.length
            ? base(lits[0].replace(/^SELECT[^]*$/i, "SQL query"))
            : "data";
          const fn =
            (/\b([A-Za-z_]\w*)\s*\(/.exec(
              rb.replace(
                /^.*?\b((?:read_\w+|load_dataset|open_dataset|from_file|imread|loadtxt|\w+\.open|\w+\.load|get|post)\b)/,
                "$1",
              ),
            ) || [])[1] || "read";
          const web = WEB_READ.test(rb);
          const src = addNode(
            "source",
            label,
            web ? "web request" : fn,
            cellNo,
          );
          const frame = bindVar(
            names[0],
            /geopandas|gpd|read_file|rasterio|open_dataset|imread/.test(rb)
              ? /rasterio|imread|open_dataset|\.load\(/.test(rb)
                ? "array"
                : "frame"
              : /load\(/.test(rb) && !/read_/.test(rb)
              ? "array"
              : "frame",
            /gpd\.|geopandas|read_file|from_file/.test(rb)
              ? "GeoDataFrame"
              : /rasterio/.test(rb)
              ? "raster"
              : /xr\.|xarray/.test(rb)
              ? "xarray dataset"
              : "DataFrame",
            cellNo,
            true,
          );
          frame.ops = [];
          link(src, frame);
          columnsIn(rhs, frame);
          touched = true;
          continue;
        }
        // a model: Name = SomeEstimator(...)
        const cls =
          /^([A-Z]\w*)\s*\(/.exec(rb) || /^(?:\w+\.)+([A-Z]\w*)\s*\(/.exec(rb);
        if (
          cls &&
          (modelClasses.has(cls[1]) ||
            /^(?:sklearn|xgb|lgb|torch|nn|keras|tf|sm)\./.test(rb))
        ) {
          const model = bindVar(names[0], "model", cls[1], cellNo, true);
          deps.forEach((d) => link(d, model));
          touched = true;
          continue;
        }
        // predict / transform on a model
        const mm =
          /^([A-Za-z_]\w*)\.(predict|predict_proba|transform|fit_transform|score|decision_function|forecast|generate)\s*\(/.exec(
            rhs,
          );
        if (mm && vars.get(mm[1])?.kind === "model") {
          const model = vars.get(mm[1])!;
          const out = bindVar(names[0], "array", "predictions", cellNo, true);
          out.what =
            mm[2] === "transform" || mm[2] === "fit_transform"
              ? "transformed"
              : mm[2] === "score"
              ? "score"
              : "predictions";
          out.ops = [mm[2]];
          link(model, out, mm[2]);
          deps.filter((d) => d !== model).forEach((d) => link(d, out));
          touched = true;
          continue;
        }
        // constructors of data (DataFrame({...}), np.array(...))
        const ctor = CONSTRUCTOR.test(rb) && !deps.length;
        // everything else is worth drawing only when it comes from data we know (or builds a data object)
        if (!deps.length && !ctor) {
          continue;
        }
        const split = /train_test_split|\bsplit\(|KFold/.test(rb);
        const colSel = /^([A-Za-z_]\w*)\s*\[\s*["']([^"']+)["']\s*\]\s*$/.exec(
          rhs.trim(),
        );
        const series = !!colSel && vars.has(colSel[1]);
        const arrayLike =
          series ||
          split ||
          (/\.(?:values|to_numpy)\b|\bnp\.|\bnumpy\./.test(rb) &&
            !/DataFrame|merge|groupby|concat/.test(rb));
        const frameWhat = ctor
          ? /GeoDataFrame/.test(rb)
            ? "GeoDataFrame"
            : /Series|array|zeros|ones|arange|linspace/.test(rb)
            ? "array"
            : "DataFrame"
          : series
          ? "Series"
          : split
          ? "split"
          : deps[0]?.what || "DataFrame";
        const created: NodeInfo[] = names.map((nm) =>
          bindVar(
            nm,
            arrayLike ? "array" : "frame",
            frameWhat,
            cellNo,
            !selfRef || ctor,
          ),
        );
        const ops = opsOf(rhs);
        const joinLike = /merge|join|concat|sjoin|overlay|combine/.test(rb);
        const mode = inheritMode(rb);
        // train_test_split(X, y) returns X_train, X_test, y_train, y_test: each output comes from its own input
        const perArg = split && names.length === deps.length * 2;
        created.forEach((node, m) => {
          const sources = perArg ? [deps[Math.floor(m / 2)]] : deps;
          for (const d of sources) {
            if (d === node) {
              continue;
            }
            link(
              d,
              node,
              joinLike
                ? ops.find((o) =>
                    /merge|join|concat|sjoin|overlay|combine/.test(o),
                  )
                : undefined,
            );
          }
          for (const o of ops) {
            if (!node.ops.includes(o)) {
              node.ops.push(o);
            }
          }
          if (series && colSel) {
            const t = vars.get(colSel[1])!.cols.get(colSel[2]) || "";
            node.cols = new Map([[colSel[2], t]]);
          } else if (mode === "join" || perArg || split) {
            for (const d of sources) {
              d.cols.forEach(
                (t, c) => !node.cols.has(c) && node.cols.set(c, t),
              );
            }
          } else if (mode === "all" && deps[0]) {
            deps[0].cols.forEach(
              (t, c) => !node.cols.has(c) && node.cols.set(c, t),
            );
          } else if (mode === "none") {
            aggregateColumns(rhs).forEach((c) => node.cols.set(c, ""));
          }
          columnsIn(rhs, node);
        });
        touched = true;
        continue;
      }

      // a call on its own: model.fit(X, y), df.to_csv("out.csv"), joblib.dump(model, "m.pkl"), plt.savefig(...)
      const bs = blank(s);
      lastExpr = s;
      const fit =
        /^([A-Za-z_]\w*)\.(fit|partial_fit|train|fit_predict)\s*\(/.exec(s);
      if (fit && vars.get(fit[1])?.kind === "model") {
        const model = vars.get(fit[1])!;
        const inputs = depsOf(s).filter((d) => d !== model);
        inputs.forEach((d) => link(d, model, "fit"));
        if (inputs.length) {
          model.notes.push(
            `fit on ${clip(inputs.map((d) => d.name).join(", "), 30)}`,
          );
        }
        touched = true;
        continue;
      }
      const sink = SINK_METHODS.exec(bs) || SINK_FUNCS.exec(bs);
      if (sink) {
        const lits = literals(s).filter((l) => l.length > 1);
        const objs = depsOf(s);
        const isFig = /savefig/.test(bs);
        const label = lits.length
          ? base(lits[lits.length - 1])
          : isFig
          ? "figure"
          : "output";
        const out = addNode("sink", label, sink[1] || "dump", cellNo);
        objs.forEach((o) => link(o, out));
        if (!objs.length) {
          notes.push(
            `${label}: written, but from something that is not a known variable`,
          );
        }
        touched = true;
        continue;
      }
      if (CHART_CALLS.test(bs)) {
        const objs = depsOf(s);
        if (objs.length) {
          const chart: NodeInfo =
            chartNode ||
            addNode("chart", `chart (cell ${cellNo})`, "plot", cellNo);
          chartNode = chart;
          objs.forEach((o) => link(o, chart));
          touched = true;
        }
      }
    }

    // what the cell shows tells the columns: df.head(), df.info(), df.columns, df.dtypes
    const target =
      /^([A-Za-z_]\w*)(?:\.(?:head|tail|sample|info|describe|dtypes|columns|copy)\s*\([^)]*\)?|\.(?:dtypes|columns))?$/.exec(
        lastExpr.replace(/^print\((.*)\)$/, "$1"),
      );
    const holder = target ? vars.get(target[1]) : undefined;
    if (holder) {
      for (const o of cell.outputs || []) {
        const plain = text(o.data?.["text/plain"]) || text(o.text);
        const html = text(o.data?.["text/html"]);
        for (const [c, t] of columnsFromOutput(plain, html)) {
          if (!holder.cols.has(c) || (t && !holder.cols.get(c))) {
            holder.cols.set(c, t);
          }
        }
      }
    }
    if (!touched) {
      skippedCells++;
    }
  }

  if (!nodes.size) {
    throw new Error(
      "No data steps found in this notebook: I look for reads (pd.read_csv, gpd.read_file…), assignments from them, model fits, and writes (to_csv, savefig…).",
    );
  }

  // ---- the graph ---------------------------------------------------------------------------------------------
  const ROLE: Record<Kind, Role> = {
    source: "storage",
    frame: "database",
    array: "schema",
    model: "function",
    sink: "trigger",
    chart: "monitoring",
  };
  const ICON: Record<Kind, string> = {
    source: "📥",
    frame: "📊",
    array: "🔢",
    model: "🤖",
    sink: "💾",
    chart: "📈",
  };
  const gnodes: GraphNode[] = [...nodes.values()].map((n) => {
    const lines = [`${ICON[n.kind]} ${clip(n.name, 28)}`];
    const where = `cell ${n.cell}${n.heading ? ` · ${n.heading}` : ""}`;
    lines.push(
      clip(
        n.kind === "source" || n.kind === "sink"
          ? `${n.what} · ${where}`
          : `${n.what} · ${where}`,
        40,
      ),
    );
    if (n.ops.length) {
      lines.push(clip(`↳ ${n.ops.slice(0, 4).join(", ")}`, 40));
    }
    n.notes.slice(0, 1).forEach((x) => lines.push(clip(x, 40)));
    const cols = [...n.cols.entries()];
    cols
      .slice(0, MAX_COLUMNS)
      .forEach(([c, t]) =>
        lines.push(`· ${clip(c, 22)}${t ? `  ${clip(t, 10)}` : ""}`),
      );
    if (cols.length > MAX_COLUMNS) {
      lines.push(`… +${cols.length - MAX_COLUMNS} more columns`);
    }
    // the variable a table, array or model is bound to (a re-read one is named "df (2)")
    const variable = /^[A-Za-z_]\w*/.exec(n.name)?.[0];
    return {
      id: n.id,
      lines,
      role: ROLE[n.kind],
      meta: {
        cell: n.ord,
        kind: n.kind,
        ...(variable && n.kind !== "source" && n.kind !== "sink"
          ? { var: variable }
          : {}),
      },
    };
  });
  if (skippedCells) {
    notes.push(
      `${skippedCells} code cell${
        skippedCells > 1 ? "s" : ""
      } had no data steps (imports, settings or helper code)`,
    );
  }
  return {
    nodes: gnodes,
    edges,
    flow: true,
    ...(notes.length ? { notes: notes.slice(0, 3) } : {}),
  };
};
