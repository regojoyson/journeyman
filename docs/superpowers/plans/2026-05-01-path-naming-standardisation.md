# Path Naming Standardisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace five inconsistent directory/path names with three canonical names (`baseDir`, `workspaceDir`, `repoDir`) across core types, coding-cli operations, orchestrator handlers, phase meta files, and phase UI definitions — and fix two handler bugs where the field read at runtime doesn't match what the phase meta declares.

**Architecture:** Start with `@journeyman/core` types (the single source of truth), then update each consumer in dependency order: coding-cli operations → git-provider operations → orchestrator handlers → phase meta files → phase tsx UI definitions. Typecheck last to catch anything missed.

**Tech Stack:** TypeScript, npm workspaces monorepo. `npm run typecheck` at root runs `tsc --noEmit` across all packages.

---

## File map

| File | Change |
|---|---|
| `packages/core/src/types/git.types.ts` | Rename `dirPath`→`repoDir` on 9 types; `targetDir`→`workspaceDir` on `CloneReposOptions`; `parentDir`→`baseDir` on `CreateWorkspaceOptions` |
| `packages/core/src/types/coding.types.ts` | Rename `dirPath`→`repoDir` on `AnalyzeOptions`, `PlanOptions`, `ImplementOptions` |
| `packages/coding-cli/src/providers/claude/operations/checkout-repo.ts` | `dirPath`→`repoDir` in type, prompt text, JSON schema, normalise fn, example |
| `packages/coding-cli/src/providers/claude/operations/cleanup-repos.ts` | `dirPath`→`repoDir` |
| `packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts` | `dirPath`→`repoDir` |
| `packages/coding-cli/src/providers/claude/operations/create-workspace.ts` | `dirPath`→`repoDir`; `parentDir`→`baseDir` |
| `packages/coding-cli/src/providers/claude/operations/analyze.ts` | `opts.dirPath`→`opts.repoDir` |
| `packages/coding-cli/src/providers/claude/operations/plan.ts` | `opts.dirPath`→`opts.repoDir` |
| `packages/coding-cli/src/providers/claude/operations/implement.ts` | `opts.dirPath`→`opts.repoDir` |
| `packages/coding-cli/src/providers/claude/operations/scan-repos.ts` | `dirPath`→`repoDir` in result |
| `packages/coding-cli/src/providers/opencode/operations/checkout-repo.ts` | `dirPath`→`repoDir` in normalise fn, JSON schema, prompt text |
| `packages/coding-cli/src/providers/opencode/operations/cleanup-repos.ts` | `dirPath`→`repoDir` in normalise fn, return shapes |
| `packages/coding-cli/src/providers/opencode/operations/commit-push-repos.ts` | `dirPath`→`repoDir` in normalise fn, return shapes |
| `packages/coding-cli/src/providers/opencode/operations/create-workspace.ts` | `dirPath`→`repoDir`; `parentDir`→`baseDir` |
| `packages/coding-cli/src/providers/opencode/operations/analyze.ts` | `opts.dirPath`→`opts.repoDir` |
| `packages/coding-cli/src/providers/opencode/operations/plan.ts` | `opts.dirPath`→`opts.repoDir` |
| `packages/coding-cli/src/providers/opencode/operations/implement.ts` | `opts.dirPath`→`opts.repoDir` |
| `packages/coding-cli/src/providers/opencode/operations/scan-repos.ts` | `dirPath`→`repoDir` in result |
| `packages/git-provider/src/providers/github/operations/clone-repos.ts` | `opts.targetDir`→`opts.workspaceDir`; local var `targetDir`→`workspaceDir` |
| `packages/orchestrator/src/workers/phases/analyze-repo-phase-handler.ts` | `input.dirPath`→`input.repoDir` |
| `packages/orchestrator/src/workers/phases/plan-implementation-phase-handler.ts` | `input.dirPath`→`input.repoDir` |
| `packages/orchestrator/src/workers/phases/implement-changes-phase-handler.ts` | `input.dirPath`→`input.repoDir` |
| `packages/orchestrator/src/workers/phases/clone-repos-phase-handler.ts` | `input.targetDir`→`input.workspaceDir` |
| `packages/orchestrator/src/workers/phases/start-feature-branch-phase-handler.ts` | Redesign: accept `input.repos[]`, map each to `{ repoDir, branch }`, single bulk call to `checkoutRepo` |
| `packages/orchestrator/src/workers/phases/list-workspace-files-phase-handler.ts` | Bug fix: `input.parentDir`→`input.workspaceDir` |
| `packages/orchestrator/src/workers/phases/cleanup-workspace-phase-handler.ts` | Bug fix + redesign: read `input.workspaceDir`, scan it for repos, pass to `cleanupRepos` |
| `packages/orchestrator/src/workers/phases/create-workspace-phase-handler.ts` | Remove `name`/`baseDir` aliases; `ticketId` only; `baseDir` read from provider config |
| `packages/phases/src/repos/start-feature-branch.meta.ts` | Input: replace `workspaceDir` with `repos`; output: `dirPath`→`repoDir` |
| `packages/phases/src/repos/cleanup-workspace.meta.ts` | No field change — `workspaceDir` already correct |
| `packages/phases/src/repos/list-workspace-files.meta.ts` | No field change — `workspaceDir` already correct |
| `packages/phases/src/repos/commit-and-push.meta.ts` | `repoPath`→`repos` (align with handler) |
| `packages/phases/src/repos/create-workspace.meta.ts` | Remove `baseDir`; `name`→`ticketId` |
| `packages/phases/src/git/clone-repos.meta.ts` | `targetDir`→`workspaceDir`; label "Workspace directory" |
| `packages/phases/src/ai/analyze-repo.meta.ts` | Input field key `dirPath`→`repoDir` |
| `packages/phases/src/ai/plan-implementation.meta.ts` | Input field key `dirPath`→`repoDir` |
| `packages/phases/src/ai/implement-changes.meta.ts` | Input field key `dirPath`→`repoDir` |
| `packages/phases/src/repos/start-feature-branch.tsx` | Remove `url` from config (inputs now come from bindings only) |
| `packages/orchestrator/src/cli-worker.ts` | Pass `baseDir` from env to `CreateWorkspacePhaseHandler` constructor |
| `packages/phases/src/repos/commit-and-push.tsx` | `repoPath`→`repos` in config interface, schema, configFields |
| `packages/phases/src/repos/create-workspace.tsx` | Remove `baseDir`; `name`→`ticketId` in config interface, schema, configFields |

