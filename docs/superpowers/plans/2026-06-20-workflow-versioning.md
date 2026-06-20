# Workflow Versioning (Draft / Promote / Rollback) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "latest save is always live" model with a mutable draft, a deliberate Promote, an immutable promoted-version history, and Rollback.

**Architecture:** Approach A — the editable draft lives as a `draft_definition` JSONB column on `jm_workflows`; `jm_workflow_versions` becomes a pure immutable history written only on promote; `current_version_id` is renamed to `published_version_id` and decides what runs.

**Tech Stack:** TypeScript (npm workspaces monorepo), Fastify, PostgreSQL via `pg` (no ORM), React + @tanstack/react-query, Zod, Vitest.

**Requester constraints (override the skill defaults):**
- Work on the `master` branch only. Do **not** create branches.
- Do **not** commit. (All "commit" ceremony from the skill is intentionally omitted.)
- Run typecheck **once at the end** (Task 10), not per-task.

Spec: [docs/superpowers/specs/2026-06-20-workflow-versioning-design.md](../specs/2026-06-20-workflow-versioning-design.md)

---

## File Structure

**Modify:**
- `packages/core/src/types/flow.types.ts` — `Workflow` type: rename + draft fields.
- `packages/core/src/interfaces/workflow-store.interface.ts` — store method signatures.
- `packages/orchestrator/src/stores/postgres/postgres-flow-store.ts` — store impl.
- `packages/api-server/src/routes/flows.ts` — save/promote/rollback/versions/run/clone.
- `packages/api-server/src/services/workflow-trigger-index.ts` — drop dead function.
- `packages/api-server/src/routes/workflow-triggers.ts` — rename reader.
- `packages/api-server/src/routes/forms.ts` — rename reader.
- `packages/api-server/src/services/webhook-trigger-fire.ts` — rename reader.
- `packages/web/src/api/flows.ts` — client: promote/rollback/versions; create/update returns.
- `packages/web/src/routes/FlowEditorPage.tsx` — load draft, wire promote/rollback/history.

**Create:**
- `packages/core/src/types/workflow-draft.ts` — pure `graphsEqual` / `hasUnpublishedChanges` + re-export from index.
- `packages/core/src/types/workflow-draft.test.ts` — unit test for the pure helper.
- `packages/migrations/src/sql/061_workflow_drafts.sql` — schema + backfill.
- `packages/web/src/components/VersionHistoryPanel.tsx` — history list + rollback/view UI.

---

## Task 1: Core types — rename pointer + add draft fields

**Files:**
- Modify: `packages/core/src/types/flow.types.ts:174-185`
- Modify: `packages/core/src/interfaces/workflow-store.interface.ts`

- [ ] **Step 1: Update the `Workflow` interface**

In `packages/core/src/types/flow.types.ts`, replace the `Workflow` interface (currently lines 174-185) with:

```typescript
export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  /** The live version that triggers and manual runs use. NULL = nothing published. */
  publishedVersionId: string | null;
  /** The single mutable working copy. Always present. Overwritten on each save. */
  draftDefinition: WorkflowGraph;
  /** When the draft was last saved. */
  draftUpdatedAt: Date | null;
  /** Who last saved the draft. */
  draftUpdatedByUserId: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Strict mirror of publishedVersionId: 'ready' iff publishedVersionId is set. */
  status: WorkflowStatus;
  /** The workspace this flow belongs to. */
  workspaceId: string;
}
```

- [ ] **Step 2: Update the store interfaces**

In `packages/core/src/interfaces/workflow-store.interface.ts`, replace the `IWorkflowStore` interface body so `create` returns just the workflow (no version row is created on create anymore) and add the draft/promote/rollback methods. Replace lines 19-29 with:

```typescript
export interface IWorkflowStore {
  /** Creates a workflow with its draft seeded from initialDefinition. No version row, not published. */
  create(args: CreateWorkflowArgs): Promise<Workflow>;
  getById(workflowId: string): Promise<Workflow | null>;
  list(filter: WorkflowListFilter): Promise<Workflow[]>;
  count(filter: Omit<WorkflowListFilter, "limit" | "offset">): Promise<number>;
  /** Update name/description metadata. Does NOT touch the draft or versions. */
  updateMeta(workflowId: string, patch: { name?: string; description?: string | null }): Promise<Workflow | null>;
  /** Overwrite the mutable draft in place. Returns the updated workflow, or null if not found. */
  updateDraft(workflowId: string, args: { definition: WorkflowGraph; updatedByUserId: string | null }): Promise<Workflow | null>;
  /** Freeze the current draft into a new immutable version, set it published, status=ready. */
  promote(workflowId: string, args: { createdByUserId: string | null }): Promise<{ workflow: Workflow; version: WorkflowVersion } | null>;
  /** Point published at an existing version of this workflow, status=ready. Does NOT touch the draft. */
  rollback(workflowId: string, args: { versionId: string }): Promise<Workflow | null>;
  /** Lifecycle status flip to draft + clear published pointer. Returns the updated workflow, or null if not found. */
  setStatus(workflowId: string, status: WorkflowStatus): Promise<Workflow | null>;
  delete(workflowId: string): Promise<void>;
}
```

> Note: `WorkflowVersion` is already imported at the top of this file via the `flow.types.ts` import. Confirm the import line includes `WorkflowVersion` (it does today).

