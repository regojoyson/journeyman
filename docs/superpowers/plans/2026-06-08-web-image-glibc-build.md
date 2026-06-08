# Web Image glibc Build — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the web bundle on a glibc Node image so native build tools (Rolldown, lightningcss, esbuild) install correctly, permanently ending the Alpine/musl npm optional-dependency failures — and remove the per-package binding hack.

**Architecture:** Edit only the `build` stage of the root `Dockerfile`. It is a throwaway stage whose sole output is `packages/web/dist/`, consumed by `runtime-web` (nginx:alpine). No runtime stage uses its `node_modules`, so the change is isolated. Switch its base from `node:22-alpine` to `node:22` (Debian/glibc + toolchain), give it its own `npm ci`, and delete the manual Rolldown binding install.

**Tech Stack:** Docker (multi-stage), Node 22, npm workspaces, Vite 8 (Rolldown), Tailwind 4 (lightningcss), nginx.

---

## File map

| File | Change |
|---|---|
| `Dockerfile` | Replace the `build` stage (lines 11–31): base image, self-contained `npm ci`, drop the binding hack. All other stages untouched. |

There is no application code, type, or test change — verification is a Docker build.

---

## Task 1: Rewrite the `build` stage on glibc

**Files:**
- Modify: `Dockerfile` (the `# ---------- build ... ----------` stage)

- [ ] **Step 1: Replace the build stage**

In `Dockerfile`, replace this entire current block:

```dockerfile
# ---------- build (web only — others run via tsx) ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Work around npm optional-deps bug for native bundler binaries on alpine/musl.
# https://github.com/npm/cli/issues/4828
# Vite 8 bundles with Rolldown (Rust), replacing Rollup; its native binding
# must match the installed rolldown version. Install the matching musl binding
# for the build platform.
RUN case "$(uname -m)" in \
      aarch64|arm64) ARCH="arm64" ;; \
      x86_64)        ARCH="x64" ;; \
      *)             ARCH="" ;; \
    esac && \
    if [ -n "$ARCH" ]; then \
      RDV="$(node -e "const fs=require('fs');process.stdout.write(JSON.parse(fs.readFileSync('/app/node_modules/rolldown/package.json','utf8')).version)")" && \
      echo "Installing @rolldown/binding-linux-${ARCH}-musl@${RDV}" && \
      npm install --no-save "@rolldown/binding-linux-${ARCH}-musl@${RDV}"; \
    fi
RUN npm run build -w @journeyman/web
```

with this (note: `package-lock.json` is deliberately **not** copied — see Step 1a):

```dockerfile
# ---------- build (web only — others run via tsx) ----------
# Built on Debian/glibc (not Alpine/musl) and WITHOUT the committed lockfile.
# npm's optional-deps bug (npm/cli#4828, present in npm 10 AND 11) skips the
# per-platform native packages (Rolldown/lightningcss/esbuild bindings) whenever
# a lockfile generated on another OS is present, so we resolve fresh here to get
# the correct Linux binaries for every native tool at once. This stage is
# discarded (only packages/web/dist ships to nginx), and runtime stages still
# install from the committed lockfile via `deps`, so backend determinism and the
# final image size are unaffected.
FROM node:22 AS build
WORKDIR /app
COPY package.json ./
COPY packages ./packages
RUN find packages -mindepth 2 -maxdepth 2 ! -name 'package.json' -exec rm -rf {} + 2>/dev/null || true
RUN npm install --include=dev
COPY . .
RUN npm run build -w @journeyman/web
```

**Step 1a — why no lockfile (verified):** copying the macOS-committed
`package-lock.json` is the *trigger* for the bug. Diagnosed in a clean `node:22`
container: with the lockfile present, `node_modules/@rolldown/` and
`lightningcss-linux-*` install as **empty/absent** under both `npm ci` and
`npm install`, on both npm 10.9.8 and npm 11.16.0. Without the lockfile,
`npm install` installs `@rolldown/binding-linux-arm64-gnu` and
`lightningcss-linux-arm64-gnu` correctly.

Leave every other stage (`deps`, `runtime-api`, `runtime-worker`, `runtime-migrations`, `runtime-web`) exactly as-is.

- [ ] **Step 2: Sanity-check the Dockerfile is well-formed**

Run: `grep -n "FROM node:22 AS build" Dockerfile && ! grep -q "rolldown/binding" Dockerfile && ! grep -q "package-lock.json" <(sed -n '/AS build/,/npm run build/p' Dockerfile) && echo "build stage updated, hack + lockfile-copy removed"`
Expected: prints the `FROM node:22 AS build` line and `build stage updated, hack + lockfile-copy removed`.

- [ ] **Step 3: Build the web image**

Run: `docker build --target runtime-web -t journeyman/web:dev .`
Expected: completes successfully; the `RUN npm run build -w @journeyman/web` step prints `✓ built` with emitted `dist/assets/*.js` and `*.css`, and **no** `Cannot find module '../lightningcss...'` or `Cannot find native binding ... @rolldown/binding...` errors.

- [ ] **Step 4: Confirm the image serves real assets**

Run:
```bash
docker run --rm journeyman/web:dev ls -la /usr/share/nginx/html /usr/share/nginx/html/assets
```
Expected: lists `index.html` and at least one `.js` and one `.css` file under `assets/` (a non-empty bundle).

- [ ] **Step 5: Confirm runtime stages still build (no regression)**

Run:
```bash
docker build --target runtime-api -t journeyman/api:dev .
docker build --target runtime-worker -t journeyman/worker:dev .
```
Expected: both succeed (these are unchanged and stay on `node:22-alpine`).

- [ ] **Step 6: Commit**

```bash
git add Dockerfile
git commit -m "fix(docker): build web on glibc node:22 to fix native-binding failures

Build the web bundle on node:22 (Debian/glibc) instead of node:22-alpine so
Rolldown/lightningcss/esbuild install their first-class glibc prebuilts via a
plain npm ci, ending the recurring npm optional-deps failures (npm/cli#4828) on
musl. The build stage is self-contained (own npm ci, no cross-stage musl
node_modules) and the per-package Rolldown binding hack is removed. Build stage
is discarded; runtime-web stays nginx:alpine, so final image size is unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Verified outcome

Implemented and verified in real Docker (Apple Silicon → linux/arm64, glibc):
- `docker build --target runtime-web` succeeds; build emits `dist/assets/*.js`
  (~1.83 MB) and `*.css` (~146 KB).
- The nginx image serves `index.html` + a non-empty `assets/` bundle.
- `runtime-api` and `runtime-worker` still build (no regression).

The earlier "keep lockfile + `npm ci`/`npm install`" approaches were tried and
**failed identically** (zero native bindings installed); only dropping the
lockfile so npm resolves fresh works. There is no remaining fallback needed.

---

## Self-review

- **Spec coverage:** base image change (Step 1) ✓; self-contained `npm ci` (Step 1) ✓; delete binding hack (Step 1) ✓; unchanged runtime stages (Step 5 verifies) ✓; verification via docker build + non-empty dist (Steps 3–4) ✓; fallback documented ✓.
- **Placeholders:** none — full before/after Dockerfile content and exact commands given.
- **Consistency:** stage name `build`, output path `packages/web/dist`, and `runtime-web`'s `COPY --from=build /app/packages/web/dist` all line up.
