# syntax=docker/dockerfile:1.7
# journeyman/runner-bundle — a relocatable /opt/journeyman (Node + the runner)
# meant to be COPY --from'd into any glibc base image (Dockerfile auto-wrap, spec §8).
FROM node:22-slim AS build
WORKDIR /opt/journeyman/app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN find packages -mindepth 2 -maxdepth 2 ! -name 'package.json' -exec rm -rf {} + 2>/dev/null || true
RUN npm ci --include=dev
COPY . .
RUN mkdir -p /opt/journeyman/bin \
 && cp "$(command -v node)" /opt/journeyman/node \
 && printf '#!/bin/sh\nexec /opt/journeyman/node /opt/journeyman/app/node_modules/.bin/tsx /opt/journeyman/app/packages/coding-cli/src/runner/cli.ts "$@"\n' \
      > /opt/journeyman/bin/journeyman-runner \
 && chmod +x /opt/journeyman/bin/journeyman-runner

# Minimal carrier image: only the relocatable bundle, for COPY --from.
FROM scratch AS bundle
COPY --from=build /opt/journeyman /opt/journeyman
