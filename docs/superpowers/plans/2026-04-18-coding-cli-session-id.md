# Coding-CLI Session ID Threading — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thread an optional `sessionId` through every `ICodingCLI` op so callers can resume Claude Agent SDK sessions across calls (warm prompt cache, chained conversations).

**Architecture:** Add shared `SessionOptions` / `SessionResult` types in `@journeyman/core`. Extend all 6 coding-cli op option/result types. In the Claude provider, a small helper resolves the incoming id (or generates one), picks `resume` vs `sessionId` for the SDK `query()` call, and every result path returns the resolved id. Gemini and Codex providers inherit the new fields via shared types but stay stubs.

**Tech Stack:** TypeScript, npm workspaces, `@anthropic-ai/claude-agent-sdk`, `node:crypto`, `node:assert`, `tsx`. No test framework is configured in this repo — verification is `npm run typecheck` plus small `tsx` assertion scripts where behavior needs checking.

**Spec:** [`docs/superpowers/specs/2026-04-18-coding-cli-session-id-design.md`](../specs/2026-04-18-coding-cli-session-id-design.md)

---

## File Structure

**Create:**
- `packages/core/src/types/session.types.ts` — `SessionOptions`, `SessionResult` types
- `packages/coding-cli/src/providers/claude/utils/session.ts` — `resolveSession()` helper
- `packages/coding-cli/src/providers/claude/utils/session.test.ts` — tsx smoke test for helper

**Modify:**
- `packages/core/src/index.ts` — export session types
- `packages/core/src/types/git.types.ts` — extend `Clone/Scan/ResetReposOptions` + `...Result`
- `packages/core/src/types/coding.types.ts` — extend `Analyze/Plan/ImplementOptions` + `...Result`
- `packages/coding-cli/src/providers/claude/operations/clone-repos.ts` — wire sessionId
- `packages/coding-cli/src/providers/claude/operations/scan-repos.ts` — wire sessionId
- `packages/coding-cli/src/providers/claude/operations/reset-repos.ts` — wire sessionId

**Untouched:** `ICodingCLI` interface file, Gemini/Codex providers, git-provider, ticket-provider, notification-provider.

---

### Task 1: Add shared session types in `@journeyman/core`

**Files:**
- Create: `packages/core/src/types/session.types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create the session types file**

Create `packages/core/src/types/session.types.ts` with:

```ts
/**
 * Optional session identifier accepted by any coding-cli operation.
 * When provided, the provider resumes the existing Claude Agent SDK session
 * (warm prompt cache). When omitted, the provider generates a fresh UUID.
 */
export type SessionOptions = {
  sessionId?: string;
};

/**
 * Session identifier returned by every coding-cli operation — either the
 * value the caller passed in, or the UUID the provider generated. Always
 * populated, including on error paths, so callers can chain or log.
 */
export type SessionResult = {
  sessionId: string;
};
```

- [ ] **Step 2: Export session types from the core index**

Modify `packages/core/src/index.ts`. After the existing `export type * from "./types/notification.types.ts";` line, add:

```ts
export type * from "./types/session.types.ts";
```

Final file:

```ts
// Interfaces
export type { ICodingCLI } from "./interfaces/coding-cli.interface.ts";
export type { IGitProvider } from "./interfaces/git-provider.interface.ts";
export type { ITicketProvider } from "./interfaces/ticket.interface.ts";
export type { INotificationProvider } from "./interfaces/notification.interface.ts";