---

## Task 2: Pure draft-diff helper + unit test

**Files:**
- Create: `packages/core/src/types/workflow-draft.ts`
- Test: `packages/core/src/types/workflow-draft.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/types/workflow-draft.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { graphsEqual, hasUnpublishedChanges } from "./workflow-draft.ts";
import type { WorkflowGraph } from "./flow.types.ts";

const base: WorkflowGraph = {
  schemaVersion: 2,
  nodes: [{ id: "a", type: "step", stepType: "clone-repos" }],
  edges: [],
};

describe("graphsEqual", () => {
  it("treats identical graphs as equal regardless of key order", () => {
    const reordered: WorkflowGraph = {
      nodes: [{ stepType: "clone-repos", type: "step", id: "a" }],
      edges: [],
      schemaVersion: 2,
    };
    expect(graphsEqual(base, reordered)).toBe(true);
  });

  it("detects a changed node", () => {
    const changed: WorkflowGraph = { ...base, nodes: [{ id: "a", type: "step", stepType: "send-message" }] };
    expect(graphsEqual(base, changed)).toBe(false);
  });
});

describe("hasUnpublishedChanges", () => {
  it("is true when there is no published version", () => {
    expect(hasUnpublishedChanges(base, null)).toBe(true);
  });

  it("is false when draft equals published", () => {
    expect(hasUnpublishedChanges(base, { ...base })).toBe(false);
  });

  it("is true when draft differs from published", () => {
    const published: WorkflowGraph = { ...base, edges: [{ id: "e1", source: "a", target: "a" }] };
    expect(hasUnpublishedChanges(base, published)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace @journeyman/core -- workflow-draft`
Expected: FAIL — `Cannot find module './workflow-draft.ts'`.

- [ ] **Step 3: Implement the helper**

Create `packages/core/src/types/workflow-draft.ts`:

```typescript
import type { WorkflowGraph } from "./flow.types.ts";

/** Deterministic JSON serialization with sorted object keys (arrays keep order). */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** Structural equality of two workflow graphs, insensitive to object-key order. */
export function graphsEqual(a: WorkflowGraph, b: WorkflowGraph): boolean {
  return stableStringify(a) === stableStringify(b);
}

/**
 * True when the draft differs from what is published.
 * No published version ⇒ always true (the draft is unpublished work).
 */
export function hasUnpublishedChanges(draft: WorkflowGraph, published: WorkflowGraph | null): boolean {
  if (!published) return true;
  return !graphsEqual(draft, published);
}
```

- [ ] **Step 4: Export from the core barrel**

In `packages/core/src/index.ts`, find the block of `export * from "./types/flow*"` style lines and add:

```typescript
export * from "./types/workflow-draft.ts";
```

Place it immediately after the existing `export * from "./types/flow.types.ts";` line.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test --workspace @journeyman/core -- workflow-draft`
Expected: PASS (5 assertions).

---

## Task 3: Migration `061_workflow_drafts.sql`

**Files:**
- Create: `packages/migrations/src/sql/061_workflow_drafts.sql`

- [ ] **Step 1: Write the migration**

Create `packages/migrations/src/sql/061_workflow_drafts.sql`:

```sql
-- 061_workflow_drafts.sql
-- Draft / promote / publish model:
--   * draft_definition: the single mutable working copy (always present)
--   * current_version_id -> published_version_id (what actually runs; NULL = not live)
--   * jm_workflow_versions becomes a pure immutable history (written only on promote)

ALTER TABLE jm_workflows
  ADD COLUMN draft_definition          JSONB,
  ADD COLUMN draft_updated_at          TIMESTAMPTZ,
  ADD COLUMN draft_updated_by_user_id  TEXT;

ALTER TABLE jm_workflows
  RENAME COLUMN current_version_id TO published_version_id;

-- Seed every workflow's draft from its current/published version (status-agnostic).
UPDATE jm_workflows w
SET draft_definition         = v.definition,
    draft_updated_at         = w.updated_at,
    draft_updated_by_user_id = v.created_by_user_id
FROM jm_workflow_versions v
WHERE w.published_version_id = v.id;

-- Guard: any workflow without a version gets an empty graph.
UPDATE jm_workflows
SET draft_definition = '{"schemaVersion":2,"nodes":[],"edges":[]}'::jsonb,
    draft_updated_at = updated_at
WHERE draft_definition IS NULL;

-- Enforce invariant: only 'ready' workflows keep a published pointer.
UPDATE jm_workflows
SET published_version_id = NULL
WHERE status <> 'ready';

ALTER TABLE jm_workflows
  ALTER COLUMN draft_definition SET NOT NULL;
