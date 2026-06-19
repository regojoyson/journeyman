# Workspace Scoping — Phase 2i: Webhooks Cutover — Implementation Plan

> Executed by a cheaper model: follow literally. Hard contracts specified; no design decisions. STOP and report if a typecheck error can't be fixed with a minimal edit per this plan.

**Goal:** Make webhooks **workspace-scoped**. `jm_webhooks`: drop the `org_id`/`user_id` XOR model → add `workspace_id`. **Keep `org_id`** (derived from workspace at create) so the secret resolver can look up org-scoped secrets without an extra join. Collapse `/api/orgs/:orgId/webhooks` + `/api/users/me/webhooks` into `/api/workspaces/:wsId/webhooks`. Delete the promote-from-user route (concept is gone). Fix the `TODO(webhooks cutover)` shim in `webhook-secret-lookup.ts`.

**Branch:** `feat/workspace-scoping-phase-2b`. **Migration:** `057`. **Clean break:** delete existing webhook rows.

**Ingest path is SAFE:** `POST /webhooks/in/:tenantToken` loads by `tenant_token` (no scope) and does not care about scope. After this cutover, the same route works unchanged — the returned `Webhook` object has `workspaceId`/`orgId` instead of `scope`, and the two places that read `webhook.scope` (`webhook-ingest.ts:74` and `webhooks-management.ts:188`) are updated inline.

**Batched workflow:** all edits → one `npm run migrate` → one `npm run typecheck` + `check:boundaries` → one commit.

---

## Edits

### 1. Migration `packages/migrations/src/sql/057_webhooks_workspace_scope.sql`

```sql
-- 057_webhooks_workspace_scope.sql
-- Webhooks become workspace-scoped (org_id retained, derived from the workspace).
-- Clean break: existing rows carry no workspace.
DELETE FROM jm_webhooks;
ALTER TABLE jm_webhooks DROP CONSTRAINT IF EXISTS jm_webhooks_scope_xor;
DROP INDEX IF EXISTS jm_webhooks_org_idx;
DROP INDEX IF EXISTS jm_webhooks_user_idx;
ALTER TABLE jm_webhooks DROP COLUMN user_id;
-- org_id is RETAINED (derived from the workspace at create; used for secret resolution).
-- Make it NOT NULL now that the XOR constraint is gone:
ALTER TABLE jm_webhooks ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE jm_webhooks
  ADD COLUMN workspace_id UUID NOT NULL REFERENCES jm_workspaces(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_jm_webhooks_workspace ON jm_webhooks (workspace_id);
```

Run `npm run migrate` once.

### 2. Core `packages/core/src/types/webhook.types.ts`

- Delete `export type WebhookScope = { orgId: string } | { userId: string };`
- `Webhook` interface: replace `scope: WebhookScope` with `workspaceId: string` and `orgId: string` (keep them at the top of the interface, after `id`).
- No other changes to this file (all other fields stay).

### 3. Core `packages/core/src/interfaces/webhook-store.interface.ts`

- Import: remove `WebhookScope` from the imports.
- `CreateWebhookArgs`: replace `scope: WebhookScope` with `workspaceId: string` and `orgId: string`.
- `listByScope(scope: WebhookScope): Promise<Webhook[]>` → `listByWorkspace(workspaceId: string): Promise<Webhook[]>`.
- `IWebhookStore` interface body: replace the `listByScope` signature with `listByWorkspace`.

### 4. `packages/orchestrator/src/stores/postgres/postgres-webhook-store.ts`

- Import: remove `WebhookScope`.
- `rowToWebhook`: replace `const scope: WebhookScope = ...` block with:
  ```ts
  workspaceId: row.workspace_id,
  orgId: row.org_id,
  ```
  (remove the `scope` field from the returned object).
- `create(args, tenantToken)`:
  - Replace `const orgId = "orgId" in args.scope ? args.scope.orgId : null;` and `const userId = ...` with:
    ```ts
    const { workspaceId, orgId } = args;
    ```
  - INSERT column list: replace `(org_id, user_id, ...)` with `(workspace_id, org_id, ...)`.
  - Values array: replace `[orgId, userId, ...]` with `[workspaceId, orgId, ...]`.
