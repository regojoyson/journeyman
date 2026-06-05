# Slim Agent-Runtime Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink the runner kit images (`runner-base`, `runner-bundle`) from ~746 MB toward <~350 MB by bundling the box runtime with esbuild, installing prod-only deps, and using an alpine base — verified by a real `docker build` + `journeyman-runner --selftest`.

**Architecture:** The package rename `coding-cli → agent-runtime` + Claude SDK → prod dependency is already done (Task 1 just verifies/commits it). The slimming bundles `agent-runtime`'s runner into a single `runner.js` with **esbuild** (we must transpile, not strip — the providers use TS *parameter properties* like `constructor(private config…)`, which Node's `--experimental-strip-types` rejects). Provider SDKs (`@anthropic-ai/claude-agent-sdk`, `@opencode-ai/sdk`) stay **external** (they spawn their own CLI/subprocesses, so they must remain real files in `node_modules`); everything else (our code + the pure `@journeyman/mcp|skills/sdk-adapter`) is bundled in. The final image = alpine + node + git + **prod** `node_modules` (externals only) + `runner.js` — no monorepo source, no dev tooling.

**Tech Stack:** esbuild (already in `node_modules/.bin`), Node 22, Docker (multi-stage), the existing `scripts/build-runner-image.sh` / `build-runner-bundle.sh` smoke tests.

**Spec:** [docs/superpowers/specs/2026-06-03-agent-runtime-split-design.md](../specs/2026-06-03-agent-runtime-split-design.md)

**Branch:** continue on `feat/agent-runtime-split` (the rename lives here, uncommitted).

**⚠️ Verification reality:** these changes are **not** provable by `npm run check` — a kit that typechecks can still fail to *run*. **Every Dockerfile task ends with a real `docker build` + `docker run … --selftest`.** Do not mark a task done on typecheck alone.

---

## Task 1: Land & verify the rename (already implemented)

**Files (already changed on the branch):**
- Renamed: `packages/coding-cli/` → `packages/agent-runtime/`
- Modify: `packages/agent-runtime/package.json` (name; Claude SDK dev→`dependencies`; peer removed)
- Modify: `packages/orchestrator/src/cli-worker.ts`, `packages/orchestrator/package.json`, `packages/web/package.json`, `scripts/check-import-boundaries.mjs`, `docker/*.Dockerfile` (runner path), `package-lock.json`

- [ ] **Step 1: Verify typecheck + boundaries**

Run: `npm run check`
Expected: PASS — `✓ Layer boundaries clean across all packages.`

- [ ] **Step 2: Verify the renamed package's tests**

Run: `( cd packages/agent-runtime && npx vitest run )`
Expected: PASS (22 tests).

- [ ] **Step 3: Confirm no stale package references**

