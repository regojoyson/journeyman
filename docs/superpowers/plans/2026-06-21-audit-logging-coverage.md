# Audit Logging Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record an audit entry for every successful mutating API action across workflows, steps, MCP, coding models, skills, sandboxes, secrets, connections, agents, and identity/access — using one central Fastify hook driven by declarative per-route config tags.

**Architecture:** A single `onResponse` hook in `api-server` reads a `config.audit` tag off the matched route and, on a 2xx response with an authenticated actor, writes one row to `jm_audit_log` via the existing `audit()` service. Routes opt in by adding a `config.audit` object; create routes additionally set `req.auditTargetId`. The pure entry-building logic lives in `@journeyman/api-context` and is unit-tested there.

**Tech Stack:** TypeScript, Fastify v5, PostgreSQL (`pg`), Vitest. npm workspaces monorepo.

**Execution constraints (from the requester):**
- **Work on `master` directly — do NOT create a branch or worktree.**
- **Do NOT commit.** Leave all changes in the working tree.
- **Run typecheck/tests only ONCE, at the very end** (final task). Skip per-task verification commits/runs.

---

## Background facts (verified against the codebase)

- `audit(pool, entry)` and the `AuditEntryInput` type already exist in
  [packages/api-context/src/services/audit.ts](../../../packages/api-context/src/services/audit.ts).
  `audit()` never throws (it swallows its own DB errors).
- `jm_audit_log` table already exists (migration `048_audit_log.sql`). **No migration needed.**
- `req.runContext` is populated by `makeRequireAuth()` ([packages/identity/src/middleware.ts](../../../packages/identity/src/middleware.ts))
  before any hook runs. Shape: `{ user: { id }, org: { id, slug }, workspace?: { orgId, ... }, ... }`.
- Fastify is **v5** — route config is read in a hook via `req.routeOptions.config`.
- Route files reuse shared option objects (e.g. `const write = { preHandler: [...] }`). **Never mutate the shared object** — always spread it: `{ ...write, config: { audit: {...} } }`.
- `api-server` has no test runner; `api-context` runs Vitest (`vitest run`) and already has `audit.test.ts`. The unit-testable logic therefore lives in `api-context`.

## `config.audit` tag shape

```ts
{ action: string; targetType: string; idParam?: string }
```

- `action` / `targetType` → written verbatim to the audit row.
- `idParam` → the route param holding the target id (default `"id"`). Used for routes whose id param is not `:id` (e.g. `:userId`, `:wsId`).
- The hook resolves `targetId` as: `req.auditTargetId` (set by create handlers) **else** `req.params[idParam]` **else** `null`.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `packages/identity/src/middleware.ts` | Fastify type augmentation | Add `auditTargetId`/`auditDetail` to `FastifyRequest` and `audit` to `FastifyContextConfig` |
| `packages/api-context/src/services/audit-entry.ts` | Pure: build an `AuditEntryInput` from request facts | **Create** |
| `packages/api-context/src/services/audit-entry.test.ts` | Unit tests for the pure function | **Create** |
| `packages/api-context/src/index.ts` | Package exports | Export `buildAuditEntry`, `AuditTag` |
| `packages/api-server/src/server-http.ts` | Register the `onResponse` hook | Modify |
| Route files (workflows, custom-steps, mcp, skills, sandbox, secrets×2, coding-models, connections, agents, agent-triggers, identity×5) | Add `config.audit` tags (+`req.auditTargetId` on creates); migrate existing inline `audit()` calls | Modify |

---

## Task 1: Fastify type augmentation

**Files:**
- Modify: `packages/identity/src/middleware.ts:10-12`

The existing augmentation block is:
```ts
declare module "fastify" {
  interface FastifyRequest { runContext?: RunContext; }
}
```

- [ ] **Step 1: Extend the augmentation block**

Replace the block above with:
```ts
declare module "fastify" {
  interface FastifyRequest {
    runContext?: RunContext;
    /** Set by create-route handlers so the audit hook can record the new entity id. */
    auditTargetId?: string | null;
    /** Optional extra context merged into the audit row's `detail` JSON. */
    auditDetail?: Record<string, unknown>;
  }
  interface FastifyContextConfig {
    /** Declarative audit tag read by the central onResponse hook in api-server. */
    audit?: { action: string; targetType: string; idParam?: string };
  }
}
```

