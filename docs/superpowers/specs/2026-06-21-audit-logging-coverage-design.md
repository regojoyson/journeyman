# Audit Logging Coverage — Design

**Date:** 2026-06-21
**Status:** Approved (design)
**Scope:** Backend only — no frontend changes

## Problem

Mutating API actions should leave an audit record: *who did what, to which resource, when.*
The infrastructure for this already exists — a `jm_audit_log` table (migration `048_audit_log.sql`)
and an `audit()` / `listAudit()` service in `@journeyman/api-context` — but only the **agent**
routes (plus partial connection and agent-token coverage) actually write records.

An inventory of all mutating HTTP routes found **85 of 97** mutating routes write no audit entry.
Notably, **workflow/flow editing has zero audit coverage**, as do custom steps, MCP instances,
coding models, skills, sandboxes, secrets, webhooks, forms, workflow triggers, and identity/access
changes.

This design rolls audit coverage across the resources users edit, using a single durable mechanism
rather than 65 hand-written calls.

## Goals

- Record create / update / delete / state-change actions for the in-scope resources.
- One mechanism, applied consistently — hard to bypass, cheap for future routes to inherit.
- Never break or slow a user request because of audit logging.
- Never store secret values or credentials in the audit detail.

## Non-Goals

- A UI to browse the audit log (possible follow-up).
- Recording failed / unauthorized attempts (only successful mutations are logged in this pass).
- Full before/after field diffs (the `detail` blob can hold them later without schema change).
- Builder sessions, per-run workflow-instance actions, and human-task resolutions (out of scope).

## Scope — Resources Covered

Scope **B**: config/resource buckets **plus** identity/access.

| Resource | Actions tagged |
|---|---|
| `workflow` | create, update, delete, promote, rollback, unpublish, clone |
| `custom_step` | create, import, update, enable, disable, delete |
| `mcp` | create, update, delete |
| `coding_model` | create, update, delete |
| `pricing` | create, update, delete |
| `skill` | install, uninstall, enable, disable |
| `sandbox` | create, update, delete, rebuild |
| `secret` | create, update, delete, promote-to-org *(name/label only — never the value)* |
| `webhook` | create, update, delete, rotate |
| `connection` | create*, update **(new — closes gap)**, delete* |
| `form` | create, update, delete |
| `workflow_trigger` | create, update, delete |
| `agent` | create*, update*, enable*, disable*, delete*, run* |
| `agent` token | issue*, revoke*, toggle **(new — closes gap)** |
| `user` / `org` / `workspace` / `api_token` | create, update, delete, role/permission changes |

`*` = already audited today; these are migrated onto the new mechanism (same action strings).

Only mutating routes (`POST` / `PUT` / `PATCH` / `DELETE`) are tagged. Read/list/validate routes
are never tagged.

## Mechanism — Approach A: declarative route metadata + one central hook

### The hook

A single Fastify `onResponse` hook is registered once in `buildHttpServer()`
([packages/api-server/src/server-http.ts](../../../packages/api-server/src/server-http.ts)),
after the route plugins are registered, with access to the shared `c.pool`.

On every response it runs:

```
if reply.statusCode is 2xx
   and the matched route has an `audit` entry in its Fastify `config`
   and req.runContext exists (we know the actor):
       write one row via audit(pool, entry)
otherwise:
       do nothing
```

The hook reads the route's `config.audit` via the Fastify request's route options.

### The name tag (route config)

Each auditable route declares its intent inline:

```ts
app.put(
  "/workspaces/:wsId/workflows/:id",
  {
    preHandler: [requireAuth(), requirePerm("resource.write")],
    config: { audit: { action: "workflow.update", targetType: "workflow" } },
  },
  handler,
);
```

A route without an `audit` config writes nothing — tagging is the explicit opt-in.

### How the hook fills the record (by convention)