Run:
```bash
grep -rn "@journeyman/coding-cli\|packages/coding-cli" packages scripts docker package-lock.json --include="*.ts" --include="*.tsx" --include="*.json" --include="*.mjs" --include="*.Dockerfile" | grep -v node_modules
```
Expected: no matches. (The executor-*kind* string `"coding-cli"` in `provider-catalog.ts` / web is a domain term — NOT a package ref — and must remain.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: rename @journeyman/coding-cli -> @journeyman/agent-runtime; Claude SDK -> prod dep"
```

---

## Task 2: Bundle the runner with esbuild

**Files:**
- Modify: `packages/agent-runtime/package.json` (add `esbuild` devDep + a `bundle` script)
- Create: `packages/agent-runtime/.gitignore` (ignore `dist/`)

- [ ] **Step 1: Add esbuild + a bundle script to `agent-runtime/package.json`**

In `devDependencies` add `"esbuild": "^0.23.0"`. In `scripts` add:
```json
"bundle": "esbuild src/runner/cli.ts --bundle --platform=node --format=esm --target=node22 --external:@anthropic-ai/claude-agent-sdk --external:@opencode-ai/sdk --banner:js=\"import{createRequire}from'module';const require=createRequire(import.meta.url);\" --outfile=dist/runner.js"
```
(The `--banner` shim provides `require` in the ESM bundle for any externalized CJS dep. Externals stay as runtime `node_modules` lookups; our code + the pure `@journeyman/*` sdk-adapters get bundled in.)

- [ ] **Step 2: Create `packages/agent-runtime/.gitignore`**

```
dist/
```

- [ ] **Step 3: Install esbuild**

Run: `npm install`
Expected: completes; `node_modules/.bin/esbuild` present.

- [ ] **Step 4: Build the bundle**

Run: `( cd packages/agent-runtime && npm run bundle )`
Expected: writes `packages/agent-runtime/dist/runner.js`, no unresolved-import errors. If esbuild reports it can't resolve `@anthropic-ai/claude-agent-sdk` or `@opencode-ai/sdk`, that's expected — they're external (runtime-resolved), not bundled.

- [ ] **Step 5: Run the bundle's selftest locally (proves it actually executes)**

Run: `echo '' | node packages/agent-runtime/dist/runner.js --selftest`
Expected: prints `{"ok":true,"structured":{"selftest":true}}` and exits 0. (This is the cheap local proof the transpiled bundle runs before we put it in a container.)

- [ ] **Step 6: Commit**

```bash
git add packages/agent-runtime/package.json packages/agent-runtime/.gitignore package-lock.json
git commit -m "build(agent-runtime): esbuild bundle of the runner (providers external)"
```

---

## Task 3: Slim `runner-base.Dockerfile` (alpine, prod deps, bundled runner)

**Files:**
- Modify: `docker/runner-base.Dockerfile`

- [ ] **Step 1: Rewrite `runner-base.Dockerfile` as a slim multi-stage build**

```dockerfile
# syntax=docker/dockerfile:1.7
# journeyman/runner-base — slim default box: alpine + node + git + the bundled runner.
# Build stage produces dist/runner.js (esbuild) and a prod-only node_modules (externals).

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN find packages -mindepth 2 -maxdepth 2 ! -name 'package.json' -exec rm -rf {} + 2>/dev/null || true
RUN npm ci --include=dev
COPY . .
RUN npm run bundle -w @journeyman/agent-runtime
# Prod-only deps for the externalized SDKs (drops typescript/vitest/tsx).
RUN npm ci --omit=dev

# ---- runtime ----
FROM node:22-alpine AS runner-base
RUN apk add --no-cache git openssh-client ca-certificates
WORKDIR /opt/journeyman
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/agent-runtime/dist/runner.js ./runner.js
RUN printf '#!/bin/sh\nexec node /opt/journeyman/runner.js "$@"\n' > /usr/local/bin/journeyman-runner \
 && chmod +x /usr/local/bin/journeyman-runner
ENTRYPOINT ["journeyman-runner"]
```

> Note: `node_modules` here is the **root workspace** prod tree (externals + transitive). If a later size pass wants it smaller, prune to just `@anthropic-ai/claude-agent-sdk` + `@opencode-ai/sdk` + transitive — optional, not required to pass this task.

- [ ] **Step 2: Build the image**

Run: `docker build -f docker/runner-base.Dockerfile -t journeyman/runner-base:slimtest .`
Expected: builds successfully.

- [ ] **Step 3: Selftest the image (proves the box runs)**

Run: `docker run --rm journeyman/runner-base:slimtest --selftest`
Expected: output contains `"ok":true` and `"selftest":true`.
**If it fails with "Cannot find module @anthropic-ai/claude-agent-sdk" or similar** → an external SDK isn't in the prod `node_modules`; fix by confirming it's in `agent-runtime`'s `dependencies` (Task 1) and re-running. **If it fails on an ESM/`require` error** → adjust the esbuild `--format`/banner in Task 2 (try `--format=cjs --outfile=dist/runner.cjs` + launcher `node runner.cjs`) and rebuild.

- [ ] **Step 4: Check git works in the box (clone needs it)**

Run: `docker run --rm --entrypoint sh journeyman/runner-base:slimtest -c "git --version && node --version"`
Expected: prints a git version and `v22.x`.

- [ ] **Step 5: Record the size (the goal)**

Run: `docker image ls journeyman/runner-base:slimtest --format '{{.Size}}'`
Expected: materially smaller than the old 746 MB (target <~350 MB). Note the number in the commit message.

- [ ] **Step 6: Commit**

```bash
git add docker/runner-base.Dockerfile
git commit -m "build(docker): slim runner-base (alpine + prod deps + esbuild bundle); was 746MB"
```

---

## Task 4: Slim `runner-bundle.Dockerfile` (relocatable, glibc)

**Files:**
- Modify: `docker/runner-bundle.Dockerfile`
- Test: `packages/compute/src/backends/docker/dockerfile-wrap.test.ts` (only if the bundle path/launcher name changes)

- [ ] **Step 1: Rewrite `runner-bundle.Dockerfile` to carry the bundle, not the source**

The bundle stays **glibc** (`node:22-slim`) because it copies a glibc `node` for relocatability into arbitrary base images.

```dockerfile
# syntax=docker/dockerfile:1.7
# journeyman/runner-bundle — relocatable /opt/journeyman (node + bundled runner + prod deps),
# COPY --from'd into a user's Dockerfile (auto-wrap). glibc base for relocatability.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN find packages -mindepth 2 -maxdepth 2 ! -name 'package.json' -exec rm -rf {} + 2>/dev/null || true
RUN npm ci --include=dev
COPY . .
RUN npm run bundle -w @journeyman/agent-runtime
RUN npm ci --omit=dev
RUN mkdir -p /opt/journeyman/bin /opt/journeyman/node_modules \
 && cp "$(command -v node)" /opt/journeyman/node \
 && ln -s /opt/journeyman/node /opt/journeyman/bin/node \
 && cp -R /app/node_modules/. /opt/journeyman/node_modules/ \
 && cp /app/packages/agent-runtime/dist/runner.js /opt/journeyman/runner.js \
 && printf '#!/bin/sh\nexec /opt/journeyman/node /opt/journeyman/runner.js "$@"\n' \
      > /opt/journeyman/bin/journeyman-runner \
 && chmod +x /opt/journeyman/bin/journeyman-runner

FROM scratch AS bundle
COPY --from=build /opt/journeyman /opt/journeyman
```

- [ ] **Step 2: Confirm `wrapDockerfile` still matches (path + launcher unchanged)**

Read `packages/compute/src/backends/docker/dockerfile-wrap.ts` — it appends `COPY --from=<bundleRef> /opt/journeyman /opt/journeyman` and `ENV PATH=/opt/journeyman/bin:$PATH`, and invokes `journeyman-runner`. The new bundle keeps `/opt/journeyman`, `/opt/journeyman/bin/journeyman-runner`, and the bundled `node`. No wrap change needed.
Run: `( cd packages/compute && npx vitest run src/backends/docker/dockerfile-wrap.test.ts )`
Expected: PASS (unchanged).

- [ ] **Step 3: Build the bundle image**

Run: `docker build -f docker/runner-bundle.Dockerfile --target bundle -t journeyman/runner-bundle:slimtest .`
Expected: builds successfully.

- [ ] **Step 4: Prove the bundle works grafted onto a foreign base**

Create a throwaway wrap and build it:
```bash
printf 'FROM node:22-slim\nUSER root\nRUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*\nCOPY --from=journeyman/runner-bundle:slimtest /opt/journeyman /opt/journeyman\nENV PATH=/opt/journeyman/bin:$PATH\nENTRYPOINT ["journeyman-runner"]\n' > /tmp/wrap.Dockerfile
docker build -f /tmp/wrap.Dockerfile -t jm-wraptest /tmp
docker run --rm jm-wraptest --selftest
```
Expected: `"ok":true` … `"selftest":true`. (Proves the relocated glibc `node` + bundled runner run inside a different base.)

- [ ] **Step 5: Commit**

```bash
git add docker/runner-bundle.Dockerfile
git commit -m "build(docker): slim runner-bundle (bundled runner + prod deps + relocatable node)"
```

---

## Task 5: End-to-end + size verification

**Files:**
- (No code) — verification only; optionally `scripts/build-runner-image.sh` if its tag changes.

- [ ] **Step 1: Build both kit images via the existing scripts (they already run `--selftest`)**

Run:
```bash
TAG=slimtest ./scripts/build-runner-image.sh
TAG=slimtest ./scripts/build-runner-bundle.sh
```
Expected: `build-runner-image.sh` prints `OK: runner-base image works`; `build-runner-bundle.sh` prints `OK: built …`.

- [ ] **Step 2: Real workspace op in the box (clone — bucket 2)**

Run (public repo, no token needed):
```bash
docker run --rm journeyman/runner-base:slimtest <<<'{"op":"clone","provider":"claude","opts":{"repoUrl":"https://github.com/octocat/Hello-World.git","dir":"hello"}}'
```
Expected: JSON `{"ok":true,"structured":{"dir":"hello"}}` (the runner's `clone` op ran `git clone` inside the slim box).

- [ ] **Step 3: Confirm the box has no dev tooling / no monorepo source**

Run:
```bash
docker run --rm --entrypoint sh journeyman/runner-base:slimtest -c "ls /opt/journeyman; ! ls node_modules/typescript 2>/dev/null && echo NO-TYPESCRIPT; ! ls /app 2>/dev/null && echo NO-MONOREPO-SRC"
```
Expected: lists `runner.js` + `node_modules`; prints `NO-TYPESCRIPT` and `NO-MONOREPO-SRC`.

- [ ] **Step 4: Record final sizes**

Run: `docker image ls 'journeyman/runner-*:slimtest' --format '{{.Repository}}\t{{.Size}}'`
Expected: both well under the old 746 MB. If `runner-base` is still large, the optional `node_modules` prune (Task 3 note) is the lever.

- [ ] **Step 5: Commit (verification notes in the message)**

```bash
git commit --allow-empty -m "test(docker): verified slim kit — runner-base <NNN>MB, bundle <NNN>MB, selftest + clone pass"
```

---

## Self-Review (completed)

**1. Spec coverage (A.2):**
- "extract slim `agent-runtime`" + "Claude SDK → prod dep" → Task 1. ✅
- "bundle all providers; runtime toggle" → unchanged by slimming; the bundle includes all provider adapters (Task 2). ✅
- "prod-only deps" → `npm ci --omit=dev` (Tasks 3/4). ✅
- "run `.ts` without tsx/typescript" → done via **esbuild bundle** (Task 2) — native `--experimental-strip-types` rejected because of TS parameter properties (documented in Architecture). ✅
- "focused build context (ship only what the box needs)" → achieved by shipping only `runner.js` + prod `node_modules`, **not** the monorepo source (Task 3/4, verified Task 5 Step 3). ✅
- "alpine base for `runner-base`; bundle stays glibc" → Task 3 (alpine) / Task 4 (slim/glibc). ✅
- "git/ssh/ca-certs stay" → Task 3 `apk add` (verified Task 3 Step 4). ✅

**2. Placeholder scan:** none — every Dockerfile/command is concrete; failure branches give exact fallbacks (e.g. esm→cjs, missing-external fix).

**3. Type/name consistency:** `runner.js`, `/opt/journeyman`, `journeyman-runner`, the esbuild externals, and the `--selftest` contract are used consistently across Tasks 2–5 and match `dockerfile-wrap.ts`'s expectations (Task 4 Step 2).

**Open risk (called out, not hidden):** the esbuild `--format=esm` + `require` banner may need to flip to `--format=cjs` if an external SDK's interop misbehaves — Task 2 Step 5 and Task 3 Step 3 catch this *before* shipping, with the exact fallback written inline.
