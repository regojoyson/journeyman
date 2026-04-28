# Run Scopes (User / Org / Platform-Admin) — Design Spec

**Date:** 2026-04-28
**Status:** Approved (brainstorming complete, awaiting implementation plan)
**Builds on:** [2026-04-28-flow-scopes-design.md](2026-04-28-flow-scopes-design.md)

## Summary

Run visibility today is unscoped — `GET /runs` returns every run in the store. This spec scopes runs to three tiers: a user sees their own runs, org members see runs anyone in their org started, and platform admins see everything. The model mirrors the flow-scopes design exactly: visibility is expressed via a separate `jm_run_grants` table (not columns on `jm_runs`), so future capabilities (per-peer sharing, "private" runs, team-scoped runs, ad-hoc public runs) become inserts/deletes rather than schema migrations.

A run is always **started by exactly one user**. "Org-level visibility" means org peers can read it; org admins can also act on it (cancel/retry/rerun/fork). Platform admins bypass grants entirely.

## Goals

- A user listing runs sees their own runs by default.
- A user can list runs across their org.
- A platform admin can list every run system-wide.
- Org peers get read-only access to each other's runs; org admins get full control.
- Keep run→identity coupling loose so future run-sharing capabilities don't require migrations.
- Reuse the same matcher / role hierarchy as `jm_flow_grants` so one permission utility serves both.

## Non-goals

- A UI for sharing a single run with a specific peer (the table supports it; no UI ships now).
- An admin "moderation" page for runs. Platform admins use `?scope=all`; org admins use `?scope=org`.
- Cross-org run visibility.
- Historical org membership tracking. The org snapshotted into the grant is the user's org **at run-start**.
- A new `editor` role for runs. Only `owner` (starter) and `viewer` (org peer) grants are minted; `editor` is reserved schema-wise to keep the matcher identical to flows.

## Design decisions (from brainstorming)

| # | Decision |
|---|---|
| Q1 | Hybrid visibility model. "Mine" = runs I started; "Org" = every run started by a member of my org; "All" = platform-admin only. |
| Q2 | Snapshot pattern continues to come from flow-scopes (`flow_scope_snapshot`, `flow_name_snapshot`, `definition_snapshot` already on `jm_runs`). No new snapshot columns on `jm_runs`. |
| Q3 | Visibility lives in a **separate `jm_run_grants` table**, not on the run row. Same architectural rule as `jm_flow_grants`. |
| Q4 | Role-split control: org peers = view-only; org admins = full control on org runs; platform admins = full control everywhere. |

## Data model

### `jm_run_grants` (new)

```
id              UUID PK
run_id          UUID NOT NULL REFERENCES jm_runs(id) ON DELETE CASCADE
principal_type  TEXT NOT NULL CHECK (principal_type IN ('user','org','global'))
principal_id    UUID NULL
role            TEXT NOT NULL CHECK (role IN ('owner','editor','viewer'))
created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
created_by      UUID NULL REFERENCES jm_users(id)

CHECK (
  (principal_type = 'global' AND principal_id IS NULL) OR
  (principal_type IN ('user','org') AND principal_id IS NOT NULL)
)
UNIQUE (run_id, principal_type, principal_id)
```

Indexes:

```sql
CREATE INDEX jm_run_grants_principal ON jm_run_grants (principal_type, principal_id);
CREATE INDEX jm_run_grants_run       ON jm_run_grants (run_id);
```

A run **must have at least one `role='owner'` grant** at all times (enforced in application code; deletion of the last owner grant is rejected unless the run itself is being deleted).

### `jm_runs`

No column changes. `started_by_user_id` is unchanged and remains audit-only — visibility is computed from `jm_run_grants` alone. The flow-scopes spec already added `flow_scope_snapshot`, `flow_name_snapshot`, and `definition_snapshot`; the runs list UI reuses those for badges.

### TypeScript types (`packages/core/src/types/run.types.ts`)