This file is imported (via `makeRequireAuth`) by every route package, so the augmentation is visible everywhere routes set `config.audit` / `req.auditTargetId`. It adds no runtime import and stays within `@journeyman/identity` (shared layer) — no import-boundary impact.

---

## Task 2: Pure `buildAuditEntry()` + unit tests (TDD)

**Files:**
- Create: `packages/api-context/src/services/audit-entry.ts`
- Test: `packages/api-context/src/services/audit-entry.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/api-context/src/services/audit-entry.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildAuditEntry } from "./audit-entry.ts";

const rc = {
  user: { id: "u1" },
  org: { id: "o1" },
  workspace: { orgId: "ws-org" },
};

describe("buildAuditEntry", () => {
  it("returns null for a non-2xx response", () => {
    expect(buildAuditEntry({
      statusCode: 404, tag: { action: "workflow.update", targetType: "workflow" },
      runContext: rc, params: { id: "w1" },
    })).toBeNull();
  });

  it("returns null when there is no audit tag", () => {
    expect(buildAuditEntry({
      statusCode: 200, tag: undefined, runContext: rc, params: { id: "w1" },
    })).toBeNull();
  });

  it("returns null when there is no runContext (unauthenticated)", () => {
    expect(buildAuditEntry({
      statusCode: 200, tag: { action: "x", targetType: "y" },
      runContext: undefined, params: {},
    })).toBeNull();
  });

  it("prefers the workspace orgId over the org id", () => {
    const e = buildAuditEntry({
      statusCode: 200, tag: { action: "workflow.update", targetType: "workflow" },
      runContext: rc, params: { id: "w1" },
    });
    expect(e).toEqual({
      orgId: "ws-org", actorUserId: "u1", action: "workflow.update",
      targetType: "workflow", targetId: "w1", detail: {},
    });
  });

  it("falls back to the org id when there is no workspace", () => {
    const e = buildAuditEntry({
      statusCode: 200, tag: { action: "org.update", targetType: "org" },
      runContext: { user: { id: "u1" }, org: { id: "o1" } }, params: {},
    });
    expect(e!.orgId).toBe("o1");
    expect(e!.targetId).toBeNull();
  });

  it("reads targetId from a custom idParam", () => {
    const e = buildAuditEntry({
      statusCode: 200, tag: { action: "membership.update", targetType: "membership", idParam: "userId" },
      runContext: rc, params: { orgId: "o1", userId: "u9" },
    });
    expect(e!.targetId).toBe("u9");
  });

  it("prefers an explicit targetId (create routes) over params", () => {
    const e = buildAuditEntry({
      statusCode: 201, tag: { action: "workflow.create", targetType: "workflow" },
      runContext: rc, params: {}, explicitTargetId: "new-id", detail: { name: "X" },
    });
    expect(e!.targetId).toBe("new-id");
    expect(e!.detail).toEqual({ name: "X" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @journeyman/api-context -- audit-entry`
Expected: FAIL — `Cannot find module './audit-entry.ts'`.

- [ ] **Step 3: Implement `buildAuditEntry`**

Create `packages/api-context/src/services/audit-entry.ts`:
```ts
import type { AuditEntryInput } from "./audit.ts";

export interface AuditTag {
  action: string;
  targetType: string;
  idParam?: string;
}

export interface BuildAuditEntryArgs {
  statusCode: number;
  tag: AuditTag | undefined;
  runContext:
    | { user: { id: string }; org: { id: string }; workspace?: { orgId: string } }
    | undefined;
  params: Record<string, unknown>;
  explicitTargetId?: string | null;
  detail?: Record<string, unknown>;
}

/** Pure: derive the audit row from request facts, or null when nothing should be logged. */
export function buildAuditEntry(a: BuildAuditEntryArgs): AuditEntryInput | null {
  if (a.statusCode < 200 || a.statusCode >= 300) return null;
  if (!a.tag) return null;
  if (!a.runContext) return null;

  const orgId = a.runContext.workspace?.orgId ?? a.runContext.org.id;
  const paramKey = a.tag.idParam ?? "id";
  const fromParams = a.params[paramKey];
  const targetId =
    a.explicitTargetId != null
      ? a.explicitTargetId
      : typeof fromParams === "string"
        ? fromParams
        : null;

  return {
    orgId,
    actorUserId: a.runContext.user.id,
    action: a.tag.action,
    targetType: a.tag.targetType,
    targetId,
    detail: a.detail ?? {},
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -w @journeyman/api-context -- audit-entry`
Expected: PASS (7 tests).