```

- [ ] **Step 2: Apply against the dev DB**

> The dev DB on port 5433 must be migrated manually (`infra:up` does not auto-migrate).

Run: `npm run migrate`
Expected: log line `applying 061_workflow_drafts`, no error.

- [ ] **Step 3: Verify the schema landed**

Run:
```bash
psql "$DATABASE_URL" -c "\d jm_workflows" | grep -E "draft_definition|published_version_id"
```
Expected: `draft_definition | jsonb | not null`, and `published_version_id` present (no `current_version_id`).

---

## Task 4: Postgres store — draft / promote / rollback

**Files:**
- Modify: `packages/orchestrator/src/stores/postgres/postgres-flow-store.ts`

- [ ] **Step 1: Update `rowToWorkflow`**

Replace the `rowToWorkflow` function (lines 8-20) with:

```typescript
function rowToWorkflow(row: any): Workflow {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    publishedVersionId: row.published_version_id,
    draftDefinition: row.draft_definition as WorkflowGraph,
    draftUpdatedAt: row.draft_updated_at ? new Date(row.draft_updated_at) : null,
    draftUpdatedByUserId: row.draft_updated_by_user_id,
    createdByUserId: row.created_by_user_id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    status: row.status as WorkflowStatus,
    workspaceId: row.workspace_id,
  };
}
```

- [ ] **Step 2: Rewrite `create` to seed the draft and create no version row**

Replace the `create` method (lines 74-109) with:

```typescript
  async create(args: CreateWorkflowArgs): Promise<Workflow> {
    const { rows } = await this.pool.query(
      `INSERT INTO jm_workflows
         (workspace_id, name, description, created_by_user_id,
          draft_definition, draft_updated_at, draft_updated_by_user_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, now(), $4)
       RETURNING *`,
      [args.workspaceId, args.name, args.description ?? null, args.createdByUserId,
       JSON.stringify(args.initialDefinition)],
    );
    return rowToWorkflow(rows[0]);
  }
```

- [ ] **Step 3: Add `updateDraft`, `promote`, `rollback`; update `setStatus`**

Replace the `setStatus` method (lines 147-154) with the following three new methods plus an updated `setStatus` that clears the pointer when flipping to draft:

```typescript
  async updateDraft(
    workflowId: string,
    args: { definition: WorkflowGraph; updatedByUserId: string | null },
  ): Promise<Workflow | null> {
    const { rows } = await this.pool.query(
      `UPDATE jm_workflows
         SET draft_definition = $1::jsonb,
             draft_updated_at = now(),
             draft_updated_by_user_id = $2,
             updated_at = now()
       WHERE id = $3
       RETURNING *`,
      [JSON.stringify(args.definition), args.updatedByUserId, workflowId],
    );
    return rows[0] ? rowToWorkflow(rows[0]) : null;
  }

  async promote(
    workflowId: string,
    args: { createdByUserId: string | null },
  ): Promise<{ workflow: Workflow; version: WorkflowVersion } | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const wf = await client.query("SELECT draft_definition FROM jm_workflows WHERE id = $1 FOR UPDATE", [workflowId]);
      if (!wf.rows[0]) { await client.query("ROLLBACK"); return null; }
      const verRes = await client.query(
        `INSERT INTO jm_workflow_versions (workflow_id, version_number, definition, created_by_user_id)
         VALUES ($1,
                 COALESCE((SELECT MAX(version_number) + 1 FROM jm_workflow_versions WHERE workflow_id = $1), 1),
                 $2::jsonb, $3)
         RETURNING *`,
        [workflowId, JSON.stringify(wf.rows[0].draft_definition), args.createdByUserId],
      );
      const updated = await client.query(
        `UPDATE jm_workflows SET published_version_id = $1, status = 'ready', updated_at = now()
         WHERE id = $2 RETURNING *`,
        [verRes.rows[0].id, workflowId],
      );
      await client.query("COMMIT");
      return { workflow: rowToWorkflow(updated.rows[0]), version: rowToVersion(verRes.rows[0]) };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async rollback(workflowId: string, args: { versionId: string }): Promise<Workflow | null> {
    const { rows } = await this.pool.query(
      `UPDATE jm_workflows SET published_version_id = $1, status = 'ready', updated_at = now()
       WHERE id = $2
         AND EXISTS (SELECT 1 FROM jm_workflow_versions WHERE id = $1 AND workflow_id = $2)
       RETURNING *`,
      [args.versionId, workflowId],
    );
    return rows[0] ? rowToWorkflow(rows[0]) : null;
  }

  async setStatus(workflowId: string, status: WorkflowStatus): Promise<Workflow | null> {
    const clearPointer = status === "draft";
    const { rows } = await this.pool.query(
      `UPDATE jm_workflows
         SET status = $1,
             published_version_id = CASE WHEN $2 THEN NULL ELSE published_version_id END,
             updated_at = now()
       WHERE id = $3 RETURNING *`,
      [status, clearPointer, workflowId],
    );
    return rows[0] ? rowToWorkflow(rows[0]) : null;
  }
```

> The `PostgresWorkflowVersionStore` class (lines 33-66) is unchanged — `appendVersion` stays for any external caller, but the route no longer uses it. `rowToVersion` is already defined at module scope (lines 22-31), so `promote` can call it.

- [ ] **Step 4: Fix the type import**

The top-of-file import already pulls `CreateWorkflowArgs, Workflow, WorkflowGraph, WorkflowListFilter, WorkflowStatus, WorkflowVersion, IWorkflowStore, IWorkflowVersionStore`. No change needed — `create`'s return type is now `Workflow` (already imported).

---

## Task 5: API routes — save / promote / rollback / versions / run / clone

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts`

- [ ] **Step 1: Rewrite the create handler to drop the version from the response**

Replace the body of `app.post("/workspaces/:wsId/workflows", ...)` (lines 384-400) with:

