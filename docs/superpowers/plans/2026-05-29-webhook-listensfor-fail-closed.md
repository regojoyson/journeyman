# Fail-Closed `listensFor` (+ Test Panel Event Type) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a webhook trigger's `listensFor` fail-closed (empty = allow all; non-empty = only listed event types, unknown/unlisted skipped), and make the test panel carry the event type on the custom-payload path so header-based test events resolve their type.

**Architecture:** Extract the allowlist decision into a pure `eventPassesListensFor` helper (testable in isolation) and call it from the trigger-fire loop. Separately, the test panel sends the selected event type alongside a custom payload; the test route feeds `sampleEvent ?? eventType` into the existing `eventTypeHeaderForSample` helper so header-based providers get their event-type header.

**Tech Stack:** TypeScript (ESM, `.ts` import extensions), Fastify (api-server), React (web). Tests are assert-based `.test.ts` files run with `npx tsx <file>` (these packages have no test runner).

**User constraints (override skill defaults):**
- **Do NOT commit** at any point. There are no `git commit` steps in this plan.
- **Run `npm run typecheck` at the very end** (final task) as the completion gate.

**Spec:** `docs/superpowers/specs/2026-05-29-webhook-listensfor-fail-closed-design.md`

**Verified facts:**
- `webhook-trigger-fire.ts` matching is at lines 60–62; it imports only types + `readPath` + `Composition` (no DB/Fastify side effects), but the new helper goes in its own module so the unit test imports nothing heavy.
- `eventTypeHeaderForSample(eventTypePath, value)` already exists in `packages/api-server/src/services/webhook-test-delivery.ts` and returns null for body-based providers.
- The test route already reads `body` as `{ sampleEvent?, payload? }` and calls `eventTypeHeaderForSample(r.eventTypePath, body.sampleEvent)`.
- `testWebhook(id, body)` in `packages/web/src/api/webhooks.ts:85` types `body` as `{ sampleEvent?: string; payload?: unknown }`.
- `WebhookTestPanel.send()` builds `{ payload }` when the textarea is non-empty, else `{ sampleEvent: selected }`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/api-server/src/services/listens-for.ts` | Pure `eventPassesListensFor` decision | Create |
| `packages/api-server/src/services/listens-for.test.ts` | Unit test for the decision | Create |
| `packages/api-server/src/services/webhook-trigger-fire.ts` | Use the helper at the match site | Modify |
| `packages/web/src/api/webhooks.ts` | Add `eventType?` to test body type | Modify |
| `packages/web/src/routes/webhooks/WebhookTestPanel.tsx` | Send `eventType` on custom path | Modify |
| `packages/api-server/src/routes/webhooks-management.ts` | Header from `sampleEvent ?? eventType` | Modify |

---

## Task 1: Fail-closed `eventPassesListensFor` helper

**Files:**
- Create: `packages/api-server/src/services/listens-for.ts`
- Test: `packages/api-server/src/services/listens-for.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/api-server/src/services/listens-for.test.ts`:

```ts
import assert from "node:assert/strict";
import { eventPassesListensFor } from "./listens-for.ts";

// Empty / undefined allowlist → allow anything, including unknown type.
assert.equal(eventPassesListensFor(undefined, "anything"), true);
assert.equal(eventPassesListensFor([], "anything"), true);
assert.equal(eventPassesListensFor([], null), true);

// Non-empty allowlist → fire only on a known, listed type.
assert.equal(eventPassesListensFor(["issues"], "issues"), true);
assert.equal(eventPassesListensFor(["issues"], "issue_comment"), false);
assert.equal(eventPassesListensFor(["issues"], null), false);
assert.equal(eventPassesListensFor(["issues"], undefined), false);
assert.equal(eventPassesListensFor(["issues", "push"], "push"), true);

