# Phase Rename & Description Refresh — Design

**Date:** 2026-04-30
**Status:** Approved (design)
**Scope:** Rename all phase IDs, labels, categories, and consolidate descriptions into `.meta.ts` files. No backwards-compatibility shims — fresh data, no migration.

## Motivation

The current phase catalog has three problems that confuse flow authors:

1. **Category boundaries are unclear.** "AI" / "Repos" / "Git" / "Tickets" / "Notifications" don't map cleanly to provider intent. Worst offender: `clone-repos` lives in `Git` while `checkout-repo` lives in `Repos`, even though both ultimately produce local code on disk.
2. **Labels are inconsistent.** Some are verbs ("Notify"), some verb+object ("Create PR"), some noun-only ("Get Repo"). No grammar contract.
3. **`scan-repos` and `checkout-repo` are misnamed.** `scan-repos` lists files matching a glob — it does not scan repos. `checkout-repo` does not just check out — it hard-resets every repo to origin and creates one shared feature branch across all of them.
4. **Descriptions live only in the frontend.** Each `.tsx` `PhaseDefinition` carries a `description`, but the `.meta.ts` files do not. The backend `/phases` catalog therefore can never serve descriptions to API consumers.

## Approach

**Naming scheme — System + Action.** Categories name the *external system the phase touches*; labels are *verb + object* with consistent grammar. This mirrors the provider-pattern split already encoded in the monorepo (`coding-cli`, `git-provider`, `ticket-provider`, `notification-provider`) so flow authors can reason about *which credentials and connectors a phase needs* just by reading the category.

**Descriptions move to `.meta.ts`.** Single source of truth. The frontend `PhaseDefinition` imports the description constant the same way it imports `LABEL` and `CATEGORY` today. The backend catalog (`PhaseCatalogEntry`) gains a `description` field and `/phases` exposes it.

**No backwards compatibility.** Project has no production data to preserve. We rename `phaseType` strings outright; flows referencing old IDs do not exist.

## Category Renames

| Old | New | Rationale |
|---|---|---|
| `AI` | `Coding Agent` | Identifies *what runs the work* (the `coding-cli` provider) rather than the generic field. |
| `Repos` | `Workspace` | These phases all operate on a local workspace directory. |
| `Git` | `Code Host` | These phases call the remote host's REST API (GitHub/GitLab). |
| `Tickets` | `Issue Tracker` | Matches `ticket-provider` semantics. |
| `Notifications` | `Messaging` | Matches `notification-provider`; pairs with the new `Send Message` label. |

## Phase Renames

### Coding Agent (executor: `coding-cli`)

| Old ID | New ID | New Label | New Description |
|---|---|---|---|
| `analyze` | `analyze-repo` | Analyze Repo | Run a coding agent to analyze a repository against a ticket and report a summary, complexity, and likely-affected files. |
| `plan` | `plan-implementation` | Plan Implementation | Produce an ordered implementation plan from a ticket and (optionally) a prior analysis. |
| `implement` | `implement-changes` | Implement Changes | Execute an implementation plan against a repo using a coding agent; emits a diff summary and the list of changed files. |

### Workspace (executor: `coding-cli`, local bash)

| Old ID | New ID | New Label | New Description |
|---|---|---|---|
| `create-workspace` | `create-workspace` | Create Workspace | Create a new local directory to hold repositories for this run. |
| `scan-repos` | `list-workspace-files` | List Workspace Files | List files in a workspace directory matching a glob pattern. |
| `checkout-repo` | `start-feature-branch` | Start Feature Branch | Sync already-cloned repos to origin (hard-reset to the base branch), then create one shared feature branch across all of them. The branch name is generated from the ticket. |
| `commit-push` | `commit-and-push` | Commit & Push | Stage all changes, commit, and push to the remote branch. |
| `cleanup-repos` | `cleanup-workspace` | Cleanup Workspace | Reset and optionally delete repositories in a workspace. |

### Code Host (executor: `git-provider`)

| Old ID | New ID | New Label | New Description |
|---|---|---|---|
| `get-repo` | `get-repository` | Get Repository | Fetch metadata for a remote repository. |
| `clone-repos` | `clone-repos` | Clone Repos | Bulk-clone repositories from the code host into a target directory using host credentials. |
| `create-pr` | `open-pull-request` | Open Pull Request | Open a pull/merge request on the remote. |
| `list-prs` | `list-pull-requests` | List Pull Requests | List pull/merge requests on a repository, filtered by state. |
| `add-pr-comment` | `comment-on-pull-request` | Comment on Pull Request | Post a comment on a pull/merge request, optionally rendered from a template. |
| `fetch-pr-comments` | `list-pull-request-comments` | List Pull Request Comments | Read all comments from a pull/merge request. |

