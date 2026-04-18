# createWorkspace — Design

## Goal

Add an op to `@journeyman/coding-cli` that creates a fresh directory for a ticket/flow, named `<ticketId>-<ISO-timestamp>`, inside a caller-supplied parent. Returns the folder name and absolute path so later ops (clone, scan, cleanup) can use it.

## Scope

- New method `createWorkspace` on `ICodingCLI`, implemented by `ClaudeProvider`.
- `GeminiProvider` and `CodexProvider` add throwing stubs.
- Pure Node (`fs.mkdir`). No Claude Agent SDK — creation is deterministic, same rationale as `cleanupRepos`.

## Non-goals

- Cloning or populating the workspace — callers drive that separately.
- Garbage collection of old workspaces (use `cleanupRepos` at end of flow).
- Sanitizing `ticketId` characters — callers pass valid IDs (`PROJ-123`, `BUG-42`). YAGNI.

## Interface — `@journeyman/core`

Add to `packages/core/src/types/git.types.ts` (alongside `CleanupReposOptions`):

```ts
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

Add to `ICodingCLI` in the Git operations section:

```ts
createWorkspace(opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult>;
```

## Naming — timestamp format

ISO-8601 UTC with `:` replaced by `-` and fractional seconds dropped:

- Source: `new Date().toISOString()` → `"2026-04-18T14:30:22.123Z"`.
- Strip milliseconds: `slice(0, 19) + "Z"` → `"2026-04-18T14:30:22Z"`.
- Replace `:` → `-`: `"2026-04-18T14-30-22Z"`.

Final `folderName = \`${ticketId}-${timestamp}\`` — e.g. `PROJ-123-2026-04-18T14-30-22Z`.

## Implementation — `@journeyman/coding-cli`

**File:** `packages/coding-cli/src/providers/claude/operations/create-workspace.ts`

### Algorithm

1. Resolve session: `const { sessionId } = resolveSession(opts.sessionId);`
2. Validate:
   - If `!opts.ticketId` → return `{ folderName: "", dirPath: "", error: "ticketId is required", sessionId }`.
   - If `!opts.parentDir` → return `{ folderName: "", dirPath: "", error: "parentDir is required", sessionId }`.
3. Build timestamp (see above).
4. `folderName = \`${opts.ticketId}-${timestamp}\``.
5. `dirPath = path.resolve(opts.parentDir, folderName)`.
6. `await fs.mkdir(dirPath, { recursive: true })` — creates `parentDir` too if missing.
7. On success: `{ folderName, dirPath, sessionId }`.
8. On mkdir error: `{ folderName, dirPath, error: err.message, sessionId }`.

Per-call granularity is seconds; collisions are possible if the same ticket is invoked twice within one second. `recursive: true` suppresses `EEXIST`, so a second call that same second silently reuses the directory. Acceptable — two calls in the same second for the same ticket is not a real scenario.

### Wiring

- Export `createWorkspace` and its types from the op file.
- Add `createWorkspace` method to `ClaudeProvider` (`packages/coding-cli/src/providers/claude/index.ts`) delegating to the op.
- Add throwing stub `createWorkspace` to `GeminiProvider` and `CodexProvider`.

## Error handling

- Missing/invalid inputs → error field, never throw.
- `fs.mkdir` exceptions → error field on result, never throw.
- Consistent with `cleanupRepos` (errors reported, flow continues).

## Testing

Manual script at the bottom of the op file (matches project convention):

```ts
// Run: npx tsx create-workspace.ts
const result = await createWorkspace({
  ticketId: "PROJ-123",
  parentDir: "/tmp/journeyman-workspace",
});
console.log(JSON.stringify(result, null, 2));
```

Verification:

- Run once — confirm `folderName` matches `PROJ-123-YYYY-MM-DDTHH-MM-SSZ`, `dirPath` is absolute, and the dir exists (`ls -la <dirPath>`).
- Run with `ticketId: ""` — confirm `error: "ticketId is required"`.
- Run with `parentDir: ""` — confirm `error: "parentDir is required"`.
- Run with a `parentDir` under a non-existent root — confirm the parent is created (recursive).

## Implementation Status (post-merge)

| Feature | Status |
|---|---|
| `ClaudeProvider.createWorkspace` | Implemented |
| `GeminiProvider.createWorkspace` | Stub |
| `CodexProvider.createWorkspace` | Stub |

Update the `Implementation Status` table in `CLAUDE.md` accordingly.
