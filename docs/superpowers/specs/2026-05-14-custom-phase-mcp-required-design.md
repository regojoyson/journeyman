# Custom Phase: "MCP Required" Flag — Design

**Date:** 2026-05-14
**Status:** Draft

## Problem

Some custom AI phases are non-functional without an MCP server attached (e.g. a phase whose tools all come from a specific MCP). Today, an empty `mcpInstanceIds` list is silently accepted, the run produces nothing useful, and the flow author has no feedback that they forgot to attach an MCP.

## Goal

Mirror the existing "Skills required" pattern. Let the phase author flip a checkbox on the custom phase definition; if a flow uses that phase without any MCP attached, the flow editor's validation pipeline surfaces an error and blocks save/run.

## Non-goals

- **No auto-populate on drop.** Unlike skills, MCPs carry credentials. Silently attaching `defaultMcpIds` to a new node would bind credentials the flow author hasn't reviewed. The flow author must pick explicitly. `defaultMcpIds` stays as suggestion-only.
- No new error channel — reuse the existing topbar Validate panel + node warning dot.
- No per-instance override of the flag — set once on the phase definition.

## Design

### 1. Data model

Add one boolean to the custom phase definition:

```ts
// @journeyman/core — CustomAiPhase
requiresMcp: boolean;   // default false
```

DB migration `023_custom_phase_requires_mcp.sql`:
```sql
ALTER TABLE jm_custom_ai_phases
  ADD COLUMN requires_mcp boolean NOT NULL DEFAULT false;
```

Read/write in `packages/custom-phases/src/db.ts` alongside `requiresSkills`. The per-instance config schema is unchanged — `mcpInstanceIds` already exists on `CustomAiConfig`.

### 2. Admin form

Second checkbox in the Definition tab of `EditCustomPhaseModal`, directly under "Skills required":

```
☐ Skills required
☐ MCP required        Workflows using this phase must have at least one MCP attached.
```

If ticked and `defaultMcpIds` is empty → soft warning:

> ⚠ No default MCPs set. Flow authors will have to pick MCPs manually each time. Consider adding defaults so the phase works out of the box.

Warning is advisory only — does not block save.

### 3. NO auto-populate on drop

Explicitly skip the auto-populate behavior that `defaultSkillIds` gets. Reason: MCPs typically carry credentials (API keys, OAuth tokens) via secret bindings. Silently attaching them to a freshly dropped node would grant the new phase access to credentials the flow author has not reviewed. Flow authors must explicitly choose an MCP through the MCP tab. `defaultMcpIds` is referenced only as a suggestion in the validation error message.

### 4. Validator extension

Mirror the `requiresSkills` rule in `packages/core/src/utils/validate-workflow.ts`. Inside the existing per-node loop's custom-ai block:

```
if cpDef.requiresMcp:
  count = (node.config.mcpInstanceIds ?? []).length
  if count === 0:
    emit warning on this node
```

Error message:

> *"<Phase name>: this phase requires at least one MCP. Suggested: <default MCP names>. Add an MCP in the MCP tab."*

(If `defaultMcpIds` is empty, drop the "Suggested:" sentence.)

Surfaces via the same topbar panel + node warning dot used today. Save/run is blocked.

Extend `CustomPhaseValidationEntry`:

```ts
export interface CustomPhaseValidationEntry {
  name: string;
  requiresSkills: boolean;
  defaultSkillIds: string[];
  requiresMcp: boolean;
  defaultMcpIds: string[];
}
```

### 5. Scope guard

No new work. `assertScopeSafeDefaults` already validates `defaultMcpIds` on save/promote. The same protection that covers skills covers MCPs.

### 6. Migration & back-compat

- New column defaults to `false`. No existing flow can fail validation due to this change.
- `requiresMcp` is optional in TS create inputs; readers treat missing/false as "not required".
- If a phase author flips `requiresMcp = true` on a phase already used in saved flows, the next time those flows open in the editor the rule evaluates — nodes with empty `mcpInstanceIds` start showing the error. This is intentional.

### 7. End-to-end story

1. Phase author creates "Linear MCP Phase", sets `defaultMcpIds = [linear-mcp]`, ticks **MCP required**. Saves.
2. Flow author drops the phase. Node's `mcpInstanceIds` is `[]` (no auto-populate). Validation immediately surfaces: *"Linear MCP Phase: this phase requires at least one MCP. Suggested: linear-mcp. Add an MCP in the MCP tab."*
3. Flow author opens the MCP tab, picks the suggested MCP (or another), reviews any required secret bindings, attaches it. Validation passes.

## Open questions

None. All design choices resolved on 2026-05-14.
