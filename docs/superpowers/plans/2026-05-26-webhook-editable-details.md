# Webhook Editable Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users edit webhook `name`, `description`, and the auth secret reference from the webhook detail page in the `@journeyman/web` UI.

**Architecture:** UI-only change. Header gets inline-edit for name and description using a new small `InlineEdit` component. The Overview tab gets an editable "Secret" field using the existing `SecretPicker`. All saves call the already-existing `updateWebhook()` API helper which hits the already-existing `PATCH /api/webhooks/:id` endpoint. No backend, no `@journeyman/core`, no API client additions.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, React Router. Verification via `preview_*` tools (Vite dev server).

**Spec:** [docs/superpowers/specs/2026-05-26-webhook-editable-details-design.md](../specs/2026-05-26-webhook-editable-details-design.md)

---

## File Structure

| File | Purpose |
|---|---|
| `packages/web/src/routes/webhooks/InlineEdit.tsx` _(new)_ | Reusable click-to-edit text/textarea component. Used by header. |
| `packages/web/src/routes/WebhookDetailPage.tsx` _(modify)_ | Replace static `<h1>` and `<p>` with `<InlineEdit>` instances wired to `updateWebhook()`. |
| `packages/web/src/routes/webhooks/WebhookOverviewTab.tsx` _(modify)_ | Replace read-only `Auth mode` row with an editable "Secret" sub-row (SecretPicker + Save/Cancel). Only shown when `auth.mode !== "none"`. |

The auth-mode itself stays locked (per spec non-goals). The only auth field a user can edit post-create is the secret ref — that's the practical scope.

---

## Task 1: Create the InlineEdit component

**Files:**
- Create: `packages/web/src/routes/webhooks/InlineEdit.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useRef, useState } from "react";

interface Props {
  value: string;
  /** When true, renders a textarea. Default false (single-line input). */
  multiline?: boolean;
  /** Save handler. Receives the new value, or null when the field is cleared and allowEmpty is true. */
  onSave: (next: string | null) => Promise<void>;
  /** Shown when value is empty in display mode. Click it to start editing. */
  placeholder?: string;
  /** When true, saving an empty value calls onSave(null). When false (default), empty values are rejected. */
  allowEmpty?: boolean;
  /** Display-mode class for the rendered text (e.g. "text-2xl font-semibold text-slate-100"). */
  displayClassName?: string;
  /** Optional aria-label for the input. */
  ariaLabel?: string;
}

export function InlineEdit({
  value,
  multiline = false,
  onSave,
  placeholder = "Click to edit",
  allowEmpty = false,
  displayClassName = "",
  ariaLabel,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select?.();
    }
  }, [editing]);

  function start() {
    setError(null);
    setDraft(value);
    setEditing(true);
  }

  function cancel() {
    setDraft(value);
    setError(null);
    setEditing(false);
  }

  async function commit() {
    const trimmed = draft.trim();
    if (!trimmed && !allowEmpty) {
      setError("Required");
      return;
    }
    if (trimmed === value.trim()) {
      setEditing(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSave(trimmed ? trimmed : null);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setDraft(value);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Enter" && !multiline) {
      e.preventDefault();
      void commit();
    } else if (e.key === "Enter" && multiline && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void commit();
    }
  }

  if (editing) {
    const common = {
      ref: inputRef as never,
      value: draft,
      disabled: busy,
      "aria-label": ariaLabel,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
      onBlur: () => void commit(),
      onKeyDown,
      className:
        "w-full rounded bg-slate-800 border border-slate-600 px-2 py-1 text-slate-100 disabled:opacity-50",
    };
    return (
      <div className="space-y-1">
        {multiline ? <textarea rows={3} {...common} /> : <input type="text" {...common} />}
        {error && <p className="text-xs text-red-400">{error}</p>}
        {multiline && !error && (
          <p className="text-xs text-slate-500">Press ⌘/Ctrl+Enter to save, Esc to cancel.</p>
        )}
      </div>
    );
  }

  const isEmpty = !value || !value.trim();
  return (
    <button
      type="button"
      onClick={start}
      className={`group inline-flex items-start gap-2 text-left hover:bg-slate-800/40 rounded px-1 -mx-1 ${displayClassName}`}
      aria-label={ariaLabel ? `Edit ${ariaLabel}` : "Edit"}
    >
      <span className={isEmpty ? "text-slate-500 italic" : ""}>
        {isEmpty ? placeholder : value}
      </span>
      <span aria-hidden className="opacity-0 group-hover:opacity-60 text-xs text-slate-400 mt-1.5">
        ✎
      </span>
    </button>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npm --workspace @journeyman/web run typecheck`
