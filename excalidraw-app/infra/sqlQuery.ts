// SQL statements that read or change data (SELECT, WITH, INSERT, UPDATE, DELETE, MERGE, CREATE VIEW / TABLE AS) to a
// flow graph that shows how the query works, in the order the database runs it: where the rows come from, how they
// are joined, filtered, grouped, projected, sorted and limited. Subqueries and CTEs get their own small pipelines that
// feed the step that uses them. A small scanner written for this (no SQL library); it reads the common shape of
// PostgreSQL, MySQL, SQLite, SQL Server and Oracle queries and says what it skipped. Deterministic and offline.
import { MAX_NODES, clip } from "./graph";
import { cleanName, closeParen, splitTop, stripSqlComments } from "./sql";

import type { Graph, GraphEdge, GraphNode, Role } from "./graph";

/** statements drawn from one script; more than this is unreadable */
const MAX_STATEMENTS = 12;
const MAX_DEPTH = 8;
const MAX_COLS = 8;

const IDENT = `(?:"[^"]+"|\`[^\`]+\`|\\[[^\\]]+\\]|[\\w$]+)`;
const QNAME = `${IDENT}(?:\\s*\\.\\s*${IDENT})*`;

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** the text with everything inside quotes and parentheses blanked out, so keywords are found at the top level only */
const maskTop = (s: string): string => {
  let out = "";
  let depth = 0;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < s.length && s[j] !== c) {
        j++;
      }
      const end = Math.min(j + 1, s.length);
      out += " ".repeat(end - i);
      i = end;
      continue;
    }
    if (c === "(") {
      depth++;
      out += " ";
    } else if (c === ")") {
      depth = Math.max(0, depth - 1);
      out += " ";
    } else {
      out += depth > 0 ? " " : c;
    }
    i++;
  }
  return out;
};

/** `(select ...)` -> `select ...` when the whole text is one pair of parentheses */
const unwrap = (s: string): string => {
  let t = s.trim();
  while (t.startsWith("(") && closeParen(t, 0) === t.length - 1) {
    t = t.slice(1, -1).trim();
  }
  return t;
};

/** statements split at `;` outside quotes and parentheses */
const statements = (src: string) => splitTop(src, ";");

type Ctx = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  ctes: Map<string, string>;
  depth: number;
  seq: { n: number };
};

const add = (
  ctx: Ctx,
  role: Role,
  lines: string[],
  extra: Partial<GraphNode> = {},
): string => {
  if (ctx.nodes.length >= MAX_NODES) {
    throw new Error(
      `That query is too big to draw (over ${MAX_NODES} boxes). Paste a part of it.`,
    );
  }
  const id = `q${++ctx.seq.n}`;
  ctx.nodes.push({ id, role, lines, ...extra });
  return id;
};
const link = (ctx: Ctx, from: string, to: string, label?: string) => {
  ctx.edges.push({
    id: `e${ctx.edges.length}:${from}>${to}`,
    from,
    to,
    kind: "depends",
    ...(label ? { label } : {}),
  });
};
/** a new box fed by `from` (a step of a pipeline) */
const step = (
  ctx: Ctx,
  from: string,
  role: Role,
  lines: string[],
  label?: string,
) => {
  const id = add(ctx, role, lines);
  link(ctx, from, id, label);
  return id;
};

