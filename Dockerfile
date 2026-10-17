# The icon libraries (Esri Calcite glyphs, Esri Architecture Center icons, community libraries) are built here, inside
# Docker: nothing has to be installed or run on your computer first. The step needs the network, once per build.
FROM --platform=${BUILDPLATFORM} node:24@sha256:8530f76a96d88820d288761f022e318970dda93d01536919fbc16076b7983e63 AS library

# the "Interactive Map" library item points at the map viewer (same default as the app build below)
ARG ARCGIS_VIEWER_ORIGIN=
ENV VITE_APP_ARCGIS_VIEWER_ORIGIN=${ARCGIS_VIEWER_ORIGIN}

WORKDIR /opt/library
COPY tools tools
COPY libraries libraries
COPY assets/esri-icons assets/esri-icons
RUN mkdir -p public && node tools/build-library.js

# The Python notebooks (JupyterLite and Pyodide) are built here too, inside Docker. The build downloads Pyodide and the
# Python packages once (about 230 MB) and checks them against pinned hashes.
FROM --platform=${BUILDPLATFORM} node:24@sha256:8530f76a96d88820d288761f022e318970dda93d01536919fbc16076b7983e63 AS lite

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv bzip2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/trazo
COPY tools tools
RUN node tools/build-jupyterlite.mjs

FROM --platform=${BUILDPLATFORM} node:24@sha256:8530f76a96d88820d288761f022e318970dda93d01536919fbc16076b7983e63 AS build

WORKDIR /opt/node_app

COPY . .
COPY --from=library /opt/library/public/arcgis.excalidrawlib public/arcgis.excalidrawlib

# do not ignore optional dependencies:
# Error: Cannot find module @rollup/rollup-linux-x64-gnu
RUN --mount=type=cache,target=/root/.cache/yarn \
    npm_config_target_arch=${TARGETARCH} yarn --frozen-lockfile --network-timeout 600000

ARG NODE_ENV=production

# Optional: move the ArcGIS viewer off its default origin (same host, port 3001) — a different
# port, a reverse proxy, a tunnel with its own hostname. Unset, nothing changes. See
# packages/element/src/embeddable.ts and docs/VIEWER.md. Remember to also update
# deploy/nginx/viewer.conf (frame-ancestors) and, if you change the viewer's own listen port,
# the ports in docker-compose.yml.
ARG ARCGIS_VIEWER_ORIGIN=
ENV VITE_APP_ARCGIS_VIEWER_ORIGIN=${ARCGIS_VIEWER_ORIGIN}

RUN npm_config_target_arch=${TARGETARCH} yarn build:app:docker

# Strict CSP: allow exactly the inline scripts of the built index.html (no 'unsafe-inline' for scripts)
RUN node scripts/csp-hashes.mjs excalidraw-app/build/index.html /opt/node_app/csp.inc

# One image with the whole product, three servers: the app (3000), the ArcGIS map viewer (3001) and the Python
# notebooks (3002). Each has its own server configuration, with its own Content-Security-Policy and headers.
FROM nginx:stable-alpine-slim@sha256:2c605dbeab79a6b2a63340474fe58119d0ef95bdc4b1f41df0aa689659b3d13b

COPY --from=build /opt/node_app/excalidraw-app/build /usr/share/nginx/html
COPY --from=build /opt/node_app/csp.inc /etc/nginx/conf.d/csp.inc
COPY viewer /srv/viewer
COPY --from=lite /opt/trazo/assets/jupyterlite /srv/lite
COPY deploy/nginx/app.conf /etc/nginx/conf.d/default.conf
COPY deploy/nginx/viewer.conf /etc/nginx/conf.d/viewer.conf
COPY deploy/nginx/lite.conf /etc/nginx/conf.d/lite.conf
COPY --chmod=755 deploy/docker-entrypoint/40-trazo-resolver.sh /docker-entrypoint.d/40-trazo-resolver.sh

EXPOSE 3000 3001 3002
HEALTHCHECK CMD wget -q -O /dev/null http://localhost:3000 && wget -q -O /dev/null http://localhost:3001 && wget -q -O /dev/null http://localhost:3002 || exit 1
