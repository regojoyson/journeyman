# cleanupRepos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `cleanupRepos` operation to `@journeyman/coding-cli` that deletes repo directories (`rm -rf`) so each flow/ticket can start from a fresh workspace.

**Architecture:** New op uses pure Node `fs.rm` (no Claude Agent SDK — deletion is deterministic). Types are added to `@journeyman/core` (`git.types.ts`, matching the location of `ResetReposOptions`). `ClaudeProvider` delegates to the op; `GeminiProvider` and `CodexProvider` add stubs that throw.

**Tech Stack:** TypeScript, Node `fs/promises`, npm workspaces.

---

## File Structure

- **Modify** `packages/core/src/types/git.types.ts` — add `CleanupEntry`, `CleanupReposOptions`, `CleanupRepoResult`, `CleanupReposResult`.
- **Modify** `packages/core/src/interfaces/coding-cli.interface.ts` — add `cleanupRepos` method, import new types.
- **Create** `packages/coding-cli/src/providers/claude/operations/cleanup-repos.ts` — op implementation + manual test script.
- **Modify** `packages/coding-cli/src/providers/claude/index.ts` — wire `cleanupRepos` into `ClaudeProvider`.
- **Modify** `packages/coding-cli/src/providers/gemini/index.ts` — add throwing stub.
- **Modify** `packages/coding-cli/src/providers/codex/index.ts` — add throwing stub.
- **Modify** `CLAUDE.md` — add `cleanupRepos` row to Implementation Status table.

No test framework is set up in this monorepo (the other ops use bottom-of-file manual test scripts). Follow that convention — manual verification via `npx tsx`.

---

### Task 1: Add cleanup types to `@journeyman/core`

**Files:**
- Modify: `packages/core/src/types/git.types.ts` (append after `ResetReposResult`, before the `// Git platform API types` divider comment)

- [ ] **Step 1: Add the four cleanup types**

Open `packages/core/src/types/git.types.ts` and insert after the existing `ResetReposResult` block (currently ending at line 62), before the `// ---` divider:

```typescript
export type CleanupEntry = {
  dirPath: string;
};

export type CleanupReposOptions = SessionOptions & {
  repos: string | string[] | CleanupEntry | CleanupEntry[];
};

export type CleanupRepoResult = {
  folderName: string;
  dirPath: string;
  success: boolean;
  error?: string;
};

export type CleanupReposResult = SessionResult & {
  repos: CleanupRepoResult[];
  error?: string;
};
```

- [ ] **Step 2: Typecheck the core package**

Run: `npm run typecheck -w @journeyman/core`
Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types/git.types.ts
git commit -m "feat(core): add CleanupRepos types for repo cleanup operation"
```

---

### Task 2: Add `cleanupRepos` to `ICodingCLI`

**Files:**
- Modify: `packages/core/src/interfaces/coding-cli.interface.ts`

- [ ] **Step 1: Import the new types**

Change the first import block so `CleanupReposOptions, CleanupReposResult` are imported alongside the other git types:

```typescript
import type {
  CloneReposOptions, CloneReposResult,
  ScanReposOptions, ScanReposResult,
  ResetReposOptions, ResetReposResult,
  CommitPushReposOptions, CommitPushReposResult,
  CleanupReposOptions, CleanupReposResult,
} from "../types/git.types.ts";
```

- [ ] **Step 2: Add the interface method**

Inside `ICodingCLI`, in the "Git operations" section (after `commitPushRepos`), add:

```typescript
  cleanupRepos(opts: CleanupReposOptions): Promise<CleanupReposResult>;
```

- [ ] **Step 3: Typecheck core**

Run: `npm run typecheck -w @journeyman/core`
Expected: exits 0.

(The coding-cli package will now fail typecheck because its provider classes don't implement `cleanupRepos` yet — that's expected and will be fixed in Tasks 3–5.)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/interfaces/coding-cli.interface.ts
git commit -m "feat(core): add cleanupRepos to ICodingCLI contract"
```

---

### Task 3: Implement the `cleanupRepos` operation

**Files:**
- Create: `packages/coding-cli/src/providers/claude/operations/cleanup-repos.ts`

- [ ] **Step 1: Write the full operation file**

Create `packages/coding-cli/src/providers/claude/operations/cleanup-repos.ts` with this complete content:

