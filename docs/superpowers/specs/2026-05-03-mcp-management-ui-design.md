# MCP Management UI — Design

**Date:** 2026-05-03
**Status:** Design approved, pending spec review
**Builds on:** [2026-05-03-mcp-management-design.md](./2026-05-03-mcp-management-design.md)

## Problem

The MCP backend (DB, REST API, resolver, coding-cli wiring) is implemented but unusable without a UI — today, MCPs can only be managed via raw HTTP calls. Users need a "My MCPs" page to register and edit their own MCP instances; org admins need an "Org MCPs" page to manage org-wide instances and promote user-level MCPs to org level when they're worth sharing.

## Goals

- **MyMcpsPage** at `/me/mcps` — list, add (from catalog or custom), edit, delete user-scope MCPs.
- **AdminMcpsPage** at `/admin/mcps` — list, add, edit, delete org-scope MCPs; list user-scope MCPs across the org and promote them.
- **Promote action (move semantics)** — user-scope MCP becomes org-scope; the original is deleted in the same transaction. Existing bindings are dropped; admin must re-bind to org or global secrets.
- Match the visual and code patterns of `MySecretsPage` / `AdminSecretsPage` (utility classes, inline forms, table layout).

## Non-goals

- Global-tier MCPs (no super-user UI, no DB-backed global scope). Bindings can reference global secrets via the existing env-var-based global-secrets path, but no global MCP *records*.
- Org → global promotion.
- Flow-editor phase-config MCP picker. Still deferred from the original spec.
- Inline enable/disable toggle. The edit modal can flip `enabled`, but the table has no quick-toggle action.
- Bulk actions (multi-select promote/delete).
- Changing transport on an existing MCP. Transport is fixed at create time; to switch, delete and re-create.

## Pages and routes

| Path | Component | Visibility |
|---|---|---|
| `/me/mcps` | `MyMcpsPage` | Any authenticated user |
| `/admin/mcps` | `AdminMcpsPage` | Org admin only (gated like `AdminSecretsPage`) |

`AppShell` adds:
- Sidebar link "My MCPs" right after "My Secrets".
- Sidebar link "Org MCPs" (admin-only) right after "Org Secrets".

The mobile/sheet menu mirrors the same additions.

## MyMcpsPage layout

```
┌─ My MCPs ───────────────────────────────────────────────┐
│ Personal MCP servers available to your runs.            │
│                                                          │
│ [+ Add from catalog]   [+ Add custom]                   │
│                                                          │
│ ┌─ Your MCPs (n) ────────────────────────────────────┐ │
│ │ Name      Transport  Bindings   Updated      ⋯       │ │
│ │ My Jira   http       2 secrets  2h ago      ✎ 🗑   │ │
│ │ Local FS  stdio      —          1d ago      ✎ 🗑   │ │
│ └──────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────┘
```

API: `GET /api/orgs/:orgId/users/me/mcp-instances`. Empty-state copy mirrors `MySecretsPage`.

## AdminMcpsPage layout

