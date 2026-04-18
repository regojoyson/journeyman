# commitPushRepos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new multi-repo `commitPushRepos` operation to `@journeyman/coding-cli` that detects uncommitted changes, generates a commit message via Claude Agent SDK (or uses an override), commits, pushes to the current branch, and returns metadata for downstream PR creation.

**Architecture:** Types added to `@journeyman/core`; interface method added to `ICodingCLI`; Claude implementation in a new operation file following the same SDK `query()` pattern as `clone-repos.ts`; Gemini/Codex providers get `throw`-style stubs. Input is normalized to an array of entries, then a single SDK call instructs the agent to run git commands per repo and emit a structured JSON result.

**Tech Stack:** TypeScript (NodeNext ESM), npm workspaces, `@anthropic-ai/claude-agent-sdk`, `tsx` (for smoke-running ops). No test framework — verification is `npm run typecheck` plus an inline smoke-test at the bottom of each op file, consistent with existing ops.

**Testing note:** The project does not use a test runner. Existing ops include a trailing `const result = await op(...)` block executed via `npx tsx <file>` as a smoke test. This plan follows that convention. "Write a test" in other templates becomes "add/update the smoke-test block + run typecheck."

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/core/src/types/git.types.ts` | Modify | Add `CommitPushEntry`, `CommitPushReposOptions`, `CommitPushResult`, `CommitPushReposResult` |
| `packages/core/src/interfaces/coding-cli.interface.ts` | Modify | Add `commitPushRepos` method to `ICodingCLI` |
| `packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts` | Create | Claude SDK-powered implementation + smoke test |
| `packages/coding-cli/src/providers/claude/index.ts` | Modify | Wire `commitPushRepos` into `ClaudeProvider` |
| `packages/coding-cli/src/providers/gemini/index.ts` | Modify | Add throwing stub |
| `packages/coding-cli/src/providers/codex/index.ts` | Modify | Add throwing stub |

---

## Task 1: Add types to `@journeyman/core`

**Files:**
- Modify: `packages/core/src/types/git.types.ts`

- [ ] **Step 1: Append the new types**

Open `packages/core/src/types/git.types.ts` and append at the end of the file (after the existing `CreatePRResult` block):

```ts
// ---------------------------------------------------------------------------
// Commit + push operation types (used by coding-cli providers)
// ---------------------------------------------------------------------------

export type CommitPushEntry = {
  dirPath: string;
  ticket?: string;   // per-repo override of top-level ticket
  message?: string;  // full commit message; if set, skips AI generation
};

export type CommitPushReposOptions = {
  repos: string | string[] | CommitPushEntry | CommitPushEntry[];
  ticket?: string;                            // default ticket applied to all entries
  pattern?: string;                           // default: "{ticket} : {summary}"
  prSummaryStyle?: "brief" | "detailed";      // default: "detailed"
};

export type CommitPushResult = {
  folderName: string;
  dirPath: string;
  branch: string;        // current branch (committed + pushed to)
  commitSha: string;     // new HEAD SHA
  commitMessage: string; // final message used for git commit
  title: string;         // PR/MR title — e.g. "EV-123: Fix header alignment"
  description: string;   // PR/MR body — summary of code changes (markdown)
  filesChanged: string[];
  pushed: boolean;
  remoteUrl?: string;    // origin URL — useful for owner/repo parsing
  error?: string;
};

export type CommitPushReposResult = {
  repos: CommitPushResult[];
  error?: string;
};
```

- [ ] **Step 2: Verify types compile**

Run from repo root:
```bash
npm run typecheck
```
Expected: no errors. (Types are re-exported automatically by `packages/core/src/index.ts` via `export type * from "./types/git.types.ts"`.)

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types/git.types.ts
git commit -m "feat(core): add commit-push operation types"
```

---

## Task 2: Extend `ICodingCLI` interface

**Files:**
- Modify: `packages/core/src/interfaces/coding-cli.interface.ts`

- [ ] **Step 1: Import the new types and add the method**

Edit `packages/core/src/interfaces/coding-cli.interface.ts` so that it reads:

```ts
import type {
  CloneReposOptions, CloneReposResult,
  ScanReposOptions, ScanReposResult,
  ResetReposOptions, ResetReposResult,
  CommitPushReposOptions, CommitPushReposResult,
} from "../types/git.types.ts";
import type { AnalyzeOptions, AnalyzeResult, PlanOptions, PlanResult, ImplementOptions, ImplementResult } from "../types/coding.types.ts";

/**
 * Contract for AI coding CLI providers (Claude, Gemini, Codex).
 * Covers git operations run via CLI and AI-powered analyze/plan/implement.
 */
export interface ICodingCLI {
  // Git operations (executed via CLI bash)
  cloneRepos(opts: CloneReposOptions): Promise<CloneReposResult>;
  scanRepos(opts: ScanReposOptions): Promise<ScanReposResult>;
  resetRepos(opts: ResetReposOptions): Promise<ResetReposResult>;
  commitPushRepos(opts: CommitPushReposOptions): Promise<CommitPushReposResult>;

  // AI operations
  analyze(opts: AnalyzeOptions): Promise<AnalyzeResult>;
  plan(opts: PlanOptions): Promise<PlanResult>;
  implement(opts: ImplementOptions): Promise<ImplementResult>;
}
```

- [ ] **Step 2: Verify typecheck fails as expected**

Run:
```bash
npm run typecheck
```
Expected: FAIL — `ClaudeProvider`, `GeminiProvider`, `CodexProvider` do not yet implement `commitPushRepos`. Errors should reference all three classes. This confirms the interface change takes effect.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/interfaces/coding-cli.interface.ts
git commit -m "feat(core): require commitPushRepos on ICodingCLI"
```

---

## Task 3: Add throwing stubs to Gemini and Codex providers

**Files:**
- Modify: `packages/coding-cli/src/providers/gemini/index.ts`
- Modify: `packages/coding-cli/src/providers/codex/index.ts`

- [ ] **Step 1: Update Gemini stub**

Replace the contents of `packages/coding-cli/src/providers/gemini/index.ts` with:

```ts
import type { ICodingCLI } from "../../interface.ts";
import type {
  CloneReposOptions, CloneReposResult,
  ScanReposOptions, ScanReposResult,
  ResetReposOptions, ResetReposResult,
  CommitPushReposOptions, CommitPushReposResult,
  AnalyzeOptions, AnalyzeResult,
  PlanOptions, PlanResult,
  ImplementOptions, ImplementResult,
} from "@journeyman/core";

/** Gemini coding CLI provider. Not yet implemented. */
export class GeminiProvider implements ICodingCLI {
  cloneRepos(_opts: CloneReposOptions): Promise<CloneReposResult> { throw new Error("GeminiProvider.cloneRepos not implemented"); }
  scanRepos(_opts: ScanReposOptions): Promise<ScanReposResult> { throw new Error("GeminiProvider.scanRepos not implemented"); }
  resetRepos(_opts: ResetReposOptions): Promise<ResetReposResult> { throw new Error("GeminiProvider.resetRepos not implemented"); }
  commitPushRepos(_opts: CommitPushReposOptions): Promise<CommitPushReposResult> { throw new Error("GeminiProvider.commitPushRepos not implemented"); }
  analyze(_opts: AnalyzeOptions): Promise<AnalyzeResult> { throw new Error("GeminiProvider.analyze not implemented"); }
  plan(_opts: PlanOptions): Promise<PlanResult> { throw new Error("GeminiProvider.plan not implemented"); }
  implement(_opts: ImplementOptions): Promise<ImplementResult> { throw new Error("GeminiProvider.implement not implemented"); }
}
```

- [ ] **Step 2: Update Codex stub**

Read `packages/coding-cli/src/providers/codex/index.ts` to match its current structure, then apply the same changes: import `CommitPushReposOptions`, `CommitPushReposResult` from `@journeyman/core`, and add:

```ts
commitPushRepos(_opts: CommitPushReposOptions): Promise<CommitPushReposResult> { throw new Error("CodexProvider.commitPushRepos not implemented"); }
```

Keep the existing pattern of the file (one-liner methods, same import style).

- [ ] **Step 3: Verify typecheck narrows to ClaudeProvider only**

Run:
```bash
npm run typecheck
```
Expected: errors remain only for `ClaudeProvider` (missing `commitPushRepos`). No Gemini/Codex errors.

- [ ] **Step 4: Commit**

```bash
git add packages/coding-cli/src/providers/gemini/index.ts packages/coding-cli/src/providers/codex/index.ts
git commit -m "feat(coding-cli): stub commitPushRepos on Gemini and Codex providers"
```

---

## Task 4: Implement `commit-push-repos.ts` — scaffolding and normalization

**Files:**
- Create: `packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts`

- [ ] **Step 1: Create the file with imports, schema, and normalization helpers**

Create `packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts`:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import type {
  CommitPushEntry,
  CommitPushReposOptions,
  CommitPushReposResult,
} from "@journeyman/core";

export type { CommitPushEntry, CommitPushReposOptions, CommitPushReposResult };

const DEFAULT_PATTERN = "{ticket} : {summary}";

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    repos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          folderName: { type: "string" },
          dirPath: { type: "string" },
          branch: { type: "string" },
          commitSha: { type: "string" },
          commitMessage: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          filesChanged: { type: "array", items: { type: "string" } },
          pushed: { type: "boolean" },
          remoteUrl: { type: "string" },
          error: { type: "string" },
        },
        required: [
          "folderName",
          "dirPath",
          "branch",
          "commitSha",
          "commitMessage",
          "title",
          "description",
          "filesChanged",
          "pushed",
        ],
      },
    },
    error: { type: "string" },
  },
  required: ["repos"],
} as const;

type NormalizedEntry = {
  dirPath: string;
  ticket?: string;
  message?: string;
};

function normalizeEntries(opts: CommitPushReposOptions): NormalizedEntry[] {
  const raw = Array.isArray(opts.repos) ? opts.repos : [opts.repos];
  return raw.map((r) => {
    if (typeof r === "string") {
      return { dirPath: r, ticket: opts.ticket };
    }
    return {
      dirPath: r.dirPath,
      ticket: r.ticket ?? opts.ticket,
      message: r.message,
    };
  });
}
```