```ts
export type RunGrantPrincipalType = "user" | "org" | "global";
export type RunGrantRole = "owner" | "editor" | "viewer";

export interface RunGrant {
  id: string;
  runId: string;
  principalType: RunGrantPrincipalType;
  principalId: string | null;
  role: RunGrantRole;
  createdAt: Date;
  createdBy: string | null;
}

export interface Run {
  // ...existing fields unchanged
  effectiveRole?: RunGrantRole; // hydrated by the API layer for the calling actor
  grants?: RunGrant[];          // included on detail responses for owner/admin
}
```

## Permission model

A caller's effective role on a run is the **highest role across all grants whose principal matches the caller**, where match means:

- `('user', U, role)` matches iff `caller.userId == U`.
- `('org', O, role)` matches iff caller is a member of org `O`.
- `('global', NULL, role)` matches every authenticated caller.

Role hierarchy: `viewer < editor < owner`.

Two elevation rules layered on top of grant evaluation (identical in shape to flow-scopes):

- **Platform admins** (`is_platform_admin = TRUE`) → effective `owner` on every run, bypassing grants entirely.
- **Org admins of org `O`** → effective `owner` on any run with an `('org', O, *)` grant.

### Grants written at run-start

When the orchestrator creates a run, it inserts grants in the same transaction:

1. `('user', startedByUserId, 'owner')` — always.
2. `('org', startedByOrgId, 'viewer')` — only when the starter belongs to an org at run-start.

No `global` grants are minted. Running a global *flow* never makes the *run* world-visible.

If a run is started without an org context (API-token user with no org, or a future ad-hoc run), only grant #1 is written; the run is visible to its starter and platform admins only.

### Effective permission matrix

| Action | Required role | Starter | Org peer | Org admin | Platform admin |
|---|---|---|---|---|---|
| Listed in `GET /runs` | viewer | ✓ | ✓ | ✓ | ✓ (all runs) |
| `GET /runs/:id`, `/events`, `/export` | viewer | ✓ | ✓ | ✓ | ✓ |
| `cancel` / `pause` / `resume` | owner | ✓ | ✗ | ✓ | ✓ |
| `retry-step` / `rerun` / `fork` | owner | ✓ | ✗ | ✓ | ✓ |

Permission denials respond `404`, not `403`, to avoid leaking run existence.

## API surface

All routes already exist in [packages/api-server/src/routes/runs.ts](../../packages/api-server/src/routes/runs.ts). The change is auth-shaping, not new endpoints.

### List

```
GET /runs                              → all runs caller has effective viewer or higher
GET /runs?scope=mine                   → caller has effective owner (starter or admin)
GET /runs?scope=org                    → matched via ('org', caller.orgId, *) grant
GET /runs?scope=all                    → platform-admin only; every run system-wide (403 otherwise)
GET /runs?flow_id=…&status=…&limit=…   → existing filters, composable with scope
```

Default (no `scope`) returns the union — everything the caller can see. The web UI uses explicit chips and never relies on the default.

`RunStore.list()` gains an `actor: { userId, orgId, isPlatformAdmin }` argument plus an optional `scope`. Implementation joins `jm_runs` with `jm_run_grants` using the matcher predicate (or skips the join entirely when `isPlatformAdmin && scope==='all'`). One `DISTINCT` query per request.

### Detail / events / export

```
GET /runs/:id           → requires effective viewer
GET /runs/:id/events    → requires effective viewer
GET /runs/:id/export    → requires effective viewer
```

A new `requireRunRole('viewer')` preHandler runs after `requireAuth()`. 404 on deny.

### Action endpoints

```
POST /runs/:id/cancel        → requires effective owner
POST /runs/:id/pause         → requires effective owner
POST /runs/:id/resume        → requires effective owner
POST /runs/:id/retry-step    → requires effective owner
POST /runs/:id/rerun         → requires effective owner
POST /runs/:id/fork          → requires effective owner
```

Gated by `requireRunRole('owner')`. 404 on deny.

### Grants management

**No HTTP endpoints in this version.** Run grants are written exclusively by the orchestrator at run-start. The table exists so future sharing features can be added without API redesign.

