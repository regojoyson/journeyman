# Clone-repos branch handling — design

**Date:** 2026-06-22
**Status:** Approved for planning

## Problem

There are two independent "clone repos" paths in the product, and each has a branch gap:

1. **Workflow `clone-repos` step** — stores repos as one newline blob (`repos: string`) plus a single `branch` for all of them, and:
   - `repos` is hard-required (`z.string().min(1)` + `required: true`), so a freshly-dropped node shows a required-error *before* the user has picked a connection. The connection-bound `RepoPicker` already exists, so the typed field should not be mandatory.
   - There is no way to give each repo its own branch — the step applies one branch across all repos.
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

## Part A — Workflow `clone-repos` step (per-repo branch)

The step gets the same UX as the agent: one git connection on the node, then a list of repos chosen from that connection, each with its own checkout branch. Repos come **only** from the connection's browse list (picker-only — no manual free-text entry).

### A1. Config model
- **Before:** `{ repos: string (newline list), branch?: string }`.
- **After:** `{ repos: { url: string; branch?: string }[] }`. The standalone step-level `branch` field is removed; each repo carries its own (blank = that repo's default branch).
- `packages/steps/src/git/clone-repos.meta.ts`
  - `cloneReposConfigSchema`: `repos: z.array(z.object({ url: z.string().min(1), branch: z.string().optional() })).optional()`; remove the top-level `branch`.
  - `cloneReposInputFields.repos`: shape becomes an array of `{ url, branch }` objects; remove `required: true`.
  - `defaultConfig`: `{ repos: [] }`.
  - `configFields`: remove the `repos` `string-list` field and the `branch` `text` field (the picker fully owns repos + branches now).

### A2. UI (flow editor)
- **Connection** — unchanged: the node's existing `ConnectionPicker` (one git connection for the step).
- **Repos** — upgrade [RepoPicker.tsx](../../../packages/flow-editor/src/properties-panel/RepoPicker.tsx) (already special-cased for clone-repos in `ConfigTab.tsx`):
  - browse & tick repos from the connection;
  - render each selected repo as a **row with an inline branch input** (placeholder `default branch`) + remove, matching the agent `WorkspaceSection` layout;
  - `value`/`onChange` switch from `string[]` to `{ url, branch? }[]`.
- No manual "add by name" path; no generic `string-list` editor for this step.

### A3. Handler
- `packages/orchestrator/src/workers/steps/clone-repos-step-handler.ts`
  - Normalize `input.repos` into `RepoEntry[]`, accepting **both** the new `{ url, branch }[]` shape and the legacy `string`/`string[]` (with the old top-level `input.branch` as fallback).
  - Pass the `RepoEntry[]` straight to `cloneRepos` (already supports per-entry branch); drop the single `input.branch` read.
  - Empty list → unchanged non-retryable `InvalidInput` failure (so an empty clone step fails at run time, not at edit time).

### A4. Blank-branch fix (local path)
- `packages/git-provider/src/providers/github/operations/clone-repos.ts`
  - `normalizeEntries`: stop defaulting to `"main"`. When an entry has no branch (and no `opts.branch`), it carries **no branch**.
  - Clone invocation: build args conditionally — `["clone", ...(branch ? ["--branch", branch, "--single-branch"] : []), cloneUrl, repoDir]`. With no branch, git clones the repo's default branch.
  - `CloneResult.branch` reports the effective branch (empty when defaulted), matching the sandbox provider.

### A5. Back-compat
- Existing saved clone-repos nodes store `{ repos: "a\nb", branch: "main" }`.
  - **Runtime:** the A3 normalizer reads the legacy string + top-level `branch`, so already-saved/published workflows keep cloning correctly without a data migration.
  - **Editor:** on load, convert a legacy newline `repos` string into rows, seeding each row's `branch` from the old single `branch` value, so nothing is lost when the node is re-saved into the new shape.

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
Agent UI (per-repo branch)                Clone-repos step UI (per-repo branch)
  → compile.ts (RepoEntry[])                 → step config { repos: {url,branch}[] }
        \                                    /
         → step handler builds RepoEntry[] and calls cloneRepos
           → SandboxInstanceGitProvider (per-entry branch → clone op stdin)
             → runner dispatch "clone" (git clone --branch <branch>)   [already supported]
           → local GitHubProvider.cloneRepos (normalizeEntries per-entry branch)
```

Both entry points converge on `cloneRepos(RepoEntry[])`. Blank branch at any layer ⇒ clone the repo's default branch.

## Edge cases

- **Blank branch** → repo default branch (both local and sandbox).
- **Branch missing on remote** → clone fails with the git error surfaced (no auto-create).
- **Mixed branches across repos** (agent or clone-repos step) → each repo clones its own branch.
- **Legacy agents / legacy clone-repos nodes** (no per-repo branch) → entries carry no branch → default branch everywhere; behavior unchanged. Legacy clone-repos config (`repos: string` + `branch`) is read at runtime without a data migration.
- **Empty repo list** → no clone; agent-run skips workspace provisioning; workflow clone-repos step fails non-retryably at run time.
- **Local (non-sandbox) runs** → the local provider already honors `RepoEntry[]` per-entry branch via `normalizeEntries`; the A4 blank-branch fix applies here too.

## Testing

- `compile.test.ts`: per-repo branches survive compilation (not just `repoSelections[0]`); connection + allowWrites derivation unchanged.
- `sandbox-instance-git-provider` unit test: `RepoEntry[]` with differing branches issues one `clone` op per repo, each with its own `branch` in stdin; blank branch omits `branch`.
- `clone-repos.ts` (local) unit test: blank branch omits `--branch` (clones default); set branch passes `--branch <b> --single-branch`.
- `clone-repos-step-handler`: new `{url,branch}[]` config and legacy `string`+`branch` config both produce the correct `RepoEntry[]`; empty `repos` still returns the non-retryable `InvalidInput` failure.
- Existing `clone-repos` step save no longer surfaces a required-error with an empty `repos` field; editor migrates a legacy newline `repos` string into rows on load.

## Out of scope

- Creating/switching to a **new** branch at clone time (`checkout -b`) — remains `start-feature-branch`.
- Per-repo connection selection (one git connection per agent / per clone-repos step is unchanged).
- Manual free-text repo entry on the clone-repos step (picker-only).
- Extracting a shared repo-rows component across `web` (agent) and `flow-editor` (clone-repos) — optional future cleanup; the two live in different packages with different data models.
