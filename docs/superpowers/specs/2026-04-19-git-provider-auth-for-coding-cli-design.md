# Re-home Clone + Checkout into `git-provider`; Auth Owned by `git-provider`

**Date:** 2026-04-19
**Status:** Approved for implementation
**Scope:** `@journeyman/core`, `@journeyman/git-provider`, `@journeyman/coding-cli`

## Problem

Two entangled issues:

1. **Auth.** `coding-cli.cloneRepos` and `coding-cli.commitPushRepos` shell out to system `git` and rely on host-level credentials (SSH keys, `~/.netrc`, credential helper). In a deployed multi-tenant service there are no host credentials for the customer products being cloned. Credentials-per-product already exist on `@journeyman/git-provider` (`GitHubProvider` accepts a PAT via `opts.token` / `GITHUB_ACCESS_TOKEN`) but are not surfaced to `coding-cli`.
2. **Wrong home.** `cloneRepos` in `coding-cli` drives `git clone` through the Claude Agent SDK even though the operation is fully deterministic — there is no AI reasoning. This burns SDK tokens and latency for no benefit. Checkout (branching from `main` to a feature branch before `implement`) has the same character and does not yet exist.

## Goal

- Move deterministic, non-AI git operations out of `coding-cli` and into `git-provider`. Specifically: **re-home `cloneRepos` into `git-provider`** and **add `checkoutBranch` to `git-provider`**.
- `git-provider` becomes the single owner of credentials; `coding-cli` no longer touches git auth for these ops.
- No host-level git credentials required — only the `git` binary.
- `commitPushRepos` stays in `coding-cli` (it genuinely needs the SDK for commit-message / PR-body generation from diffs), but works against clones produced by `git-provider.cloneRepos` with zero extra auth plumbing.

## Non-Goals

- Re-homing `resetRepos`, `cleanupRepos`, `createWorkspace`, `scanRepos`. They stay in `coding-cli` for now; can be revisited later.
- GitHub App installation-token minting (future; interface shape is forward-compatible via `async`).
- SSH URL support.
- GitLab / Bitbucket implementations (remain stubs).
- Replacing system `git` with a JS library (e.g. `isomorphic-git`).
- `checkoutBranch` fetching fresh base over the network. Checkout is local-only in this spec; callers who need a fresh base re-clone (ephemeral-workspace model).

## Design Overview

- `git-provider` gains two deterministic, local git operations: `cloneRepos` (uses node `child_process`, no SDK, no prompts) and `checkoutBranch`.
- Credential handling is internal to `git-provider` implementations. `cloneRepos` constructs a tokenized HTTPS URL (`https://x-access-token:<pat>@github.com/<owner>/<repo>.git`) from the provider's own token and hands it to `git`. The token is persisted in `.git/config` at clone time ("T1-keep") so later `push`/`fetch` on the same working tree need no further auth setup. This matches the existing ephemeral-workspace model (`cleanupRepos` wipes the dir and the token with it).
- `coding-cli.cloneRepos` is **deleted**. Callers switch to `gitProvider.cloneRepos(...)`.
- `coding-cli.commitPushRepos` is unchanged; it continues to work because the clone already wrote the credentialed remote URL into `.git/config`.
- A new `CodingCLI` method is **not** added for checkout — it belongs to `git-provider` because it's deterministic and local.

## Interface Changes — `@journeyman/core`

### New method signatures on `IGitProvider`

```ts
export interface IGitProvider {
  // existing
  getRepo(opts: GetRepoOptions): Promise<GetRepoResult>;
  createPR(opts: CreatePROptions): Promise<CreatePRResult>;
  listPRs(opts: ListPROptions): Promise<ListPRResult>;

  // new
  cloneRepos(opts: CloneReposOptions): Promise<CloneReposResult>;
  checkoutBranch(opts: CheckoutBranchOptions): Promise<CheckoutBranchResult>;
}
```

### `CloneReposOptions` / `CloneReposResult`