### Response shape

`Run` JSON gains a hydrated `effectiveRole: 'owner' | 'viewer'` field so the web UI can render row actions without re-running the matcher client-side. No other field changes.

## UI surface (`packages/web` + `packages/runs-list`)

### Runs list page

- **Scope filter chips** at the top of [packages/runs-list/src/RunsList.tsx](../../packages/runs-list/src/RunsList.tsx) — `Mine` / `Organization` / `All`.
  - Default: `Mine`.
  - `Mine` is always visible.
  - `Organization` shown only when the caller has an `orgId`.
  - `All` shown only when `isPlatformAdmin`.
- Each row gains:
  - A **scope badge** sourced from `flowScopeSnapshot` (User / Org / Global).
  - A **starter** column (`startedByUserId` resolved to display name) — visible in `Organization` and `All`, hidden in `Mine`.
- Row actions (cancel / retry / rerun / fork) render only when `effectiveRole === 'owner'`. For `viewer` rows, only the row link to the detail page is active.

### Run detail page

When `effectiveRole === 'viewer'`, render the detail/timeline read-only with a banner: *"You're viewing this run as an org peer. Only the run's owner or an org admin can pause, retry, or cancel."*

### Admin moderation page

Not added. Platform admins use `?scope=all`; org admins use `?scope=org`. A dedicated `AdminRunsPage` slots in next to `AdminFlowsPage` later if needed, with no schema work.

### Auth context

`AuthContext` already exposes `userId` / `orgId` / `isPlatformAdmin` from the JWT (added in flow-scopes). The runs list reads these directly to decide which chips to render.

## Migration

`packages/migrations/src/sql/005_run_grants.sql` (sequential after `004_flow_scopes.sql`):

1. **Create `jm_run_grants`** — table + indexes from above.
2. **Pre-flight guard** — fail the migration if `jm_run_grants` already has rows.
3. **Backfill from existing runs.** For every row in `jm_runs`:
   - `INSERT ('user', started_by_user_id, 'owner')` whenever `started_by_user_id IS NOT NULL`.
   - `INSERT ('org', <starter's current primary org>, 'viewer')` when the starter is currently a member of an org. Best-effort: uses current membership, since no membership-history table exists.
   - Runs with `started_by_user_id IS NULL` get no grants (visible only to platform admins). Logged, not failed.
4. **No column changes** to `jm_runs`.

## Orchestrator changes

Run-start in [packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts](../../packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts) wraps the existing run insert and the new grant inserts in one transaction. If the user has no org at run-start, only the user grant is written.

A new `RunGrantsStore` interface in `@journeyman/core`:

```ts
export interface RunGrantsStore {
  createForRun(runId: string, grants: Omit<RunGrant, "id" | "createdAt">[]): Promise<RunGrant[]>;
  listForRun(runId: string): Promise<RunGrant[]>;
  // matchForActor returns the highest effective role for a given actor across one or many runs
  matchForActor(actor: ActorContext, runIds: string[]): Promise<Map<string, RunGrantRole>>;
}
```

Two implementations, mirroring `FlowGrantsStore`:
- `packages/orchestrator/src/stores/memory/memory-run-grants-store.ts`
- `packages/orchestrator/src/stores/postgres/postgres-run-grants-store.ts`

The matcher is shared utility code (it's identical for flows and runs); both stores call into it.

## Future work enabled by this design

- **Share a single run with a specific peer**: `INSERT ('user', X, 'viewer')`.
- **Mark a run "private from org admins"**: delete the `('org', …, 'viewer')` grant after run-start; only the starter and platform admins remain.
- **Team-scoped runs** once teams exist: extend `principal_type` to include `'team'`.
- **Public demo runs**: `INSERT ('global', NULL, 'viewer')`.
- **Co-owned runs** (multiple `owner` grants): permitted by the schema today; lift the application-level constraint when needed.

None require further migrations beyond `005_run_grants.sql`.
