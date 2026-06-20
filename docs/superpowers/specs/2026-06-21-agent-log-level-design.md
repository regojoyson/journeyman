# Agent log level — design

**Date:** 2026-06-21
**Status:** Approved (design); pending implementation plan

## Goal

Agents currently have no way to control how much of the coding-CLI transcript is
streamed to their run logs. Workflow steps already expose this as a "log level"
picker (`agentLogLevel`: `none` / `light` / `medium` / `all`). This change gives
agents the same control by reusing the existing `AgentLogLevel` type and dropdown
semantics — no new concepts.

A secondary effect: today the `agent-run` step handler calls `runCustomPrompt`
**without** `onLog`/`agentLogLevel`, so agent runs emit no SDK logs at all. Wiring
the field through closes that gap.

## Background — how workflow steps do it

- Type `AgentLogLevel = "none" | "light" | "medium" | "all"` lives in
  `packages/core/src/types/coding.types.ts`.
  - `none` — no agent SDK logs (handler's own start/end lines still fire).
  - `light` — only the final result line.
  - `medium` — result + tool calls (no assistant text, no tool-result content).
  - `all` — full transcript.
- The flow-editor picker is in `packages/flow-editor/src/properties-panel/ConfigTab.tsx`
  (a `<select>`), gated to coding-CLI steps. It writes `node.config.agentLogLevel`,
  and **deletes** the key when the user picks `none` (absence = none).
- At runtime the value flows `node.config` → `StepInput.agentLogLevel`, resolved by
  `resolveAgentLogLevel(raw)` in
  `packages/orchestrator/src/workers/steps/agent-log-level.ts` (defaults to `none`),
  then `custom-ai`/`start-feature-branch` handlers pass
  `{ onLog: ctx.log, agentLogLevel }` into `runCustomPrompt`/`checkoutRepo` when the
  level is not `none`.

## Decisions

- **Default for agents: `medium`.** Agents run individually and have a Run History
  view, so result + tool calls is useful out of the box — unlike a step buried in a
  large graph (which defaults to `none`).
- **Placement: the Behavior section** of the agent editor, alongside `maxTurns`,
  `timeoutSeconds`, and `outputMode`.
- **Persist the value verbatim.** Unlike the ConfigTab (which deletes `none` so
  absence = none), the agent default is `medium`, so the chosen value is stored as-is.
  Absence (e.g. older agents) falls back to `medium`.

## Changes

### 1. Data model — `packages/core/src/types/agent.types.ts`

Add one optional field to the `Agent` interface:

```ts
agentLogLevel?: AgentLogLevel; // "none" | "light" | "medium" | "all"; default "medium"
```

`AgentLogLevel` already lives in `core` (`coding.types.ts`) — import/reference it,
do not redefine. Stored in the existing `definition` JSONB column on `jm_agents`, so
**no DB migration** is required. `AgentUpdateInput` already derives from `Agent`, so
the field is patchable automatically.

### 2. Editor UI — `packages/web/src/components/agents/sections/BehaviorSection.tsx`

Add a `<select>` modeled on the existing `outputMode` dropdown, placed directly after
Output mode:

- Bound to `a.agentLogLevel`, with the displayed value defaulting to `"medium"` when
  unset (`value={a.agentLogLevel ?? "medium"}`).
- `onChange` → `patch({ agentLogLevel: e.target.value as AgentLogLevel })`.
- Disabled when `locked` (matches the other fields).
- Options (labels copied from ConfigTab):
  - `none` — None — no agent SDK logs
  - `light` — Light — only final result line
  - `medium` — Medium — result + tool calls
  - `all` — All — full transcript
- `FieldLabel` help text: e.g. "How much of the agent transcript is streamed to run logs."

### 3. Section save wiring — `packages/web/src/components/agents/agent-form.ts`

Add `agentLogLevel` to `SECTION_FIELDS.behavior` so dirty-tracking and per-section
save include it:

```ts
behavior: ["behavior", "limits", "outputMode", "agentLogLevel"],
```

### 4. Compile — `packages/agents/src/compile.ts`

Emit the field into the `agent-run` step `config`:

```ts
agentLogLevel: agent.agentLogLevel ?? "medium",
```

Because compile always emits a concrete value, the handler receives an explicit level
and the resolver's `none` default never applies to agents.

### 5. Runtime — `packages/orchestrator/src/workers/steps/agent-run-step-handler.ts`

Resolve and conditionally pass through, mirroring `custom-ai-step-handler.ts`:

```ts
const agentLogLevel = resolveAgentLogLevel(input.agentLogLevel);
const result = await coding.runCustomPrompt({
  // ...existing fields...
  ...(agentLogLevel !== "none" ? { onLog: ctx.log, agentLogLevel } : {}),
});
```

Import `resolveAgentLogLevel` from `./agent-log-level.ts`. No change to that helper —
it stays shared with the workflow-step path.

## Out of scope (YAGNI)

- Per-run override in the run-now modal — log level stays a per-agent setting,
  matching workflow steps.
- No change to `resolveAgentLogLevel` or the workflow-step path.
- No DB migration.

## Testing

- **`packages/agents`** — `compileAgentToGraph` emits `config.agentLogLevel`: both an
  explicitly set value and the `medium` fallback when the agent field is absent.
- **`packages/orchestrator`** — `AgentRunStepHandler` passes `onLog` + `agentLogLevel`
  to `runCustomPrompt` when the level is not `none`, and omits both when `none`.
- **`packages/web`** — agent-form section-save test covers `agentLogLevel` in the
  `behavior` section dirty/patch round-trip.

## Affected files

| File | Change |
|---|---|
| `packages/core/src/types/agent.types.ts` | Add `agentLogLevel?` field |
| `packages/web/src/components/agents/sections/BehaviorSection.tsx` | Add Log level `<select>` |
| `packages/web/src/components/agents/agent-form.ts` | Add field to `SECTION_FIELDS.behavior` |
| `packages/agents/src/compile.ts` | Emit `agentLogLevel` into step config |
| `packages/orchestrator/src/workers/steps/agent-run-step-handler.ts` | Resolve + pass `onLog`/`agentLogLevel` |