Move these types from their current home (currently exported from `@journeyman/core` and consumed by `coding-cli`) — they stay in `@journeyman/core` but lose the (planned) `git?: IGitProvider` field. Auth is implicit via the provider instance the caller is already holding.

```ts
export type RepoEntry = { url: string; branch: string };

export type CloneReposOptions = {
  repos: RepoEntry[] | string | RepoEntry;
  targetDir?: string;
  branch?: string;     // default "main", applied when repos is string(s)
  signal?: AbortSignal;
};

export type CloneReposResult = {
  repos: Array<{
    folderName: string;
    dirPath: string;
    url: string;        // always the ORIGINAL, non-tokenized URL
    branch: string;
    error?: string;
  }>;
  error?: string;
};
```

Note: `sessionId` drops out — there's no SDK session anymore.

### `CheckoutBranchOptions` / `CheckoutBranchResult`

```ts
export type CheckoutBranchOptions = {
  dirPath: string;         // existing working copy
  branch: string;          // target branch name, e.g. "feature/PROJ-123"
  fromBranch?: string;     // base ref; default: current HEAD
  create?: boolean;        // default: true — create if not already present
};

export type CheckoutBranchResult = {
  dirPath: string;
  branch: string;
  previousBranch: string;  // branch (or "HEAD" if detached) before checkout
  created: boolean;        // true if we ran `checkout -b`, false if switched to existing
  error?: string;
};
```

Export both option/result pairs from `packages/core/src/index.ts`.

## Provider Implementations — `@journeyman/git-provider`

### `GitHubProvider.cloneRepos`

Deterministic, no SDK. Uses `node:child_process` (`execFile` with an argv array — never a shell string).

Per repo:
1. Compute `cloneUrl` from `entry.url` + `this.token`:
   - Accept `https://github.com/<owner>/<repo>` or `...<repo>.git`. Always emit `.git`.
   - Reject non-`https://` URLs: `"GitHubProvider.cloneRepos: only https:// URLs supported, got <url>"`.
   - Reject hosts other than `github.com` (GHE host support is future work — add a TODO comment).
2. Compute `folderName` (basename of URL without `.git`) and `dirPath` (`<targetDir>/<folderName>`).
3. Run `git clone --branch <branch> --single-branch <cloneUrl> <dirPath>`.
4. On success: emit entry with original `url`, `branch`, `folderName`, `dirPath`.
5. On failure: same entry shape with an `error` string; continue with remaining repos.
6. Honor `opts.signal` — if aborted, kill in-flight `git` and return whatever repos were already done with an error for the aborted one.

Return the result. No top-level error unless something fails before any repo is attempted (e.g. `targetDir` cannot be created).

### `GitHubProvider.checkoutBranch`

Deterministic, no SDK, no network.

1. `git -C <dirPath> rev-parse --abbrev-ref HEAD` → `previousBranch` (or `"HEAD"` if detached).
2. Decide `created`:
   - `git -C <dirPath> rev-parse --verify <branch>` → if exit 0, branch exists.
   - If exists: `git -C <dirPath> checkout <branch>` (ignore `fromBranch`; warn in error field if `fromBranch` was set but branch already existed).
   - If not exists AND `create !== false`: `git -C <dirPath> checkout -b <branch> [<fromBranch>]`.
   - If not exists AND `create === false`: return error `"branch <branch> does not exist and create=false"`.
3. Return populated result.

### `GitLabProvider` — stubs

```ts
async cloneRepos(): Promise<CloneReposResult> {
  throw new Error("GitLabProvider.cloneRepos not implemented");
}
async checkoutBranch(): Promise<CheckoutBranchResult> {
  throw new Error("GitLabProvider.checkoutBranch not implemented");
}
```

## Changes to `@journeyman/coding-cli`

### Delete

