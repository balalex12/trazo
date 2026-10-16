import { readFileSync } from "node:fs";

import { columnsFromOutput, parseNotebook, splitStatements } from "./notebook";

import type { Graph } from "./graph";

/* eslint-disable @typescript-eslint/no-explicit-any */

const code = (src: string, outputs: any[] = [], n?: number) => ({
  cell_type: "code",
  execution_count: n ?? null,
  metadata: {},
  outputs,
  source: src.split("\n").map((l, i, a) => (i < a.length - 1 ? `${l}\n` : l)),
});
const md = (src: string) => ({
  cell_type: "markdown",
  metadata: {},
  source: [src],
});
const book = (cells: any[], lang = "python") =>
  JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { language_info: { name: lang } },
    cells,
  });

const node = (g: Graph, startsWith: string) => {
  // a name is found exactly ("🔢 y" is not "🔢 y_train"); a file or a part of a title by what it contains
  const exact = g.nodes.filter((n) => n.lines[0] === startsWith);
  const found = exact.length
    ? exact
    : g.nodes.filter((n) => n.lines[0].includes(startsWith));
  expect([startsWith, found.length]).toEqual([startsWith, 1]);
  return found[0];
};
const flows = (g: Graph, from: string, to: string, label?: string) =>
  g.edges.some(
    (e) =>
      e.from === node(g, from).id &&
      e.to === node(g, to).id &&
      (label === undefined || e.label === label),
  );

const CHURN = book([
  md("# Churn model"),
  code(
    "import pandas as pd\nfrom sklearn.model_selection import train_test_split\nfrom sklearn.ensemble import RandomForestClassifier\nimport matplotlib.pyplot as plt",
    [],
    1,
  ),
  md("## Load"),
  code(
    "customers = pd.read_csv('data/customers.csv', usecols=['id', 'plan', 'signup'])\norders = pd.read_parquet('s3://shop/orders.parquet')\ncustomers.head()",
    [
      {
        output_type: "execute_result",
        data: {
          "text/plain": "   id   plan  signup\n0   1  basic  2024-01-02",
          "text/html":
            "<table><thead><tr><th></th><th>id</th><th>plan</th><th>signup</th></tr></thead></table>",
        },
      },
    ],
    2,
  ),
  md("## Features"),
  code(
    "df = customers.merge(orders, on='id', how='left')\ndf = df.dropna()\ndf['total'] = df['price'] * df['qty']\nagg = df.groupby('plan').agg({'total': 'sum'})\nagg",
    [],
    3,
  ),
  code(
    "X = df[['total', 'qty']]\ny = df['churned']\nX_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)",
    [],
    4,
  ),
  md("## Model"),
  code(
    "model = RandomForestClassifier(n_estimators=100)\nmodel.fit(X_train, y_train)\npred = model.predict(X_test)\nplt.hist(pred)\nagg.to_csv('out/agg.csv')\nimport joblib\njoblib.dump(model, 'model.pkl')",
    [],
    5,
  ),
  code("def helper(x):\n    return x\n\nprint('done')", [], 6),
]);

