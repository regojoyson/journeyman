# OpenCode Live Logging — Design

**Date:** 2026-06-22
**Status:** Approved design (pending spec review)
**Scope:** `@journeyman/agent-runtime` — opencode provider only

## In plain words

Today the opencode agent works silently for minutes, then prints one final sentence
("Done, made the PR"). You never see it clone, write files, or call GitHub. The Claude
provider, by contrast, narrates every step. This change makes opencode narrate too.

opencode already broadcasts its play-by-play on a live channel (a Server-Sent Events
stream). The current code never tunes in — it just waits for the job to finish and reads
the last line. The fix: subscribe to that channel and forward each step to the log the
moment it happens. If the channel ever cuts out (e.g. an opencode version bump changes the
event shapes), we fall back to fetching the full written transcript at the end — so you're
never left with one sentence again.

## Problem

`runCustomPrompt` in the opencode provider calls `client.session.prompt()`, a **blocking**
request that returns only when the whole agent loop finishes. Consequences observed in a
real run (3-minute job):

1. **No liveness.** Nothing is logged during the run — only `runCustomPrompt start`, then
   worker heartbeats, then a single line at the end. The code is parked on one `await`.
2. **No completeness, even at the end.** After the prompt resolves, the code dumps
   `res.data.parts` via `logOpenCodeTranscript`. But `session.prompt`'s response carries
   only the **final assistant message's** parts — not the full conversation. So every
   intermediate tool call (clone, branch, file writes, GitHub-MCP calls, commit, push)
   is absent. With `agentLogLevel: "all"` the user saw exactly one `🤖 assistant:` line
   and zero `🔧 tool:` lines.

The Claude provider avoids both: it iterates `for await (const msg of query(...))` and calls
`logSdkMessage` on every streamed message.

### Why it wasn't done this way originally

`utils/sdk-logger.ts` documents the deliberate tradeoff: dumping parts after completion is
"robust and version-agnostic, unlike subscribing to the SSE event stream." Live streaming
reintroduces version-fragility. This design accepts that risk **and neutralizes it** with a
fallback to the stable `session.messages()` REST endpoint.

## Goal

Live, Claude-parity log streaming for opencode runs across **all** sandbox backends
(local, docker, machine-windows), with a full-transcript fallback when the live feed fails.

## Key facts that make this work

- **`client.event.subscribe()`** returns a Server-Sent Events stream exposing `onSseEvent`
  and `onSseError` callbacks, with built-in bounded retry (`sseDefaultRetryDelay`,
  `sseMaxRetryAttempts`). The SDK handles reconnection; `onSseError` is our failure hook.
- The stream emits session-scoped events; the relevant ones are `message.part.updated`
  (each text/tool part as it is created/updated), `session.idle` (loop finished),
  `session.error`.
- A `message.part.updated` payload carries the same part shape (`OpenCodePart`) that
  `logOpenCodeTranscript` already knows how to render.
- **`client.session.messages({ sessionID })`** returns the full message history — a stable
  REST endpoint, used for the fallback dump.
- **Delivery is already live.** `onLog` writes one JSON line to **stderr** per call
  (`runner/cli.ts`), and every backend forwards stderr/log lines live:
  - local & docker: stderr streams out as it's written (the existing "Cloning…" lines prove
    this).
  - machine-windows: the runner runs on a remote Windows agent; each log line is relayed
    back over a gRPC stream and hits `onLog` immediately
    (`windows-execution-environment.ts` `stream.on("data", … ev.log → op.onLog)`).
  So opencode's silence is purely that it never *calls* `onLog` until the end — not a
  transport limitation.

## Approach (chosen)

**SSE subscriber + shared renderer**, with a `session.messages()` fallback.

Considered and rejected:
- **Poll `session.messages()` on an interval** — sidesteps SSE fragility but is *live-ish*
  (polling lag), adds HTTP load, and hand-rolls part diffing. Not true Claude-parity.
- **SSE primary + polling fallback** — two streaming mechanisms to maintain; overkill.

## Architecture & boundaries

All changes are confined to `packages/agent-runtime/src/providers/opencode/`. No other
package, provider, or sandbox backend changes.

| Unit | Responsibility |
|---|---|
| **`utils/event-stream.ts`** (new) | Owns the SSE lifecycle: subscribe via `client.event.subscribe()`, filter events to our `sessionID`, map `message.part.updated` → parts, dedup, invoke a per-part callback, surface `onSseError`/teardown. Independently testable with a fake event feed. |
| **`utils/sdk-logger.ts`** (refactor) | Extract the per-part rendering currently inline in `logOpenCodeTranscript` into a single `renderPart(part, onLog, level)`. Both the live subscriber and the fallback dump call it — one place decides how a tool/text part looks and how `agentLogLevel` gates it. `logOpenCodeTranscript` becomes "render an array of parts via `renderPart`" (used by the fallback). |
| **`operations/run-custom-prompt.ts`** (orchestrate) | Start the subscriber → `await session.prompt` (unchanged) → tear down subscriber → if the live feed was degraded or produced nothing, fallback-dump via `session.messages()`. Result extraction (`extractText`, structured validation) is untouched — it reads `res.data`, the return payload, not logging. |

