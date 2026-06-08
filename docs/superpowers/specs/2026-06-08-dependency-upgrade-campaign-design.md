# Dependency Upgrade Campaign — latest stable, all majors

**Date:** 2026-06-08
**Branch:** `chore/deps-latest-stable` (off `master`)
**Status:** Approved design

## Goal

Bring every third-party dependency in the monorepo to its current stable release —
including major-version bumps — making the minimum code changes each major requires.
Internal `@journeyman/*` workspace dependencies, Node, npm, TypeScript, and
`@types/node` are out of scope (already current or not third-party).

## Approach

The breaking surfaces (UI framework, backend server, build tooling, crypto/IO libs)
are largely independent and each needs its own verification, so the work is decomposed
into **6 sequential clusters** rather than a single big-bang upgrade.

- **Branching:** one branch, `chore/deps-latest-stable`, off `master`.
- **Commits:** one commit per cluster (six commits telling the upgrade story).
- **PR:** one PR at the end, reviewed as a whole.
- **Gate between clusters:** `npm run check` **and** `npm test` **and** `npm run build:web`
  must all pass before the next cluster begins.
- **Rollback unit = one cluster.** A cluster that cannot go green is reverted or
  escalated; we never stack a new cluster on a red gate.

### Verification gate (definition of "done" per cluster)

| Command | Catches |
|---|---|
| `npm run check` | Typecheck across all workspaces + import-boundary check |
| `npm test` | Full Vitest suite across the 9 test packages |
| `npm run build:web` | Production bundle (Vite/Tailwind/React breakage) |

Runtime smoke (booting api-server/worker, loading the UI) is **not** part of the gate
by decision. Where a cluster's real risk is runtime or visual (Fastify, Tailwind), this
spec calls it out as residual risk the gate does not cover.

## Target versions (looked up 2026-06-08)

| Package | From | To |
|---|---|---|
| zod | ^3.23.8 | ^4 (installed 4.4.3) |
| pino | ^9 (core) / ^10 (root) | ^10 |
| @opencode-ai/sdk | "latest" | pinned concrete version |
| @octokit/rest | ^21.0.2 | ^22 |
| @octokit/graphql / plugin-retry / plugin-throttling | 8 / 7 / 9 | latest |
| tar | ^6.2.1 | ^7 |
| bcrypt | ^5.1.1 | ^6 |
| jose | ^5.9.6 | ^6 |
| @modelcontextprotocol/sdk | ^1.0.4 | ^1.29 |
| pg / dotenv / esbuild | current | latest |
| fastify | ^4.28.1 | ^5 (5.8.x) |
| @fastify/cors | ^8.5.0 | ^11 |
| @fastify/sensible | ^5.6.0 | ^6 |
| vite | ^5.4.0 | ^8 |
| vitest | ^2.1.9 | ^4 |
| @vitejs/plugin-react | ^4.3.0 | ^6 |
| postcss / autoprefixer | current | latest |
| react / react-dom | ^18.3.1 | ^19 (19.2.x) |
| @types/react / @types/react-dom | ^18.3.0 | ^19 |
| lucide-react | ^0.400.0 | ^1.17 |
| tailwindcss | ^3.4.0 | ^4 (4.3.x) |
| @tailwindcss/typography | ^0.5.15 | latest |
| @tailwindcss/postcss | — | add (new in v4) |

UI peer deps to re-validate against React 19 (bump only if they declare React-18-only
peers): `@xyflow/react` 12, `@tanstack/react-query` 5, `@uiw/react-codemirror` 4,
`react-markdown` 9, `react-router-dom` 7.

## Clusters

### Cluster 0 — Manifest & lockfile hygiene *(foundation, ~no code)*

The manifests and lockfile have drifted: `package.json` pins `zod ^3.23.8` in three
packages, but the installed/locked version is `4.4.3`, and the code is already
zod-4-correct (two-arg `z.record` in `packages/api-server/src/schemas/update-flow.ts`,
`run.ts`, and `packages/steps/src/issues/update-issue-fields.meta.ts`). This cluster
makes the manifests honest before any behavioral change.

- Bump `zod` `^3.23.8 → ^4` in `api-server`, `flow-editor`, `steps`.
- Align `pino`: `core` `^9 → ^10` to match the root `^10`; confirm no v9→v10 API drift
  (minimal).
- Pin `@opencode-ai/sdk: "latest"` in `agent-runtime` to the resolved concrete version.
- `npm install` to reconcile lockfile ↔ manifests.
- **Gate.**

### Cluster 1 — Low-risk backend libs