---

## Task 1: Rename in core types

**Files:**
- Modify: `packages/core/src/types/git.types.ts`
- Modify: `packages/core/src/types/coding.types.ts`

These types are the source of truth. Every consumer gets TypeScript errors until they are updated too — that's the guide for the remaining tasks.

- [ ] **Replace the full content of `git.types.ts`**

```typescript
import type { SessionOptions, SessionResult } from "./session.types.ts";

// ---------------------------------------------------------------------------
// Git CLI operation types (used by coding-cli providers)
// ---------------------------------------------------------------------------

export type RepoEntry = { url: string; branch: string };
export type CheckoutEntry = { repoDir: string; branch: string };

export type CloneReposOptions = {
  repos: string | string[] | RepoEntry | RepoEntry[];
  branch?: string;
  workspaceDir?: string;
  signal?: AbortSignal;
};

export type CloneResult = {
  folderName: string;
  repoDir: string;
  url: string;
  branch: string;
  error?: string;
};

export type CloneReposResult = {
  repos: CloneResult[];
  error?: string;
};

export type ScanReposOptions = SessionOptions & {
  parentDir: string;
  signal?: AbortSignal;
  model?: string;
};

export type RepoInfo = {
  folderName: string;
  repoDir: string;
  url?: string;
  branch?: string;
  isGitRepo: boolean;
};

export type ScanReposResult = SessionResult & {
  repos: RepoInfo[];
  error?: string;
};

export type CheckoutRepoOptions = SessionOptions & {
  repos: string | string[] | CheckoutEntry | CheckoutEntry[];
  branch?: string;
  ticket?: { id: string; title: string };
  signal?: AbortSignal;
  model?: string;
};

export type CheckoutResult = {
  folderName: string;
  repoDir: string;
  baseBranch: string;
  newBranch: string;
  success: boolean;
  error?: string;
};

export type CheckoutRepoResult = SessionResult & {
  repos: CheckoutResult[];
  newBranch: string;
  error?: string;
};

export type CleanupEntry = {
  repoDir: string;
};

export type CleanupReposOptions = SessionOptions & {
  repos: string | string[] | CleanupEntry | CleanupEntry[];
  signal?: AbortSignal;
  model?: string;
};

export type CleanupRepoResult = {
  folderName: string;
  repoDir: string;
  success: boolean;
  error?: string;
};

export type CleanupReposResult = SessionResult & {
  repos: CleanupRepoResult[];
  error?: string;
};

export type CreateWorkspaceOptions = SessionOptions & {
  ticketId: string;
  baseDir: string;
  signal?: AbortSignal;
  model?: string;
};

export type CreateWorkspaceResult = SessionResult & {
  folderName: string;
  repoDir: string;
  error?: string;
};

// ---------------------------------------------------------------------------
// Git platform API types (used by git-provider providers)
// ---------------------------------------------------------------------------

export type GetRepoOptions = SessionOptions & {
  owner: string;
  repo: string;
};

export type GetRepoResult = SessionResult & {
  name: string;
  fullName: string;
  url: string;
  defaultBranch: string;
  error?: string;
};

export type CreatePROptions = SessionOptions & {
  owner: string;
  repo: string;
  title: string;
  body?: string;
  sourceBranch: string;
  targetBranch: string;
};

export type CreatePRResult = SessionResult & {
  id: string;
  url: string;
  number: number;
  error?: string;
};

export type ListPROptions = SessionOptions & {
  owner: string;
  repo: string;
  head?: string;
  state?: "open" | "closed" | "all";
};

export type ListPRItem = {
  id: string;
  url: string;
  number: number;
  head: string;
  state: string;
};

export type ListPRResult = SessionResult & {
  prs: ListPRItem[];
  error?: string;
};

// ---------------------------------------------------------------------------
// Commit + push operation types (used by coding-cli providers)
// ---------------------------------------------------------------------------

export type CommitPushEntry = {
  repoDir: string;
  ticket?: string;
  message?: string;
};

export type CommitPushReposOptions = SessionOptions & {
  repos: string | string[] | CommitPushEntry | CommitPushEntry[];
  ticket?: string;
  pattern?: string;
  prSummaryStyle?: "brief" | "detailed";
  signal?: AbortSignal;
  model?: string;
};

export type CommitPushResult = {
  folderName: string;
  repoDir: string;
  branch: string;
  commitSha: string;
  commitMessage: string;
  title: string;
  description: string;
  filesChanged: string[];
  pushed: boolean;
  remoteUrl?: string;
  error?: string;
};

export type CommitPushReposResult = SessionResult & {
  repos: CommitPushResult[];
  error?: string;
};

// ---------------------------------------------------------------------------
// PR review comment listing
// ---------------------------------------------------------------------------

export type ListPRCommentsOptions = SessionOptions & {
  prUrl: string;
  sinceIso?: string;
};

export type PRComment = {
  author: string;
  body: string;
  path?: string;
  line?: number;
  createdAt: string;
};

export type ListPRCommentsResult = SessionResult & {
  comments: PRComment[];
  error?: string;
};
```

