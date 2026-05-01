# Path Naming Standardisation

**Date:** 2026-05-01
**Status:** Approved

## Problem

The codebase uses five different names for three distinct directory concepts, and two phase handlers have bugs where the field name the handler reads does not match the field name declared in the phase meta.

### Current names in use

| Name | Occurrences | Where |
|---|---|---|
| `dirPath` | ~146 | Core types, all coding-cli operations, phase handlers, meta files |
| `targetDir` | 9 | `clone-repos` meta, handler, `CloneReposOptions` core type |
| `baseDir` | 5 | `create-workspace` meta, handler (alias), `DirectoryWorkspaceProvider` config |
| `parentDir` | 4 | `create-workspace` handler (alias), `list-workspace-files` handler (bug) |
| `workspaceDir` | mixed | `create-workspace` output ✓, `start-feature-branch` input (wrong concept) |
| `repoPath` | 1 | `commit-and-push` phase meta |

### Two handler bugs

| Phase | Meta declares | Handler reads | Effect |
|---|---|---|---|
| `list-workspace-files` | `workspaceDir` | `parentDir` | field always `undefined` at runtime |
| `cleanup-workspace` | `workspaceDir` | `repos` | field always `undefined` at runtime |

---

## Three canonical concepts

### Tier 1 — `baseDir`
The root directory on disk where Journeyman is allowed to write. Set once in Journeyman config (not a per-flow field). All workspaces live inside it. In future this may point to a remote mount (S3, NFS) rather than a local path.

```
/journeyman-workspaces/        ← baseDir  (config, never a phase input)
```

### Tier 2 — `workspaceDir`
An isolated directory created for one specific flow run, named `<ticketId>-<timestamp>`. Output of `create-workspace`. Passed into all phases that need to reference the run container: `clone-repos`, `list-workspace-files`, `cleanup-workspace`.

```
/journeyman-workspaces/
  PROJ-123-2026-05-01T10-30Z/  ← workspaceDir
```

### Tier 3 — `repoDir`
The local path to one specific cloned git repository inside the workspace. This is the directory the AI operates in (reads source, writes files, runs git commands). Renamed from `dirPath` throughout.

```
/journeyman-workspaces/
  PROJ-123-2026-05-01T10-30Z/
    api/                        ← repoDir
    frontend/                   ← repoDir (second repo, same workspace)
```

Each tier is the parent of the next. `baseDir` contains many `workspaceDir`s. Each `workspaceDir` contains one or more `repoDir`s.

---

## Full workflow dry-run (with new names)

```
create-workspace
  reads from config: baseDir
  input:  ticketId = "PROJ-123"
  output: workspaceDir = /journeyman-workspaces/PROJ-123-2026-05-01T10-30Z/

get-ticket
  input:  ticketKey = "PROJ-123"
  output: ticket { id, title, description }

clone-repos
  input:  repos = [url1, url2], workspaceDir (bound from create-workspace)
  output: repos[] = [{ repoDir: .../api/, url, branch }, { repoDir: .../frontend/, url, branch }]

start-feature-branch
  input:  repos[] (bound from clone-repos), ticket (bound from get-ticket)
  output: newBranch, repos[] with updated repoDir

analyze
  input:  repoDir (bound from repos[0].repoDir), ticketContent
  output: analysis report

plan
  input:  repoDir, ticketContent, analyzeReportPath
  output: plan report

implement
  input:  repoDir, ticketContent, analyzeReportPath, planReportPath
  output: implementation result

commit-and-push
  input:  repos[] (bound from start-feature-branch), message
  output: commit results per repo

open-pull-request
  input:  owner, repo, sourceBranch, targetBranch, title, body
  output: PR url  (no path fields — REST API call)

cleanup-workspace
  input:  workspaceDir (bound from create-workspace)
  output: removed
```

---

## Changes required

### 1. Move `baseDir` out of phase inputs → Journeyman config

`baseDir` is not a per-flow value. Remove it as an input field from `create-workspace`. The operation reads it from `DirectoryWorkspaceProvider` config at runtime.

Files:
- `packages/phases/src/repos/create-workspace.meta.ts` — remove `baseDir` from `createWorkspaceInputFields`
- `packages/flow-editor/src/...create-workspace.tsx` — remove `baseDir` from `configFields` and `configSchema`
- `packages/orchestrator/src/workers/phases/create-workspace-phase-handler.ts` — remove alias logic; read `baseDir` from `DirectoryWorkspaceProvider` config only
- `packages/orchestrator/src/workspace/directory-workspace-provider.ts` — `baseDir` stays here in `DirectoryWorkspaceConfig` (this is config, not phase I/O)

### 2. Rename `dirPath` → `repoDir` everywhere

The largest rename (~146 occurrences). Touches core types, all coding-cli operations, all phase handlers, meta output schemas, and UI labels.

