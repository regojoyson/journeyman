# Design: Webhook Tracking UI + Improved New Run Dialog

**Date:** 2026-05-02  
**Status:** Approved  
**Depends on:** `2026-05-02-webhook-event-tracking-design.md` (jm_webhook_events table + Run.webhookEventId)

## Problem

Two UI gaps exist after the webhook tracking backend is in place:

1. **No visibility of what triggered a run** — the runs list shows status but not provider, issueRef, or whether a webhook was ignored.
2. **New run dialog uses a plain text `ticketId` field** — users must know to type `jira:PROJ-123`; there is no guidance on format and no provider selection.

## Decisions

1. Extend the runs list with a `Triggered by` column (provider badge + issueRef), inline ignored-webhook expansion, and new provider/issueRef filters.
2. Replace the `ticketId` text input in `NewRunDialog` with a provider selector + raw ID field that builds `issueRef` automatically.
3. Add a `Trigger` section to the run detail page showing full webhook context.

---

## Section 1: Improved `NewRunDialog`

### Layout

```
┌─────────────────────────────────────────┐
│ New Run                                  │
│                                          │
│ Workflow *                               │
│ [— select a workflow —           ▾]      │
│                                          │
│ Issue Ref                                │
│ [Jira ▾] [ PROJ-123            ]         │
│           → jira:PROJ-123                │
│                                          │
│ (dynamic flow inputs appear here)        │
│                                          │
│                    [Cancel] [Run →]      │
└─────────────────────────────────────────┘
```

### Behaviour

- **Provider dropdown** — options: `Jira`, `GitHub`, `Monday`, `Linear`. Defaults to `Jira`.
- **Raw ID text field** — user types the raw identifier: `PROJ-123`, `owner/repo#42`, `12345678`, etc.
- **Preview line** — rendered beneath the inputs as `→ jira:PROJ-123`. Updates live as the user types. Hidden when raw ID is empty.
- **Both fields optional** — some flows do not need a ticket. If raw ID is empty, no `issueRef` is sent.
- **On submit** — calls `buildIssueRef(provider, rawId)` from `@journeyman/core` and passes result as `issueRef` in run inputs. Replaces the old `ticketId` input entirely.

### Changed file

`packages/web/src/routes/RunsListPage.tsx`

- Replace `ticketId` state + plain text input with `provider` state (default `"jira"`) + `rawId` state.
- Render provider `<select>` and raw ID `<input>` side by side.
- Render preview `→ {issueRef}` line beneath when `rawId` is non-empty.
- On submit: `if (rawId.trim()) inputs.issueRef = buildIssueRef(provider, rawId.trim())`.

---

## Section 2: Runs List — `Triggered by` Column + Filters

### `Triggered by` column

Added between `Workflow` and `Started` columns in `RunsList`.

| Run ID | Workflow | Triggered by | Started | Status |
|---|---|---|---|---|
| abc-123 | Dev Flow | `[jira]` PROJ-123 | 2 min ago | running |
| def-456 | Dev Flow | `[github]` repo#42 | 10 min ago | done |
| ghi-789 | Review | `[manual]` | 1 hr ago | failed |
| jkl-012 | Dev Flow | `[jira]` PROJ-124 | 2 hr ago | ignored |

- Provider shown as a small coloured badge via `ProviderBadge` component.
- Badge colours: `jira` = blue, `github` = slate, `monday` = green, `linear` = violet, `manual` = muted grey, `api` = amber.
- `issueRef` displayed as the raw portion after the colon (e.g. `PROJ-123`, `repo#42`) — the provider prefix is shown by the badge.
- **`ignored` rows** — de-emphasised (reduced opacity). Clicking expands an inline panel:
  ```
  ⚠ Webhook ignored — no matching flow found for product "acme" and event "status-change"
  Delivery: abc-delivery-id-123  |  Received: 2026-05-02 14:32:01 UTC
  ```

### New filters

Added to `RunFilters`:

- **Provider** — dropdown: `All | Jira | GitHub | Monday | Linear | Manual | API`
- **Issue Ref** — text input: exact match or prefix (e.g. `jira:PROJ-123`). Replaces the old `ticketId` filter.

### New component

`packages/runs-list/src/ProviderBadge.tsx`

```tsx
type Props = { provider: string };
// Renders a small pill with provider name and colour.
// Unknown providers render a neutral grey pill.
```

### Changed files