```typescript
import { rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { resolveSession } from "../utils/session.ts";
import type {
  CleanupEntry,
  CleanupReposOptions,
  CleanupReposResult,
  CleanupRepoResult,
} from "@journeyman/core";

export type { CleanupEntry, CleanupReposOptions, CleanupReposResult, CleanupRepoResult };

function normalizeEntries(opts: CleanupReposOptions): CleanupEntry[] {
  const raw = Array.isArray(opts.repos) ? opts.repos : [opts.repos];
  return raw.map((r) => (typeof r === "string" ? { dirPath: r } : r));
}

function unsafeReason(absPath: string): string | null {
  if (!absPath) return "empty path";
  if (absPath === "/") return "refusing to delete filesystem root";
  if (absPath === process.env.HOME) return "refusing to delete user home";
  if (absPath === process.cwd()) return "refusing to delete current working directory";
  return null;
}

async function cleanupOne(entry: CleanupEntry): Promise<CleanupRepoResult> {
  const absPath = resolve(entry.dirPath);
  const folderName = basename(absPath);

  const refusal = unsafeReason(absPath);
  if (refusal) {
    return { folderName, dirPath: absPath, success: false, error: refusal };
  }

  try {
    await rm(absPath, { recursive: true, force: true });
    return { folderName, dirPath: absPath, success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { folderName, dirPath: absPath, success: false, error: message };
  }
}

/**
 * Deletes each target directory entirely (recursive, force). Use as the final
 * step of a flow/ticket so the next run starts from a fresh workspace.
 *
 * Idempotent: missing paths are reported as success. Refuses to delete `/`,
 * `$HOME`, or `process.cwd()` — those entries return success=false with an
 * explanatory error, while other entries still run.
 *
 * @param opts - Repos to delete. Strings are treated as dirPaths.
 * @returns A CleanupReposResult with per-repo success/error details.
 *
 * @example
 * ```ts
 * const result = await cleanupRepos({
 *   repos: ["/tmp/workspace/ticket-123/api", "/tmp/workspace/ticket-123/web"],
 * });
 * ```
 */
export async function cleanupRepos(opts: CleanupReposOptions): Promise<CleanupReposResult> {
  const entries = normalizeEntries(opts);
  const { sessionId } = resolveSession(opts.sessionId);
  const repos = await Promise.all(entries.map(cleanupOne));
  return { repos, sessionId };
}

// Run: npx tsx cleanup-repos.ts
const result = await cleanupRepos({
  repos: [
    "/tmp/journeyman-cleanup-test-a",
    "/tmp/journeyman-cleanup-test-b",
  ],
});

console.log(JSON.stringify(result, null, 2));
```

- [ ] **Step 2: Verify `resolveSession` shape matches the import**

Open `packages/coding-cli/src/providers/claude/utils/session.ts` and confirm it exports `resolveSession` returning an object with at least `{ sessionId }`. If the destructure shape differs, adjust the import in `cleanup-repos.ts` to match — e.g. `const { sessionId } = resolveSession(opts.sessionId);` is equivalent to how `reset-repos.ts` uses it (see `packages/coding-cli/src/providers/claude/operations/reset-repos.ts:77`).

Expected: no change needed; `reset-repos.ts` uses the same destructure.

- [ ] **Step 3: Typecheck coding-cli**

Run: `npm run typecheck -w @journeyman/coding-cli`
Expected: the only remaining errors are `ClaudeProvider`, `GeminiProvider`, `CodexProvider` missing `cleanupRepos` — to be fixed in Tasks 4 and 5. If you see any OTHER error in `cleanup-repos.ts` itself, fix it before moving on.

- [ ] **Step 4: Manual smoke test**

Set up two empty dirs and run the script:

```bash
mkdir -p /tmp/journeyman-cleanup-test-a /tmp/journeyman-cleanup-test-b
touch /tmp/journeyman-cleanup-test-a/file.txt
npx tsx packages/coding-cli/src/providers/claude/operations/cleanup-repos.ts
```

Expected: JSON output shows both entries with `success: true`. Confirm:

```bash
ls /tmp/journeyman-cleanup-test-a /tmp/journeyman-cleanup-test-b 2>&1
```

Expected: "No such file or directory" for both.

- [ ] **Step 5: Manual idempotency test**

Re-run the same script (the dirs are already gone):

```bash
npx tsx packages/coding-cli/src/providers/claude/operations/cleanup-repos.ts
```

Expected: both entries still `success: true` (force:true treats missing as ok).

- [ ] **Step 6: Manual safety test**

Temporarily change the manual script at the bottom to include `"/"`:

```typescript
const result = await cleanupRepos({
  repos: ["/"],
});
```