- [ ] **Step 2: Verify typecheck**

Run:
```bash
npm run typecheck
```
Expected: no new errors from this file. (ClaudeProvider still missing `commitPushRepos` — that's fine, fixed in Task 6.)

- [ ] **Step 3: Commit**

```bash
git add packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts
git commit -m "feat(coding-cli): scaffold commitPushRepos types and normalization"
```

---

## Task 5: Implement `commit-push-repos.ts` — prompt builder, `query()` loop, smoke test

**Files:**
- Modify: `packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts`

- [ ] **Step 1: Add prompt builder**

Append to `commit-push-repos.ts` (below `normalizeEntries`):

```ts
function buildPrompt(
  entries: NormalizedEntry[],
  pattern: string,
  prSummaryStyle: "brief" | "detailed"
): string {
  const entriesJson = JSON.stringify(entries, null, 2);

  return [
    "For each repo entry below, run these git steps using the Bash tool.",
    "Keep going for all repos even if some fail — record errors per repo.",
    "",
    `Entries:\n${entriesJson}`,
    "",
    `Commit message pattern: ${JSON.stringify(pattern)}`,
    "Tokens: {ticket} (from entry.ticket), {summary} (you generate it from the diff).",
    "If entry.ticket is absent and the pattern contains {ticket}, drop the ticket",
    'portion cleanly (no leading/trailing " : " or "{ticket}" literal).',
    "If entry.message is set, use it verbatim and skip {summary} generation.",
    "",
    `PR description style: ${prSummaryStyle}`,
    "",
    "Per repo, execute in order:",
    "1. `git -C <dirPath> status --porcelain`. If output is empty, record",
    '   { error: "no changes", pushed: false, title: "", description: "",',
    '     commitMessage: "", commitSha: "", filesChanged: [] } and skip remaining steps.',
    "2. `git -C <dirPath> rev-parse --abbrev-ref HEAD` → branch.",
    "3. Collect changed files:",
    "   `git -C <dirPath> diff --name-only`",
    "   `git -C <dirPath> diff --cached --name-only`",
    "   `git -C <dirPath> ls-files --others --exclude-standard`",
    "   Union them into filesChanged (unique, sorted).",
    "4. Run `git -C <dirPath> diff HEAD` to see the actual code changes.",
    "   If entry.message is not set, produce a concise imperative {summary}",
    "   (<= 72 chars, no trailing period) from this diff.",
    "5. Build the final commitMessage:",
    "   - If entry.message is set, commitMessage = entry.message.",
    "   - Otherwise substitute {ticket} and {summary} into the pattern.",
    "     If entry.ticket is absent and pattern starts with '{ticket} : ',",
    "     collapse the prefix — use just {summary}.",
    "6. Build the PR-ready fields from the SAME diff:",
    "   - title: `<ticket>: <summary>` (single space after colon) if entry.ticket",
    "     is set, else just `<summary>`. Title is for PR/MR, not git log, so it",
    "     uses ': ' not ' : '.",
    "   - description: markdown summary of the actual code changes in the diff.",
    "     If prSummaryStyle is 'brief', write one short paragraph (2–3 sentences).",
    "     If 'detailed', write a one-line intro then a bulleted list of notable",
    "     file-by-file changes (what changed, not the full diff). No trailing",
    "     boilerplate. No generated-by footer.",
    "7. `git -C <dirPath> add -A`",
    '8. `git -C <dirPath> commit -m "<commitMessage>"`',
    "9. `git -C <dirPath> rev-parse HEAD` → commitSha.",
    "10. `git -C <dirPath> push origin <branch>`. On success pushed: true,",
    "    on failure pushed: false and set error to the stderr message.",
    "11. `git -C <dirPath> remote get-url origin` → remoteUrl (ignore errors here).",
    "",
    "folderName is the basename of dirPath.",
    "",
    "Return JSON matching the output schema: a repos array with one entry per",
    "input repo, and an optional top-level error only if the whole operation failed",
    "before any repo was processed.",
  ].join("\n");
}
```

- [ ] **Step 2: Add the exported `commitPushRepos` function**

Append:

```ts
export async function commitPushRepos(
  opts: CommitPushReposOptions
): Promise<CommitPushReposResult> {
  const entries = normalizeEntries(opts);
  const pattern = opts.pattern ?? DEFAULT_PATTERN;
  const prSummaryStyle = opts.prSummaryStyle ?? "detailed";
  let output: CommitPushReposResult = { repos: [] };

  for await (const msg of query({
    prompt: buildPrompt(entries, pattern, prSummaryStyle),
    options: {
      tools: ["Bash"],
      allowedTools: ["Bash"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 40,
      settingSources: [],
      settings: { allowedMcpServers: [] },
      outputFormat: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
  })) {
    logSdkMessage(msg);
    if (msg.type === "result") {
      if (msg.subtype !== "success") {
        return { repos: [], error: (msg as any).result ?? msg.subtype };
      }
      output = msg.structured_output as CommitPushReposResult;
    }
  }

  return output;
}
```

- [ ] **Step 3: Add a smoke-test block (commented out by default)**

Append to the bottom of the file:

```ts
// Run: npx tsx packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts
// Uncomment and edit `dirPath` to point at a local repo with uncommitted changes.
//
// const result = await commitPushRepos({
//   repos: [{ dirPath: "/absolute/path/to/repo" }],
//   ticket: "EV-123",
// });
// console.log(JSON.stringify(result, null, 2));
```

The smoke test stays commented to avoid mutating a real repo on import. Running the file becomes a no-op import check.

- [ ] **Step 4: Typecheck**

Run:
```bash
npm run typecheck
```
Expected: still one error — `ClaudeProvider` missing `commitPushRepos` (fixed next task).

- [ ] **Step 5: Run the file to confirm it imports cleanly**

Run:
```bash
npx tsx packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts
```
Expected: exits 0 with no output (smoke test is commented).

- [ ] **Step 6: Commit**

```bash
git add packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts
git commit -m "feat(coding-cli): implement commitPushRepos via Claude Agent SDK"
```

---

## Task 6: Wire `commitPushRepos` into `ClaudeProvider`

**Files:**
- Modify: `packages/coding-cli/src/providers/claude/index.ts`

- [ ] **Step 1: Update the provider**

Replace the contents of `packages/coding-cli/src/providers/claude/index.ts` with:

```ts
import type { ICodingCLI } from "../../interface.ts";
import type {
  CloneReposOptions, CloneReposResult,
  ScanReposOptions, ScanReposResult,
  ResetReposOptions, ResetReposResult,
  CommitPushReposOptions, CommitPushReposResult,
} from "@journeyman/core";
import type { AnalyzeOptions, AnalyzeResult, PlanOptions, PlanResult, ImplementOptions, ImplementResult } from "@journeyman/core";
import { cloneRepos } from "./operations/clone-repos.ts";
import { scanRepos } from "./operations/scan-repos.ts";
import { resetRepos } from "./operations/reset-repos.ts";
import { commitPushRepos } from "./operations/commit-push-repos.ts";

/**
 * Claude coding CLI provider.
 * Implements ICodingCLI using the Claude Agent SDK internally.
 */
export class ClaudeProvider implements ICodingCLI {
  // Git CLI operations (powered by Claude bash tool)
  cloneRepos(opts: CloneReposOptions): Promise<CloneReposResult> {
    return cloneRepos(opts);
  }

  scanRepos(opts: ScanReposOptions): Promise<ScanReposResult> {
    return scanRepos(opts);
  }

  resetRepos(opts: ResetReposOptions): Promise<ResetReposResult> {
    return resetRepos(opts);
  }

  commitPushRepos(opts: CommitPushReposOptions): Promise<CommitPushReposResult> {
    return commitPushRepos(opts);
  }

  // AI operations — to be implemented
  analyze(_opts: AnalyzeOptions): Promise<AnalyzeResult> {
    throw new Error("ClaudeProvider.analyze not yet implemented");
  }

  plan(_opts: PlanOptions): Promise<PlanResult> {
    throw new Error("ClaudeProvider.plan not yet implemented");
  }

  implement(_opts: ImplementOptions): Promise<ImplementResult> {
    throw new Error("ClaudeProvider.implement not yet implemented");
  }
}
```

- [ ] **Step 2: Full typecheck must be green**

Run:
```bash
npm run typecheck
```
Expected: PASS across all workspace packages, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/coding-cli/src/providers/claude/index.ts
git commit -m "feat(coding-cli): wire commitPushRepos into ClaudeProvider"
```

---

## Task 7: End-to-end smoke test against a throwaway repo

**Files:**
- Modify: `packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts` (temporary edit, reverted after run)

- [ ] **Step 1: Prepare a disposable local repo**

Run:
```bash
TMP=$(mktemp -d)
git -C "$TMP" init -q
git -C "$TMP" remote add origin "$TMP/../fake-origin.git"
git -C "$TMP" -c init.defaultBranch=main checkout -q -b main || true
git -C "$TMP" commit --allow-empty -q -m "initial"
echo "hello" > "$TMP/file.txt"
echo "TMP=$TMP"
```
Write down the `TMP` path for Step 2.

Note: push will fail (fake origin) — that's expected. The smoke test validates everything *up to* push: status detection, branch detection, message generation, commit, SHA capture. `pushed: false` with an `error` is the expected result.

- [ ] **Step 2: Uncomment the smoke-test block with the real path**

In `packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts`, replace the commented smoke block with:

```ts
const result = await commitPushRepos({
  repos: [{ dirPath: "<TMP-PATH-FROM-STEP-1>" }],
  ticket: "EV-123",
});
console.log(JSON.stringify(result, null, 2));
```

Substitute the actual `TMP` path — no placeholders.

- [ ] **Step 3: Run the op**

Run:
```bash
npx tsx packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts
```
Expected: JSON output with `repos[0]` having:
- `folderName` matching the temp dir basename
- `branch` set to `main` (or whatever default branch was created)
- `commitSha` set to a 40-char SHA
- `commitMessage` starting with `EV-123 : `
- `title` starting with `EV-123: ` (single space after colon, not ` : `)
- `description` non-empty (markdown summary of the `file.txt` addition)
- `filesChanged` containing `file.txt`
- `pushed: false` and `error` describing the push failure (fake origin)

If `pushed: false` with a push-related error: PASS. If any earlier step fails (no commit, no SHA, etc.): investigate before continuing.

- [ ] **Step 4: Revert the smoke block**

Restore the commented-out block (from Task 5, Step 3) so the file stays safe to import.

Run:
```bash
npm run typecheck
```
Expected: PASS, no errors.

- [ ] **Step 5: Clean up temp dir**

```bash
rm -rf "$TMP"
```

- [ ] **Step 6: Commit (only if the revert changed anything staged accidentally)**

```bash
git status
```
If nothing to commit: skip. Otherwise:
```bash
git add packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts
git commit -m "chore(coding-cli): restore commit-push-repos smoke test to commented form"
```

---

## Task 8: Update `CLAUDE.md` implementation status table

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add rows to the "Implementation Status" table**

In `CLAUDE.md`, find the `## Implementation Status` table and add these rows after `ClaudeProvider.resetRepos`:

```
| `ClaudeProvider.commitPushRepos` | Implemented |
```

And update the `GeminiProvider` and `CodexProvider` rows' notes if they mention specific methods — otherwise leave as "Stub" since they remain stubs overall.

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: mark commitPushRepos as implemented on ClaudeProvider"
```

---

## Final verification

- [ ] **Run the full typecheck one more time**

```bash
npm run typecheck
```
Expected: PASS across all packages.

- [ ] **Review git log**

```bash
git log --oneline -10
```
Expected: 7–8 focused commits, one per task, messages in project convention (`feat(scope): ...`, `docs: ...`, `chore(scope): ...`).