| Field | Source |
|---|---|
| `action` | `config.audit.action` |
| `targetType` | `config.audit.targetType` |
| `actorUserId` | `req.runContext.user.id` |
| `orgId` | `req.runContext.workspace.orgId` if workspace-scoped, else `req.runContext.org.id` |
| `targetId` | the route's `:id` param; for **create** routes the handler sets `req.auditTargetId = newId` |
| `detail` | optional `req.auditDetail` set by the handler; defaults to `{}` |

So a typical route adds **one config line**. Create routes add **one extra line**
(`req.auditTargetId = created.id`). Handlers that want richer context set `req.auditDetail`.

A small typed augmentation is added for `req.auditTargetId` / `req.auditDetail` on
`FastifyRequest`, and `config.audit` on the route config.

### Detail level

`detail` is a small, human-readable JSON blob — a label plus a few key fields
(e.g. `{ name, wsId }`). This matches what agent routes store today.

Cheap context to add where it is high-value:
- `workflow.promote` / `workflow.rollback` → version number.
- enable / disable / toggle → the resulting state.
- identity role/permission changes → previous role → new role.

Hard rule: for `secret` and `connection`, `detail` contains only the name/label and the fact that
it changed — **never** the secret value, credential, or config payload.

Full before/after diffs are out of scope; the blob can hold them later with no schema change.

## Migration of existing audited routes

Agents, connections (create/delete), and agent tokens (issue/revoke) currently call `audit()`
by hand. These are converted to the name-tag pattern so exactly one mechanism exists. Action
strings are preserved, so existing log rows remain consistent and no historical behavior changes.

## Edge cases & safety

- **No actor** (unauthenticated route, e.g. health): no `runContext` → no record.
- **Failed / blocked action**: non-2xx response → no record.
- **No clean `targetId`** (rare bulk routes): `targetId` is omitted; the column is nullable.
- **Audit write failure**: `audit()` already swallows its own errors and never throws — a logging
  failure can never fail or slow the user's request (fire-and-forget).
- **Secret values**: excluded from `detail` by rule (see Detail level).

## Reading it back

A `GET /api/orgs/:orgId/audit` endpoint already exists and reads the same `jm_audit_log` table, so
new rows surface automatically. This pass confirms that endpoint returns the new rows; it does not
add new read endpoints or UI.

## Import boundaries

`@journeyman/api-context` (where `audit()` lives) is a backend-layer package. All packages that own
in-scope routes are backend-layer or unclassified, so importing the audit service introduces no
boundary violation. In Approach A the `audit()` call lives only in the central hook in `api-server`,
so individual route packages do not even need to import it — they only add the `config.audit` tag,
which is plain data. `npm run check:boundaries` must pass.

## Testing

Unit tests for the hook:
- 2xx + `config.audit` present → writes a row with the expected fields.
- non-2xx → no write.
- no `config.audit` → no write.
- no `runContext` → no write.
- workspace-scoped vs org-scoped request resolves the correct `orgId`.
- create route sets `req.auditTargetId` → row carries the new id.

Integration tests (one per representative family, reusing the existing test-DB pattern):
- `workflow` create/update/delete land rows with the right `action` / `targetType` / `targetId`.
- `secret` update lands a row whose `detail` contains **no** secret value.
- an identity/access change (e.g. role update) lands a row.

## Files Touched (anticipated)

- `packages/api-server/src/server-http.ts` — register the audit `onResponse` hook.
- New: a small hook module in `api-server` (e.g. `src/audit-hook.ts`) + the Fastify type augmentation.
- `packages/api-http/src/routes/*.ts` — add `config.audit` tags (flows, forms, workflow-triggers,
  connections [update], agents/agent-triggers [migrate]).
- `packages/custom-steps`, `packages/mcp`, `packages/skills`, `packages/sandbox`,
  `packages/secrets`, `packages/coding-models` route files — add `config.audit` tags and, on create
  routes, `req.auditTargetId`.
- Identity routes (users / orgs / workspaces / api-tokens) — add `config.audit` tags.

No database migration required — `jm_audit_log` already exists.
No frontend changes.
