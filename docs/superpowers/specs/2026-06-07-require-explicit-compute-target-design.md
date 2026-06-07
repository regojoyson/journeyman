# Require an Explicit Compute Target (Remove Defaults)

**Date:** 2026-06-07
**Status:** Proposed
**Related:** Spec B (managed compute-target images), the compute-target rename (Spec A).

## Summary

Remove the "default compute target" concept. Every workflow must **explicitly pick** a compute
target at the workflow level — there is no silent fallback. **Local Workspace** remains the single
**builtin** target (system-scoped, undeletable, and the only `local` one). The workflow picker no longer
offers a "Default" option and starts **empty**; leaving it empty is a **publish-blocking** validation
error (permissive save / strict publish), with a run-time guard as a safety net. The **per-node compute
target override is hidden** for now (future feature) — every step inherits the workflow-level target.

## Why

The current model has a global `is_default` target and a resolver that silently falls back to it when a
workflow/step leaves the compute target empty. Combined with a picker that shows both a
"Default (system Local Workspace)" option **and** the Local Workspace target itself, this is confusing
(the same target appears twice; "default" hides where a run actually executes). Making the choice
explicit removes the ambiguity: a run's environment is always something the author deliberately selected.

## Decisions (from brainstorming)

- **Single builtin Local Workspace.** Users cannot create additional `local` targets; they create
  docker/other types. Local Workspace is undeletable.
- **No defaults.** Drop the `is_default` flag/fallback and the ★ in the list page.
- **Workflow-level requirement, strict at publish.** Drafts may save without a target; **publish is
  blocked** if none is set. A run-time guard also errors if a target is somehow missing.
- **Per-node override hidden** (future). The `node.computeTargetId` data field stays, but no UI sets it.
- **No migration.** Existing workflows with an empty target hit the new error until re-picked.

## Design

### 1. Data model — drop `is_default`

- New migration `039_drop_compute_target_is_default.sql`:
  `ALTER TABLE jm_compute_targets DROP COLUMN IF EXISTS is_default;`
- Remove `is_default` from: `COLS` (db.ts), `CreateComputeTargetArgs`/`UpdateComputeTargetArgs`,
  `insertComputeTarget`/`updateComputeTarget`, `rowToComputeTarget`, the `ComputeTarget` core type, and
  the compute-target routes (create/update bodies).
- The builtin **Local Workspace** seed row (migration 033) stays; it is simply a normal system-scoped
  target now. (033 is append-only and already ran; the new migration just drops the column — the seed
  row keeps working.)

### 2. Resolver — no fallback

- `resolveComputeTarget(db, ctx, computeTargetId)`:
  - if `computeTargetId` is set → fetch it (unchanged).
  - if **not** set → **throw** `ComputeTargetNotFoundError("no compute target selected for this workflow")`
    (previously it fell back to `fetchDefaultComputeTarget`).
- **Delete** `fetchDefaultComputeTarget` and its only caller (the fallback branch).

### 3. Run-time guard — terminal error

- The worker harness already turns a thrown `ConfigurationError` from provisioning into a terminal
  `FAILED_WITH_TERMINAL_ERROR`. `ensure-workspace` already throws a `ConfigurationError` when user/org
  context is missing; extend the same treatment so a missing compute target surfaces clearly:
  - `ComputeTargetNotFoundError` from `resolveComputeTarget` must reach the harness as a terminal error
    with message *"No compute target selected for this workflow. Pick one and republish."*
  - Map it in the worker's `resolveComputeTarget` dep (cli-worker) or in the harness `catch` (treat
    `ComputeTargetNotFoundError.name` like `ConfigurationError`).

### 4. Publish validation — strict publish

- Add a workflow-publish validation rule: **the workflow's default compute target
  (`definition.defaults.workerId`) must be a non-empty string.**
- On publish with an empty/absent target → reject with a clear, field-level error:
  *"Select a compute target for this workflow before publishing."*
- **Saving a draft** with no target is still allowed (permissive save).
- Locate the existing publish-validation path (the strict-publish checks) and add this rule alongside the
  others (e.g. provider/secret validation).

### 5. UI — workflow picker

- `DefaultsComputeTargetSection` (flow-editor):
  - **Remove** the `<option value="">Default (system Local Workspace)</option>`.
  - Replace with a disabled placeholder `<option value="" disabled>— Select a compute target —</option>`
    so an unset workflow shows the placeholder and forces a choice.
  - List only real targets (from `listVisible`).
  - Show an inline error/hint when empty (mirrors other required Flow Defaults fields), so the
    publish-block reason is visible in the editor.

### 6. UI — per-node override hidden

- In the properties panel, **do not render** the per-node "Compute Target" tab (remove it from the tab
  shell / gate it behind a `false` flag with a "coming soon" note if a placeholder is preferred).
- Leave `node.computeTargetId` in the flow JSON contract untouched (future use). The worker continues to
  honor a node-level `computeTargetId` if present, but the UI never sets one.

### 7. UI — compute-targets list page

- Remove the ★/"Default" column and any "set as default" affordance.
- Keep: the builtin **Local Workspace** (no delete button for system scope), user targets with
  edit/delete, the build-state badge + Rebuild (from Spec B), and **"+ New compute target"**.

## Files (indicative)

| File | Change |
|---|---|
| `packages/migrations/src/sql/039_drop_compute_target_is_default.sql` | Drop the column |
| `packages/core/src/types/compute-target.types.ts` | Remove `isDefault` from type + args |
| `packages/compute/src/db.ts` | `COLS`, insert/update, **delete** `fetchDefaultComputeTarget` |
| `packages/compute/src/compute-target-record.ts` | Drop `isDefault` mapping |
| `packages/compute/src/resolver.ts` | No fallback → throw when no `computeTargetId` |
| `packages/compute/src/routes/index.ts` | Drop `isDefault` from create/update bodies |
| `packages/orchestrator/src/cli-worker.ts` / `worker-harness.ts` | Surface `ComputeTargetNotFoundError` as terminal |
| *(publish validation module)* | Require `defaults.workerId` at publish |
| `packages/flow-editor/.../DefaultsComputeTargetSection.tsx` | Remove "Default" option; placeholder + required hint |
| `packages/flow-editor/.../tabs-shell.tsx` (+ `ComputeTargetTab`) | Hide the per-node override tab |
| `packages/web/src/routes/ComputeTargetsPage.tsx` | Remove ★/default UI |

## Non-goals / future

- Per-node compute-target override (hidden now; the data field remains).
- Migrating existing empty-target workflows (they error until re-picked).
- Multi-arch kit; any change to docker/kit provisioning.
- Per-org/user "preferred" target (a future convenience, explicitly not a silent default).

## Verification

1. Fresh workflow → "Run target" shows a placeholder, no "Default" option; lists Local Workspace +
   user targets.
2. Try to **publish** with no target → blocked with *"Select a compute target…"*; **saving a draft** with
   no target → allowed.
3. Publish with Local Workspace → runs in-process; with a docker target → runs in a container.
4. A run that resolves with no target (e.g. an old published version) → **terminal** error
   *"No compute target selected…"*, not a silent fallback.
5. Compute-targets list → no ★; Local Workspace present and **not deletable**; "+ New compute target"
   works.
6. Properties panel → **no** per-node Compute Target tab.
7. `is_default` column is gone; create/update/list still work without it.
