# Webhook Secret Picker + Promote-to-Org Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain "Secret name" text input in `WebhookConfigForm` with a three-mode picker (pick existing / generate new / type a name) **and** add a "promote user-scope secret → org-scope" feature with backend endpoint, MySecretsPage row button, and inline promote action in the SecretPicker for org webhooks.

**Architecture:** Backend adds one new route file (`promote.ts`) and one new db helper (`fetchOwnUserSecret`) — the rest of the secrets infrastructure (encryption, scope tables, listVisibleSecrets) is reused as-is. Frontend adds `SecretPicker` + `GenerateSecretPanel` (consumed by the webhook create wizard), extends the secrets API client with create/promote helpers, and adds a row-level "Promote to org" button on `MySecretsPage`. No new DB schema.

**Tech Stack:** TypeScript NodeNext ESM, Fastify, PostgreSQL via existing `pg` helpers, React 18, `crypto.getRandomValues` for client-side entropy.

**Spec:** [`docs/superpowers/specs/2026-05-25-webhook-secret-picker-design.md`](../specs/2026-05-25-webhook-secret-picker-design.md)

**Supersedes:** [`docs/superpowers/plans/2026-05-25-webhook-secret-picker.md`](2026-05-25-webhook-secret-picker.md) — that plan can be deleted once this one is executed.

**Project constraints (overrides skill defaults):**

- **No commits** during implementation.
- **No unit tests** added or modified.
- **Verification at end only**: `npm run check` (typecheck + import boundaries).

---

## File Structure

```
packages/secrets/src/
├── db.ts                                ← modify — add fetchOwnUserSecret helper
├── routes/
│   ├── promote.ts                       ← new — POST /api/orgs/:orgId/secrets/:secretName/promote-from-user
│   └── index.ts                         ← modify — register the new route

packages/web/src/
├── api/
│   └── secrets.ts                       ← modify — add createOrgSecret, createUserSecret, promoteSecretToOrg, secretNameSuggestion
├── routes/
│   ├── MySecretsPage.tsx                ← modify — add "Promote to org" button per row (admin-gated)
│   └── webhooks/
│       ├── SecretPicker.tsx             ← new — three-mode control + inline promote for admins
│       ├── GenerateSecretPanel.tsx      ← new — name input → POST → reveal-once
│       └── WebhookConfigForm.tsx        ← modify — replace plain input with <SecretPicker>
└── routes/webhooks/
    └── WebhookCreateWizard.tsx          ← modify — pass scope + orgId + isAdmin into form
```

Backend changes are minimal (one route, one helper). The bulk of the work is the React picker.

---

### Task 1: New db helper — `fetchOwnUserSecret`

**Files:**
- Modify: `packages/secrets/src/db.ts`

The existing `fetchPinnedUserSecret(pool, orgId, userId, name)` requires both `orgId` and `userId`, but a user-scope secret in `jm_secrets` is uniquely identified by `(user_id, name)` regardless of which org was active at creation. We need a helper that finds and decrypts a user-scope row by `user_id` + `name` alone — for the promote flow, where the caller knows their own userId but not necessarily which org_id the secret was attached to.

- [ ] **Step 1: Add the helper at the bottom of `db.ts`**

Open `packages/secrets/src/db.ts` and append (after `fetchPinnedOrgSecret`):

```ts
/**
 * Fetch and decrypt the caller's user-scope secret by (userId, name). Does
 * not constrain by org_id — used by the promote-to-org route where the
 * caller's active org may differ from the org under which the user-scope
 * row was originally created.
 */
export async function fetchOwnUserSecret(
  pool: Pool,
  userId: string,
  name: string,
): Promise<string | null> {
  validateName(name);
  const r = await pool.query(
    `SELECT ciphertext, iv, auth_tag
       FROM jm_secrets
      WHERE user_id = $1 AND name = $2
      LIMIT 1`,
    [userId, name],
  );
  const row = r.rows[0];
  if (!row) return null;
  return open({ ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag });
}
```

The function reuses the existing `validateName` and `open` imports already at the top of the file.

---

### Task 2: New promote route

**Files:**
- Create: `packages/secrets/src/routes/promote.ts`

- [ ] **Step 1: Write the route module**