- [ ] **Step 5: Export from the package index**

In `packages/api-context/src/index.ts`, below the existing audit export (line 5), add:
```ts
export { buildAuditEntry, type AuditTag, type BuildAuditEntryArgs } from "./services/audit-entry.ts";
```

---

## Task 3: Register the central `onResponse` hook

**Files:**
- Modify: `packages/api-server/src/server-http.ts`

- [ ] **Step 1: Import `buildAuditEntry` alongside the Composition import**

Change line 5:
```ts
import type { Composition } from "@journeyman/api-context";
```
to:
```ts
import type { Composition } from "@journeyman/api-context";
import { audit, buildAuditEntry } from "@journeyman/api-context";
```

- [ ] **Step 2: Add the hook immediately after the error handler (before any route registration)**

Insert after the `app.setErrorHandler(...)` block (currently ends at line 34), before `registerHealthRoutes(app);`:
```ts
  // Central audit trail: any route that declares `config.audit` gets one
  // jm_audit_log row on a successful (2xx) authenticated response. Registered
  // before route plugins so it applies to every encapsulated context too.
  if (c.pool) {
    const pool = c.pool;
    app.addHook("onResponse", async (req, reply) => {
      const tag = (req.routeOptions?.config as
        | { audit?: { action: string; targetType: string; idParam?: string } }
        | undefined)?.audit;
      const entry = buildAuditEntry({
        statusCode: reply.statusCode,
        tag,
        runContext: req.runContext,
        params: (req.params ?? {}) as Record<string, unknown>,
        explicitTargetId: req.auditTargetId ?? null,
        detail: req.auditDetail,
      });
      if (entry) await audit(pool, entry);
    });
  }
```

The hook is a no-op for: non-2xx responses, routes without a `config.audit` tag, and unauthenticated routes (no `runContext`) — including the public `/api/agents/:id/fire` and health routes.

---

## Task 4: Tag workflow routes

**Files:**
- Modify: `packages/api-http/src/routes/flows.ts`

The route options `write` / `del` are defined at lines 297-298. For each mutating route below, replace its options arg with the spread form shown, and for create/clone add the `req.auditTargetId` line inside the handler.

- [ ] **Step 1: Tag create (line 383) + capture new id**

Options → `{ ...write, config: { audit: { action: "workflow.create", targetType: "workflow" } } }`.
Inside the handler, after `const workflow = await c.workflows.create({...});` (line 396) and before `reply.code(201);`, add:
```ts
    req.auditTargetId = workflow.id;
    req.auditDetail = { name: body.name };
```

- [ ] **Step 2: Tag the remaining workflow routes** (options arg only — id comes from `:id`)

| Line | Method/Path | Options arg |
|---|---|---|
| 432 | PUT `/workspaces/:wsId/workflows/:id` | `{ ...write, config: { audit: { action: "workflow.update", targetType: "workflow" } } }` |
| 455 | DELETE `/workspaces/:wsId/workflows/:id` | `{ ...del, config: { audit: { action: "workflow.delete", targetType: "workflow" } } }` |
| 499 | POST `/workspaces/:wsId/workflows/:id/promote` | `{ ...write, config: { audit: { action: "workflow.promote", targetType: "workflow" } } }` |
| 560 | POST `/workspaces/:wsId/workflows/:id/rollback` | `{ ...write, config: { audit: { action: "workflow.rollback", targetType: "workflow" } } }` |
| 608 | POST `/workspaces/:wsId/workflows/:id/unpublish` | `{ ...write, config: { audit: { action: "workflow.unpublish", targetType: "workflow" } } }` |
| 666 | POST `/workspaces/:wsId/workflows/:id/clone` | `{ ...write, config: { audit: { action: "workflow.clone", targetType: "workflow" } } }` |

- [ ] **Step 3: Capture the clone's new id**

