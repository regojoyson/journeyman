# syntax=docker/dockerfile:1.7
# journeyman/runner-base — slim default box: glibc node + git + the bundled runner.
# Build stage produces dist/runner.js (esbuild bundle of @journeyman/agent-runtime) and a
# prod-only node_modules (the externalized JS deps). The runtime stage ships only those —
# no monorepo source, no dev tooling (tsx/typescript/vitest). See Spec A.2.
# Runtime is glibc (node:22-slim, not alpine) so the prebuilt `opencode` binary — resolved
# by `npm ci` for the glibc build platform — runs in the runtime image too.

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
FROM node:22-slim AS runner-base
# Production: the core logger emits plain JSON to stderr (no dev-only pino-pretty,
# which --omit=dev correctly drops). Keeps stdout clean for the runner's result JSON.
ENV NODE_ENV=production
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git openssh-client ca-certificates curl \
      python3 python3-pip python-is-python3 \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/journeyman
COPY --from=build /app/node_modules ./node_modules
# opencode CLI binary ships in node_modules/.bin (opencode-ai dep); the SDK spawns
# it by bare name, so it must be on PATH for the managed-server mode.
ENV PATH="/opt/journeyman/node_modules/.bin:${PATH}"
COPY --from=build /app/packages/agent-runtime/dist/runner.js ./runner.js
# Uniform launcher name (the auto-wrap bundle exposes the same), so the Docker
# backend invokes the runner identically across image types.
RUN printf '#!/bin/sh\nexec node /opt/journeyman/runner.js "$@"\n' > /usr/local/bin/journeyman-runner \
 && chmod +x /usr/local/bin/journeyman-runner

# The runner reads a RunnerRequest on stdin and writes a RunnerResponse on stdout.
ENTRYPOINT ["journeyman-runner"]