```
┌─ Org MCPs ───────────────────────────────────────────────┐
│ Org-wide MCPs visible to everyone in this organization.  │
│                                                           │
│ [+ Add from catalog]   [+ Add custom]                    │
│                                                           │
│ ┌─ Org MCPs (n) ───────────────────────────────────────┐│
│ │ Name      Transport  Bindings   Updated     ✎ 🗑       ││
│ └────────────────────────────────────────────────────────┘│
│                                                           │
│ ┌─ Promotable from users (n) ──────────────────────────┐ │
│ │ Owner       Name       Transport  Bindings  Action     │ │
│ │ alice@…     My Slack   http       1 secret  Promote →  │ │
│ └────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

APIs:
- Org table: `GET /api/orgs/:orgId/mcp-instances`.
- Promotable table: `GET /api/orgs/:orgId/mcp-instances/promotable` (new — see Backend Additions).

## Add-from-catalog modal (two-step)

**Step 1 — pick:**
- `GET /api/mcp-catalog` returns the static array.
- Render entries as a grid of selectable cards: `label`, `description`, badges for `transport` and `source`.

**Step 2 — fill:**
- `name` (required, defaults to catalog `label`).
- `description` (optional).
- `systemPrompt` (optional, textarea).
- `transport`, `command`/`args`, `url` — pre-filled from the catalog entry, **read-only**.
- For each `requiredEnv` from the catalog entry, render one row:
  - left: env var name (read-only chip).
  - right: a `<select>` populated from the user's visible secrets — see "Secret picker source" below.
- `[Cancel]` and `[Add MCP]`.

On submit: `POST /api/orgs/:orgId/users/me/mcp-instances` with the assembled body. On 4xx, surface the error inline.

## Add-custom modal (single form)

- `name`, `description`, `systemPrompt` (same as catalog flow).
- `transport`: radio (stdio | http | sse).
- If `stdio`:
  - `command` (text input, required).
  - `args` (textarea, one arg per line).
- If `http` or `sse`:
  - `url` (text input, required).
- Bindings: a repeater starting empty.
  - Each row: `envVar` (text, uppercase-on-blur), secret `<select>` (visible secrets), `[✕]` to remove.
  - `[+ Add binding]` appends a new empty row.
- `[Cancel]` and `[Create MCP]`.

Args input parsing: split by newlines, trim, drop blank lines.

## Edit modal

Reuses the form above, pre-populated from the MCP record. **Transport is read-only.** All other fields editable. Submits via `PATCH /api/orgs/:orgId/users/me/mcp-instances/:id` (My) or `/api/orgs/:orgId/mcp-instances/:id` (Admin).

## Promote dialog

Trigger: `Promote →` button on a row in the AdminMcpsPage's "Promotable from users" table.

Dialog content:

```
Promote "<original name>" to org level

Owner: <ownerEmail>
After promoting, <ownerEmail>'s user-level MCP will be removed and a
new org-level MCP will replace it. The bindings below need to be
re-mapped to org or global secrets — user-level secrets won't
resolve for other org members.

Name in org:        [<original name>]
Description:        [<original or empty>]
System prompt:      [<original or empty>]   (textarea)

Re-bind secrets:
  <ENV_VAR_1>  →  [select org/global secret ▾]
  <ENV_VAR_2>  →  [select org/global secret ▾]