(If no per-workspace typecheck script, fall back to: `npm run typecheck` from repo root.)
Expected: passes with no errors mentioning `InlineEdit.tsx`.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/routes/webhooks/InlineEdit.tsx
git commit -m "feat(web): add InlineEdit component for click-to-edit fields"
```

---

## Task 2: Wire InlineEdit for webhook name in the page header

**Files:**
- Modify: `packages/web/src/routes/WebhookDetailPage.tsx`

- [ ] **Step 1: Add the import**

At the top of `WebhookDetailPage.tsx`, add `updateWebhook` to the existing `../api/webhooks.ts` import and import `InlineEdit`:

```tsx
import { deleteWebhook, getWebhook, updateWebhook } from "../api/webhooks.ts";
import { InlineEdit } from "./webhooks/InlineEdit.tsx";
```

- [ ] **Step 2: Add a save handler inside the component**

Inside `WebhookDetailPage` (after the existing `remove` function, before the early returns), add:

```tsx
async function saveName(next: string | null) {
  if (!webhook || next === null) return; // name is required; InlineEdit prevents null when allowEmpty=false
  const updated = await updateWebhook(webhook.id, { name: next });
  setWebhook(updated);
}
```

- [ ] **Step 3: Replace the static `<h1>` with `<InlineEdit>`**

Replace this block in the header:

```tsx
<h1 className="mt-1 text-2xl font-semibold text-slate-100">{webhook.name}</h1>
```

with:

```tsx
<div className="mt-1">
  <InlineEdit
    value={webhook.name}
    onSave={saveName}
    ariaLabel="webhook name"
    displayClassName="text-2xl font-semibold text-slate-100"
  />
</div>
```

- [ ] **Step 4: Type-check**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 5: Manual verification**

Start the dev server (if not running):

```bash
npm run dev:web
```

Then in the browser:
1. Open a webhook detail page (e.g. `/me/webhooks/<id>` or `/admin/webhooks/<id>`).
2. Click the name. An input appears.
3. Edit, press Enter. Header shows new value.
4. Reload the page. New value persists.
5. Click name, clear it, press Enter. An inline "Required" error appears; name is not changed.
6. Click name, press Escape. Edit is canceled, original value remains.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/routes/WebhookDetailPage.tsx
git commit -m "feat(web): inline-edit webhook name in detail page header"
```

---

## Task 3: Wire InlineEdit for webhook description in the page header

**Files:**
- Modify: `packages/web/src/routes/WebhookDetailPage.tsx`

- [ ] **Step 1: Add a description save handler**

Inside `WebhookDetailPage`, next to `saveName`, add:

```tsx
async function saveDescription(next: string | null) {
  if (!webhook) return;
  const updated = await updateWebhook(webhook.id, { description: next });
  setWebhook(updated);
}
```

Note: `next` is `null` when the user clears the field. `UpdateWebhookArgs.description` accepts `string | null`, so the value is forwarded directly. Sending `null` (not `""`) ensures the server clears the field unambiguously.

- [ ] **Step 2: Replace the conditional description `<p>` with `<InlineEdit>`**

Replace:

```tsx
{webhook.description && <p className="text-sm text-slate-400 mt-1">{webhook.description}</p>}
```

with:

```tsx
<div className="mt-1">
  <InlineEdit
    value={webhook.description ?? ""}
    multiline
    allowEmpty
    onSave={saveDescription}
    placeholder="Add description"
    ariaLabel="webhook description"
    displayClassName="text-sm text-slate-400"
  />
</div>
```

- [ ] **Step 3: Type-check**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 4: Manual verification**