describe("parseNotebook: a typical analysis", () => {
  const g = parseNotebook(CHURN);

  it("draws the files as sources and what is read from them", () => {
    expect(node(g, "customers.csv").lines[1]).toBe("read_csv · cell 2 · Load");
    expect(node(g, "orders.parquet")).toBeTruthy(); // a path inside a URL
    expect(flows(g, "customers.csv", "📊 customers")).toBe(true);
    expect(flows(g, "orders.parquet", "📊 orders")).toBe(true);
  });

  it("follows the data: merge, clean, aggregate", () => {
    expect(flows(g, "📊 customers", "📊 df", "merge")).toBe(true);
    expect(flows(g, "📊 orders", "📊 df", "merge")).toBe(true);
    expect(flows(g, "📊 df", "📊 agg")).toBe(true);
    expect(node(g, "📊 df").lines[2]).toBe("↳ merge, dropna");
    expect(node(g, "📊 agg").lines[2]).toBe("↳ groupby, agg");
  });

  it("reads the structure of each table", () => {
    // from usecols and from the output of customers.head()
    expect(node(g, "📊 customers").lines.slice(2)).toEqual([
      "· id",
      "· plan",
      "· signup",
    ]);
    // the merge unions the columns, df["total"] adds one
    const df = node(g, "📊 df").lines.join("|");
    expect(df).toContain("· id");
    expect(df).toContain("· total");
    // an aggregation keeps only the group key and what it aggregates
    expect(node(g, "📊 agg").lines.slice(3)).toEqual(["· plan", "· total"]);
    // a column selection
    expect(node(g, "📊 X").lines.slice(2)).toEqual(["· total", "· qty"]);
    // a single column is a Series
    expect(node(g, "🔢 y").lines[1]).toBe("Series · cell 4 · Features");
    expect(node(g, "🔢 y").lines.slice(2)).toEqual(["· churned"]);
  });

  it("sends each part of train_test_split to its own pair of outputs", () => {
    expect(flows(g, "📊 X", "🔢 X_train")).toBe(true);
    expect(flows(g, "📊 X", "🔢 X_test")).toBe(true);
    expect(flows(g, "🔢 y", "🔢 y_train")).toBe(true);
    expect(flows(g, "📊 X", "🔢 y_train")).toBe(false);
    expect(node(g, "🔢 X_train").lines.slice(2)).toContain("· total");
  });

  it("draws the model, what it is trained on and what it predicts", () => {
    expect(node(g, "🤖 model").lines[1]).toBe(
      "RandomForestClassifier · cell 5 · Model",
    );
    expect(flows(g, "🔢 X_train", "🤖 model", "fit")).toBe(true);
    expect(flows(g, "🔢 y_train", "🤖 model", "fit")).toBe(true);
    expect(node(g, "🤖 model").lines).toContain("fit on X_train, y_train");
    expect(flows(g, "🤖 model", "🔢 pred", "predict")).toBe(true);
    expect(flows(g, "🔢 X_test", "🔢 pred")).toBe(true);
  });

  it("draws what is written out and plotted", () => {
    expect(flows(g, "📊 agg", "💾 agg.csv")).toBe(true);
    expect(flows(g, "🤖 model", "💾 model.pkl")).toBe(true);
    expect(flows(g, "🔢 pred", "📈 chart (cell 5)")).toBe(true);
  });

  it("labels the cell and the section it comes from, and counts what it skipped", () => {
    expect(node(g, "📊 df").lines[1]).toBe("DataFrame · cell 3 · Features");
    expect(g.notes?.[0]).toMatch(/2 code cells had no data steps/);
    expect(g.flow).toBe(true);
  });
});

