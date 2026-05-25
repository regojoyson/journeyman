# Webhook Management — Frontend Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the user-facing UI for webhook management. Adds a Webhooks list and detail page (per-user and org-admin), a create wizard with preset gallery and sample-payload schema inference, and extends the existing `WebhookWaitConfigEditor` to pick a registered webhook from a dropdown with schema-driven `fromPath` autocomplete.

**Architecture:** Two web routes — `MyWebhooksPage` and `AdminWebhooksPage` — share a common React component tree. A `WebhookDetailPage` hosts overview / schema / events / test / used-by sections. A new API client module in `packages/web/src/api/webhooks.ts` wraps the endpoints shipped in plan 2. The flow-editor's `WebhookWaitConfigEditor` gains a webhook picker and pulls the chosen webhook's payload schema for `fromPath` autocomplete suggestions; the legacy `provider` field is kept visible for backward compatibility with un-migrated nodes.

**Tech Stack:** React 18, react-router-dom v7, native `fetch` via existing `api()` helper, Tailwind via existing `admin-styles.ts` helpers, plain `<textarea>` for schema editing (Monaco deliberately deferred — the spec mentions it, but a textarea + JSON.parse lint covers the working set without a heavy dependency).

**Spec:** [`docs/superpowers/specs/2026-05-25-webhook-management-design.md`](../specs/2026-05-25-webhook-management-design.md)

**Prerequisites:** Foundation plan (`@journeyman/webhooks` library) and Backend plan (DB + API endpoints) are merged. The API surface this plan consumes:

- `GET    /api/orgs/:orgId/webhooks`        — org list (admin)
- `POST   /api/orgs/:orgId/webhooks`        — org create
- `GET    /api/users/me/webhooks`           — user list
- `POST   /api/users/me/webhooks`           — user create
- `GET    /api/webhooks/:id`                — detail
- `PATCH  /api/webhooks/:id`                — update
- `DELETE /api/webhooks/:id`                — delete
- `POST   /api/webhooks/:id/rotate`         — rotate token
- `POST   /api/webhooks/:id/test`           — synthesize + ingest
- `GET    /api/webhook-presets`             — preset catalog
- `GET    /api/webhook-presets/:id`         — preset detail (incl. schema + samples)

**Project constraints (overrides skill defaults):**

- **No commits.** Do not run `git commit` at any step.
- **No unit tests.** No component tests or vitest suites.
- **Verification at end only.** Final task runs `npm run check`.

---

## File Structure

```
packages/web/src/
├── App.tsx                                          ← modify — add 2 routes
├── api/
│   └── webhooks.ts                                  ← new — API client
├── components/
│   └── Sidebar.tsx                                  ← modify — add 2 nav items
└── routes/
    ├── MyWebhooksPage.tsx                           ← new — user-scope list
    ├── AdminWebhooksPage.tsx                        ← new — org-scope list
    ├── WebhookDetailPage.tsx                        ← new — detail + tabs
    └── webhooks/                                    ← new sub-folder
        ├── WebhookCreateWizard.tsx                  ← preset → form → reveal
        ├── WebhookPresetGallery.tsx                 ← step 1 of wizard
        ├── WebhookConfigForm.tsx                    ← step 2 of wizard (also used in detail)
        ├── WebhookSecretReveal.tsx                  ← step 3 of wizard
        ├── WebhookOverviewTab.tsx                   ← detail tab
        ├── WebhookSchemaTab.tsx                     ← detail tab
        ├── WebhookEventsTab.tsx                     ← detail tab (stub list)
        ├── WebhookTestPanel.tsx                     ← detail action
        └── inferSchemaFromSample.ts                 ← tiny local schema inferrer

packages/flow-editor/src/properties-panel/
└── WebhookWaitConfigEditor.tsx                      ← modify — add webhook picker + schema-driven autocomplete

packages/flow-editor/src/properties-panel/
└── useWebhooksForPicker.ts                          ← new — fetches visible webhooks for the dropdown
```

Style: pages reuse the existing Tailwind-via-utility-class pattern in `admin-styles.ts` (used by `MySecretsPage`). The flow-editor changes use the existing `je-*` BEM classes; no new CSS.

---

### Task 1: API client

**Files:**
- Create: `packages/web/src/api/webhooks.ts`

- [ ] **Step 1: Write the client**