Isolated API surfaces, one package each.

- `@octokit/rest` 21→22 and the graphql/retry/throttling plugins → latest (`github-api`).
- `tar` 6→7 + `@types/tar` (`sandbox`, `skills`).
- `bcrypt` 5→6 + `@types/bcrypt` (`identity`).
- `jose` 5→6 (`webhooks`).
- `@modelcontextprotocol/sdk` →1.29 (`mcp`).
- `pg`, `dotenv`, `esbuild` → latest.
- **Expected code touches:** `tar` 7 ESM/options surface; Octokit client init; bcrypt
  async signatures. Each confined to its owning package.
- **Gate.**

### Cluster 2 — Fastify 4 → 5

- `fastify` 5, `@fastify/cors` 8→11, `@fastify/sensible` 5→6; `fastify` devDep in
  `identity`.
- **Expected code touches:** route/plugin type changes, `app.listen()` signature,
  error-handler and schema-validation changes. `Fastify()` is instantiated in
  `packages/api-server/src/server.ts:26`; touches that file and all route modules.
- **Residual risk (not in gate):** Fastify plugin runtime errors only surface on boot.
- **Gate.**

### Cluster 3 — Build tooling

Sequenced **before** React/Tailwind so the test runner and bundler are settled before we
change what they compile.

- `vite` 5→8, `vitest` 2→4, `@vitejs/plugin-react` 4→6, `postcss`/`autoprefixer` latest.
- **Expected code touches:** `vite.config` API changes; Vitest 4 config/API changes
  across the 9 test packages.
- **Note:** the test runner itself changes here — clusters 0–2 run their gates on
  Vitest 2, clusters 3–5 on Vitest 4.
- **Gate** (where `npm test` and `build:web` carry the most weight).

### Cluster 4 — React 18 → 19

- `react`/`react-dom` 18→19; `@types/react`/`@types/react-dom` 18→19 across the UI
  packages (`web`, `flow-editor`, `run-viewer`, `runs-list`, `theme`, and the `steps`
  devDep).
- **Expected code touches:** `@types/react` 19 removes implicit `children` and tightens
  `ref`/JSX types — most churn is type-level fallout surfaced by `npm run check`.
- Re-validate UI peer deps (list above) against React 19; bump any with React-18-only
  peers. Fallback: pin a lib and document the constraint rather than block the campaign.
- `lucide-react` 0.400 → 1.17 rides here — a 1.0 release with likely icon renames/
  removals; grep icon import sites and fix any dropped names.
- Entrypoint is already `createRoot` (`packages/web/src/main.tsx:19`) — no render-API
  migration.
- **Gate.**

### Cluster 5 — Tailwind 3 → 4 *(hardest, last)*

- `tailwindcss` 3→4, `@tailwindcss/typography` latest, add `@tailwindcss/postcss`.
- **Migrations, in order:**
  1. `packages/web/postcss.config.js`: `tailwindcss` plugin → `@tailwindcss/postcss`.
  2. `packages/web/src/styles.css`: `@tailwind base/components/utilities` →
     `@import "tailwindcss"`.
  3. Migrate the shared `@journeyman/theme/tailwind-preset` (consumed via `presets:` in
     `packages/web/tailwind.config.js`) — either to a CSS-first `@theme` block, or keep
     the JS config alive via the `@config` directive as a fallback.
  4. Run `npx @tailwindcss/upgrade` codemod, then manually reconcile renamed/removed
     utilities across `web`, `flow-editor`, `run-viewer`, `runs-list` class usages.
- **Residual risk (not in gate):** regression here is primarily *visual*, and the gate is
  build-only. `build:web` passing proves it **compiles**, not that it **looks right**. A
  manual visual pass is recommended but out of gate.
- **Gate.**

## Cross-cutting risks & decisions

- **Vitest 4 mid-campaign:** cluster 3 changes the runner; gates run on Vitest 2 before,
  Vitest 4 after. Acceptable given sequencing.
- **Peer-dep conflicts:** React 19 (cluster 4) is the likeliest source. If a transitive
  UI lib has no React-19-compatible release, pin it and document rather than block.
- **Tailwind visual drift** (cluster 5) is the one regression class the build-only gate
  cannot catch — explicit residual risk.
- **Rollback unit = one cluster** (one commit); a bad cluster reverts without touching
  others.

## Out of scope

- `@journeyman/*` workspace deps (internal, `*`-versioned).
- Node, npm, TypeScript, `@types/node` (already current).
- Any non-upgrade refactor or unrelated cleanup.
