# Require an Explicit Compute Target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the "default compute target" concept so every workflow must explicitly pick a compute target (workflow-level only); Local Workspace stays the single builtin; the resolver errors instead of falling back; publish is blocked when no target is set; the per-node override is hidden.

**Architecture:** Drop the `is_default` column + flag + ★ UI and the resolver fallback. Make `resolveComputeTarget` throw when no id is given, surface that as a terminal run error, and add a publish-validation rule requiring `defaults.computeTargetId`. In the editor, the workflow picker loses its "Default" option (placeholder + required) and the per-node Compute Target tab is removed.

**Tech Stack:** TypeScript (Node, ESM, `.ts` import specifiers), PostgreSQL via `pg` (append-only SQL migrations), Vitest, React (web + flow-editor). Spec: `docs/superpowers/specs/2026-06-07-require-explicit-compute-target-design.md`.

---

## Important scoping note

`is_default` / `isDefault` also exists for **coding models** (`packages/coding-models/*`, `AdminCodingModelsPage.tsx`, `coding-models.types.ts`) and for **providers** (`provider-catalog.ts`). **Do NOT touch those.** Only the **compute-target** occurrences listed below.

## File structure

| File | Responsibility | Action |
|---|---|---|
| `packages/migrations/src/sql/039_drop_compute_target_is_default.sql` | Drop the column | Create |
| `packages/core/src/types/compute-target.types.ts` | Remove `isDefault` from `ComputeTarget` + args | Modify |
| `packages/compute/src/db.ts` | `COLS`, insert/update; delete `fetchDefaultComputeTarget` | Modify |
| `packages/compute/src/compute-target-record.ts` | Drop `isDefault` mapping | Modify |
| `packages/compute/src/index.ts` | Drop `fetchDefaultComputeTarget` export | Modify |
| `packages/compute/src/resolver.ts` | Throw when no `computeTargetId` (no fallback) | Modify |
| `packages/compute/src/routes/index.ts` | Drop `isDefault` from create/update bodies | Modify |
| `packages/core/src/validation/validate-for-publish.ts` | New `missing_compute_target` rule | Modify |
| `packages/orchestrator/src/workers/worker-harness.ts` | Treat `ComputeTargetNotFoundError` as terminal | Modify |
| `packages/flow-editor/src/flow-config/DefaultsComputeTargetSection.tsx` | Remove "Default" option; placeholder + required hint | Modify |
| `packages/flow-editor/src/properties-panel/tabs-shell.tsx` | Remove the per-node "worker" tab | Modify |
| `packages/web/src/api/computeTargets.ts` | Drop `isDefault` from `ComputeTarget` + upsert body | Modify |
| `packages/web/src/components/compute-targets/ComputeTargetFormModal.tsx` | Drop the "default" toggle | Modify |
| `packages/web/src/routes/ComputeTargetsPage.tsx` | Remove ★/Default column | Modify |

---

## Task 1: Drop `is_default` from the data layer

**Files:**
- Create: `packages/migrations/src/sql/039_drop_compute_target_is_default.sql`
- Modify: `packages/core/src/types/compute-target.types.ts`
- Modify: `packages/compute/src/db.ts`
- Modify: `packages/compute/src/compute-target-record.ts`
- Test: `packages/compute/src/compute-target-record.test.ts`

- [ ] **Step 1: Write the migration**

Create `packages/migrations/src/sql/039_drop_compute_target_is_default.sql`:

```sql
-- 039_drop_compute_target_is_default.sql
-- Remove the "default compute target" concept (Spec 2026-06-07): there is no
-- global default anymore — every workflow picks its target explicitly.
ALTER TABLE jm_compute_targets DROP COLUMN IF EXISTS is_default;
```

- [ ] **Step 2: Update the failing test**

In `packages/compute/src/compute-target-record.test.ts`, the existing `toEqual` for `rowToComputeTarget` includes `isDefault`. Remove that property from the expected object (the `"maps a snake_case DB row…"` test): delete the line `isDefault: false,` from the `expect(rec).toEqual({ … })` block.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -w @journeyman/compute -- compute-target-record`
Expected: FAIL — actual object still has `isDefault`.

- [ ] **Step 4: Remove `isDefault` from the core types**

In `packages/core/src/types/compute-target.types.ts`:
- In `interface ComputeTarget`, delete the line `isDefault: boolean;`.
- In `interface CreateComputeTargetArgs`, delete `isDefault?: boolean;`.
- In `interface UpdateComputeTargetArgs`, delete `isDefault?: boolean;`.

- [ ] **Step 5: Remove `isDefault` from the record mapper**

In `packages/compute/src/compute-target-record.ts`, delete the line:
```ts
    isDefault: Boolean(r.is_default),
