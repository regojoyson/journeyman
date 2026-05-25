# Promote Webhook User → Org Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an org admin clone one of their personal webhooks into org scope via a single click — with secret-reference validation, a fresh `tenantToken`, and a guided "promote the secret first if it's missing" flow.

**Architecture:** One new backend route inside `routes/webhooks-management.ts` that reuses `IWebhookStore.create` (no new store methods) and the existing `secretRefFromAuth` helper. One small server-side helper `secretExistsInOrgScope` (org_secrets table + env-vars). Frontend: a new `PromoteWebhookDialog` modal component on `MyWebhooksPage`, plus a row-level button and a one-line API client function.

**Tech Stack:** TypeScript NodeNext ESM, Fastify, React 18, existing `api()` helper.

**Spec:** [`docs/superpowers/specs/2026-05-25-promote-webhook-to-org-design.md`](../specs/2026-05-25-promote-webhook-to-org-design.md)

**Project constraints (overrides skill defaults):**

- **No commits** during implementation.
- **No unit tests** added or modified.
- **Verification at end only**: `npm run check`.

---

## File Structure

```
packages/api-server/src/
├── services/
│   └── webhook-secret-lookup.ts        ← modify — add secretExistsInOrgScope helper
└── routes/
    └── webhooks-management.ts          ← modify — add POST .../promote-from-user route

packages/web/src/
├── api/
│   └── webhooks.ts                     ← modify — add promoteWebhookToOrg
└── routes/
    ├── MyWebhooksPage.tsx              ← modify — admin-only "Promote to org →" button + dialog mount
    └── webhooks/
        └── PromoteWebhookDialog.tsx    ← new — validates secret, walks user through promote
```

Backend changes are small (one helper + one route, ~70 lines). Frontend adds one new file (~180 lines) and tweaks two existing ones.

---

### Task 1: Add `secretExistsInOrgScope` helper

**Files:**
- Modify: `packages/api-server/src/services/webhook-secret-lookup.ts`

The promote route needs a server-side check: does a given secret name resolve in **org-scope or global-scope** (the two scopes ingest can read for an org webhook)? `webhook-secret-lookup.ts` already houses `resolveWebhookSecret` and `secretRefFromAuth`; this is the natural sibling.

- [ ] **Step 1: Append the helper at the bottom of the file**

```ts
import { readGlobalSecrets } from "@journeyman/secrets";

/**
 * Returns true if a secret with the given name resolves in either org or
 * global scope. Used by promote-to-org to pre-validate that an org-scope
 * webhook will be able to read its referenced secret at ingest time.
 */
export async function secretExistsInOrgScope(
  pool: Pool,
  orgId: string,
  name: string,
): Promise<boolean> {
  if (!name) return false;
  // Global scope is env-driven; in-memory check is essentially free.
  const globals = readGlobalSecrets();
  if (name in globals) return true;
  const r = await pool.query(
    `SELECT 1 FROM jm_secrets WHERE org_id = $1 AND user_id IS NULL AND name = $2 LIMIT 1`,
    [orgId, name],
  );
  return r.rowCount !== null && r.rowCount > 0;
}
```

The `Pool` and `WebhookAuthConfig`/`WebhookScope` imports at the top of the file already cover what we need; only the new `readGlobalSecrets` import is required. Add it alongside the existing `import { open } from "@journeyman/secrets";` line.

If the existing import is `import { open } from "@journeyman/secrets";`, change it to:

```ts
import { open, readGlobalSecrets } from "@journeyman/secrets";
```

---

### Task 2: Backend promote route

**Files:**
- Modify: `packages/api-server/src/routes/webhooks-management.ts`

Add a new route to the existing module. Reuses `mintToken` (already defined in this file), `c.webhooks.create`, `secretRefFromAuth`, and the new `secretExistsInOrgScope`. Inserts a fresh org-scope row with a new `tenantToken`; original user-scope row stays.

- [ ] **Step 1: Add imports**

Find the existing import block at the top. Update the line that imports from `webhook-secret-lookup.ts` to include the new helper:

```ts
import {
  resolveWebhookSecret,
  secretRefFromAuth,
  secretExistsInOrgScope,
} from "../services/webhook-secret-lookup.ts";
```

