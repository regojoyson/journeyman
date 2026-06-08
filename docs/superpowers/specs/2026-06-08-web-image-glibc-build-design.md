# Web Image: glibc Build Stage — Permanent Native-Binding Fix

**Date:** 2026-06-08
**Scope:** `Dockerfile` (the `build` stage only)
**Status:** Approved design

## Problem

Building the web image (`docker build --target runtime-web`) fails during
`npm run build -w @journeyman/web` with errors like:

```
Cannot find module '../lightningcss.linux-arm64-musl.node'
Cannot find native binding ... @rolldown/binding-linux-arm64-musl
```

These are the **npm optional-dependencies bug** ([npm/cli#4828](https://github.com/npm/cli/issues/4828)).
Modern frontend build tools — Rolldown (Vite 8's bundler), lightningcss
(`@tailwindcss/postcss`), esbuild — ship their compiled binaries as **separate
per-platform optional npm packages** (e.g. `lightningcss-linux-arm64-musl`,
`@rolldown/binding-linux-arm64-musl`). `package-lock.json` records all platform
variants (verified), but `npm ci` **on Alpine/musl** silently fails to install
the matching ones, so each native tool throws at build time — first Rolldown,
then lightningcss, and esbuild/others could be next.

The current Dockerfile patches this one package at a time
(`npm install @rolldown/binding-...`), which is whack-a-mole: each new native
tool reintroduces the failure.

## Root cause

musl/Alpine is the documented trouble spot for this npm bug; glibc-linux is the
first-class, best-supported target these tools are built and tested against.
Building the web bundle on Alpine is the source of the recurring breakage.

## Goal

A permanent fix: the web build pulls **all** platform-correct native binaries
automatically, with **no per-package patching**, and no new native dependency
can silently break the build again.

## Design

Change **only the `build` stage** of the `Dockerfile`. It is a throwaway stage
whose sole output is `packages/web/dist/`, which `runtime-web` (nginx:alpine)
copies in. No runtime stage (`runtime-api`, `runtime-worker`,
`runtime-migrations`) uses the build stage's `node_modules` — they all install
from the `deps` stage — so changing the build stage cannot affect those images.

### Changes

1. **Base image `node:22-alpine` → `node:22`** (Debian/glibc, includes the build
   toolchain). Because the build stage is discarded and only `dist/` is copied
   into `nginx:1.27-alpine`, this has **zero effect on the final web image
   size**.

2. **Self-contained dependency install.** Remove
   `COPY --from=deps /app/node_modules ./node_modules` (that is the Alpine/musl
   tree — wrong for a glibc stage). Instead the build stage copies the manifests
   and runs its **own `npm ci`** on glibc, mirroring the `deps` stage's
   manifest-copy pattern for layer caching, then copies the source and runs the
   build:

   ```dockerfile
   FROM node:22 AS build
   WORKDIR /app
   COPY package.json package-lock.json ./
   COPY packages ./packages
   RUN find packages -mindepth 2 -maxdepth 2 ! -name 'package.json' -exec rm -rf {} + 2>/dev/null || true
   RUN npm ci --include=dev
   COPY . .
   RUN npm run build -w @journeyman/web
   ```

3. **Delete the manual Rolldown binding hack** (the
   `case "$(uname -m)" … npm install --no-save @rolldown/binding-…` block).
   glibc prebuilts for Rolldown/lightningcss/esbuild install via `npm ci`; no
   per-package patching remains.

### Unchanged

`deps`, `runtime-api`, `runtime-worker`, `runtime-migrations` stay on
`node:22-alpine` — they run TypeScript via `tsx` at runtime and are unaffected by
frontend build tooling. `runtime-web` still copies `packages/web/dist` into
nginx. The web app's runtime behavior is unchanged (output is the same static
bundle).

## Fallback (documented, one-line)

If the npm optional-dependencies bug ever recurs even on glibc, change the build
stage's `npm ci` to `npm install`. `npm install` actively re-resolves and fetches
the platform-correct optional binaries, fully sidestepping #4828, at the cost of
allowing the in-image lockfile to update (harmless for a throwaway build stage
producing a static bundle). `npm ci` is the primary choice because it is
deterministic and glibc is the reliable path.

## Verification

- `docker build --target runtime-web -t journeyman/web:dev .` succeeds.
- The resulting nginx image serves a non-empty `packages/web/dist` (the build
  emitted JS + CSS assets).
- The unchanged runtime stages still build
  (`docker build --target runtime-api .`, `--target runtime-worker`), confirming
  no regression from the build-stage edit.
- Build/run happens on the developer's Docker (Apple Silicon → linux/arm64).

## Out of scope

- Switching package managers (pnpm/yarn would also avoid the bug but is a larger
  change).
- Changing the runtime stages' base image or install strategy.
- Building `dist/` on the host instead of in Docker.
