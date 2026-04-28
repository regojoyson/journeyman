# Flow Scopes (User / Org / Global) — Design Spec

**Date:** 2026-04-28
**Status:** Approved (brainstorming complete, awaiting implementation plan)

## Summary

Today, every flow is owned by exactly one user (`Flow.ownerUserId`). This spec introduces three scopes for flows — **user**, **org**, and **global** — modeled as a templates-and-cloning system: org admins curate org-wide templates, platform admins curate built-in global templates, and users either run those templates as-is or **clone them down** to their own user-scope flow to customize. Cloning is a one-way snapshot — there is no link, inheritance, or live update between source and clone.

A new `is_platform_admin` flag on users authorizes management of global flows.

## Goals

- Let org admins publish standardized flows for their org.
- Let platform operators ship built-in flows visible to every org.
- Let any user start from a template and customize it without affecting the template.
- Reuse the existing flow versioning model unchanged.

## Non-goals

- Live template references / inheritance / overrides. Clone is a clean break.
- Cross-org sharing of org-scope flows. Two orgs share only via global.
- User-initiated "submit for promotion" workflow. Promotion is an admin action.
- Per-flow ACLs within a scope. All org members see all org flows.
- Changing a flow's scope after creation. Promotion creates a new flow.

## Design decisions (from brainstorming)

| # | Decision |
|---|---|
| Q1 | Three scopes serve the **templates-and-inheritance** purpose: global/org are starting points, user-scope is where customization lives. |
| Q2 | Clone = **snapshot copy**. No `templateId`, no live link, no overrides. |
| Q3 | **Strict ladder + admin promote.** Author at one's own scope; admins promote any flow they can see one tier up via a snapshot copy. |
| Q4 | Superadmin = **`is_platform_admin` boolean on the user record**, independent of org membership. |
| Shape | **Single `jm_flows` table with a `scope` discriminator** + nullable `org_id`/`owner_user_id`, mirroring the existing secrets pattern. |

## Data model

### `jm_users`

Add column:

```
is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE
```

A platform admin may or may not also be a member of an org. The first user created via the bootstrap path gets `is_platform_admin = TRUE`.

### `jm_flows`

Existing columns retained: `id`, `name`, `description`, `current_version_id`, `created_at`, `updated_at`, `owner_user_id`.

New / tightened columns:

```
scope          TEXT NOT NULL CHECK (scope IN ('user','org','global'))
org_id         UUID NULL REFERENCES jm_orgs(id)
owner_user_id  UUID NULL REFERENCES jm_users(id)   -- existing column, semantics tightened
```

Matrix enforced via CHECK constraint:

| scope | org_id | owner_user_id |
|---|---|---|
| `global` | NULL | NULL |
| `org` | NOT NULL | NULL |
| `user` | NOT NULL | NOT NULL |

Uniqueness: `UNIQUE(scope, org_id, owner_user_id, name)` — same name is allowed across different scopes.

`scope` is **immutable** after insert. Promotion creates a new row.

### `flow_versions`

Unchanged. A flow at any scope has its own version history keyed by `flow_id`. Cloning/promotion creates a new flow at v1; version history is **not** copied.

### TypeScript types (`packages/core/src/types/flow.types.ts`)

```ts
export type FlowScope = "user" | "org" | "global";

export interface Flow {
  id: string;
  scope: FlowScope;
  orgId: string | null;
  ownerUserId: string | null;
  name: string;
  description: string | null;
  currentVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

`FlowVersion` unchanged.

### `packages/core/src/types/identity.types.ts`

Add `isPlatformAdmin: boolean` to `UserRecord`. JWT access token claims gain an `isPlatformAdmin` boolean (additive; missing claim is treated as `false`).

## Permission matrix

| Action | User flow | Org flow | Global flow |
|---|---|---|---|
| List / discover | owner only | members of that org | every authenticated user |
| Read / run | owner only | members of that org | every authenticated user |
| Create | any member (in their own org) | org admins of that org | platform admins only |
| Edit / new version | owner only | org admins of that org | platform admins only |
| Delete | owner only | org admins of that org | platform admins only |
| Clone (→ user-scope) | n/a | any member of that org | any authenticated user |
| Promote (→ org-scope) | org admin of source's org | n/a | n/a |
| Promote (→ global) | platform admin | platform admin | n/a |

Notes:
- **Org admins can read all user-scope flows in their org** (required for promote moderation).
- **Platform admins bypass all checks** at every scope.

## API surface

All routes mounted under the existing api-server. Auth middleware injects `userId`, `orgId`, `role`, `isPlatformAdmin`.

### List

```
GET /flows                              → user-scope (own) + org-scope (current org) + global
GET /flows?scope=user|org|global        → filter to one scope
GET /flows?scope=user&orgId=:id         → moderation view (org admin or platform admin)
GET /flows?scope=org                    → cross-org listing (platform admin only)
```

### CRUD

```
POST   /flows                  body: { scope, name, description?, definition, orgId? }
GET    /flows/:id
PATCH  /flows/:id              metadata only (name, description) — scope immutable
DELETE /flows/:id

