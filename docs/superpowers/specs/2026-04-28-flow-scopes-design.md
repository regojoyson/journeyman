# Flow Scopes (User / Org / Global) — Design Spec

**Date:** 2026-04-28
**Status:** Approved (brainstorming complete, awaiting implementation plan)

## Summary

Today, every flow is owned by exactly one user (`Flow.ownerUserId`). This spec introduces three logical scopes for flows — **user**, **org**, and **global** — modeled as a templates-and-cloning system: org admins curate org-wide templates, platform admins curate built-in global templates, and users either run those templates as-is or **clone them down** to their own user-scope flow to customize. Cloning is a one-way snapshot — there is no link, inheritance, or live update between source and clone.

Two architectural choices keep the system loosely coupled:

1. **Flow ownership is expressed via a separate `jm_flow_grants` table**, not hard-coded columns on the flow row. "Scope" is a derived property of a flow's grants. This lets ownership move, scope change, and sharing patterns evolve without schema migrations.
2. **Runs snapshot the version definition into the run record itself.** A run is a fully self-contained artifact; flows/versions can be deleted, renamed, or reassigned without breaking run history.

A new `is_platform_admin` flag on users authorizes management of global flows.

## Goals

- Let org admins publish standardized flows for their org.
- Let platform operators ship built-in flows visible to every org.
- Let any user start from a template and customize it without affecting the template.
- Reuse the existing flow versioning model unchanged.
- Keep flow→owner and run→flow couplings loose so future capabilities (reassign owner, share with another org, prune flows without losing runs, ad-hoc runs from imported JSON) don't require schema migrations.

## Non-goals

- Live template references / inheritance / overrides. Clone is a clean break.
- Cross-org sharing UI in this version. The grants table makes it cheap to add later, but no UI/API for it ships now.
- User-initiated "submit for promotion" workflow. Promotion is an admin action.
- Per-flow per-user ACLs within a scope. All org members see all org flows.
- Renaming "scope" to something else in the UI. Users still see `User` / `Org` / `Global`.

## Design decisions (from brainstorming)

| # | Decision |
|---|---|
| Q1 | Three scopes serve the **templates-and-inheritance** purpose. |
| Q2 | Clone = **snapshot copy**. No `templateId`, no live link, no overrides. |
| Q3 | **Strict ladder + admin promote.** Author at one's own scope; admins promote a flow they can see one tier up via a snapshot copy. |
| Q4 | Superadmin = **`is_platform_admin` boolean on the user record**, independent of org membership. |
| Decoupling A | **Grants table** instead of `scope`/`org_id`/`owner_user_id` columns on `jm_flows`. |
| Decoupling B | **Runs snapshot the definition** into the run record; `flow_id`/`flow_version_id` become advisory. |

## Data model

### `jm_users`

Add column:

```
is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE
```

A platform admin may or may not be a member of any org.

### `jm_flows` (simplified)

Drop direct ownership columns. The flow row carries only the flow's identity and pointer to its current version.

```
id                    UUID PK
name                  TEXT NOT NULL
description           TEXT NULL
current_version_id    UUID NULL  REFERENCES jm_flow_versions(id)
created_by_user_id    UUID NULL  REFERENCES jm_users(id)   -- audit only
created_at            TIMESTAMPTZ NOT NULL
updated_at            TIMESTAMPTZ NOT NULL
```

Note: `owner_user_id` is removed. `created_by_user_id` is purely audit metadata; it does not confer permissions.

Uniqueness on `name` is enforced **per-grant**, not on the flow row (see grants table below).

### `jm_flow_grants` (new)

```
id              UUID PK
flow_id         UUID NOT NULL REFERENCES jm_flows(id) ON DELETE CASCADE
principal_type  TEXT NOT NULL CHECK (principal_type IN ('user','org','global'))
principal_id    UUID NULL              -- user_id when 'user', org_id when 'org', NULL when 'global'
role            TEXT NOT NULL CHECK (role IN ('owner','editor','viewer'))
created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
created_by      UUID NULL REFERENCES jm_users(id)

CHECK (
  (principal_type = 'global' AND principal_id IS NULL) OR
  (principal_type IN ('user','org') AND principal_id IS NOT NULL)
)
UNIQUE (flow_id, principal_type, principal_id)   -- one grant per (flow, principal)
```