| File | Change |
|---|---|
| `packages/runs-list/src/RunsList.tsx` | Add `Triggered by` column; render `ProviderBadge` + raw issueRef portion; de-emphasise ignored rows; inline expansion on click |
| `packages/runs-list/src/RunFilters.tsx` | Add `provider` dropdown + `issueRef` text input; remove old `ticketId` filter |
| `packages/runs-list/src/types.ts` | Add `provider?: string` and `issueRef?: string` to `RunFilter`; remove `ticketId` |
| `packages/runs-list/src/index.ts` | Export `ProviderBadge` |

---

## Section 3: Run Detail — `Trigger` Section

Added at the top of `RunDetailPage`, above the flow graph, when `run.webhookEventId` is non-null.

```
┌─ Trigger ────────────────────────────────────────────┐
│ Provider    jira                                      │
│ Event       new-ticket                               │
│ Issue ref   jira:PROJ-123                            │
│ Delivery    abc-delivery-id-123                      │
│ Received    2026-05-02 14:32:01 UTC                  │
│                                                       │
│ ▶ Raw payload                                         │
│   { "issue": { "key": "PROJ-123", ... } }            │
└──────────────────────────────────────────────────────┘
```

- `Raw payload` is a collapsible `<details>` block rendering pretty-printed JSON.
- Section is absent entirely for manual and API-triggered runs (`webhookEventId` is null).

### Changed files

| File | Change |
|---|---|
| `packages/web/src/routes/RunDetailPage.tsx` | Render `Trigger` section when `webhookEvent` present in response |
| `packages/web/src/api/runs.ts` | Include `webhookEvent` object in `getRun` response type |

---

## API Changes Required

### `GET /runs` (list)

Add query params:
- `provider` — filter by `jm_webhook_events.provider` (join required)
- `issueRef` — filter by `jm_webhook_events.issue_ref` (join required)
- Remove old `ticketId` param

Include `ignored` webhook events as synthetic rows in the response — objects with `status = "ignored"` and webhook metadata fields populated but no run `id`. The `PostgresRunStore.list` query must LEFT JOIN `jm_webhook_events` and UNION in ignored events when no `provider`/`issueRef` filter excludes them. This extends the backend spec (`2026-05-02-webhook-event-tracking-design.md`).

### `GET /runs/:id` (detail)

Add `webhookEvent` to response:

```typescript
webhookEvent: {
  id: string;
  provider: string;
  eventType: string | null;
  issueRef: string | null;
  deliveryId: string | null;
  receivedAt: string;          // ISO string
  rawPayload: unknown;
} | null;
```

---

## Implementation Scope Summary

### New files

| File | Purpose |
|---|---|
| `packages/runs-list/src/ProviderBadge.tsx` | Coloured provider pill component |

### Changed files

| File | Change |
|---|---|
| `packages/web/src/routes/RunsListPage.tsx` | Provider selector + raw ID field in `NewRunDialog`; import `buildIssueRef` |
| `packages/web/src/routes/RunDetailPage.tsx` | `Trigger` section with collapsible raw payload |
| `packages/web/src/api/runs.ts` | Add `provider` + `issueRef` filter params; add `webhookEvent` to detail response type |
| `packages/runs-list/src/RunsList.tsx` | `Triggered by` column; ignored row expansion |
| `packages/runs-list/src/RunFilters.tsx` | `provider` dropdown + `issueRef` filter; remove `ticketId` filter |
| `packages/runs-list/src/types.ts` | `RunFilter` — add `provider`, `issueRef`; remove `ticketId` |
| `packages/runs-list/src/index.ts` | Export `ProviderBadge` |
| `packages/api-server/src/routes/runs.ts` | Accept `provider` + `issueRef` params; join `jm_webhook_events`; include `webhookEvent` in detail response |

---

## Acceptance Criteria

1. `NewRunDialog` provider selector + raw ID field builds correct `issueRef` (e.g. selecting `GitHub` and typing `owner/repo#42` sends `"github:owner/repo#42"`).
2. Preview line `→ provider:rawId` updates live and is hidden when raw ID is empty.
3. Runs list shows `Triggered by` column with correct provider badge and raw ID portion.
4. Ignored webhook events appear de-emphasised in the runs list; clicking expands the reason inline.
5. Provider and issueRef filters narrow the runs list correctly.
6. Run detail page shows `Trigger` section for webhook-triggered runs; section is absent for manual/API runs.
7. Raw payload collapsible renders valid pretty-printed JSON.
8. `npm run typecheck` passes with zero errors.
