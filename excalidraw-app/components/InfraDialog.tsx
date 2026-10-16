import { useEffect, useMemo, useRef, useState } from "react";
import { useExcalidrawAPI } from "@excalidraw/excalidraw";

import { EVENTS } from "../branding";
import { FORMAT_NAMES, detectFormat, importInfra } from "../infra/detect";
import { drawLayout } from "../infra/place";

import type { InfraFormat } from "../infra/detect";

const EXAMPLES: Record<InfraFormat, string> = {
  compose: `services:
  proxy:
    image: nginx:alpine
    ports: ["80:80", "443:443"]
    depends_on: [web]
  web:
    build: ./web
    depends_on: [api]
  api:
    build: ./api
    depends_on: [db, cache, queue]
    volumes: [uploads:/data]
  worker:
    build: ./worker
    depends_on: [queue, db]
  db:
    image: postgres:16
    volumes: [pgdata:/var/lib/postgresql/data]
  cache:
    image: redis:7
  queue:
    image: rabbitmq:3
  grafana:
    image: grafana/grafana
    ports: ["3000:3000"]
    depends_on: [db]
volumes:
  pgdata:
  uploads:
`,
  kubernetes: `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: { name: shop }
spec:
  rules:
    - host: shop.example.com
      http:
        paths:
          - { path: /, backend: { service: { name: web, port: { number: 80 } } } }
          - { path: /api, backend: { service: { name: api, port: { number: 8080 } } } }
---
apiVersion: v1
kind: Service
metadata: { name: web }
spec: { selector: { app: web }, ports: [{ port: 80 }] }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: web }
spec:
  replicas: 2
  template:
    metadata: { labels: { app: web } }
    spec:
      containers:
        - { name: web, image: ghcr.io/acme/shop-web:2.1 }
---
apiVersion: v1
kind: Service
metadata: { name: api }
spec: { selector: { app: api }, ports: [{ port: 8080 }] }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: api }
spec:
  replicas: 3
  template:
    metadata: { labels: { app: api } }
    spec:
      containers:
        - name: api
          image: ghcr.io/acme/shop-api:2.1
          env:
            - { name: DB_HOST, value: postgres }
            - { name: CACHE_HOST, value: redis }
          envFrom:
            - configMapRef: { name: api-config }
            - secretRef: { name: api-secrets }
---
apiVersion: v1
kind: ConfigMap
metadata: { name: api-config }
data: { LOG_LEVEL: info }
---
apiVersion: v1
kind: Service
metadata: { name: postgres }
spec: { selector: { app: postgres }, ports: [{ port: 5432 }] }
---
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: postgres }
spec:
  replicas: 1
  template:
    metadata: { labels: { app: postgres } }
    spec:
      containers:
        - { name: db, image: postgres:16 }
  volumeClaimTemplates:
    - metadata: { name: data }
      spec: { resources: { requests: { storage: 20Gi } } }
---
apiVersion: v1
kind: Service
metadata: { name: redis }
spec: { selector: { app: redis }, ports: [{ port: 6379 }] }
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: redis }
spec:
  template:
    metadata: { labels: { app: redis } }
    spec:
      containers:
        - { name: redis, image: redis:7 }
`,
  terraform: `data "aws_ami" "ubuntu" {
  most_recent = true
}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "public" {
  vpc_id = aws_vpc.main.id
}

resource "aws_lb" "app" {
  subnets = [aws_subnet.public.id]
}

resource "aws_lb_target_group" "web" {
  vpc_id = aws_vpc.main.id
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.app.arn
  default_action {
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_target_group_attachment" "web" {
  target_group_arn = aws_lb_target_group.web.arn
  target_id        = aws_instance.web.id
}

resource "aws_instance" "web" {
  ami           = data.aws_ami.ubuntu.id
  instance_type = "t3.small"
  subnet_id     = aws_subnet.public.id
  user_data     = "DB=\${aws_db_instance.main.address} BUCKET=\${aws_s3_bucket.uploads.bucket}"
}

resource "aws_db_instance" "main" {
  engine = "postgres"
}

resource "aws_s3_bucket" "uploads" {
  bucket = "shop-uploads"
}

resource "aws_sqs_queue" "jobs" {
  name = "jobs"
}

resource "aws_lambda_function" "worker" {
  environment {
    variables = {
      QUEUE  = aws_sqs_queue.jobs.url
      BUCKET = aws_s3_bucket.uploads.bucket
    }
  }
}
`,
  openapi: `openapi: 3.0.3
info: { title: Pet Store, version: 1.0.0 }
servers: [{ url: https://api.example.com/v1 }]
paths:
  /pets:
    get:
      tags: [pets]
      responses:
        "200":
          content:
            application/json:
              schema: { type: array, items: { $ref: "#/components/schemas/Pet" } }
    post:
      tags: [pets]
      requestBody:
        content:
          application/json:
            schema: { $ref: "#/components/schemas/NewPet" }
  /pets/{id}:
    get: { tags: [pets] }
    delete: { tags: [pets] }
  /orders:
    get: { tags: [orders] }
    post:
      tags: [orders]
      requestBody:
        content:
          application/json:
            schema: { $ref: "#/components/schemas/Order" }
  /health:
    get: {}
components:
  securitySchemes:
    oauth: { type: oauth2 }
  schemas:
    Pet:
      properties:
        id: { type: integer }
        name: { type: string }
        owner: { $ref: "#/components/schemas/Owner" }
    NewPet:
      properties:
        name: { type: string }
    Owner:
      properties:
        name: { type: string }
        email: { type: string }
    Order:
      properties:
        petId: { type: integer }
        quantity: { type: integer }
`,
  sql: `CREATE TABLE customers (
  id serial PRIMARY KEY,
  email varchar(255) NOT NULL UNIQUE,
  full_name text
);

CREATE TABLE products (
  id serial PRIMARY KEY,
  name text NOT NULL,
  price numeric(10, 2)
);

CREATE TABLE orders (
  id serial PRIMARY KEY,
  customer_id int NOT NULL REFERENCES customers (id),
  placed_at timestamptz DEFAULT now()
);

CREATE TABLE order_items (
  order_id int REFERENCES orders (id),
  product_id int REFERENCES products (id),
  quantity int NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

CREATE TABLE payments (
  id serial PRIMARY KEY,
  order_id int NOT NULL,
  amount numeric(10, 2)
);
ALTER TABLE payments ADD CONSTRAINT fk_pay_order FOREIGN KEY (order_id) REFERENCES orders (id);
`,
  dbt: JSON.stringify(
    {
      metadata: { dbt_schema_version: "manifest", project_name: "shop" },
      nodes: {
        "model.shop.stg_orders": {
          resource_type: "model",
          name: "stg_orders",
          package_name: "shop",
          schema: "analytics",
          config: { materialized: "view" },
          depends_on: { nodes: ["source.shop.raw.orders"] },
        },
        "model.shop.stg_customers": {
          resource_type: "model",
          name: "stg_customers",
          package_name: "shop",
          schema: "analytics",
          config: { materialized: "view" },
          depends_on: { nodes: ["source.shop.raw.customers"] },
        },
        "model.shop.int_orders_enriched": {
          resource_type: "model",
          name: "int_orders_enriched",
          package_name: "shop",
          config: { materialized: "ephemeral" },
          depends_on: {
            nodes: ["model.shop.stg_orders", "seed.shop.countries"],
          },
        },
        "model.shop.fct_orders": {
          resource_type: "model",
          name: "fct_orders",
          package_name: "shop",
          schema: "marts",
          config: { materialized: "table" },
          depends_on: { nodes: ["model.shop.int_orders_enriched"] },
        },
        "model.shop.dim_customers": {
          resource_type: "model",
          name: "dim_customers",
          package_name: "shop",
          schema: "marts",
          config: { materialized: "table" },
          depends_on: { nodes: ["model.shop.stg_customers"] },
        },
        "seed.shop.countries": {
          resource_type: "seed",
          name: "countries",
          package_name: "shop",
          depends_on: { nodes: [] },
        },
      },
      sources: {
        "source.shop.raw.orders": {
          resource_type: "source",
          source_name: "raw",
          name: "orders",
          package_name: "shop",
        },
        "source.shop.raw.customers": {
          resource_type: "source",
          source_name: "raw",
          name: "customers",
          package_name: "shop",
        },
      },
      exposures: {
        "exposure.shop.sales": {
          resource_type: "exposure",
          name: "sales_dashboard",
          package_name: "shop",
          depends_on: {
            nodes: ["model.shop.fct_orders", "model.shop.dim_customers"],
          },
        },
      },
    },
    null,
    2,
  ),
  n8n: JSON.stringify(
    {
      name: "Lead intake",
      nodes: [
        { name: "Webhook", type: "n8n-nodes-base.webhook" },
        { name: "Valid?", type: "n8n-nodes-base.if" },
        { name: "Save lead", type: "n8n-nodes-base.postgres" },
        { name: "Tell sales", type: "n8n-nodes-base.slack" },
        { name: "Reject", type: "n8n-nodes-base.set" },
        { name: "Reply", type: "n8n-nodes-base.respondToWebhook" },
      ],
      connections: {
        Webhook: { main: [[{ node: "Valid?", type: "main", index: 0 }]] },
        "Valid?": {
          main: [
            [{ node: "Save lead", type: "main", index: 0 }],
            [{ node: "Reject", type: "main", index: 0 }],
          ],
        },
        "Save lead": {
          main: [
            [
              { node: "Tell sales", type: "main", index: 0 },
              { node: "Reply", type: "main", index: 0 },
            ],
          ],
        },
        Reject: { main: [[{ node: "Reply", type: "main", index: 0 }]] },
      },
    },
    null,
    2,
  ),
  notebook: JSON.stringify(
    {
      nbformat: 4,
      nbformat_minor: 5,
      metadata: { kernelspec: { language: "python", name: "python3" } },
      cells: [
        {
          cell_type: "code",
          source:
            "import pandas as pd\ncustomers = pd.read_csv('data/customers.csv', usecols=['id', 'plan', 'signup'])\norders = pd.read_csv('data/orders.csv')",
        },
        {
          cell_type: "code",
          source:
            "df = customers.merge(orders, on='id', how='left')\ndf = df.dropna()\ndf['total'] = df['price'] * df['qty']",
        },
        {
          cell_type: "code",
          source:
            "from sklearn.model_selection import train_test_split\nfrom sklearn.ensemble import RandomForestClassifier\nX = df[['total', 'qty']]\ny = df['plan']\nX_train, X_test, y_train, y_test = train_test_split(X, y)\nmodel = RandomForestClassifier()\nmodel.fit(X_train, y_train)\npred = model.predict(X_test)",
        },
        {
          cell_type: "code",
          source:
            "import joblib\njoblib.dump(model, 'model.pkl')\ndf.to_csv('out/clean.csv')",
        },
      ],
    },
    null,
    2,
  ),
  sqlquery: `-- Top customers by revenue this year, with their latest order
WITH paid AS (
  SELECT o.id, o.customer_id, o.placed_at, SUM(i.quantity * i.unit_price) AS total
  FROM orders o
  JOIN order_items i ON i.order_id = o.id
  WHERE o.status = 'paid' AND o.placed_at >= DATE '2025-01-01'
  GROUP BY o.id, o.customer_id, o.placed_at
),
ranked AS (
  SELECT customer_id,
         SUM(total) AS revenue,
         MAX(placed_at) AS last_order,
         RANK() OVER (ORDER BY SUM(total) DESC) AS position
  FROM paid
  GROUP BY customer_id
)
SELECT c.full_name, c.email, r.revenue, r.last_order, r.position
FROM ranked r
JOIN customers c ON c.id = r.customer_id
LEFT JOIN regions g ON g.id = c.region_id
WHERE r.revenue > (SELECT AVG(total) FROM paid)
  AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.customer_id = c.id AND s.active)
ORDER BY r.revenue DESC
LIMIT 20;

UPDATE customers
SET tier = 'gold'
FROM customer_stats s
WHERE customers.id = s.customer_id AND s.position <= 10;
`,
  json: `{
  "id": 4821,
  "status": "shipped",
  "placed_at": "2025-03-14T09:12:44Z",
  "customer": {
    "id": 77,
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "address": { "street": "12 Analytical St", "city": "London", "zip": "N1 9GU" }
  },
  "items": [
    { "sku": "KB-100", "name": "Keyboard", "quantity": 1, "price": 79.9, "tags": ["usb", "mechanical"] },
    { "sku": "MS-220", "name": "Mouse", "quantity": 2, "price": 24.5, "tags": ["wireless"] },
    { "sku": "HD-900", "name": "Headset", "quantity": 1, "price": 59, "warranty": { "months": 24 } }
  ],
  "payment": { "method": "card", "last4": "4242", "paid": true },
  "tracking": [3, 7, 11],
  "notes": null
}
`,
};

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "#0006",
  zIndex: 1100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const card: React.CSSProperties = {
  background: "var(--island-bg-color, #fff)",
  color: "var(--text-primary-color, #222)",
  borderRadius: 10,
  padding: 20,
  width: "min(660px, 94vw)",
  maxHeight: "90vh",
  overflow: "auto",
  font: "14px system-ui, sans-serif",
  boxShadow: "0 8px 30px #0005",
};
const area: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  height: 260,
  padding: 8,
  margin: "8px 0",
  font: "13px ui-monospace, Menlo, Consolas, monospace",
  background: "var(--input-bg-color, var(--island-bg-color))",
  color: "var(--text-primary-color)",
  border: "1px solid var(--default-border-color, #8888)",
  borderRadius: 4,
  resize: "vertical",
};
const btn: React.CSSProperties = {
  padding: "6px 12px",
  border: "1px solid var(--color-primary)",
  background: "var(--color-primary)",
  color: "var(--color-icon-white, #fff)",
  borderRadius: 6,
  cursor: "pointer",
};
const ghost: React.CSSProperties = {
  ...btn,
  background: "transparent",
  color: "var(--color-primary)",
};
const select: React.CSSProperties = {
  padding: "5px 8px",
  background: "var(--input-bg-color, var(--island-bg-color))",
  color: "var(--text-primary-color)",
  border: "1px solid var(--default-border-color, #8888)",
  borderRadius: 6,
};

