# OpenCode Integration Hardening — Observability & Reliable Structured Results

**Date:** 2026-06-09
**Status:** Approved (design)
**Scope:** `@journeyman/agent-runtime` OpenCode provider (`packages/agent-runtime/src/providers/opencode/`), plus minimal touch to `custom-ai` step result handling in `@journeyman/orchestrator`.

## Problem

Custom-AI steps run via the OpenCode provider exhibit three related defects, all observed on a real run (workflow instance `b1d451b9-…`, model `qwen/qwen3-coder-next` via LM Studio at `host.docker.internal:1234`):

1. **No observability.** `runCustomPrompt` issues a single blocking `client.session.prompt()` call. Unlike the Claude path (which iterates `for await (msg) logSdkMessage(msg)` and logs every assistant message and tool call), the OpenCode path emits **no message-level logs**. The only diagnostics are two pino lines, and one of them — `logSessionEvent` — is `log.debug`, which is filtered out at the default `info` level. Even with `agentLogLevel: "all"`, the run log shows essentially nothing about what the model did. Secondary bug: `logSessionEvent` inspects `info.structured_output` (a Claude-shaped key) instead of OpenCode's `info.structured`.

2. **Unreliable structured results.** OpenCode and the SDK fully support JSON output (`format: { type: "json_schema", schema, retryCount? }`, result in `info.structured`), and journeyman already wires it ([run-custom-prompt.ts:76](../../../packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.ts)). But with a weak local model the reply is often prose, so `info.structured` comes back empty/wrong. journeyman does **no validation, no salvage, no fallback** — a non-conforming reply either yields `{}` or passes garbage straight through to the step output (e.g. a paragraph landing in a field intended to be boolean).

3. **Tools silently all-on (prerequisite).** journeyman's model is "empty canonical tool list = pure-prompt, no tools," so it **omits** the `tools` param when the list is empty ([run-custom-prompt.ts:73](../../../packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.ts)). For Claude, omitting tools means no tools (correct). For OpenCode, **omitting `tools` = all built-in tools enabled by default** (`read`/`write`/`edit`/`bash`/`grep`/`glob`/`webfetch`), and `buildServerConfig` sets `permission: allow` for them. A coding model then spends its turn exploring the sandbox filesystem instead of answering — directly degrading result reliability.

## Goals

- Stream OpenCode activity (model messages, tool calls, tool results, errors) into `step.log` live, gated by `agentLogLevel`, at parity with the Claude path.
- Make structured (`json_schema`) results reliable: leverage OpenCode's built-in retry, validate on our side, salvage from text, and fail loudly with the model's actual reply when all else fails.
- Make "empty tool list" mean **no tools** for OpenCode (prerequisite for reliable results).

## Non-Goals

- No change to the Claude provider beyond reusing shared log-shaping helpers if convenient.
- No change to the canonical tool model or the flow-editor tools picker.
- No new UI; logs surface through the existing `step.log` → instance logs panel.

## Design

### Part A — Live observability

**Mechanism.** The OpenCode v2 SDK exposes an SSE event stream (`client.event()` / `client.event.subscribe`) and a post-hoc `client.session.messages()`. We use the **event stream** for live logs.

1. In `runCustomPrompt`, before issuing the prompt, open an event subscription scoped to the created `sessionID`.
2. For each relevant event (assistant text part, tool-call start, tool result, error), forward a concise line through the existing `onLog` callback (which the runner already pipes to stderr NDJSON → `step.log`).
3. **Verbosity gate** via `agentLogLevel` (already threaded into the op):
   - `all` — every message + tool call + tool result + errors.
   - `some` — tool calls, errors, and the final result/summary only.
   - `none` — no streaming (current behavior).
