# Clone-repos branch handling — design

**Date:** 2026-06-22
**Status:** Approved for planning

## Problem

There are two independent "clone repos" paths in the product, and each has a branch gap:

1. **Workflow `clone-repos` step** — has a single `branch` config field, but:
   - `repos` is hard-required (`z.string().min(1)` + `required: true`), so a freshly-dropped node shows a required-error *before* the user has picked a connection. The connection-bound `RepoPicker` already exists, so the typed field should not be mandatory.
   - The local clone path forces `opts.branch ?? "main"`, so leaving the branch blank breaks any repo whose default branch is `master`/`develop`.

2. **Agent `repoSelections`** — the user picks repos via a connection-bound browser, but there is **no way to set the checkout branch per repo**. The data type already has `branch?`, but:
   - the UI ([WorkspaceSection.tsx](../../../packages/web/src/components/agents/sections/WorkspaceSection.tsx)) never sets it,
   - `compile.ts` flattens to `repos: string[]` and reads only `repoSelections[0]?.branch`, discarding every other repo's branch,
   - the agent-run handler passes one shared `branch` to all repos,
   - `SandboxInstanceGitProvider.cloneRepos` flattens repos to bare URLs (`toUrls`) and applies one `opts.branch` to all.

The underlying plumbing already supports per-repo branches: `RepoEntry` (`{ url, branch }`), `CloneReposOptions.repos: string | string[] | RepoEntry | RepoEntry[]`, the local provider's `normalizeEntries`, and the sandbox runner's `clone` op (`dispatch.ts` runs `git clone --branch <branch>` from a per-call stdin `branch`). The gaps are in the middle layers that throw the per-repo branch away.

## Branch semantics

- `branch` means **check out an existing branch at clone time** (`git clone --branch <branch>`).
- **Blank branch = clone the repo's real default branch** (omit `--branch`), at every layer.
- A branch name that does not exist on the remote **fails the clone** with a clear error — clone does **not** create branches.
- Creating a new working branch remains the job of the existing **`start-feature-branch`** step (`checkoutRepo`). Out of scope here.

## Part A — Workflow `clone-repos` step (single branch)

### A1. `repos` optional
- `packages/steps/src/git/clone-repos.meta.ts`
  - `cloneReposConfigSchema`: `repos: z.string().min(1)` → `repos: z.string().optional()` (keep `branch` optional).
  - `cloneReposInputFields.repos`: remove `required: true`.
- Runtime guard is unchanged: `clone-repos-step-handler.ts` already returns a non-retryable `InvalidInput` failure when the parsed repo list is empty. An empty clone step therefore fails at run time rather than blocking at edit time.
- UI is unchanged: `RepoPicker` (primary) and the `string-list` editor (manual/secondary) both already edit `config.repos`.

### A2. Blank-branch fix (local path)
- `packages/git-provider/src/providers/github/operations/clone-repos.ts`
  - `normalizeEntries`: stop defaulting to `"main"`. When neither a per-entry branch nor `opts.branch` is set, the entry carries **no branch**.
  - Clone invocation: build args conditionally — `["clone", ...(branch ? ["--branch", branch, "--single-branch"] : []), cloneUrl, repoDir]`. With no branch, git clones the repo's default branch.
  - `CloneResult.branch` reports the effective branch (empty string when defaulted), matching the sandbox provider's existing behavior.
- The sandbox path already omits `--branch` when blank — no change needed for the single-branch case.

## Part B — Agent per-repo branch

### B1. UI — per-repo branch input (inline)
- `packages/web/src/components/agents/sections/WorkspaceSection.tsx`
  - Replace the repo "chip" render with a **row**: repo name on the left, a small inline branch `<input>` on the right (placeholder `default branch`), then the remove button.
  - Add `setRepoBranch(repo: string, branch: string)` that patches the matching `repoSelections` entry's `branch` (store `undefined` when the input is cleared/blank, so blank means default).
  - `addRepo` unchanged in shape — new repos start with no branch.

