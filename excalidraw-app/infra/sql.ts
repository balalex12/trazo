// SQL DDL (CREATE TABLE, ALTER TABLE ... FOREIGN KEY) to an entity relationship graph: one box per table with its key
// and columns, one arrow per foreign key. A small scanner written for this (no SQL library); it reads the common
// shape of PostgreSQL, MySQL, SQLite and SQL Server scripts and ignores what it does not know. Deterministic.
import { MAX_NODES, clip } from "./graph";

import type { Graph, GraphEdge, GraphNode } from "./graph";

const MAX_COLUMNS = 8;
/** a single column or constraint definition is cut to this many characters before it is read */
const MAX_ITEM = 4000;

/** the text without -- line comments, # line comments (MySQL) and block comments; strings are kept */
export const stripSqlComments = (s: string): string => {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < s.length && s[j] !== c) {
        j++;
      }
      out += s.slice(i, j + 1);
      i = j + 1;
    } else if (c === "-" && s[i + 1] === "-") {
      while (i < s.length && s[i] !== "\n") {
        i++;
      }
    } else if (c === "#") {
      while (i < s.length && s[i] !== "\n") {
        i++;
      }
    } else if (c === "/" && s[i + 1] === "*") {
      const e = s.indexOf("*/", i + 2);
      const stop = e < 0 ? s.length : e + 2;
      out += s.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
};

/** splits at `sep` outside quotes and parentheses */
export const splitTop = (s: string, sep: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < s.length && s[j] !== c) {
        j++;
      }
      i = j + 1;
      continue;
    }
    if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth--;
    } else if (c === sep && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
};

/** an identifier, possibly quoted and schema-qualified: "public"."Users" -> public.Users */
const IDENT = `(?:"[^"]+"|\`[^\`]+\`|\\[[^\\]]+\\]|[\\w$]+)`;
const QNAME = `${IDENT}(?:\\s*\\.\\s*${IDENT})*`;