- [ ] **Update `dirPath` → `repoDir` in `coding.types.ts`**

Three fields, lines 27, 77, 130. Change each one:

```typescript
// AnalyzeOptions (line ~27)
export type AnalyzeOptions = SessionOptions & {
  repoDir: string;   // was dirPath
  ...
};

// PlanOptions (line ~77)
export type PlanOptions = SessionOptions & {
  repoDir: string;   // was dirPath
  ...
};

// ImplementOptions (line ~130)
export type ImplementOptions = SessionOptions & {
  repoDir: string;   // was dirPath
  ...
};
```

---

## Task 2: Rename in claude coding-cli operations

**Files:**
- Modify: `packages/coding-cli/src/providers/claude/operations/checkout-repo.ts`
- Modify: `packages/coding-cli/src/providers/claude/operations/cleanup-repos.ts`
- Modify: `packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts`
- Modify: `packages/coding-cli/src/providers/claude/operations/create-workspace.ts`
- Modify: `packages/coding-cli/src/providers/claude/operations/analyze.ts`
- Modify: `packages/coding-cli/src/providers/claude/operations/plan.ts`
- Modify: `packages/coding-cli/src/providers/claude/operations/implement.ts`
- Modify: `packages/coding-cli/src/providers/claude/operations/scan-repos.ts`

TypeScript errors from Task 1 guide exactly which lines to touch.

- [ ] **`checkout-repo.ts` — rename `dirPath` → `repoDir` everywhere in file**

Locations:
1. JSON schema `properties.repos.items.properties`: rename key `dirPath` → `repoDir`
2. `required` array: `"dirPath"` → `"repoDir"`
3. `normalizeEntries`: `{ dirPath: r, branch }` → `{ repoDir: r, branch }`
4. `buildPrompt`: destructure `{ repoDir, branch }`, update template string and prompt lines (`git -C <repoDir>`)
5. JSDoc `@example`: `dirPath:` → `repoDir:`
6. Bottom `if (import.meta.url)` block: `dirPath:` → `repoDir:`

```typescript
// JSON schema — change property name
properties: {
  repoDir: { type: "string" },   // was dirPath
  ...
}
required: ["folderName", "repoDir", "baseBranch", "newBranch", "success"],

// normalizeEntries
return raw.map((r) =>
  typeof r === "string" ? { repoDir: r, branch: opts.branch ?? "main" } : r
);

// buildPrompt destructure
.map(({ repoDir, branch }) => `  - ${repoDir} → baseBranch: ${branch}`)

// prompt lines
"  1. git -C <repoDir> fetch origin",
"  2. git -C <repoDir> stash --include-untracked   (discard local changes)",
"  3. git -C <repoDir> checkout <baseBranch>",
"  4. git -C <repoDir> pull origin <baseBranch>",
"  5. git -C <repoDir> reset --hard origin/<baseBranch>",
"  6. git -C <repoDir> clean -fd",
"  7. git -C <repoDir> checkout -b <newBranch>",

// return shape mention in prompt
"  - repos[]: { folderName, repoDir, baseBranch, newBranch, success, error? }",

// example
{ repoDir: "/Users/admin/data/workspace/my-api", branch: "main" },
{ repoDir: "/Users/admin/data/workspace/my-web", branch: "main" },
```

