# Promote Webhook User → Org — Design

**Date:** 2026-05-25
**Status:** Draft (approved direction; ready for implementation plan)
**Related:** [Webhook Management](2026-05-25-webhook-management-design.md), [Secret Picker + Promote](2026-05-25-webhook-secret-picker-design.md)

## Problem

Users can create webhooks in their personal scope (`/me/webhooks`), but moving one to org-shared scope today means deleting it and re-creating from scratch in `/admin/webhooks` — including re-pasting the new URL into the provider and re-creating any referenced secret in org scope. Mirroring the existing `Promote to org` affordance shipped for MCPs, skills, custom-steps, and (recently) secrets, webhooks should have one too.

The wrinkle: a webhook references a secret by name (`auth.secretRef` / `valueRef` / `signingKeyRef`). Once the webhook is at org scope, ingest reads only org/global secrets — so promotion has to validate that the referenced secret exists at the target scope, and either guide the user to promote it first or fail with a clear error.

## Decision

Add `POST /api/orgs/:orgId/webhooks/:id/promote-from-user` (admin-gated) that clones a user-scope webhook to org-scope with a **freshly minted `tenantToken`**, after **validating** that the auth's secret reference resolves in org-or-global scope. The original user-scope webhook stays untouched. A `PromoteWebhookDialog` component on `MyWebhooksPage` walks the user through it.

Per the open question approved in brainstorming:

- **Strict mode** for missing secrets — block with "Promote secret first" button; user promotes the secret, then re-runs the webhook promote.
- **New `tenantToken`** for the org webhook — user re-pastes the URL into the provider.

## Out of scope

- **Demote (org → user)** — no use case identified; YAGNI.
- **Override name/description/auth during promote.** v1 clones verbatim except for scope + token; user can PATCH afterward.
- **Bulk promote.** One at a time.
- **Cross-org promote.** Security boundary, never.
- **Auto-rotate the underlying secret value during promote.** Promoting the secret and promoting the webhook are separate actions.
- **Re-binding to a different secret** during promote. The auth config is copied as-is — only the *scope* of the existing secret changes.

## Backend

### Endpoint

```
POST /api/orgs/:orgId/webhooks/:id/promote-from-user
```

| Property | Value |
|---|---|
| Auth | `requireAuth({ role: "admin" })` |
| Body | `{}` — no overrides |
| Action | (1) Load the user-scope source webhook; 404 if not owned by caller or not user-scope. (2) Extract the secret-ref name per `auth.mode` (none → skip validation; header-equals → `valueRef`; hmac → `secretRef`; jwt → `signingKeyRef`). (3) Check that name resolves in org-or-global scope. 400 if not. (4) Mint a new 24-byte hex `tenantToken`. (5) Insert a new org-scope webhook via the existing `IWebhookStore.create`, cloning every other field verbatim. (6) Return the new webhook. |
| Returns | The new `Webhook` (including the fresh `ingestUrl` computed at the route layer like other webhook routes). |
| 404 | No user-scope webhook with that id owned by the caller |
| 400 | `{ error, unresolved: [secretName] }` when the secret ref doesn't resolve in org/global scope |
| 409 | Org-scope webhook with the same `name` already exists |
| 403 | Caller is not org admin |

### Helpers

- A small server-side helper `secretExistsInOrgScope(pool, orgId, name)` that returns `true` if either the org has a row in `jm_secrets` with `(org_id, user_id IS NULL, name)` or the name is in `readGlobalSecrets()`. (Mirrors the check the MCP promote route already does inline.)
- A small route-layer helper that walks the auth config and returns the secret-ref name, or `null` for `none` / asymmetric-JWT.

### Permissions

Same gating as existing webhook-create routes — `requireAuth({ role: "admin" })`. Source ownership additionally enforced: only the caller's own user-scope webhooks can be promoted.

## Frontend

### `MyWebhooksPage`

Each row gets a new **"Promote to org →"** button next to "Delete". Visible only when `useAuth().role === "admin"`. Clicking opens the new `PromoteWebhookDialog`.

### `PromoteWebhookDialog` (new component)

Lives at `packages/web/src/routes/webhooks/PromoteWebhookDialog.tsx`.

Props:

```ts
interface PromoteWebhookDialogProps {
  webhook: Webhook;
  orgId: string;
  onClose: () => void;
  onPromoted: (newWebhook: Webhook) => void;
}
```

