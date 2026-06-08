# syntax=docker/dockerfile:1.7

# ---------- deps ----------
FROM node:22-alpine AS deps
WORKDIR /app
RUN npm install -g npm@11.16.0
COPY package.json package-lock.json ./
COPY packages ./packages
RUN find packages -mindepth 2 -maxdepth 2 ! -name 'package.json' -exec rm -rf {} + 2>/dev/null || true
RUN npm ci --include=dev

# ---------- build (web only — others run via tsx) ----------
# Built on Debian/glibc (not Alpine/musl) — the well-supported prebuilt target
# for native frontend build tools (Rolldown, lightningcss, esbuild). This stage
# is discarded (only packages/web/dist is copied into nginx below), so its larger
# base image has no effect on the final web image size.
FROM node:22 AS build
WORKDIR /app
RUN npm install -g npm@11.16.0
COPY package.json ./
COPY packages ./packages
RUN find packages -mindepth 2 -maxdepth 2 ! -name 'package.json' -exec rm -rf {} + 2>/dev/null || true
# Resolve dependencies fresh for the build platform (note: NO package-lock.json
# is copied here). npm's optional-dependencies bug (npm/cli#4828, present in npm
# 10 AND 11) makes it skip per-platform native packages — Rolldown/lightningcss/
# esbuild compiled bindings — whenever a lockfile generated on another OS
# (ours is committed from macOS) is present. Installing without that lockfile
# lets npm fetch the correct Linux binaries for every native tool at once, so no
# new native dependency can silently break the build again.
# This stage is discarded (only packages/web/dist is copied into nginx below);
# the runtime stages still install from the committed lockfile via `deps`, so
# backend dependency determinism is unaffected.
RUN npm install --include=dev
COPY . .
RUN npm run build -w @journeyman/web

# ---------- runtime-api ----------
FROM node:22-alpine AS runtime-api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 4000
CMD ["npm", "run", "start", "-w", "@journeyman/api-server"]

# ---------- runtime-worker ----------
FROM node:22-alpine AS runtime-worker
WORKDIR /app
ENV NODE_ENV=production
# Local-sandbox runs clone + run AI in-process here, so git + ssh must be present.
RUN apk add --no-cache git openssh-client ca-certificates
COPY --from=deps /app/node_modules ./node_modules
COPY . .
CMD ["npx", "tsx", "packages/orchestrator/src/cli-worker.ts"]

# ---------- runtime-migrations ----------
FROM node:22-alpine AS runtime-migrations
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
CMD ["npm", "run", "migrate", "-w", "@journeyman/migrations"]

# ---------- runtime-web ----------
FROM nginx:1.27-alpine AS runtime-web
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
COPY nginx/web.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