A grant attaches a flow to a principal at a role. **Every flow MUST have at least one `role='owner'` grant** (enforced in application code; deletion of the last owner grant is rejected unless the flow itself is being deleted).

For this version, every flow has **exactly one owner grant**. The schema permits multiple owners (future capability) but the API forbids it.

### Derived "scope" of a flow

The UI/API surface still talks about scopes. A flow's scope is derived from its **owner grant**:

| Owner grant | Derived scope |
|---|---|
| `principal_type='user'` | `user` |
| `principal_type='org'` | `org` |
| `principal_type='global'` | `global` |

The derivation is stable as long as a flow has exactly one owner grant — true in this version.

### `jm_flow_versions`

Unchanged. A flow has its own version history keyed by `flow_id`. Cloning/promotion creates a new flow at v1; version history is **not** copied.

### `jm_runs` (decoupling B)

Modify existing run table (or run record — the run package owns this; the spec assumes a `jm_runs` table exists with a definition reference today):

```
flow_id              UUID NULL  REFERENCES jm_flows(id) ON DELETE SET NULL
flow_version_id      UUID NULL  REFERENCES jm_flow_versions(id) ON DELETE SET NULL
flow_name_snapshot   TEXT NOT NULL                      -- denormalized at run-start
flow_scope_snapshot  TEXT NOT NULL                      -- 'user'|'org'|'global' at run-start
definition_snapshot  JSONB NOT NULL                     -- full FlowGraph at run-start
```

`flow_id` / `flow_version_id` are advisory — they tell you "where this run came from" and may go NULL if the source is deleted. The orchestrator reads `definition_snapshot` exclusively when executing or replaying. Run history survives any change to the source flow.

### TypeScript types (`packages/core/src/types/flow.types.ts`)

```ts
export type FlowScope = "user" | "org" | "global";
export type FlowGrantPrincipalType = FlowScope;
export type FlowGrantRole = "owner" | "editor" | "viewer";

export interface FlowGrant {
  id: string;
  flowId: string;
  principalType: FlowGrantPrincipalType;
  principalId: string | null;
  role: FlowGrantRole;
  createdAt: Date;
  createdBy: string | null;
}

export interface Flow {
  id: string;
  name: string;
  description: string | null;
  currentVersionId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  // Hydrated by the API layer:
  scope: FlowScope;        // derived from owner grant
  orgId: string | null;    // owner-grant principal_id when scope='org'/'user'
  ownerUserId: string | null; // owner-grant principal_id when scope='user'
  grants?: FlowGrant[];    // included on detail responses
}
```

`FlowVersion` unchanged.

### `packages/core/src/types/identity.types.ts`

Add `isPlatformAdmin: boolean` to `UserRecord`. JWT access token claims gain an `isPlatformAdmin` boolean (additive; missing claim defaults to `false`).

## Permission model

A caller's effective access to a flow is the **highest role across all grants whose principal matches the caller**, where match means:

- Grant `('user', U, role)` matches caller iff `caller.userId == U`.
- Grant `('org', O, role)` matches caller iff caller has a membership in org `O`.
- Grant `('global', NULL, role)` matches every authenticated caller.

Role hierarchy: `viewer < editor < owner`.

**Platform admins** (`is_platform_admin = TRUE`) bypass grant evaluation and have effective `owner` on every flow.

**Org admins** additionally have effective `owner` on every flow with an `('org', theirOrgId, *)` grant — even if their personal grants would only give viewer.

**Org admins also see user-scope flows in their own org** (effective `viewer`) for moderation/promote. Implemented by extending the matcher: a `('user', U, role)` grant additionally matches any org admin of an org `U` is a member of, but at most at `viewer` role.

### Effective permission matrix (derived from grant rules)

