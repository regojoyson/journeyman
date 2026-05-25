# Webhook Secret Picker (Pick / Generate / Type / Promote) — Design

**Date:** 2026-05-25
**Status:** Draft (approved direction; ready for implementation plan)
**Related:** [2026-05-25 Webhook Management](2026-05-25-webhook-management-design.md)

## Problem

Today the webhook-create form has one input for the secret reference: a plain text field where the user types the name of a secret that **already exists** in `jm_secrets`. Two friction points:

1. The user has to **already know** what secrets they have. There's no discovery — typos silently produce a webhook that can never verify.
2. To create a fresh secret, the user has to leave the webhook flow, go to **My Secrets** or **Org Secrets**, invent a strong random value, save it, then come back. That value also has to be pasted into the provider's webhook UI. Two screens, one value, easy to mess up.

We need one control that supports three workflows in the same place: pick an existing secret, generate a new one inline, or just type a name (for users who'll create the secret elsewhere).

## Decision

Replace the plain text input with a **secret picker** that exposes all three paths:

| Path | When | Outcome |
|---|---|---|
| **Pick existing** | The user already has a usable secret in the right scope | Webhook references that secret by name |
| **Generate new** | The user wants Journeyman to mint a random value and save it | Server creates the secret; UI reveals the plaintext **once** for copy-into-provider; webhook references it |
| **Type a name** | The user will create the secret manually elsewhere (e.g., paste a value provider gave them) | Webhook references that name; user is responsible for ensuring the secret exists before events arrive |

Generate is only available for auth modes where Journeyman is the secret chooser, not the verifier of someone else's choice.

## Out of scope

- **Rotating an existing secret's value.** That's a vault-side feature on the secrets page, not specific to webhooks.
- **Showing existing secret values in the picker.** Vault is write-only after creation — the dropdown shows names + scope tag, never values.
- **Auto-pasting into the provider** (GitHub etc.). The user still copies the generated value manually.
- **Bulk creation / templating.** One webhook at a time.

## Where Generate is available

| Auth mode | Pick existing | Generate new |
|---|---|---|
| `hmac` (GitHub, Bitbucket, Linear, generic-hmac) | ✅ | ✅ |
| `header-equals` (GitLab, Jira-bearer, generic-header) | ✅ | ✅ |
| `jwt` HS256 (Monday) | ✅ | ❌ — provider picks the key |
| `jwt` RS256 / ES256 (Jira Connect) | n/a — no secret, JWKS URL only |
| `none` (Generic default) | n/a — no secret field shown |

So 7+ of the 11 presets get the Generate button. The other paths (pick / type) are always available when a secret is needed.

## UI

The current `Secret name` text input in `WebhookConfigForm.tsx` is replaced by a `<SecretPicker>` component with three states:

**Default — collapsed picker:**

```
Secret:  [ ▼ pick a secret…                    ]   [ + Generate new ]
```

**Dropdown open:**

```
Secret:  [ ▼ pick a secret…                    ]   [ + Generate new ]
         ────────────────────────────────────────
         GITHUB_WEBHOOK_SECRET           (org)
         ACME_GH_PROD                    (org)
         MY_TEST_TOKEN                   (mine)
         ────────────────────────────────────────
         ✏  type a name…                  (custom)
```

**After "Generate new" clicked:**

```
Secret:  [ ▼ pick a secret…                    ]
         ┌─ New secret ─────────────────────────┐
         │ Name: [ GITHUB_WEBHOOK_SECRET     ]  │
         │ [ Save & generate ]      [ Cancel ]  │
         └──────────────────────────────────────┘
```

**After save succeeds — one-time reveal:**

```
Secret:  [ GITHUB_WEBHOOK_SECRET (just created)  ]
         ┌─ Generated value — copy now, won't be shown again ─┐
         │ 7d38cdd689735b008b3c702edd92eea23791c5f6...    [📋] │
         │ Saved as: GITHUB_WEBHOOK_SECRET                     │
         │ Paste this into the provider's webhook secret field.│
         └─────────────────────────────────────────────────────┘
```

**After "type a name" clicked — free-form input:**

```
Secret:  [ MY_CUSTOM_NAME                       ]  ← user types
         ⚠  Make sure a secret with this name exists in your vault
         (or use the picker above).
```

## Scope rules

The picker queries the existing endpoint:

```
GET /api/orgs/:orgId/secrets/_visible-names
```

Filtering for the dropdown:

- **Creating an org webhook** → show only secrets with `scope === "org"`. (Personal secrets aren't reachable from org-scope runs.)
- **Creating a personal webhook** → show secrets with `scope === "org"` or `scope === "user"`. (Personal runs can use both.)

`Generate new` always saves into the **same scope as the webhook being created**, using the existing secrets endpoints:

- Org webhook → `POST /api/orgs/:orgId/secrets` (the active org's `orgId`)
- Personal webhook → `POST /api/orgs/:orgId/users/me/secrets` (the active org's `orgId`, matching `MySecretsPage`'s create form)

Personal secrets in `jm_secrets` carry both `org_id` (the active org) and `user_id`. The webhook-secret-lookup helper from plan 2 queries personal secrets by `user_id` alone, so the secret is reachable regardless of which org_id was attached at creation time.

## Generation details

- **Value:** `crypto.randomBytes(32).toString("hex")` — 64 hex chars, ~256 bits of entropy. Suitable for HMAC-SHA256 and bearer tokens.
- **Name suggestion:** when the user opens the generate panel with an empty name, pre-fill with `${PRESET_ID_UPPERCASE.replace(/-/g, "_")}_WEBHOOK_SECRET` (e.g. `GITHUB_ISSUES_WEBHOOK_SECRET`). User can overwrite.
- **Name validation:** must match `^[A-Z][A-Z0-9_]*$` per existing `jm_secrets` rules. Inline error on invalid input — same UX as `MySecretsPage`'s create form.
- **Collision:** if the name already exists in the chosen scope, the secrets API returns 409. The panel shows: *"That name is already taken — pick a different one, or close this and select it from the dropdown."* No overwrite.

## One-time reveal mechanics

The generated value is shown in a panel right below the picker. Key properties:

- Plaintext is held only in component state. Closing the form / refreshing the page loses it.
- After the user clicks "Done with this value" (or starts changing other form fields after 30+ seconds — soft signal), the reveal panel auto-hides. The secret name remains in the picker.
- The reveal panel has a single Copy button. Copy is the explicit action the user came here for.
- No "show again" affordance. If the user closes without copying, they have to delete and regenerate — same posture as every other secrets vault.

## Submit behavior

When the webhook form submits, the request payload is unchanged from today — it carries only the **secret name**, never the value:

```ts
auth: { mode: "hmac", ..., secretRef: "GITHUB_WEBHOOK_SECRET" }
```

The vault row is already in place by the time submit happens (whether via Pick, Generate, or pre-existing).

## Error states

| Scenario | UX |
|---|---|
| Visible-names fetch fails | Dropdown shows "could not load secrets — pick `type a name…`" |
| Generate name invalid | Inline error under the name field — "names must be UPPER_SNAKE_CASE" |
| Generate name collides (409) | Inline error — "that name is already in use; pick another or select from dropdown" |
| Generate POST fails | Inline error with retry button; nothing saved |
| Generate POST succeeds but webhook submit fails later | Secret stays in vault — user can re-open the webhook form and pick it from the dropdown. Acceptable orphan |

## Components

```
packages/web/src/routes/webhooks/
├── SecretPicker.tsx            ← new — the three-mode control
├── GenerateSecretPanel.tsx     ← new — name input + save + reveal
└── WebhookConfigForm.tsx       ← modified — replace plain input with <SecretPicker>

packages/web/src/api/
└── secrets.ts                  ← extend — add createOrgSecret + createUserSecret helpers if missing
                                   (today only fetchVisibleSecrets is exported)
```

The new components live next to the existing webhook UI for cohesion. No backend changes — the secrets API endpoints already exist.

## Mode availability rules (component level)

`<SecretPicker>` takes a prop `mode: WebhookAuthConfig["mode"]`:

- `"none"` → component renders nothing (defensive; caller should not include it).
- `"hmac"` or `"header-equals"` → all three paths available (pick / generate / type).
- `"jwt"` → pick + type available; Generate button **hidden** with a small explainer: *"This provider chooses the key — paste the value they give you into a secret first, then pick it here."*

## Verification

Per the standing project constraint: `npm run check` (typecheck + import boundaries) is the gate. No new unit tests. Manual smoke:

1. Open the webhook create wizard, pick GitHub → secret picker shows.
2. Open dropdown → existing GitHub-related secrets appear, scope-tagged.
3. Click "Generate new" → name prefilled `GITHUB_WEBHOOK_SECRET`, click Save → reveal panel shows 64-char value. Copy works.
4. Submit webhook → it's created and references the new secret.
5. Re-open create wizard for another webhook → the just-generated secret appears in the dropdown.
6. For Monday preset → Generate button is hidden; pick + type are visible.
7. `npm run check` passes.

## Promote user-scope secret → org-scope

Today secrets have no promote affordance even though MCPs / skills / custom-steps do. Add one, mirrored on the existing `promoteToOrg` pattern (`packages/mcp/src/db.ts` + `routes/promote.ts`).

### Backend

New route in `packages/secrets/src/routes/`:

```
POST /api/orgs/:orgId/secrets/:secretName/promote-from-user
```

| Property | Value |
|---|---|
| Auth | `requireAuth({ role: "admin" })` — same gate as the existing org-secret routes |
| Inputs | `orgId` + `secretName` in the URL; body `{}` |
| Behavior | Look up the caller's user-scope row by `(user_id, name)`. Decrypt via `open()`. Insert a new org-scope row (`user_id = NULL`, `org_id = $orgId`) using existing `insertOrgSecret`. Leave the user-scope row alone. |
| Returns | `{ id, name }` of the new org-scope row |
| 404 | No user-scope secret with that name owned by the caller |
| 409 | Org-scope secret with that name already exists |
| 403 | Caller is not an org admin |

About 30 lines of new server code. No new tables. Reuses `seal`/`open` and existing db helpers.

### Frontend — two surfaces

**Surface 1: `MySecretsPage`.** Each row gets a **"Promote to org →"** button next to Delete. Visible only when `role === "admin"`. Click → confirm dialog → POST → toast on success. The user-scope row stays.

**Surface 2: `SecretPicker` for org webhooks.** When `scope === "org"` (the webhook is org-scope) and the caller is an org admin, the dropdown adds a second group beneath the existing org-secrets list:

```
ORG SECRETS
  GITHUB_WEBHOOK_SECRET      (org)
  ACME_GH_PROD                (org)
──────────────────────────────────
YOUR SECRETS — promote to use:
  MY_TEST_TOKEN               (mine) → [Promote]
──────────────────────────────────
✏ type a name…
```

Clicking **Promote** next to a user-scope entry: POST → refresh local secrets list → the entry now appears in the org section and is auto-selected.

For non-admin users or personal webhooks, this section isn't rendered (the existing dropdown filter still applies).

### Out of scope

- **Demote (org → user)** — no use case identified; YAGNI.
- **Overwriting an existing org-scope secret** — 409 only; user must rename or delete first.
- **Cross-org promotion** — security boundary, never.

## Acceptance criteria

- `<SecretPicker>` renders inside `WebhookConfigForm` whenever the preset auth has a secret.
- Dropdown shows existing secrets in the matching scope, scope-tagged.
- "Generate new" creates a secret via the existing secrets API and reveals the value once.
- Existing "type a name" workflow still works for users who pre-create secrets.
- Webhook submit payload still carries only the secret **name**, not the value.
- Monday and JWT-asymmetric presets show no Generate button.
- `POST /api/orgs/:orgId/secrets/:secretName/promote-from-user` copies a user-scope secret to org-scope, admin-only, 404/409/403 mapped correctly.
- `MySecretsPage` shows a "Promote to org" button per row when the user is an org admin.
- `SecretPicker` for org webhooks shows promotable user-scope secrets in a dedicated group for admins; promote-then-select works inline without page reload.
- `npm run check` passes.