Run: `npx tsx packages/coding-cli/src/providers/claude/operations/cleanup-repos.ts`
Expected: `success: false, error: "refusing to delete filesystem root"`.

Then **revert** the manual script back to the original two `/tmp/journeyman-cleanup-test-*` entries before committing.

- [ ] **Step 7: Commit**

```bash
git add packages/coding-cli/src/providers/claude/operations/cleanup-repos.ts
git commit -m "feat(coding-cli): implement cleanupRepos operation"
```

---

### Task 4: Wire `cleanupRepos` into `ClaudeProvider`

**Files:**
- Modify: `packages/coding-cli/src/providers/claude/index.ts`

- [ ] **Step 1: Import the op and its types**

Add to the type import block (alongside `CommitPushReposOptions, CommitPushReposResult`):

```typescript
  CleanupReposOptions, CleanupReposResult,
```

Add to the runtime imports (next to `commitPushRepos`):

```typescript
import { cleanupRepos } from "./operations/cleanup-repos.ts";
```

- [ ] **Step 2: Add the method**

In `ClaudeProvider`, in the "Git CLI operations" section directly after `commitPushRepos`, add:

```typescript
  cleanupRepos(opts: CleanupReposOptions): Promise<CleanupReposResult> {
    return cleanupRepos(opts);
  }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w @journeyman/coding-cli`
Expected: remaining errors only on `GeminiProvider` and `CodexProvider` (Task 5).

- [ ] **Step 4: Commit**

```bash
git add packages/coding-cli/src/providers/claude/index.ts
git commit -m "feat(coding-cli): wire cleanupRepos into ClaudeProvider"
```

---

### Task 5: Add stubs to `GeminiProvider` and `CodexProvider`

**Files:**
- Modify: `packages/coding-cli/src/providers/gemini/index.ts`
- Modify: `packages/coding-cli/src/providers/codex/index.ts`

- [ ] **Step 1: Gemini — import the types**

In `packages/coding-cli/src/providers/gemini/index.ts`, add `CleanupReposOptions, CleanupReposResult,` to the existing type-import list (alongside `CommitPushReposOptions, CommitPushReposResult,`).

- [ ] **Step 2: Gemini — add the stub method**

Inside `GeminiProvider`, after `commitPushRepos`, add:

```typescript
  cleanupRepos(_opts: CleanupReposOptions): Promise<CleanupReposResult> { throw new Error("GeminiProvider.cleanupRepos not implemented"); }
```

- [ ] **Step 3: Codex — import the types**

In `packages/coding-cli/src/providers/codex/index.ts`, add `CleanupReposOptions, CleanupReposResult,` to the single-line type-import list.

- [ ] **Step 4: Codex — add the stub method**

Inside `CodexProvider`, after `commitPushRepos`, add:

```typescript
  cleanupRepos(_opts: CleanupReposOptions): Promise<CleanupReposResult> { throw new Error("CodexProvider.cleanupRepos not implemented"); }
```

- [ ] **Step 5: Typecheck everything**

Run: `npm run typecheck`
Expected: exits 0 across all packages.

- [ ] **Step 6: Commit**

```bash
git add packages/coding-cli/src/providers/gemini/index.ts packages/coding-cli/src/providers/codex/index.ts
git commit -m "feat(coding-cli): add cleanupRepos stubs to Gemini and Codex providers"
```

---

### Task 6: Update `CLAUDE.md` Implementation Status table

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the new row**

Find the "Implementation Status" table. Add a row for `ClaudeProvider.cleanupRepos` immediately after the `ClaudeProvider.commitPushRepos` row:

```markdown
| `ClaudeProvider.cleanupRepos` | Implemented |
```

(Gemini and Codex remain tracked at the class level via the existing `GeminiProvider` / `CodexProvider` rows — no new rows needed.)

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: mark ClaudeProvider.cleanupRepos as implemented"
```

---

## Self-Review Summary

- **Spec coverage:** interface change (Task 2), types (Task 1), implementation with safety guards (Task 3), provider wiring (Tasks 4–5), docs (Task 6). All spec sections covered.
- **Placeholder scan:** no TBDs; every code block is complete and copy-pasteable.
- **Type consistency:** `CleanupEntry`, `CleanupReposOptions`, `CleanupRepoResult`, `CleanupReposResult` used identically across all tasks. `cleanupRepos` signature matches the interface in every provider.
- **Note:** spec originally placed the new types in `coding.types.ts`, but they belong in `git.types.ts` (that's where `ResetReposOptions` etc. live — this was a spec slip, corrected in this plan).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-18-cleanup-repos.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
