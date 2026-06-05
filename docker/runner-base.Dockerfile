# syntax=docker/dockerfile:1.7
# journeyman/runner-base — slim default box: alpine + node + git + the bundled runner.
# Build stage produces dist/runner.js (esbuild bundle of @journeyman/agent-runtime) and a
# prod-only node_modules (the externalized JS deps). The runtime stage ships only those —
# no monorepo source, no dev tooling (tsx/typescript/vitest). See Spec A.2.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN find packages -mindepth 2 -maxdepth 2 ! -name 'package.json' -exec rm -rf {} + 2>/dev/null || true
RUN npm ci --include=dev
COPY . .
# Bundle the runner (needs esbuild from the dev install above).
RUN npm run bundle -w @journeyman/agent-runtime
# Reinstall prod-only deps for the externalized SDKs/libs (drops typescript/vitest/tsx).
RUN npm ci --omit=dev

# ---- runtime ----
FROM node:22-alpine AS runner-base
# Production: the core logger emits plain JSON to stderr (no dev-only pino-pretty,
# which --omit=dev correctly drops). Keeps stdout clean for the runner's result JSON.
ENV NODE_ENV=production
RUN apk add --no-cache git openssh-client ca-certificates
WORKDIR /opt/journeyman
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/agent-runtime/dist/runner.js ./runner.js
# Uniform launcher name (the auto-wrap bundle exposes the same), so the Docker
# backend invokes the runner identically across image types.
RUN printf '#!/bin/sh\nexec node /opt/journeyman/runner.js "$@"\n' > /usr/local/bin/journeyman-runner \
 && chmod +x /usr/local/bin/journeyman-runner

# The runner reads a RunnerRequest on stdin and writes a RunnerResponse on stdout.
ENTRYPOINT ["journeyman-runner"]
