# Permissive Save, Strict Publish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the workflow save endpoints from rejecting drafts that fail content validation; keep structural validation on save and full validation on publish.

**Architecture:** Introduce a structural-only check (`validateGraphStructure`) that wraps `ConductorJsonConverter.validateGraph`. Replace the two `validateAndWarnDefinition` callsites on the save path with it. `validateAndWarnDefinition` and `computeValidationReport` stay in place for the validate endpoint and the publish path's `validateForPublish` call.

**Tech Stack:** TypeScript, Fastify, `@journeyman/core` (`ConductorJsonConverter`).

**Spec:** [docs/superpowers/specs/2026-05-10-permissive-save-strict-publish-design.md](../specs/2026-05-10-permissive-save-strict-publish-design.md)

---

### Task 1: Add `validateGraphStructure` helper

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts` (add helper near `validateAndWarnDefinition` around line 268)

- [ ] **Step 1: Add the helper**

Add this function in `packages/api-server/src/routes/flows.ts`, immediately after `validateAndWarnDefinition` (after the closing `}` near line 284, before the `import { canCreateAtScope, ... }` block at line 285):

```ts
/** Save-path structural check: rejects only graphs that cannot round-trip
 *  through ConductorJsonConverter. Content-level validation (missing inputs,
 *  dangling refs, shape mismatches) is intentionally skipped on save and
 *  enforced only on publish via validateForPublish. */
function validateGraphStructure(
  definition: WorkflowGraph,
  reply: import("fastify").FastifyReply,
): { ok: true } | { ok: false } {
  try {
    ConductorJsonConverter.validateGraph(definition);
    return { ok: true };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    reply.code(400).send({
      error: "WorkflowValidationError",
      message,
      errors: [message],
    });
    return { ok: false };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no new errors).

- [ ] **Step 3: Commit**

```bash
git add packages/api-server/src/routes/flows.ts
git commit -m "feat(api): add validateGraphStructure helper for save-path checks"
```

---

### Task 2: Switch `POST /workflows` to structural-only validation

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts:382-384`

- [ ] **Step 1: Replace the validation block in `POST /workflows`**

In `packages/api-server/src/routes/flows.ts`, find this block in the `POST /workflows` handler (around line 382):

```ts
    const _customPhaseInputsCreate = await loadCustomPhaseInputs(c, body.definition as WorkflowGraph);
    const _v = validateAndWarnDefinition(body.definition as WorkflowGraph, reply, _customPhaseInputsCreate);
    if (!_v.ok) return;
```

Replace it with:

```ts
    const _v = validateGraphStructure(body.definition as WorkflowGraph, reply);
    if (!_v.ok) return;
```

(`loadCustomPhaseInputs` is dropped here — it was only feeding the content-validation tier, which no longer runs on save.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/api-server/src/routes/flows.ts
git commit -m "feat(api): permissive save on POST /workflows (structural check only)"
```

---

### Task 3: Switch `PUT /workflows/:id` to structural-only validation

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts:440-443`

- [ ] **Step 1: Replace the validation block in `PUT /workflows/:id`**

In `packages/api-server/src/routes/flows.ts`, find this block in the `PUT /workflows/:id` handler (around line 440, inside `if (body.definition) { ... }`):

```ts
      const _customPhaseInputsUpd = await loadCustomPhaseInputs(c, body.definition as WorkflowGraph);
      const _v = validateAndWarnDefinition(body.definition as WorkflowGraph, reply, _customPhaseInputsUpd);
      if (!_v.ok) return;
```

Replace it with:

```ts
      const _v = validateGraphStructure(body.definition as WorkflowGraph, reply);
      if (!_v.ok) return;
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/api-server/src/routes/flows.ts
git commit -m "feat(api): permissive save on PUT /workflows/:id (structural check only)"
```

---

### Task 4: Manual verification

No automated tests per spec. Verify the user-visible behavior:

- [ ] **Step 1: Start the API server and web app** as you normally do for local dev.

- [ ] **Step 2: Save with missing required input**

In the flow editor:
1. Create a new flow or open an existing draft.
2. Add any phase node that has a required input (e.g. a Git phase requiring `repoRef`).
3. Leave the required input empty.
4. Click **Save**.

Expected: Save succeeds (HTTP 200). The Topbar shows "saved" and no error toast appears.

- [ ] **Step 3: Validate button still surfaces the error**

Click the **Validate** button in the Topbar.

Expected: The validation panel lists the missing required input as an error.

- [ ] **Step 4: Publish blocks on the same error**

Click **Publish**.

Expected: Publish is rejected with HTTP 400; the publish modal / Topbar surfaces the validation error message.

- [ ] **Step 5: Structural break still blocks save**

Use the Import dialog to import a workflow JSON with a deliberately broken structure (e.g. an edge whose `source` references a non-existent node id), and click Save.

Expected: Save fails with HTTP 400 and a `WorkflowValidationError` message from `ConductorJsonConverter.validateGraph`.

- [ ] **Step 6: Published workflow guard still works (regression)**

Open a workflow in `ready` status and attempt to save.

Expected: HTTP 409 `workflow_is_ready` (existing behavior unchanged).

---

## Self-Review Notes

- **Spec coverage:** Tier 1 (structural) → Task 1 + the wiring in Tasks 2/3. Tier 2 (content dropped from save) → Tasks 2/3 remove the `validateAndWarnDefinition` calls. Publish path → unchanged, no task needed. Frontend → unchanged, no task needed. Edge cases all covered in Task 4 verification steps.
- **Placeholder scan:** No TBDs, all code shown verbatim, all commands explicit.
- **Type consistency:** `validateGraphStructure` returns the same `{ ok: true } | { ok: false }` shape as `validateAndWarnDefinition`, so the existing `if (!_v.ok) return;` callsite pattern works unchanged.
- **Imports:** `ConductorJsonConverter` and `WorkflowGraph` are already imported in `flows.ts` (used by `computeValidationReport`); no new imports required.