describe("parseNotebook: other shapes of code", () => {
  const one = (src: string, outputs: any[] = []) =>
    parseNotebook(book([code(src, outputs)]));

  it("gives a name that is read again a new box instead of mixing the two", () => {
    const g = one(
      "df = pd.read_csv('a.csv')\ndf = df.dropna()\ndf = pd.read_csv('b.csv')\nout = df.copy()",
    );
    expect(g.nodes.filter((n) => n.lines[0].startsWith("📊"))).toHaveLength(3);
    expect(node(g, "📊 df (2)")).toBeTruthy();
    expect(flows(g, "b.csv", "📊 df (2)")).toBe(true);
    expect(flows(g, "📊 df (2)", "📊 out")).toBe(true);
  });

  it("reads multi-line calls, strings with = and #, comments and magics", () => {
    const g = one(
      "%matplotlib inline\n!pip install x\n# a comment = not code\nraw = pd.read_csv(\n    'data/a=b#c.csv',\n    sep=';',\n)\nclean = raw.query('a == 1 # x')\n",
    );
    expect(node(g, "a=b#c.csv")).toBeTruthy();
    expect(flows(g, "📊 raw", "📊 clean")).toBe(true);
  });

  it("knows GeoPandas and rasters", () => {
    const g = one(
      "parcels = gpd.read_file('parcels.gpkg')\nzones = gpd.read_file('zones.geojson')\njoined = gpd.sjoin(parcels, zones)\nm = joined.to_crs(3857).buffer(10)\nr = rasterio.open('dem.tif')\njoined.to_file('out.gpkg')",
    );
    expect(node(g, "📊 parcels").lines[1]).toBe("GeoDataFrame · cell 1");
    expect(node(g, "📊 joined").lines[2]).toBe("↳ sjoin");
    expect(flows(g, "📊 parcels", "📊 joined", "sjoin")).toBe(true);
    expect(node(g, "dem.tif")).toBeTruthy();
    expect(flows(g, "📊 joined", "💾 out.gpkg")).toBe(true);
  });

  it("reads from the web and from Spark", () => {
    const g = one(
      "resp = requests.get('https://api.example.com/v1/items')\nsdf = spark.read.parquet('/lake/events')\nitems = pd.DataFrame(resp.json())",
    );
    expect(node(g, "📥 items").lines[1]).toBe("web request · cell 1");
    expect(node(g, "📊 items")).toBeTruthy();
    expect(node(g, "events")).toBeTruthy();
  });

  it("ignores what is inside a function and plain constants", () => {
    const g = one(
      "N = 10\nname = 'x'\ndef load():\n    inner = pd.read_csv('inner.csv')\n    return inner\ndf = pd.read_csv('a.csv')",
    );
    expect(g.nodes.filter((n) => n.lines[0].includes("inner"))).toHaveLength(0);
    expect(g.nodes.filter((n) => n.lines[0].includes("📥"))).toHaveLength(1);
  });

  it("takes the types from df.info()", () => {
    const info =
      "<class 'pandas.core.frame.DataFrame'>\n #   Column  Non-Null Count  Dtype  \n---  ------  --------------  -----  \n 0   id      100 non-null    int64  \n 1   name    98 non-null     object \n";
    const g = one("df = pd.read_csv('a.csv')\ndf.info()", [
      { output_type: "stream", name: "stdout", text: [info] },
    ]);
    expect(node(g, "📊 df").lines.slice(2)).toEqual([
      "· id  int64",
      "· name  object",
    ]);
  });

  it("takes columns from a DataFrame built in code, assign() and column selections", () => {
    const g = one(
      "a = pd.DataFrame({'x': [1], 'y': [2]})\nb = a.assign(z=lambda d: d.x * 2, w=3)\nc = b[['x', 'z']]",
    );
    expect(node(g, "📊 a").lines.slice(2)).toEqual(["· x", "· y"]);
    expect(node(g, "📊 b").lines.slice(3)).toEqual([
      "· x",
      "· y",
      "· z",
      "· w",
    ]);
    expect(node(g, "📊 c").lines.slice(2)).toEqual(["· x", "· z"]);
  });

  it("shows only the first columns of a wide table", () => {
    const cols = Array.from({ length: 12 }, (_, i) => `c${i}`);
    const g = one(
      `df = pd.read_csv('a.csv', usecols=[${cols
        .map((c) => `'${c}'`)
        .join(", ")}])`,
    );
    const lines = node(g, "📊 df").lines;
    expect(lines.slice(2, 9)).toEqual(cols.slice(0, 7).map((c) => `· ${c}`));
    expect(lines[9]).toBe("… +5 more columns");
  });
});

