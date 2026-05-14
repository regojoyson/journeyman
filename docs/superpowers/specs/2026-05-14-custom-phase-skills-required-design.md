# Custom Phase: "Skills Required" Flag — Design

**Date:** 2026-05-14
**Status:** Draft for review

## Problem

A custom AI phase may be unusable without skills attached (e.g. a "Code Review AI" phase whose behavior is entirely defined by the skills the flow author picks). Today, nothing enforces that flow authors actually attach skills before running such a phase. Empty `skillIds` is silently accepted, and the run either misbehaves or produces nothing useful.

The custom phase definition already supports `defaultSkillIds` — a suggested starter list. But defaults are advisory: flow authors can leave the skills list empty, and the validator has no way to know whether that's intentional or a bug.

## Goal

Let the phase author mark a custom phase as **"skills required"**. When a flow uses such a phase with no skills attached, the flow editor's existing validation pipeline surfaces a clear error and blocks save/run.

Pair this with auto-populating `defaultSkillIds` on drop, so the common case stays frictionless.

## Non-goals

- No new validation channel; reuse the existing topbar Validate panel + node warning-dot system.
- No per-instance override of the flag. The rule is set once, on the phase definition.
- No requirement that specific skills be picked; "any one skill" satisfies the rule.
- No retroactive scan of existing org/global phases for scope violations.

## Design

### 1. Data model

Add one boolean field to the custom phase definition.

```ts
// packages/custom-phases — CustomPhase record
requiresSkills?: boolean;   // default false
```

- DB: new column `requires_skills BOOLEAN NOT NULL DEFAULT false` on the custom-phases table.
- Adapter (`packages/custom-phases/src/db.ts`) reads/writes alongside `default_skill_ids`.
- Per-instance config schema (`customAiConfigSchema` in `packages/phases/src/custom/custom-ai.meta.ts`) is unchanged — `skillIds` already exists there.

### 2. Custom phase creation/edit UI

In the custom phase admin form, add a checkbox directly under "Default skills":

```
Default skills:       [ code-reviewer ] [ + add ]
☐ Skills required     ⓘ Workflows using this phase must have at least one skill attached.
```

Behavior:

- Plain checkbox bound to `requiresSkills`.
- If ticked **and** `defaultSkillIds` is empty, show a soft inline warning beneath the checkbox:

  > ⚠ No default skills set. Flow authors will have to pick skills manually each time. Consider adding defaults so the phase works out of the box.

- The warning is advisory only; it does not block saving the phase definition.

### 3. Flow-editor drop behavior (auto-populate defaults)

When a flow author drops a custom phase node onto the canvas, the node factory looks up the referenced custom phase. If the phase has non-empty `defaultSkillIds`, the new node's `skillIds` is initialized to a copy of that list.