| Action | Required effective role | User flow | Org flow | Global flow |
|---|---|---|---|---|
| List / discover | viewer | owner only | members of that org | every authenticated user |
| Read / run | viewer | owner only | members of that org | every authenticated user |
| Edit / new version | editor | owner only | org admins | platform admins |
| Delete | owner | owner only | org admins | platform admins |
| Clone (→ user-scope) | viewer on source | n/a | any member of that org | any authenticated user |
| Promote (→ org-scope) | viewer on source + org admin of target org | org admin of source's org | n/a | n/a |
| Promote (→ global) | viewer on source + platform admin | platform admin | platform admin | n/a |

The matrix is the same the strict ladder produced; it's just now derived from grants instead of CHECK constraints.

### Authoring rules (who can create a flow with a given owner grant)

- `('user', self, 'owner')` — any authenticated user.
- `('org', O, 'owner')` — caller must be admin of org `O`.
- `('global', NULL, 'owner')` — caller must be platform admin.

## API surface

All routes mounted under the existing api-server. Auth middleware injects `userId`, `orgId`, `role`, `isPlatformAdmin` (existing single-org-per-session model preserved).

### List

```
GET /flows                              → all flows where caller has effective viewer or higher
GET /flows?scope=user|org|global        → filter by derived scope
GET /flows?scope=user&orgId=:id         → moderation view (org admin or platform admin)
GET /flows?scope=org                    → cross-org listing (platform admin only)
```

The list query joins `jm_flows` with `jm_flow_grants` using the matcher rules and returns one row per flow (DISTINCT).

### CRUD

```
POST   /flows                  body: { scope, name, description?, definition, orgId? }
GET    /flows/:id              returns flow + grants[]
PATCH  /flows/:id              metadata only (name, description) — scope/grants immutable here
DELETE /flows/:id              cascades grants and versions

POST   /flows/:id/versions     body: { definition }   bumps current_version_id
GET    /flows/:id/versions
GET    /flows/:id/versions/:versionId
```