/** the `(select ...)` parts of an expression, with the word in front (EXISTS, IN, ANY, or a plain value) */
const subqueriesOf = (expr: string): { kind: string; sql: string }[] => {
  const found: { kind: string; sql: string }[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (c === "'" || c === '"' || c === "`") {
      let j = i + 1;
      while (j < expr.length && expr[j] !== c) {
        j++;
      }
      i = j + 1;
      continue;
    }
    if (c === "(" && /^\(\s*(select|with)\b/i.test(expr.slice(i, i + 20))) {
      const close = closeParen(expr, i);
      const before = /([A-Za-z_]+)\s*$/.exec(expr.slice(0, i));
      const word = before ? before[1].toLowerCase() : "";
      found.push({
        kind: ["exists", "in", "any", "all", "some"].includes(word)
          ? word.toUpperCase()
          : "value",
        sql: expr.slice(i + 1, close),
      });
      i = close + 1;
      continue;
    }
    i++;
  }
  return found;
};

/** draws the subqueries of `expr` and feeds each one into `target` */
const attachSubqueries = (ctx: Ctx, expr: string, target: string) => {
  for (const sq of subqueriesOf(expr)) {
    const res = buildQuery(sq.sql, ctx);
    link(ctx, res, target, sq.kind);
  }
};

const CLAUSES =
  /\b(select|from|where|group\s+by|having|qualify|window|order\s+by|limit|offset|fetch|for\s+(?:update|share)|returning)\b/gi;

/** the text of each top-level clause of one SELECT (first occurrence wins) */
const splitClauses = (s: string): Map<string, string> => {
  const m = maskTop(s);
  const hits: { kw: string; at: number; end: number }[] = [];
  for (const h of m.matchAll(CLAUSES)) {
    const kw = h[1].toLowerCase().replace(/\s+/g, " ");
    // IS DISTINCT FROM is not a FROM clause
    if (kw === "from" && /\bdistinct\s*$/i.test(m.slice(0, h.index))) {
      continue;
    }
    hits.push({ kw, at: h.index!, end: h.index! + h[0].length });
  }
  const out = new Map<string, string>();
  hits.forEach((h, i) => {
    if (!out.has(h.kw)) {
      out.set(h.kw, s.slice(h.end, hits[i + 1] ? hits[i + 1].at : s.length));
    }
  });
  return out;
};

const AGG =
  /\b(count|sum|avg|min|max|array_agg|string_agg|listagg|group_concat|json_agg|jsonb_agg|bool_and|bool_or|stddev\w*|var_\w+|variance|median|percentile_\w+)\s*\(/i;
const WINDOW_FN = /\bover\s*(\(|\w)/i;
const NOT_ALIAS = new Set([
  "end",
  "null",
  "true",
  "false",
  "then",
  "else",
  "desc",
  "asc",
  "and",
  "or",
  "not",
  "is",
  "in",
  "like",
  "between",
  "distinct",
  "over",
]);

type Column = { text: string; alias?: string };
const readColumns = (list: string): Column[] =>
  splitTop(list, ",").map((raw) => {
    const t = squash(raw);
    const as = new RegExp(`^(.*\\S)\\s+as\\s+(${IDENT})$`, "i").exec(t);
    if (as) {
      return { text: as[1], alias: cleanName(as[2]) };
    }
    const bare = new RegExp(`^(.*[\\w)"\`\\]])\\s+(${IDENT})$`).exec(t);
    if (bare && !NOT_ALIAS.has(bare[2].toLowerCase())) {
      return { text: bare[1], alias: cleanName(bare[2]) };
    }
    return { text: t };
  });

const JOIN =
  /\b((?:natural\s+)?(?:(?:inner|left|right|full)(?:\s+outer)?\s+|cross\s+)?join|(?:cross|outer)\s+apply)\b/gi;

/** one item of a FROM clause: a table, a CTE, a subquery or a function; returns the box the rows come from */
const buildSource = (raw: string, ctx: Ctx): string => {
  const t = raw.trim().replace(/^lateral\s+/i, "");
  if (t.startsWith("(")) {
    const close = closeParen(t, 0);
    const inner = t.slice(1, close).trim();
    const alias = new RegExp(`^\\s*(?:as\\s+)?(${IDENT})`, "i").exec(
      t.slice(close + 1),
    );
    if (/^(select|with|values)\b/i.test(inner)) {
      const res = buildQuery(inner, ctx);
      return step(ctx, res, "storage", [
        `⤷ subquery${alias ? ` ${cleanName(alias[1])}` : ""}`,
      ]);
    }
    return buildFrom(inner, ctx); // a parenthesized group of joins
  }
  const fn = new RegExp(`^(${QNAME})\\s*\\(`).exec(t);
  if (fn) {
    return add(ctx, "function", [`ƒ ${clip(squash(t), 34)}`]);
  }
  const m = new RegExp(`^(${QNAME})(?:\\s+(?:as\\s+)?(${IDENT}))?`, "i").exec(
    t,
  );
  if (!m) {
    return add(ctx, "database", [`🗄️ ${clip(squash(t), 30)}`]);
  }
  const name = cleanName(m[1]);
  const alias = m[2] ? cleanName(m[2]) : "";
  const cte = ctx.ctes.get(name.toLowerCase());
  if (cte) {
    return cte;
  }
  const short = name.split(".").pop() || name;
  return add(ctx, "database", [
    `🗄️ ${clip(name, 28)}`,
    ...(alias && alias.toLowerCase() !== short.toLowerCase()
      ? [`as ${clip(alias, 24)}`]
      : []),
  ]);
};

/** the FROM clause: its sources and the join steps between them; returns the box that holds the joined rows */
const buildFrom = (from: string, ctx: Ctx): string => {
  const m = maskTop(from);
  const pieces: { type: string; text: string }[] = [];
  let last = 0;
  let type = "";
  for (const h of m.matchAll(JOIN)) {
    pieces.push({ type, text: from.slice(last, h.index) });
    type = squash(h[1]).toUpperCase();
    last = h.index! + h[0].length;
  }
  pieces.push({ type, text: from.slice(last) });

  const first = splitTop(pieces[0].text, ",");
  let acc = buildSource(first[0], ctx);
  for (const more of first.slice(1)) {
    const right = buildSource(more, ctx);
    const j = add(ctx, "network", ["⋈ CROSS JOIN", "(comma in FROM)"]);
    link(ctx, acc, j);
    link(ctx, right, j);
    acc = j;
  }
  for (const piece of pieces.slice(1)) {
    const pm = maskTop(piece.text);
    const on = /\b(on|using)\b/i.exec(pm);
    const itemText = on ? piece.text.slice(0, on.index) : piece.text;
    const cond = on
      ? squash(piece.text.slice(on.index + on[0].length)).replace(
          /^\(\s*|\s*\)$/g,
          "",
        )
      : "";
    const right = buildSource(itemText, ctx);
    const label = /JOIN$/.test(piece.type)
      ? piece.type.replace(/^JOIN$/, "INNER JOIN")
      : piece.type;
    const j = add(ctx, "network", [
      `⋈ ${label}`,
      ...(cond ? [`${on![1].toUpperCase()} ${clip(cond, 56)}`] : []),
    ]);
    link(ctx, acc, j);
    link(ctx, right, j);
    attachSubqueries(ctx, cond, j);
    acc = j;
  }
  return acc;
};

/** ORDER BY / LIMIT / OFFSET / FETCH as steps after `acc` */
const buildTail = (clauses: Map<string, string>, acc: string, ctx: Ctx) => {
  let cur = acc;
  const order = clauses.get("order by");
  if (order !== undefined) {
    cur = step(ctx, cur, "queue", ["↕ ORDER BY", clip(squash(order), 56)]);
  }
  const limit = clauses.get("limit");
  const offset = clauses.get("offset");
  const fetch = clauses.get("fetch");
  if (limit !== undefined || offset !== undefined || fetch !== undefined) {
    const parts = [
      limit !== undefined ? `LIMIT ${squash(limit)}` : "",
      offset !== undefined ? `OFFSET ${squash(offset)}` : "",
      fetch !== undefined ? `FETCH ${squash(fetch)}` : "",
    ].filter(Boolean);
    cur = step(ctx, cur, "queue", [`✂ ${clip(parts.join(" "), 56)}`]);
  }
  return cur;
};

/** one SELECT (no set operators, no WITH): returns its last step */
const buildSelect = (sql: string, ctx: Ctx): string => {
  const text = unwrap(sql);
  if (/^values\b/i.test(text)) {
    const rows = splitTop(text.replace(/^values\s*/i, ""), ",").length;
    return add(ctx, "schema", [
      "VALUES",
      `${rows} row${rows === 1 ? "" : "s"}`,
    ]);
  }
  const clauses = splitClauses(text);
  const selectRaw = clauses.get("select") ?? "";
  const head =
    /^\s*(distinct\s+on\s*\([^)]*\)\s*|distinct\s+|all\s+)?(top\s+\(?\d+\)?(?:\s+percent)?\s+)?/i.exec(
      selectRaw,
    )!;
  const distinct = /distinct/i.test(head[1] || "");
  const top = head[2] ? squash(head[2]).toUpperCase() : "";
  const columns = readColumns(selectRaw.slice(head[0].length));

  // 1. where the rows come from
  const fromText = clauses.get("from");
  let acc = fromText?.trim()
    ? buildFrom(fromText, ctx)
    : add(ctx, "schema", ["no table", "(a value computed from nothing)"]);

  // 2. WHERE
  const where = clauses.get("where");
  if (where !== undefined) {
    acc = step(ctx, acc, "function", ["🔎 WHERE", clip(squash(where), 60)]);
    attachSubqueries(ctx, where, acc);
  }

  // 3. GROUP BY / aggregates, HAVING
  const group = clauses.get("group by");
  const aggregates = columns.filter((c) => AGG.test(c.text));
  if (group !== undefined || aggregates.length) {
    acc = step(ctx, acc, "cache", [
      group !== undefined ? "Σ GROUP BY" : "Σ AGGREGATE",
      ...(group !== undefined ? [clip(squash(group), 56)] : []),
      ...aggregates.slice(0, 3).map((c) => `→ ${clip(c.alias ?? c.text, 44)}`),
    ]);
  }
  const having = clauses.get("having");
  if (having !== undefined) {
    acc = step(ctx, acc, "function", ["🔎 HAVING", clip(squash(having), 60)]);
    attachSubqueries(ctx, having, acc);
  }

  // 4. SELECT (with window functions)
  const shown = columns
    .slice(0, MAX_COLS)
    .map((c) =>
      c.alias && c.alias !== c.text
        ? `${clip(c.alias, 18)} ← ${clip(c.text, 30)}`
        : clip(c.text, 46),
    );
  const windows = columns.filter((c) => WINDOW_FN.test(c.text)).length;
  const sel = step(ctx, acc, "app", [
    `SELECT${distinct ? " DISTINCT" : ""}${top ? ` ${top}` : ""}`,
    ...shown,
    ...(columns.length > MAX_COLS
      ? [`… +${columns.length - MAX_COLS} more`]
      : []),
    ...(windows
      ? [`(${windows} window function${windows > 1 ? "s" : ""})`]
      : []),
  ]);
  acc = sel;
  attachSubqueries(ctx, selectRaw, sel);

  const qualify = clauses.get("qualify");
  if (qualify !== undefined) {
    acc = step(ctx, acc, "function", ["🔎 QUALIFY", clip(squash(qualify), 60)]);
  }
  return buildTail(clauses, acc, ctx);
};

/** `a UNION b ORDER BY ...`: each side, a set operation step, then the sorting of the combined result */
const buildSetOps = (sql: string, ctx: Ctx): string => {
  const s = sql.trim();
  const m = maskTop(s);
  const ops = [
    ...m.matchAll(
      /\b(union(?:\s+all|\s+distinct)?|intersect(?:\s+all)?|except(?:\s+all)?|minus)\b/gi,
    ),
  ];
  if (!ops.length) {
    return buildSelect(s, ctx);
  }
  const parts: string[] = [];
  let last = 0;
  for (const o of ops) {
    parts.push(s.slice(last, o.index));
    last = o.index! + o[0].length;
  }
  parts.push(s.slice(last));
  // ORDER BY / LIMIT after the last part belong to the combined result
  const tailAt = /\b(order\s+by|limit|offset|fetch)\b/i.exec(
    maskTop(parts[parts.length - 1]),
  );
  let tail = new Map<string, string>();
  if (tailAt) {
    tail = splitClauses(parts[parts.length - 1].slice(tailAt.index));
    parts[parts.length - 1] = parts[parts.length - 1].slice(0, tailAt.index);
  }
  const ends = parts.map((p) => buildQuery(p, ctx));
  let acc = ends[0];
  ops.forEach((o, i) => {
    const name = squash(o[1]).toUpperCase();
    const sym = name.startsWith("UNION")
      ? "∪"
      : name.startsWith("INTERSECT")
      ? "∩"
      : "−";
    const node = add(ctx, "network", [`${sym} ${name}`]);
    link(ctx, acc, node);
    link(ctx, ends[i + 1], node);
    acc = node;
  });
  return buildTail(tail, acc, ctx);
};

/** a query that may start with WITH; returns the box that holds its result */
function buildQuery(sql: string, parent: Ctx): string {
  if (parent.depth > MAX_DEPTH) {
    return add(parent, "schema", ["… nested too deep to draw"]);
  }
  const ctx: Ctx = {
    ...parent,
    ctes: new Map(parent.ctes),
    depth: parent.depth + 1,
  };
  let s = unwrap(sql);
  const w = /^with\s+(recursive\s+)?/i.exec(s);
  if (w) {
    s = s.slice(w[0].length);
    for (;;) {
      const head = new RegExp(
        `^(${IDENT})\\s*(\\([^)]*\\))?\\s*as\\s+(?:not\\s+)?(?:materialized\\s+)?\\(`,
        "i",
      ).exec(s);
      if (!head) {
        break;
      }
      const open = head[0].length - 1;
      const close = closeParen(s, open);
      const name = cleanName(head[1]);
      const body = buildQuery(s.slice(open + 1, close), ctx);
      const cte = step(ctx, body, "storage", [`📦 WITH ${clip(name, 28)}`]);
      ctx.ctes.set(name.toLowerCase(), cte);
      s = s.slice(close + 1).trim();
      if (s.startsWith(",")) {
        s = s.slice(1).trim();
        continue;
      }
      break;
    }
  }
  return buildSetOps(s, ctx);
}

/** the box a statement writes to, fed by the step that changes it */
const writeTarget = (ctx: Ctx, from: string, name: string, note: string) =>
  step(ctx, from, "database", [`🗄️ ${clip(name, 28)}`, note]);

const buildStatement = (
  stmt: string,
  ctx: Ctx,
  index: number,
  total: number,
) => {
  const s = stmt
    .replace(/^\s*explain\s+(?:analyze\s+|verbose\s+)*/i, "")
    .trim();
  const label = total > 1 ? ` ${index + 1}` : "";

  // CREATE [OR REPLACE] [MATERIALIZED] VIEW v AS query / CREATE TABLE t AS query
  const create = new RegExp(
    `^create\\s+(?:or\\s+replace\\s+)?(?:(?:global\\s+|local\\s+)?(?:temp|temporary)\\s+|materialized\\s+|unlogged\\s+)?(view|table)\\s+(?:if\\s+not\\s+exists\\s+)?(${QNAME})[^]*?\\bas\\s+((?:\\(\\s*)?(?:select|with|values)\\b[^]*)$`,
    "i",
  ).exec(s);
  if (create) {
    const res = buildQuery(create[3], ctx);
    writeTarget(
      ctx,
      res,
      cleanName(create[2]),
      create[1].toLowerCase() === "view"
        ? "created as a view"
        : "created from the query",
    );
    return true;
  }

  const ins = new RegExp(
    `^(?:insert|replace)\\s+(?:or\\s+\\w+\\s+)?(?:into\\s+)?(${QNAME})\\s*(\\([^)]*\\))?\\s*([^]*)$`,
    "i",
  ).exec(s);
  if (ins) {
    const name = cleanName(ins[1]);
    let rest = ins[3].trim();
    let src: string;
    const conflict = /\b(on\s+conflict|on\s+duplicate\s+key)\b[^]*$/i.exec(
      rest,
    );
    const note = conflict ? squash(conflict[0]) : "";
    if (conflict) {
      rest = rest.slice(0, conflict.index);
    }
    rest = rest.replace(/\breturning\b[^]*$/i, "").trim();
    if (/^(select|with|\()/i.test(rest) && !/^values\b/i.test(rest)) {
      src = buildQuery(rest, ctx);
    } else {
      const rows = rest.toLowerCase().startsWith("default")
        ? 1
        : splitTop(rest.replace(/^values\s*/i, ""), ",").length;
      src = add(ctx, "schema", [
        "VALUES",
        `${rows} row${rows === 1 ? "" : "s"}`,
      ]);
    }
    const cols = ins[2] ? squash(ins[2]) : "";
    const node = step(ctx, src, "trigger", [
      "➕ INSERT",
      ...(cols ? [clip(cols, 50)] : []),
      ...(note ? [clip(note, 50)] : []),
    ]);
    writeTarget(ctx, node, name, "rows added");
    return true;
  }

  const upd = new RegExp(
    `^update\\s+(?:only\\s+)?(${QNAME})(?:\\s+(?:as\\s+)?(?!set\\b)(${IDENT}))?\\s+set\\s+([^]*)$`,
    "i",
  ).exec(s);
  if (upd) {
    const name = cleanName(upd[1]);
    const clauses = splitClauses(`select ${upd[3]}`);
    const set = clauses.get("select") ?? "";
    const base = add(ctx, "database", [
      `🗄️ ${clip(name, 28)}`,
      ...(upd[2] ? [`as ${cleanName(upd[2])}`] : []),
    ]);
    let acc = base;
    const fromText = clauses.get("from");
    if (fromText?.trim()) {
      const src = buildFrom(fromText, ctx);
      const j = add(ctx, "network", ["⋈ JOIN", "(UPDATE … FROM)"]);
      link(ctx, base, j);
      link(ctx, src, j);
      acc = j;
    }
    const where = clauses.get("where");
    if (where !== undefined) {
      acc = step(ctx, acc, "function", ["🔎 WHERE", clip(squash(where), 60)]);
      attachSubqueries(ctx, where, acc);
    }
    const node = step(ctx, acc, "trigger", [
      "✏️ UPDATE SET",
      ...splitTop(set, ",")
        .slice(0, 4)
        .map((a) => clip(squash(a), 50)),
    ]);
    attachSubqueries(ctx, set, node);
    writeTarget(ctx, node, name, "rows changed");
    return true;
  }

  const del = new RegExp(
    `^delete\\s+(?:from\\s+)?(?:only\\s+)?(${QNAME})(?:\\s+(?:as\\s+)?(?!using\\b|where\\b)(${IDENT}))?\\s*([^]*)$`,
    "i",
  ).exec(s);
  if (del) {
    const name = cleanName(del[1]);
    const clauses = splitClauses(
      `select 1 ${del[3].replace(/^using\b/i, "from")}`,
    );
    let acc = add(ctx, "database", [
      `🗄️ ${clip(name, 28)}`,
      ...(del[2] ? [`as ${cleanName(del[2])}`] : []),
    ]);
    const using = clauses.get("from");
    if (using?.trim()) {
      const src = buildFrom(using, ctx);
      const j = add(ctx, "network", ["⋈ JOIN", "(DELETE … USING)"]);
      link(ctx, acc, j);
      link(ctx, src, j);
      acc = j;
    }
    const where = clauses.get("where");
    if (where !== undefined) {
      acc = step(ctx, acc, "function", ["🔎 WHERE", clip(squash(where), 60)]);
      attachSubqueries(ctx, where, acc);
    }
    const node = step(ctx, acc, "trigger", ["🗑️ DELETE"]);
    writeTarget(ctx, node, name, "rows removed");
    return true;
  }

  const merge = new RegExp(
    `^merge\\s+into\\s+(${QNAME})(?:\\s+(?:as\\s+)?(?!using\\b)(${IDENT}))?\\s+using\\s+([^]*?)\\s+on\\s+([^]*?)\\s+(when\\b[^]*)$`,
    "i",
  ).exec(s);
  if (merge) {
    const name = cleanName(merge[1]);
    const target = add(ctx, "database", [
      `🗄️ ${clip(name, 28)}`,
      ...(merge[2] ? [`as ${cleanName(merge[2])}`] : []),
    ]);
    const src = buildSource(merge[3], ctx);
    const on = add(ctx, "network", ["⋈ MERGE ON", clip(squash(merge[4]), 56)]);
    link(ctx, target, on);
    link(ctx, src, on);
    const whens = merge[5]
      .split(/\bwhen\b/i)
      .map((w) => w.trim())
      .filter(Boolean);
    const out = add(ctx, "database", [`🗄️ ${clip(name, 28)}`, "rows merged"]);
    for (const w of whens.slice(0, 4)) {
      const action = step(ctx, on, "trigger", [
        `WHEN ${clip(squash(w).replace(/\s+then\s+/i, " THEN "), 56)}`,
      ]);
      link(ctx, action, out);
    }
    return true;
  }

  if (/^(select|with|values|table)\b|^\(/i.test(s)) {
    const res = buildQuery(
      /^table\s+/i.test(s) ? `select * from ${s.slice(5)}` : s,
      ctx,
    );
    step(ctx, res, "trigger", [`📤 Result${label}`]);
    return true;
  }
  return false;
};

/** true when the text looks like queries rather than a schema or something else */
export const looksLikeSqlQuery = (text: string): boolean => {
  const src = stripSqlComments(text).trim();
  if (
    !/^\s*(?:explain\s+)?(\(?\s*select\b|with\b|insert\b|update\b|delete\b|merge\b|replace\b|create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\b|create\s+(?:temp\w*\s+)?table\b[^;]*?\bas\s+\(?\s*(?:select|with)\b)/i.test(
      src,
    )
  ) {
    return false;
  }
  // a bare word like "with" or "update" in prose is not enough: queries have a shape
  return /\b(select|values)\b[^]*?\b(from|where|;)|\bselect\s+(?:distinct\s+)?(?:[\d*'"`(]|[\w.]+\s*(?:\(|,|;|$|\bas\b))|\binsert\b[^]*?\binto\b|\bupdate\b[^]*?\bset\b|\bdelete\b[^]*?\bfrom\b|\bmerge\b[^]*?\busing\b|\bwith\b[^]*?\bas\s*\(/i.test(
    src,
  );
};

export const parseSqlQuery = (text: string): Graph => {
  if (!text.trim()) {
    throw new Error(
      "Paste an SQL query (SELECT, WITH, INSERT, UPDATE…) first.",
    );
  }
  const all = statements(stripSqlComments(text));
  const ctx: Ctx = {
    nodes: [],
    edges: [],
    ctes: new Map(),
    depth: 0,
    seq: { n: 0 },
  };
  const chosen = all.slice(0, MAX_STATEMENTS);
  let drawn = 0;
  let skipped = 0;
  chosen.forEach((stmt, i) => {
    if (buildStatement(stmt, ctx, i, chosen.length)) {
      drawn++;
    } else {
      skipped++;
    }
  });
  if (!drawn) {
    throw new Error(
      "No SELECT, INSERT, UPDATE, DELETE, MERGE or CREATE VIEW found to draw. For CREATE TABLE statements paste the whole schema (it is drawn as an ER diagram).",
    );
  }
  const notes: string[] = [];
  if (skipped) {
    notes.push(
      `${skipped} statement${skipped > 1 ? "s" : ""} not drawn (not a query)`,
    );
  }
  if (all.length > MAX_STATEMENTS) {
    notes.push(`Only the first ${MAX_STATEMENTS} statements are drawn`);
  }
  return {
    nodes: ctx.nodes,
    edges: ctx.edges,
    flow: true,
    ...(notes.length ? { notes } : {}),
  };
};