console.log("listens-for: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx packages/api-server/src/services/listens-for.test.ts`
Expected: FAIL — module / `eventPassesListensFor` not found.

- [ ] **Step 3: Create the helper**

Create `packages/api-server/src/services/listens-for.ts`:

```ts
/**
 * Fail-closed allowlist check for a webhook trigger's `listensFor`.
 * Empty/undefined `listensFor` → allow any event. A non-empty list fires ONLY
 * when the event type is known and listed; an unknown (null/undefined) or
 * unlisted type is rejected.
 */
export function eventPassesListensFor(
  listensFor: string[] | undefined,
  eventType: string | null | undefined,
): boolean {
  if (!listensFor || listensFor.length === 0) return true;
  return !!eventType && listensFor.includes(eventType);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx packages/api-server/src/services/listens-for.test.ts`
Expected: PASS — prints `listens-for: ok`.

---

## Task 2: Use the helper in the trigger-fire match site

**Files:**
- Modify: `packages/api-server/src/services/webhook-trigger-fire.ts` (imports + lines 60–62)

- [ ] **Step 1: Import the helper**

In `packages/api-server/src/services/webhook-trigger-fire.ts`, add after the existing `readPath` import line (line 1):

```ts
import { eventPassesListensFor } from "./listens-for.ts";
```

- [ ] **Step 2: Replace the fail-open check with the fail-closed helper**

Replace the existing block (lines 60–62):

```ts
    if (cfg.listensFor && cfg.listensFor.length > 0 && input.eventType) {
      if (!cfg.listensFor.includes(input.eventType)) continue;
    }
```

with:

```ts
    if (!eventPassesListensFor(cfg.listensFor, input.eventType)) continue;
```

- [ ] **Step 3: Typecheck api-server**

Run: `npm run typecheck -w @journeyman/api-server`
Expected: PASS — no type errors. (Confirms the import path and that `cfg.listensFor` / `input.eventType` match the helper signature.)

---

## Task 3: Test panel sends the event type on the custom-payload path

**Files:**
- Modify: `packages/web/src/api/webhooks.ts:85`
- Modify: `packages/web/src/routes/webhooks/WebhookTestPanel.tsx` (`send()`)

- [ ] **Step 1: Extend the `testWebhook` request body type**

In `packages/web/src/api/webhooks.ts`, change the `testWebhook` signature (line 85):

```ts
export function testWebhook(id: string, body: { sampleEvent?: string; payload?: unknown; eventType?: string }): Promise<TestDeliveryResult> {
```

(Leave the function body unchanged.)

- [ ] **Step 2: Send `eventType` on the custom-payload branch**

In `packages/web/src/routes/webhooks/WebhookTestPanel.tsx`, in `send()`, change the body construction:

```ts
      let body: { sampleEvent?: string; payload?: unknown; eventType?: string };
      if (customPayload.trim()) {
        try { body = { payload: JSON.parse(customPayload), eventType: selected || undefined }; }
        catch (e) { throw new Error(`Custom payload not JSON: ${e instanceof Error ? e.message : String(e)}`); }
      } else if (selected) {
        body = { sampleEvent: selected };
      } else {
        throw new Error("Pick a sample or paste a custom payload");
      }
```

(Only the `let body` type annotation and the `customPayload.trim()` branch change; the rest of `send()` is unchanged.)

- [ ] **Step 3: Typecheck web**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS — no type errors.

---

## Task 4: Test route derives the header from `sampleEvent ?? eventType`

**Files:**
- Modify: `packages/api-server/src/routes/webhooks-management.ts` (the `/api/webhooks/:id/test` handler)

- [ ] **Step 1: Accept `eventType` in the request body type**

In `packages/api-server/src/routes/webhooks-management.ts`, in the `POST /api/webhooks/:id/test` handler, change the body cast:

```ts
      const body = (req.body ?? {}) as { sampleEvent?: string; payload?: unknown; eventType?: string };
```

- [ ] **Step 2: Use `sampleEvent ?? eventType` for the header**

In the same handler, change the event-type header line (added previously) from:

```ts
      const evtHeader = eventTypeHeaderForSample(r.eventTypePath, body.sampleEvent);
      if (evtHeader) headers[evtHeader.name] = evtHeader.value;
```

to:

```ts
      const evtHeader = eventTypeHeaderForSample(r.eventTypePath, body.sampleEvent ?? body.eventType);
      if (evtHeader) headers[evtHeader.name] = evtHeader.value;
```

- [ ] **Step 3: Typecheck api-server**

Run: `npm run typecheck -w @journeyman/api-server`
Expected: PASS — no type errors.

---

## Task 5: Final verification gate

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck across all workspaces**

Run: `npm run typecheck`
Expected: PASS — no type errors in any workspace.

- [ ] **Step 2: Re-run the matching unit test**

Run: `npx tsx packages/api-server/src/services/listens-for.test.ts`
Expected: prints `listens-for: ok`.

- [ ] **Step 3: Import-boundary check**

Run: `npm run check:boundaries`
Expected: PASS — clean. (New file is an intra-package import; no new cross-package edges.)

> Per user constraint: do **not** commit. Stop here and report results.
>
> Manual re-test (requires a running api-server + web, restarted to pick up the changes): GitHub webhook with `listensFor: ["issues"]` → Load `issue_comment` sample → Send → **skipped**; Load `issues` sample → Send → **runs**; clear `listensFor` → any event → **runs**.

---

## Self-Review Notes

- **Spec coverage:** Part 1 fail-closed matching — helper (Task 1) + call site (Task 2); Part 2 test-panel event type — API type + panel send (Task 3) + route header derivation (Task 4); verification (Task 5). All spec sections mapped.
- **Type consistency:** `eventPassesListensFor(string[] | undefined, string | null | undefined)` defined in Task 1 and called with `cfg.listensFor` (`string[] | undefined`) and `input.eventType` (`string | null`) in Task 2 — compatible. The `{ sampleEvent?; payload?; eventType? }` body shape is identical across Task 3 (web) and Task 4 (api-server). `eventTypeHeaderForSample` is reused, not redefined.
- **Constraints honored:** no `git commit` steps; `npm run typecheck` is the final gate (Task 5).