describe("parseNotebook: what it refuses", () => {
  it("explains each problem", () => {
    expect(() => parseNotebook("{nope")).toThrow(/not valid JSON/);
    expect(() => parseNotebook('{"a": 1}')).toThrow(
      /does not look like a Jupyter notebook/,
    );
    expect(() => parseNotebook(book([code("x = 1")], "julia"))).toThrow(
      /Only Python notebooks.*julia/,
    );
    expect(() =>
      parseNotebook(book([code("import os\nx = 1\nprint(x)")])),
    ).toThrow(/No data steps found/);
    expect(() => parseNotebook(book([md("# only text")]))).toThrow(
      /No data steps found/,
    );
  });

  it("stops at a sane size", () => {
    const cells = Array.from({ length: 200 }, (_, i) =>
      code(`d${i} = pd.read_csv('f${i}.csv')`),
    );
    expect(() => parseNotebook(book(cells))).toThrow(/too many steps/);
  });

  it("copes with odd input without throwing anything else", () => {
    const ugly = [
      "x = (",
      "df = pd.read_csv('a.csv'",
      "'''unterminated",
      "a = b = c = pd.read_csv('z.csv')",
      "df[ = 1",
      "= 5",
      "for i in range(3): d = pd.read_csv(f'{i}.csv')",
    ];
    for (let i = 1; i <= ugly.length; i++) {
      try {
        parseNotebook(book([code(ugly.slice(0, i).join("\n"))]));
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
      }
    }
  });
});

describe("helpers", () => {
  it("splits statements at line ends and semicolons, keeping brackets and strings whole", () => {
    expect(
      splitStatements(
        "a = 1; b = f(\n  2,\n  3)\nc = 'x;y'  # note\n\nd = 4",
      ).map((s) => s.text),
    ).toEqual(["a = 1", "b = f(\n  2,\n  3)", "c = 'x;y'", "d = 4"]);
    expect(
      splitStatements("if x:\n    y = 1").map((s) => [s.text, s.indent]),
    ).toEqual([
      ["if x:", 0],
      ["y = 1", 4],
    ]);
  });

  it("reads columns from HTML, info, Index and text outputs", () => {
    expect(
      columnsFromOutput(
        "",
        "<thead><tr><th></th><th>a</th><th>b</th></tr></thead>",
      ),
    ).toEqual([
      ["a", ""],
      ["b", ""],
    ]);
    expect(columnsFromOutput("Index(['a', 'b'], dtype='object')")).toEqual([
      ["a", ""],
      ["b", ""],
    ]);
    expect(columnsFromOutput("   id  name\n0   1  Ann\n1   2  Bo")).toEqual([
      ["id", ""],
      ["name", ""],
    ]);
    expect(columnsFromOutput("just some text")).toEqual([]);
  });
});

describe("parseNotebook: what each box stands for", () => {
  it("keeps the code cell and the variable of a box, for the live view", () => {
    const g = parseNotebook(
      book([
        code("import pandas as pd\ndf = pd.read_csv('a.csv')", [], 7),
        md("# Next"),
        code("out = df.dropna()\nout.to_csv('b.csv')", [], 9),
      ]),
    );
    // the position among the code cells, not the execution count shown as [n]
    expect(g.nodes.find((n) => n.lines[0] === "📊 df")?.meta).toEqual({
      cell: 1,
      kind: "frame",
      var: "df",
    });
    expect(g.nodes.find((n) => n.lines[0] === "📊 out")?.meta).toEqual({
      cell: 2,
      kind: "frame",
      var: "out",
    });
    // a file has no variable
    expect(g.nodes.find((n) => n.lines[0].includes("a.csv"))?.meta).toEqual({
      cell: 1,
      kind: "source",
    });
  });
});

describe("the starter notebooks of the Python-in-the-browser site", () => {
  const read = (name: string) =>
    readFileSync(`tools/lite-content/${name}`, "utf8");

  it("welcome.ipynb: a table, an aggregation and a chart", () => {
    const g = parseNotebook(read("welcome.ipynb"));
    expect(flows(g, "📊 sales", "📊 by_region")).toBe(true);
    expect(node(g, "📊 by_region").lines.slice(3)).toEqual([
      "· region",
      "· total",
    ]);
    expect(g.nodes.some((n) => n.lines[0].startsWith("📈"))).toBe(true);
  });

  it("churn.ipynb: from tables to a fitted model", () => {
    const g = parseNotebook(read("churn.ipynb"));
    expect(flows(g, "📊 customers", "📊 df")).toBe(true);
    expect(flows(g, "📊 df", "📊 X")).toBe(true);
    expect(node(g, "🤖 model")).toBeTruthy();
    expect(node(g, "🔢 pred")).toBeTruthy();
  });
});