// Types
export type * from "./types/git.types.ts";
export type * from "./types/coding.types.ts";
export type * from "./types/ticket.types.ts";
export type * from "./types/notification.types.ts";
export type * from "./types/session.types.ts";
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types/session.types.ts packages/core/src/index.ts
git commit -m "feat(core): add SessionOptions and SessionResult shared types"
```

---

### Task 2: Extend coding-cli option/result types with session fields

**Files:**
- Modify: `packages/core/src/types/git.types.ts`
- Modify: `packages/core/src/types/coding.types.ts`

- [ ] **Step 1: Extend git CLI op types**

Modify `packages/core/src/types/git.types.ts`.

Add this import at the top of the file (line 1):

```ts
import type { SessionOptions, SessionResult } from "./session.types.ts";
```

Change the three option types (CloneReposOptions, ScanReposOptions, ResetReposOptions) and three result types (CloneReposResult, ScanReposResult, ResetReposResult) in the `Git CLI operation types` section so they extend the session base types.

Replace:

```ts
export type CloneReposOptions = {
  repos: string | string[] | RepoEntry | RepoEntry[];
  branch?: string;
  targetDir?: string;
};
```

With:

```ts
export type CloneReposOptions = SessionOptions & {
  repos: string | string[] | RepoEntry | RepoEntry[];
  branch?: string;
  targetDir?: string;
};
```

Replace:

```ts
export type CloneReposResult = {
  repos: CloneResult[];
  error?: string;
};
```

With:

```ts
export type CloneReposResult = SessionResult & {
  repos: CloneResult[];
  error?: string;
};
```

Replace:

```ts
export type ScanReposOptions = {
  parentDir: string;
};
```

With:

```ts
export type ScanReposOptions = SessionOptions & {
  parentDir: string;
};
```

Replace:

```ts
export type ScanReposResult = {
  repos: RepoInfo[];
  error?: string;
};
```

With:

```ts
export type ScanReposResult = SessionResult & {
  repos: RepoInfo[];
  error?: string;
};
```

Replace:

```ts
export type ResetReposOptions = {
  repos: string | string[] | ResetEntry | ResetEntry[];
  branch?: string;
};
```

With:

```ts
export type ResetReposOptions = SessionOptions & {
  repos: string | string[] | ResetEntry | ResetEntry[];
  branch?: string;
};
```

Replace:

```ts
export type ResetReposResult = {
  repos: ResetResult[];
  error?: string;
};
```

With:

```ts
export type ResetReposResult = SessionResult & {
  repos: ResetResult[];
  error?: string;
};
```

**Do not touch** the `Git platform API types` section (GetRepoOptions, CreatePROptions, etc.) — those belong to `git-provider` and are out of scope.

- [ ] **Step 2: Extend AI op types**

Modify `packages/core/src/types/coding.types.ts`.

Replace the entire file contents with:

```ts
import type { SessionOptions, SessionResult } from "./session.types.ts";

export type AnalyzeOptions = SessionOptions & {
  dirPath: string;
  ticketContent?: string;
  focus?: string;
};

export type AnalyzeResult = SessionResult & {
  summary: string;
  insights: string[];
  error?: string;
};

export type PlanOptions = SessionOptions & {
  dirPath: string;
  goal: string;
  context?: string;
};

export type PlanResult = SessionResult & {
  steps: string[];
  error?: string;
};

export type ImplementOptions = SessionOptions & {
  dirPath: string;
  plan: string;
  branch: string;
};

export type ImplementResult = SessionResult & {
  success: boolean;
  filesChanged?: string[];
  error?: string;
};
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`

Expected: the `coding-cli` workspace will now fail because `ClaudeProvider`'s `cloneRepos`/`scanRepos`/`resetRepos` return values don't include `sessionId` yet. That is expected at this checkpoint — Task 3+ fixes it.

The failures should only mention the three Claude operation files returning objects missing `sessionId`. If any other package (core, git-provider, ticket-provider, notification-provider) fails, stop and investigate before proceeding.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types/git.types.ts packages/core/src/types/coding.types.ts
git commit -m "feat(core): thread sessionId through coding-cli op types"
```

---

### Task 3: Create the `resolveSession` helper

**Files:**
- Create: `packages/coding-cli/src/providers/claude/utils/session.ts`

- [ ] **Step 1: Write the helper**

Create `packages/coding-cli/src/providers/claude/utils/session.ts`:

```ts
import { randomUUID } from "node:crypto";

/**
 * Resolves an optional caller-supplied sessionId into the concrete id plus
 * the option fragment to merge into the Claude Agent SDK `query()` options.
 *
 * - Caller provided an id → `{ resume: id }` — the SDK continues that
 *   session (warm prompt cache, same conversation history).
 * - Caller omitted the id → we generate a UUID and pass `{ sessionId }` —
 *   the SDK assigns that id to a fresh session.
 *
 * The returned `sessionId` is always populated and is what callers should
 * echo back in their own result payload, even on error paths.
 */
export function resolveSession(input?: string): {
  sessionId: string;
  queryOption: { resume: string } | { sessionId: string };
} {
  if (input) {
    return { sessionId: input, queryOption: { resume: input } };
  }
  const sessionId = randomUUID();
  return { sessionId, queryOption: { sessionId } };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`

Expected: still fails on the three Claude operation files (unchanged from Task 2). The new helper file itself must compile cleanly — if `session.ts` appears in the errors, fix it before continuing.

- [ ] **Step 3: Commit**

```bash
git add packages/coding-cli/src/providers/claude/utils/session.ts
git commit -m "feat(coding-cli): add resolveSession helper for Claude provider"
```

---

### Task 4: Add a runnable smoke test for `resolveSession`

**Files:**
- Create: `packages/coding-cli/src/providers/claude/utils/session.test.ts`

This repo has no configured test framework. The convention is runnable `.ts` scripts. This task adds a small `tsx`-executable file that uses `node:assert` — same spirit as the manual run blocks in `clone-repos.ts` and friends.

- [ ] **Step 1: Write the test script**

Create `packages/coding-cli/src/providers/claude/utils/session.test.ts`:

```ts
import assert from "node:assert/strict";
import { resolveSession } from "./session.ts";

// Case 1: caller provides an id → resume that id
{
  const { sessionId, queryOption } = resolveSession("abc-123");
  assert.equal(sessionId, "abc-123");
  assert.deepEqual(queryOption, { resume: "abc-123" });
}

// Case 2: caller omits the id → fresh UUID, pass as sessionId
{
  const { sessionId, queryOption } = resolveSession();
  assert.match(
    sessionId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  assert.deepEqual(queryOption, { sessionId });
}

// Case 3: empty string counts as "not provided" (matches ?? semantics we rely on)
{
  const { sessionId, queryOption } = resolveSession("");
  assert.notEqual(sessionId, "");
  assert.ok("sessionId" in queryOption);
}

console.log("resolveSession: all assertions passed");
```

- [ ] **Step 2: Run the smoke test**

Run: `npx tsx packages/coding-cli/src/providers/claude/utils/session.test.ts`

Expected stdout: `resolveSession: all assertions passed`
Expected exit code: 0

If an assertion fails, fix `session.ts` (not the test) before continuing.

- [ ] **Step 3: Commit**

```bash
git add packages/coding-cli/src/providers/claude/utils/session.test.ts
git commit -m "test(coding-cli): smoke test for resolveSession helper"
```

---

### Task 5: Wire sessionId into `cloneRepos`

**Files:**
- Modify: `packages/coding-cli/src/providers/claude/operations/clone-repos.ts`

- [ ] **Step 1: Update imports and early initialization**

At the top of `clone-repos.ts`, update the second import line and add the helper import:

Replace:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import type { RepoEntry, CloneReposOptions, CloneReposResult } from "@journeyman/core";
```

With:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { resolveSession } from "../utils/session.ts";
import type { RepoEntry, CloneReposOptions, CloneReposResult } from "@journeyman/core";
```

- [ ] **Step 2: Thread sessionId through `cloneRepos`**

Replace the entire `cloneRepos` function body with:

```ts
export async function cloneRepos(opts: CloneReposOptions): Promise<CloneReposResult> {
  const entries = normalizeEntries(opts);
  const dir = opts.targetDir ?? process.cwd();
  const { sessionId, queryOption } = resolveSession(opts.sessionId);
  let output: CloneReposResult = { repos: [], sessionId };

  for await (const msg of query({
    prompt: buildPrompt(entries, dir),
    options: {
      tools: ["Bash"],
      allowedTools: ["Bash"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 10,
      settingSources: [],
      settings: { allowedMcpServers: [] },
      outputFormat: { type: "json_schema", schema: OUTPUT_SCHEMA },
      ...queryOption,
    },
  })) {
    logSdkMessage(msg);
    if (msg.type === "result") {
      if (msg.subtype !== "success") {
        return { repos: [], error: (msg as any).result ?? msg.subtype, sessionId };
      }
      output = { ...(msg.structured_output as CloneReposResult), sessionId };
    }
  }

  return output;
}
```

Notes for the engineer:
- The `sessionId` is captured **before** the `for await` loop so it's available on every exit path (including if `query()` throws before yielding a message, though that's not an exit path we return from — it would bubble up).
- `...queryOption` spreads either `{ resume: "..." }` or `{ sessionId: "..." }` into the SDK options object — exactly one of the two, per the helper.
- We overwrite the structured_output's `sessionId` with our resolved id — even though the SDK includes a `session_id` on messages, our contract is "the id we resolved," not "whatever the SDK happens to echo."

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`

Expected: `clone-repos.ts` now passes. Errors remaining should only be `scan-repos.ts` and `reset-repos.ts`. If `clone-repos.ts` still errors, fix before continuing.

- [ ] **Step 4: Commit**

```bash
git add packages/coding-cli/src/providers/claude/operations/clone-repos.ts
git commit -m "feat(coding-cli): thread sessionId through cloneRepos"
```

---

### Task 6: Wire sessionId into `scanRepos`

**Files:**
- Modify: `packages/coding-cli/src/providers/claude/operations/scan-repos.ts`

- [ ] **Step 1: Update imports**

Replace:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import type { ScanReposOptions, ScanReposResult } from "@journeyman/core";
```

With:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { resolveSession } from "../utils/session.ts";
import type { ScanReposOptions, ScanReposResult } from "@journeyman/core";
```

- [ ] **Step 2: Thread sessionId through `scanRepos`**

Replace the entire `scanRepos` function body with:

```ts
export async function scanRepos(opts: ScanReposOptions): Promise<ScanReposResult> {
  const { sessionId, queryOption } = resolveSession(opts.sessionId);
  let output: ScanReposResult = { repos: [], sessionId };

  for await (const msg of query({
    prompt: buildPrompt(opts.parentDir),
    options: {
      tools: ["Bash"],
      allowedTools: ["Bash"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 10,
      settingSources: [],
      settings: { allowedMcpServers: [] },
      outputFormat: { type: "json_schema", schema: OUTPUT_SCHEMA },
      ...queryOption,
    },
  })) {
    logSdkMessage(msg);
    if (msg.type === "result") {
      if (msg.subtype !== "success") {
        return { repos: [], error: (msg as any).result ?? msg.subtype, sessionId };
      }
      output = { ...(msg.structured_output as ScanReposResult), sessionId };
    }
  }

  return output;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`

Expected: `scan-repos.ts` now passes. Only `reset-repos.ts` should still fail.

- [ ] **Step 4: Commit**

```bash
git add packages/coding-cli/src/providers/claude/operations/scan-repos.ts
git commit -m "feat(coding-cli): thread sessionId through scanRepos"
```

---

### Task 7: Wire sessionId into `resetRepos`

**Files:**
- Modify: `packages/coding-cli/src/providers/claude/operations/reset-repos.ts`

- [ ] **Step 1: Update imports**

Replace:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import type { ResetEntry, ResetReposOptions, ResetReposResult } from "@journeyman/core";
```

With:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { resolveSession } from "../utils/session.ts";
import type { ResetEntry, ResetReposOptions, ResetReposResult } from "@journeyman/core";
```

- [ ] **Step 2: Thread sessionId through `resetRepos`**

Replace the entire `resetRepos` function body with:

```ts
export async function resetRepos(opts: ResetReposOptions): Promise<ResetReposResult> {
  const entries = normalizeEntries(opts);
  const { sessionId, queryOption } = resolveSession(opts.sessionId);
  let output: ResetReposResult = { repos: [], sessionId };

  for await (const msg of query({
    prompt: buildPrompt(entries),
    options: {
      tools: ["Bash"],
      allowedTools: ["Bash"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 10,
      settingSources: [],
      settings: { allowedMcpServers: [] },
      outputFormat: { type: "json_schema", schema: OUTPUT_SCHEMA },
      ...queryOption,
    },
  })) {
    logSdkMessage(msg);
    if (msg.type === "result") {
      if (msg.subtype !== "success") {
        return { repos: [], error: (msg as any).result ?? msg.subtype, sessionId };
      }
      output = { ...(msg.structured_output as ResetReposResult), sessionId };
    }
  }

  return output;
}
```

- [ ] **Step 3: Typecheck the whole repo**

Run: `npm run typecheck`

Expected: every workspace passes. No errors anywhere. If the Claude `ClaudeProvider` class (in `packages/coding-cli/src/providers/claude/index.ts`) errors about return types, check that Step 2 above was applied correctly — the return object must include `sessionId`.

- [ ] **Step 4: Commit**

```bash
git add packages/coding-cli/src/providers/claude/operations/reset-repos.ts
git commit -m "feat(coding-cli): thread sessionId through resetRepos"
```

---

### Task 8: Verify Gemini & Codex stubs still satisfy the interface

**Files:**
- Read only: `packages/coding-cli/src/providers/gemini/index.ts`
- Read only: `packages/coding-cli/src/providers/codex/index.ts`

Gemini and Codex throw `not implemented`. They don't destructure `opts`, so extending the options types with `sessionId?: string` is non-breaking. But confirm.

- [ ] **Step 1: Read the Gemini provider**

Read `packages/coding-cli/src/providers/gemini/index.ts`. Confirm every method still throws `new Error("...not implemented")` or similar, and that none of them destructure fields from their options arg in a way that would conflict with `sessionId`. No changes needed — this is a verification-only step.

- [ ] **Step 2: Read the Codex provider**

Read `packages/coding-cli/src/providers/codex/index.ts`. Same check as Step 1.

- [ ] **Step 3: Final typecheck**

Run: `npm run typecheck`
Expected: all workspaces pass.

- [ ] **Step 4: No commit needed**

This task changes no files. Skip commit.

---

### Task 9: End-to-end smoke via `clone-repos.ts` run block (optional, network-dependent)

Each operation file has a runnable block at the bottom that actually invokes the Claude SDK. These clone real repos and require network + Claude credentials. Only run this if you can do so in your environment.

**Files:**
- Read only: `packages/coding-cli/src/providers/claude/operations/clone-repos.ts` (the bottom `const result = await cloneRepos({...})` block)

- [ ] **Step 1: Inspect output shape, no code change**

Run: `npx tsx packages/coding-cli/src/providers/claude/operations/clone-repos.ts`

Expected: the printed JSON includes a top-level `sessionId` field that is a UUID (because the run block doesn't pass one). Example:

```json
{
  "repos": [ ... ],
  "sessionId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

If `sessionId` is missing, Task 5 wasn't applied correctly — revisit it.

- [ ] **Step 2: No commit needed**

Verification only.

---

## Self-Review Summary

- **Spec coverage:** sections 1 (shared types) → Task 1; section 2 (all 6 op types) → Task 2; section 3 (Claude provider behavior + helper) → Tasks 3, 5, 6, 7; section 4 (Gemini/Codex) → Task 8; section 5 (analyze/plan/implement) → Task 2 (types only — stubs unchanged); error-path sessionId guarantee → Tasks 5/6/7 all return `sessionId` on the non-success branch; usage patterns both work because `resolveSession()` handles provided and omitted input symmetrically.
- **No placeholders.** Every step has exact code or exact commands.
- **Type consistency:** `resolveSession` signature is defined once in Task 3 and consumed identically in Tasks 5, 6, 7. `SessionOptions` / `SessionResult` names match across spec, Task 1, and Task 2.