- [ ] **`cleanup-repos.ts` — rename `dirPath` → `repoDir`**

Four return statements and one `resolve()` call. Change:
```typescript
// normalizeEntries
return raw.map((r) => (typeof r === "string" ? { repoDir: r } : r));

// inside the loop
const absPath = resolve(entry.repoDir);   // was entry.dirPath

// log calls
log.warn({ repoDir: absPath, reason: refusal }, "cleanup refused — unsafe path");
log.debug({ repoDir: absPath }, "cleanup removed");
log.error({ repoDir: absPath, err: message }, "cleanup failed");

// return shapes
return { folderName, repoDir: absPath, success: false, error: refusal };
return { folderName, repoDir: absPath, success: true };
return { folderName, repoDir: absPath, success: false, error: message };

// JSDoc
* @param opts - Repos to delete. Strings are treated as repoDirs.
```

- [ ] **`commit-push-repos.ts` — rename `dirPath` → `repoDir`**

Locations: JSON schema property key, `normalizeEntries` return, prompt text lines, result shape fields. Pattern:
```typescript
// normalizeEntries — change the mapped type
typeof r === "string" ? { repoDir: r, ticket: undefined, message: undefined } : r

// JSON schema
repoDir: { type: "string" },

// result object on success
{ folderName, repoDir, branch, commitSha, ... }
```

- [ ] **`create-workspace.ts` — rename `dirPath` → `repoDir` and `parentDir` → `baseDir`**

```typescript
// Validation guards
if (!opts.baseDir) {   // was opts.parentDir
  log.error({ sessionId }, "createWorkspace missing baseDir");
  return { folderName: "", repoDir: "", error: "baseDir is required", sessionId };
}

// Build the path
const repoDir = resolve(opts.baseDir, folderName);   // was dirPath / parentDir

// mkdir
await mkdir(repoDir, { recursive: true });

// log and return
log.info({ sessionId, repoDir }, "createWorkspace done");
return { folderName, repoDir, sessionId };

// error return
return { folderName, repoDir, error: message, sessionId };
```

Also update `log.info` at the top:
```typescript
log.info({ sessionId, ticketId: opts.ticketId, baseDir: opts.baseDir }, "createWorkspace start");
```

- [ ] **`analyze.ts` — rename `opts.dirPath` → `opts.repoDir`**

Find all occurrences of `opts.dirPath` and `dirPath` used as a local variable derived from `opts`. Rename to `opts.repoDir` / `repoDir`.

- [ ] **`plan.ts` — rename `opts.dirPath` → `opts.repoDir`**

Three locations:
```typescript
// line ~95 — path derivation
const root = opts.repoDir.replace(/\/+$/, "");

// line ~189 — log.info
log.info({ sessionId, repoDir: opts.repoDir, focus: opts.focus }, "plan start");

// line ~242 — bottom run-directly example
repoDir: "/Users/admin/data/workspace/claude-skils/journeyman",
```

- [ ] **`implement.ts` — rename `opts.dirPath` → `opts.repoDir`**

Three locations (same structure as plan.ts):
```typescript
// line ~96
const root = opts.repoDir.replace(/\/+$/, "");

// line ~198
log.info({ sessionId, repoDir: opts.repoDir, focus: opts.focus }, "implement start");

// line ~253
repoDir: "/Users/admin/data/workspace/claude-skils/journeyman",
```

- [ ] **`scan-repos.ts` — rename `dirPath` → `repoDir` in result items**

The result shape includes `dirPath` per repo. Rename in the JSON schema, prompt, and result mapping.

---

## Task 3: Rename in opencode operations

**Files:**
- Modify: `packages/coding-cli/src/providers/opencode/operations/checkout-repo.ts`
- Modify: `packages/coding-cli/src/providers/opencode/operations/cleanup-repos.ts`
- Modify: `packages/coding-cli/src/providers/opencode/operations/commit-push-repos.ts`
- Modify: `packages/coding-cli/src/providers/opencode/operations/create-workspace.ts`
- Modify: `packages/coding-cli/src/providers/opencode/operations/analyze.ts`
- Modify: `packages/coding-cli/src/providers/opencode/operations/plan.ts`
- Modify: `packages/coding-cli/src/providers/opencode/operations/implement.ts`
- Modify: `packages/coding-cli/src/providers/opencode/operations/scan-repos.ts`

These are mirrors of the claude operations. Apply the identical renames:

- [ ] **`opencode/operations/create-workspace.ts` — `dirPath` → `repoDir` and `parentDir` → `baseDir`**

Apply the identical changes as the claude version in Task 2: rename `opts.parentDir` → `opts.baseDir` in all guards, log calls, and path derivation; rename the local `dirPath` variable → `repoDir`; update all return shapes.

- [ ] **`opencode/operations/checkout-repo.ts` — `dirPath` → `repoDir`**

Apply the identical changes as the claude version: JSON schema property, `normalizeEntries`, prompt text (`git -C <repoDir>`), result shape.

