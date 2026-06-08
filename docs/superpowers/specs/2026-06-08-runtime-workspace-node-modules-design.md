# Runtime Images: Ship Per-Workspace node_modules

**Date:** 2026-06-08
**Scope:** `Dockerfile` (the `runtime-api`, `runtime-worker`, `runtime-migrations` stages)
**Status:** Approved design

## Problem

The worker (and api) crash at startup with:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@octokit/plugin-retry'
imported from /app/packages/github-api/src/index.ts
```

## Root cause

This is an npm-workspaces packaging gap in the Dockerfile, not an application or
version problem.

In an npm-workspaces monorepo, `npm ci` installs most dependencies into the
**root** `node_modules/`, but when a dependency cannot be hoisted (a version
conflict), npm nests it in that **workspace's own** `node_modules/`. Here, the
`@octokit/core` 6-vs-7 split (`@octokit/rest@22` pulls `core@6` for its bundled
sub-plugins while `@octokit/plugin-retry@8` / `plugin-throttling@11` require
`core@7`) forces `@octokit/plugin-retry` and `@octokit/plugin-throttling` to
install **nested** at `packages/github-api/node_modules/@octokit/…` rather than
top-level. Verified in a real `deps` build: the plugins are absent from
`/app/node_modules/@octokit/` and present in
`/app/packages/github-api/node_modules/@octokit/`.

The runtime stages copy only the root tree:

```dockerfile
COPY --from=deps /app/node_modules ./node_modules
```

They never copy `packages/*/node_modules`, so the nested octokit plugins never
reach the runtime images and the import fails at runtime. (Typecheck and the web
build don't catch this — they run in `/app` where the nested tree exists; only
the runtime images, assembled by selective `COPY`, are missing it.)

This is a latent bug: any future dependency that npm nests into a workspace would
break the same way.

## Goal

Runtime images must contain the **complete** installed dependency tree the `deps`
stage produced — both the root `node_modules` and every `packages/*/node_modules`
— so any nested dependency resolves at runtime, now and in the future. No
dependency is pulled from git; `node_modules` is built inside the `deps` stage by
`npm ci` and copied between Docker stages only.

## Design

Add one line to each runtime stage that runs application code via `tsx` /
`npm run` — `runtime-api`, `runtime-worker`, `runtime-migrations` — copying the
per-workspace `node_modules` from the `deps` stage alongside the root tree.

Each stage's dependency section becomes:

```dockerfile
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY . .
```

- `COPY --from=deps /app/packages ./packages` brings each workspace's
  `package.json` plus its nested `node_modules` (the `deps` stage stripped
  workspace source before `npm ci`, so this is package manifests + installed
  deps only).
- The subsequent `COPY . .` overlays the application **source** on top. Docker
  `COPY` merges — it adds/overwrites files present in the build context but never
  deletes destination files absent from it. The build context excludes
  `node_modules` (via `.dockerignore`), so the nested `node_modules` copied from
  `deps` survive; only source files are added.

### Unchanged

- **`deps`** — still the single `npm ci` that builds the whole tree.
- **`build`** (web) — unaffected: it installs in place and runs in `/app`, where
  both root and nested `node_modules` already exist; only `packages/web/dist` is
  copied onward.
- **`runtime-web`** — unaffected: copies only `dist/` into nginx.

## Out of scope

- Eliminating the `@octokit/core` 6/7 split / forcing top-level hoisting
  (an alternative cleanup; not required once the full tree ships, and it would
  not protect against a different dependency nesting later).
- Changing the `deps` stage's install command or determinism.

## Verification

- `docker build --target runtime-worker` and `--target runtime-api` succeed.
- In the built worker image, `node_modules` resolution of the failing import
  works — e.g. running the worker no longer throws `ERR_MODULE_NOT_FOUND` for
  `@octokit/plugin-retry`, and a direct check
  (`node --import tsx -e "import('/app/packages/github-api/src/index.ts')"`)
  resolves `createGitHubClient`.
- `packages/github-api/node_modules/@octokit/plugin-retry` is present in the
  runtime image.
- `runtime-migrations` still builds (same edit applied).
- Build/run on the developer's Docker (Apple Silicon → linux/arm64).
