# Workflow Versioning — Draft / Promote / Publish Design

**Date:** 2026-06-20
**Status:** Approved (design); implementation plan to follow
**Scope:** Promote + Rollback + Version history list. Diff and version labels/notes are explicitly out of scope.

## Problem

Today a workflow has a single `current_version_id` that always points at the
latest save, and `status: ready` flips the whole workflow live against that
latest version. Consequences:

- **No publish control.** "Publish" always means "the most recent save." There
  is no way to promote a deliberately chosen version to production.
- **Editing a live workflow is blocked.** `PUT …/workflows/:id` returns
  `409 workflow_is_ready` when `status = 'ready'`; the only way to change a live
  workflow is to unpublish it first (downtime).
- **Version noise.** Every save appends an immutable row, so a workflow being
  edited accumulates dozens of versions, none of them deliberate.

We want a deliberate publish model: a mutable working **draft**, a clean
**history** of promoted versions, and a **published** pointer that decides what
actually runs — with **rollback** to an older version.

## Decisions (locked during brainstorming)

1. **Publish control** is the goal (deliberately promote a chosen version).
2. **Draft/published split.** Editing a live workflow is allowed and flows into
   a draft; the published version keeps running until the user promotes.
3. **Operations in scope:** Promote, Rollback, Version-history list. Diff and
   labels/notes deferred.
4. **Mutable working draft.** One draft that is overwritten in place on every
   save. A permanent, numbered version is created **only** on promote.
5. **Data model: Approach A.** The draft lives as a column on `jm_workflows`;
   `jm_workflow_versions` becomes a pure, immutable history of promoted versions
   only.

## Mental model (plain language)

- **Draft** — one working copy. Saving in the editor overwrites this same copy;
  nothing live changes. There is only ever one draft per workflow.
- **Version history** — a drawer of frozen photocopies. A new one is filed only
  when the user clicks Promote. Once filed, a version is never edited or deleted.
- **Published pointer** — a sticker on the one version that triggers and manual
  runs use. Rollback peels the sticker off and puts it on an older version — no
  data is copied or rewritten, the pointer just moves.

## Data model

### `jm_workflows` changes

- Add `draft_definition JSONB NOT NULL` — the single mutable working copy.
  Always present (a brand-new workflow has a draft).
- Add `draft_updated_at TIMESTAMPTZ` and `draft_updated_by_user_id TEXT`.
- Rename `current_version_id` → `published_version_id` (same FK into
  `jm_workflow_versions`, same deferrable constraint). `NULL` = nothing live.
- Keep `status` (`draft` / `ready`) but it becomes a strict mirror of the
  pointer: **`status = 'ready'` ⟺ `published_version_id IS NOT NULL`.** `status`
  is never set directly — only `promote` / `unpublish` move it.

### `jm_workflow_versions`

Structure unchanged (`id`, `workflow_id`, `version_number`, `definition`,
`created_by_user_id`, `created_at`, `UNIQUE(workflow_id, version_number)`).
The **write pattern** changes: rows are inserted **only on promote**, never on
plain save. Still immutable, still auto-incrementing `version_number`.

### Derived (computed, not stored)

`hasUnpublishedChanges` = `draft_definition` differs structurally from the
published version's definition (or `true` when there is no published version and
the draft is non-empty). Drives the editor's "unpublished changes" indicator.

### Invariants

- A workflow **always** has a draft.
- A workflow **may or may not** have a published version.
- `status = 'ready'` ⟺ `published_version_id IS NOT NULL`.
- Version rows are immutable and append-only; only promote writes them.

## Type changes (`@journeyman/core`, `flow.types.ts`)

- `Workflow`: `currentVersionId` → `publishedVersionId`; add
  `draftDefinition: WorkflowGraph`, `draftUpdatedAt: Date | null`,
  `draftUpdatedByUserId: string | null`.
- `IWorkflowStore`: add `updateDraft(workflowId, { definition, updatedByUserId })`,
  `promote(workflowId, { createdByUserId })`,
  `rollback(workflowId, { versionId })`. `create()` now seeds `draft_definition`
  and creates **no** version row (no published version until first promote).
- `IWorkflowVersionStore`: `appendVersion` becomes an internal step of `promote`
  (a frozen copy of the current draft); `getById` / `listByWorkflow` unchanged.

## API endpoints (workspace-scoped, `/workspaces/:wsId/workflows/:id`)

### Save — `PUT …/workflows/:id` (changed)

- Overwrites `draft_definition` (+ `draft_updated_at`, `draft_updated_by_user_id`).
- **Drop** the `409 workflow_is_ready` block — editing a live workflow is
  allowed; it only touches the draft.
- No version row created. Returns the workflow + the existing
  `WorkflowSaveWarning[]` (non-blocking). Save always succeeds for well-formed
  JSON.

### Promote — `POST …/workflows/:id/promote` (new, replaces `/publish`)

- Validate the **draft** via the existing pipeline
  (`ConductorJsonConverter.validateGraph` + `validateForPublish`) run against
  `draft_definition`.