- [ ] **`opencode/operations/cleanup-repos.ts` — `dirPath` → `repoDir`**

Apply the identical changes as the claude version: `normalizeEntries`, `entry.repoDir`, log calls, return shapes.

- [ ] **`opencode/operations/commit-push-repos.ts` — `dirPath` → `repoDir`**

Apply the identical changes as the claude version: `normalizeEntries`, JSON schema, result shapes.

- [ ] **`opencode/operations/analyze.ts` — `opts.dirPath` → `opts.repoDir`**

Same three locations as claude analyze.ts: path derivation, log.info, bottom example block.

- [ ] **`opencode/operations/plan.ts` — `opts.dirPath` → `opts.repoDir`**

Same three locations as claude plan.ts.

- [ ] **`opencode/operations/implement.ts` — `opts.dirPath` → `opts.repoDir`**

Same three locations as claude implement.ts.

- [ ] **`opencode/operations/scan-repos.ts` — `dirPath` → `repoDir` in result**

Rename in the result shape returned per repo.

- [ ] **Verify no `dirPath` or `parentDir` remain in opencode**

```bash
grep -r "dirPath\|parentDir" packages/coding-cli/src/providers/opencode/
```

Expected: zero results.

---

## Task 4: Rename in git-provider clone-repos

**File:**
- Modify: `packages/git-provider/src/providers/github/operations/clone-repos.ts`

- [ ] **Rename `targetDir` → `workspaceDir` in clone-repos operation**

```typescript
export async function cloneRepos(
  token: string,
  opts: CloneReposOptions,
): Promise<CloneReposResult> {
  const entries = normalizeEntries(opts);
  const workspaceDir = opts.workspaceDir ?? process.cwd();   // was targetDir
  try {
    await mkdir(workspaceDir, { recursive: true });
  } catch (err) {
    return { repos: [], error: `failed to create workspaceDir: ${(err as Error).message}` };
  }

  const results: CloneResult[] = [];
  for (const entry of entries) {
    const folderName = repoFolder(entry.url);
    const repoDir = `${workspaceDir}/${folderName}`;   // was dirPath / targetDir
    if (opts.signal?.aborted) {
      results.push({ folderName, repoDir, url: entry.url, branch: entry.branch, error: "aborted" });
      continue;
    }
    let cloneUrl: string;
    try {
      cloneUrl = buildCloneUrl(entry.url, token);
    } catch (err) {
      results.push({ folderName, repoDir, url: entry.url, branch: entry.branch, error: (err as Error).message });
      continue;
    }
    try {
      await execFileP(
        "git",
        ["clone", "--branch", entry.branch, "--single-branch", cloneUrl, repoDir],
        { signal: opts.signal },
      );
      results.push({ folderName, repoDir, url: entry.url, branch: entry.branch });
    } catch (err) {
      const e = err as { stderr?: string; message: string };
      results.push({
        folderName, repoDir, url: entry.url, branch: entry.branch,
        error: scrubToken(e.stderr?.trim() || e.message),
      });
    }
  }

  return { repos: results };
}
```

---

## Task 5: Update orchestrator phase handlers

**Files:**
- Modify: `packages/orchestrator/src/workers/phases/analyze-repo-phase-handler.ts`
- Modify: `packages/orchestrator/src/workers/phases/plan-implementation-phase-handler.ts`
- Modify: `packages/orchestrator/src/workers/phases/implement-changes-phase-handler.ts`
- Modify: `packages/orchestrator/src/workers/phases/clone-repos-phase-handler.ts`
- Modify: `packages/orchestrator/src/workers/phases/start-feature-branch-phase-handler.ts`
- Modify: `packages/orchestrator/src/workers/phases/list-workspace-files-phase-handler.ts`
- Modify: `packages/orchestrator/src/workers/phases/cleanup-workspace-phase-handler.ts`
- Modify: `packages/orchestrator/src/workers/phases/create-workspace-phase-handler.ts`

- [ ] **`analyze-repo-phase-handler.ts` — `input.dirPath` → `input.repoDir`**

```typescript
async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
  const repoDir = input.repoDir;   // was input.dirPath
  const ticketContent = input.ticketContent;
  if (typeof repoDir !== "string" || typeof ticketContent !== "string") {
    return {
      kind: "failure",
      failure: {
        errorClass: "InvalidInput",
        message: "analyze requires string `repoDir` and `ticketContent`",
        retryable: false,
      },
    };
  }
  const coding = this.deps.coding(...);
  ctx.log(`Analyzing ${repoDir}`);
  const result = await coding.analyze({
    repoDir,   // was dirPath
    ticketContent,
    sessionId: ctx.runId,
    signal: ctx.signal,
  });
  ...
}
```

- [ ] **`plan-implementation-phase-handler.ts` — `input.dirPath` → `input.repoDir`**

Same pattern as analyze. Find every `dirPath` read from `input` or passed to `coding.plan()` and rename to `repoDir`.

- [ ] **`implement-changes-phase-handler.ts` — `input.dirPath` → `input.repoDir`**