```ts
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import { DuplicateSecretError, fetchOwnUserSecret, insertOrgSecret } from "../db.ts";

export async function registerPromoteSecretRoute(app: FastifyInstance, pool: Pool) {
  const requireAuth = makeRequireAuth({ pool });

  app.post(
    "/api/orgs/:orgId/secrets/:secretName/promote-from-user",
    { preHandler: requireAuth({ role: "admin" }) },
    async (req, reply) => {
      const { orgId, secretName } = req.params as { orgId: string; secretName: string };
      const ctx = req.runContext!;
      if (ctx.org.id !== orgId) {
        return reply.code(403).send({ error: "Wrong org" });
      }

      // 1. Find the caller's user-scope secret by name.
      let value: string | null;
      try {
        value = await fetchOwnUserSecret(pool, ctx.user.id, secretName);
      } catch (err) {
        if (err instanceof Error && /Invalid secret name/.test(err.message)) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
      if (value === null) {
        return reply.code(404).send({
          error: `No personal secret named '${secretName}' to promote`,
        });
      }

      // 2. Insert into org-scope. Existing helper enforces the unique
      //    constraint and throws DuplicateSecretError on collision.
      try {
        const rec = await insertOrgSecret(pool, {
          orgId,
          name: secretName,
          value,
          description: `Promoted from personal secret by ${ctx.user.id}`,
          createdBy: ctx.user.id,
        });
        reply.code(201);
        return { id: rec.id, name: rec.name };
      } catch (err) {
        if (err instanceof DuplicateSecretError) {
          return reply.code(409).send({
            error: `Org-scope secret '${secretName}' already exists`,
          });
        }
        throw err;
      }
    },
  );
}
```

---

### Task 3: Register the promote route

**Files:**
- Modify: `packages/secrets/src/routes/index.ts`

- [ ] **Step 1: Add the import**

Open `packages/secrets/src/routes/index.ts`. Add:

```ts
import { registerPromoteSecretRoute } from "./promote.ts";
```

- [ ] **Step 2: Call it in `registerSecretsRoutes`**

Inside the existing `registerSecretsRoutes` body, append:

```ts
  await registerPromoteSecretRoute(app, pool);
```

So the final body reads:

```ts
export async function registerSecretsRoutes(app: FastifyInstance, pool: Pool) {
  await registerOrgSecretRoutes(app, pool);
  await registerUserSecretRoutes(app, pool);
  await registerGlobalSecretRoutes(app, pool);
  await registerResolveRoutes(app, pool);
  await registerVisibleNamesRoutes(app, pool);
  await registerPromoteSecretRoute(app, pool);
}
```

---

### Task 4: Frontend API client helpers

**Files:**
- Modify: `packages/web/src/api/secrets.ts`

Today the client exports only `fetchVisibleSecrets` and `filterSecrets`. Add create wrappers, a promote wrapper, and a name-suggestion helper.

- [ ] **Step 1: Replace the file contents**

```ts
import { api } from "./client.ts";

export type SecretScope = "user" | "org" | "global";

export interface VisibleSecret { name: string; scope: SecretScope }

export async function fetchVisibleSecrets(orgId: string): Promise<VisibleSecret[]> {
  const r = await fetch(`/api/orgs/${orgId}/secrets/_visible-names`, { credentials: "include" });
  if (!r.ok) return [];
  const body = await r.json();
  return Array.isArray(body?.scoped) ? body.scoped : [];
}

export function filterSecrets(
  secrets: VisibleSecret[],
  mode: "all" | "org-and-global",
): VisibleSecret[] {
  if (mode === "all") return secrets;
  return secrets.filter((s) => s.scope !== "user");
}

/**
 * Create an org-scope secret. Caller must be org admin (backend returns 403 otherwise).
 */
export function createOrgSecret(
  orgId: string,
  name: string,
  value: string,
  description?: string,
): Promise<{ id: string; name: string }> {
  return api<{ id: string; name: string }>(
    `/api/orgs/${encodeURIComponent(orgId)}/secrets`,
    { method: "POST", body: JSON.stringify({ name, value, description }) },
  );
}

/**
 * Create a user-scope secret. Pinned to active org per existing MySecretsPage pattern.
 */
export function createUserSecret(
  orgId: string,
  name: string,
  value: string,
  description?: string,
): Promise<{ id: string; name: string }> {
  return api<{ id: string; name: string }>(
    `/api/orgs/${encodeURIComponent(orgId)}/users/me/secrets`,
    { method: "POST", body: JSON.stringify({ name, value, description }) },
  );
}

/**
 * Promote a user-scope secret with the given name to org-scope. Admin-only.
 */
export function promoteSecretToOrg(
  orgId: string,
  secretName: string,
): Promise<{ id: string; name: string }> {
  return api<{ id: string; name: string }>(
    `/api/orgs/${encodeURIComponent(orgId)}/secrets/${encodeURIComponent(secretName)}/promote-from-user`,
    { method: "POST", body: "{}" },
  );
}

/**
 * Build a sensible default secret name from a preset id.
 *   "github"         → "GITHUB_WEBHOOK_SECRET"
 *   "github-issues"  → "GITHUB_ISSUES_WEBHOOK_SECRET"
 */
export function secretNameSuggestion(presetId: string): string {
  const base = presetId.toUpperCase().replace(/-/g, "_");
  return `${base}_WEBHOOK_SECRET`;
}
```

