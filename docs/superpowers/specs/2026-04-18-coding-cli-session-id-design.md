# Coding-CLI Session ID Threading

**Date:** 2026-04-18
**Status:** Design approved, pending spec review

## Problem

Each call into a `ClaudeProvider` operation (`cloneRepos`, `scanRepos`, `resetRepos`, and future `analyze`/`plan`/`implement`) starts a fresh Claude Agent SDK session. That means:

- Prompt cache is cold on every call (tokens wasted re-sending context).
- No way for a caller to chain related operations under one conversation.

We want callers to be able to reuse a Claude session across multiple coding-CLI calls.

## Goals

- Let a caller thread a session across operations on any `ICodingCLI` provider.
- Keep providers **stateless** — no internal session registry, no hidden lifecycle.
- Uniform shape across all 6 ops so future orchestration is trivial.

## Non-Goals

- Provider-managed sessions / internal state.
- Session persistence, storage, or an orchestrator (planned for later).
- Any change to `git-provider`, `ticket-provider`, or `notification-provider` — REST APIs, no session concept.

## Design

### 1. Shared session types in `@journeyman/core`

New file `packages/core/src/types/session.types.ts`:

```ts
export type SessionOptions = {
  /** If provided, the operation resumes the existing Claude session (reuses prompt cache).
   *  If omitted, the provider generates a new UUID and starts a fresh session. */
  sessionId?: string;
};

export type SessionResult = {
  /** The session UUID the operation ran against — either the one passed in,
   *  or the one generated internally. Always populated, including on error. */
  sessionId: string;
};
```

Exported from `packages/core/src/index.ts`.

### 2. Extend all 6 op types

**`packages/core/src/types/git.types.ts`:**
- `CloneReposOptions`, `ScanReposOptions`, `ResetReposOptions` extend `SessionOptions`
- `CloneReposResult`, `ScanReposResult`, `ResetReposResult` extend `SessionResult`

**`packages/core/src/types/coding.types.ts`:**
- `AnalyzeOptions`, `PlanOptions`, `ImplementOptions` extend `SessionOptions`
- `AnalyzeResult`, `PlanResult`, `ImplementResult` extend `SessionResult`

`ICodingCLI` itself doesn't change — option/result types carry the new field.

### 3. Claude provider behavior

A small helper `packages/coding-cli/src/providers/claude/utils/session.ts`:

```ts
import { randomUUID } from "node:crypto";

/** Returns the resolved sessionId and the SDK option fragment to merge into `query()` options. */
export function resolveSession(input?: string): {
  sessionId: string;
  queryOption: { resume: string } | { sessionId: string };
} {
  if (input) return { sessionId: input, queryOption: { resume: input } };
  const sessionId = randomUUID();
  return { sessionId, queryOption: { sessionId } };
}
```

Rules:
- Caller provided → `resume: sessionId` (continue prior conversation, warm cache).
- Caller omitted → we `randomUUID()` and pass as `sessionId` (assign UUID to a new session).

Each of `clone-repos.ts`, `scan-repos.ts`, `reset-repos.ts`:
1. Call `resolveSession(opts.sessionId)` at the top.
2. Spread `queryOption` into the `query()` options object.
3. Include `sessionId` in **every** returned result — success, error, early return.

### 4. Gemini / Codex providers

Their stubs already throw `not implemented`. They accept `sessionId` through the shared types and ignore it. No new code, no behavior change.

### 5. Analyze / Plan / Implement

Types get `sessionId` now so the contract is consistent. Stubs continue to throw `not implemented`.

## Usage patterns (both supported)

```ts
// Pattern 1 — caller owns the ID
const sid = crypto.randomUUID();
await provider.cloneRepos({ ..., sessionId: sid });
await provider.scanRepos({ ..., sessionId: sid });

// Pattern 2 — first call generates, chain from result
const r1 = await provider.cloneRepos({ ... });
await provider.scanRepos({ ..., sessionId: r1.sessionId });
```

## Error handling

`sessionId` is returned on every path — including when the SDK returns a non-success `result` message or an exception bubbles up before the first `query()` message. This guarantees the caller can always resume or log the session.

## Testing

- Unit: `resolveSession()` returns `{ resume }` when input provided, `{ sessionId }` when not.
- Integration (Claude provider): pass an explicit `sessionId`, confirm it appears in the returned result unchanged. Omit it, confirm a UUID is returned.
- Type check: `npm run typecheck` — confirms every option/result type still matches `ICodingCLI`.

## Out of scope / future

- An orchestrator that owns a session lifecycle across multiple provider calls.
- Session persistence to disk (the SDK already stores session logs under `~/.claude/projects/`, so resumption works across processes without extra code from us).
- Applying the pattern to `git-provider`/`ticket-provider`/`notification-provider`.
