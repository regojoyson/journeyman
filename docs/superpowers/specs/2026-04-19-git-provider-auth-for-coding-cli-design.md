# Git-Provider–Driven Auth for `coding-cli` Clone & Push

**Date:** 2026-04-19
**Status:** Approved for implementation
**Scope:** `@journeyman/core`, `@journeyman/git-provider`, `@journeyman/coding-cli`

## Problem

`coding-cli` operations (`cloneRepos`, `commitPushRepos`) shell out to system `git`. They rely on whatever credentials happen to be configured on the host (SSH keys, `~/.netrc`, credential helper). In a deployed multi-tenant service this breaks: the host will not have credentials for the various customer products the service clones.

Credentials per product already exist inside `@journeyman/git-provider` (`GitHubProvider` accepts a PAT via `opts.token` or `GITHUB_ACCESS_TOKEN`). They are not currently surfaced to `coding-cli`.

## Goal

Let `coding-cli` clone and push against private repos using a `IGitProvider` instance for authentication, with **no credentials required on the host** beyond the `git` binary itself.

## Non-Goals

- GitHub App installation-token minting (future; interface shape is forward-compatible).
- SSH URL support.
- GitLab / Bitbucket implementations (providers remain stubs).
- Credential rotation during a running operation.
- Replacing system `git` with a JS library (e.g. `isomorphic-git`).

## Design Overview

`git-provider` owns auth. It exposes a new interface method that returns a ready-to-use tokenized HTTPS URL for a given repo URL. `coding-cli` operations optionally accept an `IGitProvider`; when present, they resolve each repo's URL through it before invoking `git`. The token is embedded in the HTTPS URL and persisted into `.git/config` at clone time ("T1-keep"), so subsequent `push`/`fetch` on the same working copy need no further setup. This assumes **ephemeral per-job workspaces** (which already match the existing `cleanupRepos` flow).

## Interface Change — `@journeyman/core`

New type (append to `packages/core/src/types/git.types.ts`):

```ts
export type GitAuth = {
  /** HTTPS URL with credentials embedded, usable directly as a `git clone` argument. */
  cloneUrl: string;
};
```

New method on `IGitProvider` (`packages/core/src/interfaces/git-provider.interface.ts`):

```ts
export interface IGitProvider {
  getRepo(opts: GetRepoOptions): Promise<GetRepoResult>;
  createPR(opts: CreatePROptions): Promise<CreatePRResult>;
  listPRs(opts: ListPROptions): Promise<ListPRResult>;
  getGitAuth(repoUrl: string): Promise<GitAuth>;
}
```

Re-export `GitAuth` from `packages/core/src/index.ts`.

## Provider Implementations

### `GitHubProvider.getGitAuth`

Pure string transform — no network call.

Input: `https://github.com/<owner>/<repo>` or `https://github.com/<owner>/<repo>.git`.
Output: `https://x-access-token:<pat>@github.com/<owner>/<repo>.git`.

Rules:
- Accept both with and without trailing `.git`; always emit with `.git`.
- Reject non-`https://` URLs with a clear error (`"GitHubProvider.getGitAuth: only https:// URLs supported, got <url>"`).
- Reject hosts other than `github.com` (and GitHub Enterprise host if configured — out of scope for this pass; leave a TODO).
- Token is the one already on the provider instance (`this.token`).

### `GitLabProvider.getGitAuth`

Stub:

```ts
async getGitAuth(): Promise<GitAuth> {
  throw new Error("GitLabProvider.getGitAuth not implemented");
}
```

## `coding-cli` Integration

### `CloneReposOptions`

Add an optional field (`packages/core/src/types/...` — wherever `CloneReposOptions` lives):

```ts
git?: IGitProvider;
```

### `cloneRepos` behavior

In `packages/coding-cli/src/providers/claude/operations/clone-repos.ts`:

1. After `normalizeEntries(opts)`, if `opts.git` is defined, map each entry:
   ```ts
   const resolved = await Promise.all(
     entries.map(async (e) => ({
       ...e,
       cloneUrl: (await opts.git!.getGitAuth(e.url)).cloneUrl,
     }))
   );
   ```
   If any `getGitAuth` call throws, fail the whole operation with that error (same shape as other early failures: `{ repos: [], error, sessionId }`).

2. `buildPrompt` uses `cloneUrl` (when present) in the `git clone` command, while the structured output still reports the **original** `url` for each repo entry (callers should see the clean URL, not the tokenized one).

3. When `opts.git` is absent, behavior is unchanged (falls back to system credentials).

### `commitPushRepos`

**No change.** With T1-keep, the tokenized URL is persisted in `.git/config` during clone, so `git push origin <branch>` just works. If a future caller clones by other means and still needs authenticated push, they can clone via `coding-cli` with `opts.git` set, or we add a `git?: IGitProvider` to `CommitPushReposOptions` in a follow-up.

### Other operations

`resetRepos`, `cleanupRepos`, `createWorkspace`, `scanRepos` — unchanged. They are either local-only or already credential-agnostic.

## Data Flow

```
caller
  └─ new GitHubProvider({ token })   ──►  holds PAT
  └─ cloneRepos({ repos, git })
        └─ for each repo: git.getGitAuth(url) ──► cloneUrl
        └─ prompt: `git clone <cloneUrl> <dir>/<name>`
        └─ SDK runs bash → git persists cloneUrl in .git/config
  └─ later: commitPushRepos({ repos: [{ dirPath }] })
        └─ prompt: `git push origin <branch>` (uses config URL, no extra auth)
  └─ cleanupRepos(...) wipes the working dir, taking the token with it.
```

## Security Considerations

- **PAT persisted in `.git/config`** inside each cloned working tree for the lifetime of that tree. Mitigation: the service runs in ephemeral, per-job workspaces that `cleanupRepos` destroys.
- **PAT visible in `ps` briefly** while `git clone` runs (argv). Acceptable given the deployment runs as a single-tenant worker per job; out-of-scope to hide from same-host observers.
- **PAT not logged.** `sdk-logger` logs SDK messages which include the tool call args. Audit `logSdkMessage` output in manual validation; redact the token in log output if it leaks (follow-up if needed).

## Testing & Validation

- `npm run typecheck` across the workspace — green.
- Unit-level smoke: call `GitHubProvider.getGitAuth("https://github.com/anthropics/anthropic-sdk-python")` and assert the returned `cloneUrl` matches `https://x-access-token:<pat>@github.com/anthropics/anthropic-sdk-python.git`.
- Integration smoke: with a real PAT, run `cloneRepos` against a private repo, then `commitPushRepos` against the cloned dir, and verify push succeeds on a host with **no git credentials configured globally**.
- Existing `if (import.meta.url === …)` example blocks in `clone-repos.ts` — extend with a commented example that shows passing `git: new GitHubProvider({ token })`.

## Open Questions / Future Work

- GitHub App installation tokens (short-lived; better blast radius). `getGitAuth` is `async` specifically so a future impl can mint one on demand.
- GitHub Enterprise host support — add a `host` option to `GitHubProviderOptions` and honor it in `getGitAuth`.
- `commitPushRepos` accepting `git?: IGitProvider` for the "cloned elsewhere" case.
- PAT redaction in `logSdkMessage` if token leakage shows up in captured logs.