### Data flow

```
create session → sid
  │
  ├─ start SSE subscriber (background)         ── client.event.subscribe()
  │     for each event where sessionID === sid:
  │       message.part.updated → renderPart() → onLog   (LIVE)
  │     onSseError → mark degraded = true
  │
  ├─ await session.prompt(...)                  (blocking, unchanged)
  │
  ├─ stop subscriber (signal + close, short grace flush)
  │
  ├─ if degraded || streamedParts === 0:
  │       msgs = await session.messages(sid)
  │       renderPart() over ALL parts          (FALLBACK full dump)
  │
  └─ extract text / validate structured from res.data  (unchanged)
```

### No double-printing

The subscriber tracks each part by `partID` with its last-emitted status:
- **Tool part:** emit the invocation (`🔧 tool: name(args)`) the first time it appears;
  emit the result (`📥 name: ok|error`) once when it reaches `completed`/`error`.
- **Text part:** emit once when settled (terminal state for that part).

The end-of-run full dump runs **only** when the live feed was degraded or emitted nothing.
In the happy path the subscriber already logged everything, so the dump is skipped — no line
prints twice.

### Clean shutdown

- The subscriber runs concurrently with `session.prompt` and is driven by an internal
  `AbortController`.
- On prompt settle, abort the subscriber and `await` its completion with a short grace
  window so trailing `message.part.updated` events flush.
- On run abort (`opts.signal`), the existing `client.session.abort` fires **and** the
  subscriber is torn down.
- The SDK's SSE retry is bounded (`sseMaxRetryAttempts`), so a dead stream can't hang the
  step; once retries exhaust, `onSseError` flips `degraded` and we proceed to fallback.

### Session scoping

Events are filtered to our `sid`. In managed mode the server hosts one session, but
filtering is correct and cheap; in **external** mode (shared remote server) it is required
so we don't log other sessions' activity.

## Sandbox coverage

| Backend | Live feed | Transport out | Result |
|---|---|---|---|
| local | runner ↔ localhost opencode | stderr streamed live | ✅ live |
| docker | runner ↔ localhost opencode (same container) | stderr streamed live | ✅ live |
| machine-windows | runner ↔ localhost opencode (on the agent box) | gRPC `ev.log` relayed per-event | ✅ live |

The SSE "radio channel" is always **local to wherever the runner runs**, so no cross-network
hop for the live feed in the normal (managed) case. The socat/dockerproxy timeout that has
truncated runners before applies to the runner↔worker pipe, **not** the runner↔opencode SSE
connection, so it does not affect this.

Edge: **external opencode mode** puts the opencode server on a remote box, so the live feed
crosses the network and may drop — covered by the `session.messages()` fallback. Precondition
unrelated to logging: opencode must actually run on the target (notably the Windows agent).

## Error handling

- **SSE error / version drift:** `onSseError` → `degraded = true` → fallback full dump. Never
  worse than today.
- **`session.prompt` failure (no data):** unchanged — surfaced via `describeSdkError`. The
  subscriber is still torn down.
- **Abort mid-run:** unchanged abort semantics; subscriber torn down; `MessageAbortedError`
  still maps to the abort error.
- **`session.messages()` fallback itself fails:** log a warning and degrade to the current
  `res.data.parts` dump (final message only) so logging is never a hard failure of the run.

## Testing

- **`event-stream.ts`** (new unit tests): feed a fake async event sequence →
  - asserts `renderPart`/`onLog` called per part in order;
  - dedups repeated `message.part.updated` for the same `partID`;
  - filters out events for other session ids;
  - `onSseError` sets degraded and stops cleanly;
  - respects `agentLogLevel` gating (`none`/`medium`/`all`).
- **`sdk-logger.ts`:** existing `logOpenCodeTranscript` tests still pass against the
  refactored `renderPart`; add a direct `renderPart` test.
- **`run-custom-prompt.ts`:**
  - happy path: events stream live, end-of-run dump is **skipped** (no duplication);
  - degraded path: `onSseError` → `session.messages()` fetched and full transcript dumped;
  - empty-stream path: zero streamed parts → fallback dump;
  - abort: subscriber torn down, abort error thrown;
  - existing text / structured / `outputMode` result tests unchanged (result extraction
    untouched).

## Out of scope

- Changing Claude / aisdk / gemini / codex providers (Claude already streams; others unchanged).
- Token-level streaming of assistant text deltas (we emit settled text parts, not deltas).
- Any UI/worker change — they already render `onLog` lines live.
