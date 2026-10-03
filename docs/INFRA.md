# Infrastructure to diagram

**Menu → Import infrastructure…** (or the command palette: "Import infrastructure") turns a `docker-compose.yml` into an architecture diagram on the canvas.

It is **deterministic and offline**: the file is parsed in your browser with a YAML parser and laid out by plain code. No AI is involved, nothing is sent anywhere, and the same file always gives the same diagram.

## How to use it

1. Open the dialog, paste the contents of a compose file or press **Choose file…** (or **Load example**).
2. Press **Generate diagram**. The diagram is added **below** whatever is already on the canvas and the view fits to it.
3. Everything is normal, editable Excalidraw shapes: move, recolor, animate it with slides.

## What is drawn

| Compose | Diagram |
| --- | --- |
| each service | a rounded box with an emoji for its role, the name, the image and the published ports |
| `ports: ["8080:80"]` | an arrow from an **Internet** node to the service, labelled `8080→80` (only published ports; `"80"` alone is internal and is skipped) |
| `depends_on` (list or map) and legacy `links` | an arrow from the service to what it depends on |
| named `volumes` | a dashed box in the last column with a dashed line to each service that mounts it (bind mounts and anonymous volumes are skipped) |

Layout is left to right: what nobody depends on (proxies, apps) is on the left, what they depend on (databases, caches, queues) on the right.

### Roles and colors

The role is guessed from the image and the service name, for example `postgres`, `mysql`, `mongo` → database; `redis`, `memcached` → cache; `rabbitmq`, `kafka`, `nats` → queue; `nginx`, `traefik`, `caddy` → proxy; `grafana`, `prometheus` → monitoring; `keycloak`, `vault` → auth; `minio`, `s3` → storage. Anything else is an application. The rules are in `excalidraw-app/infra/compose.ts` (`ROLE_RULES`), and the colors in `layout.ts` (`ROLE_STYLE`).

## Limits

- Only `docker-compose` files for now. Kubernetes manifests and Terraform are planned (see [ROADMAP.md](ROADMAP.md)).
- `extends`, `include` and `.env` substitution are not resolved; YAML anchors and merge keys (`<<`) are.
- Networks are not drawn (most compose files use one default network).
- Very large files produce large diagrams; the layout is a simple column layout, not an optimizer. Arrows are straight, so in dense diagrams one can pass over another box (they stay bound to their shapes: drag a box and the arrow follows). Tidying that up, for example with elbow arrows, is future work.

## Where the code is

`excalidraw-app/infra/compose.ts` (parser), `layout.ts` (layout and element skeletons), `compose.test.ts` (tests), `excalidraw-app/components/InfraDialog.tsx` (dialog). The parser uses `js-yaml`, already in the lockfile.