- `listByScope` → `listByWorkspace(workspaceId: string)`:
  ```ts
  async listByWorkspace(workspaceId: string): Promise<Webhook[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM jm_webhooks WHERE workspace_id = $1 ORDER BY created_at ASC`,
      [workspaceId],
    );
    return rows.map(rowToWebhook);
  }
  ```

### 5. `packages/api-server/src/services/webhook-secret-lookup.ts`

Replace the entire function body of `resolveWebhookSecret` with a workspace-cascade implementation, and update its signature:

```ts
import type { Pool } from "pg";
import type { WebhookAuthConfig } from "@journeyman/core";
import { open, readGlobalSecrets } from "@journeyman/secrets";

const NAME_RE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Resolve a named secret for a webhook. Cascades: workspace secret first,
 * then org secret. Returns null if the name is empty/invalid or no row found.
 */
export async function resolveWebhookSecret(
  pool: Pool,
  orgId: string,
  secretName: string | undefined | null,
  workspaceId?: string | null,
): Promise<string | null> {
  if (!secretName) return null;
  if (!NAME_RE.test(secretName)) return null;

  if (workspaceId) {
    const r = await pool.query(
      `SELECT ciphertext, iv, auth_tag FROM jm_secrets WHERE workspace_id = $1 AND name = $2`,
      [workspaceId, secretName],
    );
    if (r.rows[0]) {
      const row = r.rows[0];
      return open({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag });
    }
  }

  const r = await pool.query(
    `SELECT ciphertext, iv, auth_tag FROM jm_secrets WHERE org_id = $1 AND workspace_id IS NULL AND name = $2`,
    [orgId, secretName],
  );
  const row = r.rows[0];
  if (!row) return null;
  return open({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag });
}

export function secretRefFromAuth(auth: WebhookAuthConfig): string | null {
  switch (auth.mode) {
    case "none": return null;
    case "header-equals": return auth.valueRef || null;
    case "hmac": return auth.secretRef || null;
    case "jwt": return auth.signingKeyRef || null;
  }
}

export async function secretExistsInOrgScope(
  pool: Pool,
  orgId: string,
  name: string,
): Promise<boolean> {
  if (!name) return false;
  const globals = readGlobalSecrets();
  if (name in globals) return true;
  const r = await pool.query(
    `SELECT 1 FROM jm_secrets WHERE org_id = $1 AND workspace_id IS NULL AND name = $2 LIMIT 1`,
    [orgId, name],
  );
  return r.rowCount !== null && r.rowCount > 0;
}
```

### 6. `packages/api-server/src/services/webhook-ingest.ts`

Line 74 — change the `resolveWebhookSecret` call:
```ts
// Before:
resolvedSecret = await resolveWebhookSecret(pool, webhook.scope, secretRef);
// After:
resolvedSecret = await resolveWebhookSecret(pool, webhook.orgId, secretRef, webhook.workspaceId);
```
No other changes in this file.

### 7. `packages/api-server/src/routes/webhooks-management.ts`

Complete rewrite of this file:

```ts
import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { makeRequireAuth, makeRequireWorkspacePermission } from "@journeyman/identity";
import { getPreset, lintJsonSchema } from "@journeyman/webhooks";
import type { CreateWebhookArgs, PresetId, UpdateWebhookArgs, Webhook } from "@journeyman/core";
import type { Composition } from "../composition.ts";
import { buildTestDeliveryHeaders, eventTypeHeaderForSample } from "../services/webhook-test-delivery.ts";
import { resolveWebhookSecret, secretRefFromAuth } from "../services/webhook-secret-lookup.ts";

function mintToken(): string { return randomBytes(24).toString("hex"); }

function ingestUrlFor(req: FastifyRequest, tenantToken: string): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "http";
  const host = (req.headers["x-forwarded-host"] as string) || req.headers.host || "localhost";
  return `${proto}://${host}/webhooks/in/${tenantToken}`;
}