### B2. Compile — carry per-repo branch
- `packages/agents/src/compile.ts`
  - Stop emitting `repos: string[]` + single `repoBranch`. Emit **per-repo entries** that preserve each repo's branch, e.g. `repos: agent.repoSelections.map(r => ({ url: r.repo, branch: r.branch }))` (a `RepoEntry`-shaped list, branch omitted/empty when unset).
  - Keep `gitConnectionId` and `allowWrites` derivation as-is.
  - Remove the `repoBranch` field (superseded by per-entry branch).

### B3. Agent-run handler — pass entries through
- `packages/orchestrator/src/workers/steps/agent-run-step-handler.ts`
  - Read the per-repo entries from `input.repos` and pass them to `cloneRepos` as `RepoEntry[]` (the type already accepts this) instead of `{ repos: string[], branch }`.
  - `needsWorkspaceFor` and the run guard: count entries (a small normalizer that accepts `string | string[] | RepoEntry[]`) instead of relying solely on `parseRepoList`. Empty list → no workspace / no clone, as today.
  - Drop the single `input.repoBranch` read.

### B4. Sandbox provider — honor each repo's branch (key fix)
- `packages/orchestrator/src/sandbox/sandbox-instance-git-provider.ts`
  - Replace `toUrls(opts.repos)` (which discards per-entry branch) with a normalizer that yields `{ url, branch? }` per repo — accepting `string`, `string[]`, `RepoEntry`, and `RepoEntry[]`, with `opts.branch` as the fallback for plain-string inputs.
  - In the clone loop, pass **each entry's own branch** into the `clone` exec op's stdin (`...(entry.branch ? { branch: entry.branch } : {})`). Blank → omit, so the runner clones the default branch.
  - `CloneResult.branch` reports the effective per-entry branch.

## Data flow (after)

```
Agent UI (per-repo branch)
  → compile.ts (RepoEntry[] with per-repo branch)
    → agent-run handler (pass RepoEntry[] to cloneRepos)
      → SandboxInstanceGitProvider (per-entry branch → clone op stdin)
        → runner dispatch "clone" (git clone --branch <branch>)   [already supported]
```

Blank branch at any layer ⇒ clone the repo's default branch.

## Edge cases

- **Blank branch** → repo default branch (both local and sandbox).
- **Branch missing on remote** → clone fails with the git error surfaced (no auto-create).
- **Mixed branches across repos in an agent** → each repo clones its own branch.
- **Legacy agents** (no `branch` set on any selection) → entries carry no branch → default branch everywhere; behavior unchanged.
- **Empty repo list** → no clone; agent-run skips workspace provisioning; workflow clone-repos step fails non-retryably at run time.
- **Local (non-sandbox) agent runs** → the local provider already honors `RepoEntry[]` per-entry branch via `normalizeEntries`; the A2 blank-branch fix applies here too.

## Testing

- `compile.test.ts`: per-repo branches survive compilation (not just `repoSelections[0]`); connection + allowWrites derivation unchanged.
- `sandbox-instance-git-provider` unit test: `RepoEntry[]` with differing branches issues one `clone` op per repo, each with its own `branch` in stdin; blank branch omits `branch`.
- `clone-repos.ts` (local) unit test: blank branch omits `--branch` (clones default); set branch passes `--branch <b> --single-branch`.
- `clone-repos-step-handler`: empty `repos` still returns the non-retryable `InvalidInput` failure after `repos` becomes schema-optional.
- Existing `clone-repos` step save no longer surfaces a required-error with an empty `repos` field.

## Out of scope

- Per-repo branch on the **workflow** clone-repos step (stays a single branch for the step).
- Creating/switching to a **new** branch at clone time (`checkout -b`) — remains `start-feature-branch`.
- Per-repo connection selection (the existing single-connection-per-agent behavior is unchanged).