4. **Teardown:** close/abort the subscription in a `finally` that wraps the prompt call, so the SSE stream cannot leak or hold the runner process open. (Explicit lesson from the socat half-close incident — dangling streams are costly here.)
5. **Log shaping:** introduce a small helper (sibling to Claude's `logSdkMessage`) that turns an OpenCode event into a human line + structured `meta`. Reuse the `{ line, meta }` NDJSON contract the runner already emits.

**Bug fixes in this part:**
- `logSessionEvent`: route through the run log at a visible level (or via `onLog`) rather than `log.debug`; correct the key from `info.structured_output` → `info.structured`.

### Part B — Reliable structured results (layered, cheapest first)

Applies only when `outputMode === "structured"`.

1. **OpenCode built-in retry.** Set `retryCount` on the `json_schema` format (default `2`, env-overridable, e.g. `OPENCODE_STRUCTURED_RETRIES`). OpenCode re-asks the model to conform with no custom code.
2. **Validate `info.structured`** against the generated JSON schema after the prompt returns (the schema is produced by `outputFieldsToJsonSchema`). A lightweight validator checks declared types and `required` fields. (Today there is no validation — this is the gap that let prose land in a typed field.)
3. **Salvage from text** when `structured` is missing/invalid: extract the first balanced JSON object from the concatenated text parts; for single scalar fields, detect `true`/`false`/number tokens. Accept the salvaged value only if it then passes step 2's validation.
4. **Fail clearly** when all layers fail: return a `retryable` error whose message includes the model's actual text reply (truncated), so the failure is diagnosable — and now also visible in the live log from Part A.

The result-handling change is small and lives mostly in `run-custom-prompt.ts`; the orchestrator `custom-ai-step-handler` already maps a returned `error` to a step failure, so validation can either happen in the provider (preferred — keeps the handler thin) or be surfaced as a structured error.

### Prerequisite — explicit tools-off for OpenCode

Change the OpenCode tools wiring so an **empty** effective tool list emits an explicit disable-map rather than omitting `tools`:

- Define the set of OpenCode built-in tool ids journeyman knows about (`read`, `write`, `edit`, `bash`, `grep`, `glob`, `webfetch`, and `skill`/others as applicable).
- When the canonical list is empty → send `{ <each builtin>: false }`.
- When the canonical list is non-empty → send `{ <selected>: true, <unselected builtins>: false }` so only the chosen tools are active.

This makes pure-prompt steps actually tool-less and stops the model from wandering — the single biggest lever for result reliability.

## Affected files

- `packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.ts` — event subscription + teardown, retryCount, validation/salvage, clearer failure.
- `packages/agent-runtime/src/providers/opencode/tool-mapping.ts` — explicit disable-map for empty/partial tool lists.
- `packages/agent-runtime/src/providers/opencode/utils/sdk-logger.ts` — event→log-line shaping; fix level + `structured` key.
- (Possibly) a small schema-validation/salvage helper under `opencode/` or reuse one from `@journeyman/custom-steps`.
- Tests alongside each.

## Testing

Unit tests with a faked OpenCode client / event emitter:
- **Logs:** events → expected `onLog` lines for each `agentLogLevel` (`all`/`some`/`none`); subscription torn down on both success and thrown prompt.
- **Tools:** empty list → all-builtins-`false` map; partial list → selected-`true` + rest-`false`.
- **Structured:** valid structured passes through; invalid structured + salvageable text → salvaged value; unsalvageable → retryable error containing the model reply; `retryCount` forwarded on the format.
- Then `npm run check` (typecheck + import boundaries) and the package's `npm test`.

## Risks / Notes

- OpenCode's SSE event shape must be confirmed against the installed SDK version before coding (event type names / part kinds). The implementation plan should start by reading `@opencode-ai/sdk` v2 event types.
- `retryCount` increases latency and local-model load; default modest (2) and make it env-tunable.
- Salvage is best-effort by nature; it must never *loosen* validation — a salvaged value is accepted only if it validates.
- Tools-off list must track OpenCode's built-in tool ids; if OpenCode adds tools, unknown new tools could default on. Acceptable for now; revisit if it recurs.
