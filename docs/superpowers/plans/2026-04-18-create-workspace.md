# createWorkspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `createWorkspace` operation to `@journeyman/coding-cli` that makes a fresh directory named `<ticketId>-<ISO-timestamp>` inside a caller-supplied `parentDir`, returning the folder name and absolute path.

**Architecture:** Pure Node (`fs.mkdir`) — no Claude Agent SDK, same rationale as `cleanupRepos`. Types added to `@journeyman/core` (`git.types.ts`). `ClaudeProvider` delegates to the op; `GeminiProvider` and `CodexProvider` add throwing stubs.

**Tech Stack:** TypeScript, Node `fs/promises`, npm workspaces.

---

## File Structure

- **Modify** `packages/core/src/types/git.types.ts` — add `CreateWorkspaceOptions`, `CreateWorkspaceResult`.
- **Modify** `packages/core/src/interfaces/coding-cli.interface.ts` — add `createWorkspace` method + type imports.
- **Create** `packages/coding-cli/src/providers/claude/operations/create-workspace.ts` — op implementation + manual test script.
- **Modify** `packages/coding-cli/src/providers/claude/index.ts` — wire `createWorkspace` into `ClaudeProvider`.
- **Modify** `packages/coding-cli/src/providers/gemini/index.ts` — throwing stub.
- **Modify** `packages/coding-cli/src/providers/codex/index.ts` — throwing stub.
- **Modify** `CLAUDE.md` — add `ClaudeProvider.createWorkspace` row to the Implementation Status table.

No test framework is set up in this monorepo — follow the existing convention of a bottom-of-file manual test script executed via `npx tsx`.

---

### Task 1: Add types to `@journeyman/core`

**Files:**
- Modify: `packages/core/src/types/git.types.ts` (append after `CleanupReposResult`, before the `// Git platform API types` divider)

- [ ] **Step 1: Add the two new types**

Open `packages/core/src/types/git.types.ts` and insert after the existing `CleanupReposResult` block, before the `// ---------------------------------------------------------------------------` divider for `// Git platform API types`:

```typescript
export type CreateWorkspaceOptions = SessionOptions & {
  ticketId: string;
  parentDir: string;
};

export type CreateWorkspaceResult = SessionResult & {
  folderName: string;
  dirPath: string;
  error?: string;
};
```

- [ ] **Step 2: Typecheck the core package**