---

### Task 5: `GenerateSecretPanel` component

**Files:**
- Create: `packages/web/src/routes/webhooks/GenerateSecretPanel.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from "react";
import { createOrgSecret, createUserSecret, secretNameSuggestion } from "../../api/secrets.ts";

const NAME_RE = /^[A-Z][A-Z0-9_]*$/;

function generateHex(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface GenerateSecretPanelProps {
  presetId: string;
  scope: "org" | "user";
  orgId: string;
  onSaved: (name: string) => void;
  onCancel: () => void;
}

export function GenerateSecretPanel({ presetId, scope, orgId, onSaved, onCancel }: GenerateSecretPanelProps) {
  const [name, setName] = useState(secretNameSuggestion(presetId));
  const [generatedValue, setGeneratedValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!NAME_RE.test(name)) {
      setError("Names must be UPPER_SNAKE_CASE (e.g. GITHUB_WEBHOOK_SECRET).");
      return;
    }

    const value = generateHex(32);
    setBusy(true);
    try {
      if (scope === "org") {
        await createOrgSecret(orgId, name, value, `Webhook secret for preset ${presetId}`);
      } else {
        await createUserSecret(orgId, name, value, `Webhook secret for preset ${presetId}`);
      }
      setGeneratedValue(value);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/409/.test(msg) || /already/i.test(msg)) {
        setError(`"${name}" is already in use — pick a different name or close this and select it from the dropdown.`);
      } else if (/403/.test(msg)) {
        setError("You don't have permission to create a secret in this scope.");
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    if (!generatedValue) return;
    void navigator.clipboard.writeText(generatedValue).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  if (generatedValue) {
    return (
      <div className="mt-2 rounded border border-emerald-700/40 bg-emerald-900/10 p-3 space-y-2">
        <div className="text-xs font-medium text-emerald-200">
          Generated value — copy now, won't be shown again
        </div>
        <div className="flex gap-2">
          <input
            readOnly
            value={generatedValue}
            className="flex-1 rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono text-xs text-slate-100"
          />
          <button
            type="button"
            onClick={copy}
            className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-sm"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <div className="text-[11px] text-slate-400">
          Saved as <code>{name}</code>. Paste this exact value into the provider's webhook
          secret field.
        </div>
        <button
          type="button"
          onClick={() => onSaved(name)}
          className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm"
        >
          Done — I've copied it
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={save} className="mt-2 rounded border border-slate-700 p-3 space-y-2">
      <div className="text-xs font-medium text-slate-200">New secret</div>
      <label className="block">
        <span className="block text-[11px] text-slate-400 mb-1">Name (UPPER_SNAKE_CASE)</span>
        <input
          className="w-full rounded bg-slate-800 border border-slate-700 px-2 py-1 font-mono text-xs text-slate-100"
          value={name}
          onChange={(e) => setName(e.target.value.toUpperCase())}
          placeholder="GITHUB_WEBHOOK_SECRET"
          required
        />
      </label>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save & generate"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm text-slate-100"
        >
          Cancel
        </button>
      </div>
      <p className="text-[11px] text-slate-500">
        Journeyman will generate a 256-bit hex value, store it under this name, and show
        it once so you can paste it into the provider.
      </p>
    </form>
  );
}
```

---

### Task 6: `SecretPicker` component (with inline promote)