In the browser:
1. On a webhook with no description, the header shows muted "Add description". Click it, type text, press ⌘/Ctrl+Enter. New description displays.
2. Reload — persists.
3. Click description, clear it, press ⌘/Ctrl+Enter. Field returns to muted "Add description".
4. Reload — description is null on the server.
5. Click description, press Escape — original text restored.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/routes/WebhookDetailPage.tsx
git commit -m "feat(web): inline-edit webhook description in detail page header"
```

---

## Task 4: Editable secret reference in the Overview tab

**Files:**
- Modify: `packages/web/src/routes/webhooks/WebhookOverviewTab.tsx`

The webhook auth config (`WebhookAuthConfig`) holds a secret reference under one of three keys depending on mode: `valueRef` (header-equals), `secretRef` (hmac), `signingKeyRef` (jwt). Modes other than `none` always need exactly one of these. Auth mode itself stays locked (per spec).

- [ ] **Step 1: Add imports and the auth-mode scope check**

Replace the top of the file:

```tsx
import { useState } from "react";
import type { Webhook } from "@journeyman/core";
import { rotateWebhook } from "../../api/webhooks.ts";
```

with:

```tsx
import { useMemo, useState } from "react";
import type { Webhook, WebhookAuthConfig } from "@journeyman/core";
import { rotateWebhook, updateWebhook } from "../../api/webhooks.ts";
import { SecretPicker } from "./SecretPicker.tsx";
import { useAuth } from "../../auth/useAuth.ts";
```

If the auth hook path differs, use whichever hook is already used elsewhere in the app to expose `orgId` and `isAdmin` (search the codebase for `isAdmin` usage in similar routes — e.g. `CreateWebhookPage` — and mirror it).

- [ ] **Step 2: Add helpers at the bottom of the file**

Append above the existing `Field` helper:

```tsx
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

(These are intentionally copied from `WebhookConfigForm.tsx` rather than shared, to keep the file self-contained. If both files survive a refactor pass later, extract then — not now.)

- [ ] **Step 3: Add secret-edit state and save handler in the component**

Inside `WebhookOverviewTab` (just after the existing `busy` state), add:

```tsx
const auth = useAuth();
const orgId = auth.activeOrgId; // adapt to whatever the hook exposes
const isAdmin = auth.isAdmin;   // adapt to whatever the hook exposes

const presetIdForPicker = webhook.preset;
const needsSecret = webhook.auth.mode !== "none";
const currentRef = useMemo(() => refOf(webhook.auth), [webhook.auth]);

const [editingSecret, setEditingSecret] = useState(false);
const [secretDraft, setSecretDraft] = useState(currentRef);
const [secretBusy, setSecretBusy] = useState(false);
const [secretError, setSecretError] = useState<string | null>(null);

function startEditSecret() {
  setSecretDraft(currentRef);
  setSecretError(null);
  setEditingSecret(true);
}

function cancelEditSecret() {
  setSecretDraft(currentRef);
  setSecretError(null);
  setEditingSecret(false);
}

async function saveSecret() {
  if (!secretDraft.trim()) {
    setSecretError("Secret reference is required for this auth mode");
    return;
  }
  if (secretDraft === currentRef) {
    setEditingSecret(false);
    return;
  }
  setSecretBusy(true);
  setSecretError(null);
  try {
    const updated = await updateWebhook(webhook.id, { auth: withRef(webhook.auth, secretDraft) });
    onChange(updated);
    setEditingSecret(false);
  } catch (e) {
    setSecretError(e instanceof Error ? e.message : String(e));
  } finally {
    setSecretBusy(false);
  }
}
```

Verify the actual auth hook shape before pasting `auth.activeOrgId` / `auth.isAdmin`. Search the codebase for an existing route that uses these (`grep -rn "isAdmin" packages/web/src/routes`) and copy that pattern.

- [ ] **Step 4: Replace the read-only `Auth mode` field with an editable Secret row**

Find this block in `WebhookOverviewTab`:

```tsx
<Field label="Auth mode"><code className="text-xs text-slate-300">{webhook.auth.mode}</code></Field>
```

and replace it with:

```tsx
<Field label="Auth mode"><code className="text-xs text-slate-300">{webhook.auth.mode}</code></Field>
{needsSecret && (
  <Field label="Secret reference">
    {editingSecret ? (
      <div className="space-y-2">
        {orgId ? (
          <SecretPicker
            authMode={webhook.auth.mode}
            presetId={presetIdForPicker}
            scope={"orgId" in webhook.scope ? "org" : "user"}
            orgId={orgId}
            isAdmin={isAdmin}
            value={secretDraft}
            onChange={setSecretDraft}
          />
        ) : (
          <p className="text-xs text-red-400">No active org context.</p>
        )}
        {secretError && <p className="text-xs text-red-400">{secretError}</p>}
        <div className="flex gap-2">
          <button
            onClick={() => void saveSecret()}
            disabled={secretBusy}
            className="text-xs px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
          >
            {secretBusy ? "Saving…" : "Save"}
          </button>
          <button
            onClick={cancelEditSecret}
            disabled={secretBusy}
            className="text-xs px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    ) : (
      <div className="flex items-center gap-2">
        <code className="text-xs text-slate-300">{currentRef || "(unset)"}</code>
        <button
          onClick={startEditSecret}
          className="text-xs px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-100"
        >
          Edit
        </button>
      </div>
    )}
  </Field>
)}
```

- [ ] **Step 5: Type-check**

Run: `npm run typecheck`
Expected: passes. If `SecretPicker`'s prop shape differs from this code (it lives at [packages/web/src/routes/webhooks/SecretPicker.tsx](../../../packages/web/src/routes/webhooks/SecretPicker.tsx)), adapt the props to match — the source of truth is `SecretPicker`'s `Props`. Do not change `SecretPicker`.

- [ ] **Step 6: Manual verification**

In the browser:
1. Open a webhook whose auth mode is `hmac`, `header-equals`, or `jwt`.
2. The Overview tab shows a new "Secret reference" row with the current ref name and an Edit button.
3. Click Edit. SecretPicker appears with the current value selected.
4. Pick a different secret. Click Save. Row collapses; new ref name displayed.
5. Reload the page. New ref name persists.
6. Click Edit, then Cancel. No API call (verify via network panel), display unchanged.
7. Open a webhook with auth mode `none`. The "Secret reference" row does NOT appear.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/routes/webhooks/WebhookOverviewTab.tsx
git commit -m "feat(web): editable secret reference in webhook overview tab"
```

---

## Task 5: Final check — type + boundary

- [ ] **Step 1: Run the project checks**

Run from repo root:

```bash
npm run check
```

Expected: typecheck and import-boundary checks both pass.

- [ ] **Step 2: End-to-end manual sanity pass**

With `npm run dev:web` running and signed in as a user with at least one webhook:
1. Edit name (Task 2 verification).
2. Edit description, including clearing it (Task 3 verification).
3. Edit secret ref on a non-`none` webhook (Task 4 verification).
4. Reload between each — all values persist.
5. Confirm the existing Rotate URL token button (`WebhookOverviewTab`) still works (regression check).

- [ ] **Step 3: No additional commit needed** — all changes were committed in earlier tasks.

---

## Self-Review Notes

- **Spec coverage:** Header name edit (Part A) → Task 2. Header description edit (Part A) → Task 3. Editable auth (Part B) → Task 4. Spec explicitly locks auth mode and preset; this plan honors both. Spec mentions editing `eventTypePath`, `deliveryIdHeader`, `correlationSuggestions` — in practice these are preset-driven and not exposed at create time either, so the plan does not add UI for them. If they need to be editable later, that's a separate plan.
- **Placeholder scan:** No TBDs. Two flagged spots require local verification before pasting (auth hook shape in Task 4 Step 3; `SecretPicker` prop shape in Task 4 Step 5) — both reference exact file paths and tell the engineer what to check.
- **Type consistency:** `saveName`/`saveDescription`/`saveSecret` all call `updateWebhook(id, patch)` returning `Webhook`, used to call `setWebhook` (Tasks 2-3) or `onChange` (Task 4) consistently with the existing component contracts.