- [ ] **Step 2: Add the route handler**

After the existing `app.post("/api/webhooks/:id/test", …)` handler (the last one in the file's `registerWebhookManagementRoutes` function), add this block — still inside the same `registerWebhookManagementRoutes` body, before its closing `}`:

```ts
  // ----- Promote user-scope webhook → org-scope --------------------------
  app.post(
    "/api/orgs/:orgId/webhooks/:id/promote-from-user",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, id } = req.params as { orgId: string; id: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) return reply.code(403).send({ error: "wrong_org" });

      // 1. Load the source webhook and confirm ownership + scope.
      const source = await c.webhooks.getById(id);
      if (!source) return reply.code(404).send({ error: "not_found" });
      if (!("userId" in source.scope) || source.scope.userId !== ctx.user.id) {
        return reply.code(404).send({ error: "not_found_or_not_user_scope" });
      }

      // 2. Validate secret-ref (defense-in-depth; the dialog also checks).
      const refName = secretRefFromAuth(source.auth);
      if (refName) {
        if (!c.pool) return reply.code(500).send({ error: "no_pool_for_secret_check" });
        const ok = await secretExistsInOrgScope(c.pool, orgId, refName);
        if (!ok) {
          return reply.code(400).send({
            error: "secret_not_in_org_scope",
            unresolved: [refName],
          });
        }
      }

      // 3. Clone the row into org-scope with a new tenantToken.
      try {
        const created = await c.webhooks.create(
          {
            scope: { orgId },
            name: source.name,
            description: source.description,
            preset: source.preset,
            kind: source.kind,
            auth: source.auth,
            payloadSchema: source.payloadSchema,
            schemaValidation: source.schemaValidation,
            schemaInferredFrom: source.schemaInferredFrom,
            eventTypePath: source.eventTypePath,
            deliveryIdHeader: source.deliveryIdHeader,
            correlationSuggestions: source.correlationSuggestions,
          },
          mintToken(),
        );
        reply.code(201);
        return withIngestUrl(req, created);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // jm_webhooks has no unique constraint on (org_id, name), so 23505
        // collisions only fire on tenant_token (impossible with a fresh hex)
        // or other indexes we don't ship. Surface generically.
        return reply.code(500).send({ error: msg });
      }
    },
  );
```

Three helpers used here that already live in the file:

- `mintToken()` — generates a 24-byte hex string.
- `withIngestUrl(req, w)` — adds the `ingestUrl` derived from the request host.
- `c.webhooks.create(...)` — the existing `IWebhookStore.create` method.

`resolveWebhookSecret` is still imported (used by the test route); leaving it in the import list doesn't hurt.

Note on 409 semantics from the spec: `jm_webhooks` schema doesn't enforce a unique `(org_id, name)` constraint today, so name collisions don't fire a 409. The spec mentions 409 as the *intended* error if such a constraint exists. We surface the database error as 500 if it ever happens. Adding a unique constraint is out of scope for this plan — it would need a migration and rules about updating instead.

---

### Task 3: Frontend API client

**Files:**
- Modify: `packages/web/src/api/webhooks.ts`

- [ ] **Step 1: Add the helper near the other write helpers**

Append (next to `rotateWebhook` is a natural neighbor):

```ts
export function promoteWebhookToOrg(orgId: string, webhookId: string): Promise<Webhook> {
  return api<Webhook>(
    `/api/orgs/${encodeURIComponent(orgId)}/webhooks/${encodeURIComponent(webhookId)}/promote-from-user`,
    { method: "POST", body: "{}" },
  );
}
```

---

### Task 4: `PromoteWebhookDialog` component

**Files:**
- Create: `packages/web/src/routes/webhooks/PromoteWebhookDialog.tsx`

A modal that validates the source webhook's secret reference in org/global scope (using `_visible-names`), offers inline "Promote secret first" when missing, and finally promotes the webhook.

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useMemo, useState } from "react";
import type { Webhook, WebhookAuthConfig } from "@journeyman/core";
import { fetchVisibleSecrets, promoteSecretToOrg, type VisibleSecret } from "../../api/secrets.ts";
import { promoteWebhookToOrg } from "../../api/webhooks.ts";