- One-time copy on drop, **not** a live link. Later edits to `defaultSkillIds` on the phase definition do not modify existing nodes.
- The flow author can freely add/remove skills on the node afterwards.
- If `defaultSkillIds` is empty, the node starts with `[]` (today's behavior).
- This behavior applies regardless of `requiresSkills`; defaults are useful either way. The flag only governs validation.

### 3.5. Scope-safe defaults (promotion guard)

A custom phase's `defaultSkillIds` and `defaultMcpIds` must reference resources whose visibility scope is **greater than or equal to** the phase's own scope.

| Phase scope | Defaults may reference |
|---|---|
| User | User, org, or global skills/MCPs |
| Org | Org or global skills/MCPs |
| Global | Global skills/MCPs only |

This rule fires in three places:

1. **On phase save (create/edit at current scope):** validate defaults against the phase's current scope. Reject save with an inline error listing every offending entry.
2. **On promotion (e.g. user → org):** validate defaults against the target scope. Reject with a message that names every offending entry, e.g.:

   > Cannot promote to org: default skill 'my-private-skill' is user-scoped. Promote that skill to org first, or remove it from the defaults.

3. **On drop (safety net):** when a flow author drops a phase, filter `defaultSkillIds` and `defaultMcpIds` against what the current user can see before auto-populating. If `requiresSkills = true` and the filtered skill list ends up empty, the Section 4 validation error fires immediately.

The skill catalog and MCP catalog must expose a "get scope of resource by ID" lookup. If not already exposed, add it as part of this work.

### 4. Validation logic in the flow editor

Plug into the existing `validateWorkflowInputs` pipeline (`packages/flow-editor/src/state/validation.ts`) that already feeds the topbar Validate panel and node warning dots.

Per custom-phase node:

```
if node.type === "custom-ai":
  phaseDef = catalog.lookup(node.config.customPhaseId)
  if phaseDef?.requiresSkills && (node.config.skillIds ?? []).length === 0:
    emit error on this node
```

**Error message format:**

> &lt;Phase name&gt;: this phase requires at least one skill. Suggested: &lt;comma-separated default skill names&gt;. Add a skill in the Skills tab.

- If `defaultSkillIds` is empty, drop the "Suggested:" sentence.
- Resolve skill IDs to names via the skill catalog already used by the validator; fall back to the raw ID if name lookup fails.
- If `phaseDef` cannot be resolved (deleted phase), skip this rule — that's a separate error handled elsewhere.

**Where it surfaces:**

- Topbar Validate panel, listed alongside existing input-validation errors.
- Red warning dot on the phase node (existing `je-node-warning-dot` mechanism).
- Save/run is blocked, identical to any other validation error today.

**Catalog dependency:** extend the catalog consumed by `useValidationCatalog` so resolved custom phase definitions include `requiresSkills` and `defaultSkillIds`. Both fields already exist in the data; they just need to flow through to the validator.

### 5. Migration & back-compat

**Database migration:**

- Add column `requires_skills BOOLEAN NOT NULL DEFAULT false` on the custom phases table.
- All existing phases get `false`. No existing flow can fail validation due to this change.

**Code back-compat:**

- `requiresSkills` is optional in TS types; readers treat missing/false as "not required".
- Auto-populate on drop (Section 3) applies to **newly dropped** nodes only. Existing nodes in saved flows are untouched.
- If a phase author flips `requiresSkills = true` on a phase that's already used in saved flows: the next time those flows open in the editor, the validation rule evaluates against current node state. Nodes with empty `skillIds` start showing the error. This is intentional — the flag exists to flag exactly this kind of gap.

**Promotion guard for pre-existing phases:**

- The Section 3.5 rule fires only on **future** save/promote actions. No retroactive scan of existing org/global phases.
- If a previously-promoted phase already has scope-incompatible defaults, the drop-time safety net (Section 3.5 point 3) catches them.

**Rollout order:**

1. DB migration + type field.
2. Phase-creation UI checkbox + soft warning.
3. Promotion guard (Section 3.5) on save and promote.
4. Flow-editor drop auto-populate.
5. Flow-editor validation rule + error message in the existing panel.

Each step is independently shippable; nothing breaks if a later step lands later.

## End-to-end story

1. Phase author creates "Code Review AI", sets `defaultSkillIds = [code-reviewer]`, ticks **Skills required**. Saves.
2. Flow author drops the phase onto the canvas. Node auto-populates with `code-reviewer`. Validation passes. Zero friction.
3. Flow author later removes `code-reviewer` from the node. The topbar Validate panel shows: *"Code Review AI: this phase requires at least one skill. Suggested: code-reviewer. Add a skill in the Skills tab."* Node shows red warning dot. Save/run is blocked until a skill is added.
4. Phase author later promotes the phase from user to org scope, but `code-reviewer` is still user-scoped. Promotion is blocked with an explicit message naming the offending skill.

## Open questions

None at this time. All design questions resolved during brainstorming on 2026-05-14.