Same pattern. Find every `dirPath` and rename to `repoDir`.

- [ ] **`clone-repos-phase-handler.ts` — `input.targetDir` → `input.workspaceDir`**

```typescript
// JSDoc
// - workspaceDir — directory under which the repo(s) will be cloned (string)

async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
  ...
  const workspaceDir = typeof input.workspaceDir === "string" ? input.workspaceDir : undefined;
  ...
  await git.cloneRepos({ repos, workspaceDir, branch, signal: ctx.signal });
  ...
}
```

- [ ] **`list-workspace-files-phase-handler.ts` — fix bug: `input.parentDir` → `input.workspaceDir`**

```typescript
async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
  const workspaceDir = typeof input.workspaceDir === "string" ? input.workspaceDir : undefined;
  if (!workspaceDir) {
    return { kind: "failure", failure: { errorClass: "InvalidInput", message: "list-workspace-files requires `workspaceDir`", retryable: false } };
  }
  const coding = this.deps.coding(...);
  ctx.log(`Scanning ${workspaceDir}`);
  const result = await coding.scanRepos({ parentDir: workspaceDir, sessionId: ctx.runId, signal: ctx.signal });
  ...
}
```

Note: `scanRepos` still takes `parentDir` internally — only the handler's input field name changes to match the meta.

- [ ] **`cleanup-workspace-phase-handler.ts` — fix bug: read `input.workspaceDir`, pass to `cleanupRepos`**

Current handler reads `input.repos` (wrong — meta declares `workspaceDir`). New behaviour: read `workspaceDir`, scan it first to discover repo paths, pass those to `cleanupRepos`.

```typescript
import { createLogger } from "@journeyman/core";
import type { ICodingCLI, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderFactory } from "@journeyman/core";

const log = createLogger("worker:cleanup-repos");

export class CleanupWorkspacePhaseHandler implements IPhaseHandler {
  readonly phaseType = "cleanup-workspace";
  constructor(private deps: { coding: ProviderFactory<ICodingCLI> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const workspaceDir = typeof input.workspaceDir === "string" ? input.workspaceDir : undefined;
    if (!workspaceDir) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "cleanup-workspace requires `workspaceDir`", retryable: false } };
    }
    const coding = this.deps.coding(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Scanning workspace ${workspaceDir} before cleanup`);
    const scanResult = await coding.scanRepos({ parentDir: workspaceDir, sessionId: ctx.runId, signal: ctx.signal });
    if (scanResult?.error) {
      log.error({ scanResult }, "cleanup-workspace scan failed");
      return { kind: "failure", failure: { errorClass: "CleanupWorkspaceScanFailed", message: String(scanResult.error), retryable: true } };
    }
    const repos = scanResult.repos.map(r => r.repoDir);
    ctx.log(`Cleaning up ${repos.length} repo(s) in ${workspaceDir}`);
    const result = await coding.cleanupRepos({ repos, sessionId: ctx.runId, signal: ctx.signal });
    if (result?.error) {
      log.error({ result }, "cleanup-repos failed");
      return { kind: "failure", failure: { errorClass: "CleanupReposFailed", message: String(result.error), retryable: true } };
    }
    return { kind: "success", output: { repos: result.repos } };
  }
}
```

- [ ] **`start-feature-branch-phase-handler.ts` — redesign to accept `repos[]`**

Old: accepts single `workspaceDir` or `url`, calls `checkoutRepo` with one entry.
New: accepts `repos[]` (array of `{ repoDir, branch }` objects from clone-repos output), calls `checkoutRepo` once with all repos — creating ONE shared branch across all.

```typescript
import { createLogger } from "@journeyman/core";
import type {
  ICodingCLI, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderFactory,
} from "@journeyman/core";

const log = createLogger("worker:checkout-repo");

/**
 * Wraps ICodingCLI.checkoutRepo.
 *
 * Inputs accepted:
 *   - repos — array of { repoDir, branch } objects (from clone-repos output)
 *   - ticket — { id, title } (optional, drives branch name)
 *
 * Returns:
 *   - newBranch, repos[] with updated repoDir and branch info
 */
export class StartFeatureBranchPhaseHandler implements IPhaseHandler {
  readonly phaseType = "start-feature-branch";

