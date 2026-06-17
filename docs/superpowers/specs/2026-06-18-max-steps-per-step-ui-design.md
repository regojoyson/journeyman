# Max Steps — Per-Step UI Config

**Date:** 2026-06-18
**Status:** Approved (design)
**Scope:** Flow-editor properties panel only. Backend wiring already exists.

## Problem

Custom-AI steps run an agent loop with a step budget (`maxSteps` → `stopWhen` for
the aisdk provider, `maxTurns` for the Claude provider; default **80**). The
budget is configurable in the data model (`RunCustomPromptOptions.maxSteps`, read
from a node's `config.maxSteps` by the custom-AI step handler), but there is **no
UI to set it**. A small step (make a branch) and a large implementation step on a
big repo need very different budgets; today the user cannot tune it per step.

## Goal

Expose a single **"Max steps"** field per custom-AI step in the properties panel,
writing to `config.maxSteps`. No backend changes.

## Non-Goals

- No "Max steps" for `checkoutRepo` or other built-in coding steps — they use
  their own fixed limits and do not read `config.maxSteps`. Showing the field
  there would be a no-op. (Can be wired later if desired.)
- No grouped "Advanced/Execution" subsection — single field only (YAGNI).
- No new validation infrastructure beyond simple input coercion.

## Design

### Location & gating

In [`ConfigTab.tsx`](../../packages/flow-editor/src/properties-panel/ConfigTab.tsx),
immediately below the existing **"Agent log level"** field.

Gate to custom-AI steps only:

```
definition?.executor.kind === "coding-cli"
  && definition.executor.method === "runCustomPrompt"
```

This is narrower than the Agent-log-level gate (which also includes
`checkoutRepo`) because only `runCustomPrompt` honors `config.maxSteps`.

### Field behavior

- A `type="number"` input bound to `config.maxSteps`.
- **Empty = provider default (80).** The placeholder reads `Default (80)` so blank
  unambiguously means "use the default."
- `min={1}`, `step={1}`.
- On change:
  - Blank, non-numeric, or `< 1` → **delete** `config.maxSteps` (revert to default).
  - A positive integer → store `Math.floor(value)` as `config.maxSteps`.
- `disabled` when `readOnly`, matching the other fields.

### Help text

> "Most steps the agent can take (tool calls + replies) before it's stopped.
> Leave blank for the default (80). Raise it for big implementation steps; lower
> it to keep small steps cheap."

### Data flow (already implemented — verified, no backend changes)

`maxSteps` rides the same rails that already carry `agentLogLevel` /
`mcpInstanceIds`. Each layer forwards the **whole** config/opts object rather than
cherry-picking fields, so no per-layer change is needed:

| # | Layer | Mechanism | Location |
|---|-------|-----------|----------|
| 1 | UI (this feature) | sets `config.maxSteps` | `ConfigTab.tsx` |
| 2 | Flow → task | `...(resolvedNode.config ?? {})` spread into `inputParameters` | `conductor-converter.ts:378` |
| 3 | Worker | `stepInput = { ...rawInput }` keeps every key | `worker-harness.ts:139` |
| 4 | Handler | reads `input.maxSteps` → `runCustomPrompt({ maxSteps })` | `custom-ai-step-handler.ts` |
| 5 | Provider | aisdk `stepCountIs(maxSteps ?? 80)`; claude `maxTurns` | `aisdk|claude/run-custom-prompt.ts` |

### Sandbox backends (local / docker / windows)

Backend-agnostic. `SandboxInstanceCodingProvider.payload()` serializes opts by
**spreading the whole object** and stripping only `onLog`/`signal` (not an
allowlist), so `maxSteps` is included automatically
(`sandbox-instance-coding-provider.ts:12`). This serialization happens **once,
before** any backend-specific launch code; local (spawn), docker (`docker exec`),
and windows (agent) transport the same `stdin` JSON. The runner then spreads opts
into `provider.runCustomPrompt`. There is no per-backend field filtering, so the
budget reaches the model loop identically on all three. (In-process / non-sandbox
runs pass `maxSteps` directly in opts.)

## Components & boundaries

- **Single unit of change:** the JSX block + change handler inside `ConfigTab.tsx`.
- **Inputs:** `node.config`, `definition.executor`, `readOnly`.
- **Output:** `onChange({ ...node, config: next })` — same mechanism as Agent log
  level. No new props, no new modules.

## Error / edge handling

- Pasting `0`, negative, or text → treated as "unset" (key removed), so the run
  always has a valid budget (the provider default).
- Very large values are accepted (no hard cap); the provider's loop and the run's
  own timeouts bound actual cost.

## Testing

A focused unit test for the change handler behavior (matching the flow-editor
package's existing test style; if `ConfigTab` has no test harness, add a minimal
one):

1. Entering `200` sets `config.maxSteps === 200`.
2. Clearing the field removes `config.maxSteps`.
3. Entering `0` / negative / non-numeric removes `config.maxSteps`.
4. The field renders only for `runCustomPrompt` coding-CLI steps, not for
   `checkoutRepo` or non-coding steps.

## Acceptance

- A custom-AI step's properties panel shows "Max steps" below "Agent log level".
- Setting a value persists to `config.maxSteps`; clearing it removes the key.
- The field is absent for non-custom-AI steps.
- `npm run typecheck` and the flow-editor tests pass.