```typescript
  app.post("/workspaces/:wsId/workflows", write, async (req, reply) => {
    const ctx = req.runContext!;
    const { wsId } = req.params as { wsId: string };
    const body = createFlowBody.parse(req.body);

    const warnings = await computeSaveWarnings(c, ctx, body.definition as WorkflowGraph);

    const workflow = await c.workflows.create({
      workspaceId: wsId,
      name: body.name,
      description: body.description,
      initialDefinition: body.definition as WorkflowGraph,
      createdByUserId: ctx.user.id,
    });
    reply.code(201);
    return warnings.length ? { workflow, warnings } : { workflow };
  });
```

- [ ] **Step 2: Rewrite the PUT (save) handler to overwrite the draft**

Replace `app.put("/workspaces/:wsId/workflows/:id", ...)` (lines 433-460) with:

```typescript
  app.put("/workspaces/:wsId/workflows/:id", write, async (req, reply) => {
    const ctx = req.runContext!;
    const { wsId, id } = req.params as { wsId: string; id: string };
    const body = updateFlowBody.parse(req.body);

    const workflow = await loadInWorkspace(id, wsId);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }

    if (body.name !== undefined || body.description !== undefined) {
      await c.workflows.updateMeta(id, { name: body.name, description: body.description });
    }
    let warnings: WorkflowSaveWarning[] = [];
    if (body.definition) {
      warnings = await computeSaveWarnings(c, ctx, body.definition as WorkflowGraph);
      await c.workflows.updateDraft(id, {
        definition: body.definition as WorkflowGraph,
        updatedByUserId: ctx.user.id,
      });
    }
    const updated = await c.workflows.getById(id);
    return warnings.length ? { workflow: updated, warnings } : { workflow: updated };
  });
```

> This removes: the `409 workflow_is_ready` guard, `appendVersion`, and `refreshTriggerIndexOnVersionCreated`. Save no longer touches versions or trigger state.

- [ ] **Step 3: Remove the now-unused trigger-index import**

At the top of the file (lines 9-13), delete `refreshTriggerIndexOnVersionCreated` from the import so only the two still-used helpers remain:

```typescript
import {
  refreshTriggerIndexOnPublish,
  refreshTriggerIndexOnUnpublish,
} from "../services/workflow-trigger-index.ts";
```

- [ ] **Step 4: Point `versions/current` at the published version**

Replace `app.get("/workspaces/:wsId/workflows/:id/versions/current", ...)` (lines 471-479) with:

```typescript
  app.get("/workspaces/:wsId/workflows/:id/versions/current", read, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const workflow = await loadInWorkspace(id, wsId);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }
    if (!workflow.publishedVersionId) { reply.code(409); return { error: "workflow_has_no_versions" }; }
    const version = await c.workflowVersions.getById(workflow.publishedVersionId);
    if (!version) { reply.code(500); return { error: "version_missing" }; }
    return { version };
  });
```

> **Behavior change to verify (not a code change):** Previously `/versions/current` returned a version for *any* workflow (`current_version_id` was always set, even for drafts). Now it returns `409 workflow_has_no_versions` for an unpublished (draft) workflow, because `publishedVersionId` is `NULL` until first promote. The remaining caller is `RunsListPage.tsx:32` (`getCurrentWorkflowVersion`), which fetches the input shape for the run dialog. This is correct — you can only run a `ready` workflow, and `ready ⟺ publishedVersionId set` — but confirm `RunsListPage` is never rendered for a draft workflow (it is the runs/trigger view, reached only for ready workflows). If it can be hit for a draft, handle the 409 gracefully (empty inputs) rather than surfacing an error.

- [ ] **Step 5: Add the version-history list endpoint**

Immediately after the `versions/current` handler, add:

```typescript
  app.get("/workspaces/:wsId/workflows/:id/versions", read, async (req, reply) => {
    const { wsId, id } = req.params as { wsId: string; id: string };
    const workflow = await loadInWorkspace(id, wsId);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }
    const versions = await c.workflowVersions.listByWorkflow(id);
    const list = versions
      .slice()
      .sort((a, b) => b.versionNumber - a.versionNumber)
      .map((v) => ({
        id: v.id,
        versionNumber: v.versionNumber,
        createdAt: v.createdAt,
        createdByUserId: v.createdByUserId,
        isPublished: v.id === workflow.publishedVersionId,
      }));
    return { versions: list };
  });
```

- [ ] **Step 6: Replace `/publish` with `/promote`**

Replace the entire `app.post("/workspaces/:wsId/workflows/:id/publish", ...)` handler (lines 488-551) with a `/promote` handler that validates the **draft** and promotes it:

```typescript
  app.post("/workspaces/:wsId/workflows/:id/promote", write, async (req, reply) => {
    const ctx = req.runContext!;
    const { wsId, id } = req.params as { wsId: string; id: string };

    const workflow = await loadInWorkspace(id, wsId);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }

    const definition = workflow.draftDefinition;

    const visible = c.pool ? await listVisibleSecrets(c.pool, ctx) : [];
    const visibleSecretNames = new Set(visible.map(v => v.name));

    const customAiStepDefaults = new Map<string, { defaultTools?: readonly import("@journeyman/core").CanonicalTool[] }>();
    if (c.pool) {
      const customStepIds = new Set<string>();
      for (const node of definition.nodes) {
        if (node.type === "step" && node.stepType === "custom-ai") {
          const cid = (node.config as { customStepId?: unknown } | undefined)?.customStepId;
          if (typeof cid === "string" && cid) customStepIds.add(cid);
        }
      }
      for (const cid of customStepIds) {
        const step = await getCustomAiStep(c.pool, cid);
        if (step) customAiStepDefaults.set(cid, { defaultTools: step.defaultTools });
      }
    }

    try {
      const customStepDefs = await loadCustomStepShapes(c, definition);
      const catalogMap = new Map(stepCatalog.map(p => [
        p.stepType,
        { stepType: p.stepType, inputFields: p.inputFields, outputSchema: p.outputSchema },
      ]));
      ConductorJsonConverter.validateGraph(definition, catalogMap, customStepDefs);
    } catch (e) {
      reply.code(400);
      if (e instanceof WorkflowValidationError && e.diagnostic) return { errors: [e.diagnostic] };
      return { errors: [{ code: "shape_mismatch", message: e instanceof Error ? e.message : String(e) }] };
    }

    const result = validateForPublish(definition, {
      hasTrigger: hasWorkflowTrigger(definition),
      visibleSecretNames,
      stepConfigValidators: buildStepConfigValidators(stepCatalog),
      customAiStepDefaults,
    });
    if (!result.ok) { reply.code(400); return { errors: result.errors.filter(e => !e.severity || e.severity === "error") }; }

    const promoted = await c.workflows.promote(id, { createdByUserId: ctx.user.id });
    if (!promoted) { reply.code(500); return { error: "update_failed" }; }

    await refreshTriggerIndexOnPublish(c.workflowTriggers, {
      workflowId: promoted.workflow.id,
      workflowVersionId: promoted.version.id,
      graph: definition,
    });

    const warnings = result.errors.filter(e => e.severity === "warning");
    return { workflow: promoted.workflow, version: promoted.version, warnings };
  });
```

- [ ] **Step 7: Add the `/rollback` handler**

Immediately after the `/promote` handler, add:

```typescript
  app.post("/workspaces/:wsId/workflows/:id/rollback", write, async (req, reply) => {
    const ctx = req.runContext!;
    const { wsId, id } = req.params as { wsId: string; id: string };
    const { versionId } = (req.body ?? {}) as { versionId?: string };
    if (!versionId) { reply.code(400); return { error: "bad_request", message: "versionId is required" }; }

    const workflow = await loadInWorkspace(id, wsId);
    if (!workflow) { reply.code(404); return { error: "not_found" }; }

    const target = await c.workflowVersions.getById(versionId);
    if (!target || target.workflowId !== id) { reply.code(404); return { error: "version_not_found" }; }

    const visible = c.pool ? await listVisibleSecrets(c.pool, ctx) : [];
    const visibleSecretNames = new Set(visible.map(v => v.name));

    try {
      const customStepDefs = await loadCustomStepShapes(c, target.definition);
      const catalogMap = new Map(stepCatalog.map(p => [
        p.stepType,
        { stepType: p.stepType, inputFields: p.inputFields, outputSchema: p.outputSchema },
      ]));
      ConductorJsonConverter.validateGraph(target.definition, catalogMap, customStepDefs);
    } catch (e) {
      reply.code(400);
      if (e instanceof WorkflowValidationError && e.diagnostic) return { errors: [e.diagnostic] };
      return { errors: [{ code: "shape_mismatch", message: e instanceof Error ? e.message : String(e) }] };
    }

    const result = validateForPublish(target.definition, {
      hasTrigger: hasWorkflowTrigger(target.definition),
      visibleSecretNames,
      stepConfigValidators: buildStepConfigValidators(stepCatalog),
      customAiStepDefaults: new Map(),
    });
    if (!result.ok) { reply.code(400); return { errors: result.errors.filter(e => !e.severity || e.severity === "error") }; }

    const updated = await c.workflows.rollback(id, { versionId });
    if (!updated) { reply.code(500); return { error: "update_failed" }; }

    await refreshTriggerIndexOnPublish(c.workflowTriggers, {
      workflowId: updated.id,
      workflowVersionId: versionId,
      graph: target.definition,
    });

    return { workflow: updated };
  });
```

- [ ] **Step 8: Point the manual-run handler at the published version**

In `app.post("/workspaces/:wsId/workflows/:id/workflow-instances", ...)` (lines 574-607), replace the two `currentVersionId` references (lines 582-583) with:

```typescript
    if (!workflow.publishedVersionId) { reply.code(409); return { error: "workflow_has_no_versions" }; }
    const version = await c.workflowVersions.getById(workflow.publishedVersionId);
```

- [ ] **Step 9: Make clone copy the draft**

Replace the clone handler body (lines 611-630) so it forks the draft instead of the current version:

```typescript
  app.post("/workspaces/:wsId/workflows/:id/clone", write, async (req, reply) => {
    const ctx = req.runContext!;
    const { wsId, id } = req.params as { wsId: string; id: string };
    const body = cloneFlowBody.parse(req.body ?? {});
    const src = await loadInWorkspace(id, wsId);
    if (!src) { reply.code(404); return { error: "not_found" }; }

    const workflow = await c.workflows.create({
      workspaceId: wsId,
      name: body.name ?? `${src.name} (copy)`,
      description: src.description ?? undefined,
      initialDefinition: src.draftDefinition,
      createdByUserId: ctx.user.id,
    });
    reply.code(201);
    return { id: workflow.id };
  });
```

---