In the clone handler (POST `.../clone`), after the cloned `workflow` is created (the value returned at line 681), add before the `return`:
```ts
    req.auditTargetId = workflow.id;
```

---

## Task 5: Tag custom-step routes

**Files:**
- Modify: `packages/custom-steps/src/routes/workspace-custom-steps.ts`

Shared option objects `write` / `del` are used (lines as per inventory). Create routes return `rec` (use `rec.id`).

- [ ] **Step 1: Tag create routes + capture id**

| Line | Method/Path | Options arg | In-handler add |
|---|---|---|---|
| 103 | POST `/api/workspaces/:wsId/custom-steps` | `{ ...write, config: { audit: { action: "custom_step.create", targetType: "custom_step" } } }` | after `const rec = ...` (≈line 126): `req.auditTargetId = rec.id;` |
| 137 | POST `/api/workspaces/:wsId/custom-steps/import` | `{ ...write, config: { audit: { action: "custom_step.import", targetType: "custom_step" } } }` | after `const rec = ...` (≈line 158): `req.auditTargetId = rec.id;` |

- [ ] **Step 2: Tag state-change / update / delete routes** (id from `:id`)

| Line | Method/Path | Options arg |
|---|---|---|
| 187 | POST `.../custom-steps/:id/enable` | `{ ...write, config: { audit: { action: "custom_step.enable", targetType: "custom_step" } } }` |
| 200 | POST `.../custom-steps/:id/disable` | `{ ...write, config: { audit: { action: "custom_step.disable", targetType: "custom_step" } } }` |
| 209 | PATCH `.../custom-steps/:id` | `{ ...write, config: { audit: { action: "custom_step.update", targetType: "custom_step" } } }` |
| 239 | DELETE `.../custom-steps/:id` | `{ ...del, config: { audit: { action: "custom_step.delete", targetType: "custom_step" } } }` |

---

## Task 6: Tag MCP-instance routes

**Files:**
- Modify: `packages/mcp/src/routes/workspace-mcp.ts`

Create returns `rec` (`rec.id`).

- [ ] **Step 1: Tag all three routes**

| Line | Method/Path | Options arg | In-handler add |
|---|---|---|---|
| 43 | POST `/api/workspaces/:wsId/mcp-instances` | `{ ...write, config: { audit: { action: "mcp.create", targetType: "mcp_instance" } } }` | after `const rec = ...` (≈line 65): `req.auditTargetId = rec.id;` |
| 85 | PATCH `.../mcp-instances/:id` | `{ ...write, config: { audit: { action: "mcp.update", targetType: "mcp_instance" } } }` | — |
| 111 | DELETE `.../mcp-instances/:id` | `{ ...del, config: { audit: { action: "mcp.delete", targetType: "mcp_instance" } } }` | — |

---

## Task 7: Tag skill-package routes

**Files:**
- Modify: `packages/skills/src/routes/workspace-skills.ts`

- [ ] **Step 1: Tag the three routes** (id from `:id`; install creates so capture id)

| Line | Method/Path | Options arg | In-handler add |
|---|---|---|---|
| 30 | POST `/api/workspaces/:wsId/skill-packages` | `{ ...write, config: { audit: { action: "skill.install", targetType: "skill_package" } } }` | after the created record is obtained, set `req.auditTargetId` to that record's `id` (the value the handler returns) |
| 71 | DELETE `.../skill-packages/:id` | `{ ...del, config: { audit: { action: "skill.uninstall", targetType: "skill_package" } } }` | — |
| 86 | PUT `.../skill-packages/:id/enabled-skills` | `{ ...write, config: { audit: { action: "skill.update_enabled", targetType: "skill_package" } } }` | — |

---

## Task 8: Tag sandbox (execution-environment) routes

**Files:**
- Modify: `packages/sandbox/src/routes/index.ts`

These routes use inline options `{ preHandler: requireAuth({ role: "admin" }) }`. Add `config` to each.

- [ ] **Step 1: Tag the four routes**