**Files:**
- Create: `packages/web/src/routes/webhooks/SecretPicker.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useMemo, useState } from "react";
import type { WebhookAuthConfig } from "@journeyman/core";
import {
  fetchVisibleSecrets,
  filterSecrets,
  promoteSecretToOrg,
  type VisibleSecret,
} from "../../api/secrets.ts";
import { GenerateSecretPanel } from "./GenerateSecretPanel.tsx";

export interface SecretPickerProps {
  authMode: WebhookAuthConfig["mode"];
  presetId: string;
  /** "org" → webhook is org-scope (only org/global secrets normally usable). "user" → personal webhook. */
  scope: "org" | "user";
  orgId: string;
  /** Whether the current user is an org admin (controls promote affordances). */
  isAdmin: boolean;
  value: string;
  onChange: (name: string) => void;
}

type Panel = "closed" | "generate" | "type";

export function SecretPicker(props: SecretPickerProps) {
  const { authMode, presetId, scope, orgId, isAdmin, value, onChange } = props;

  const [secrets, setSecrets] = useState<VisibleSecret[]>([]);
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState<Panel>("closed");
  const [promoting, setPromoting] = useState<string | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchVisibleSecrets(orgId).then((rows) => {
      if (cancelled) return;
      setSecrets(rows);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [orgId]);

  const orgVisible = useMemo(
    () => filterSecrets(secrets, "org-and-global"),
    [secrets],
  );
  const userVisible = useMemo(
    () => secrets.filter((s) => s.scope === "user"),
    [secrets],
  );

  // Dropdown contents depend on scope + admin.
  // - personal webhook (scope === "user"): show all visible secrets, no promote.
  // - org webhook (scope === "org"): show org + global. If admin, also show user secrets
  //   in a "promotable" group with an inline promote button.
  const showPromoteGroup = scope === "org" && isAdmin && userVisible.length > 0;
  const canGenerate = authMode === "hmac" || authMode === "header-equals";

  async function promote(name: string) {
    setPromoteError(null);
    setPromoting(name);
    try {
      await promoteSecretToOrg(orgId, name);
      setSecrets((prev) => {
        // The original user-scope row stays; add an org-scope sibling.
        if (prev.some((s) => s.scope === "org" && s.name === name)) return prev;
        return [...prev, { name, scope: "org" }];
      });
      onChange(name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/409/.test(msg)) {
        setPromoteError(`Org-scope secret "${name}" already exists — pick it from the org section.`);
      } else if (/403/.test(msg)) {
        setPromoteError("Org admin permission required.");
      } else {
        setPromoteError(msg);
      }
    } finally {
      setPromoting(null);
    }
  }

  function refreshAfterGenerate(savedName: string) {
    setSecrets((prev) => {
      const newScope: SecretScopeLocal = scope === "org" ? "org" : "user";
      if (prev.some((s) => s.scope === newScope && s.name === savedName)) return prev;
      return [...prev, { name: savedName, scope: newScope }];
    });
    onChange(savedName);
    setPanel("closed");
  }

  // -----------------------------------------------------------------------

  return (
    <div className="space-y-2">
      <label className="block">
        <span className="block text-slate-400 mb-1">Secret</span>
        <div className="flex gap-2 items-center">
          {panel === "type" ? (
            <input
              autoFocus
              className="flex-1 rounded bg-slate-800 border border-slate-700 px-2 py-1 font-mono text-xs text-slate-100"
              value={value}
              onChange={(e) => onChange(e.target.value.toUpperCase())}
              placeholder="GITHUB_WEBHOOK_SECRET"
            />
          ) : (
            <select
              className="flex-1 rounded bg-slate-800 border border-slate-700 px-2 py-1 text-sm text-slate-100"
              value={value}
              disabled={loading}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__type__") {
                  setPanel("type");
                  onChange("");
                } else {
                  setPanel("closed");
                  onChange(v);
                }
              }}
            >
              <option value="">{loading ? "Loading secrets…" : "— pick a secret —"}</option>
              {scope === "org" ? (
                <optgroup label="Org secrets">
                  {orgVisible.map((s) => (
                    <option key={`org:${s.name}`} value={s.name}>
                      {s.name} ({s.scope})
                    </option>
                  ))}
                </optgroup>
              ) : (
                <>
                  {orgVisible.length > 0 && (
                    <optgroup label="Org / global">
                      {orgVisible.map((s) => (
                        <option key={`org:${s.name}`} value={s.name}>
                          {s.name} ({s.scope})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {userVisible.length > 0 && (
                    <optgroup label="Mine">
                      {userVisible.map((s) => (
                        <option key={`user:${s.name}`} value={s.name}>
                          {s.name} (mine)
                        </option>
                      ))}
                    </optgroup>
                  )}
                </>
              )}
              <option value="__type__">✏  type a name…</option>
            </select>
          )}
          {canGenerate && panel !== "generate" && (
            <button
              type="button"
              onClick={() => setPanel("generate")}
              className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-sm whitespace-nowrap"
            >
              + Generate new
            </button>
          )}
          {panel === "type" && (
            <button
              type="button"
              onClick={() => setPanel("closed")}
              className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-xs"
            >
              ← back to picker
            </button>
          )}
        </div>
      </label>

      {/* Promote group: inline list of user-scope secrets that the admin can elevate. */}
      {showPromoteGroup && (
        <div className="rounded border border-slate-700 p-3 text-xs space-y-2">
          <div className="text-slate-400">
            Your personal secrets — promote one to use it on this org webhook:
          </div>
          <ul className="space-y-1">
            {userVisible.map((s) => (
              <li key={`promote:${s.name}`} className="flex items-center justify-between">
                <span className="font-mono text-slate-200">{s.name}</span>
                <button
                  type="button"
                  onClick={() => promote(s.name)}
                  disabled={promoting === s.name}
                  className="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-[11px] disabled:opacity-50"
                >
                  {promoting === s.name ? "Promoting…" : "Promote →"}
                </button>
              </li>
            ))}
          </ul>
          {promoteError && <p className="text-red-400">{promoteError}</p>}
        </div>
      )}

      {panel === "generate" && (
        <GenerateSecretPanel
          presetId={presetId}
          scope={scope}
          orgId={orgId}
          onSaved={refreshAfterGenerate}
          onCancel={() => setPanel("closed")}
        />
      )}

      {panel === "type" && (
        <p className="text-[11px] text-amber-300/80">
          Make sure a secret with this name exists in your vault before events start arriving.
        </p>
      )}

      {!canGenerate && authMode === "jwt" && (
        <p className="text-[11px] text-slate-500">
          This provider chooses the signing key — paste the value they give you into a
          secret (My Secrets / Org Secrets) first, then pick it here.
        </p>
      )}
    </div>
  );
}

// Local alias so the inferred-scope assignment in refreshAfterGenerate doesn't
// require importing the union from the API client just for one line.
type SecretScopeLocal = VisibleSecret["scope"];
```