```

- [ ] **Step 6: Remove `is_default` from `db.ts` (COLS + insert + update)**

In `packages/compute/src/db.ts`:

a) `COLS` — remove `is_default,`:
```ts
const COLS =
  "id, scope, org_id, user_id, name, type, execution_mode, connectivity, config, tags, enabled, created_by, created_at, updated_at, image_state, image_fingerprint, image_ref, image_error, image_built_at";
```

b) `insertComputeTarget` — drop the column + its parameter and renumber:
```ts
export async function insertComputeTarget(db: Queryable, input: CreateComputeTargetArgs): Promise<ComputeTarget> {
  const { rows } = await db.query(
    `INSERT INTO jm_compute_targets
       (scope, org_id, user_id, name, type, execution_mode, connectivity, config, tags, enabled, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11)
     RETURNING ${COLS}`,
    [
      input.scope, input.orgId, input.userId, input.name, input.type, input.executionMode,
      input.connectivity ?? null, JSON.stringify(input.config ?? {}),
      JSON.stringify(input.tags ?? []), input.enabled ?? true, input.createdBy,
    ],
  );
  return rowToComputeTarget(rows[0]);
}
```

c) `updateComputeTarget` — delete the line:
```ts
  if (input.isDefault !== undefined) set("is_default", input.isDefault);
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -w @journeyman/compute -- compute-target-record`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/migrations/src/sql/039_drop_compute_target_is_default.sql \
  packages/core/src/types/compute-target.types.ts packages/compute/src/db.ts \
  packages/compute/src/compute-target-record.ts packages/compute/src/compute-target-record.test.ts
git commit -m "feat(compute): drop is_default column + flag"
```

---

## Task 2: Resolver throws instead of falling back

**Files:**
- Modify: `packages/compute/src/resolver.ts`
- Modify: `packages/compute/src/db.ts` (delete `fetchDefaultComputeTarget`)
- Modify: `packages/compute/src/index.ts` (drop the export)
- Test: `packages/compute/src/resolver.test.ts`

- [ ] **Step 1: Update the failing tests**

In `packages/compute/src/resolver.test.ts`:

Replace the `"falls back to the default worker when workerId is undefined"` test with one that expects a throw:
```ts
  it("throws when no workerId is given (no default fallback)", async () => {
    await expect(
      resolveComputeTarget(dbReturning([localDefault]), { orgId: "o1", userId: "u1" }, undefined),
    ).rejects.toBeInstanceOf(ComputeTargetNotFoundError);
  });
```

The existing `"throws ComputeTargetNotFoundError when no default exists"` test now overlaps — delete it (the new test above covers the undefined-id case).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @journeyman/compute -- resolver`
Expected: FAIL — it currently returns the default instead of throwing.

- [ ] **Step 3: Remove the fallback in `resolver.ts`**

In `packages/compute/src/resolver.ts`, replace the import and the no-id branch:
```ts
import type { ResolvedComputeTarget, ComputeTarget } from "@journeyman/core";
import type { Queryable } from "./db.ts";
import { fetchComputeTargetById } from "./db.ts";
```
and the function body's tail:
```ts
export async function resolveComputeTarget(
  db: Queryable,
  ctx: ResolveComputeTargetCtx,
  workerId: string | undefined,
): Promise<ResolvedComputeTarget> {
  if (!workerId) {
    throw new ComputeTargetNotFoundError("no compute target selected for this workflow");
  }
  const w = await fetchComputeTargetById(db, ctx.orgId, ctx.userId, workerId);
  if (!w) throw new ComputeTargetNotFoundError(`compute target '${workerId}' not found or not visible`);
  return toResolved(w);
}
```

- [ ] **Step 4: Delete `fetchDefaultComputeTarget`**

In `packages/compute/src/db.ts`, delete the entire `fetchDefaultComputeTarget` function (the block starting with its doc comment `/** The org/user's default worker, falling back to the system default. */`).

In `packages/compute/src/index.ts`, remove `fetchDefaultComputeTarget` from the export list (the `export { … fetchComputeTargetById, fetchDefaultComputeTarget } from "./db.ts";` line → drop the trailing name).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w @journeyman/compute -- resolver && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/compute/src/resolver.ts packages/compute/src/db.ts \
  packages/compute/src/index.ts packages/compute/src/resolver.test.ts
git commit -m "feat(compute): resolveComputeTarget errors when no target selected"
```

---

## Task 3: Run-time guard — surface the error as terminal

**Files:**
- Modify: `packages/orchestrator/src/workers/worker-harness.ts`
- Test: (covered by the resolver test + manual; harness has integration coverage)

The harness `catch` already treats `err.name === "ConfigurationError"` as a terminal `FAILED_WITH_TERMINAL_ERROR`. A missing compute target throws `ComputeTargetNotFoundError` (name `"ComputeTargetNotFoundError"`), which would otherwise be classified as retryable `FAILED`. Make it terminal too.

