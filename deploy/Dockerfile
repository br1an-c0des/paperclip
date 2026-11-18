# syntax=docker/dockerfile:1.20
#
# Fork image: the core image built from this repo's root Dockerfile (target
# `production`: server, Paperclip Runner, agent CLIs) plus the board UI, the
# ui-new SolidJS app, which the core image doesn't build.
#
# BASE_IMAGE is that core image, paperclip-core:<commit>, which
# deploy/deploy.sh builds first. Build context is the repo root:
#
#   docker build --target production -t paperclip-core:<commit> .
#   docker build -f deploy/Dockerfile --build-arg BASE_IMAGE=paperclip-core:<commit> \
#     --build-arg PAPERCLIP_UI_COMMIT=<commit> .

# The placeholder makes a build without deploy.sh fail with a readable
# "paperclip-core-missing-run-deploy-sh: not found" instead of an
# invalid-reference error.
ARG BASE_IMAGE=paperclip-core-missing-run-deploy-sh

FROM node:24-trixie-slim AS ui
# The fork commit being built, shown under You in the nav. The build context
# has no .git (the root .dockerignore), so deploy/deploy.sh passes it; a build
# without it shows "ui unknown".
ARG PAPERCLIP_UI_COMMIT=""
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_STORE_DIR=/pnpm/store \
    PAPERCLIP_UI_COMMIT=${PAPERCLIP_UI_COMMIT}
RUN corepack enable
WORKDIR /app
COPY . .
# Install only ui-new and the workspace packages it depends on, then build it.
# The build copies public/ (the app logos in brands/, the favicons, the
# manifest and the service worker) and stamps the service worker with a build
# id (ui-new/vite.config.ts); check that each made it in, since a missing one
# only shows as broken images, missing icons, or tabs that never pick up a
# deploy.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --filter "@paperclipai/ui-new..." --ignore-scripts \
  && pnpm --filter @paperclipai/ui-new build \
  && test -f ui-new/dist/index.html \
  && test -n "$(ls -A ui-new/dist/brands 2>/dev/null)" \
  && test -f ui-new/dist/favicon.ico \
  && test -f ui-new/dist/apple-touch-icon.png \
  && test -f ui-new/dist/site.webmanifest \
  && test -f ui-new/dist/sw.js \
  && ! grep -q "__PAPERCLIP_BUILD_ID__" ui-new/dist/sw.js

FROM ${BASE_IMAGE}
# The server reports this as its commit in /api/health (server/src/build-commit.ts
# reads the variable first). deploy.sh builds the core image without
# PAPERCLIP_BUILD_COMMIT, which would also build the remote provider pack, so
# the commit is set here; it's the same commit the core image was built from.
ARG PAPERCLIP_UI_COMMIT=""
ENV PAPERCLIP_BUILD_COMMIT=${PAPERCLIP_UI_COMMIT}
# The server serves the first of server/ui-dist and ui-new/dist that has an
# index.html (server/src/app.ts), so clear the first and install the build as
# the second.
RUN rm -rf /app/server/ui-dist /app/ui-new/dist
COPY --from=ui --chown=node:node /app/ui-new/dist /app/ui-new/dist