| Line | Method/Path | Options arg | In-handler add |
|---|---|---|---|
| 51 | POST `/api/orgs/:orgId/sandboxes` | `{ preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "sandbox.create", targetType: "sandbox" } } }` | after the created sandbox is obtained, set `req.auditTargetId` to its `id` |
| 82 | PATCH `.../sandboxes/:id` | `{ preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "sandbox.update", targetType: "sandbox" } } }` | — |
| 105 | POST `.../sandboxes/:id/rebuild` | `{ preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "sandbox.rebuild", targetType: "sandbox" } } }` | — |
| 114 | DELETE `.../sandboxes/:id` | `{ preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "sandbox.delete", targetType: "sandbox" } } }` | — |

---

## Task 9: Tag secret routes (workspace + org)

**Secret rule:** `detail` carries name only — NEVER the secret value. The hook's default `detail` is `{}`; these tasks add no value-bearing `auditDetail`, so no value can leak.

**Files:**
- Modify: `packages/secrets/src/routes/workspace-secrets.ts` — create returns `rec` (`rec.id`)
- Modify: `packages/secrets/src/routes/org-secrets.ts` — create returns `rec` (`rec.id`)

- [ ] **Step 1: workspace-secrets.ts**

| Line | Method/Path | Options arg | In-handler add |
|---|---|---|---|
| 23 | POST `/api/workspaces/:wsId/secrets` | `{ preHandler: [requireAuth(), requirePerm("resource.write")], config: { audit: { action: "secret.create", targetType: "secret" } } }` | after `const rec = await insertWorkspaceSecret(...)` (line 31): `req.auditTargetId = rec.id; req.auditDetail = { name: rec.name };` |
| 44 | PATCH `.../secrets/:id` | `{ preHandler: [requireAuth(), requirePerm("resource.write")], config: { audit: { action: "secret.update", targetType: "secret" } } }` | — |
| 58 | DELETE `.../secrets/:id` | `{ preHandler: [requireAuth(), requirePerm("resource.delete")], config: { audit: { action: "secret.delete", targetType: "secret" } } }` | — |

- [ ] **Step 2: org-secrets.ts**

| Line | Method/Path | Options arg | In-handler add |
|---|---|---|---|
| 23 | POST `/api/orgs/:orgId/secrets` | `{ preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "secret.create", targetType: "secret" } } }` | after `const rec = await insertOrgSecret(...)` (line 31): `req.auditTargetId = rec.id; req.auditDetail = { name: rec.name };` |
| 44 | PATCH `.../secrets/:id` | `{ preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "secret.update", targetType: "secret" } } }` | — |
| 58 | DELETE `.../secrets/:id` | `{ preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "secret.delete", targetType: "secret" } } }` | — |

---

## Task 10: Tag coding-model routes

**Files:**
- Modify: `packages/coding-models/src/routes/org.ts`

- [ ] **Step 1: Tag the three routes**

| Line | Method/Path | Options arg | In-handler add |
|---|---|---|---|
| 50 | POST `/api/orgs/:orgId/coding-models` | `{ preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "coding_model.create", targetType: "coding_model" } } }` | after the created model is obtained, set `req.auditTargetId` to its `id` |
| 95 | PATCH `.../coding-models/:id` | `{ preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "coding_model.update", targetType: "coding_model" } } }` | — |
| 141 | DELETE `.../coding-models/:id` | `{ preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "coding_model.delete", targetType: "coding_model" } } }` | — |

- [ ] **Step 2: Check for a separate pricing route file**

Run: `grep -rn "pricing" packages/coding-models/src/routes/`
If a pricing CRUD route file exists, tag its create/update/delete the same way with `targetType: "model_pricing"` and actions `model_pricing.create|update|delete`. If none exists, do nothing.

---

## Task 11: Tag identity routes (orgs, workspaces, api-tokens, user-management, users)

These routes use inline `{ preHandler: requireAuth(...) }`. Add `config` to each. Note the non-default `idParam` values.

**Files & edits:**

- [ ] **Step 1: `packages/identity/src/routes/orgs.ts`**

| Line | Method/Path | Options arg | In-handler add |
|---|---|---|---|
| 23 | POST `/api/orgs/:orgId/invitations` | `{ preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "membership.invite", targetType: "membership" } } }` | after `const user = await createInvite(...)` (line 34): `req.auditTargetId = user.id; req.auditDetail = { username: body.username, role: body.role };` |
| 41 | DELETE `/api/orgs/:orgId/memberships/:userId` | `{ preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "membership.remove", targetType: "membership", idParam: "userId" } } }` | — |
| 54 | PATCH `/api/orgs/:orgId/memberships/:userId` | `{ preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "membership.update_role", targetType: "membership", idParam: "userId" } } }` | after the role check, before `return { ok: true }` (line 66): `req.auditDetail = { role: body.role };` |

