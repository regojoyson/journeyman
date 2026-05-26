# Webhook Editable Details — Design

**Date:** 2026-05-26
**Scope:** UI-only change to `@journeyman/web`. No backend, API, or core type changes required.

## Problem

The webhook detail page currently exposes name, description, and auth configuration as read-only. The backend already supports patching all of these (`PATCH /api/webhooks/:id` via `UpdateWebhookArgs` in [webhook-store.interface.ts:25](../../../packages/core/src/interfaces/webhook-store.interface.ts:25)), and `updateWebhook()` exists in [webhooks.ts:56](../../../packages/web/src/api/webhooks.ts:56). Users have no way to invoke it from the UI.

## Goals

- Let users edit webhook **name** and **description** from the detail page header.
- Let users edit the webhook **auth config** (including secret reference names, header names, algorithms, encoding, etc.) and **event routing fields** (`eventTypePath`, `deliveryIdHeader`, `correlationSuggestions`) from the Overview tab.

## Non-Goals

- Editing the actual secret values stored in the secrets vault. Vault rotation belongs on the secrets management page; one secret can be shared by multiple webhooks.
- Changing the webhook **preset**. Changing preset invalidates stored schema and event routing — that is a "create a new webhook" task.
- Changing the **auth mode** (e.g. `none` → `hmac`). Auth mode is locked at create-time. Keeping it locked avoids cross-mode validation complexity. Can be revisited later.
- Backend, API client, or core type changes. All required types and endpoints exist.

## Design

### Part A — Inline name & description editing in the page header

**Location:** [WebhookDetailPage.tsx:42-52](../../../packages/web/src/routes/WebhookDetailPage.tsx:42).

**Behavior:**

- **Name** (currently rendered as `<h1>`): click to swap into a single-line `<input>`. Save on Enter or blur. Cancel on Escape. Empty name is rejected — revert to previous value and show a small inline error that clears on next edit.
- **Description** (currently rendered as `<p>`; absent when empty): click to swap into a `<textarea>`. Save on Enter or blur, cancel on Escape. Empty is allowed and sent as `null` (matches `UpdateWebhookArgs.description: string | null`). When description is currently empty, render a muted placeholder like "Add description" so the user has something to click.
- A small pencil icon next to each value indicates the field is editable (plain text isn't obviously clickable).
- On save: call `updateWebhook(id, { name })` or `updateWebhook(id, { description })`, replace local state with the response.
- Saves are non-optimistic — input remains disabled until the server responds, then commits. No spinner needed; saves are sub-second.
- On error: revert to previous value and show inline error text below the field.

**Component shape:** introduce a small local `<InlineEdit>` helper, co-located in `WebhookDetailPage.tsx` or under `webhooks/`. Props: `{ value: string; multiline?: boolean; onSave: (v: string | null) => Promise<void>; placeholder?: string; allowEmpty?: boolean }`. Two instances: one for name (`allowEmpty: false`), one for description (`allowEmpty: true`, `multiline: true`).

### Part B — Editable "Auth & routing" section in the Overview tab

**Location:** [WebhookOverviewTab.tsx:38-46](../../../packages/web/src/routes/webhooks/WebhookOverviewTab.tsx:38).

**Behavior:**

- Replace the read-only `Preset`, `Auth mode`, and `Event type path` rows with an "Auth & routing" block that:
  - In **display mode**: shows current preset (read-only), auth mode (read-only), the active secret-ref name(s), header, algorithm, encoding, `eventTypePath`, `deliveryIdHeader`, and `correlationSuggestions` as a summary; plus an **Edit** button.
  - In **edit mode**: renders the existing `WebhookConfigForm` populated with the current webhook values, plus **Save** and **Cancel** buttons.
- `WebhookConfigForm` already accepts an `initial` prop; we feed it the current webhook's auth and routing fields. The preset selector and auth-mode selector are hidden (or disabled) in edit mode — only the within-mode fields are editable.
- On Save: call
  ```ts
  updateWebhook(id, { auth, eventTypePath, deliveryIdHeader, correlationSuggestions })
  ```
  Replace local state with the response and collapse back to display mode.
- On Cancel: discard form state and collapse back to display mode.
- On validation error (e.g. empty secret ref where one is required): show inline form-level error from `WebhookConfigForm`; do not call the API.
- On API error: keep the form open with values intact and show an error banner above the Save/Cancel row.

### Component changes summary

| File | Change |
|---|---|
| `packages/web/src/routes/WebhookDetailPage.tsx` | Wire two `<InlineEdit>` instances for name and description in the header. Pass `onChange` from page state so saves update the local webhook object. |
| `packages/web/src/routes/webhooks/InlineEdit.tsx` _(new)_ | Small reusable inline-edit component (single-line and multiline). |
| `packages/web/src/routes/webhooks/WebhookOverviewTab.tsx` | Replace read-only auth/routing rows with editable "Auth & routing" section using existing `WebhookConfigForm`. |
| `packages/web/src/routes/webhooks/WebhookConfigForm.tsx` | Minor adaptation: support an `edit` mode that hides preset and auth-mode selectors and only allows editing within-mode fields. Reuse the existing `initial` prop for hydration. |

No changes to `@journeyman/core`, `@journeyman/api-server`, or any backend package.

## Data Flow

```
User clicks header name
  → InlineEdit shows input prefilled with current name
  → User edits, presses Enter
  → InlineEdit calls onSave(newName)
  → WebhookDetailPage calls updateWebhook(id, { name: newName })
  → On 2xx: setWebhook(response), input collapses to <h1>
  → On error: revert local input value, show inline error
```

```
User clicks Edit on Auth & routing
  → Section swaps to WebhookConfigForm(initial=webhook, mode="edit")
  → User edits fields, clicks Save
  → Component composes UpdateWebhookArgs from form state
  → Calls updateWebhook(id, { auth, eventTypePath, deliveryIdHeader, correlationSuggestions })
  → On 2xx: setWebhook(response), section collapses to display
  → On error: keep form open, show error banner
```

## Testing

- **Manual verification** in dev (`npm run dev:web`):
  - Edit and save webhook name — header reflects new value; reload confirms persistence.
  - Edit description from empty → text — appears in header; reload confirms.
  - Edit description from text → empty — paragraph disappears; reload confirms description is null on server.
  - Press Escape during edit — value reverts.
  - Submit empty name — rejected, error shown.
  - Edit auth fields (e.g. change `secretRef` on an HMAC webhook) — Save persists, display shows new value, reload confirms.
  - Cancel auth edit — no API call, form state discarded.

- **Type & boundary check:** `npm run check` passes.

## Risks

- `WebhookConfigForm` edit-mode adaptation could affect the create flow if not carefully gated. Mitigation: gate behaviour on a new `mode: "create" | "edit"` prop with `"create"` as the default; create-time callers don't change.
- Empty-string vs `null` semantics for description: `UpdateWebhookArgs.description` is `string | null | undefined`. Sending `null` clears; sending `undefined` (omit) leaves unchanged. The inline editor must send `null` (not `""`) when the field is cleared so persistence is unambiguous.