---

### Task 7: Wire `SecretPicker` into `WebhookConfigForm`

**Files:**
- Modify: `packages/web/src/routes/webhooks/WebhookConfigForm.tsx`

- [ ] **Step 1: Add the import**

Near the top alongside the existing `inferSchemaFromSample` import:

```tsx
import { SecretPicker } from "./SecretPicker.tsx";
```

- [ ] **Step 2: Extend `Props`**

Find the existing `Props` interface and replace it with:

```tsx
interface Props {
  preset: WebhookPresetSummary;
  initial?: Partial<ConfigFormValue>;
  submitLabel?: string;
  onSubmit: (value: ConfigFormValue) => void | Promise<void>;
  busy?: boolean;
  /** Scope of the webhook being created. Drives the secret list and create endpoint. */
  scope: "org" | "user";
  /** Active org id (required by both list and create endpoints). */
  orgId: string;
  /** Whether the current user is an org admin (controls promote UI). */
  isAdmin: boolean;
}
```

Update the function signature to destructure the new props:

```tsx
export function WebhookConfigForm({ preset, initial, submitLabel = "Create webhook", onSubmit, busy, scope, orgId, isAdmin }: Props) {
```

- [ ] **Step 3: Replace the secret-name `<input>` block with `<SecretPicker>`**

Find the existing `{needsSecret && (` block containing the `<input placeholder="GITHUB_WEBHOOK_SECRET" …>` and replace it with:

```tsx
        {needsSecret && (
          <SecretPicker
            authMode={preset.auth.mode}
            presetId={preset.id}
            scope={scope}
            orgId={orgId}
            isAdmin={isAdmin}
            value={secretRefInput}
            onChange={setSecretRefInput}
          />
        )}
```