- [ ] **Step 1: Extend the terminal-error branch**

In `packages/orchestrator/src/workers/worker-harness.ts`, find:
```ts
      if (err?.name === "ConfigurationError") {
```
and change the condition to:
```ts
      if (err?.name === "ConfigurationError" || err?.name === "ComputeTargetNotFoundError") {
```
(Leave the body as-is — it already emits a terminal `configuration_error` step.failed and completes the task with `FAILED_WITH_TERMINAL_ERROR`.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/orchestrator/src/workers/worker-harness.ts
git commit -m "feat(orchestrator): missing compute target is a terminal run error"
```

---

## Task 4: Publish validation requires a compute target

**Files:**
- Modify: `packages/core/src/validation/validate-for-publish.ts`
- Test: `packages/core/src/validation/validate-for-publish.test.ts` (create if absent)

The compute-target selection lives at `flow.defaults.computeTargetId` (legacy flows may carry `defaults.workerId` — accept either, mirroring `apply-flow-defaults.ts`).

- [ ] **Step 1: Write the failing test**

In `packages/core/src/validation/validate-for-publish.test.ts`, add (create the file with a minimal valid flow if it doesn't exist):
```ts
import { describe, it, expect } from "vitest";
import { validateForPublish } from "./validate-for-publish.ts";
import type { WorkflowGraph } from "../types/flow.types.ts";

function flowWith(defaults: Record<string, unknown>): WorkflowGraph {
  return {
    nodes: [
      { id: "t", type: "trigger-manual", position: { x: 0, y: 0 } },
      { id: "e", type: "end", position: { x: 1, y: 0 } },
    ],
    edges: [{ id: "t_e", type: "default", source: "t", target: "e" }],
    defaults,
  } as unknown as WorkflowGraph;
}

describe("validateForPublish — compute target", () => {
  it("errors when no compute target is set", () => {
    const r = validateForPublish(flowWith({}), { hasTrigger: true });
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.code === "missing_compute_target")).toBe(true);
  });

  it("passes when defaults.computeTargetId is set", () => {
    const r = validateForPublish(flowWith({ computeTargetId: "ct1" }), { hasTrigger: true });
    expect(r.errors.some(e => e.code === "missing_compute_target")).toBe(false);
  });

  it("accepts the legacy defaults.workerId field", () => {
    const r = validateForPublish(flowWith({ workerId: "ct1" }), { hasTrigger: true });
    expect(r.errors.some(e => e.code === "missing_compute_target")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @journeyman/core -- validate-for-publish`
Expected: FAIL — no `missing_compute_target` code exists yet.

- [ ] **Step 3: Add the error code**

In `packages/core/src/validation/validate-for-publish.ts`, add `"missing_compute_target"` to the `PublishError["code"]` union (after `"missing_config"`):
```ts
    | "missing_config"
    | "missing_compute_target"
```

- [ ] **Step 4: Add the validation rule**

In `validateForPublish`, right after `pushGraphErrors(flow, errors);`, add:
```ts
  const defaults = (flow as { defaults?: { computeTargetId?: string; workerId?: string } }).defaults;
  const computeTargetId = defaults?.computeTargetId ?? defaults?.workerId;
  if (!computeTargetId || computeTargetId.trim().length === 0) {
    errors.push({
      code: "missing_compute_target",
      message: "Select a compute target for this workflow before publishing.",
      detail: "Every workflow must explicitly choose where its steps run; there is no default.",
      fixes: ["Open Flow Defaults → Run target and pick a compute target."],
    });
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -w @journeyman/core -- validate-for-publish`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/validation/validate-for-publish.ts packages/core/src/validation/validate-for-publish.test.ts
git commit -m "feat(core): require a compute target at publish"
```

---

## Task 5: Workflow picker — no "Default", required placeholder

**Files:**
- Modify: `packages/flow-editor/src/flow-config/DefaultsComputeTargetSection.tsx`

- [ ] **Step 1: Replace the dropdown + helper text**

In `packages/flow-editor/src/flow-config/DefaultsComputeTargetSection.tsx`, replace the `<select>…</select>` block and the help text:
```tsx
        <select
          value={defaults.computeTargetId ?? ""}
          disabled={readOnly}
          onChange={(e) => setComputeTargetId(e.target.value || undefined)}
        >
          <option value="" disabled>— Select a compute target —</option>
          {workers.map((w) => (
            <option key={w.id} value={w.id}>{w.name} ({w.type} · {w.executionMode})</option>
          ))}
        </select>
      </div>
      {!defaults.computeTargetId && (
        <div className="je-props__field-help" style={{ marginTop: 4, color: "#f0a" }}>
          Required — pick where this workflow runs. Publishing is blocked until you choose one.
        </div>
      )}
      <div className="je-props__field-help" style={{ marginTop: 4 }}>
        Every step runs on this compute target. (Per-step overrides are coming later.)
      </div>
```
(Remove the old `<option value="">Default (system Local Workspace)</option>` and the old "Leave as Default to run in-process." help line.)

- [ ] **Step 2: Build the web app to typecheck the editor**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/flow-editor/src/flow-config/DefaultsComputeTargetSection.tsx
git commit -m "feat(flow-editor): require explicit compute target in picker"
```

---

## Task 6: Hide the per-node Compute Target tab

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/tabs-shell.tsx`

- [ ] **Step 1: Remove the "worker" tab from the rendered list**

In `packages/flow-editor/src/properties-panel/tabs-shell.tsx`, delete the entry from `ALL_TABS`:
```ts
  { id: "worker",          label: "Compute Target"           },
```
Leave the `TabId` type and `visibilityOf`'s `if (id === "worker")` branch in place (harmless; the tab is simply never listed, so it can't become active and its content never renders). This hides the per-node override without ripping out the underlying `node.computeTargetId` contract.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/flow-editor/src/properties-panel/tabs-shell.tsx
git commit -m "feat(flow-editor): hide per-node compute target override (future)"
```

---

## Task 7: Compute-targets UI — drop the default/★

**Files:**
- Modify: `packages/web/src/api/computeTargets.ts`
- Modify: `packages/web/src/components/compute-targets/ComputeTargetFormModal.tsx`
- Modify: `packages/web/src/routes/ComputeTargetsPage.tsx`

- [ ] **Step 1: Remove `isDefault` from the web API types**

In `packages/web/src/api/computeTargets.ts`:
- In `interface ComputeTarget`, delete `isDefault: boolean;`.
- In `interface ComputeTargetUpsertBody`, delete `isDefault?: boolean;`.

- [ ] **Step 2: Remove the "default" toggle from the form**

In `packages/web/src/components/compute-targets/ComputeTargetFormModal.tsx`, remove any state, checkbox/toggle, and request-body field referencing `isDefault` (search the file for `isDefault` and `default` and delete the related form control + its inclusion in the create/update payload). The submit payload must no longer send `isDefault`.

- [ ] **Step 3: Remove the ★/Default column from the list page**

In `packages/web/src/routes/ComputeTargetsPage.tsx`:
- Delete the `<th …>Default</th>` header and the matching `<td>` cell that renders `r.isDefault ? "★" : …`.
- Remove any "set as default" action if present.

- [ ] **Step 4: Build the web app**

Run: `npm run build:web`
Expected: build succeeds (no type errors for the removed field).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/api/computeTargets.ts \
  packages/web/src/components/compute-targets/ComputeTargetFormModal.tsx \
  packages/web/src/routes/ComputeTargetsPage.tsx
git commit -m "feat(web): remove default/★ from compute targets UI"
```

---

## Final verification

- [ ] **Step 1: Full check**

Run: `npm run check`
Expected: typecheck across all packages clean; `✓ Layer boundaries clean`.

- [ ] **Step 2: Targeted tests**

Run: `npm test -w @journeyman/compute && npm test -w @journeyman/core`
Expected: green (resolver, record, validate-for-publish).

- [ ] **Step 3: Migration sanity**

Run: `npm run migrate` (dev DB) — confirm `039` applies and `\d jm_compute_targets` no longer lists `is_default`.

- [ ] **Step 4: Manual (per the spec's Verification §)**

Fresh workflow → picker shows the `— Select a compute target —` placeholder, no "Default" option. Publishing with none → blocked with *"Select a compute target…"*; saving a draft → allowed. Old empty-target instance → terminal *"no compute target selected…"*. List page → no ★; Local Workspace not deletable. Properties panel → no Compute Target tab.

---

## Self-review notes

- **Spec coverage:** §1 drop is_default → Task 1. §2 resolver no fallback → Task 2. §3 run-time terminal → Task 3. §4 publish validation → Task 4. §5 picker → Task 5. §6 per-node hidden → Task 6. §7 list page → Task 7. §6 (existing flows error) → covered by Tasks 2+3 (no migration, by design).
- **Scope guard:** every `is_default`/`isDefault` edit is in a compute-target file; the coding-models and provider-catalog occurrences are explicitly out of scope.
- **Type consistency:** `computeTargetId` used everywhere for the selection; `ComputeTargetNotFoundError` (existing class) reused; new `missing_compute_target` code added to the `PublishError` union before use.
- **Open at execution:** `ComputeTargetFormModal.tsx` exact `isDefault` control isn't quoted (I didn't read it line-by-line) — search-and-remove during the task; the build in Step 4 catches any miss.
