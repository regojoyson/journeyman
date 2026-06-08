# Runtime Per-Workspace node_modules — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the runtime Docker images (`runtime-api`, `runtime-worker`, `runtime-migrations`) ship every workspace's nested `node_modules`, not just the root one, so nested dependencies (e.g. the `@octokit/*` plugins under `packages/github-api/node_modules`) resolve at runtime — fixing `ERR_MODULE_NOT_FOUND`.

**Architecture:** Add `COPY --from=deps /app/packages ./packages` to each of the three runtime stages, before their `COPY . .`. The `deps` stage already builds the full tree (root + per-workspace `node_modules`) via `npm ci`; the runtime stages currently copy only the root tree. All inside `docker build` — nothing from git.

**Tech Stack:** Docker multi-stage, Node 22, npm workspaces, tsx.

---

## File map

| File | Change |
|---|---|
| `Dockerfile` | Add one `COPY --from=deps /app/packages ./packages` line to `runtime-api`, `runtime-worker`, `runtime-migrations`. `deps`, `build`, `runtime-web` unchanged. |

No application/code/test change — verification is a Docker build + runtime resolution check.

---

## Task 1: Copy per-workspace node_modules into runtime stages

**Files:**
- Modify: `Dockerfile` (`runtime-api`, `runtime-worker`, `runtime-migrations` stages)

- [ ] **Step 1: Edit `runtime-api`**

Find:
```dockerfile
# ---------- runtime-api ----------
FROM node:22-alpine AS runtime-api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
```
Replace with:
```dockerfile
# ---------- runtime-api ----------
FROM node:22-alpine AS runtime-api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
# Also ship per-workspace node_modules: npm nests un-hoistable deps (e.g. the
# @octokit/* plugins under packages/github-api) here, and runtime needs them.
COPY --from=deps /app/packages ./packages
COPY . .
```

- [ ] **Step 2: Edit `runtime-worker`**

Find:
```dockerfile
COPY --from=deps /app/node_modules ./node_modules
COPY . .
CMD ["npx", "tsx", "packages/orchestrator/src/cli-worker.ts"]
```
Replace with:
```dockerfile
COPY --from=deps /app/node_modules ./node_modules
# Also ship per-workspace node_modules (see runtime-api).
COPY --from=deps /app/packages ./packages
COPY . .
CMD ["npx", "tsx", "packages/orchestrator/src/cli-worker.ts"]
```

- [ ] **Step 3: Edit `runtime-migrations`**

Find:
```dockerfile
COPY --from=deps /app/node_modules ./node_modules
COPY . .
CMD ["npm", "run", "migrate", "-w", "@journeyman/migrations"]
```
Replace with:
```dockerfile
COPY --from=deps /app/node_modules ./node_modules
# Also ship per-workspace node_modules (see runtime-api).
COPY --from=deps /app/packages ./packages
COPY . .
CMD ["npm", "run", "migrate", "-w", "@journeyman/migrations"]
```

- [ ] **Step 4: Sanity-check the edit**

Run: `grep -c "COPY --from=deps /app/packages ./packages" Dockerfile`
Expected: `3` (one per runtime stage; `build` and `runtime-web` are untouched).

- [ ] **Step 5: Build the worker image**

Run: `docker build --target runtime-worker -t journeyman/worker:dev .`
Expected: completes successfully.

- [ ] **Step 6: Confirm the nested octokit plugins are present and the failing import resolves**

Run:
```bash
docker run --rm journeyman/worker:dev sh -c \
  'ls packages/github-api/node_modules/@octokit/ | grep -E "plugin-(retry|throttling)" && \
   node --import tsx -e "import(\"/app/packages/github-api/src/index.ts\").then(m=>console.log(\"OK\",typeof m.createGitHubClient)).catch(e=>{console.error(\"FAIL\",e.code);process.exit(1)})"'
```
Expected: prints `plugin-retry`, `plugin-throttling`, then `OK function` — no `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 7: Build the other two runtime images (no regression)**

Run:
```bash
docker build --target runtime-api -t journeyman/api:dev .
docker build --target runtime-migrations -t journeyman/migrations:dev .
```
Expected: both succeed.

- [ ] **Step 8: Commit**

```bash
git add Dockerfile
git commit -m "fix(docker): ship per-workspace node_modules in runtime images

Runtime stages copied only /app/node_modules, dropping packages/*/node_modules
where npm nests un-hoistable deps. The @octokit/* plugins (nested under
packages/github-api due to the @octokit/core 6/7 split) were missing at runtime,
causing ERR_MODULE_NOT_FOUND for @octokit/plugin-retry in the worker/api. Add
COPY --from=deps /app/packages to runtime-api/worker/migrations so the full
installed tree ships. Verified: worker image resolves github-api/src/index.ts.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage:** all three runtime stages get the COPY (Steps 1–3) ✓; deps/build/runtime-web unchanged ✓; verification builds + runtime import resolution (Steps 5–7) ✓.
- **Placeholders:** none — exact before/after blocks and commands given.
- **Consistency:** the added line is identical across stages; `deps` produces `/app/packages` with nested `node_modules`; the COPY precedes `COPY . .` so source overlays without deleting `node_modules`.
