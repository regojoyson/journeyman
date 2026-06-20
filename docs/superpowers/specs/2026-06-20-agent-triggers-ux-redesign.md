# Agent Triggers UX Redesign

**Date:** 2026-06-20  
**Status:** Approved — ready for implementation

## Overview

Replaces the raw cron/text inputs in the agent `TriggersSection` with a polished, user-friendly UI for all three trigger types: Schedule, API, and Webhook. The backend data model (`AgentTrigger` type, `jm_agent_schedule_state`, token tables) is unchanged except for one new column on `jm_agent_api_tokens`.

---

## Interaction Model

All three triggers follow the same pattern:

- **Toggle off (default):** The trigger row is collapsed, sub-label reads "Off"
- **Toggle on:** The row expands inline below the header, sub-label updates to a human-readable summary
- **Toggle off again:** The body collapses; the trigger is removed from `agent.triggers`

This keeps the section clean when only one trigger is active.

---

## 1. Schedule Trigger

### Goal
Users never type a cron expression. They pick a frequency and the UI writes the cron internally.

### UI

**Frequency pills** (mutually exclusive): Hourly · Daily · Weekly · Monthly

**Contextual fields** based on frequency:

| Frequency | Fields shown |
|-----------|-------------|
| Hourly | Zone only |
| Daily | At (time picker) · Zone |
| Weekly | At · On (day-of-week circles: Mo Tu We Th Fr Sa Su) · Zone |
| Monthly | At · On the (day-of-month dropdown: 1st–28th, Last day) · Zone |

**Timezone:** Searchable `<select>` of IANA zones. Defaults to the browser's detected timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`).

**Live preview:** A sentence below the fields, e.g. `Every weekday at 9:00 AM · America/New_York`. Updates on every field change.

**Escape hatch:** "Advanced: edit cron expression…" link reveals a raw `<input>` for power users. Parses back to the friendly UI where possible; otherwise stays in advanced mode.

**Collapsed summary** (when enabled): The trigger row sub-label shows the preview sentence, e.g. `Every day at 9:00 AM · New_York`.

### Cron conversion

| Frequency | Example output |
|-----------|---------------|
| Hourly | `0 * * * *` |
| Daily at 09:00 | `0 9 * * *` |
| Weekly Mon–Fri at 09:00 | `0 9 * * 1,2,3,4,5` |
| Monthly 15th at 09:00 | `0 9 15 * *` |
| Monthly last day at 09:00 | `0 9 28 * *` (28 used as safe "last day" — avoids `L` flag which not all cron parsers support) |

**`fromCron` parser** (for editing saved agents): Reverse-maps an existing cron string back to the friendly UI state. Falls through to Advanced mode for expressions that don't match a known pattern.

### Backend notes

- Stored as `{ type: "schedule", cron: string, timezone: string }` — unchanged
- `syncScheduleState` is called on `POST /enable` — no change needed
- **Important UX note for the UI:** The schedule panel should include a note: _"Runs when the agent is enabled."_ so users understand the enable step activates it

---

## 2. API Trigger

### Goal
Multiple tokens per agent, with per-token enable/disable (not just permanent revoke). Clear copy-once UX for token reveal.

### UI

**Endpoint row:** `POST /api/agents/{id}/fire` with a ⎘ copy button.

**Token list:** Each token shows:
- Name (e.g. "CI pipeline")
- Masked value: `jm_agt_X9kL••••••••••••`
- Created date · Last used date (or "Never")
- Status badge: Active / Disabled / Revoked
- Actions: **Disable** (or **Enable**) · **Revoke** (two-step confirm)

**Revoke is permanent.** Revoked tokens stay visible in the list (greyed, no actions) for audit trail.

**Issue new token:** A dashed "＋ Issue new token" button at the bottom. On click, issues the token server-side and shows a **one-time reveal banner**:

```
✓ Token issued — copy it now, it won't be shown again
[jm_agt_X9kLmQpRt7wYvN…]  [⎘ Copy]
                            [I've saved it, dismiss]
```

The banner must be explicitly dismissed — it does not auto-close.

**Usage example (collapsed by default):** A "📋 Usage example · curl" collapsible row. Expanding it shows a syntax-highlighted curl snippet with the agent's actual input fields as the JSON body, and a ⎘ Copy button.

```bash
curl -X POST "https://your-host/api/agents/{id}/fire" \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "repo":    "org/my-repo",
    "branch":  "main",
    "message": "Fix login bug"
  }'
```

The body is generated from `agent.inputs` — each input gets a type-appropriate placeholder value.

### Backend changes required

**New migration:** Add `disabled_at TIMESTAMPTZ` to `jm_agent_api_tokens`.

**New route:** `PATCH /api/workspaces/:wsId/agents/:id/triggers/api-token/:tokenId`  
Body: `{ disabled: boolean }` → sets or clears `disabled_at`.

**Update `/fire` route:** Add check `AND disabled_at IS NULL` to the token lookup query. Also check that the API trigger is present in `agent.triggers` (toggle off = no `{ type: "api" }` entry = 403).

**New `listApiTokens` response:** Include `disabled_at` so the frontend can show the Disabled badge and Enable button.

---

## 3. Webhook Trigger

### Goal
Pick a registered webhook, filter to specific event types, map payload fields to agent inputs, and optionally add payload conditions — using the same components already in the workflow editor.

### UI