[Cancel]   [Promote]
```

Behavior:
- The dialog initializes one row per env var present in the original bindings. Selectors start empty.
- The secret selector lists only org-scope and global-scope secrets (see "Secret picker source").
- "Promote" is disabled until every env var has a secret selected.
- Submit: `POST /api/orgs/:orgId/mcp-instances/:userInstanceId/promote` with `{ name, description, systemPrompt, bindings }`.
- On `409` (name collision): show inline error on the name field.
- On `400` (unresolvable secret): show inline error on the offending binding row.
- On success: close dialog, refresh both the org table and the promotable table.

## Secret picker source

Two modes:

- **User-page bindings** (My MCPs add/edit): user can reference user, org, or global secrets. Source: `GET /api/orgs/:orgId/secrets/visible-names` (existing endpoint in `@journeyman/secrets`).
- **Promote / Org-page bindings** (admin): only org and global secrets are valid. We need a new lightweight endpoint:

```
GET /api/orgs/:orgId/secrets/visible-names?scope=org-and-global
```

Implementation in `@journeyman/secrets`: filter the existing `visible-names` route by `user_id IS NULL` plus the global env-var names. The new query parameter is optional; default behavior unchanged.

**Decision: retrofit the existing endpoint.** The `scope` query parameter is optional; current callers continue to work unchanged.

## Backend additions

### 1. `POST /api/orgs/:orgId/mcp-instances/:userInstanceId/promote`

Auth: `requireAuth({ role: "admin" })`.

Body:
```ts
{
  name?: string;             // defaults to original .name
  description?: string;      // defaults to original .description
  systemPrompt?: string;     // defaults to original .systemPrompt
  bindings: McpBinding[];    // required, replaces original bindings
  enabled?: boolean;         // defaults to original .enabled
}
```

Algorithm:
1. Load the user-scope MCP by `(id = userInstanceId, org_id = orgId, user_id IS NOT NULL)`. 404 if not found.
2. Validate every `binding.secretName` resolves to an org-scope secret (`fetchPinnedOrgSecret`) or a global secret (`readGlobalSecrets()`). If any name resolves only to a user-scope secret or doesn't resolve at all, return `400` with the offending names.
3. Open a transaction:
   - `INSERT` a new org-scope row (`user_id = NULL`) copying `transport`, `command`, `args`, `url`; using the body's `name`, `description`, `systemPrompt`, `bindings`, `enabled` (with defaults from the original where omitted); `created_by = current admin user`.
   - `DELETE` the original user-scope row.
4. Return the new `McpInstanceRecord`.

Error mapping:
- `404` if user MCP not found.
- `409` if a row with `(org_id, user_id IS NULL, name)` already exists.
- `400` `InvalidMcpInputError` for binding/name validation issues.

### 2. `GET /api/orgs/:orgId/mcp-instances/promotable`

Auth: `requireAuth({ role: "admin" })`.

Returns:
```ts
Array<{
  id: string;
  name: string;
  transport: McpTransport;
  ownerEmail: string;
  bindingCount: number;
  updatedAt: Date;
}>
```

Implementation: query `jm_mcp_instances` where `org_id = $1 AND user_id IS NOT NULL`, joined to `jm_users` on `user_id = jm_users.id` (the scope owner is the correct join key — that's whose secrets the MCP currently references). Project to the response shape, including a `bindingCount` computed from the `bindings` JSONB array length.

## Validation, edge cases

- **Catalog `requiredEnv` empty** → step 2 of the catalog modal renders no binding rows; user just types name + system prompt. Common for stdio Filesystem/Git.
- **Custom MCP with no bindings** → empty repeater is valid; submit goes through.
- **Edit modal: removing all bindings** → backend accepts; downstream resolver simply produces an instance with empty `env`.
- **Promote with original having zero bindings** → dialog shows no binding rows; one click to promote.
- **Same name collision on promote** → backend returns `409`, dialog shows inline error.

## Files

### New
- `packages/web/src/api/mcp.ts` — typed fetch wrappers (`listMy`, `listOrg`, `listPromotable`, `getCatalog`, `create`, `update`, `remove`, `promote`).
- `packages/web/src/routes/MyMcpsPage.tsx`
- `packages/web/src/routes/AdminMcpsPage.tsx`
- `packages/web/src/components/mcp/AddFromCatalogModal.tsx`
- `packages/web/src/components/mcp/AddCustomModal.tsx`
- `packages/web/src/components/mcp/EditMcpModal.tsx`
- `packages/web/src/components/mcp/PromoteMcpDialog.tsx`
- `packages/web/src/components/mcp/SecretPicker.tsx` — used by all three forms; takes a scope hint (`"all" | "org-and-global"`).
- `packages/web/src/components/mcp/BindingsEditor.tsx` — repeater control used by the custom-add and edit forms.
- `packages/mcp/src/routes/promote.ts` — promote endpoint.
- `packages/mcp/src/routes/promotable.ts` — promotable list endpoint.

### Modified
- `packages/web/src/App.tsx` — add `/me/mcps` and `/admin/mcps` routes.
- `packages/web/src/components/AppShell.tsx` — add sidebar links and mobile menu entries.
- `packages/mcp/src/routes/index.ts` — register the two new routes.
- `packages/mcp/src/db.ts` — add `promoteToOrg(pool, ...)` helper used by the new route.
- `packages/secrets/src/routes/visible-names.ts` (or new sibling) — support `scope=org-and-global` filtering.

## Out-of-scope items already noted in CLAUDE.md status

- Flow-editor MCP picker UI.
- Worker pre-resolution of `mcpInstanceIds → ResolvedMcpInstance[]` from phase config.

These remain out of scope for this iteration too — this spec only touches the **management** UI, not the consumer side.

## Implementation Status (post-merge)

| Feature | Status |
|---|---|
| `MyMcpsPage` (`/me/mcps`) | Implemented |
| `AdminMcpsPage` (`/admin/mcps`) | Implemented |
| Add-from-catalog modal | Implemented |
| Add-custom modal | Implemented |
| Edit modal | Implemented |
| Promote dialog (move semantics) | Implemented |
| `POST /mcp-instances/:id/promote` | Implemented |
| `GET /mcp-instances/promotable` | Implemented |
| `secrets/visible-names?scope=org-and-global` | Implemented |
| Global-tier MCP records | Out of scope |
| Org → global promotion | Out of scope |
| Flow-editor MCP picker UI | Stub (unchanged) |
| Worker pre-resolution of `mcpInstanceIds` | Stub (unchanged) |