## Task 6: Other backend readers + drop dead trigger-index function

**Files:**
- Modify: `packages/api-server/src/services/workflow-trigger-index.ts:48-58`
- Modify: `packages/api-server/src/routes/workflow-triggers.ts:20`
- Modify: `packages/api-server/src/routes/forms.ts:21,35,52`
- Modify: `packages/api-server/src/services/webhook-trigger-fire.ts:79`
- Modify: `packages/api-server/src/services/webhook-trigger-fire.isolation.test.ts:28` (test mock)

- [ ] **Step 1: Delete `refreshTriggerIndexOnVersionCreated`**

In `packages/api-server/src/services/workflow-trigger-index.ts`, delete the entire `refreshTriggerIndexOnVersionCreated` function (the last export, lines 48-58 including its doc comment). Leave `rowsFromGraph`, `refreshTriggerIndexOnPublish`, and `refreshTriggerIndexOnUnpublish`.

- [ ] **Step 2: Rename the reader in `workflow-triggers.ts`**

Line 20 — change:
```typescript
    const versionId = wf.currentVersionId;
```
to:
```typescript
    const versionId = wf.publishedVersionId;
```

- [ ] **Step 3: Rename the readers in `forms.ts`**

There are three occurrences of `wf.currentVersionId` (lines 21, 35, 52), each in a `wf.status !== "ready" || !wf.currentVersionId` guard followed by `c.workflowVersions.getById(wf.currentVersionId)`. Change every `wf.currentVersionId` to `wf.publishedVersionId` (5 references total across those three blocks — both the guard and the `getById` call in each).

- [ ] **Step 4: Rename the reader in `webhook-trigger-fire.ts`**

Line 79 — change:
```typescript
      if (workflow.currentVersionId !== row.workflowVersionId) continue;
```
to:
```typescript
      if (workflow.publishedVersionId !== row.workflowVersionId) continue;
```

- [ ] **Step 5: Fix the isolation test mock (CRITICAL — silent runtime break, not a type error)**

`packages/api-server/src/services/webhook-trigger-fire.isolation.test.ts` builds a loosely-typed `workflow()` mock that is **not** strictly typed as `Workflow` (it carries extra `scope`/`ownerUserId`/`orgId` fields), so `npm run check` will **not** catch this. But the production reader changed in Step 4: it now reads `workflow.publishedVersionId`. If the mock still sets `currentVersionId`, the read is `undefined`, the `!== row.workflowVersionId` guard always `continue`s, and the test fails at runtime.

Line 28 — change:
```typescript
    currentVersionId: `${workflowId}-v1`,
```
to:
```typescript
    publishedVersionId: `${workflowId}-v1`,
```

- [ ] **Step 6: Run the isolation test to confirm green**

Run: `npm test --workspace @journeyman/api-server -- webhook-trigger-fire.isolation`
Expected: PASS.

---

## Task 7: Web API client — promote / rollback / versions; create+update returns

**Files:**
- Modify: `packages/web/src/api/flows.ts`

- [ ] **Step 1: Rename `publishFlow` → `promoteFlow` and point it at `/promote`**

Replace the `publishFlow` function (lines 11-29) with:

```typescript
export async function promoteFlow(
  wsId: string,
  workflowId: string,
): Promise<{ ok: true; workflow: Workflow; warnings: PublishError[] } | { ok: false; errors: PublishError[] }> {
  try {
    const res = await api<{ workflow: Workflow; warnings?: PublishError[] }>(
      `${wsBase(wsId)}/${encodeURIComponent(workflowId)}/promote`,
      { method: "POST", body: "{}" },
    );
    return { ok: true, workflow: res.workflow, warnings: res.warnings ?? [] };
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) {
      const body = e.body as { errors?: PublishError[] } | null;
      return { ok: false, errors: body?.errors ?? [] };
    }
    throw e;
  }
}
```

- [ ] **Step 2: Add `rollbackFlow` and `listWorkflowVersions`**

Immediately after `promoteFlow`, add:

```typescript
export async function rollbackFlow(
  wsId: string,
  workflowId: string,
  versionId: string,
): Promise<{ ok: true; workflow: Workflow } | { ok: false; errors: PublishError[] }> {
  try {
    const res = await api<{ workflow: Workflow }>(
      `${wsBase(wsId)}/${encodeURIComponent(workflowId)}/rollback`,
      { method: "POST", body: JSON.stringify({ versionId }) },
    );
    return { ok: true, workflow: res.workflow };
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) {
      const body = e.body as { errors?: PublishError[] } | null;
      return { ok: false, errors: body?.errors ?? [] };
    }
    throw e;
  }
}

export interface WorkflowVersionSummary {
  id: string;
  versionNumber: number;
  createdAt: string;
  createdByUserId: string | null;
  isPublished: boolean;
}

export async function listWorkflowVersions(wsId: string, workflowId: string): Promise<WorkflowVersionSummary[]> {
  const res = await api<{ versions: WorkflowVersionSummary[] }>(
    `${wsBase(wsId)}/${encodeURIComponent(workflowId)}/versions`,
  );
  return res.versions;
}
```

- [ ] **Step 3: Update `createFlow` return type (no version row)**

Replace `createFlow` (lines 88-96) with:

```typescript
export async function createFlow(wsId: string, args: {
  name: string;
  description?: string;
  definition: WorkflowGraph;
}): Promise<{ workflow: Workflow }> {
  return await api<{ workflow: Workflow }>(wsBase(wsId), {
    method: "POST", body: JSON.stringify(args),
  });
}
```

- [ ] **Step 4: Update `updateFlowDefinition` / `updateFlowMeta` return types (no version row)**

Replace both functions (lines 98-114) with:

```typescript
export async function updateFlowDefinition(wsId: string, workflowId: string, definition: WorkflowGraph): Promise<{ workflow: Workflow }> {
  return await api<{ workflow: Workflow }>(
    `${wsBase(wsId)}/${encodeURIComponent(workflowId)}`,
    { method: "PUT", body: JSON.stringify({ definition }) },
  );
}

export async function updateFlowMeta(
  wsId: string,
  workflowId: string,
  meta: { name?: string; description?: string },
): Promise<{ workflow: Workflow }> {
  return await api<{ workflow: Workflow }>(
    `${wsBase(wsId)}/${encodeURIComponent(workflowId)}`,
    { method: "PUT", body: JSON.stringify(meta) },
  );
}
```

- [ ] **Step 5: Check for other importers of the renamed symbol**

Run: `grep -rn "publishFlow\|createFlow\|\.version\b" packages/web/src --include="*.tsx" --include="*.ts" | grep -v "api/flows.ts"`
Expected hits to fix: `FlowEditorPage.tsx` (handled in Task 8). If any other file destructures `{ version }` from `createFlow`/`updateFlow*`, update it to use `{ workflow }` only.

---

## Task 8: FlowEditorPage — load the draft, wire promote/rollback/history

**Files:**
- Modify: `packages/web/src/routes/FlowEditorPage.tsx`

- [ ] **Step 1: Swap the version fetch for the draft and update imports**

Replace the import on line 6 with:

```typescript
import { getFlow, updateFlowDefinition, updateFlowMeta, validateFlowDefinition, promoteFlow, unpublishFlow, deleteFlow, rollbackFlow, type UnpublishWarning } from "../api/flows.ts";
```

Add, after the existing import block:

```typescript
import { VersionHistoryPanel } from "../components/VersionHistoryPanel.tsx";
```

- [ ] **Step 2: Delete the `versionQ` query and seed the graph from the draft**

Delete the entire `versionQ = useQuery({...})` block (lines 41-58). Replace the graph-init effect (lines 60-82) with one that reads `flowQ.data.draftDefinition`:

```typescript
  useEffect(() => {
    if (!id || graph) return;
    const cached = qc.getQueryData<WorkflowGraph>(["flow-graph", id]);
    if (cached) { setGraph(cached); return; }
    if (flowQ.data) setGraph(flowQ.data.draftDefinition);
  }, [id, graph, qc, flowQ.data]);
```

- [ ] **Step 3: Update the save mutation success handler**

The save `onSuccess` invalidates `["flow-version-current", id]`, which no longer drives the editor. Replace the `saveM` mutation (lines 95-107) with:

```typescript
  const saveM = useMutation({
    mutationFn: (next: WorkflowGraph) => updateFlowDefinition(wsId, id!, next),
    onSuccess: (res, next) => {
      qc.setQueryData(["flow-graph", id], next);
      qc.setQueryData(["flow", id], res.workflow);
      setDirty(false);
      setSaveToast({ kind: "success", message: "Draft saved." });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Could not save the draft.";
      setSaveToast({ kind: "error", message: msg });
    },
  });
```

- [ ] **Step 4: Fix the loading guard (no more `versionQ`)**

Replace the loading guard (lines 142-152) with:

```typescript
  if (!id) { navigate(`/workspaces/${wsId}/workflows`); return null; }
  if (flowQ.isLoading || !graph) {
    return <div style={{ padding: 24, color: "rgb(var(--color-text-muted) / 1)" }}>Loading editor…</div>;
  }
```

- [ ] **Step 5: Point `onPublish` at `promoteFlow` and add history/rollback state**

Replace the `onPublish` handler (lines 161-170) with:

```typescript
  const onPublish = async () => {
    const res = await promoteFlow(wsId, flow.id);
    if (res.ok) {
      qc.setQueryData(["flow", id], res.workflow);
      qc.invalidateQueries({ queryKey: ["flows"] });
      qc.invalidateQueries({ queryKey: ["flow-versions", id] });
      setSaveToast({ kind: "success", message: "Promoted — this version is now live." });
      return { ok: true as const };
    }
    return { ok: false as const, serverErrors: res.errors };
  };
```

Add this state near the other `useState` calls (after line 21):

```typescript
  const [historyOpen, setHistoryOpen] = useState(false);
```

Add a rollback handler next to `onPublish`:

```typescript
  const onRollback = async (versionId: string) => {
    const res = await rollbackFlow(wsId, flow.id, versionId);
    if (res.ok) {
      qc.setQueryData(["flow", id], res.workflow);
      qc.invalidateQueries({ queryKey: ["flows"] });
      qc.invalidateQueries({ queryKey: ["flow-versions", id] });
      setSaveToast({ kind: "success", message: "Rolled back — the selected version is now live." });
    } else {
      setSaveToast({ kind: "error", message: res.errors[0]?.message ?? "Rollback failed." });
    }
  };
```

- [ ] **Step 6: Render the history panel**

