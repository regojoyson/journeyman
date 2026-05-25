# UI / API / Worker / Shared Split — Design

**Goal:** evolve the monorepo so it can be built and deployed as four cleanly-separated units (UI, API, Worker, Shared libraries), with import boundaries enforced automatically. Make the existing 3-layer convention real, validated, and extensible to true independent deployment.

## Motivation

The current `check-import-boundaries.mjs` script reports a clean tree, but the check has gaps:

- Five packages (`coding-models`, `custom-steps`, `mcp`, `skills`, `theme`) are not classified, so the script silently skips them in both directions.
- `@journeyman/identity` is labeled `shared` but depends on `bcrypt`, `pg`, and `fastify` — node-only runtime deps that would poison any UI bundle that imported it.
- `mcp`, `custom-steps`, and `skills` each mix server code (Fastify routes, `pg`, `@journeyman/secrets/db`) with pure adapters or types, but have no subpath overrides distinguishing the two halves.
- `api-server` imports `@journeyman/orchestrator` directly, which means the API process drags in the entire worker codebase (Conductor harness, step runners, coding-cli, providers).
- The boundary checker has only three layers: `ui`, `backend`, `shared`. "Backend" lumps API and Worker together, so there is nothing preventing API↔Worker cross-imports.

The result is that the codebase happens to compile into independent services today, but enforcement is leaky. A regression that fuses API and Worker, or that pulls server-only code into the UI bundle, would not be caught.

## Standards we are aligning to

This split follows conventions established by widely-used public monorepos:

- **`apps/` for deployables, `packages/` for libraries** — the Nx / Turborepo / Cal.com / Documenso / Plane convention.
- **One pure-types shared package** with `"sideEffects": false` — n8n's `packages/workflow`, Backstage's plugin type packages.
- **Subpath exports for cross-layer packages** (Node.js `"exports"` field with `./client`, `./server`, `./types`) — the Backstage pattern for plugins that have both server-only and browser-safe slices.
- **Layer declared in each `package.json`** rather than a hardcoded list — the Nx tag pattern (`scope:shared`, `scope:api`, …) adapted to a `journeyman.layer` field.
- **Enforcement via a real dependency analyzer** (`dependency-cruiser` or ESLint `no-restricted-imports`) instead of a regex script, so dynamic imports, `require`, and type-only imports are handled correctly.
- **Closest real analog:** n8n's `cli` / `core` / `workflow` / `editor-ui` layout. Worth studying before final commit, since n8n runs API and Worker from the same `cli` codebase in different modes; we may want that operational simplicity rather than two separate Docker images.

## Target layout

```
journeyman/
├── apps/
│   ├── web/                       (was packages/web)
│   ├── api/                       (was packages/api-server, renamed)
│   ├── worker/                    (new — wraps orchestrator worker harness)
│   └── migrations/                (was packages/migrations, CLI entry)
└── packages/
    ├── core/                      shared    (already correct)
    ├── theme/                     ui-shared
    ├── flow-editor/               ui
    ├── run-viewer/                ui
    ├── runs-list/                 ui
    ├── steps/                     ui (with /catalog as shared)
    ├── coding-cli/                worker
    ├── git-provider/              worker
    ├── ticket-provider/           worker
    ├── notification-provider/     worker
    ├── github-api/                worker
    ├── webhooks/                  api
    ├── coding-models/             server-shared (api + worker)
    ├── secrets/                   server-shared
    ├── identity-types/            shared    (new — JWT shape, role enums)
    ├── identity-server/           server-shared    (split from identity)
    ├── mcp/                       server-shared, with /types and /sdk-adapter as shared
    ├── custom-steps/              server-shared, with /shape-adapter and /types as shared
    ├── skills/                    server-shared, with /types as shared
    ├── orchestrator-client/       server-shared    (new — submit, status, types)
    └── orchestrator-worker/       worker    (was orchestrator, renamed)
```

### Layer rules

| From / To  | shared | ui-shared | ui  | server-shared | api | worker |
|------------|--------|-----------|-----|---------------|-----|--------|
| **shared** | ✓      | ✗         | ✗   | ✗             | ✗   | ✗      |
| **ui-shared** | ✓   | ✓         | ✗   | ✗             | ✗   | ✗      |
| **ui**     | ✓      | ✓         | ✓   | ✗             | ✗   | ✗      |
| **server-shared** | ✓ | ✗      | ✗   | ✓             | ✗   | ✗      |
| **api**    | ✓      | ✗         | ✗   | ✓             | ✓   | ✗      |
| **worker** | ✓      | ✗         | ✗   | ✓             | ✗   | ✓      |

Key invariants:
- UI never imports server code, directly or transitively.
- API never imports Worker, and vice versa. They communicate only through `orchestrator-client` (which both treat as a typed SDK).
- `shared` is fully isomorphic (no `node:*`, no `pg`, no `fastify`, no `bcrypt`, no React).
- `server-shared` may use node-only deps but no UI deps and no API/Worker-specific deps.

## The hard parts (what actually requires code surgery)

### 1. Split `@journeyman/orchestrator`

Today `api-server` imports `@journeyman/orchestrator` for what is effectively a client SDK (submit a flow, fetch run status, cancel). It transitively pulls in the worker harness, step runners, Conductor adapter, and every provider package.

Split into:

- **`@journeyman/orchestrator-client`** (`server-shared`): submit, status, cancel, run/instance types. No Conductor SDK, no step execution. This is what `api` imports.
- **`@journeyman/orchestrator-worker`** (`worker`): Conductor worker harness, durable execution loop, step runners, MCP/skills runtime wiring, all the existing `engines/conductor/*` code. This is what `apps/worker` imports.

