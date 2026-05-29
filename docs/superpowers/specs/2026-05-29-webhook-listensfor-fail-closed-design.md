# Fail-Closed `listensFor` (+ Test Panel Event Type) — Design

**Date:** 2026-05-29

## Problem

A user set `listensFor: ["issues"]` on a GitHub webhook, fired an
`issue_comment` test event, and the trigger ran anyway.

Two layers caused this:

1. **`listensFor` is fail-open.** The matching code only applies the allowlist
   when the event type is already known
   (`webhook-trigger-fire.ts`: `if (cfg.listensFor?.length && input.eventType)`).
   If the event type resolves to null/unknown, the allowlist is skipped and the
   trigger fires.

2. **The test panel drops the event type on the custom-payload path.** In
   `WebhookTestPanel.send()`, when the textarea has content (e.g. after "Load
   sample"), it sends `{ payload }` with no event type. For header-based
   providers (GitHub/Bitbucket) that means no `X-GitHub-Event` header → null
   type.

Together: the test sent an `issue_comment` body with no resolvable type → the
fail-open rule skipped the `["issues"]` filter → it ran.

## Goal

Make `listensFor` behave as users expect:

- **empty / no `listensFor`** → allow every event (unchanged).
- **non-empty `listensFor`** → fire **only** when the event type is known **and**
  in the list; an unknown or unlisted type is skipped (**fail-closed**).

And make the test panel carry the event type on the custom-payload path, so
header-based test events resolve their type — otherwise, under fail-closed, a
header-based test sent via the custom path would always be skipped (no type),
making it impossible to test even a matching event.

## Design

### Part 1 — Fail-closed matching (behavior change)

Extract the decision into a tiny pure module so it is unit-testable without the
trigger-fire pipeline's server dependencies.

**New helper** — `packages/api-server/src/services/listens-for.ts`:

```ts
/**
 * Fail-closed allowlist check. Empty/undefined `listensFor` → allow any event.
 * A non-empty list fires ONLY when the event type is known and listed; an
 * unknown (null) or unlisted type is rejected.
 */
export function eventPassesListensFor(
  listensFor: string[] | undefined,
  eventType: string | null | undefined,
): boolean {
  if (!listensFor || listensFor.length === 0) return true;
  return !!eventType && listensFor.includes(eventType);
}
```

**Call site** — `packages/api-server/src/services/webhook-trigger-fire.ts`:

```ts
// before (fail-open)
if (cfg.listensFor && cfg.listensFor.length > 0 && input.eventType) {
  if (!cfg.listensFor.includes(input.eventType)) continue;
}

// after (fail-closed)
if (!eventPassesListensFor(cfg.listensFor, input.eventType)) continue;
```

- Empty allowlist → `eventPassesListensFor` returns true → no filtering (allow all).
- Non-empty allowlist → returns false (skip) unless the type is present and listed.

### Part 2 — Test panel carries the event type (custom-payload path)

Reuses the existing `eventTypeHeaderForSample(eventTypePath, value)` helper.

**Frontend** — `packages/web/src/routes/webhooks/WebhookTestPanel.tsx`, in
`send()`:

```ts
if (customPayload.trim()) {
  body = { payload: JSON.parse(customPayload), eventType: selected || undefined };
} else if (selected) {
  body = { sampleEvent: selected };
}
```

The dropdown `selected` already reflects the loaded sample (e.g.
`issue_comment`). For a generic webhook with no samples, `selected === ""` →
`eventType` omitted.

**API type** — `packages/web/src/api/webhooks.ts`: extend the `testWebhook`
request body type with `eventType?: string`.

**Backend** — `packages/api-server/src/routes/webhooks-management.ts`
(`POST /api/webhooks/:id/test`): accept `eventType` and derive the header from
either source:

```ts
const body = (req.body ?? {}) as { sampleEvent?: string; payload?: unknown; eventType?: string };
// ...
const evtHeader = eventTypeHeaderForSample(r.eventTypePath, body.sampleEvent ?? body.eventType);
if (evtHeader) headers[evtHeader.name] = evtHeader.value;
```

`eventTypeHeaderForSample` returns null for body-based providers
(`$.webhookEvent`, `$.object_kind`), so Jira/GitLab are unaffected — their type
stays in the payload.

## Edge Cases

- **Empty `listensFor`** — allow-all preserved; the behavior change only affects
  non-empty allowlists.
- **Body-based provider (Jira/GitLab)** — event type comes from the payload, so
  it resolves with or without the header; fail-closed matches normally.
- **Generic webhook** — no event-type field at all, so any non-empty
  `listensFor` would always skip. This is correct (you can't filter by a type
  that doesn't exist); the editor already hints `listensFor` is for providers
  with known event types. No special-casing.
- **Hand-crafted custom payload unrelated to a sample** — the event type used is
  whatever the dropdown shows (visible; user can change it).

## Testing

- **Matching unit test** — cover `eventPassesListensFor`: allowlist `["issues"]`
  with type `issues` → true; with `issue_comment` → false; with `null` → false;
  empty/undefined allowlist with any or `null` type → true.
- **Header helper** — existing `webhook-test-delivery.eventtype.test.ts` already
  covers `eventTypeHeaderForSample`.
- **Manual** — GitHub webhook with `listensFor: ["issues"]`:
  - Load `issue_comment` sample → Send → **skipped** (does not run).
  - Load `issues` sample → Send → **runs**.
  - Clear `listensFor` → any event → **runs**.

## Affected Files

| Responsibility | Path |
|---|---|
| `eventPassesListensFor` helper | `packages/api-server/src/services/listens-for.ts` |
| Use helper at call site | `packages/api-server/src/services/webhook-trigger-fire.ts` |
| Matching unit test | `packages/api-server/src/services/listens-for.test.ts` |
| Send eventType on custom path | `packages/web/src/routes/webhooks/WebhookTestPanel.tsx` |
| Request body type | `packages/web/src/api/webhooks.ts` |
| Header from `sampleEvent ?? eventType` | `packages/api-server/src/routes/webhooks-management.ts` |

## Constraints

- No commits during implementation.
- Run `npm run typecheck` as the final gate.
