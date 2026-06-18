# OpenCode `maxSteps` parity — design

**Date:** 2026-06-18
**Status:** Approved (design)
**Scope:** Wire the per-step `maxSteps` config through the OpenCode coding provider so it honors the agent step cap, matching the Claude and AISDK providers.

## Problem

`maxSteps` is a user-facing config field (flow-editor "Max steps" → `node.config.maxSteps` →
custom-AI step input → `runCustomPrompt({ maxSteps })`). Two of three coding providers honor it:

| Provider | Mechanism | Default |
|---|---|---|
| Claude | `maxTurns: maxSteps` in SDK `query()` | `DEFAULT_STEP_BUDGET = 80` |
| AISDK | `stopWhen: stepCountIs(maxSteps)` | `DEFAULT_STEP_BUDGET = 80` |
| **OpenCode** | **none — silently dropped** | — |

`packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.ts` calls
`client.session.prompt(...)` with no step/turn cap, so a user's `maxSteps` has no effect on
OpenCode runs. This is the known OpenCode parity gap (maxSteps/abort/skills) recorded in
`docs/agents §15b`.

## Chosen approach: native agent `maxSteps`

The OpenCode SDK exposes a native cap: `AgentConfig.maxSteps` —
*"Maximum number of agentic iterations before forcing text-only response."* On hitting the cap,
OpenCode gracefully forces a final text-only response (it does **not** error or hard-abort).

`maxSteps` lives on an **agent**, and the server `Config.agent` is a map of agent name →
`AgentConfig` (built-ins: `build` / `plan` / `general` / `explore`). Because the provider starts a
**fresh managed server per operation** (`OpenCodeProvider.#withServer`) and already assembles a
per-call `Config` in `server-config.ts`, we can inject the cap into that per-call config with no
shared/global state.

The synchronous `session.prompt` (no explicit `agent` in the body) runs under OpenCode's default
primary agent, `build`. We override only `maxSteps` on `build` so OpenCode's built-in `build`
defaults (tools, prompt) are preserved by partial merge, and the per-prompt `tools` / `system` and
top-level `permission` we already send are untouched.

### Pre-implementation verification (first step, throwaway probe)

Before wiring, confirm two assumptions against a managed server:

1. The bare `session.prompt` (no `agent` field) runs under the `build` agent.
2. A partial `agent: { build: { maxSteps: N } }` override **merges** onto the built-in `build`
   config (does not replace it wholesale, i.e. tools/prompt still work).

If either fails, fall back to the **dedicated-agent variant**: define
`agent: { journeyman: { maxSteps, mode: "primary" } }` in the server config and pass
`agent: "journeyman"` in the prompt body. (Per-prompt `tools`/`system` still apply over an agent
reference.) The default-value behavior and call sites below are identical for either variant.

## Changes

### 1. `server-config.ts` — thread + inject the cap

- Add `maxSteps?: number` to `ServerConfigRuntime`.
- In `buildServerConfig`, when a resolved `maxSteps` is present, add an `agent` block:
  `agent: { build: { maxSteps } }`.
- Resolve the default here (or at the call site — see §3): `maxSteps > 0 ? maxSteps : 80`.

### 2. `index.ts` — pass `maxSteps` into the runtime

`runCustomPrompt` calls `#withServer(runtime, …)`. Add `maxSteps: opts.maxSteps` to the `runtime`
object so `buildServerConfig` receives it. `scanRepos` / `checkoutRepo` are deterministic built-in
ops with their own fixed budgets and are **not** changed.

### 3. Default budget (`DEFAULT_STEP_BUDGET = 80`)

Match Claude/AISDK: when the step omits `maxSteps` (or it is `<= 0`), apply `80`. Define the
constant in the OpenCode operation/config layer (mirroring the other two providers) so all three
behave identically when the field is left blank.

## Out of scope

- `scanRepos` / `checkoutRepo` fixed budgets (deterministic ops — correctly hardcoded).
- The `abort` / `skills` items of the broader OpenCode parity gap.
- Any flow-editor / core type change — `maxSteps` already exists end-to-end; this is provider-only.

## Testing

- Unit test on `buildServerConfig`: given `runtime.maxSteps = 25`, the returned config contains
  `agent.build.maxSteps === 25`; given no `maxSteps`, it contains `agent.build.maxSteps === 80`
  (the parity default).
- Unit test that `permission`, `mcp`, and `provider` blocks are still produced alongside the new
  `agent` block (no regression to existing server-config assembly).
- Existing `run-custom-prompt` tests continue to pass (prompt body unchanged in Approach A).

## Risk

The merge/default-agent assumption (verified in the pre-implementation probe) is the only risk; the
dedicated-agent fallback covers it. Behavior change is otherwise additive — runs that never hit the
cap are unaffected, and capped runs end with a graceful text-only response.