Core types (`packages/core/src/types/`):
- `git.types.ts`: rename `dirPath` field in `CheckoutEntry`, `CloneResult`, `RepoInfo`, `CheckoutResult`, `CleanupEntry`, `CleanupRepoResult`, `CreateWorkspaceResult`, `CommitPushEntry`, `CommitPushResult`
- `coding.types.ts`: rename `dirPath` field in `AnalyzeOptions`, `PlanOptions`, `ImplementOptions`

Coding-cli operations (`packages/coding-cli/src/providers/`):
- `claude/operations/analyze.ts`
- `claude/operations/checkout-repo.ts`
- `claude/operations/cleanup-repos.ts`
- `claude/operations/commit-push-repos.ts`
- `claude/operations/create-workspace.ts`
- `claude/operations/implement.ts`
- `claude/operations/plan.ts`
- `claude/operations/scan-repos.ts`
- `opencode/operations/` — mirror of the above

Phase handlers (`packages/orchestrator/src/workers/phases/`):
- All handlers that read or write `dirPath`

Meta output schemas (`packages/phases/src/`):
- `repos/start-feature-branch.meta.ts` — rename output field `dirPath` → `repoDir`
- All other meta files that declare `dirPath` in `outputSchema`

UI labels:
- Anywhere `dirPath` or "Repo path" label appears — label stays "Repo path" (already correct for AI phases); field key changes to `repoDir`

### 3. Rename `targetDir` → `workspaceDir` in `clone-repos`

`clone-repos` clones repos into the workspace. Its target input should be `workspaceDir` not `targetDir`, so the binding from `create-workspace` is natural.

Files:
- `packages/core/src/types/git.types.ts` — rename `CloneReposOptions.targetDir` → `workspaceDir`
- `packages/git-provider/src/providers/github/operations/clone-repos.ts` — rename local variable and `opts.targetDir` usages
- `packages/orchestrator/src/workers/phases/clone-repos-phase-handler.ts` — rename `input.targetDir` → `input.workspaceDir`
- `packages/phases/src/git/clone-repos.meta.ts` — rename field `targetDir` → `workspaceDir`; update label to "Workspace dir"

### 4. Rename `repoPath` → `repoDir` in `commit-and-push`

`packages/phases/src/repos/commit-and-push.meta.ts` — rename `repoPath` → `repoDir`; update label to "Repo dir"

### 5 & 6. Redesign `start-feature-branch` — fix name and accept `repos[]`

Two problems in one phase: the input is named `workspaceDir` (wrong concept — it's a repo path, not the workspace container), and the phase only accepts one repo at a time when `checkoutRepo` already supports bulk operation, creating ONE shared branch across ALL repos in a single call.

These two changes are done together — the old `workspaceDir` single-field input is replaced entirely by a `repos[]` array input.

Files:
- `packages/phases/src/repos/start-feature-branch.meta.ts` — replace input `workspaceDir` with `repos` array; update `url` field accordingly
- `packages/orchestrator/src/workers/phases/start-feature-branch-phase-handler.ts` — read `input.repos` array, map each to `{ repoDir, branch }`, pass all to `checkoutRepo` in one call

### 7. Fix `list-workspace-files` handler bug

Handler reads `input.parentDir` but meta declares `workspaceDir`.

File: `packages/orchestrator/src/workers/phases/list-workspace-files-phase-handler.ts`
- Change `input.parentDir` → `input.workspaceDir`
- Update error message to reference `workspaceDir`

### 8. Fix `cleanup-workspace` handler bug

Handler reads `input.repos` but meta declares `workspaceDir`.

File: `packages/orchestrator/src/workers/phases/cleanup-workspace-phase-handler.ts` (if exists) or the handler that processes cleanup
- Change to read `input.workspaceDir`
- Pass to the underlying cleanup operation

### 9. Standardise `create-workspace` input to `ticketId` only

The handler currently accepts both `ticketId` and `name` as aliases. Remove the alias — standardise to `ticketId`.

File: `packages/orchestrator/src/workers/phases/create-workspace-phase-handler.ts`
- Remove `name` alias; require `ticketId` only

Meta: `packages/phases/src/repos/create-workspace.meta.ts`
- Rename field `name` → `ticketId`; label "Ticket ID"

---

## UI label mapping (after changes)

| Field key | UI label |
|---|---|
| `baseDir` | "Base directory" (config panel only, not a phase field) |
| `workspaceDir` | "Workspace directory" |
| `repoDir` | "Repo directory" |
| `ticketId` | "Ticket ID" |

---

## What does NOT change

- `workspaceDir` as the output of `create-workspace` — already correct
- `workspaceDir` as the input to `list-workspace-files` and `cleanup-workspace` meta — already correct (just fix the handlers)
- `repos[]` as the array output from `clone-repos` — keep as-is
- `DirectoryWorkspaceProvider.baseDir` in orchestrator config — keep, it's config not phase I/O
- PR-related fields (`owner`, `repo`, `sourceBranch`, `targetBranch`) — out of scope for this change
