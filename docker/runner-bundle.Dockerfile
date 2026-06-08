# syntax=docker/dockerfile:1.7
# journeyman/runner-bundle — a relocatable /opt/journeyman (its own glibc node + the
# bundled runner + prod node_modules), COPY --from'd into any glibc base image
# (Dockerfile auto-wrap). glibc base so the copied `node` binary runs in foreign images.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN find packages -mindepth 2 -maxdepth 2 ! -name 'package.json' -exec rm -rf {} + 2>/dev/null || true
RUN npm ci --include=dev
COPY . .
# Bundle the runner (esbuild from the dev install), then prune to prod-only deps.
RUN npm run bundle -w @journeyman/agent-runtime
RUN npm ci --omit=dev
# Assemble the relocatable bundle: own node binary + bundled runner + prod node_modules.
RUN mkdir -p /opt/journeyman/bin \
 && cp "$(command -v node)" /opt/journeyman/node \
 && ln -s /opt/journeyman/node /opt/journeyman/bin/node \
 && cp /app/packages/agent-runtime/dist/runner.js /opt/journeyman/runner.js \
 && cp -R /app/node_modules /opt/journeyman/node_modules \
 && printf '#!/bin/sh\nexport NODE_ENV=production\nexport PATH="/opt/journeyman/bin:/opt/journeyman/node_modules/.bin:$PATH"\nexec /opt/journeyman/node /opt/journeyman/runner.js "$@"\n' \
      > /opt/journeyman/bin/journeyman-runner \
 && chmod +x /opt/journeyman/bin/journeyman-runner

# Minimal carrier image: only the relocatable bundle, for COPY --from.
FROM scratch AS bundle
COPY --from=build /opt/journeyman /opt/journeyman