Run: `npm run typecheck -w @journeyman/core`
Expected: exits 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types/git.types.ts
git commit -m "feat(core): add CreateWorkspace types for workspace creation op"
```

---

### Task 2: Add `createWorkspace` to `ICodingCLI`

**Files:**
- Modify: `packages/core/src/interfaces/coding-cli.interface.ts`

- [ ] **Step 1: Add types to the import block**

In the first import block (types from `../types/git.types.ts`), add `CreateWorkspaceOptions, CreateWorkspaceResult,` on a new line before the closing brace. The block should look like:

```typescript
import type {
  CloneReposOptions, CloneReposResult,
  ScanReposOptions, ScanReposResult,
  ResetReposOptions, ResetReposResult,
  CommitPushReposOptions, CommitPushReposResult,
  CleanupReposOptions, CleanupReposResult,
  CreateWorkspaceOptions, CreateWorkspaceResult,
} from "../types/git.types.ts";
```

- [ ] **Step 2: Add the interface method**

Inside `ICodingCLI`, in the "Git operations" section, immediately after `cleanupRepos`, add:

```typescript
  createWorkspace(opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult>;
```

- [ ] **Step 3: Typecheck core**

Run: `npm run typecheck -w @journeyman/core`
Expected: exits 0.

(Other packages will temporarily fail because providers don't implement `createWorkspace` yet — that's expected and fixed in Tasks 4–5. Do NOT run the full workspace typecheck.)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/interfaces/coding-cli.interface.ts
git commit -m "feat(core): add createWorkspace to ICodingCLI contract"
```

---

### Task 3: Implement the `createWorkspace` operation

**Files:**
- Create: `packages/coding-cli/src/providers/claude/operations/create-workspace.ts`

- [ ] **Step 1: Write the full operation file**

Create `packages/coding-cli/src/providers/claude/operations/create-workspace.ts` with this exact content:

```typescript
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveSession } from "../utils/session.ts";
import type {
  CreateWorkspaceOptions,
  CreateWorkspaceResult,
} from "@journeyman/core";

export type { CreateWorkspaceOptions, CreateWorkspaceResult };

function buildTimestamp(now: Date = new Date()): string {
  // "2026-04-18T14:30:22.123Z" -> "2026-04-18T14-30-22Z"
  return now.toISOString().slice(0, 19).replace(/:/g, "-") + "Z";
}

/**
 * Creates a fresh directory for a ticket/flow under `parentDir`, named
 * `<ticketId>-<ISO-timestamp>` (e.g. "PROJ-123-2026-04-18T14-30-22Z").
 *
 * The parent directory is created recursively if missing. If the target
 * directory already exists (unlikely — collisions require two calls in the
 * same second for the same ticket), it is silently reused.
 *
 * Returns per-call success with folderName + absolute dirPath. On failure
 * the error field is populated — never throws.
 *
 * @example
 * ```ts
 * const result = await createWorkspace({
 *   ticketId: "PROJ-123",
 *   parentDir: "/tmp/journeyman-workspace",
 * });
 * // result.dirPath === "/tmp/journeyman-workspace/PROJ-123-2026-04-18T14-30-22Z"
 * ```
 */
export async function createWorkspace(
  opts: CreateWorkspaceOptions
): Promise<CreateWorkspaceResult> {
  const { sessionId } = resolveSession(opts.sessionId);

  if (!opts.ticketId) {
    return { folderName: "", dirPath: "", error: "ticketId is required", sessionId };
  }
  if (!opts.parentDir) {
    return { folderName: "", dirPath: "", error: "parentDir is required", sessionId };
  }

  const folderName = `${opts.ticketId}-${buildTimestamp()}`;
  const dirPath = resolve(opts.parentDir, folderName);

  try {
    await mkdir(dirPath, { recursive: true });
    return { folderName, dirPath, sessionId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { folderName, dirPath, error: message, sessionId };
  }
}

// Run: npx tsx create-workspace.ts
const result = await createWorkspace({
  ticketId: "PROJ-123",
  parentDir: "/tmp/journeyman-workspace",
});

console.log(JSON.stringify(result, null, 2));
```

- [ ] **Step 2: Typecheck coding-cli**

Run: `npm run typecheck -w @journeyman/coding-cli`
Expected: errors ONLY about `ClaudeProvider`/`GeminiProvider`/`CodexProvider` not implementing `createWorkspace` (fixed in Tasks 4–5). If there is ANY other error involving `create-workspace.ts` itself, fix it and re-run.

(If the worktree has never been installed, run `npm install` at the worktree root first so `@journeyman/core` symlinks resolve locally.)

- [ ] **Step 3: Manual smoke test**

```bash
rm -rf /tmp/journeyman-workspace
npx tsx packages/coding-cli/src/providers/claude/operations/create-workspace.ts
```

Expected JSON output:
- `folderName` matches regex `^PROJ-123-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$`
- `dirPath` is an absolute path under `/tmp/journeyman-workspace/`
- no `error` field
- `sessionId` present

Confirm the directory exists:

```bash
ls -la /tmp/journeyman-workspace/
```

Expected: one `PROJ-123-...Z` directory.

- [ ] **Step 4: Validation tests**

Temporarily change the script at the bottom to test missing `ticketId`:

```typescript
const result = await createWorkspace({
  ticketId: "",
  parentDir: "/tmp/journeyman-workspace",
});
```

Run it — expected: `error: "ticketId is required"`.

Then test missing `parentDir`:

```typescript
const result = await createWorkspace({
  ticketId: "PROJ-123",
  parentDir: "",
});
```

Run it — expected: `error: "parentDir is required"`.

**Revert** the script at the bottom to the original (`ticketId: "PROJ-123", parentDir: "/tmp/journeyman-workspace"`) before committing.

- [ ] **Step 5: Recursive-parent test**

```bash
rm -rf /tmp/journeyman-nested
```

Temporarily change `parentDir` to `/tmp/journeyman-nested/inner/deep` and run. Expected: success, directory exists at that nested path. Then **revert** `parentDir` back to `/tmp/journeyman-workspace`.

- [ ] **Step 6: Commit**

```bash
git add packages/coding-cli/src/providers/claude/operations/create-workspace.ts
git commit -m "feat(coding-cli): implement createWorkspace operation"
```

---

### Task 4: Wire `createWorkspace` into `ClaudeProvider`

**Files:**
- Modify: `packages/coding-cli/src/providers/claude/index.ts`

- [ ] **Step 1: Import the types**

Add `CreateWorkspaceOptions, CreateWorkspaceResult,` to the `@journeyman/core` type-import block (alongside `CleanupReposOptions, CleanupReposResult,`).

- [ ] **Step 2: Import the op**

Add next to the other operation imports (e.g., after `cleanupRepos`):

```typescript
import { createWorkspace } from "./operations/create-workspace.ts";
```

- [ ] **Step 3: Add the method**

Inside `ClaudeProvider`, in the "Git CLI operations" section immediately after `cleanupRepos`, add:

```typescript
  createWorkspace(opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> {
    return createWorkspace(opts);
  }
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w @journeyman/coding-cli`
Expected: remaining errors only on `GeminiProvider` and `CodexProvider` missing `createWorkspace` (Task 5).

- [ ] **Step 5: Commit**

```bash
git add packages/coding-cli/src/providers/claude/index.ts
git commit -m "feat(coding-cli): wire createWorkspace into ClaudeProvider"
```

---

### Task 5: Add stubs to `GeminiProvider` and `CodexProvider`

**Files:**
- Modify: `packages/coding-cli/src/providers/gemini/index.ts`
- Modify: `packages/coding-cli/src/providers/codex/index.ts`

- [ ] **Step 1: Gemini — add types to import**

Add `CreateWorkspaceOptions, CreateWorkspaceResult,` to the existing type-import list in `packages/coding-cli/src/providers/gemini/index.ts`.

- [ ] **Step 2: Gemini — add stub method**

Inside `GeminiProvider`, after `cleanupRepos`, add:

```typescript
  createWorkspace(_opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> { throw new Error("GeminiProvider.createWorkspace not implemented"); }
```

- [ ] **Step 3: Codex — add types to import**

Add `CreateWorkspaceOptions, CreateWorkspaceResult,` to the single-line type-import list in `packages/coding-cli/src/providers/codex/index.ts`.

- [ ] **Step 4: Codex — add stub method**

Inside `CodexProvider`, after `cleanupRepos`, add:

```typescript
  createWorkspace(_opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> { throw new Error("CodexProvider.createWorkspace not implemented"); }
```

- [ ] **Step 5: Full workspace typecheck**

Run: `npm run typecheck`
Expected: exits 0 across all packages.

- [ ] **Step 6: Commit**

```bash
git add packages/coding-cli/src/providers/gemini/index.ts packages/coding-cli/src/providers/codex/index.ts
git commit -m "feat(coding-cli): add createWorkspace stubs to Gemini and Codex providers"
```

---

### Task 6: Update `CLAUDE.md` Implementation Status table

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the row**

Find the "Implementation Status" table. Insert a new row immediately after `| ClaudeProvider.cleanupRepos | Implemented |`:

```markdown
| `ClaudeProvider.createWorkspace` | Implemented |
```

(Gemini and Codex remain tracked at the class level — no new rows needed.)

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: mark ClaudeProvider.createWorkspace as implemented"
```

---

## Self-Review Summary

- **Spec coverage:** types (Task 1), interface (Task 2), implementation with validation + recursive mkdir + timestamp format (Task 3), provider wiring (Tasks 4–5), docs (Task 6). All spec sections covered.
- **Placeholder scan:** no TBDs; every code block is complete and copy-pasteable.
- **Type consistency:** `CreateWorkspaceOptions` / `CreateWorkspaceResult` used identically across all tasks. `createWorkspace` method signature matches across interface, ClaudeProvider, Gemini stub, Codex stub.
- **Timestamp derivation:** single location (`buildTimestamp` in Task 3), spec rules encoded in the code — no drift risk.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-18-create-workspace.md`. Two execution options:

1. **Subagent-Driven (recommended)** — fresh subagent per task with review between tasks.
2. **Inline Execution** — execute tasks in this session using executing-plans with checkpoints.

Which approach?