The local `secretRefInput` state and its use inside `submit()` (via `withRef`) are unchanged.

---

### Task 8: Thread `scope`, `orgId`, `isAdmin` from the wizard

**Files:**
- Modify: `packages/web/src/routes/webhooks/WebhookCreateWizard.tsx`

- [ ] **Step 1: Import `useAuth`**

At the top, add:

```tsx
import { useAuth } from "../../AuthContext.tsx";
```

- [ ] **Step 2: Read auth context**

Inside `WebhookCreateWizard`, near the existing `useState` calls, add:

```tsx
  const { activeOrgId, role } = useAuth();
```

- [ ] **Step 3: Pass new props into the form**

Find the `<WebhookConfigForm key={formKey} preset={preset} … />` invocation inside the configure step and replace it with:

```tsx
          <WebhookConfigForm
            key={formKey}
            preset={preset}
            initial={{ payloadSchema: presetSchema }}
            onSubmit={submit}
            busy={busy}
            scope={"orgId" in scope ? "org" : "user"}
            orgId={"orgId" in scope ? scope.orgId : activeOrgId}
            isAdmin={role === "admin"}
          />
```

---

### Task 9: "Promote to org" button on `MySecretsPage`

**Files:**
- Modify: `packages/web/src/routes/MySecretsPage.tsx`

- [ ] **Step 1: Inspect the page to confirm structure**

Run:

```bash
grep -n "remove\|btnDanger\|Delete\|<tr\|rows.map" packages/web/src/routes/MySecretsPage.tsx | head -20
```

Expected output: shows the row-rendering loop and the existing Delete button. This confirms the row layout you'll extend.

- [ ] **Step 2: Add the promote handler + import**

Open `packages/web/src/routes/MySecretsPage.tsx`. At the top, add:

```tsx
import { promoteSecretToOrg } from "../api/secrets.ts";
import { useAuth } from "../AuthContext.tsx";
```

Inside the `MySecretsPage` component body, near the existing `remove` function, add:

```tsx
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [promoting, setPromoting] = useState<string | null>(null);
  const [promoteError, setPromoteError] = useState<string | null>(null);

  async function promote(name: string) {
    if (!confirm(`Copy "${name}" into the org-scope vault? The personal secret will remain unchanged.`)) return;
    setPromoteError(null);
    setPromoting(name);
    try {
      await promoteSecretToOrg(props.orgId, name);
      alert(`Promoted ${name} to org scope.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/409/.test(msg)) setPromoteError(`Org-scope secret "${name}" already exists.`);
      else if (/403/.test(msg)) setPromoteError("Org admin permission required.");
      else setPromoteError(msg);
    } finally {
      setPromoting(null);
    }
  }
```

`useState` is already imported in this file; no additional import is needed for it.

- [ ] **Step 3: Render the button next to each row's Delete**

Find the row's actions cell (where the `Delete` button is rendered, inside `rows.map(...)`):

```tsx
              <button
                onClick={() => remove(r.id, r.name)}
                className={btnDanger}
              >Delete</button>
```

Replace with:

```tsx
              <div className="flex gap-2 justify-end">
                {isAdmin && (
                  <button
                    onClick={() => promote(r.name)}
                    disabled={promoting === r.name}
                    className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 disabled:opacity-50"
                  >
                    {promoting === r.name ? "Promoting…" : "Promote to org →"}
                  </button>
                )}
                <button
                  onClick={() => remove(r.id, r.name)}
                  className={btnDanger}
                >Delete</button>
              </div>
```

- [ ] **Step 4: Surface promote-level errors**

Just above the table (or below the header — wherever fits the existing layout), render the error banner. Find a spot near the existing `{error && …}` rendering and add:

```tsx
        {promoteError && (
          <div className="rounded border border-red-700/40 bg-red-900/10 p-3 text-sm text-red-200">
            {promoteError}
          </div>
        )}
