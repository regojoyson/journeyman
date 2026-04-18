# cleanupRepos — Design

## Goal

Add a final-step operation to `@journeyman/coding-cli` that deletes repo directories created during a flow/ticket, so each new flow starts from a clean workspace.

## Scope

- New operation `cleanupRepos` on `ICodingCLI`, implemented by `ClaudeProvider`.
- `GeminiProvider` and `CodexProvider` add a stub that throws `"<Class>.cleanupRepos not implemented"`.
- Semantics: fully remove each target directory (`rm -rf <dirPath>`). The directory itself is deleted, not just its contents.

## Non-goals

- Re-cloning after delete (use `cloneRepos` separately).
- Trash/recycle-bin behavior — deletion is permanent.
- Remote cleanup (branches, PRs) — out of scope.

## Interface — `@journeyman/core`

Add to `packages/core/src/types/coding.types.ts`:

```ts
export interface CleanupEntry {
  dirPath: string;
}

export interface CleanupReposOptions {
  repos: string | string[] | CleanupEntry | CleanupEntry[];
  sessionId?: string;
}

export interface CleanupRepoResult {
  folderName: string;
  dirPath: string;
  success: boolean;
  error?: string;
}

export interface CleanupReposResult {
  repos: CleanupRepoResult[];
  error?: string;
  sessionId?: string;
}
```

Add to `ICodingCLI`:

```ts
cleanupRepos(opts: CleanupReposOptions): Promise<CleanupReposResult>;
```

## Implementation — `@journeyman/coding-cli`

### File

`packages/coding-cli/src/providers/claude/operations/cleanup-repos.ts`

### Approach

Pure Node (`fs.rm`). No Claude Agent SDK `query()` — deletion is deterministic, does not need an LLM, and avoids token cost.

### Algorithm

1. Normalize `opts.repos` into `CleanupEntry[]` (mirrors `resetRepos.normalizeEntries`).
2. Resolve `sessionId` via `resolveSession(opts.sessionId)` so the op participates in session threading consistently with other ops.
3. For each entry:
   - Resolve `dirPath` to an absolute path with `path.resolve`.
   - Run safety check (see below). On refusal, record `{ success: false, error: "<reason>" }` and continue.
   - Compute `folderName = path.basename(absPath)`.
   - `await fs.rm(absPath, { recursive: true, force: true })`.
   - On success: `{ folderName, dirPath: absPath, success: true }`.
   - On exception: `{ folderName, dirPath: absPath, success: false, error: err.message }`.
4. Return `{ repos: results, sessionId }`.

`fs.rm` with `force: true` treats missing paths as success — acceptable here, as "already gone" equals "cleaned up".

### Safety guard

Refuse to delete if the resolved absolute path is any of:

- Empty string.
- `/` (filesystem root).
- `process.env.HOME` (user home).
- `process.cwd()` (current working directory).

Refusal produces `{ success: false, error: "refused to delete unsafe path: <path>" }` — no exception thrown, flow continues for other repos.

### Wiring

- Export `cleanupRepos` and its types from `packages/coding-cli/src/providers/claude/operations/cleanup-repos.ts`.
- Add `cleanupRepos` method to `ClaudeProvider` (`packages/coding-cli/src/providers/claude/index.ts`) that delegates to the op.
- Add stub `cleanupRepos` method to `GeminiProvider` and `CodexProvider` that throws `"<ClassName>.cleanupRepos not implemented"`.
- Re-export new types from `packages/core/src/index.ts` if that package re-exports the other coding types (match existing pattern).

## Error handling

- Per-repo errors are captured into the result, never thrown, so a failure on one repo does not block the rest.
- The top-level `error` field on `CleanupReposResult` is reserved for catastrophic failures (e.g., input normalization throws). Normal per-repo failures use the per-entry `error` field.

## Testing

Manual script at the bottom of `cleanup-repos.ts` (matches the pattern in `reset-repos.ts`):

```ts
// Run: npx tsx cleanup-repos.ts
const result = await cleanupRepos({
  repos: [
    "/tmp/journeyman-test-a",
    "/tmp/journeyman-test-b",
  ],
});
console.log(JSON.stringify(result, null, 2));
```

Verification:

- Create two temp dirs, run the script, confirm both are deleted and `success: true`.
- Re-run — confirm `success: true` (idempotent via `force: true`).
- Pass `/` — confirm `success: false` with refusal error.

## Implementation Status (post-merge)

| Feature | Status |
|---|---|
| `ClaudeProvider.cleanupRepos` | Implemented |
| `GeminiProvider.cleanupRepos` | Stub |
| `CodexProvider.cleanupRepos` | Stub |

Update the table in `CLAUDE.md` accordingly.