function withIngestUrl(req: FastifyRequest, w: Webhook): Webhook {
  return { ...w, ingestUrl: ingestUrlFor(req, w.tenantToken) };
}

type CreateBody = Omit<CreateWebhookArgs, "workspaceId" | "orgId">;

function validateCreateBody(body: unknown): CreateBody | { error: string } {
  if (!body || typeof body !== "object") return { error: "missing_body" };
  const b = body as Record<string, unknown>;
  if (typeof b.name !== "string" || !b.name) return { error: "missing_name" };
  if (typeof b.preset !== "string") return { error: "missing_preset" };
  if (b.kind !== "ticket" && b.kind !== "git") return { error: "bad_kind" };
  if (!b.auth || typeof b.auth !== "object") return { error: "missing_auth" };
  if (b.payloadSchema !== undefined && b.payloadSchema !== null) {
    const lint = lintJsonSchema(b.payloadSchema);
    if (!lint.ok) return { error: `bad_schema: ${lint.errors.join("; ")}` };
  }
  return b as unknown as CreateBody;
}

export function registerWebhookManagementRoutes(app: FastifyInstance, c: Composition): void {
  const requireAuth = makeRequireAuth({ pool: c.pool! });
  const requirePerm = makeRequireWorkspacePermission({ pool: c.pool! });
  const read = { preHandler: [requireAuth(), requirePerm("resource.read")] };
  const write = { preHandler: [requireAuth(), requirePerm("resource.write")] };

  app.get("/api/workspaces/:wsId/webhooks", read, async (req) => {
    const { wsId } = req.params as { wsId: string };
    const list = await c.webhooks.listByWorkspace(wsId);
    return list.map((w) => withIngestUrl(req, w));
  });

  app.post("/api/workspaces/:wsId/webhooks", write, async (req, reply) => {
    const { wsId } = req.params as { wsId: string };
    const ctx = req.runContext!;
    const v = validateCreateBody(req.body);
    if ("error" in v) return reply.code(400).send(v);
    const created = await c.webhooks.create(
      { ...v, workspaceId: wsId, orgId: ctx.workspace!.orgId },
      mintToken(),
    );
    reply.code(201);
    return withIngestUrl(req, created);
  });

  /** Load a webhook and 404/403 unless the user's org owns it. */
  async function load(req: FastifyRequest, id: string): Promise<Webhook | { error: string; code: number }> {
    const w = await c.webhooks.getById(id);
    if (!w) return { error: "not_found", code: 404 };
    if (w.orgId !== req.runContext!.org.id) return { error: "forbidden", code: 403 };
    return w;
  }

  app.get("/api/webhooks/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await load(req, id);
    if ("error" in r) return reply.code(r.code).send({ error: r.error });
    return withIngestUrl(req, r);
  });

  app.get("/api/webhooks/:id/events", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await load(req, id);
    if ("error" in r) return reply.code(r.code).send({ error: r.error });
    const q = req.query as { page?: string; page_size?: string };
    const page = Math.max(1, Number(q.page ?? 1) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(q.page_size ?? 25) || 25));
    const offset = (page - 1) * pageSize;
    const [events, total] = await Promise.all([
      c.webhookEvents.listByWebhook(id, { limit: pageSize, offset }),
      c.webhookEvents.countByWebhook(id),
    ]);
    return { events, total, page, pageSize };
  });

  app.patch("/api/webhooks/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await load(req, id);
    if ("error" in r) return reply.code(r.code).send({ error: r.error });
    const body = req.body as UpdateWebhookArgs;
    if (body?.payloadSchema !== undefined && body.payloadSchema !== null) {
      const lint = lintJsonSchema(body.payloadSchema);
      if (!lint.ok) return reply.code(400).send({ error: `bad_schema: ${lint.errors.join("; ")}` });
    }
    const updated = await c.webhooks.update(id, body);
    if (!updated) return reply.code(404).send({ error: "not_found" });
    return withIngestUrl(req, updated);
  });

  app.delete("/api/webhooks/:id", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await load(req, id);
    if ("error" in r) return reply.code(r.code).send({ error: r.error });
    const ok = await c.webhooks.delete(id);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });

  app.post("/api/webhooks/:id/rotate", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await load(req, id);
    if ("error" in r) return reply.code(r.code).send({ error: r.error });
    const newToken = mintToken();
    const updated = await c.webhooks.rotateToken(id, newToken);
    if (!updated) return reply.code(404).send({ error: "not_found" });
    return withIngestUrl(req, updated);
  });

  app.post("/api/webhooks/:id/test", { preHandler: requireAuth() }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await load(req, id);
    if ("error" in r) return reply.code(r.code).send({ error: r.error });
    const body = (req.body ?? {}) as { sampleEvent?: string; payload?: unknown; eventType?: string };
    let payload: unknown = body.payload;
    if (payload === undefined && body.sampleEvent) {
      const preset = getPreset(r.preset as PresetId);
      payload = preset?.samples?.[body.sampleEvent];
      if (payload === undefined) return reply.code(400).send({ error: "no_such_sample" });
    }
    if (payload === undefined) return reply.code(400).send({ error: "no_payload" });
    const rawBody = Buffer.from(JSON.stringify(payload), "utf8");
    const secretRef = secretRefFromAuth(r.auth);
    const resolvedSecret = c.pool
      ? await resolveWebhookSecret(c.pool, r.orgId, secretRef, r.workspaceId)
      : null;
    const headers = buildTestDeliveryHeaders(r, rawBody, resolvedSecret);
    if (!headers) return reply.code(501).send({ error: "auth_mode_not_synthesizable" });
    const evtHeader = eventTypeHeaderForSample(r.eventTypePath, body.sampleEvent ?? body.eventType);
    if (evtHeader) headers[evtHeader.name] = evtHeader.value;
    const injected = await app.inject({
      method: "POST",
      url: `/webhooks/in/${r.tenantToken}`,
      headers,
      payload: rawBody,
    });
    let parsed: unknown = injected.body;
    try { parsed = JSON.parse(injected.body); } catch { /* keep raw */ }
    reply.code(200);
    return { ingestStatus: injected.statusCode, ingestBody: parsed };
  });
}
```

Note: The `promote-from-user` route is **deleted** (no promote concept with workspace-only model).

### 8. Web `packages/web/src/api/webhooks.ts`

- Add `listWebhooks(wsId: string): Promise<Webhook[]>` → `GET /api/workspaces/${wsId}/webhooks`
- Add `createWebhook(wsId: string, body: Omit<CreateWebhookArgs, "workspaceId" | "orgId">): Promise<Webhook>` → `POST /api/workspaces/${wsId}/webhooks`
- Remove: `listMyWebhooks`, `listOrgWebhooks`, `createMyWebhook`, `createOrgWebhook`, `promoteWebhookToOrg`
- Keep: `getWebhook`, `updateWebhook`, `deleteWebhook`, `rotateWebhook`, `testWebhook`, `listPresets`, `getPresetDetail`, `listWebhookEvents` (all stay on `/api/webhooks/:id` paths, unchanged)
- The `CreateWebhookArgs` import from `@journeyman/core` is used for the create body type.

Minimal rewrite:

```ts
import type { CreateWebhookArgs, PresetId, UpdateWebhookArgs, Webhook, WebhookEvent } from "@journeyman/core";
import { api } from "./client.ts";