In the returned JSX, immediately after the closing tag of the `<div style={{ flex: 1, minHeight: 0 }}>` block that wraps `<FlowEditor .../>`, add a toggle button and the panel. Insert this right before the `{saveToast && (` block:

```tsx
      {caps.canPublish && (
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          style={{ position: "absolute", top: 8, right: 12, zIndex: 5 }}
        >
          {historyOpen ? "Hide history" : "Version history"}
        </button>
      )}
      {historyOpen && (
        <VersionHistoryPanel
          wsId={wsId}
          workflowId={flow.id}
          onRollback={onRollback}
          onClose={() => setHistoryOpen(false)}
        />
      )}
```

> The outer wrapper `<div style={{ height: "100%", ... }}>` needs `position: "relative"` for the absolutely-positioned button. Add `position: "relative"` to that style object (the first child div in the return).

---

## Task 9: Version history panel component

**Files:**
- Create: `packages/web/src/components/VersionHistoryPanel.tsx`

- [ ] **Step 1: Create the component**

Create `packages/web/src/components/VersionHistoryPanel.tsx`:

```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listWorkflowVersions, type WorkflowVersionSummary } from "../api/flows.ts";

interface Props {
  wsId: string;
  workflowId: string;
  onRollback: (versionId: string) => Promise<void>;
  onClose: () => void;
}

export function VersionHistoryPanel({ wsId, workflowId, onRollback, onClose }: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const versionsQ = useQuery({
    queryKey: ["flow-versions", workflowId],
    queryFn: () => listWorkflowVersions(wsId, workflowId),
  });

  const versions: WorkflowVersionSummary[] = versionsQ.data ?? [];

  return (
    <div style={{
      position: "absolute", top: 0, right: 0, bottom: 0, width: 340, zIndex: 10,
      background: "rgb(var(--color-surface) / 1)", borderLeft: "1px solid rgb(var(--color-border) / 1)",
      display: "flex", flexDirection: "column", padding: 16, overflowY: "auto",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <strong>Version history</strong>
        <button type="button" onClick={onClose}>Close</button>
      </div>

      {versionsQ.isLoading && <div>Loading…</div>}
      {!versionsQ.isLoading && versions.length === 0 && (
        <div style={{ fontSize: 13, color: "rgb(var(--color-text-muted) / 1)" }}>
          No versions yet. Promote the draft to create the first version.
        </div>
      )}

      {versions.map((v) => (
        <div key={v.id} style={{
          border: "1px solid rgb(var(--color-border) / 1)", borderRadius: 6,
          padding: 10, marginBottom: 8,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>v{v.versionNumber}</span>
            {v.isPublished && (
              <span style={{ fontSize: 11, color: "rgb(var(--color-success) / 1)" }}>live</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: "rgb(var(--color-text-muted) / 1)" }}>
            {new Date(v.createdAt).toLocaleString()}
          </div>
          {!v.isPublished && (
            confirmId === v.id ? (
              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                <button type="button" onClick={async () => { await onRollback(v.id); setConfirmId(null); }}>
                  Confirm rollback
                </button>
                <button type="button" onClick={() => setConfirmId(null)}>Cancel</button>
              </div>
            ) : (
              <button type="button" style={{ marginTop: 8 }} onClick={() => setConfirmId(v.id)}>
                Rollback to this
              </button>
            )
          )}
        </div>
      ))}
    </div>
  );
}
```

> "View read-only in the canvas" is intentionally deferred to a follow-up — the spec requires the history list and rollback; in-canvas read-only preview is additive and not on the critical path. If desired later, add a `View` button that calls `getWorkflowVersionById` and lifts the definition up to the editor with `readOnly`.

---

## Task 10: Typecheck + boundary check (single end gate)

**Files:** none

- [ ] **Step 1: Run the full check**

Run: `npm run check`
Expected: PASS — both `npm run typecheck` and `npm run check:boundaries` succeed with no errors.

- [ ] **Step 2: Run the core unit test**

Run: `npm test --workspace @journeyman/core -- workflow-draft`
Expected: PASS (the Task 2 test).

- [ ] **Step 3: Fix any type errors surfaced by the rename**

If `npm run check` reports a `currentVersionId` / `.version` reference not covered above, fix it in place (rename to `publishedVersionId`, or drop the destructured `version`). Re-run `npm run check` until green.

---

## Self-Review Notes (author)

- **Spec coverage:** draft column + rename (Task 1, 3, 4); promote (Task 5 step 6); rollback (Task 5 step 7); history list (Task 5 step 5, Task 9); editor loads draft (Task 8); migration/backfill (Task 3); `status` mirrors pointer invariant (Task 4 setStatus/promote/rollback + migration); trigger index moved to promote, dead fn removed (Task 5 step 3, Task 6 step 1); clone copies draft (Task 5 step 9); manual run uses published (Task 5 step 8). `hasUnpublishedChanges` helper built (Task 2) — wiring it into the editor header is left additive (the panel + draft loading satisfy the in-scope requirement; surface the indicator when convenient).
- **Out of scope confirmed absent:** no diff, no labels, no draft test-run, no per-save history.
- **Type consistency:** `promoteFlow`/`rollbackFlow`/`listWorkflowVersions` names match between client (Task 7) and editor (Task 8); `publishedVersionId`/`draftDefinition` match between core type (Task 1), store (Task 4), and all readers (Task 5, 6).