- `packages/coding-cli/src/providers/claude/operations/clone-repos.ts`
- Any `cloneRepos` method on `ClaudeProvider` / `GeminiProvider` / `CodexProvider`.
- Any export of `cloneRepos` from `src/index.ts`.
- `CloneReposOptions`/`CloneReposResult`/`RepoEntry` re-exports from `coding-cli` (types still live in `@journeyman/core`; callers import from there).
- Remove `cloneRepos` from `ICodingCLI` in `@journeyman/core/src/interfaces/coding-cli.interface.ts`.

### Keep unchanged

- `commitPushRepos` — already writes to whatever remote the clone set up. Since `git-provider.cloneRepos` embedded the PAT in the clone URL, `git push origin <branch>` works without additional auth.
- `resetRepos`, `cleanupRepos`, `createWorkspace`, `scanRepos` — out of scope.

### Update `ICodingCLI`

Drop `cloneRepos` from the interface. Update the CLAUDE.md "Implementation Status" table accordingly in a follow-up doc commit (not part of this code change; tracked as a follow-up task in the implementation plan).

## Data Flow

```
caller
  ├─ const gh = new GitHubProvider({ token })     // holds PAT
  ├─ await gh.cloneRepos({ repos, targetDir })    // deterministic; token → .git/config
  ├─ (scan / analyze via coding-cli)
  ├─ await gh.checkoutBranch({ dirPath, branch: "feature/PROJ-123", fromBranch: "main" })
  ├─ (implement via coding-cli — edits files)
  ├─ await codingCli.commitPushRepos({ repos: [{ dirPath }], ticket })
  │       // `git push origin <branch>` uses the token already in .git/config
  └─ await codingCli.cleanupRepos(...)            // wipes workspace + token
```

## Security Considerations

- **PAT persisted in `.git/config`** of each clone for the life of the working tree. Mitigation: per-job ephemeral workspaces destroyed by `cleanupRepos`.
- **PAT visible in `ps`** during `git clone` (argv). Using `execFile` with argv does not change this — the token is an argument. Acceptable given single-tenant per-job worker. Out of scope to hide from same-host observers.
- **PAT not logged.** `git-provider.cloneRepos` must not log the `cloneUrl` (only the sanitized original `url`). Add a small helper in the provider so logs never receive the tokenized form.
- **PAT not in errors.** When a `git clone` fails, the provider currently would see `stderr` that could echo the URL. Scrub the token out of any error string before returning it: replace `x-access-token:<anything>@` with `x-access-token:***@`.

## Testing & Validation

- `npm run typecheck` across the workspace — green.
- `GitHubProvider.cloneRepos` smoke: clone a small public repo with a valid PAT, assert the cloned dir exists, `.git/config` contains a remote URL starting with `https://x-access-token:`, and the returned `result.repos[0].url` is the **original** (non-tokenized) URL.
- `GitHubProvider.cloneRepos` error path: invalid PAT → `result.repos[0].error` contains a useful message **without** the token substring.
- `GitHubProvider.checkoutBranch` smoke paths:
  - Branch does not exist, `create` default → `created: true`, `previousBranch` matches pre-checkout HEAD.
  - Branch exists → `created: false`.
  - `create: false` on non-existent branch → returns error.
- End-to-end smoke on a host with **no global git credentials**:
  1. `gh.cloneRepos({ repos: ["https://github.com/<private-repo>"], targetDir })`
  2. Edit a file.
  3. `gh.checkoutBranch({ dirPath, branch: "feature/test" })`
  4. `codingCli.commitPushRepos({ repos: [{ dirPath }], ticket: "TEST-1" })`
  5. Assert push succeeded.

## Open Questions / Future Work

- GitHub App installation tokens. `cloneRepos` is `async`, so a future impl can mint a short-lived token per clone.
- GHE host support — `GitHubProviderOptions.host`.
- Re-home `resetRepos` / `cleanupRepos` / `createWorkspace` to `git-provider` (they're also deterministic and local).
- Rename `@journeyman/git-provider` if it now owns both REST and local-git ops, e.g. split into `@journeyman/git-rest` and `@journeyman/git-cli`. Not in scope.
- PAT redaction layer shared across providers.