  constructor(private deps: { coding: ProviderFactory<ICodingCLI> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const reposRaw = input.repos;
    if (!Array.isArray(reposRaw) || reposRaw.length === 0) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "start-feature-branch requires `repos` (non-empty array of { repoDir, branch })",
          retryable: false,
        },
      };
    }

    const repos = reposRaw
      .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
      .map(r => ({
        repoDir: typeof r.repoDir === "string" ? r.repoDir : "",
        branch: typeof r.branch === "string" ? r.branch : "main",
      }))
      .filter(r => r.repoDir.length > 0);

    if (repos.length === 0) {
      return {
        kind: "failure",
        failure: { errorClass: "InvalidInput", message: "start-feature-branch: no valid repos with repoDir found", retryable: false },
      };
    }

    const ticketRaw = (input as Record<string, unknown>).ticket;
    const ticket =
      ticketRaw && typeof ticketRaw === "object"
        && typeof (ticketRaw as { id?: unknown }).id === "string"
        && typeof (ticketRaw as { title?: unknown }).title === "string"
        ? { id: (ticketRaw as { id: string }).id, title: (ticketRaw as { title: string }).title }
        : undefined;

    const coding = this.deps.coding(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Checking out ${repos.length} repo(s)`);
    const result = await coding.checkoutRepo({
      repos,
      ticket,
      sessionId: ctx.runId,
      signal: ctx.signal,
    });
    if (result?.error) {
      log.error({ result }, "checkout-repo failed");
      return {
        kind: "failure",
        failure: { errorClass: "CheckoutRepoFailed", message: String(result.error), retryable: true },
      };
    }
    return {
      kind: "success",
      output: {
        newBranch: result.newBranch,
        repos: result.repos,
      },
    };
  }
}
```

- [ ] **`create-workspace-phase-handler.ts` — remove aliases, `ticketId` only, `baseDir` from config**

```typescript
import { createLogger } from "@journeyman/core";
import type {
  ICodingCLI, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderFactory,
} from "@journeyman/core";

const log = createLogger("worker:create-workspace");

/**
 * Wraps ICodingCLI.createWorkspace.
 *
 * Required input keys:
 *   - ticketId — used as the workspace folder name prefix (string)
 *
 * baseDir is read from DirectoryWorkspaceProvider config (not a phase input).
 *
 * Returns:
 *   - workspaceDir — absolute path to the created workspace
 *   - folderName   — last path segment
 */
export class CreateWorkspacePhaseHandler implements IPhaseHandler {
  readonly phaseType = "create-workspace";

  constructor(private deps: { coding: ProviderFactory<ICodingCLI>; baseDir: string }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const ticketId = typeof input.ticketId === "string" ? input.ticketId : undefined;
    if (!ticketId) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "create-workspace requires `ticketId`",
          retryable: false,
        },
      };
    }
    const coding = this.deps.coding(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Creating workspace ${ticketId} under ${this.deps.baseDir}`);
    const result = await coding.createWorkspace({
      ticketId,
      baseDir: this.deps.baseDir,
      sessionId: ctx.runId,
      signal: ctx.signal,
    });
    if (result?.error) {
      log.error({ result }, "create-workspace failed");
      return {
        kind: "failure",
        failure: { errorClass: "CreateWorkspaceFailed", message: String(result.error), retryable: true },
      };
    }
    return { kind: "success", output: { workspaceDir: result.repoDir, folderName: result.folderName } };
  }
}
```

Note: the handler now takes `baseDir` from its constructor deps (injected by the worker registry from `DirectoryWorkspaceProvider` config), not from `input`.

- [ ] **`cli-worker.ts` — pass `baseDir` to `CreateWorkspacePhaseHandler`**

The handler constructor now requires `{ coding, baseDir }`. Read `baseDir` from env, falling back to `os.tmpdir()`.

```typescript
// Add import at top of file
import { tmpdir } from "node:os";
import { join } from "node:path";

// Replace line 63:
// was: registry.register(new CreateWorkspacePhaseHandler({ coding }));
const workspaceBaseDir = process.env.JOURNEYMAN_BASE_DIR ?? join(tmpdir(), "journeyman-workspaces");
registry.register(new CreateWorkspacePhaseHandler({ coding, baseDir: workspaceBaseDir }));
```

---

## Task 6: Update phase meta files

**Files:**
- Modify: `packages/phases/src/ai/analyze-repo.meta.ts`
- Modify: `packages/phases/src/ai/plan-implementation.meta.ts`
- Modify: `packages/phases/src/ai/implement-changes.meta.ts`
- Modify: `packages/phases/src/git/clone-repos.meta.ts`
- Modify: `packages/phases/src/repos/start-feature-branch.meta.ts`
- Modify: `packages/phases/src/repos/commit-and-push.meta.ts`
- Modify: `packages/phases/src/repos/create-workspace.meta.ts`

- [ ] **AI phase metas — rename input field `dirPath` → `repoDir`**

In each of `analyze-repo.meta.ts`, `plan-implementation.meta.ts`, `implement-changes.meta.ts`:

```typescript
export const analyzeRepoInputFields: InputFields = {
  repoDir:       { type: "string", label: "Repo directory", required: true },  // was dirPath
  ticketContent: { type: "string", label: "Ticket content", required: true },
  // ... other fields unchanged
};
```

- [ ] **`clone-repos.meta.ts` — `targetDir` → `workspaceDir`**

```typescript
export const cloneReposInputFields: InputFields = {
  repos:        { type: "string", label: "Repos", required: true },
  workspaceDir: { type: "string", label: "Workspace directory", required: true, bindOnly: true },  // was targetDir
};
```

- [ ] **`start-feature-branch.meta.ts` — replace `workspaceDir` input with `repos`; output `dirPath` → `repoDir`**

```typescript
import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const START_FEATURE_BRANCH_PHASE_TYPE = "start-feature-branch";
export const START_FEATURE_BRANCH_LABEL = "Start Feature Branch";
export const START_FEATURE_BRANCH_CATEGORY = "Workspace";
export const START_FEATURE_BRANCH_DESCRIPTION =
  "Sync already-cloned repos to origin (hard-reset to the base branch), then create one shared feature branch across all of them. The branch name is generated from the ticket.";