- [ ] **Step 2: `packages/identity/src/routes/workspaces.ts`**

| Line | Method/Path | Options arg | In-handler add |
|---|---|---|---|
| 50 | POST `/api/orgs/:orgId/workspaces` | `{ preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "workspace.create", targetType: "workspace" } } }` | after `const ws = await createWorkspace(...)` (line 57): `req.auditTargetId = ws.id; req.auditDetail = { name: ws.name, slug: ws.slug };` |
| 74 | PATCH `/api/orgs/:orgId/workspaces/:wsId` | `{ preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "workspace.update", targetType: "workspace", idParam: "wsId" } } }` | — |
| 92 | DELETE `/api/orgs/:orgId/workspaces/:wsId` | `{ preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "workspace.delete", targetType: "workspace", idParam: "wsId" } } }` | — |

- [ ] **Step 3: `packages/identity/src/routes/api-tokens.ts`**

| Line | Method/Path | Options arg | In-handler add |
|---|---|---|---|
| 20 | POST `/api/orgs/:orgId/api-tokens` | `{ preHandler: requireAuth(), config: { audit: { action: "api_token.create", targetType: "api_token" } } }` | after `const row = await insertApiToken(...)` (line 29): `req.auditTargetId = row.id; req.auditDetail = { name: row.name };` |
| 37 | DELETE `/api/orgs/:orgId/api-tokens/:id` | `{ preHandler: requireAuth(), config: { audit: { action: "api_token.revoke", targetType: "api_token" } } }` | — |

- [ ] **Step 4: `packages/identity/src/routes/user-management.ts`** (params: `:userId`)

| Line | Method/Path | Options arg |
|---|---|---|
| 22 | PATCH `/api/orgs/:orgId/users/:userId/status` | `{ preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "user.update_status", targetType: "user", idParam: "userId" } } }` |
| 43 | POST `/api/orgs/:orgId/users/:userId/reset-password` | `{ preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "user.reset_password", targetType: "user", idParam: "userId" } } }` |
| 58 | PATCH `/api/orgs/:orgId/users/:userId/profile` | `{ preHandler: requireAuth({ role: "admin" }), config: { audit: { action: "user.update_profile", targetType: "user", idParam: "userId" } } }` |

- [ ] **Step 5: `packages/identity/src/routes/users.ts`** (self-service; target is the acting user)

| Line | Method/Path | Options arg | In-handler add |
|---|---|---|---|
| 10 | POST `/api/users/me/password` | `{ preHandler: requireAuth(), config: { audit: { action: "user.change_password", targetType: "user" } } }` | inside handler: `req.auditTargetId = req.runContext!.user.id;` |
| 26 | PATCH `/api/users/me` | `{ preHandler: requireAuth(), config: { audit: { action: "user.update_self", targetType: "user" } } }` | inside handler: `req.auditTargetId = req.runContext!.user.id;` |

---

## Task 12: Close the connection-update gap + migrate existing connection audit

**Files:**
- Modify: `packages/api-http/src/routes/connections.ts`

This file already calls `audit()` inline for create (line 206) and delete (line 257). To keep exactly ONE audit path, migrate those to config and add the missing update tag. After this, the `audit` import becomes unused — remove it.

- [ ] **Step 1: Migrate create (line 179 / inline audit at 206)**

Set options → `{ ...write, config: { audit: { action: "connection.create", targetType: "connection" } } }`.
Delete the inline `await audit(pool, { ... action: "connection.create" ... });` call (line 206).
Replace it with:
```ts
    req.auditTargetId = conn.id;
    req.auditDetail = { category: body.category, provider: body.provider, label: conn.label };
```

- [ ] **Step 2: Add update tag (line 225 — currently NO audit)**

Set options → `{ ...write, config: { audit: { action: "connection.update", targetType: "connection" } } }`.
No inline call to add (the hook handles it; id from `:id`).

