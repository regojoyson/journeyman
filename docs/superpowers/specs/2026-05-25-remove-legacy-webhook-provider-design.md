# Remove Legacy Webhook Provider — Design

**Date:** 2026-05-25
**Status:** Draft (approved direction; ready for implementation plan)
**Related:** [2026-05-25 Webhook Management](2026-05-25-webhook-management-design.md), [2026-05-24 Human-Task & Webhook-Wait Split](2026-05-24-human-task-and-webhook-split-design.md)

## Problem

The webhook-management work shipped in three plans intentionally preserved a
legacy code path for backward compatibility:

- A `POST /webhooks/:provider` ingest route that hardcodes `jira` / `github` /
  `monday` / `linear` and uses pre-registry parsing.
- A required `provider: WebhookProvider` field on `WebhookWaitConfig`.
- A "Legacy provider (un-migrated)" `<select>` in `WebhookWaitConfigEditor`
  that authors see whenever `webhookId` isn't set.
- A publish-time validator in `conductor-converter.ts` that rejects
  webhook-wait nodes without `provider`.

Journeyman is pre-production; no real producers point at the legacy URLs and
no real flows persist legacy webhook-wait configs. Keeping the parallel path
just leaks complexity into every layer (types, route, validator, UI) and
slows future work. Time to delete it.

## Decision

Make `webhookId` the **only** way a webhook-wait node identifies its source.
Remove the legacy ingest route, the `provider` config field, the UI section,
and the publish-validator branch that referenced it. Keep `WebhookProvider`
as a metadata tag on the `WebhookEvent` row (column stays — no SQL migration
needed).

## Out of scope

- **No data migration.** Pre-production; any stale stored configs are
  acceptable casualties. Publish-validation will fail loudly on them and the
  author re-picks a webhook from the dropdown.
- **No SQL migration.** `jm_webhook_events.provider` column stays. The
  `WebhookProvider` union type in `@journeyman/core` stays.
- **No deprecation period for `POST /webhooks/:provider`.** Hard 404 from
  this change forward.

## What gets removed

### Types — `@journeyman/core/src/types/webhook-wait.types.ts`

- Drop `provider: WebhookProvider` (currently required).
- Add `webhookId: string` (required).
- Drop the `import type { WebhookProvider }` line.

### Conductor converter — `@journeyman/orchestrator/src/flow-json/conductor-converter.ts`

- Line ~229: `kindProviders[kind] = cfg.provider` — delete this branch. The
  `kindProviders` map is built from regular node configs; webhook-wait no
  longer contributes a provider.
- Line ~366: `if (!cfg.provider) throw …` — replace with
  `if (!cfg.webhookId) throw new WorkflowValidationError(…)` (message:
  `"webhook-wait node ${node.id} requires webhookId"`).
- Line ~379: stop emitting `provider: cfg.provider` in the conductor task
  config. Emit `webhookId: cfg.webhookId` instead. Adjust the matching
  type in `conductor-types.ts` if it carries a typed `provider` field.

### Read-time migrator — `@journeyman/orchestrator/src/flow-json/migrate-human-task-to-webhook-wait.ts`

The current migrator copies a `human-task`'s `provider` field across when
converting to `webhook-wait`. Drop that — the migrated node will be marked
as needing a `webhookId` and fail publish-validation, which is the desired
behavior (forces the author to pick a registered webhook).

### Backend route — `packages/api-server/src/routes/webhooks.ts`

The legacy handler block goes entirely:

- Delete `app.post("/webhooks/:provider", …)` and its full body.
- Delete `DELIVERY_HEADERS`, `VALID_PROVIDERS`, `BLOCKED_HEADERS`,
  `sanitiseHeaders` — used only by the legacy handler. The new ingest
  has its own copies in `webhook-ingest.ts`.
- Drop the `matchAndResolveWebhookWaits` import (unused after this).
- Drop the `WebhookProvider` type import.

The file shrinks to: imports + `rawBodyOf` + the
`app.post("/webhooks/in/:tenantToken", …)` handler. About 60 lines.

### Frontend — `packages/flow-editor/src/properties-panel/WebhookWaitConfigEditor.tsx`

- Delete the `PROVIDERS` constant.
- Delete the entire `{!cfg.webhookId && ( <div>Legacy provider…</div> )}`
  block.
- Drop `provider?: string` from the `cfg` type cast.
- Adjust the hint text on the webhook picker — no more "or pick a legacy
  provider below" implication.

### Publish validation

The webhook-wait check now fails when `cfg.webhookId` is missing, with
message `"webhook-wait node requires webhookId"`. The existing pattern
for `human-task` validation in `validate-for-publish.ts` can be mirrored
if a separate check is needed; otherwise the converter throw at publish
time is sufficient.

## What stays (intentionally)

| Item | Why |
|---|---|
| `WebhookProvider` union in `@journeyman/core` | Still tags `WebhookEvent.provider`; removing means a SQL migration + WebhookEvent type churn. Not worth it. |
| `jm_webhook_events.provider` column | Useful column for the future events-listing UI. No producer impact. |
| `providerForLegacy()` in `webhook-ingest.ts` | Tiny preset → provider mapping so new events get a sensible `provider` tag. Local helper. |
| New `/webhooks/in/:tenantToken` route | The only ingest path now. |
| `WebhookEvent.webhookId` field | Already in place from plan 2; unaffected. |

## User-visible behavior

| Scenario | Before | After |
|---|---|---|
| Author drops a `webhook-wait` node | Sees webhook picker + legacy provider dropdown | Sees webhook picker only |
| Author tries to publish without picking a webhook | Falls back to legacy provider validation, may publish | Hard publish error: "webhook-wait requires webhookId" |
| External system POSTs to `/webhooks/github` | Hits legacy handler, stores event | `404 unknown_provider` (route removed) |
| External system POSTs to `/webhooks/in/<token>` | Works | Works (unchanged) |
| Existing run with a paused legacy webhook-wait | Resolves on next matching legacy event | Stays paused forever (acceptable — pre-production) |

## Verification

Per the standing project constraint: `npm run check` (typecheck + import
boundaries) is the gate. No unit tests are added or removed. Manual smoke:

1. Open a webhook-wait node in the flow editor → only the webhook dropdown
   shows; no legacy provider field.
2. Try to publish a flow with a webhook-wait that has no webhook picked →
   publish fails with a clear error.
3. `curl -X POST http://localhost:3000/webhooks/github` → 404.
4. `curl -X POST http://localhost:3000/webhooks/in/<token>` with a valid
   signed payload → 200 ignored/resolved as before.
5. `npm run check` passes cleanly.

## Acceptance criteria

- No file in the repo references `WebhookWaitConfig.provider` after this
  change. (`grep -r "cfg\.provider" packages/flow-editor packages/orchestrator/src/flow-json` returns empty for webhook-wait code paths.)
- The legacy `/webhooks/:provider` route is gone.
- The "Legacy provider (un-migrated)" UI block is gone.
- A webhook-wait node without `webhookId` cannot be published.
- `WebhookProvider` type still exists (tagged by `WebhookEvent`).
- `npm run check` passes.