```ts
import type {
  CreateWebhookArgs,
  PresetId,
  UpdateWebhookArgs,
  Webhook,
  WebhookEvent,
} from "@journeyman/core";
import { api } from "./client.ts";

export interface WebhookPresetSummary {
  id: PresetId;
  name: string;
  kind: "ticket" | "git";
  icon: string | null;
  docsUrl: string | null;
  auth: Webhook["auth"];
  eventTypePath: string | null;
  deliveryIdHeader: string | null;
  knownEventTypes: string[];
  correlationSuggestions: Array<{ key: string; path: string }>;
  hasSchema: boolean;
  hasSamples: boolean;
}

export interface WebhookPresetDetail extends WebhookPresetSummary {
  payloadSchema?: unknown;
  samples?: Record<string, unknown>;
}

export function listOrgWebhooks(orgId: string): Promise<Webhook[]> {
  return api<Webhook[]>(`/api/orgs/${encodeURIComponent(orgId)}/webhooks`);
}

export function listMyWebhooks(): Promise<Webhook[]> {
  return api<Webhook[]>(`/api/users/me/webhooks`);
}

export function createOrgWebhook(orgId: string, body: Omit<CreateWebhookArgs, "scope">): Promise<Webhook> {
  return api<Webhook>(`/api/orgs/${encodeURIComponent(orgId)}/webhooks`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function createMyWebhook(body: Omit<CreateWebhookArgs, "scope">): Promise<Webhook> {
  return api<Webhook>(`/api/users/me/webhooks`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getWebhook(id: string): Promise<Webhook> {
  return api<Webhook>(`/api/webhooks/${encodeURIComponent(id)}`);
}

export function updateWebhook(id: string, patch: UpdateWebhookArgs): Promise<Webhook> {
  return api<Webhook>(`/api/webhooks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteWebhook(id: string): Promise<{ ok: true }> {
  return api<{ ok: true }>(`/api/webhooks/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function rotateWebhook(id: string): Promise<Webhook> {
  return api<Webhook>(`/api/webhooks/${encodeURIComponent(id)}/rotate`, {
    method: "POST",
    body: "{}",
  });
}

export interface TestDeliveryResult {
  ingestStatus: number;
  ingestBody: unknown;
}

export function testWebhook(id: string, body: { sampleEvent?: string; payload?: unknown }): Promise<TestDeliveryResult> {
  return api<TestDeliveryResult>(`/api/webhooks/${encodeURIComponent(id)}/test`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function listPresets(): Promise<WebhookPresetSummary[]> {
  return api<WebhookPresetSummary[]>(`/api/webhook-presets`);
}

export function getPresetDetail(id: PresetId): Promise<WebhookPresetDetail> {
  return api<WebhookPresetDetail>(`/api/webhook-presets/${encodeURIComponent(id)}`);
}

// Recent events for a webhook. Backend doesn't expose a dedicated endpoint yet;
// for v1 we surface the most recent webhook events via the existing per-issue
// endpoint when issueRef is known, or an empty list otherwise. Hooked up here
// so the UI compiles; replace with a real list endpoint when one ships.
export async function listRecentEventsForWebhook(_webhookId: string): Promise<WebhookEvent[]> {
  return [];
}
```

The `listRecentEventsForWebhook` stub returns `[]` deliberately — exposing recent events per-webhook is a small backend addition that didn't land in plan 2's API surface, so the UI shows an "empty events" state. Wiring a real endpoint is a single follow-up commit when needed; the component contract here doesn't change.

---

### Task 2: Sidebar nav entries

**Files:**
- Modify: `packages/web/src/components/Sidebar.tsx`

- [ ] **Step 1: Add "My Webhooks" to `NAV_ITEMS`**

Open `packages/web/src/components/Sidebar.tsx`. Replace the existing `NAV_ITEMS` array with:

```ts
const NAV_ITEMS = [
  { to: "/workflows",          icon: "⚡", label: "Workflows"          },
  { to: "/workflow-instances", icon: "▶",  label: "Workflow Instances" },
  { to: "/me/secrets",  icon: "🔑", label: "My Secrets" },
  { to: "/me/mcps",     icon: "🔌", label: "My MCPs"    },
  { to: "/me/skills",   icon: "🎓", label: "My Skills"  },
  { to: "/me/custom-steps", icon: "🧩", label: "My Custom Steps" },
  { to: "/me/webhooks", icon: "📡", label: "My Webhooks" },
];
```

- [ ] **Step 2: Add "Org Webhooks" to `ADMIN_ITEMS`**

Replace `ADMIN_ITEMS` with:

```ts
const ADMIN_ITEMS = [
  { to: "/admin/users",   icon: "👥", label: "Users"       },
  { to: "/admin/secrets", icon: "🔐", label: "Org Secrets" },
  { to: "/admin/mcps",    icon: "🔌", label: "Org MCPs"    },
  { to: "/admin/skills",  icon: "📦", label: "Org Skills"  },
  { to: "/admin/custom-steps", icon: "🧩", label: "Org Custom Steps" },
  { to: "/admin/webhooks", icon: "📡", label: "Org Webhooks" },
  { to: "/admin/coding-models", icon: "🧠", label: "Coding Models" },
  { to: "/admin/workflows", icon: "📋", label: "Admin Workflows" },
];
```

---

### Task 3: Tiny local schema inferrer

**Files:**
- Create: `packages/web/src/routes/webhooks/inferSchemaFromSample.ts`

The webhooks library has `inferSchema` in `@journeyman/webhooks`, but that package is `backend`-layer and not importable from `@journeyman/web` (UI layer). We need a small client-side mirror.

- [ ] **Step 1: Write the inferrer**

```ts
type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/**
 * Mirror of @journeyman/webhooks/inferSchema, rewritten here because that
 * package is backend-only. Produces a permissive JSON Schema (draft-07).
 */
export function inferSchemaFromSample(sample: unknown, maxDepth = 6): object {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    ...inferNode(sample as Json, maxDepth),
  };
}

function inferNode(value: Json, depth: number): Record<string, unknown> {
  if (depth <= 0) return {};
  if (value === null) return { type: "null" };
  if (typeof value === "boolean") return { type: "boolean" };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { type: "integer" } : { type: "number" };
  }
  if (typeof value === "string") return { type: "string" };
  if (Array.isArray(value)) {
    const items = value.length === 0 ? {} : inferNode(value[0] as Json, depth - 1);
    return { type: "array", items };
  }
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    properties[k] = inferNode(v as Json, depth - 1);
    required.push(k);
  }
  return {
    type: "object",
    properties,
    required,
    additionalProperties: true,
  };
}
```

---

### Task 4: Preset gallery (wizard step 1)

**Files:**
- Create: `packages/web/src/routes/webhooks/WebhookPresetGallery.tsx`

- [ ] **Step 1: Write the gallery component**

```tsx
import { useEffect, useState } from "react";
import type { WebhookPresetSummary } from "../../api/webhooks.ts";
import { listPresets } from "../../api/webhooks.ts";

interface Props {
  onPick: (preset: WebhookPresetSummary) => void;
}

export function WebhookPresetGallery({ onPick }: Props) {
  const [presets, setPresets] = useState<WebhookPresetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "ticket" | "git">("all");

  useEffect(() => {
    listPresets().then((rows) => { setPresets(rows); setLoading(false); });
  }, []);

  if (loading) return <p className="text-sm text-slate-400">Loading presets…</p>;

  const filtered = filter === "all" ? presets : presets.filter((p) => p.kind === filter);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 text-sm">
        {(["all", "ticket", "git"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={`px-3 py-1 rounded ${filter === k ? "bg-slate-700 text-slate-100" : "bg-slate-800 text-slate-400"}`}
          >
            {k === "all" ? "All" : k === "ticket" ? "Ticket systems" : "Git hosting"}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p)}
            className="text-left p-4 rounded border border-slate-700 hover:border-slate-500 hover:bg-slate-800/40 transition"
          >
            <div className="flex items-center justify-between mb-1">
              <div className="font-medium text-slate-100">{p.name}</div>
              <div className="text-[10px] uppercase tracking-wide text-slate-500">{p.kind}</div>
            </div>
            <div className="text-xs text-slate-400">
              {p.auth.mode} · {p.knownEventTypes.length} event types
            </div>
            {p.docsUrl && (
              <a
                href={p.docsUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-[11px] text-slate-500 hover:text-slate-300 underline"
              >
                docs ↗
              </a>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
```

---

### Task 5: Config form (wizard step 2, reused on detail)

**Files:**
- Create: `packages/web/src/routes/webhooks/WebhookConfigForm.tsx`

- [ ] **Step 1: Write the form**

```tsx
import { useState } from "react";
import type { CreateWebhookArgs, PresetId, Webhook, WebhookAuthConfig } from "@journeyman/core";
import type { WebhookPresetSummary } from "../../api/webhooks.ts";
import { inferSchemaFromSample } from "./inferSchemaFromSample.ts";

export interface ConfigFormValue {
  name: string;
  description: string;
  auth: WebhookAuthConfig;
  payloadSchema?: unknown;
  schemaInferredFrom?: string;
  schemaValidation: "off" | "warn" | "reject";
  eventTypePath?: string;
  deliveryIdHeader?: string;
  correlationSuggestions?: Array<{ key: string; path: string }>;
}

interface Props {
  preset: WebhookPresetSummary;
  initial?: Partial<ConfigFormValue>;
  submitLabel?: string;
  onSubmit: (value: ConfigFormValue) => void | Promise<void>;
  busy?: boolean;
}

export function WebhookConfigForm({ preset, initial, submitLabel = "Create webhook", onSubmit, busy }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [secretRefInput, setSecretRefInput] = useState<string>(refOf(initial?.auth ?? preset.auth));
  const [schemaValidation, setSchemaValidation] = useState<"off" | "warn" | "reject">(initial?.schemaValidation ?? "off");
  const [sample, setSample] = useState(initial?.schemaInferredFrom ?? "");
  const [schemaText, setSchemaText] = useState<string>(
    initial?.payloadSchema ? JSON.stringify(initial.payloadSchema, null, 2) : "",
  );
  const [schemaError, setSchemaError] = useState<string | null>(null);

  function inferFromSample() {
    setSchemaError(null);
    try {
      const parsed = JSON.parse(sample);
      const inferred = inferSchemaFromSample(parsed);
      setSchemaText(JSON.stringify(inferred, null, 2));
    } catch (err) {
      setSchemaError(`Sample not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setSchemaError(null);

    let parsedSchema: unknown = undefined;
    if (schemaText.trim()) {
      try {
        parsedSchema = JSON.parse(schemaText);
      } catch (err) {
        setSchemaError(`Schema not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }

    const auth = withRef(initial?.auth ?? preset.auth, secretRefInput);

    void onSubmit({
      name,
      description,
      auth,
      payloadSchema: parsedSchema,
      schemaInferredFrom: sample || undefined,
      schemaValidation,
      eventTypePath: preset.eventTypePath ?? undefined,
      deliveryIdHeader: preset.deliveryIdHeader ?? undefined,
      correlationSuggestions: preset.correlationSuggestions,
    });
  }

  const needsSecret = preset.auth.mode !== "none";

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block text-sm">
          <span className="block text-slate-300 mb-1">Name</span>
          <input
            className="w-full rounded bg-slate-800 border border-slate-700 px-2 py-1 text-slate-100"
            placeholder={`Acme ${preset.name}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <label className="block text-sm">
          <span className="block text-slate-300 mb-1">Description</span>
          <input
            className="w-full rounded bg-slate-800 border border-slate-700 px-2 py-1 text-slate-100"
            placeholder="(optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
      </div>

      <div className="rounded border border-slate-700 p-3 text-sm text-slate-300 space-y-2">
        <div className="font-medium text-slate-100">Auth: <code>{preset.auth.mode}</code></div>
        {needsSecret && (
          <label className="block">
            <span className="block text-slate-400 mb-1">Secret name (must already exist in your secrets)</span>
            <input
              className="w-full rounded bg-slate-800 border border-slate-700 px-2 py-1 text-slate-100 font-mono text-xs"
              placeholder="GITHUB_WEBHOOK_SECRET"
              value={secretRefInput}
              onChange={(e) => setSecretRefInput(e.target.value.toUpperCase())}
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Names must match <code>[A-Z][A-Z0-9_]*</code>. Create the secret first in Org Secrets or My Secrets.
            </p>
          </label>
        )}
      </div>

      <div className="rounded border border-slate-700 p-3 text-sm text-slate-300 space-y-2">
        <div className="font-medium text-slate-100">Payload schema</div>
        <label className="block">
          <span className="block text-slate-400 mb-1">Paste a sample payload (optional — generates a draft schema)</span>
          <textarea
            className="w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono text-xs text-slate-100"
            rows={5}
            value={sample}
            onChange={(e) => setSample(e.target.value)}
            placeholder='{ "action": "opened", "issue": { "number": 7 } }'
          />
          <button
            type="button"
            onClick={inferFromSample}
            className="mt-1 text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-100"
          >
            Generate schema from sample
          </button>
        </label>

        <label className="block">
          <span className="block text-slate-400 mb-1">Schema (JSON Schema draft-07)</span>
          <textarea
            className="w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono text-xs text-slate-100"
            rows={8}
            value={schemaText}
            onChange={(e) => setSchemaText(e.target.value)}
            placeholder={"{}"}
          />
          {schemaError && <p className="text-xs text-red-400 mt-1">{schemaError}</p>}
        </label>

        <label className="block">
          <span className="block text-slate-400 mb-1">Validation mode</span>
          <select
            className="rounded bg-slate-800 border border-slate-700 px-2 py-1 text-slate-100"
            value={schemaValidation}
            onChange={(e) => setSchemaValidation(e.target.value as ConfigFormValue["schemaValidation"])}
          >
            <option value="off">off — accept all payloads</option>
            <option value="warn">warn — tag invalid events</option>
            <option value="reject">reject — return 400 on schema mismatch</option>
          </select>
        </label>
      </div>

      <button
        type="submit"
        disabled={busy}
        className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm disabled:opacity-50"
      >
        {busy ? "Working…" : submitLabel}
      </button>
    </form>
  );
}

function refOf(auth: WebhookAuthConfig): string {
  switch (auth.mode) {
    case "none": return "";
    case "header-equals": return auth.valueRef;
    case "hmac": return auth.secretRef;
    case "jwt": return auth.signingKeyRef ?? "";
  }
}

function withRef(auth: WebhookAuthConfig, ref: string): WebhookAuthConfig {
  switch (auth.mode) {
    case "none": return auth;
    case "header-equals": return { ...auth, valueRef: ref };
    case "hmac": return { ...auth, secretRef: ref };
    case "jwt": return { ...auth, signingKeyRef: ref };
  }
}
```

---

### Task 6: Secret-reveal step (wizard step 3)

**Files:**
- Create: `packages/web/src/routes/webhooks/WebhookSecretReveal.tsx`

- [ ] **Step 1: Write the reveal component**

```tsx
import { useState } from "react";
import type { Webhook } from "@journeyman/core";

interface Props {
  webhook: Webhook;
  onDone: () => void;
}

export function WebhookSecretReveal({ webhook, onDone }: Props) {
  const [copied, setCopied] = useState<"url" | "secret" | null>(null);

  function copy(text: string, which: "url" | "secret") {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(which);
      window.setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <div className="space-y-4">
      <div className="rounded border border-emerald-700/40 bg-emerald-900/10 p-4">
        <h3 className="text-base font-medium text-emerald-200 mb-1">Webhook created</h3>
        <p className="text-sm text-slate-300">
          Copy the URL into the provider's webhook settings. This is the only time the
          full URL will be displayed in full; you can always rotate the token later.
        </p>
      </div>

      <label className="block">
        <span className="block text-xs text-slate-400 mb-1">Ingest URL</span>
        <div className="flex gap-2">
          <input
            readOnly
            value={webhook.ingestUrl}
            className="flex-1 rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono text-xs text-slate-100"
          />
          <button
            type="button"
            onClick={() => copy(webhook.ingestUrl, "url")}
            className="px-3 py-1 rounded bg-slate-700 hover:bg-slate-600 text-sm"
          >
            {copied === "url" ? "Copied!" : "Copy"}
          </button>
        </div>
      </label>

      <p className="text-xs text-slate-500">
        The HMAC / token / JWT secret itself is stored in the secrets vault under
        the name you specified — it isn't shown here.
      </p>

      <button
        type="button"
        onClick={onDone}
        className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm text-slate-100"
      >
        Done
      </button>
    </div>
  );
}
```

---

### Task 7: Create wizard

**Files:**
- Create: `packages/web/src/routes/webhooks/WebhookCreateWizard.tsx`

- [ ] **Step 1: Write the wizard**

```tsx
import { useState } from "react";
import type { Webhook } from "@journeyman/core";
import type { WebhookPresetSummary } from "../../api/webhooks.ts";
import { createMyWebhook, createOrgWebhook } from "../../api/webhooks.ts";
import { WebhookConfigForm, type ConfigFormValue } from "./WebhookConfigForm.tsx";
import { WebhookPresetGallery } from "./WebhookPresetGallery.tsx";
import { WebhookSecretReveal } from "./WebhookSecretReveal.tsx";

interface Props {
  scope: { orgId: string } | { userId: "me" };
  onCreated: (w: Webhook) => void;
  onCancel: () => void;
}

export function WebhookCreateWizard({ scope, onCreated, onCancel }: Props) {
  const [step, setStep] = useState<"pick" | "configure" | "reveal">("pick");
  const [preset, setPreset] = useState<WebhookPresetSummary | null>(null);
  const [created, setCreated] = useState<Webhook | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(v: ConfigFormValue) {
    if (!preset) return;
    setBusy(true);
    setError(null);
    try {
      const args = {
        name: v.name,
        description: v.description || undefined,
        preset: preset.id,
        kind: preset.kind,
        auth: v.auth,
        payloadSchema: v.payloadSchema,
        schemaInferredFrom: v.schemaInferredFrom,
        schemaValidation: v.schemaValidation,
        eventTypePath: v.eventTypePath,
        deliveryIdHeader: v.deliveryIdHeader,
        correlationSuggestions: v.correlationSuggestions,
      };
      const w = "orgId" in scope
        ? await createOrgWebhook(scope.orgId, args)
        : await createMyWebhook(args);
      setCreated(w);
      setStep("reveal");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (step === "pick") {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-slate-100">Choose a preset</h2>
          <button onClick={onCancel} className="text-sm text-slate-400 hover:text-slate-100">Cancel</button>
        </div>
        <WebhookPresetGallery
          onPick={(p) => { setPreset(p); setStep("configure"); }}
        />
      </div>
    );
  }

  if (step === "configure" && preset) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium text-slate-100">Configure {preset.name}</h2>
          <button onClick={() => setStep("pick")} className="text-sm text-slate-400 hover:text-slate-100">← back</button>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <WebhookConfigForm preset={preset} onSubmit={submit} busy={busy} />
      </div>
    );
  }

  if (step === "reveal" && created) {
    return (
      <WebhookSecretReveal
        webhook={created}
        onDone={() => onCreated(created)}
      />
    );
  }

  return null;
}
```

---

### Task 8: My Webhooks page

**Files:**
- Create: `packages/web/src/routes/MyWebhooksPage.tsx`

- [ ] **Step 1: Write the list page**

```tsx
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Webhook } from "@journeyman/core";
import { btnPrimary, card, codePill } from "./admin-styles.ts";
import { deleteWebhook, listMyWebhooks } from "../api/webhooks.ts";
import { WebhookCreateWizard } from "./webhooks/WebhookCreateWizard.tsx";

export function MyWebhooksPage() {
  const [rows, setRows] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  async function refresh() {
    setLoading(true);
    setRows(await listMyWebhooks().catch(() => []));
    setLoading(false);
  }
  useEffect(() => { void refresh(); }, []);

  async function remove(w: Webhook) {
    if (!confirm(`Delete webhook "${w.name}"?`)) return;
    await deleteWebhook(w.id);
    await refresh();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <header className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">My Webhooks</h1>
            <p className="mt-1 text-sm text-slate-400">
              Personal webhook endpoints. Flows you own can subscribe to these.
            </p>
          </div>
          {!creating && (
            <button className={btnPrimary} onClick={() => setCreating(true)}>+ New webhook</button>
          )}
        </header>

        {creating && (
          <section className={`${card} p-6`}>
            <WebhookCreateWizard
              scope={{ userId: "me" }}
              onCancel={() => setCreating(false)}
              onCreated={() => { setCreating(false); void refresh(); }}
            />
          </section>
        )}

        <section className={`${card} p-0 overflow-hidden`}>
          {loading ? (
            <p className="p-6 text-sm text-slate-400">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-slate-400">No webhooks yet. Create one to receive events.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500 border-b border-slate-700">
                <tr>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Preset</th>
                  <th className="px-4 py-2">Kind</th>
                  <th className="px-4 py-2">Last event</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id} className="border-b border-slate-800 hover:bg-slate-800/30">
                    <td className="px-4 py-2">
                      <Link to={`/me/webhooks/${w.id}`} className="text-emerald-300 hover:underline">{w.name}</Link>
                      {w.description && <div className="text-xs text-slate-500">{w.description}</div>}
                    </td>
                    <td className="px-4 py-2"><code className={codePill}>{w.preset}</code></td>
                    <td className="px-4 py-2 text-slate-400">{w.kind}</td>
                    <td className="px-4 py-2 text-slate-400">
                      {w.lastEventAt ? new Date(w.lastEventAt).toLocaleString() : "never"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => remove(w)}
                        className="text-xs text-red-300 hover:text-red-200"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
```

---

### Task 9: Admin Webhooks page

**Files:**
- Create: `packages/web/src/routes/AdminWebhooksPage.tsx`

- [ ] **Step 1: Write the list page**

```tsx
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Webhook } from "@journeyman/core";
import { btnPrimary, card, codePill } from "./admin-styles.ts";
import { deleteWebhook, listOrgWebhooks } from "../api/webhooks.ts";
import { WebhookCreateWizard } from "./webhooks/WebhookCreateWizard.tsx";

export function AdminWebhooksPage(props: { orgId: string }) {
  const [rows, setRows] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function refresh() {
    setLoading(true);
    setRows(await listOrgWebhooks(props.orgId).catch(() => []));
    setLoading(false);
  }
  useEffect(() => { void refresh(); }, [props.orgId]);

  async function remove(w: Webhook) {
    if (!confirm(`Delete webhook "${w.name}"?`)) return;
    await deleteWebhook(w.id);
    await refresh();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <header className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">Org Webhooks</h1>
            <p className="mt-1 text-sm text-slate-400">
              Webhook endpoints shared across this organization.
            </p>
          </div>
          {!creating && (
            <button className={btnPrimary} onClick={() => setCreating(true)}>+ New webhook</button>
          )}
        </header>

        {creating && (
          <section className={`${card} p-6`}>
            <WebhookCreateWizard
              scope={{ orgId: props.orgId }}
              onCancel={() => setCreating(false)}
              onCreated={() => { setCreating(false); void refresh(); }}
            />
          </section>
        )}

        <section className={`${card} p-0 overflow-hidden`}>
          {loading ? (
            <p className="p-6 text-sm text-slate-400">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="p-6 text-sm text-slate-400">No webhooks yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500 border-b border-slate-700">
                <tr>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Preset</th>
                  <th className="px-4 py-2">Kind</th>
                  <th className="px-4 py-2">Last event</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id} className="border-b border-slate-800 hover:bg-slate-800/30">
                    <td className="px-4 py-2">
                      <Link to={`/admin/webhooks/${w.id}`} className="text-emerald-300 hover:underline">{w.name}</Link>
                      {w.description && <div className="text-xs text-slate-500">{w.description}</div>}
                    </td>
                    <td className="px-4 py-2"><code className={codePill}>{w.preset}</code></td>
                    <td className="px-4 py-2 text-slate-400">{w.kind}</td>
                    <td className="px-4 py-2 text-slate-400">
                      {w.lastEventAt ? new Date(w.lastEventAt).toLocaleString() : "never"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => remove(w)}
                        className="text-xs text-red-300 hover:text-red-200"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
```

---

### Task 10: Detail-page tab components (overview, schema, events, test)

**Files:**
- Create: `packages/web/src/routes/webhooks/WebhookOverviewTab.tsx`
- Create: `packages/web/src/routes/webhooks/WebhookSchemaTab.tsx`
- Create: `packages/web/src/routes/webhooks/WebhookEventsTab.tsx`
- Create: `packages/web/src/routes/webhooks/WebhookTestPanel.tsx`

- [ ] **Step 1: Write `WebhookOverviewTab.tsx`**

```tsx
import { useState } from "react";
import type { Webhook } from "@journeyman/core";
import { rotateWebhook } from "../../api/webhooks.ts";

interface Props {
  webhook: Webhook;
  onChange: (w: Webhook) => void;
}

export function WebhookOverviewTab({ webhook, onChange }: Props) {
  const [busy, setBusy] = useState(false);

  async function rotate() {
    if (!confirm("Rotate the URL token? Old URL stops working immediately.")) return;
    setBusy(true);
    try {
      const next = await rotateWebhook(webhook.id);
      onChange(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <Field label="Ingest URL">
        <code className="block px-2 py-1 rounded bg-slate-900 border border-slate-700 font-mono text-xs break-all">
          {webhook.ingestUrl}
        </code>
        <button
          onClick={rotate}
          disabled={busy}
          className="mt-2 text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-50"
        >
          {busy ? "Rotating…" : "Rotate URL token"}
        </button>
      </Field>
      <Field label="Preset"><span className="text-slate-300">{webhook.preset} ({webhook.kind})</span></Field>
      <Field label="Auth mode"><code className="text-xs text-slate-300">{webhook.auth.mode}</code></Field>
      <Field label="Event type path"><code className="text-xs text-slate-300">{webhook.eventTypePath ?? "—"}</code></Field>
      <Field label="Created"><span className="text-slate-400">{new Date(webhook.createdAt).toLocaleString()}</span></Field>
      <Field label="Last event">
        <span className="text-slate-400">
          {webhook.lastEventAt ? new Date(webhook.lastEventAt).toLocaleString() : "never"}
        </span>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500 mb-1">{label}</div>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Write `WebhookSchemaTab.tsx`**

```tsx
import { useState } from "react";
import type { Webhook } from "@journeyman/core";
import { updateWebhook } from "../../api/webhooks.ts";

interface Props {
  webhook: Webhook;
  onChange: (w: Webhook) => void;
}

export function WebhookSchemaTab({ webhook, onChange }: Props) {
  const [text, setText] = useState(
    webhook.payloadSchema ? JSON.stringify(webhook.payloadSchema, null, 2) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    let parsed: unknown = null;
    if (text.trim()) {
      try { parsed = JSON.parse(text); }
      catch (e) { setError(`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`); return; }
    }
    setBusy(true);
    try {
      const next = await updateWebhook(webhook.id, { payloadSchema: parsed });
      onChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">
        JSON Schema (draft-07) for payloads. Used for editor autocomplete and (optionally) ingest validation.
      </p>
      <textarea
        rows={16}
        className="w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono text-xs text-slate-100"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="{}"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        onClick={save}
        disabled={busy}
        className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save schema"}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Write `WebhookEventsTab.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { WebhookEvent } from "@journeyman/core";
import { listRecentEventsForWebhook } from "../../api/webhooks.ts";

export function WebhookEventsTab({ webhookId }: { webhookId: string }) {
  const [rows, setRows] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void listRecentEventsForWebhook(webhookId).then((r) => {
      setRows(r);
      setLoading(false);
    });
  }, [webhookId]);

  if (loading) return <p className="text-sm text-slate-400">Loading…</p>;
  if (rows.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        No recent events shown. Per-webhook event listing requires a dedicated API endpoint
        that isn't part of plan 2's surface; this tab is a placeholder until that ships.
      </p>
    );
  }

  return (
    <ul className="space-y-2 text-sm">
      {rows.map((ev) => (
        <li key={ev.id} className="rounded border border-slate-700 px-3 py-2">
          <div className="flex justify-between">
            <span className="text-slate-200">{ev.eventType ?? "(no type)"}</span>
            <span className="text-xs text-slate-500">{new Date(ev.receivedAt).toLocaleString()}</span>
          </div>
          <div className="text-xs text-slate-500">status: {ev.status}</div>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 4: Write `WebhookTestPanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { Webhook } from "@journeyman/core";
import { getPresetDetail, testWebhook, type TestDeliveryResult } from "../../api/webhooks.ts";

export function WebhookTestPanel({ webhook }: { webhook: Webhook }) {
  const [samples, setSamples] = useState<Record<string, unknown>>({});
  const [selected, setSelected] = useState<string>("");
  const [customPayload, setCustomPayload] = useState<string>("");
  const [result, setResult] = useState<TestDeliveryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getPresetDetail(webhook.preset)
      .then((d) => {
        const s = (d.samples ?? {}) as Record<string, unknown>;
        setSamples(s);
        const keys = Object.keys(s);
        if (keys.length > 0) setSelected(keys[0]!);
      })
      .catch(() => { /* preset may not exist (generic); leave empty */ });
  }, [webhook.preset]);

  async function send() {
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      let body: { sampleEvent?: string; payload?: unknown };
      if (customPayload.trim()) {
        try { body = { payload: JSON.parse(customPayload) }; }
        catch (e) { throw new Error(`Custom payload not JSON: ${e instanceof Error ? e.message : String(e)}`); }
      } else if (selected) {
        body = { sampleEvent: selected };
      } else {
        throw new Error("Pick a sample or paste a custom payload");
      }
      setResult(await testWebhook(webhook.id, body));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const sampleKeys = Object.keys(samples);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-slate-400">
        Sends a synthetic, validly-signed event through this webhook's ingest pipeline. JWT auth is not synthesized in v1.
      </p>
      {sampleKeys.length > 0 && (
        <label className="block">
          <span className="block text-xs text-slate-400 mb-1">Sample event from preset</span>
          <select
            className="rounded bg-slate-800 border border-slate-700 px-2 py-1 text-slate-100"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {sampleKeys.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
      )}
      <label className="block">
        <span className="block text-xs text-slate-400 mb-1">Or paste a custom payload (overrides sample)</span>
        <textarea
          rows={6}
          className="w-full rounded bg-slate-900 border border-slate-700 px-2 py-1 font-mono text-xs text-slate-100"
          value={customPayload}
          onChange={(e) => setCustomPayload(e.target.value)}
          placeholder='{"action":"opened"}'
        />
      </label>
      <button
        onClick={send}
        disabled={busy}
        className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm disabled:opacity-50"
      >
        {busy ? "Sending…" : "Send test event"}
      </button>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {result && (
        <pre className="text-xs rounded bg-slate-900 border border-slate-700 p-2 overflow-x-auto">
{JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
```

---

### Task 11: Detail page

**Files:**
- Create: `packages/web/src/routes/WebhookDetailPage.tsx`

- [ ] **Step 1: Write the page**

```tsx
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Webhook } from "@journeyman/core";
import { card } from "./admin-styles.ts";
import { deleteWebhook, getWebhook } from "../api/webhooks.ts";
import { WebhookOverviewTab } from "./webhooks/WebhookOverviewTab.tsx";
import { WebhookSchemaTab } from "./webhooks/WebhookSchemaTab.tsx";
import { WebhookEventsTab } from "./webhooks/WebhookEventsTab.tsx";
import { WebhookTestPanel } from "./webhooks/WebhookTestPanel.tsx";

type Tab = "overview" | "schema" | "events" | "test";

export function WebhookDetailPage(props: { backTo: string }) {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [webhook, setWebhook] = useState<Webhook | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    getWebhook(id).then(setWebhook).catch((e) => setError(e.message));
  }, [id]);

  async function remove() {
    if (!webhook) return;
    if (!confirm(`Delete webhook "${webhook.name}"?`)) return;
    await deleteWebhook(webhook.id);
    navigate(props.backTo);
  }

  if (error) return <p className="p-6 text-sm text-red-400">{error}</p>;
  if (!webhook) return <p className="p-6 text-sm text-slate-400">Loading…</p>;

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "schema",   label: "Schema" },
    { id: "events",   label: "Recent events" },
    { id: "test",     label: "Send test event" },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        <header className="flex items-start justify-between">
          <div>
            <Link to={props.backTo} className="text-xs text-slate-500 hover:text-slate-300">← back</Link>
            <h1 className="mt-1 text-2xl font-semibold text-slate-100">{webhook.name}</h1>
            {webhook.description && <p className="text-sm text-slate-400 mt-1">{webhook.description}</p>}
          </div>
          <button onClick={remove} className="text-xs text-red-300 hover:text-red-200">Delete</button>
        </header>

        <nav className="flex gap-2 border-b border-slate-700">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm border-b-2 ${
                tab === t.id ? "border-emerald-500 text-slate-100" : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <section className={`${card} p-6`}>
          {tab === "overview" && <WebhookOverviewTab webhook={webhook} onChange={setWebhook} />}
          {tab === "schema"   && <WebhookSchemaTab   webhook={webhook} onChange={setWebhook} />}
          {tab === "events"   && <WebhookEventsTab   webhookId={webhook.id} />}
          {tab === "test"     && <WebhookTestPanel   webhook={webhook} />}
        </section>
      </div>
    </div>
  );
}
```

---

### Task 12: Wire pages into `App.tsx`

**Files:**
- Modify: `packages/web/src/App.tsx`

- [ ] **Step 1: Add imports**

Below the existing route imports, add:

```tsx
import { MyWebhooksPage } from "./routes/MyWebhooksPage.tsx";
import { AdminWebhooksPage } from "./routes/AdminWebhooksPage.tsx";
import { WebhookDetailPage } from "./routes/WebhookDetailPage.tsx";
```

- [ ] **Step 2: Add routes**

Inside the `<Routes>` block (alongside the existing `/me/secrets` and `/admin/secrets` entries), add:

```tsx
        <Route path="/me/webhooks" element={<MyWebhooksPage />} />
        <Route path="/me/webhooks/:id" element={<WebhookDetailPage backTo="/me/webhooks" />} />
        <Route path="/admin/webhooks" element={role === "admin" ? <AdminWebhooksPage orgId={activeOrgId} /> : <Navigate to="/" replace />} />
        <Route path="/admin/webhooks/:id" element={role === "admin" ? <WebhookDetailPage backTo="/admin/webhooks" /> : <Navigate to="/" replace />} />
```

Place these near the other secrets/mcps routes for readability.

---

### Task 13: Webhooks-for-picker hook (flow-editor)

**Files:**
- Create: `packages/flow-editor/src/properties-panel/useWebhooksForPicker.ts`

The flow-editor lives in its own UI-layer workspace package and cannot import from `@journeyman/web`. It needs its own small fetch helper that hits the API endpoints directly.

- [ ] **Step 1: Write the hook**

```ts
import { useEffect, useState } from "react";
import type { Webhook } from "@journeyman/core";

export interface WebhookForPicker {
  id: string;
  name: string;
  preset: string;
  kind: "ticket" | "git";
  knownEventTypes: string[];
  correlationSuggestions: Array<{ key: string; path: string }>;
  payloadSchema?: unknown;
}

/**
 * Fetch both user-scope and org-scope webhooks visible to the current user.
 * Returns an empty list on any error — the picker degrades to "type a webhook
 * id manually" in that case (no UI yet, but the node config can still be set
 * via the JSON tab).
 */
export function useWebhooksForPicker(): { webhooks: WebhookForPicker[]; loading: boolean } {
  const [webhooks, setWebhooks] = useState<WebhookForPicker[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [mine, presets] = await Promise.all([
          fetch("/api/users/me/webhooks", { credentials: "include" })
            .then((r) => (r.ok ? (r.json() as Promise<Webhook[]>) : []))
            .catch(() => [] as Webhook[]),
          fetch("/api/webhook-presets", { credentials: "include" })
            .then((r) => (r.ok ? (r.json() as Promise<Array<{ id: string; knownEventTypes: string[]; correlationSuggestions: Array<{ key: string; path: string }> }>>) : []))
            .catch(() => []),
        ]);
        if (cancelled) return;
        const presetById = new Map(presets.map((p) => [p.id, p]));
        setWebhooks(mine.map((w) => ({
          id: w.id,
          name: w.name,
          preset: w.preset,
          kind: w.kind,
          knownEventTypes: presetById.get(w.preset)?.knownEventTypes ?? [],
          correlationSuggestions: presetById.get(w.preset)?.correlationSuggestions ?? [],
          payloadSchema: w.payloadSchema,
        })));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  return { webhooks, loading };
}

/**
 * Walks a JSON Schema and produces dot-paths for use as fromPath autocomplete
 * suggestions, e.g. ["$.action", "$.issue.number", "$.repository.full_name"].
 * Stops at `maxDepth` to keep the suggestion list manageable.
 */
export function pathsFromSchema(schema: unknown, maxDepth = 4): string[] {
  if (!schema || typeof schema !== "object") return [];
  const out: string[] = [];
  walk(schema as Record<string, unknown>, "$", out, maxDepth);
  return out;
}

function walk(node: Record<string, unknown>, prefix: string, out: string[], depth: number): void {
  if (depth <= 0) return;
  const props = node["properties"];
  if (props && typeof props === "object") {
    for (const [k, child] of Object.entries(props as Record<string, unknown>)) {
      const path = `${prefix}.${k}`;
      out.push(path);
      if (child && typeof child === "object") {
        walk(child as Record<string, unknown>, path, out, depth - 1);
      }
    }
  }
}
```

---

### Task 14: Extend `WebhookWaitConfigEditor`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/WebhookWaitConfigEditor.tsx`

The existing editor uses a `provider` string to scope event matching against the legacy `/webhooks/:provider` route. The new design adds a `webhookId` field that picks a registry webhook. Both must coexist (existing nodes keep working).

- [ ] **Step 1: Replace the file**

```tsx
import { useMemo, useState } from "react";
import type { WorkflowNode } from "@journeyman/core";
import { AcceptIfBuilder } from "./AcceptIfBuilder.tsx";
import { pathsFromSchema, useWebhooksForPicker } from "./useWebhooksForPicker.ts";

interface WebhookWaitOutputCfg {
  name: string;
  type: "string" | "number" | "boolean" | "json" | "date";
  label?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
  fromPath?: string;
}

interface Props {
  node: WorkflowNode;
  onChange: (next: WorkflowNode) => void;
  readOnly?: boolean;
}

const PROVIDERS = ["jira", "github", "gitlab", "monday", "linear", "api"] as const;

export function WebhookWaitConfigEditor({ node, onChange, readOnly }: Props) {
  const cfg = (node.config ?? {}) as {
    webhookId?: string;
    provider?: string;
    listensFor?: string[];
    acceptIf?: unknown;
    correlationKey?: "issueRef";
    outputs?: WebhookWaitOutputCfg[];
    timeout?: { duration: string; defaults?: Record<string, unknown> };
  };
  const outputs = cfg.outputs ?? [];

  const { webhooks, loading: loadingWebhooks } = useWebhooksForPicker();
  const selectedWebhook = useMemo(
    () => webhooks.find((w) => w.id === cfg.webhookId),
    [webhooks, cfg.webhookId],
  );
  const suggestedPaths = useMemo(
    () => (selectedWebhook ? pathsFromSchema(selectedWebhook.payloadSchema) : []),
    [selectedWebhook],
  );

  const [defaultsDraft, setDefaultsDraft] = useState<string>(
    cfg.timeout?.defaults ? JSON.stringify(cfg.timeout.defaults, null, 2) : "",
  );
  const [defaultsError, setDefaultsError] = useState<string | null>(null);

  const update = (patch: Partial<typeof cfg>) => {
    onChange({ ...node, config: { ...cfg, ...patch } });
  };

  const updateOutput = (idx: number, patch: Partial<WebhookWaitOutputCfg>) => {
    const next = outputs.slice();
    next[idx] = { ...next[idx], ...patch };
    update({ outputs: next });
  };

  const removeOutput = (idx: number) => {
    update({ outputs: outputs.filter((_, i) => i !== idx) });
  };

  const addOutput = () => {
    let n = outputs.length + 1;
    let name = `field${n}`;
    while (outputs.some((o) => o.name === name)) name = `field${++n}`;
    update({ outputs: [...outputs, { name, type: "string" }] });
  };

  const knownPaths = Array.from(new Set([
    ...suggestedPaths,
    ...outputs.map((o) => o.fromPath?.trim()).filter((p): p is string => !!p),
  ]));

  const datalistId = `webhook-paths-${node.id}`;
  const eventTypeOptions = selectedWebhook?.knownEventTypes ?? [];

  return (
    <div className="je-tab je-tab--config je-humantask">
      {/* New: webhook picker. Legacy provider field shown below for un-migrated nodes. */}
      <div className="je-field">
        <label className="je-field__label">Webhook</label>
        <select
          value={cfg.webhookId ?? ""}
          disabled={readOnly || loadingWebhooks}
          onChange={(e) => update({ webhookId: e.target.value || undefined })}
        >
          <option value="">— pick a webhook —</option>
          {webhooks.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.preset})
            </option>
          ))}
        </select>
        <p className="je-hint">
          {selectedWebhook
            ? `Schema-aware. ${suggestedPaths.length} paths suggested below.`
            : "Pick a registered webhook to enable autocomplete on fromPath fields."}
        </p>
      </div>

      {!cfg.webhookId && (
        <div className="je-field">
          <label className="je-field__label">Legacy provider (un-migrated)</label>
          <select
            value={cfg.provider ?? ""}
            disabled={readOnly}
            onChange={(e) => update({ provider: e.target.value })}
          >
            <option value="">— pick a provider —</option>
            {PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <p className="je-hint">
            For nodes still wired to the legacy <code>/webhooks/:provider</code> URL.
            Prefer a registered webhook above.
          </p>
        </div>
      )}

      <div className="je-field">
        <label className="je-field__label">Listens for</label>
        <input
          type="text"
          list={`event-types-${node.id}`}
          placeholder={eventTypeOptions.length > 0 ? `e.g. ${eventTypeOptions.slice(0, 2).join(", ")}` : "e.g. pull_request, jira:issue_updated"}
          value={(cfg.listensFor ?? []).join(", ")}
          disabled={readOnly}
          onChange={(e) =>
            update({
              listensFor: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
            })
          }
        />
        <datalist id={`event-types-${node.id}`}>
          {eventTypeOptions.map((t) => <option key={t} value={t} />)}
        </datalist>
        <p className="je-hint">Comma-separated event types. Empty means any.</p>
      </div>

      <div className="je-field">
        <label className="je-field__label">Accept if (optional)</label>
        <AcceptIfBuilder
          value={cfg.acceptIf}
          knownPaths={knownPaths}
          readOnly={readOnly}
          datalistId={`acceptif-paths-${node.id}`}
          onChange={(next) => update({ acceptIf: next })}
        />
      </div>

      <div className="je-field">
        <label className="je-field__label">Outputs</label>
        <datalist id={datalistId}>
          {suggestedPaths.map((p) => <option key={p} value={p} />)}
        </datalist>
        {outputs.length === 0 && (
          <p className="je-hint">No outputs yet. Add one to extract a value from incoming payloads.</p>
        )}
        {outputs.map((o, i) => (
          <div key={i} className="je-row">
            <input
              placeholder="field name"
              value={o.name}
              disabled={readOnly}
              onChange={(e) => updateOutput(i, { name: e.target.value })}
            />
            <select
              value={o.type}
              disabled={readOnly}
              onChange={(e) => updateOutput(i, { type: e.target.value as WebhookWaitOutputCfg["type"] })}
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="json">json</option>
              <option value="date">date</option>
            </select>
            <input
              list={datalistId}
              placeholder="fromPath e.g. $.pull_request.number"
              value={o.fromPath ?? ""}
              disabled={readOnly}
              onChange={(e) => updateOutput(i, { fromPath: e.target.value || undefined })}
            />
            <button type="button" disabled={readOnly} onClick={() => removeOutput(i)}>×</button>
          </div>
        ))}
        {!readOnly && (
          <button type="button" onClick={addOutput} className="je-add-output">
            + Add output
          </button>
        )}
      </div>

      <div className="je-field">
        <label className="je-field__label">Timeout (optional)</label>
        <input
          type="text"
          placeholder="e.g. 24h"
          value={cfg.timeout?.duration ?? ""}
          disabled={readOnly}
          onChange={(e) =>
            update({
              timeout: e.target.value
                ? { duration: e.target.value, defaults: cfg.timeout?.defaults }
                : undefined,
            })
          }
        />
        <textarea
          rows={4}
          placeholder='{ "fieldName": "default value" }'
          value={defaultsDraft}
          disabled={readOnly || !cfg.timeout?.duration}
          onChange={(e) => {
            const text = e.target.value;
            setDefaultsDraft(text);
            setDefaultsError(null);
            if (!text.trim()) {
              update({ timeout: cfg.timeout ? { ...cfg.timeout, defaults: undefined } : undefined });
              return;
            }
            try {
              const parsed = JSON.parse(text) as Record<string, unknown>;
              if (cfg.timeout) update({ timeout: { ...cfg.timeout, defaults: parsed } });
            } catch (err) {
              setDefaultsError(err instanceof Error ? err.message : String(err));
            }
          }}
        />
        {defaultsError && <p className="je-hint je-hint--error">{defaultsError}</p>}
      </div>
    </div>
  );
}
```

The `<datalist>` element backs the `<input list="…">` autocomplete on `fromPath` — native, zero-dep. Suggestions update whenever the picked webhook (and therefore its schema) changes.

---

### Task 15: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Install workspace deps**

```bash
npm install
```

Expected: no new package additions; existing links unchanged.

- [ ] **Step 2: Typecheck the changed packages**

```bash
npm run typecheck -w @journeyman/web
npm run typecheck -w @journeyman/flow-editor
```

Expected: both print `tsc --noEmit` with zero errors.

- [ ] **Step 3: Full repo check**

```bash
npm run check
```

Expected: typecheck passes across all workspaces, then prints `✓ Layer boundaries clean across all packages.`

- [ ] **Step 4: Manual smoke (optional, no auto-asserts)**

```bash
npm run dev:web
```

Then in the browser:

1. Sign in as a non-admin user → see "My Webhooks" in the sidebar.
2. Click it → page renders with a "+ New webhook" button.
3. Click new → preset gallery shows 11 cards (10 named + generic).
4. Pick GitHub (code events) → config form shows secret-name field with `HMAC` mode header.
5. Submit with name + secret name → secret-reveal page shows ingest URL.
6. Click Done → returns to list, new row appears with `lastEventAt: never`.
7. Click the row → detail page with four tabs (Overview / Schema / Recent events / Send test event).
8. Switch to "Send test event" → if the named secret exists in the secrets vault, "Send test event" works and shows the ingest result.
9. As an admin, navigate to `/admin/webhooks` → org-scoped list works the same way.
10. In a workflow editor, drop a Webhook Wait node → the new dropdown lists your created webhook; selecting it populates the `Listens for` datalist with the preset's known event types and suggests `fromPath` paths.

(This step is purely exploratory; no test fixtures are checked in.)

---

## Plan Self-Review

**Spec coverage** (frontend portion only):

| Spec section | Task(s) |
|---|---|
| Sidebar item for Webhooks (user + org) | 2 |
| List page with last-event timestamp, used-by count, copy URL | 8, 9 (used-by count deferred — see below) |
| Detail page with Overview / Schema / Recent events / Used by tabs | 11 (used-by deferred to a stub note) |
| Schema editor (textarea instead of Monaco — YAGNI for v1) | 10 step 2 |
| "Send test event" panel | 10 step 4, 11 |
| Rotate secret action | 10 step 1 |
| Create wizard with preset gallery + sample inference + secret reveal | 4, 5, 6, 7 |
| Webhook picker on `webhook-wait` node | 13, 14 |
| Schema-driven `fromPath` autocomplete | 13 (`pathsFromSchema`) + 14 (datalist) |
| Inline "validate against schema" indicator — *deferred* | (see below) |
| Routing | 12 |
| API client | 1 |
| Verification | 15 |

**Carry-forward (deferred, intentionally documented):**

- **Used-by tab.** Listing flows that reference a webhook requires a backend endpoint that walks workflow definitions for `webhookId` references. Not part of plan 2's surface. The detail page omits this tab today; adding it later is one route + one component.
- **Monaco editor for schema.** Spec mentioned Monaco; this plan ships with a `<textarea>` + JSON.parse to keep the bundle small and the plan tight. Drop-in Monaco swap is a single-file change inside `WebhookSchemaTab.tsx` when desired.
- **Per-event live tail / counts in the list.** The list shows `lastEventAt`. Volume counts require an aggregating query — defer.
- **Validation indicator color (green/amber/red) on each `fromPath` field.** The dropdown of suggested paths is in place; the per-field color treatment requires walking the schema with the path and is a polish pass.

**Placeholder scan:** no `TBD` / `fill in details` patterns. The `listRecentEventsForWebhook` stub in Task 1 is intentional — labeled in the code comment, and the UI renders a plain-English "this requires a dedicated API endpoint that isn't part of plan 2's surface" so the user is informed rather than confused.

**Type consistency:** `WebhookPresetSummary`, `WebhookPresetDetail`, `ConfigFormValue`, `WebhookForPicker` are defined once each and consumed without drift. `Webhook` and `WebhookAuthConfig` come from `@journeyman/core` throughout. The auth-ref accessor functions `refOf` / `withRef` in Task 5 exhaustively switch on the `WebhookAuthConfig` discriminated union from core. `cfg.webhookId` on the WebhookWait node is treated as an optional string in Task 14 — consistent with the existing `cfg.provider` optional treatment.

---

## Execution Handoff

Plan complete and saved to [`docs/superpowers/plans/2026-05-25-webhook-management-frontend.md`](2026-05-25-webhook-management-frontend.md).

**Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks. Best when each task can be reviewed independently before moving on.

2. **Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