export interface WebhookPresetSummary { /* ... unchanged ... */ }
export interface WebhookPresetDetail extends WebhookPresetSummary { /* ... unchanged ... */ }

export function listWebhooks(wsId: string): Promise<Webhook[]> {
  return api<Webhook[]>(`/api/workspaces/${encodeURIComponent(wsId)}/webhooks`);
}

export function createWebhook(wsId: string, body: Omit<CreateWebhookArgs, "workspaceId" | "orgId">): Promise<Webhook> {
  return api<Webhook>(`/api/workspaces/${encodeURIComponent(wsId)}/webhooks`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// unchanged: getWebhook, updateWebhook, deleteWebhook, rotateWebhook, testWebhook,
//            listPresets, getPresetDetail, listWebhookEvents
```

### 9. Web pages

**`packages/web/src/routes/MyWebhooksPage.tsx`**
- Replace `listMyWebhooks()` with `listWebhooks("")` (wsId="" placeholder, Phase 3 wires real id).
- Drop `PromoteWebhookDialog` import and usage (the "Promote to org →" button and the `promoting` state).
- `WebhookCreateWizard` prop `scope={{ userId: "me" }}` → `wsId={""}`.

**`packages/web/src/routes/AdminWebhooksPage.tsx`**
- Replace `listOrgWebhooks(props.orgId)` with `listWebhooks("")`.
- Remove `orgId` prop (or keep it but ignore it — safest is to keep the prop signature for now since App.tsx still passes it).
- `WebhookCreateWizard` prop `scope={{ orgId: props.orgId }}` → `wsId={""}`.

**`packages/web/src/routes/webhooks/WebhookCreateWizard.tsx`**
- Replace `scope: { orgId: string } | { userId: "me" }` prop with `wsId: string`.
- Remove `activeOrgId`/`role` from `useAuth()` (no longer needed for scope branching).
- Replace the `createMyWebhook`/`createOrgWebhook` conditional call with a single `createWebhook(wsId, body)`.
- Remove imports: `createMyWebhook`, `createOrgWebhook`. Add: `createWebhook`.

**`packages/web/src/routes/webhooks/PromoteWebhookDialog.tsx`** — **DELETE THIS FILE**.
- Remove its import from `MyWebhooksPage.tsx`.

**`packages/web/src/routes/WebhookDetailPage.tsx`** — no changes needed (loads by id; doesn't render `webhook.scope`).

**`packages/web/src/App.tsx`** — both webhook routes already pass `orgId`; that prop is kept on `AdminWebhooksPage` to not break anything. No changes needed unless `AdminWebhooksPage` type signature changes — if you drop the prop, update App.tsx accordingly.

### 10. Verify + commit (once)

```
npm run migrate
npm run typecheck            # clean across all workspaces
npm run check:boundaries
git checkout feat/workspace-scoping-phase-2b
git add -A
git commit -m "feat(webhooks): workspace-scoped webhooks (migration 057; drop user/org XOR, keep org_id; delete promote route)"
git cat-file -e HEAD:packages/migrations/src/sql/057_webhooks_workspace_scope.sql && echo "057 in HEAD ✓"
```

If any test constructs a `Webhook` or `CreateWebhookArgs` with `scope`, update to `workspaceId`/`orgId`. The `loader.samples.test.ts` in `@journeyman/webhooks` tests preset loading only — no DB types — and needs no changes.

---

## Notes

- **`org_id` RETAINED** on `jm_webhooks` (set from `ctx.workspace!.orgId` at create) so `resolveWebhookSecret` can look up org-scoped secrets without an extra join to `jm_workspaces`.
- **Ingest path unchanged**: `POST /webhooks/in/:tenantToken` loads by `tenant_token`, never reads scope. The two `webhook.scope` reads in `webhook-ingest.ts` and `webhooks-management.ts` are updated to `webhook.orgId`/`webhook.workspaceId`.
- **Promote route deleted**: "promote user-scope to org-scope" is replaced by "create in workspace" — there is nothing to promote.
- **By-id routes kept** (`/api/webhooks/:id`, events, patch, delete, rotate, test): these are used by `WebhookDetailPage` which loads a webhook by URL param with no workspace context. The ownership check changes from `scope.orgId === ctx.org.id || scope.userId === ctx.user.id` to simply `w.orgId === ctx.org.id` — any org member can access their org's webhooks by id. Phase 3 (sidebar wsId wiring) will tighten this if needed.
- **`TODO(webhooks cutover)` shim** in `webhook-secret-lookup.ts` is resolved by the cascade implementation in step 5.
- **`webhook-trigger-fire.ts`** and **`agent-webhook-fire.ts`** do not read `webhook.scope` — confirmed by grep; no changes needed.
