# commitPushRepos — Design

**Date:** 2026-04-18
**Package:** `@journeyman/coding-cli`
**Status:** Design approved, pending implementation plan

## Goal

Add a new operation to `ICodingCLI` that, for one or more local git repos, detects uncommitted changes, generates a commit message via the Claude Agent SDK (or accepts an override), commits, pushes to the current branch, and returns metadata suitable for downstream PR creation.

## Placement

- Interface method added to `packages/core/src/interfaces/coding-cli.interface.ts`
- Types added to `packages/core/src/types/git.types.ts`
- Implementation lives in `packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts`
- Wired into `ClaudeProvider` in `packages/coding-cli/src/providers/claude/index.ts`
- `GeminiProvider` and `CodexProvider` get stubs that throw `not implemented`

## Types

```ts
export type CommitPushEntry = {
  dirPath: string;
  ticket?: string;          // per-repo override of top-level ticket
  message?: string;         // full commit message; skips AI generation
};

export type CommitPushReposOptions = {
  repos: string | string[] | CommitPushEntry | CommitPushEntry[];
  ticket?: string;                         // default ticket applied to all entries
  pattern?: string;                        // default: "{ticket} : {summary}"
  prSummaryStyle?: "brief" | "detailed";   // default: "detailed"
};

export type CommitPushResult = {
  folderName: string;
  dirPath: string;
  branch: string;           // current branch (committed + pushed to)
  commitSha: string;        // new HEAD SHA
  commitMessage: string;    // final message used for git commit
  title: string;            // PR/MR title — e.g. "EV-123: Fix header alignment"
  description: string;      // PR/MR body — summary of code changes (markdown)
  filesChanged: string[];
  pushed: boolean;
  remoteUrl?: string;       // origin URL — useful for owner/repo parsing
  error?: string;
};

export type CommitPushReposResult = {
  repos: CommitPushResult[];
  error?: string;
};
```

## Interface addition

```ts
export interface ICodingCLI {
  // ...existing members
  commitPushRepos(opts: CommitPushReposOptions): Promise<CommitPushReposResult>;
}
```

## Behavior

### Pattern resolution

- Default pattern: `"{ticket} : {summary}"`
- Tokens: `{ticket}`, `{summary}`
- Ticket resolution per entry: `entry.ticket ?? opts.ticket`
- If no ticket resolved and pattern contains `{ticket}`, collapse to `{summary}` (strip the ticket-prefix portion cleanly — no dangling `" : "`)
- If `entry.message` is supplied, it is used verbatim; `pattern`, `ticket`, and AI `{summary}` are all ignored for that entry

### Per-repo flow (inside a single `query()` call)

The operation dispatches one Claude Agent SDK `query()` that instructs the agent to process all repos, using Bash for git commands. Steps per repo:

1. `git -C <dir> status --porcelain` — if empty, record `error: "no changes"` and skip remaining steps for that repo
2. `git -C <dir> rev-parse --abbrev-ref HEAD` — capture `branch`
3. `git -C <dir> diff --cached --name-only && git -C <dir> diff --name-only` (combined list, unique) — capture `filesChanged`
4. If no override `message`: `git -C <dir> diff HEAD` → agent produces a concise `{summary}` (max ~72 chars, imperative mood)
5. Apply pattern to build final commit message
6. `git -C <dir> add -A`
7. `git -C <dir> commit -m "<message>"`
8. `git -C <dir> rev-parse HEAD` — capture `commitSha`
9. `git -C <dir> push origin <branch>` — on success `pushed: true`
10. `git -C <dir> remote get-url origin` — capture `remoteUrl`
11. Derive PR-ready fields:
    - `title`: `<ticket>: <summary>` if ticket resolved, else just `<summary>`. Not the same as `commitMessage` — `commitMessage` follows `pattern` (which defaults to `{ticket} : {summary}` with spaces around the colon for git log readability), whereas `title` uses a single `": "` (PR convention).
    - `description`: agent-generated markdown summary of the code changes based on the same diff. `prSummaryStyle: "brief"` → one short paragraph. `prSummaryStyle: "detailed"` (default) → a short intro line + a bullet list of notable file-by-file changes.
12. Any failed step sets `error` on that repo's result; other repos continue

### Claude Agent SDK configuration

Follows project convention (see `CLAUDE.md`):

```ts
query({
  prompt: "...",
  options: {
    tools: ["Bash"],
    allowedTools: ["Bash"],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    settingSources: [],
    outputFormat: {
      type: "json_schema",
      schema: { /* CommitPushReposResult schema */ },
    },
  },
});
```

- Uses `logSdkMessage` from `providers/claude/utils/sdk-logger.ts` for every message
- On `result` success, returns `msg.structured_output as CommitPushReposResult`
- On `result` failure, throws `new Error(msg.result_text)`

## Input normalization

The `repos` field accepts four shapes (mirrors `cloneRepos` / `resetRepos`):

- `string` → `[{ dirPath: string }]`
- `string[]` → `[{ dirPath }, ...]`
- `CommitPushEntry` → `[entry]`
- `CommitPushEntry[]` → as-is

Normalization happens before entering `query()` so the prompt receives a uniform array.

## Error semantics

- Per-repo errors are recorded on `CommitPushResult.error`; loop continues
- Top-level `CommitPushReposResult.error` is set only for failures before any repo is processed (e.g., invalid input, SDK init failure)
- "No changes" is treated as a per-repo error string `"no changes"` and not thrown — caller can filter

## Downstream PR creation

Consumers feed the result directly into `IGitProvider.createPR`:

```ts
const { repos } = await claude.commitPushRepos({ repos: dirs, ticket: "EV-123" });
for (const r of repos.filter(x => x.pushed)) {
  const { owner, repo } = parseOriginUrl(r.remoteUrl!);
  await github.createPR({
    owner, repo,
    title: r.title,
    body: r.description,
    sourceBranch: r.branch,
    targetBranch: "main",
  });
}
```

Origin-URL parsing is the caller's / git-provider's responsibility — not in scope here.

## Out of scope

- Creating or switching branches (separate function)
- Opening PRs (handled by `@journeyman/git-provider`)
- Signed commits / GPG configuration
- Pre-commit hook management (runs whatever hooks the repo has)
- Retry on push conflict

## Implementation status after this work

| Provider | `commitPushRepos` |
|---|---|
| `ClaudeProvider` | Implemented |
| `GeminiProvider` | Stub (throws) |
| `CodexProvider` | Stub (throws) |