interface Props {
  webhook: Webhook;
  orgId: string;
  onClose: () => void;
  onPromoted: (newWebhook: Webhook) => void;
}

function refOf(auth: WebhookAuthConfig): string | null {
  switch (auth.mode) {
    case "none": return null;
    case "header-equals": return auth.valueRef || null;
    case "hmac": return auth.secretRef || null;
    case "jwt": return auth.signingKeyRef || null;
  }
}

type Stage = "loading" | "ready" | "missing" | "promoting-secret" | "promoting-webhook" | "done" | "error";

export function PromoteWebhookDialog({ webhook, orgId, onClose, onPromoted }: Props) {
  const secretRef = useMemo(() => refOf(webhook.auth), [webhook.auth]);
  const needsSecret = secretRef !== null;

  const [stage, setStage] = useState<Stage>("loading");
  const [visible, setVisible] = useState<VisibleSecret[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newWebhook, setNewWebhook] = useState<Webhook | null>(null);
  const [copied, setCopied] = useState(false);

  async function refreshVisibility() {
    const rows = await fetchVisibleSecrets(orgId);
    setVisible(rows);
    if (!needsSecret) {
      setStage("ready");
      return;
    }
    const ok = rows.some(
      (s) => s.name === secretRef && (s.scope === "org" || s.scope === "global"),
    );
    setStage(ok ? "ready" : "missing");
  }

  useEffect(() => {
    void refreshVisibility().catch((e) => {
      setError(e instanceof Error ? e.message : String(e));
      setStage("error");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, webhook.id]);

  async function promoteSecret() {
    if (!secretRef) return;
    setStage("promoting-secret");
    setError(null);
    try {
      await promoteSecretToOrg(orgId, secretRef);
      await refreshVisibility();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/409/.test(msg)) {
        // Org-scope secret already exists with that name — that's actually fine for us.
        await refreshVisibility();
      } else if (/403/.test(msg)) {
        setError("Org admin permission required to promote the secret.");
        setStage("missing");
      } else {
        setError(msg);
        setStage("missing");
      }
    }
  }

  async function promoteWebhook() {
    setStage("promoting-webhook");
    setError(null);
    try {
      const created = await promoteWebhookToOrg(orgId, webhook.id);
      setNewWebhook(created);
      setStage("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/400/.test(msg)) {
        setError("Server rejected the promote — the referenced secret is still missing in org scope.");
        await refreshVisibility();
      } else if (/403/.test(msg)) {
        setError("Org admin permission required.");
        setStage("ready");
      } else {
        setError(msg);
        setStage("ready");
      }
    }
  }

  function copyUrl() {
    if (!newWebhook) return;
    void navigator.clipboard.writeText(newWebhook.ingestUrl).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  function finish() {
    if (newWebhook) onPromoted(newWebhook);
    onClose();
  }

  // -----------------------------------------------------------------------

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded border border-slate-700 bg-slate-900 p-6 max-w-lg w-full mx-4 space-y-4"
      >
        <h2 className="text-lg font-medium text-slate-100">
          Promote webhook "{webhook.name}" to org
        </h2>

        <dl className="text-sm space-y-1">
          <div className="flex gap-2">
            <dt className="text-slate-500 w-24">Preset</dt>
            <dd className="text-slate-200">{webhook.preset} ({webhook.kind})</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-slate-500 w-24">Auth</dt>
            <dd className="text-slate-200">{webhook.auth.mode}</dd>
          </div>
          {needsSecret && (
            <div className="flex gap-2">
              <dt className="text-slate-500 w-24">Secret name</dt>
              <dd className="text-slate-200 font-mono">{secretRef}</dd>
            </div>
          )}
        </dl>

        {stage === "loading" && (
          <p className="text-sm text-slate-400">Checking secret visibility…</p>
        )}

        {stage === "ready" && (
          <div className="space-y-3">
            <p className="text-sm text-emerald-300">
              {needsSecret
                ? `✓ "${secretRef}" exists in org scope.`
                : `✓ This webhook needs no secret.`}
              {" "}A new ingest URL will be generated.
            </p>
            <div className="flex gap-2">
              <button
                onClick={promoteWebhook}
                className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm"
              >
                Promote webhook
              </button>
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {stage === "missing" && (
          <div className="space-y-3">
            <p className="text-sm text-amber-300">
              ⚠ "{secretRef}" is in your personal vault but not in org scope. The
              org-scope webhook can't read personal secrets at ingest time.
            </p>
            <div className="flex gap-2">
              <button
                onClick={promoteSecret}
                className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-white text-sm"
              >
                Promote secret first
              </button>
              <button
                onClick={onClose}
                className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {stage === "promoting-secret" && (
          <p className="text-sm text-slate-300">Promoting secret to org scope…</p>
        )}

        {stage === "promoting-webhook" && (
          <p className="text-sm text-slate-300">Promoting webhook…</p>
        )}

        {stage === "done" && newWebhook && (
          <div className="space-y-3">
            <p className="text-sm text-emerald-300">✓ Webhook promoted.</p>
            <label className="block">
              <span className="block text-xs text-slate-400 mb-1">
                New ingest URL — copy now into the provider's webhook settings
              </span>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={newWebhook.ingestUrl}
                  className="flex-1 rounded bg-slate-950 border border-slate-700 px-2 py-1 font-mono text-xs text-slate-100"
                />
                <button
                  onClick={copyUrl}
                  className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-sm"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </label>
            <p className="text-[11px] text-slate-500">
              Your personal webhook is still active. Delete it from My Webhooks if no
              longer needed.
            </p>
            <button
              onClick={finish}
              className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm"
            >
              Done
            </button>
          </div>
        )}

        {error && (
          <p className="text-xs text-red-400">{error}</p>
        )}

        {/* For debugging / parity — keep visible the count of secrets the dialog saw. */}
        {visible.length === 0 && stage !== "loading" && (
          <p className="text-[11px] text-slate-600">
            (No org/user secrets found via /_visible-names — check that the secrets API is reachable.)
          </p>
        )}
      </div>
    </div>
  );
}
```

---

### Task 5: Wire "Promote to org →" into `MyWebhooksPage`

**Files:**
- Modify: `packages/web/src/routes/MyWebhooksPage.tsx`

- [ ] **Step 1: Add imports**

Near the existing imports at the top, add:

```tsx
import { useAuth } from "../AuthContext.tsx";
import { PromoteWebhookDialog } from "./webhooks/PromoteWebhookDialog.tsx";
```

- [ ] **Step 2: Add admin gating + dialog state**

Inside the `MyWebhooksPage` component body, near the existing `useState` calls (alongside `rows`, `loading`, `creating`), add:

```tsx
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [promoting, setPromoting] = useState<Webhook | null>(null);
```

- [ ] **Step 3: Find and identify the org id**

The wizard uses `activeOrgId`. Pull that too:

```tsx
  const { role, activeOrgId } = useAuth();
```

(Replace the line you added in Step 2 with this combined form.)

- [ ] **Step 4: Render the button per row**

Find the row's actions cell. Today it renders just the Delete button:

```tsx
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => remove(w)}
                        className="text-xs text-red-300 hover:text-red-200"
                      >
                        Delete
                      </button>
                    </td>
```

Replace it with:

```tsx
                    <td className="px-4 py-2 text-right">
                      <div className="flex gap-3 justify-end">
                        {isAdmin && (
                          <button
                            onClick={() => setPromoting(w)}
                            className="text-xs text-emerald-300 hover:text-emerald-200"
                          >
                            Promote to org →
                          </button>
                        )}
                        <button
                          onClick={() => remove(w)}
                          className="text-xs text-red-300 hover:text-red-200"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
```

- [ ] **Step 5: Render the dialog at the bottom of the page**

Just before the outermost closing `</div>` of the page (i.e., right after the last `</section>`), add:

```tsx
        {promoting && (
          <PromoteWebhookDialog
            webhook={promoting}
            orgId={activeOrgId}
            onClose={() => setPromoting(null)}
            onPromoted={() => { setPromoting(null); void refresh(); }}
          />
        )}
```

`refresh` is the existing function in the page that re-fetches `listMyWebhooks`. The original user-scope webhook stays in the list (server-side behavior), so refreshing is harmless and keeps `lastEventAt` fresh.

---

### Task 6: Final verification

**Files:** none.

- [ ] **Step 1: Typecheck the changed packages**

```bash
npm run typecheck -w @journeyman/api-server
npm run typecheck -w @journeyman/web
```

Expected: both print `tsc --noEmit` with zero errors.

- [ ] **Step 2: Full repo check**

```bash
npm run check
```

Expected: typecheck passes across all workspaces, then prints `✓ Layer boundaries clean across all packages.`

- [ ] **Step 3: Manual smoke**

1. `npm run infra:up && npm run start:api-server` and `npm run dev:web`. Sign in as an org admin.
2. Visit `/me/secrets`. Create a personal secret `GITHUB_WEBHOOK_SECRET` with a random value.
3. Visit `/me/webhooks → + New webhook`. Pick **GitHub (code events)**, fill in name "Promote Test", reference the secret `GITHUB_WEBHOOK_SECRET`, submit. Confirm the URL reveal panel shows.
4. Back on `/me/webhooks`, the new row appears.
5. Click **Promote to org →** on the row.
6. Dialog opens. It should warn that `GITHUB_WEBHOOK_SECRET` isn't in org scope.
7. Click **Promote secret first** → confirmation message; dialog re-validates → "✓ exists in org scope" appears.
8. Click **Promote webhook** → success panel with a **new** ingest URL.
9. Copy URL → Done.
10. Visit `/admin/webhooks` → the new org webhook appears with the new tenant token.
11. Visit `/me/webhooks` → the original personal webhook is still listed.
12. Visit `/admin/secrets` → `GITHUB_WEBHOOK_SECRET` is now also in org scope.
13. `npm run check` (Step 2) passes.

---

## Plan Self-Review

**Spec coverage:**

| Spec requirement | Task(s) |
|---|---|
| Endpoint `POST /api/orgs/:orgId/webhooks/:id/promote-from-user`, admin-gated | 2 |
| Validates source ownership + user-scope (404 if not) | 2 |
| Validates secret-ref resolves in org/global (400 with `unresolved`) | 1, 2 |
| Mints a fresh `tenantToken` for the new row | 2 (uses `mintToken()`) |
| Clones all other webhook fields verbatim | 2 |
| Source webhook preserved | 2 (no delete of source) |
| `MyWebhooksPage` row-level button, admin-only | 5 |
| `PromoteWebhookDialog` with secret pre-check + inline "Promote secret first" | 4 |
| Dialog reveals the new ingest URL on success | 4 (stage `done`) |
| Auth without secret (`none`) trivially passes | 4 (`needsSecret = false`) |
| JWT-asymmetric (no `signingKeyRef`) trivially passes | 4 (`refOf` returns null for jwt without signingKeyRef) |
| 403 errors mapped in dialog UX | 4 |
| Verification gate | 6 |

**Carry-forward / clarification:**

- The spec mentions a **409 on name collision**. The current `jm_webhooks` schema doesn't enforce a unique `(org_id, name)` constraint, so the route can't return 409 today. Task 2 surfaces any rare insert error as 500. Adding a uniqueness constraint is a separate, larger change (migration + product rule). Not in this plan.

**Placeholder scan:** No `TBD` / `fill in details` / vague-instruction patterns. The Task 5 Step 3 "combined form" replaces the earlier-step line cleanly — both versions are spelled out.

**Type consistency:** `Webhook`, `WebhookAuthConfig`, `VisibleSecret` come from `@journeyman/core` / the existing API client. `Stage` is local to the dialog. `refOf` is the same helper pattern used in the existing `WebhookConfigForm.tsx`. The `promoteWebhookToOrg(orgId, webhookId)` signature added in Task 3 matches the call in Task 4.

---

## Execution Handoff

Plan complete and saved to [`docs/superpowers/plans/2026-05-25-promote-webhook-to-org.md`](2026-05-25-promote-webhook-to-org.md).

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task with review checkpoints.
2. **Inline Execution** — I work through tasks here via `superpowers:executing-plans`.

Which approach?
