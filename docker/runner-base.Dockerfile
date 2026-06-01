# syntax=docker/dockerfile:1.7
# journeyman/runner-base — Node + the journeyman-runner + baseline coding tools
# (git, ssh, CA certs). Custom worker images FROM this; the Docker backend also
# uses it as the default runner image. See spec §8.
FROM node:22-slim AS runner-base

# Baseline toolset every coding container needs (spec §1 item 4 / §8).
RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      openssh-client \
      ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install workspace deps (incl. dev: tsx + the Agent SDK live there).
COPY package.json package-lock.json ./
COPY packages ./packages
RUN find packages -mindepth 2 -maxdepth 2 ! -name 'package.json' -exec rm -rf {} + 2>/dev/null || true
RUN npm ci --include=dev

# Bring in the full source (runner + providers run via tsx).
COPY . .

ENV PATH=/app/node_modules/.bin:$PATH

# A uniform `journeyman-runner` launcher (the auto-wrap bundle exposes the same name),
# so DockerExecutionEnvironment can invoke the runner identically across image types.
RUN printf '#!/bin/sh\nexec npx tsx /app/packages/coding-cli/src/runner/cli.ts "$@"\n' \
      > /usr/local/bin/journeyman-runner \
 && chmod +x /usr/local/bin/journeyman-runner

# The runner reads a RunnerRequest on stdin and writes a RunnerResponse on stdout.
ENTRYPOINT ["journeyman-runner"]