POST   /flows/:id/versions     body: { definition }   bumps current_version_id
GET    /flows/:id/versions
GET    /flows/:id/versions/:versionId
```

`POST /flows` rules:
- `scope=user` → server sets `orgId` to caller's `orgId`, `ownerUserId` to caller.
- `scope=org` → caller must be admin of `orgId` (defaults to caller's `orgId`); `ownerUserId` is NULL.
- `scope=global` → caller must be platform admin; `orgId` and `ownerUserId` are NULL.

### Snapshot actions

```
POST /flows/:id/clone
  body: { name? }
  effect: copy source's current_version_id.definition into a new
          user-scope flow owned by caller (caller's orgId)
  authz:  caller must have read access to source
  result: { id: <new-flow-id> }

POST /flows/:id/promote
  body: { targetScope: "org" | "global", name? }
  effect: copy source's current_version_id.definition into a new flow
          at targetScope; new flow starts at v1
  authz:
    targetScope=org    → caller is org admin of source's effective org
    targetScope=global → caller is platform admin
  result: { id: <new-flow-id> }
```

Both actions snapshot **only** the source's current version definition. New flow's `created_by_user_id` (on `flow_versions` v1) is the caller. There is no lineage column on the new flow.

### Platform-admin endpoints

```
GET   /admin/users/:id/platform-admin
PATCH /admin/users/:id/platform-admin   body: { value: boolean }
```

Both gated by `isPlatformAdmin`. A platform admin cannot remove their own flag if they are the last platform admin (server-side guard).

## Run resolution

A run pins `flowId` + `flowVersionId` at start time — unchanged. Scope is **not** part of run resolution; once started, runs reference a specific version definition by id and are unaffected by subsequent edits, deletes, or scope changes.

The run viewer surfaces a `scope` badge next to the flow name (`global` / `org` / `user`) — pure denormalization at render time.

## UI surface (`packages/web`)

### Flow list page

- **Scope filter chips**: `Mine` / `Organization` / `Global` / `All`. Default `All`.
- Each row carries a `scope` badge.
- **New flow** button is a dropdown:
  - `New personal flow` — always shown.
  - `New org flow` — shown to org admins.
  - `New global flow` — shown to platform admins.
- **Row actions**:
  - On a flow the user can edit: `Edit` (primary), `Clone`, `Delete`, plus `Promote → Org` / `Promote → Global` for admins where applicable.
  - On a flow the user cannot edit (e.g. a global flow): `Clone to my flows` (primary), `Open (read-only)`.

### Flow editor

When opening a flow the user cannot edit, render the editor read-only with a banner: *"This is a {scope} template. Clone it to make changes."* The banner's CTA invokes `POST /flows/:id/clone`.

### Admin flow moderation page

New `AdminFlowsPage` (mirrors the existing `AdminUsersPage` / `AdminSecretsPage`):

- Org admins see all user-scope flows in their org with a `Promote to Org` action.
- Platform admins see additionally: all org-scope flows across all orgs, with `Promote to Global` actions.

## Migration

`packages/migrations/src/sql/004_flow_scopes.sql`:

1. `ALTER TABLE jm_users ADD COLUMN is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;`
2. `ALTER TABLE jm_flows ADD COLUMN scope TEXT NOT NULL DEFAULT 'user' CHECK (scope IN ('user','org','global'));`
3. `ALTER TABLE jm_flows ADD COLUMN org_id UUID REFERENCES jm_orgs(id);`
4. Pre-flight guard: fail migration if any existing `jm_flows` row has `owner_user_id IS NULL` (today the column is nullable but no real flow should be unowned). Operator resolves manually before re-running.
5. Backfill `org_id` from owner's oldest membership:
   ```sql
   UPDATE jm_flows
   SET org_id = (
     SELECT m.org_id FROM jm_memberships m
     WHERE m.user_id = jm_flows.owner_user_id
     ORDER BY m.created_at ASC
     LIMIT 1
   )
   WHERE owner_user_id IS NOT NULL;
   ```
6. Add the matrix CHECK constraint.
7. Add `UNIQUE(scope, org_id, owner_user_id, name)`.
8. Drop the `scope` default to force explicit values going forward.

Bootstrap (`packages/identity/src/routes/bootstrap.ts`): set `is_platform_admin = TRUE` on the first user at the same point the first org admin role is granted.

JWT: add `isPlatformAdmin` to access-token claims (additive; existing tokens default to `false`).

Day-one state after migration:
- All existing flows are user-scope (correct).
- No org-scope or global flows exist (correct).
- Only the bootstrap user is a platform admin.

## Backwards compatibility

`GET /flows` callers see only flows they have access to under the new matrix — for legacy users that's their own user-scope flows plus (initially empty) global flows. No breaking change to the response shape; new fields (`scope`, `orgId`) are additive.

## Out of scope (future work)

- Lineage tracking between cloned/promoted flows.
- User-initiated promotion requests with admin approval workflow.
- Cross-org sharing without going through global.
- Per-flow ACLs within a scope.