- On success: insert a frozen version row from the draft → set
  `published_version_id` to it → `status = ready` →
  `refreshTriggerIndexOnPublish`.
- `/publish` is **renamed outright** to `/promote`; the frontend is updated in
  the same change (no alias).

### Rollback — `POST …/workflows/:id/rollback` (new)

- Body `{ versionId }`; the version must belong to this workflow (else 404).
- Re-run `validateForPublish` against that version's definition. Shape errors
  block; secret/step warnings are surfaced but do not block.
- Set `published_version_id` to it → `refreshTriggerIndexOnPublish` for that
  version. **Does not modify the draft** (an emergency rollback must not clobber
  in-progress edits).

### Version history — `GET …/workflows/:id/versions` (new)

- Returns versions newest-first: `{ id, versionNumber, createdAt,
  createdByUserId, isPublished }`. Definitions are fetched on demand via the
  existing `GET …/workflow_versions/:id`.

### Unpublish — `POST …/workflows/:id/unpublish` (unchanged behavior)

- Clears `published_version_id`, `status = draft`, deactivates triggers.

### Manual run / clone (changed readers)

- Manual run reads `published_version_id` and requires a published version
  (consistent with triggers). Running the draft for testing is **out of scope**.
- Clone copies the **draft** (so work-in-progress can be forked).

## Editor & runtime behavior

### Editor (`@journeyman/web`)

- Load the workflow, which now carries `draftDefinition`; the editor always opens
  the **draft**. No separate "current version" fetch for the editable graph.
- Header shows published state (`v3 · live` or `not published`) and a draft
  indicator (`unpublished changes` when `hasUnpublishedChanges`, else `in sync`).
- Primary action **Promote** (enabled when the draft validates). Secondary:
  **History**, **Unpublish** (when live).

### Version history panel (new, `@journeyman/web`)

- Lists versions newest-first with number, timestamp, author, and a `live` badge
  on the published one.
- Per row: **View** (loads that version's definition read-only into the canvas)
  and **Rollback to this** (confirm dialog: changes what runs, leaves the draft
  intact).
- No diff, no rename (deferred). Old versions are **view-only**; the only action
  on them is Rollback — there is no "edit this old version directly" path.

### Runtime (orchestrator / triggers)

- Manual run, webhook fire, human/form triggers resolve through
  `published_version_id` + the per-version trigger index. Only the pointer field
  is renamed; snapshot-into-instance is untouched.
- **Trigger index on save:** today `PUT` calls
  `refreshTriggerIndexOnVersionCreated` (compute-without-activate). Since save no
  longer creates a version, that call moves to **promote**
  (`refreshTriggerIndexOnPublish` already replaces and activates).
  `refreshTriggerIndexOnVersionCreated` becomes dead and is removed.
- In-flight and historical runs are untouched (each carries its own
  `definition_snapshot` + `workflow_version_id`).

### Validation timing

- **Save:** non-blocking `computeSaveWarnings` + the validate endpoint feeding
  the editor's live panel.
- **Promote / rollback:** full blocking `validateForPublish` +
  `validateGraph`, against the draft (promote) or the target version (rollback).

## Migration (`061_workflow_drafts.sql`, append-only)

```sql
ALTER TABLE jm_workflows
  ADD COLUMN draft_definition JSONB,
  ADD COLUMN draft_updated_at TIMESTAMPTZ,
  ADD COLUMN draft_updated_by_user_id TEXT;

ALTER TABLE jm_workflows RENAME COLUMN current_version_id TO published_version_id;
```

Backfill, per existing workflow:

- `draft_definition` ← the definition of its current
  (now `published_version_id`) version, falling back to an empty graph via
  `COALESCE` if a workflow somehow has no version.
- `draft_updated_at` ← workflow `updated_at`; `draft_updated_by_user_id` ←
  that version's `created_by_user_id`.
- `published_version_id`: keep only if `status = 'ready'`; for `status = 'draft'`
  set `NULL` (never live). Enforces the new invariant from day one.

After backfill:

```sql
ALTER TABLE jm_workflows ALTER COLUMN draft_definition SET NOT NULL;
```

No data deleted: all historical version rows stay; existing runs keep their
`workflow_version_id` + `definition_snapshot`; the FK rename is metadata-only.

**Code rename in the same change:** `rowToWorkflow` in
`postgres-flow-store.ts`, the `Workflow` type, and the `currentVersionId`
readers in `flows.ts` / instance / clone / trigger paths.

**Edge case:** a `ready` workflow gets `draft = published` definition, so
`hasUnpublishedChanges` is correctly `false` immediately post-migration; the
first edit flips it to `true`.

## Out of scope

- Visual diff/compare between versions.
- Version labels / changelog notes.
- Running the draft as a test (draft test-runs).
- Fine-grained per-save edit history (intentionally traded away by the mutable
  draft model).

## Implementation constraints (from requester)

- Work on the `master` branch only; do **not** create branches.
- Do **not** commit.
- Run typecheck (`npm run check` / `npm run typecheck`) **once at the end**,
  not incrementally.