```

If the existing `error` state and the new `promoteError` state both bubble up, keep them as separate banners — they describe different failure modes.

---

### Task 10: Delete the old plan file

**Files:**
- Delete: `docs/superpowers/plans/2026-05-25-webhook-secret-picker.md`

- [ ] **Step 1: Remove the superseded plan**

```bash
rm docs/superpowers/plans/2026-05-25-webhook-secret-picker.md
```

This avoids confusion between the two plan files. The new bundled plan replaces it.

---

### Task 11: Final verification

**Files:** none.

- [ ] **Step 1: Typecheck the changed packages individually**

```bash
npm run typecheck -w @journeyman/secrets
npm run typecheck -w @journeyman/web
```

Expected: both print `tsc --noEmit` with zero errors.

- [ ] **Step 2: Full repo check**

```bash
npm run check
```

Expected: typecheck passes across all workspaces, then prints `✓ Layer boundaries clean across all packages.`

- [ ] **Step 3: Manual smoke verification (optional)**

1. Boot the stack (`npm run infra:up && npm run start:api-server && npm run dev:web`). Sign in as a non-admin user.
2. Open **My Secrets** → no "Promote to org" buttons (not admin).
3. Sign in as an admin. Open **My Secrets** → "Promote to org →" appears next to each row. Click on one → confirm → toast → secret exists in **Org Secrets** too.
4. Open **My Webhooks → + New webhook → GitHub (code events)**. The Secret control is a dropdown of visible secrets + a **+ Generate new** button.
5. Click **+ Generate new** → name pre-fills `GITHUB_WEBHOOK_SECRET` → Save & generate → 64-char hex revealed with Copy.
6. Click **Done** → dropdown shows the new secret selected.
7. Submit webhook → it's created with `auth.secretRef = "GITHUB_WEBHOOK_SECRET"`.
8. Open **Admin Webhooks → + New webhook → GitHub** as admin. The Secret control's dropdown shows only org/global secrets. **Below the dropdown**, a "Your personal secrets — promote one to use it on this org webhook" panel lists user-scope secrets each with a [Promote →] button. Click one → it appears in the org section and is auto-selected.
9. Pick **Monday** preset → no **+ Generate new** button visible (JWT-HS256 — provider picks the key).
10. Try the picker's **✏ type a name…** entry → free-form input replaces the dropdown; amber warning appears.
11. `npm run check` passes (Step 2).

---

## Plan Self-Review

**Spec coverage:**

| Spec section | Task(s) |
|---|---|
| Three coexisting paths (pick / generate / type) | 6 |
| Dropdown sourced from `_visible-names` with scope filter | 6 |
| Generate flow (random hex → POST → reveal once) | 4, 5 |
| Name suggestion + UPPER_SNAKE_CASE validation + 409 collision UX | 4, 5 |
| Mode-aware Generate button (hidden for JWT) | 6 (`canGenerate`) |
| Webhook submit carries only the secret name | 7 (`secretRefInput` flow unchanged) |
| Backend promote route, admin-gated, returns 404/409/403 | 1, 2, 3 |
| `MySecretsPage` row-level "Promote to org" button | 9 |
| `SecretPicker` inline promote group for org webhooks (admin-only) | 6 |
| Backwards-compat: existing webhook flow keeps working with the new picker | 7, 8 |
| Old plan file superseded | 10 |
| Verification gate | 11 |

**Placeholder scan:** No `TBD` / `fill in details` / vague-instruction patterns. Every Edit step shows the exact code being inserted; every Replace step shows the before-text being targeted. The Task 9 Step 1 `grep` "inspect" command is a one-off context probe with a deterministic expected output — not a placeholder.

**Type consistency:**

- `scope: "org" | "user"` is the same literal union across Tasks 5, 6, 7, 8.
- `orgId: string` flows: Wizard → `WebhookConfigForm` → `SecretPicker` → `GenerateSecretPanel`. Same name everywhere.
- `isAdmin: boolean` enters at the Wizard (Task 8), threads through `WebhookConfigForm` (Task 7), is consumed by `SecretPicker` (Task 6).
- `SecretPickerProps` (Task 6) and `GenerateSecretPanelProps` (Task 5) are each defined and consumed in one direction; no drift.
- Backend route's URL `:secretName` matches the frontend client's path-encoding (Task 4) and the error mappings (Tasks 5, 6, 9).
- `fetchOwnUserSecret` from Task 1 is the only new export — used in exactly one place (Task 2). No collisions with existing `fetchPinnedUserSecret`.

---

## Execution Handoff

Plan complete and saved to [`docs/superpowers/plans/2026-05-25-webhook-secret-picker-and-promote.md`](2026-05-25-webhook-secret-picker-and-promote.md).

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task with review checkpoints.
2. **Inline Execution** — I work through tasks here via `superpowers:executing-plans`.

Which approach?
