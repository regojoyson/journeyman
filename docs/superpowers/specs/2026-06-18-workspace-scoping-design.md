# Workspace-Based Identity & Resource Scoping — Design

**Date:** 2026-06-18
**Status:** Approved for planning
**Scope:** Replace the current per-user / per-org resource scoping with an Atlassian-style **Org → Workspaces → Members-with-roles** model. Clean break — no data migration.

---

## Plain-language summary (what this means)

Today, every secret, MCP, skill, sandbox, flow, agent, connection, and webhook is tagged as belonging *either* to one user *or* to a whole org, and the system falls back `user → org → global` when it needs one.

We're changing that to look like Jira/Confluence:

- An **organization** contains **users** and **workspaces**.
- A user can be put into **one or many workspaces**, and gets a **role in each workspace** (the same person can be a boss in one workspace and read-only in another).
- **Almost everything now lives inside a workspace** instead of being "mine" or "the org's". No resource is owned by an individual user anymore.
- A few things can still be shared higher up: **secrets** can be set at the org level (shared by all that org's workspaces), and **sandboxes** can be system-wide or org-wide.
- There are **four levels of power**: a global super-admin, an org admin, and three roles inside each workspace (Maintainer, Contributor, Observer).
- We're building it so that **later** we can give fine-grained permissions to individual users in a workspace **without rewriting everything** — every permission check goes through one function we can upgrade in place.

---

## 1. Goals & non-goals

**Goals**
- Introduce **Workspaces** as the primary home for resources, nested under Orgs.
- Per-workspace role assignment for users (a user ↔ workspace ↔ role).
- A clear 4-tier authority ladder: Platform Admin → Org Admin → Workspace roles.
- Eliminate all **user-level** resource scoping.
- Keep an org-level tier only where explicitly required (secrets, sandboxes), plus a read-only system/platform tier (system sandboxes, static MCP catalog).
- Make authorization **extensible**: future per-user / granular permissions must not require touching route handlers.

**Non-goals (explicitly deferred)**
- No data migration — existing data is discarded and re-seeded (clean break).
- No workspace-level sandboxes yet (system + org only for now).
- No data-driven custom roles / permission editor UI yet (the seam is built; the tables are not).
- No cross-workspace "template library" to replace global flow publishing.

---

## 2. Entity model

```
jm_orgs (id, slug, name)
  ├─< jm_users (id, username, …, is_platform_admin)   ─< jm_auth_identities, jm_refresh_tokens, jm_api_tokens
  ├─< jm_memberships (user_id, org_id, role: 'admin' | 'member')        -- org-level role
  └─< jm_workspaces (id, org_id, slug, name)                            -- NEW
        ├─< jm_workspace_members (workspace_id, user_id,                -- NEW
        │       role: 'maintainer' | 'contributor' | 'observer',
        │       permissions JSONB NULL)                                 -- reserved future override slot
        └─< workspace-scoped resources (workspace_id FK)
```

**Kept:** `jm_orgs`, `jm_users` (incl. `is_platform_admin`), `jm_auth_identities`, `jm_refresh_tokens`, `jm_api_tokens`, `jm_memberships` (role `admin | member`).

**New tables:**
- `jm_workspaces(id UUID PK, org_id UUID FK→jm_orgs ON DELETE CASCADE, slug TEXT, name TEXT, created_at, updated_at)`, `UNIQUE(org_id, slug)`.
- `jm_workspace_members(id UUID PK, workspace_id UUID FK→jm_workspaces ON DELETE CASCADE, user_id UUID FK→jm_users ON DELETE CASCADE, role TEXT CHECK in ('maintainer','contributor','observer'), permissions JSONB NULL, created_at)`, `UNIQUE(workspace_id, user_id)`.

`permissions JSONB NULL` is reserved now and unused; it is the forward slot for per-member permission overrides (see §5).

---

## 3. Role model

| Capability | Platform Admin | Org Admin | Maintainer | Contributor | Observer |
|---|---|---|---|---|---|
| See / manage **all orgs** | ✅ | — | — | — | — |
| Manage org (settings, users in org) | ✅ | ✅ | — | — | — |
| Create / delete **workspaces** | ✅ | ✅ | — | — | — |
| Assign users to a workspace + set role | ✅ | ✅ | ✅ (own ws) | — | — |
| Manage workspace settings | ✅ | ✅ (implicit) | ✅ | — | — |
| Create / edit / delete workspace resources | ✅ | ✅ (implicit) | ✅ | ✅ | — |
| Read / run flows & resources | ✅ | ✅ (implicit) | ✅ | ✅ | 👁 read-only |

- **Platform Admin** = `jm_users.is_platform_admin` (unchanged). Bypasses all lower checks.
- **Org Admin** = `jm_memberships.role = 'admin'`. Manages the org **and** has **implicit Maintainer** on every workspace in that org.
- **Workspace roles** (`jm_workspace_members.role`): `maintainer` > `contributor` > `observer`.

---

## 4. Resource scoping matrix (locked)

| Resource | System | Org | Workspace | Resolution |
|---|---|---|---|---|
| Sandboxes | ✅ | ✅ | — (deferred) | Org > System |
| Secrets | — | ✅ | ✅ | Workspace > Org |
| Skills | — | — | ✅ | Workspace |
| MCP instances | static catalog (read-only) | — | ✅ | Workspace |
| Custom steps | — | — | ✅ | Workspace |
| Flows | — | — | ✅ | Workspace |
| Agents | — | — | ✅ | Workspace |
| Connections | — | — | ✅ | Workspace |
| Webhooks | — | — | ✅ | Workspace |

**Schema impact per resource type:**
- Workspace-only types (skills, mcp_instances, custom_steps, flows, agents, connections, webhooks): drop `user_id` and any `scope`/`org_id` scoping column; add `workspace_id UUID NOT NULL FK→jm_workspaces`. Rework uniqueness to `(workspace_id, name)`.
- **Secrets**: a row is org-scoped *or* workspace-scoped. Columns `org_id UUID NULL`, `workspace_id UUID NULL`, with a CHECK that exactly one is non-null. Drop `user_id`. Uniqueness: `UNIQUE NULLS NOT DISTINCT (org_id, workspace_id, name)`. Drop env-var/global tier (`readGlobalSecrets` removed from the resolve path).
- **Sandboxes**: `scope ∈ {'system','org'}`; `org_id NULL` for system rows, non-null for org rows. Drop `user_id` and the `'user'` scope value.

**Removed wholesale:** all `*Scope` enums containing `'user'`/`'global'` (`SecretScope`, `ConnectionScope`, `CustomStepScope`, `AgentScope`, `SkillScope`, `WorkflowScope`, `WorkflowGrantPrincipalType`, `WorkflowInstanceGrantPrincipalType`, `WebhookScope`); `jm_flow_grants`; `jm_workflow_instance_grants`; global flow publish/unpublish; every `promote-from-user` endpoint and its rebinding logic.

---

## 5. Authorization layer (extensible by design)

Routes never test a role literal. They declare a required **permission**; a single stable function answers it.

```
WorkspacePermission (enum in @journeyman/core):
  workspace.view
  resource.read   resource.write   resource.delete
  members.manage
  settings.manage
  (extend as needed; names are stable contracts)

roleGrants(role): Set<WorkspacePermission>
  observer    → { workspace.view, resource.read }
  contributor → observer ∪ { resource.write, resource.delete }
  maintainer  → contributor ∪ { members.manage, settings.manage }

can(ctx, workspaceId, permission): boolean        // STABLE — call sites bind to this
  1. ctx.isPlatformAdmin                              → true
  2. ctx is org admin of workspace.org_id             → true   (implicit maintainer)
  3. resolvePermissions(member) ⊇ permission          → role-derived

resolvePermissions(member): Set<WorkspacePermission>  // the ONLY thing that changes later
  NOW:   roleGrants(member.role)
  LATER: roleGrants(member.role) ∪ member.permissions(JSONB) ∪ customRoleGrants(...)
```

**Extension guarantee:** adding per-member overrides or data-driven custom roles later edits only `resolvePermissions()` (and adds tables/CRUD). No route handler, guard, or test of `can()` changes. The `permissions JSONB` column on `jm_workspace_members` is the reserved slot for the first such extension.

**Fastify preHandlers** (in `@journeyman/identity`):
- `requireOrgRole('admin')` — org management + org-tier resource routes.
- `requireWorkspacePermission(perm)` — reads `:wsId`, loads the caller's workspace membership (or org-admin/platform-admin shortcut), calls `can()`, 403s on failure. Populates `req.runContext.workspace = { id, orgId, role, permissions }`.

---

## 6. Auth tokens & context

- **Access JWT shape unchanged**: `{ sub: userId, org: orgId, role: orgRole, pa: isPlatformAdmin, kind, iat, exp }`. Workspace role is **not** encoded (a user holds many) — it is resolved per request from `jm_workspace_members`.
- **Active org** stays as today (refresh token `active_org_id`). **No "active workspace" in the token** — the workspace is a path parameter, so resource access is explicit per request.
- `RunContext` gains an optional resolved `workspace` field, populated by `requireWorkspacePermission`.

---

## 7. API routes

- **Platform:** `/api/admin/orgs` — list/manage all orgs (platform admin only).
- **Org management:** `/api/orgs/:orgId/users`, `/api/orgs/:orgId/memberships`, `/api/orgs/:orgId/workspaces` (CRUD), `/api/orgs/:orgId/api-tokens`.
- **Org-tier resources:** `/api/orgs/:orgId/secrets`, `/api/orgs/:orgId/sandboxes` (org admin).
- **Workspace resources:** `/api/workspaces/:wsId/<resource>` for `secrets`, `skills`, `mcp-instances`, `custom-steps`, `flows`, `agents`, `connections`, `webhooks`. `:wsId` is a globally-unique UUID that knows its org, so no `/orgs/:orgId/...` nesting.
- **Workspace membership:** `/api/workspaces/:wsId/members` (assign user + role; maintainer or above).

This replaces today's paired `/api/orgs/:orgId/<resource>` (org) and `/api/orgs/:orgId/users/me/<resource>` (user) routes. All `_visible`, `promotable`, and `promote` sub-routes are removed.

---

## 8. Bootstrap

First-run bootstrap (idempotent, gated by `jm_system_state`) creates: the first **user** (marked `is_platform_admin`), the first **org**, an `admin` **membership**, a **default workspace** in that org, and a `maintainer` **workspace membership** for the user.

---

## 9. UI changes (high level)

- **Workspace switcher** in the shell (replaces today's static org display in `packages/web/src/components/Sidebar.tsx`); the active workspace drives all resource pages and supplies `:wsId`. Lists the workspaces the user belongs to; org/platform admins see all workspaces in the org.
- **Org admin screens**: create/delete workspaces; assign org users to workspaces and set their workspace role.
- **Workspace member management** for maintainers (`/api/workspaces/:wsId/members`).
- **Role-gated controls**: Observer = read-only; Contributor = no settings/member management; Maintainer/Org Admin = full. UI gating mirrors `WorkspacePermission`.

### 9a. Sidebar restructure

Today the sidebar duplicates resources across a user-scoped `NAV_ITEMS` ("My Secrets", "My MCPs", …) and an admin-only `ADMIN_ITEMS` ("Org Secrets", …) with no workspace concept, no org switcher, and an unused `isPlatformAdmin`. The redesign collapses this into one workspace-scoped set plus clean admin tiers:

- **Workspace switcher** (top): dropdown over the caller's workspaces; sets the active `:wsId`.
- **Workspace** section (active workspace, gated by `WorkspacePermission`): `Workflows`, `Workflow Instances`, `Secrets`, `Skills`, `MCPs`, `Custom Steps`, `Agents`, `Connections`, `Webhooks`. Plus `Members` and `Workspace Settings` for `members.manage`/`settings.manage` holders (Maintainer / Org Admin / Platform Admin). The old `My X` vs `Org X` split is removed — a single set, role-gated.
- **Organization** section (Org Admin or Platform Admin): `Workspaces` (create/manage), `Members` (org users), `Org Secrets`, `Org Sandboxes`, `Coding Models`. Sandboxes live here (org/system tier; no workspace tier yet).
- **Platform** section (Platform Admin only): `All Orgs`.

Secrets appear in both the Workspace and Organization sections, matching their two tiers (§4). Routes move from `/me/<resource>` + `/admin/<resource>` to `/workspaces/:wsId/<resource>` (workspace) and `/orgs/:orgId/<resource>` (org), consistent with §7.

---

## 10. Affected packages

`core` (types/enums — source of truth), `identity` (workspaces, members, preHandlers, bootstrap), `migrations` (new schema, append-only), `secrets`, `sandbox`, `skills`, `mcp`, `custom-steps`, plus `api-server` route modules for `flows`, `agents`, `connections`, `webhooks`, `builder-*` (inventory loaders), and `orchestrator` (drop instance grants; instances inherit workspace). UI: `web`, `flow-editor`, `run-viewer`, `runs-list`.

Run `npm run check` (typecheck + import boundaries) continuously; `core` must still import from no other `@journeyman/*` package.

---

## 11. Phasing (clean break)

1. **Identity core** — `jm_workspaces` + `jm_workspace_members` tables; `WorkspacePermission` enum + `roleGrants`/`can`/`resolvePermissions` + `requireWorkspacePermission`/`requireOrgRole`; bootstrap default workspace; `RunContext.workspace`.
2. **Resource cutover** — per package, swap scoping columns to `workspace_id` (secrets/sandboxes keep their org/system tier), update routes to `/api/workspaces/:wsId/...`, rewrite resolvers (`secrets`: workspace>org; `sandbox`: org>system; rest: single workspace lookup), delete grant/promote code.
3. **UI** — workspace switcher, org workspace management, workspace member management, permission-based gating.

---

## 12. Testing

- **Schema/resolver unit tests** per resource: secrets (workspace>org precedence), sandboxes (org>system), single-scope lookups for the rest.
- **Authorization tests**: a `can()` truth-table — each role × each `WorkspacePermission`, plus platform-admin bypass and org-admin implicit-maintainer paths.
- **Bootstrap test**: first run yields platform admin + org + default workspace + maintainer membership.
- **Import-boundary + typecheck** (`npm run check`) green at the end of every phase.

---

## 13. Open items / future work

- Workspace-level sandboxes (deferred tier).
- Granular per-user / custom-role permissions (seam built via `resolvePermissions()` + `permissions JSONB`; tables + editor UI deferred).
- Cross-workspace template library (replaces removed global flow publishing) — separate feature if desired.