export const startFeatureBranchOutputSchema: OutputSchema = {
  newBranch: { type: "string" },
  repos:     { type: "string", description: "Array of { repoDir, branch, newBranch } per repo" },
};

export const startFeatureBranchInputFields: InputFields = {
  repos:  { type: "string", label: "Repos", required: true, bindOnly: true },
  ticket: { type: "string", label: "Ticket", bindOnly: true },
};
```

- [ ] **`commit-and-push.meta.ts` — `repoPath` → `repos` (align with handler)**

```typescript
export const commitAndPushInputFields: InputFields = {
  repos:   { type: "string", label: "Repos", required: true, bindOnly: true },  // was repoPath
  message: { type: "string", label: "Message", required: true },
  branch:  { type: "string", label: "Branch" },
};
```

- [ ] **`create-workspace.meta.ts` — remove `baseDir`; `name` → `ticketId`**

```typescript
import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const CREATE_WORKSPACE_PHASE_TYPE = "create-workspace";
export const CREATE_WORKSPACE_LABEL = "Create Workspace";
export const CREATE_WORKSPACE_CATEGORY = "Workspace";
export const CREATE_WORKSPACE_DESCRIPTION =
  "Create a new local directory to hold repositories for this run.";

export const createWorkspaceOutputSchema: OutputSchema = {
  workspaceDir: { type: "string" },
};

export const createWorkspaceInputFields: InputFields = {
  ticketId: { type: "string", label: "Ticket ID" },  // was name; baseDir removed
};
```

---

## Task 7: Update phase tsx UI definitions

**Files:**
- Modify: `packages/phases/src/repos/commit-and-push.tsx`
- Modify: `packages/phases/src/repos/create-workspace.tsx`
- Modify: `packages/phases/src/repos/start-feature-branch.tsx`

- [ ] **`commit-and-push.tsx` — `repoPath` → `repos` in config interface, schema, configFields**

```typescript
interface CommitAndPushConfig {
  repos: string;    // was repoPath
  message: string;
  branch?: string;
}

export const commitAndPushPhase: PhaseDefinition<CommitAndPushConfig> = {
  ...
  defaultConfig: { repos: "", message: "", branch: "" },
  configSchema: z.object({
    repos: z.string().min(1),    // was repoPath
    message: z.string().min(1),
    branch: z.string().optional(),
  }),
  configFields: {
    repos:   { label: "Repos", widget: "text" },   // was repoPath / "Repo path"
    message: { label: "Commit message", widget: "textarea" },
    branch:  { label: "Branch", widget: "text", help: "Defaults to current branch" },
  },
  summary: c => c.message ? `"${c.message.slice(0, 40)}"` : c.repos,   // was c.repoPath
  ...
};
```

- [ ] **`create-workspace.tsx` — remove `baseDir`; `name` → `ticketId`**

```typescript
interface CreateWorkspaceConfig {
  ticketId: string;   // was name; baseDir removed
}

export const createWorkspacePhase: PhaseDefinition<CreateWorkspaceConfig> = {
  ...
  defaultConfig: { ticketId: "" },
  configSchema: z.object({
    ticketId: z.string().min(1),
  }),
  configFields: {
    ticketId: { label: "Ticket ID", widget: "text" },
  },
  summary: c => c.ticketId,
  ...
};
```

- [ ] **`start-feature-branch.tsx` — remove `url` from config (it is now a runtime input via `repos[]`, not a static config)**

The phase no longer needs a static URL field — repos are bound at runtime from `clone-repos` output.

```typescript
interface StartFeatureBranchConfig {
  // no static config needed; all inputs come from bindings
}

export const startFeatureBranchPhase: PhaseDefinition<StartFeatureBranchConfig> = {
  ...
  defaultConfig: {},
  configSchema: z.object({}),
  configFields: {},
  summary: () => "sync + branch",
  ...
};
```

---

## Task 8: Typecheck

**No files modified — verification only.**

- [ ] **Run typecheck from repo root**

```bash
npm run typecheck
```

Expected: zero errors. If errors appear, they will point to exact file and line — fix each one by applying the same rename that was missed in the earlier tasks.

Common missed spots to check if errors appear:
- `packages/core/src/index.ts` — if it re-exports renamed types
- Any `opencode` operation that wasn't caught by the grep in Task 3
- The worker registry where `CreateWorkspacePhaseHandler` is constructed — it now needs `baseDir` passed in constructor deps
