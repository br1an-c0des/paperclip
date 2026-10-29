# syntax=docker/dockerfile:1.20
#
# Fork image: upstream's published Paperclip image with the ui-new SolidJS UI
# in place of the React UI. Nothing upstream builds is rebuilt here, so the
# Rust runner, agent CLIs and server stay exactly as upstream shipped them.
#
# UPSTREAM_SHA is the upstream commit whose server image this fork builds on;
# deploy/deploy.sh resolves it from the last upstream commit merged into this
# branch. Build context is the repo root:
#
#   docker build -f deploy/Dockerfile --build-arg UPSTREAM_SHA=<sha> .

# The placeholder makes a build without deploy.sh fail with a readable
# "sha-missing-run-deploy-sh: not found" instead of an invalid-reference error.
ARG UPSTREAM_SHA=missing-run-deploy-sh

FROM node:24-trixie-slim AS ui
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_STORE_DIR=/pnpm/store
RUN corepack enable
WORKDIR /app
COPY . .
# Install only ui-new and the workspace packages it depends on, then build it.
# The build copies the app logos (brands/) and the favicons from ui/public and
# stamps the service worker with a build id (ui-new/vite.config.ts); check that
# each made it in, since a missing one only shows as broken images, missing
# icons, or tabs that never pick up a deploy.
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

FROM ghcr.io/paperclipai/paperclip:sha-${UPSTREAM_SHA}
# The server serves the first of server/ui-dist and ui/dist that has an
# index.html (server/src/app.ts), so clear both and install ui-new as ui/dist.
RUN rm -rf /app/server/ui-dist /app/ui/dist
COPY --from=ui --chown=node:node /app/ui-new/dist /app/ui/dist