**Webhook picker:** A `<select>` populated from `GET /api/workspaces/:wsId/webhooks`. Each option shows the webhook's name and preset icon. If no webhooks exist yet, shows an empty state with a "Create a webhook →" link pointing to the Webhooks page. After picking, shows the selected webhook's name, preset icon, and inbound URL with a "Change ›" link to switch.

**Inbound URL row:** `https://your-host/webhooks/in/{tenantToken}` with ⎘ copy button. This is the URL to paste into GitHub/Jira/etc.

---

#### Fire on event (ListensForPicker)

Reuses `ListensForPicker` from `packages/flow-editor/src/properties-panel/ListensForPicker.tsx` directly.

- Chip-based display — each selected event type is a removable blue chip
- Dropdown to add more from `webhook.knownEventTypes` (sourced from the preset)
- "✏ Custom…" option for event types not in the preset list
- **Empty = fire on every event** (shown as italic placeholder text)

---

#### Map inputs from payload

One row per agent input. Each row:

```
[input name]  ←  [$.path.to.value  ▾ suggestions]
```

**Path suggestions:** Powered by `pathsFromSchema(webhook.payloadSchema)` — the same function used in the workflow editor trigger panel. Walks the webhook's JSON Schema (max depth 4) and produces `$.field.subfield` paths as a `<datalist>`.

- **Preset webhooks** (GitHub, Jira, Linear, Monday): Rich suggestions — full schema predefined, 20–50+ paths with sample values shown
- **Custom webhooks with no schema:** No suggestions — user types paths manually. Graceful degradation, no errors

Suggestions appear as the user types `$.` into the field.

---

#### Only fire if (AcceptIfBuilder)

Reuses `AcceptIfBuilder` from `packages/flow-editor/src/properties-panel/AcceptIfBuilder.tsx` directly.

**Visual mode (default):**
- AND / ANY combinator toggle
- Rule rows: `[$.field.path]  [operator ▾]  [value]  [×]`
- Operators: `==`, `!=`, `contains`, `is one of`, `is not one of`, `is empty`, `is not empty`
- Field input has `<datalist>` autocomplete from the same `knownPaths` list
- "＋ Add condition" button
- Empty = always fire (no filtering)

**JSON mode:** Raw JSONLogic textarea for complex expressions. "Visual / JSON" mode tabs. Switching from JSON back to Visual parses the expression; shows an error if too complex for the visual builder.

---

#### Status banner

At the bottom of the expanded webhook body, a green summary sentence:

> _Listening on **pull_request.opened**, **pull_request.reopened** · Fires when **$.action == opened** and **$.pull_request.draft == false**_

Updates live as the user changes event types and conditions.

---

### Enable/disable

Toggle off → removes the `{ type: "webhook", ... }` entry from `agent.triggers`. The backend `fireAgentForWebhook` already checks `agent.triggers.find(t => t.type === "webhook" && t.webhookId === ...)` — if the entry is absent, the webhook is silently skipped. No new backend logic needed.

### Backend notes

No new backend routes needed. The webhook trigger is stored as:
```ts
{ type: "webhook", webhookId: string, inputsMapping: Record<string, string>, filters?: unknown }
```

`listensFor` (event filter) needs to be added to the `AgentTrigger` webhook variant:
```ts
{ type: "webhook"; webhookId: string; listensFor?: string[]; filters?: unknown; inputsMapping: Record<string, string> }
```

The `fireAgentForWebhook` service already checks `agent.enabled`. The `listensFor` array needs to be evaluated there — if populated, the inbound event's type must be in the list, otherwise skip. This matches the flow trigger behaviour in `webhook-ingest.ts`.

---

## Component Reuse

| Component | Source | Used for |
|-----------|--------|----------|
| `ListensForPicker` | `packages/flow-editor/src/properties-panel/ListensForPicker.tsx` | Event type filter |
| `AcceptIfBuilder` | `packages/flow-editor/src/properties-panel/AcceptIfBuilder.tsx` | Condition filter |
| `pathsFromSchema` | `packages/flow-editor/src/properties-panel/useWebhooksForPicker.ts` | Path autocomplete |
| `AcceptIfBuilder.logic.ts` | same package | JSONLogic conversion |

These are imported directly into `packages/web/src/components/agents/sections/TriggersSection.tsx`. If the imports cause cross-package boundary issues, the three utility files are small enough to copy into `packages/web/src/lib/`.

---

## Files Changed

### Frontend
- `packages/web/src/components/agents/sections/TriggersSection.tsx` — full rewrite (schedule picker, API token list, webhook mapping)
- `packages/web/src/lib/cron-builder.ts` — new: `toCron(freq, time, days, dom)` and `fromCron(cron)` helpers
- `packages/web/src/api/agents.ts` — add `disableApiToken` / `enableApiToken` calls

### Backend
- `packages/migrations/src/sql/059_agent_token_disabled_at.sql` — new migration
- `packages/api-server/src/routes/agent-triggers.ts` — add PATCH route, update `/fire` check
- `packages/core/src/types/agent.types.ts` — add `listensFor?: string[]` to webhook trigger type
- `packages/api-server/src/services/agent-webhook-fire.ts` — check `listensFor` before firing

### No changes needed
- `packages/api-server/src/services/agent-scheduler.ts`
- `packages/core/src/types/agent.types.ts` (schedule + api trigger shapes)
- All orchestrator / worker code
