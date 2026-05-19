# syntax=docker/dockerfile:1.7

# ---------- deps ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN find packages -mindepth 2 -maxdepth 2 ! -name 'package.json' -exec rm -rf {} + 2>/dev/null || true
RUN npm ci --include=dev

# ---------- build (web only — others run via tsx) ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Work around npm optional-deps bug for rollup native binaries on alpine/musl.
# https://github.com/npm/cli/issues/4828
RUN case "$(uname -m)" in \
      aarch64|arm64) PKG="@rollup/rollup-linux-arm64-musl" ;; \
      x86_64)        PKG="@rollup/rollup-linux-x64-musl" ;; \
      *)             PKG="" ;; \
    esac && \
    if [ -n "$PKG" ]; then npm install --no-save "$PKG"; fi
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