Both depend on `@journeyman/core` for shared types. Neither imports the other.

### 2. Split `@journeyman/identity`

Today `identity` is labeled `shared` but has `bcrypt`, `pg`, `fastify` deps. Split into:

- **`@journeyman/identity-types`** (`shared`): JWT payload types, role/permission enums, pure verification helpers (using `jose`, browser-safe). Importable from anywhere.
- **`@journeyman/identity-server`** (`server-shared`): `makeRequireAuth` Fastify plugin, bcrypt hashing, user/org CRUD against pg. Imported by `api` and `worker` (worker needs `requireAuth` for its admin endpoints).

### 3. Carve subpath exports for `mcp`, `custom-steps`, `skills`

Each of these packages has a UI-facing slice (types, shape adapters, SDK adapters) and a server slice (Fastify routes, db, secret resolution). Today they are a single blob. After:

- `@journeyman/mcp/types` → `shared`
- `@journeyman/mcp/sdk-adapter` → `shared` (already named this in CLAUDE.md, finally enforce it)
- `@journeyman/mcp` (root) → `server-shared` (routes, registry, resolver)
- Same shape for `custom-steps` (`/types`, `/shape-adapter` shared; root server-shared) and `skills` (`/types` shared; root server-shared).

The Node.js `"exports"` field gets a `"node"` condition on the server subpaths so bundlers refuse to resolve them in browser builds — Backstage-style.

### 4. Move deployables to `apps/`

`web`, `api-server` → `api`, new `worker` entry, `migrations`. Update workspace globs, tsconfig paths, Docker contexts, and the `start:*` scripts in the root `package.json`.

## Enforcement

Replace the regex script with one of:

- **`dependency-cruiser`** (recommended): declarative `.dependency-cruiser.cjs` config with layer rules. Handles `require`, dynamic `import()`, type-only imports, and subpath-aware classification natively. CI command: `npx depcruise --config .dependency-cruiser.cjs packages apps`.
- **ESLint `no-restricted-imports`** driven by per-package `journeyman.layer` fields. Lower-impact change but each package needs its own ESLint config to express "I am layer X, my allowed targets are Y/Z."

Either way, the boundary table above is the source of truth. Each `package.json` declares its layer:

```json
{
  "name": "@journeyman/mcp",
  "journeyman": { "layer": "server-shared" },
  "exports": {
    ".": "./src/index.ts",
    "./types": "./src/types/index.ts",
    "./sdk-adapter": "./src/sdk-adapter.ts"
  }
}
```

A new package with no `journeyman.layer` field fails CI immediately — no more silent skips.

## What this gets us

- `docker build -f apps/api/Dockerfile` and `docker build -f apps/worker/Dockerfile` produce two slim images with no overlap. The API image no longer ships `coding-cli`, Conductor worker code, or provider implementations.
- Regression-proof: a future PR that imports `coding-cli` from `api`, or imports `orchestrator-worker` from anywhere except `apps/worker`, fails CI.
- Future split into separate repos becomes a publish operation, not a refactor — the subpath exports are already the API contract.

## Decision: one Docker image with mode flags, or two images?

n8n runs API and Worker from the same `cli` package in different modes (`n8n start` vs `n8n worker`). This is operationally simpler (one image to build, one to version) but the resulting image contains worker code in the API process and vice versa, just unused. Conductor users and Temporal users typically split into two images for size and blast-radius reasons.

This spec assumes **two images** (`apps/api` and `apps/worker` as separate deployables), since the goal stated was independent deployment. If we want the n8n model instead, `apps/api` and `apps/worker` collapse into a single `apps/server` with two entry scripts; the package-level split (orchestrator-client vs -worker, etc.) is identical either way.

## Effort estimate

- **Tier 1 — relabel + add missing packages + 4-layer grid + tag-based config:** ~half a day. Mechanical.
- **Tier 2 — `orchestrator` split:** 1–2 days. The real refactor. Identify exactly what `api-server` calls today, extract that surface into `orchestrator-client`.
- **Tier 2 — `identity` split:** ~half a day.
- **Tier 2 — `mcp` / `custom-steps` / `skills` subpath splits:** 1–2 days total. Each is small but they all touch routes + db + types.
- **Tier 2 — `apps/` move:** ~half a day. Mostly workspace config and Docker.
- **Tier 3 — replace regex script with `dependency-cruiser`:** ~half a day.
- **Tier 3 — Docker / deploy story for two images:** 1 day if not already in place.

Total: **4–6 focused days** for a fully enforced 4-way split.

## Out of scope

- Splitting the repo into multiple git repos.
- Changing the runtime architecture (Conductor stays; queue topology stays).
- Rewriting any provider or step.
- Frontend bundler changes beyond what subpath exports require.

## Phased rollout

The spec is large but each tier is independently shippable:

1. **Phase 1 (boundary hygiene):** Tier 1 only. Classify all packages, 4-layer grid, swap to `dependency-cruiser`. Codebase compiles unchanged; CI now catches regressions.
2. **Phase 2 (subpath splits):** Carve `identity`, `mcp`, `custom-steps`, `skills` into shared+server halves. No behavior change.
3. **Phase 3 (orchestrator split):** Extract `orchestrator-client`. `api-server` switches its import.
4. **Phase 4 (apps/ move + Docker):** Move deployables, build two images, deploy.

Each phase can be merged on its own. Phases 2 and 3 unlock the meaningful image-size reduction; Phase 1 alone unlocks enforcement.