- [ ] **Step 3: Migrate delete (line 246 / inline audit at 257)**

Set options → `{ ...write, config: { audit: { action: "connection.delete", targetType: "connection" } } }`.
Delete the inline `await audit(pool, { ... action: "connection.delete" ... });` call (line 257).
Replace it with:
```ts
    req.auditDetail = { label: conn.label };
```

- [ ] **Step 4: Remove the now-unused `audit` import**

At the top of the file (import line 19 per inventory), remove `audit` from the `@journeyman/api-context` import. If `listAudit` or other names are imported on the same line, keep those; only drop `audit`. If `audit` was the only name, delete the whole import line.

---

## Task 13: Migrate agent audit to config + tag agent-settings

**Files:**
- Modify: `packages/api-http/src/routes/agents.ts`

All seven mutating agent routes already call `audit()` inline. Migrate each to a `config.audit` tag and move any `detail`/created-id into `req.auditDetail` / `req.auditTargetId`. Then drop the now-unused `audit` import (keep `listAudit`, still used by the GET audit route).

- [ ] **Step 1: create (line 66; inline audit line 84)**

Options → `{ ...write, config: { audit: { action: "agent.create", targetType: "agent" } } }`.
Replace the inline `await audit(pool, { ... action: "agent.create" ... });` (line 84) with:
```ts
      req.auditTargetId = agent.id;
      req.auditDetail = { name };
```

- [ ] **Step 2: update / enable / disable (lines 108 / 134 / 154; inline audits 122 / 149 / 164)**

Set each route's options to spread `write` + config, and delete its inline `audit()` call (no replacement needed — id comes from `:id`, no detail):

| Route | Options arg | Inline call to delete |
|---|---|---|
| PATCH `.../agents/:id` (108) | `{ ...write, config: { audit: { action: "agent.update", targetType: "agent" } } }` | line 122 |
| POST `.../agents/:id/enable` (134) | `{ ...write, config: { audit: { action: "agent.enable", targetType: "agent" } } }` | line 149 |
| POST `.../agents/:id/disable` (154) | `{ ...write, config: { audit: { action: "agent.disable", targetType: "agent" } } }` | line 164 |

- [ ] **Step 3: delete (line 169; inline audit 178)**

Options → `{ ...write, config: { audit: { action: "agent.delete", targetType: "agent" } } }`.
Replace the inline `audit()` call (line 178) with:
```ts
    req.auditDetail = { name: agent.name };
```
(Keep `reply.code(204);` — 204 is 2xx, so the hook fires.)

- [ ] **Step 4: run (line 183; inline audit 201)**

Options → `{ ...write, config: { audit: { action: "agent.run", targetType: "agent" } } }`.
Replace the inline `audit()` call (line 201) with:
```ts
      req.auditDetail = { workflowInstanceId: res.workflowInstanceId };
```
(The `429`/`422` early returns stay non-2xx, so no audit on skip/error — same as today.)

- [ ] **Step 5: agent-settings (line 311; inline audit ~323)**