`POST /flows` semantics:
- `scope=user` → server creates owner grant `('user', caller.userId, 'owner')`.
- `scope=org` → caller must be admin of `orgId` (defaults to caller's primary org); creates `('org', orgId, 'owner')`.
- `scope=global` → caller must be platform admin; creates `('global', NULL, 'owner')`.

The flow's `created_by_user_id` is always set to the caller (audit only).

### Snapshot actions

```
POST /flows/:id/clone
  body: { name? }
  effect:
    - create new jm_flows row
    - create new jm_flow_versions v1 with copy of source.current_version_id.definition
    - create owner grant ('user', caller.userId, 'owner')
  authz: caller has effective viewer or higher on source
  result: { id: <new-flow-id> }

POST /flows/:id/promote
  body: { targetScope: "org" | "global", orgId?, name? }
  effect:
    - create new jm_flows row
    - create new jm_flow_versions v1 with copy of source.current_version_id.definition
    - create owner grant ('org', orgId, 'owner') or ('global', NULL, 'owner')
  authz:
    - viewer or higher on source, AND
    - targetScope=org   → caller is admin of target orgId (defaults to source's org)
    - targetScope=global → caller is platform admin
  result: { id: <new-flow-id> }
```

Both create a fully independent flow at v1. No `templateId`/lineage column.

### Grants management

A minimal endpoint, scoped to support future sharing without committing to a UI now:

```
GET    /flows/:id/grants                            → owner role required
POST   /flows/:id/grants                            → owner role required (forbid duplicate owner grants in this version)
DELETE /flows/:id/grants/:grantId                   → owner role required (cannot delete last owner grant)
```

In this version, the only grants ever created are owner grants via flow create / clone / promote. The endpoints exist so future sharing features can be added without API redesign; the UI does not yet expose them.

### Platform-admin endpoints

```
GET   /admin/users/:id/platform-admin
PATCH /admin/users/:id/platform-admin   body: { value: boolean }
```

Both gated by `isPlatformAdmin`. A platform admin cannot remove their own flag if they would be the last platform admin.

## Run resolution

When a run is started:

1. The orchestrator resolves the source flow + version (must exist at run-start).
2. It writes `flow_id`, `flow_version_id`, `flow_name_snapshot`, `flow_scope_snapshot`, and `definition_snapshot` onto the run row.
3. From that moment, the run is **self-contained**. Subsequent edits, deletes, or grant changes on the source flow do not affect the run.

Replay reads `definition_snapshot` only. The run viewer surfaces the snapshotted scope as a badge; the live `flow_id`/`flow_version_id` are shown only as "source flow" links that may be broken.

## UI surface (`packages/web`)

### Flow list page

- **Scope filter chips**: `Mine` / `Organization` / `Global` / `All`. Default `All`. (`Mine` = derived scope `user` and caller is owner.)
- Each row carries a derived `scope` badge.
- **New flow** button is a dropdown:
  - `New personal flow` — always shown.
  - `New org flow` — shown to org admins.
  - `New global flow` — shown to platform admins.
- **Row actions**:
  - Editable: `Edit` (primary), `Clone`, `Delete`, plus `Promote → Org` / `Promote → Global` where applicable.
  - Read-only for caller: `Clone to my flows` (primary), `Open (read-only)`.

### Flow editor

When opening a flow the caller cannot edit (effective role `< editor`), render the editor read-only with a banner: *"This is a {scope} template. Clone it to make changes."* The CTA invokes `POST /flows/:id/clone`.

### Admin flow moderation page

New `AdminFlowsPage` (mirrors `AdminUsersPage` / `AdminSecretsPage` already present):

- Org admins see all user-scope flows in their org with `Promote to Org`.
- Platform admins additionally see all org-scope flows across all orgs with `Promote to Global`.

## Migration

`packages/migrations/src/sql/004_flow_scopes.sql`:

1. Pre-flight guard: fail migration if any existing `jm_flows` row has `owner_user_id IS NULL`.
2. `ALTER TABLE jm_users ADD COLUMN is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;`
3. Create `jm_flow_grants` (definition above).
4. Backfill grants — for every existing flow, create one owner grant:
   ```sql
   INSERT INTO jm_flow_grants (id, flow_id, principal_type, principal_id, role, created_by)
   SELECT gen_random_uuid(), f.id, 'user', f.owner_user_id, 'owner', f.owner_user_id
   FROM jm_flows f;
   ```
5. Add `created_by_user_id` to `jm_flows` (copy `owner_user_id` into it as the audit baseline). Keep `owner_user_id` column for one release as a tombstone (read-only, ignored by the API), then drop in a follow-up migration. Application code reads ownership from grants exclusively.
6. Run-table changes:
   - `ALTER TABLE jm_runs ADD COLUMN flow_name_snapshot TEXT;`
   - `ALTER TABLE jm_runs ADD COLUMN flow_scope_snapshot TEXT;`
   - `ALTER TABLE jm_runs ADD COLUMN definition_snapshot JSONB;`
   - Backfill from referenced `flow_versions.definition` and the derived scope, then `SET NOT NULL`.
   - Relax `flow_id`/`flow_version_id` foreign keys to `ON DELETE SET NULL`.
7. Bootstrap (`packages/identity/src/routes/bootstrap.ts`): set `is_platform_admin = TRUE` on the first user.

JWT access tokens gain `isPlatformAdmin` (additive; older tokens default to `false`).

Day-one state after migration:
- All existing flows have a single user-scope owner grant.
- All existing runs have populated snapshot fields.
- No org-scope or global flows exist.
- Only the bootstrap user is a platform admin.

## Backwards compatibility

- `GET /flows` callers see only flows they have access to under grant evaluation. For legacy users that's their own user-scope flows. No breaking change to response shape; new fields (`scope`, `orgId`, `grants`) are additive.
- Run records continue to expose `flow_id`/`flow_version_id`; clients that rely on them keep working as long as the flow exists.

## Future work enabled by this design

- **Reassign ownership**: insert a new owner grant + delete the old one. No schema change.
- **Share flow with another org**: insert `('org', otherOrgId, 'viewer'|'editor')` grant.
- **Per-user share**: insert `('user', X, 'viewer')` grant.
- **Hard-delete a flow but keep runs**: existing FK is `ON DELETE SET NULL`; runs survive intact.
- **Ad-hoc runs without a flow**: orchestrator inserts a run row with `flow_id=NULL` and a definition coming from elsewhere.
- **Multiple owner grants** (co-ownership): lift the API-level "one owner" restriction; the schema already permits it.

None of these require migrations beyond the ones in this spec.