export const cleanName = (raw: string): string =>
  raw
    .split(".")
    .map((p) => p.trim().replace(/^["`[]|["`\]]$/g, ""))
    .join(".");

const cols = (raw: string): string[] =>
  splitTop(raw, ",").map((c) => cleanName(c));

type Column = { name: string; type: string; pk: boolean; fk: boolean };
type Table = {
  name: string;
  columns: Column[];
  fks: { columns: string[]; refTable: string }[];
};

const CONSTRAINT_START =
  /^(constraint|primary\s+key|foreign\s+key|unique|check|key|index|fulltext|spatial|exclude|like|period)\b/i;

const parseTable = (name: string, body: string): Table => {
  const table: Table = { name, columns: [], fks: [] };
  const pkCols: string[] = [];
  for (const item of splitTop(body, ",")) {
    const text = item.slice(0, MAX_ITEM).replace(/\s+/g, " ");
    if (CONSTRAINT_START.test(text)) {
      const pk = new RegExp(
        `primary key\\s*(?:clustered\\s*)?\\(([^)]*)\\)`,
        "i",
      ).exec(text);
      if (pk) {
        pkCols.push(...cols(pk[1]));
      }
      const fk = new RegExp(
        `foreign key\\s*\\(([^)]*)\\)\\s*references\\s+(${QNAME})`,
        "i",
      ).exec(text);
      if (fk) {
        table.fks.push({ columns: cols(fk[1]), refTable: cleanName(fk[2]) });
      }
      continue;
    }
    const m = new RegExp(`^(${IDENT})\\s*(.*)$`, "i").exec(text);
    if (!m) {
      continue;
    }
    const rest = m[2];
    const typeMatch =
      /^([A-Za-z_][\w ]*?(?:\([^)]*\))?)(?=\s+(?:not|null|default|primary|references|unique|check|constraint|collate|generated|auto_increment|identity|comment)\b|\s*$|\s*,)/i.exec(
        rest,
      );
    const column: Column = {
      name: cleanName(m[1]),
      type: (typeMatch ? typeMatch[1] : rest.split(" ")[0] || "").trim(),
      pk: /\bprimary key\b/i.test(rest),
      fk: false,
    };
    const ref = new RegExp(`\\breferences\\s+(${QNAME})`, "i").exec(rest);
    if (ref) {
      column.fk = true;
      table.fks.push({ columns: [column.name], refTable: cleanName(ref[1]) });
    }
    table.columns.push(column);
  }
  for (const c of table.columns) {
    if (pkCols.includes(c.name)) {
      c.pk = true;
    }
  }
  for (const fk of table.fks) {
    for (const c of table.columns) {
      if (fk.columns.includes(c.name)) {
        c.fk = true;
      }
    }
  }
  return table;
};

/** index of the `)` that closes the `(` at `open` */
const closeParen = (s: string, open: number): number => {
  let depth = 0;
  let i = open;
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < s.length && s[j] !== c) {
        j++;
      }
      i = j + 1;
      continue;
    }
    if (c === "(") {
      depth++;
    } else if (c === ")") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
    i++;
  }
  return s.length;
};

export const parseSql = (text: string): Graph => {
  if (!text.trim()) {
    throw new Error("Paste SQL (CREATE TABLE statements) first.");
  }
  const src = stripSqlComments(text);
  const tables: Table[] = [];

  const create = new RegExp(
    `\\bcreate\\s+(?:or\\s+replace\\s+)?(?:(?:global\\s+|local\\s+)?(?:temp|temporary)\\s+|unlogged\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?(${QNAME})\\s*\\(`,
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = create.exec(src))) {
    const open = m.index + m[0].length - 1;
    const close = closeParen(src, open);
    tables.push(parseTable(cleanName(m[1]), src.slice(open + 1, close)));
    create.lastIndex = close + 1;
  }
  if (!tables.length) {
    throw new Error(
      "No CREATE TABLE statements found. Paste the DDL of your database (for example from pg_dump --schema-only).",
    );
  }

  // ALTER TABLE x ADD [CONSTRAINT n] FOREIGN KEY (a) REFERENCES y (b)
  const alter = new RegExp(
    `\\balter\\s+table\\s+(?:only\\s+)?(?:if\\s+exists\\s+)?(${QNAME})\\s+add\\s+(?:constraint\\s+${IDENT}\\s+)?foreign\\s+key\\s*\\(([^)]*)\\)\\s*references\\s+(${QNAME})`,
    "gi",
  );
  for (const a of src.matchAll(alter)) {
    const t = tables.find((x) => sameTable(x.name, cleanName(a[1])));
    if (t) {
      const columns = cols(a[2]);
      t.fks.push({ columns, refTable: cleanName(a[3]) });
      for (const c of t.columns) {
        if (columns.includes(c.name)) {
          c.fk = true;
        }
      }
    }
  }

  // ALTER TABLE x ADD PRIMARY KEY (a)
  const addPk = new RegExp(
    `\\balter\\s+table\\s+(?:only\\s+)?(?:if\\s+exists\\s+)?(${QNAME})\\s+add\\s+(?:constraint\\s+${IDENT}\\s+)?primary\\s+key\\s*\\(([^)]*)\\)`,
    "gi",
  );
  for (const a of src.matchAll(addPk)) {
    const t = tables.find((x) => sameTable(x.name, cleanName(a[1])));
    const keys = cols(a[2]);
    t?.columns.forEach((c) => {
      if (keys.includes(c.name)) {
        c.pk = true;
      }
    });
  }

  if (tables.length > MAX_NODES) {
    throw new Error(
      `That is a lot to draw (${tables.length} tables). Paste fewer tables, for example one schema.`,
    );
  }

  const id = (t: Table) => `tbl:${t.name.toLowerCase()}`;
  const nodes: GraphNode[] = tables.map((t) => ({
    id: id(t),
    role: "database",
    lines: [
      `🗄️ ${clip(t.name, 28)}`,
      ...t.columns
        .slice(0, MAX_COLUMNS)
        .map(
          (c) =>
            `${c.pk ? "🔑" : c.fk ? "🔗" : "·"} ${clip(c.name, 18)}${
              c.type ? `  ${clip(c.type, 14)}` : ""
            }`,
        ),
      ...(t.columns.length > MAX_COLUMNS
        ? [`… +${t.columns.length - MAX_COLUMNS} more`]
        : []),
    ],
  }));

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  let selfRefs = 0;
  let unknown = 0;
  for (const t of tables) {
    for (const fk of t.fks) {
      const target = tables.find((x) => sameTable(x.name, fk.refTable));
      if (!target) {
        unknown++;
        continue;
      }
      if (target === t) {
        selfRefs++;
        continue;
      }
      const eid = `fk:${id(t)}>${id(target)}:${fk.columns.join(",")}`;
      if (!seen.has(eid)) {
        seen.add(eid);
        edges.push({
          id: eid,
          from: id(t),
          to: id(target),
          kind: "depends",
          label: clip(fk.columns.join(", "), 22),
        });
      }
    }
  }

  const notes: string[] = [];
  if (selfRefs) {
    notes.push(
      `${selfRefs} self reference${selfRefs > 1 ? "s" : ""} not drawn`,
    );
  }
  if (unknown) {
    notes.push(
      `${unknown} foreign key${
        unknown > 1 ? "s" : ""
      } to tables that are not in the text`,
    );
  }
  const views = (
    src.match(/\bcreate\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\b/gi) ||
    []
  ).length;
  if (views) {
    notes.push(`Not drawn: ${views} view${views > 1 ? "s" : ""}`);
  }
  return { nodes, edges, ...(notes.length ? { notes } : {}) };
};

/** `public.users` and `users` are the same table when one of them has no schema */
const sameTable = (a: string, b: string): boolean => {
  const x = a.toLowerCase().split(".");
  const y = b.toLowerCase().split(".");
  if (x.length === y.length) {
    return x.join(".") === y.join(".");
  }
  return x[x.length - 1] === y[y.length - 1];
};
