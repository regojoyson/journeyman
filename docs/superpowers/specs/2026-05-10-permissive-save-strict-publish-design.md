# Permissive Save, Strict Publish — Design

**Date:** 2026-05-10
**Status:** Approved

## Problem

The workflow save endpoints (`POST /workflows`, `PUT /workflows/:id`) currently
reject saves with HTTP 400 when content validation fails (missing required
inputs, dangling refs, shape mismatches). Users cannot save in-progress drafts.

Validation errors should only block **publishing**, not saving. The flow editor
already exposes a Validate button (non-destructive `POST /workflows/validate`)
to surface errors during editing, and a Publish button that should enforce
them.

## Goals

- Save endpoints accept drafts even when content validation fails.
- Publish endpoint continues to enforce full validation.
- Structurally corrupt graphs (cannot round-trip through
  `ConductorJsonConverter`) are still rejected on save — persisting them would
  break the record.
- No frontend changes; the live validation overlay and Validate button keep
  working unchanged.

## Non-goals

- Changing `validateForPublish` or the publish endpoint.
- Changing the Validate endpoint or the editor's live warnings.
- Reworking `computeValidationReport` — it stays as-is and is still used by
  the validate and publish paths.

## Design

Split save-time validation into two tiers.

### Tier 1 — Structural (still blocks save)

Run only `ConductorJsonConverter.validateGraph(definition)`. If it throws, the
graph cannot round-trip through the converter and persisting it would corrupt
the workflow. Return 400 with the converter's error message.

### Tier 2 — Content (no longer blocks save)

- Missing required inputs (Check 1 in `computeValidationReport`)
- Shape / ref validation via `validateWorkflowInputs` (Check 2)

These are dropped from the save path. They remain enforced by
`validateForPublish` on `POST /workflows/:id/publish`, so publishing a draft
with missing inputs still fails with 400 — the existing behavior.

## Changes

### `packages/api-server/src/routes/flows.ts`

1. Add a new helper:
   ```ts
   function validateGraphStructure(
     definition: WorkflowGraph,
     reply: FastifyReply,
   ): { ok: true } | { ok: false } {
     try {
       ConductorJsonConverter.validateGraph(definition);
       return { ok: true };
     } catch (e) {
       reply.code(400).send({
         error: "WorkflowValidationError",
         message: e instanceof Error ? e.message : String(e),
       });
       return { ok: false };
     }
   }
   ```

2. Replace the two `validateAndWarnDefinition` callsites:
   - `POST /workflows` (line ~383)
   - `PUT /workflows/:id` (line ~442)

   Both switch to `validateGraphStructure(...)`. The accompanying
   `loadCustomPhaseInputs` calls on the save path can be dropped — they were
   only feeding the content-validation tier.

3. Keep `validateAndWarnDefinition` and `computeValidationReport` exported and
   intact. They're still used by `POST /workflows/validate` and the publish
   endpoint indirectly via `validateForPublish`.

4. Keep `computeSaveWarnings` (secret warnings) on the save path — those are
   already non-blocking and surfaced as `warnings` in the response.

### Publish path

Unchanged. `POST /workflows/:id/publish` still calls `validateForPublish` and
returns 400 with the full error list when validation fails.

### Frontend

No changes. `ValidationProvider`, the Topbar Validate button, the input
warnings overlay, and the Publish modal continue to work against the
unchanged validate and publish endpoints.

## Edge cases

| Scenario                                                    | Behavior                                               |
| ----------------------------------------------------------- | ------------------------------------------------------ |
| Save a graph with cycles, missing start, or bad edge refs   | Rejected (structural — converter throws)               |
| Save a graph missing required inputs                        | Accepted; persists as draft                            |
| Save a graph with dangling refs / shape mismatches          | Accepted; persists as draft                            |
| Publish a draft with content validation errors              | Rejected with 400 (unchanged from today)               |
| Save attempt against a published (`status === "ready"`)     | Rejected with 409 — existing guard unchanged           |

## Verification

Manual smoke test in the flow editor:
- Add a phase node, leave a required input empty, click Save → succeeds.
- Click Validate → shows the missing input.
- Click Publish → blocked with the same error.
- Save a structurally broken graph (e.g. orphan edge via import) → 400.
