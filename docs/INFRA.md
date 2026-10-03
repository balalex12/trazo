# Infrastructure to diagram

**Menu → Import infrastructure…** (or the command palette: "Import infrastructure") turns what you already have into an architecture diagram on the canvas:

- a **`docker-compose.yml`**,
- **Kubernetes manifests** (YAML, one or many documents),
- **Terraform files** (`.tf`).

It is **deterministic and offline**: the text is parsed in your browser and laid out by plain code. No AI is involved, nothing is sent anywhere, and the same input always gives the same diagram.

## How to use it

1. Open the dialog and paste the text, or press **Choose files…** (you can pick several at once). **Load an example…** fills the box with a sample of any of the three.
2. Trazo works out which format it is and says so under the box ("Detected Kubernetes: 14 boxes"), including what it left out.
3. Press **Generate diagram**. The diagram is added **below** whatever is already on the canvas and the view fits to it.
4. Everything is normal, editable Excalidraw shapes: move, recolor, animate it with slides. Arrows stay bound to their shapes, so dragging a box drags its arrows.

Layout is left to right: the Internet first, then whatever nobody depends on (proxies, ingresses, apps), and on the right what they depend on (databases, caches, queues). Dashed boxes (volumes, config, claims) hang under the first thing that uses them.

## Docker Compose

| Compose | Diagram |
| --- | --- |
| each service | a rounded box with an emoji for its role, the name, the image and the published ports |
| `ports: ["8080:80"]` | an arrow from an **Internet** node to the service, labelled `8080→80` (only published ports; `"80"` alone is internal and is skipped) |
| `depends_on` (list or map) and legacy `links` | an arrow from the service to what it depends on |
| named `volumes` | a dashed box under the first service that mounts it, with a dashed line to every service that does (bind mounts and anonymous volumes are skipped) |

`extends`, `include` and `.env` substitution are not resolved; YAML anchors and merge keys (`<<`) are. Networks are not drawn.

## Kubernetes

| Kubernetes | Diagram |
| --- | --- |
| Deployment, StatefulSet, DaemonSet, ReplicaSet, Job, CronJob, Pod | a box with the kind, replicas (or the schedule), the images and any autoscaling. Jobs and CronJobs are colored as functions |
| Service | a box with its type and ports, and an arrow to every workload its `selector` picks (same namespace) |
| Ingress | a box with its hosts, an arrow from the Internet, and an arrow to each Service it routes to, labelled with host and path. A Service that is named but not pasted appears dashed |
| Service of type `LoadBalancer` or `NodePort` | an arrow straight from the Internet |
| ConfigMap, Secret, PersistentVolumeClaim, `volumeClaimTemplates` | dashed boxes under the first workload that uses them (env, `envFrom`, volumes), with a dashed line to every workload that does |
| HorizontalPodAutoscaler | a line on the workload it scales ("autoscaled 2-10 replicas") |

**One thing is inferred**, and the arrow says so: a workload that names a Service in an environment variable value (for example `DB_HOST=postgres` or `postgres.shop.svc.cluster.local`) gets an arrow to that Service, labelled with the variable name. Only plain `value:` entries are read, in the same namespace, and for Services whose name has at least 3 characters.

Roles come from the image and the name (see below). When the files hold more than one namespace, each box shows its namespace. Kinds that are not drawn (ServiceAccount, Role, NetworkPolicy…) are listed in the note under the box.

**Helm charts** are not read directly (their templates are not YAML yet). Render them first with `helm template`, then paste the result.

## Terraform

| Terraform | Diagram |
| --- | --- |
| `resource` | a box with the name and the resource type, colored by what it is |
| `data` | the same, with a dashed border |
| `module` | a box with the module name and its `source` |
| a reference to another block (`aws_db_instance.main.address`, `module.vpc.id`, `data.aws_ami.x.id`) and `depends_on` | an arrow from the block that refers to the one it refers to, which is how Terraform builds its own dependency graph |

References are found in the text of each block, including inside strings and heredocs. **Comments are ignored**, so a reference that only appears in a comment draws nothing.

To keep the picture readable, some things are left out and counted in the note:

- **Network and IAM** (VPCs, subnets, security groups, routes, IAM roles and policies, KMS keys…) are hidden by default, because nearly everything refers to them. Tick **Show network and IAM details** to draw them.
- Plumbing that is not architecture: `random_*`, `null_*`, `time_*`, `tls_*`, `local_*`, `template_*`, `archive_*`, `terraform_data`, and data sources such as the caller identity, the region, availability zones and policy documents.
- `variable`, `output`, `locals`, `provider` and `terraform` blocks.

Not supported yet: Terraform **JSON** (the output of `terraform show -json`); paste the `.tf` files instead. A module is drawn as one box: its inner resources are only drawn if you paste them too. References that go through `local.*` or `var.*` are not followed.

## Roles and colors

The role is guessed from the image and the name (compose, Kubernetes) or from the resource type (Terraform), for example `postgres`, `mysql`, `aws_db_instance` → database; `redis`, `aws_elasticache_cluster` → cache; `rabbitmq`, `kafka`, `aws_sqs_queue` → queue; `nginx`, `traefik`, `aws_lb`, `aws_cloudfront_distribution` → proxy; `grafana`, `prometheus`, `aws_cloudwatch_*` → monitoring; `keycloak`, `vault`, `aws_iam_*` → auth; `minio`, `aws_s3_bucket` → storage; `aws_lambda_function`, CronJobs → function. Anything else is an application. The rules are in `excalidraw-app/infra/compose.ts` (`ROLE_RULES`) and `terraform.ts` (`ROLE_RULES`), and the colors in `graph.ts` (`ROLE_STYLE`).

## Limits

- At most 150 boxes per diagram; paste fewer files (for example one namespace or one module) for bigger systems.
- The layout is a simple column layout, not an optimizer. Arrows are straight, so in dense diagrams one can pass over another box (they stay bound to their shapes: drag a box and the arrow follows). Tidying that up, for example with elbow arrows, is future work.
- Detection is by the text itself: a file that mixes formats is read as the first one it recognizes.

## Where the code is

`excalidraw-app/infra/`: `detect.ts` (which format it is, and the single entry point), `compose.ts`, `kubernetes.ts` and `terraform.ts` (one reader each, all producing the same graph), `graph.ts` (the graph, the layout and the Excalidraw elements), and the tests next to them. The dialog is `excalidraw-app/components/InfraDialog.tsx`. YAML is read with `js-yaml`, already in the lockfile; the Terraform reader is a small scanner written for this (no HCL library).