export const InfraDialog = () => {
  const api = useExcalidrawAPI();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [details, setDetails] = useState(false);
  // what the pasted text looks like, updated a moment after you stop typing
  const [summary, setSummary] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const on = () => {
      setError("");
      setOpen(true);
    };
    window.addEventListener(EVENTS.openInfraImport, on);
    return () => window.removeEventListener(EVENTS.openInfraImport, on);
  }, []);

  const format = useMemo(() => detectFormat(text), [text]);

  useEffect(() => {
    if (!text.trim()) {
      setSummary("");
      return;
    }
    const t = setTimeout(() => {
      try {
        const { format: f, layout } = importInfra(text, { details });
        const drawn = layout.nodes.length;
        const boxes = `${drawn} box${drawn === 1 ? "" : "es"}`;
        const notes = layout.notes?.length
          ? `. ${layout.notes.join(". ")}`
          : "";
        setSummary(`Detected ${FORMAT_NAMES[f]}: ${boxes}${notes}`);
      } catch (e) {
        setSummary((e as Error).message);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [text, details]);

  if (!open) {
    return null;
  }

  const generate = () => {
    try {
      if (!api) {
        throw new Error("The editor is not ready yet.");
      }
      const { layout } = importInfra(text, { details });
      drawLayout(api, layout);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div style={overlay} onClick={() => setOpen(false)}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 6px" }}>Import to diagram</h3>
        <div style={{ color: "#888", marginBottom: 6 }}>
          Paste a <code>docker-compose.yml</code>, Kubernetes manifests,
          Terraform (<code>.tf</code> or JSON), an OpenAPI file, SQL{" "}
          <code>CREATE TABLE</code> statements or SQL queries (to see how they
          run), a dbt <code>manifest.json</code>, an n8n workflow, a Jupyter
          notebook (<code>.ipynb</code>, to see where the data goes) or any
          other JSON, or choose the files. Trazo works out which it is and draws
          it. It is read in your browser and nothing is sent anywhere. No AI
          involved.
        </div>
        <textarea
          style={area}
          value={text}
          spellCheck={false}
          placeholder="Paste here…"
          onChange={(e) => {
            setText(e.target.value);
            setError("");
          }}
        />
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".yml,.yaml,.tf,.json,.sql,.ddl,text/yaml,text/plain"
          style={{ display: "none" }}
          onChange={async (e) => {
            const files = [...(e.target.files || [])];
            if (files.length) {
              // several files become one text (YAML documents and HCL blocks both read fine this way)
              const texts = await Promise.all(files.map((f) => f.text()));
              setText(texts.join("\n---\n"));
              setError("");
            }
            e.target.value = "";
          }}
        />
        {summary && !error && (
          <div style={{ color: "#888", marginBottom: 8 }}>{summary}</div>
        )}
        {error && (
          <div
            style={{ color: "var(--color-danger, #c62828)", marginBottom: 8 }}
          >
            {error}
          </div>
        )}
        {format === "terraform" && (
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginBottom: 8,
            }}
          >
            <input
              type="checkbox"
              checked={details}
              onChange={(e) => setDetails(e.target.checked)}
            />
            Show network and IAM details (VPC, subnets, security groups, roles)
          </label>
        )}
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <button style={btn} onClick={generate} disabled={!text.trim()}>
            Generate diagram
          </button>
          <button style={ghost} onClick={() => fileRef.current?.click()}>
            Choose files…
          </button>
          <button
            style={ghost}
            onClick={() => {
              setOpen(false);
              window.dispatchEvent(new Event(EVENTS.openNotebook));
            }}
            title="Opens the Python notebook panel (runs in your browser) next to the canvas"
          >
            Python notebook…
          </button>
          <select
            style={select}
            value=""
            title="Fill the box with an example"
            onChange={(e) => {
              if (e.target.value) {
                setText(EXAMPLES[e.target.value as InfraFormat]);
                setError("");
              }
            }}
          >
            <option value="">Load an example…</option>
            <option value="compose">Docker Compose</option>
            <option value="kubernetes">Kubernetes</option>
            <option value="terraform">Terraform</option>
            <option value="openapi">OpenAPI</option>
            <option value="sql">SQL schema</option>
            <option value="sqlquery">SQL query (SELECT, WITH, UPDATE…)</option>
            <option value="dbt">dbt lineage (manifest.json)</option>
            <option value="n8n">n8n workflow</option>
            <option value="notebook">Jupyter notebook</option>
            <option value="json">Any JSON</option>
          </select>
          <button style={ghost} onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