> Labels use "Pull Request" for terseness; descriptions retain "pull/merge request" so GitLab users see themselves represented.

### Issue Tracker (executor: `ticket-provider`)

| Old ID | New ID | New Label | New Description |
|---|---|---|---|
| `get-ticket` | `get-ticket` | Get Ticket | Fetch a ticket from the configured tracker. |
| `create-ticket` | `create-ticket` | Create Ticket | Create a ticket on the configured tracker. |
| `update-ticket` | `update-ticket-fields` | Update Ticket Fields | Update arbitrary fields on an existing ticket. |
| `update-status` | `transition-ticket` | Transition Ticket | Move a ticket to a new workflow status. |
| `add-ticket-comment` | `comment-on-ticket` | Comment on Ticket | Post a comment on a ticket, optionally rendered from a template. |

### Messaging (executor: `notification`)

| Old ID | New ID | New Label | New Description |
|---|---|---|---|
| `notify` | `send-message` | Send Message | Send a message via the configured messaging provider (Slack, etc.). |

## Files Affected

### New constants per phase (`packages/phases/src/<area>/<phase>.meta.ts`)

Each `*.meta.ts` gains a `*_DESCRIPTION` export and renames the existing `*_PHASE_TYPE` and `*_LABEL` constants where the underlying value changes.

Example for `analyze.meta.ts`:

```ts
export const ANALYZE_PHASE_TYPE = "analyze-repo";          // was "analyze"
export const ANALYZE_LABEL = "Analyze Repo";               // was "Analyze"
export const ANALYZE_CATEGORY = "Coding Agent";            // was "AI"
export const ANALYZE_DESCRIPTION =
  "Run a coding agent to analyze a repository against a ticket and report a summary, complexity, and likely-affected files.";
```

For phases whose Cap-cased identifier root changes (e.g. `update-status` → `transition-ticket`), the constant prefix changes too: `UPDATE_STATUS_*` → `TRANSITION_TICKET_*`. The local `interface` and config types in the corresponding `.tsx` follow the same rename.

### Catalog (`packages/phases/src/catalog.ts`)

Add `description` to `PhaseCatalogEntry`:

```ts
export interface PhaseCatalogEntry {
  phaseType: string;
  label: string;
  category: string;
  description: string;
  inputFields: InputFields;
  outputSchema: OutputSchema | null;
}
```

Populate `description` in every catalog row from the new `*_DESCRIPTION` constants. Update all imports.

### Frontend definitions (`packages/phases/src/<area>/<phase>.tsx`)

Each `PhaseDefinition` already has `description: string`. Replace the inline string literal with an import of `*_DESCRIPTION` from the sibling `.meta.ts`. No other changes to `.tsx` files except where the constant prefix renames force an import update.

### Phase registry (`packages/phases/src/registry.ts`)

Update any direct exports if phase identifier names changed (the file aggregates `PhaseDefinition` objects; renames of the imports are mechanical).

### Orchestrator handlers

Phase handlers in `packages/orchestrator/src/workers/phases/*` are keyed by `phaseType`. Filename and handler-key mappings need to match new IDs:

- `clone-repos-phase-handler.ts` → unchanged (ID stayed `clone-repos`)
- `checkout-repo-phase-handler.ts` → `start-feature-branch-phase-handler.ts`
- Similar renames for every other phase whose `phaseType` changed

The handler **registration map** (wherever handlers are bound to phaseType strings) updates to use the new IDs.

### Web app

Any hard-coded `phaseType` strings in `packages/web/src/` get updated. (No production data means no migration.)

## Out of Scope

- No new phases.
- No changes to `inputFields` shape or `outputSchema` content.
- No changes to executor wiring (`executor.kind` / `executor.method` stay).
- No icon or color changes.
- No changes to flow-editor UI rendering — only the data the palette consumes.

## Risk

Low. The change is mechanical: text in metadata files plus three new constants per phase. The only structural change is adding `description` to `PhaseCatalogEntry`, which is additive. Every consumer is in this repo and updates with the rename.

## Verification

After implementation:

1. `npm run typecheck` clean across all workspaces.
2. `GET /phases` returns each entry with a non-empty `description` field.
3. Flow editor palette popover shows the new descriptions.
4. Properties panel "Config" tab header shows the new description.
5. Spot-check a flow run end-to-end (e.g. `analyze-repo` → `plan-implementation` → `implement-changes`) to confirm orchestrator handler registration resolves new `phaseType` strings.