Options → `{ preHandler: requireAuth(), config: { audit: { action: "org_settings.update", targetType: "org_settings" } } }`.
Replace the inline `audit()` call (lines 323-330) with:
```ts
    req.auditDetail = { paused: next.paused };
```
(No `:id` param → `targetId` resolves to `null`, matching today's explicit `targetId: null`. `orgId` resolves from `runContext.org.id` since this route is org-scoped with no workspace.)

- [ ] **Step 6: Drop the unused `audit` import**

Change the import at line 20 from `import { audit, listAudit } from "@journeyman/api-context";` to `import { listAudit } from "@journeyman/api-context";`.

---

## Task 14: Migrate agent-token audit + close the toggle gap

**Files:**
- Modify: `packages/api-http/src/routes/agent-triggers.ts`

Issue (line 43) and revoke (line 76) already audit inline; the toggle PATCH (line 81) does not. Migrate the two and tag the third, then drop the unused `audit` import.

- [ ] **Step 1: issue (line 30; inline audit 43)**

Options → `{ ...write, config: { audit: { action: "agent.token.issue", targetType: "agent" } } }`.
Replace the inline `audit()` call (line 43) with:
```ts
    req.auditDetail = { tokenId: rows[0].id };
```

- [ ] **Step 2: revoke (line 67; inline audit 76)**

Options → `{ ...write, config: { audit: { action: "agent.token.revoke", targetType: "agent" } } }`.
Replace the inline `audit()` call (line 76) with:
```ts
    req.auditDetail = { tokenId };
```

- [ ] **Step 3: toggle (line 81 — currently NO audit)**

Options → `{ ...write, config: { audit: { action: "agent.token.toggle", targetType: "agent" } } }`.
Before `reply.code(204);` (line 99), add:
```ts
    req.auditDetail = { tokenId, disabled: body.disabled };
```
(`targetId` resolves to the agent `:id` from params — matching the issue/revoke convention.)

- [ ] **Step 4: Drop the unused `audit` import**

Remove `import { audit } from "@journeyman/api-context";` (line 6).

---

## Task 15: Tag webhook routes

**Files:**
- Modify: `packages/api-webhooks/src/routes/webhooks-management.ts`

No existing inline `audit()` calls here — pure tagging. Shared `write` object is defined at line 42; PATCH/DELETE/rotate use inline `{ preHandler: requireAuth() }`. Create returns `created` (`created.id`). The `webhook-presets.ts` file has no mutating routes — leave it untouched.

- [ ] **Step 1: Tag create + capture id (line 50)**

Options → `{ ...write, config: { audit: { action: "webhook.create", targetType: "webhook" } } }`.
After `const created = await c.webhooks.create(...)` (line 55-58) and before `reply.code(201);`, add:
```ts
    req.auditTargetId = created.id;
```

- [ ] **Step 2: Tag the remaining routes** (id from `:id`)

| Line | Method/Path | Options arg |
|---|---|---|
| 93 | PATCH `/api/webhooks/:id` | `{ preHandler: requireAuth(), config: { audit: { action: "webhook.update", targetType: "webhook" } } }` |
| 107 | DELETE `/api/webhooks/:id` | `{ preHandler: requireAuth(), config: { audit: { action: "webhook.delete", targetType: "webhook" } } }` |
| 116 | POST `/api/webhooks/:id/rotate` | `{ preHandler: requireAuth(), config: { audit: { action: "webhook.rotate", targetType: "webhook" } } }` |

Do NOT tag `POST /api/webhooks/:id/test` (line 126) — it sends a test payload, it is not a config change.

---

## Task 16: Final verification (run once, at the end)

**No commits. Run from the repo root.**

- [ ] **Step 1: Typecheck all workspaces**

Run: `npm run typecheck`
Expected: PASS with no errors. (Catches: unused `audit` imports from Tasks 12-14, any `config.audit` shape mismatch, any missing `req.auditTargetId` typing.)

- [ ] **Step 2: Import-boundary check**

Run: `npm run check:boundaries`
Expected: PASS — no new violations. (`api-server` → `api-context` is an existing backend→backend edge; route packages gained no new cross-package import, only plain config data + the type augmentation in `identity`.)

- [ ] **Step 3: Run the api-context unit tests**

Run: `npm test -w @journeyman/api-context`
Expected: PASS — including the new `audit-entry.test.ts` (7 tests) and the existing `audit.test.ts`.

- [ ] **Step 4: Sanity-grep for leftover inline audit calls**

Run: `grep -rn "await audit(" packages/api-http packages/api-webhooks packages/api-context | grep -v "audit-entry"`
Expected: NO matches in `api-http`/`api-webhooks` route files (all migrated to config). Matches only inside `api-context` service internals, if any.

---

## Out of scope (do NOT implement here)

- A UI to browse the audit log.
- Recording failed/unauthorized attempts (only 2xx mutations are logged).
- Full before/after field diffs.
- `POST /api/agents/:id/fire` (token-authenticated run trigger — no user actor), form-submission, and per-run workflow-instance actions.
- **`form` and `workflow_trigger`** appeared in the spec's resource table, but the current codebase exposes **no dedicated CRUD routes** for them — forms live inside workflow definitions (only a `form-submissions` run route exists in `forms.ts`), and `workflow-triggers.ts` has only a `GET`. There is nothing to tag today. If/when CRUD routes are added, they inherit the pattern by adding a `config.audit` tag.