Sequence:

1. On mount: derive the `secretRefName` from `webhook.auth`. Fetch `_visible-names` for the org; check whether `secretRefName` exists in `org` or `global` scope.
2. Render the dialog with the source webhook's summary (name, preset, auth.mode, secret name).
3. **If validation passes** (or the auth needs no secret): show **"Promote webhook"** button. On click → POST → on success, show the new ingest URL with a copy button (reuses `WebhookSecretReveal`'s pattern), then call `onPromoted(newWebhook)` and `onClose()`.
4. **If validation fails** (secret missing in org scope): show a warning **"⚠ '\<SECRET_NAME>' is in your personal vault but not in org scope."** with a **"Promote secret first"** button. Click → calls `promoteSecretToOrg(orgId, secretName)`. On success, re-runs validation; the dialog state switches to the success branch. On 409 (org-scope secret with that name already exists), show that as a non-fatal info — re-run validation; should pass and proceed.

Error mapping in the dialog:

| Server response | Dialog shows |
|---|---|
| 400 with `unresolved` | "Promote the missing secret first" branch |
| 409 (name collision) | "An org webhook named X already exists. Rename the source webhook in `/me/webhooks` and retry." |
| 403 | "Org admin permission required." |
| network / 500 | Generic error with retry |

### Webhook API client

Add to `packages/web/src/api/webhooks.ts`:

```ts
export function promoteWebhookToOrg(orgId: string, webhookId: string): Promise<Webhook> {
  return api<Webhook>(
    `/api/orgs/${encodeURIComponent(orgId)}/webhooks/${encodeURIComponent(webhookId)}/promote-from-user`,
    { method: "POST", body: "{}" },
  );
}
```

## Data flow

```
[MyWebhooksPage row]
        │  click "Promote to org →"
        ▼
[PromoteWebhookDialog opens]
        │
        ├── fetch _visible-names → check secret-ref
        │
        ├── secret missing in org scope?
        │       │ yes
        │       ▼
        │   show "Promote secret first" → calls promoteSecretToOrg()
        │       │ on success, re-validate
        │       ▼
        │   secret now in org scope
        │
        ├── secret ok (or no secret needed)
        │
        ▼
[Click "Promote webhook"]
        │
        ▼
POST /api/orgs/:orgId/webhooks/:id/promote-from-user
        │
        │ backend re-validates secret-ref (defense-in-depth)
        │ inserts new org-scope webhook with new tenantToken
        │
        ▼
[Reveal new ingest URL with copy button]
        │ user copies URL
        ▼
[Dialog closes; MyWebhooksPage refreshes]
        │ original user-scope webhook still present in the list
```

## Validation philosophy

Validation runs **twice**: client-side in the dialog (for UX — show "Promote secret first" inline) and server-side in the route (for security — never trust the client). The client check is best-effort; the server's pre-insert check is the source of truth.

## Acceptance criteria

- `POST /api/orgs/:orgId/webhooks/:id/promote-from-user` clones a user-scope webhook to org-scope with a fresh `tenantToken`. Admin-only. Source row preserved.
- 400 returned with `{ unresolved: [name] }` when the source webhook's auth secret-ref doesn't exist in org/global scope.
- 409 returned when an org webhook with the same `name` already exists.
- 403 returned when the caller isn't an org admin.
- `MyWebhooksPage` shows "Promote to org →" per row, visible only to admins.
- `PromoteWebhookDialog`:
  - shows source webhook summary and secret-validation status,
  - offers inline "Promote secret first" when the secret is user-scope only,
  - reveals the new ingest URL on success,
  - clears the dialog on Close / Promoted.
- `npm run check` passes.

## Verification

`npm run check` (typecheck + import boundaries) is the standing gate. Manual smoke:

1. As admin, create a personal secret `GITHUB_WEBHOOK_SECRET`.
2. Create a personal webhook on GitHub-issues using that secret.
3. Open `/me/webhooks` → click **Promote to org →** on the row.
4. Dialog shows the warning ("not in org scope"). Click **Promote secret first** → confirmation appears.
5. Dialog re-validates → button switches to **Promote webhook**.
6. Click → success panel shows the new ingest URL. Copy it.
7. Visit `/admin/webhooks` → the new webhook appears with the new tenant token.
8. Visit `/me/webhooks` → the original user-scope webhook is still there.
