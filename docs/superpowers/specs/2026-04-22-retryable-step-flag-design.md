# Per-Step `retryable` Flag Design

**Date:** 2026-04-22
**Status:** Approved

## Problem

The existing `POST /api/runs/:sessionId/retry` endpoint re-runs any failed pipeline run from its first failed step. There is no mechanism to prevent retrying steps that should not be retried (e.g., side-effectful or non-idempotent steps). By default, retry should be **off** — an operator must explicitly opt a step in.

## Goal

Add a `retryable?: boolean` flag at the step level in flow YAML. When the retry API is called:

- If the failed step has `retryable: true` → retry proceeds normally.
- If the flag is absent or `false` → the API returns a 409 with a clear error message.

---

## Design

### 1. Schema — `FlowStepDefinition`

Add `retryable?: boolean` to the Zod step schema in `packages/pipeline/src/config/flow-schema.ts`:

```ts
z.object({
  id: z.string().min(1).optional(),
  phase: z.string().min(1),
  config: z.record(z.unknown()).optional(),
  retry: z.object({ ... }).optional(),
  timeoutMs: z.number().int().min(0).optional(),
  onFailure: z.enum(["fail", "skip", "retry", "block"]).optional(),
  retryable: z.boolean().optional(),   // ← new
})
```

Add the same field to the `FlowStepDefinition` TypeScript interface in `@journeyman/core`.

**Default:** `undefined` — treated as `false` (retry disabled).

---

### 2. `Pipeline.retry()` gate

In `packages/pipeline/src/pipeline.ts`, after finding `failedRec` (the first failed step record), look up the matching step in `flowSnapshot`:

```ts
const flowStep = flow.steps.find(s => s.id === failedRec.id);
if (!flowStep?.retryable) {
  throw new Error(
    `retry is disabled for step '${failedRec.id}' — set retryable: true in the flow to enable`
  );
}
```

This guard runs before any state mutation. The existing Fastify retry endpoint catches the thrown error and returns 409 — no API layer changes needed.

---

### 3. YAML flows

Update `config/flows/full-flow.yaml`. Add `retryable: true` to idempotent AI steps that are safe to re-run:

| Step id | Phase | `retryable` |
|---|---|---|
| `analyze` | `analyze` | `true` |
| `plan` | `plan` | `true` |
| `implement` | `implement` | `true` |

Steps that are side-effectful or lightweight (notifications, status updates, cleanup, PR creation) remain off.

---

### 4. Error response

When retry is blocked by the flag, the API returns:

```json
HTTP 409 Conflict
{ "error": "retry is disabled for step 'implement' — set retryable: true in the flow to enable" }
```

The UI (RunDetail Retry button) already surfaces the mutation error to the user via the existing TanStack Query error state.

---

### 5. Documentation updates

- **`docs/phases.md`** — Add a "Retryability" section explaining the flag, which built-in phases are retryable in reference flows, and the opt-in rationale.
- **`CLAUDE.md`** — Update the flow-schema description and the implementation status table.
- **`docs/superpowers/plans/2026-04-21-retry-failed-runs.md`** — Insert a new Task 0 covering schema + gate before the existing tasks.

---

## Files Changed

| Action | File | Purpose |
|---|---|---|
| Modify | `packages/pipeline/src/config/flow-schema.ts` | Add `retryable` to Zod step schema |
| Modify | `packages/core/src/types/*.ts` | Add `retryable` to `FlowStepDefinition` interface |
| Modify | `packages/pipeline/src/pipeline.ts` | Add retryability gate in `retry()` |
| Modify | `config/flows/full-flow.yaml` | Opt in `analyze`, `plan`, `implement` steps |
| Modify | `docs/phases.md` | Add Retryability section |
| Modify | `CLAUDE.md` | Update schema notes + status table |
| Modify | `docs/superpowers/plans/2026-04-21-retry-failed-runs.md` | Prepend Task 0 |

---

## Non-Goals

- No UI toggle for `retryable` — it is a deploy-time config decision in the flow YAML.
- No per-product override — the flag lives in the flow definition, which is already product-specific via the `flow` field in product config.
- No automatic retry on first failure — `step.retry.attempts` handles that separately; `retryable` only gates the manual retry API.
