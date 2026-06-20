# Agent MCP + Skills support — design

**Date:** 2026-06-21
**Status:** Approved (pending implementation plan)

## Problem

Agents (`@journeyman/agents`) already carry `connectorMcpIds: string[]` and `skillIds: string[]` in their data model, and the entire runtime path that consumes them is wired and working. But there is **no UI to edit those fields**, and the web form layer explicitly drops them. So a user cannot attach MCP connectors or skill packages to an agent — the capability exists everywhere except where a person can reach it.

Separately, the flow-editor's existing MCP and skills pickers are broken: they fetch from org-scoped URLs (`/api/orgs/:orgId/...`) that no longer exist after the workspace-scoping migration. Only workspace-scoped endpoints remain.

## What already works (do not rebuild)

The full runtime path is implemented and verified by code inspection:

1. `agent.connectorMcpIds` / `agent.skillIds` persist in `jm_agents.definition` (JSONB).
2. `PATCH /api/workspaces/:wsId/agents/:id` already accepts and merges these fields (no field restriction on the backend).
3. `packages/agents/src/compile.ts` maps `connectorMcpIds → node.config.mcpInstanceIds` and `skillIds → node.config.skillPackageIds` when compiling an agent into its single-step workflow.
4. `packages/orchestrator/src/workers/worker-harness.ts` resolves those IDs into `ResolvedMcpInstance[]` / `ResolvedSkillPackage[]` via `mcpResolver` / `skillsResolver`.
5. `packages/orchestrator/src/workers/steps/agent-run-step-handler.ts` provisions a workspace when MCPs or skills are present.
6. `packages/agent-runtime/src/providers/claude/operations/run-custom-prompt.ts` converts resolved MCPs/skills into SDK `mcpServers` / `plugins` and runs them inside the sandbox.

The workspace-scoped "visible" endpoints already exist:

- `GET /api/workspaces/:wsId/mcp-instances/visible` — `packages/mcp/src/routes/workspace-mcp.ts:73`
- `GET /api/workspaces/:wsId/skill-packages/visible` — `packages/skills/src/routes/workspace-skills.ts:59`

Each returns items with `{ id, name, scope: "user" | "org", ... }`. The skills response additionally includes `installStatus` and `enabledSkillCount`.

## Scope

Three small, related changes. No backend endpoints, no migrations, no runtime changes.

### Part 1 — Agent editor: new "Integrations" section

A single section (per the chosen layout) titled **MCP & skills** containing two stacked pickers.

**`packages/web/src/components/agents/sections/SectionNav.tsx`**
- Add `"integrations"` to the `SectionId` union.
- Add a `SECTIONS` entry: `{ id: "integrations", label: "MCP & skills", icon: "🔌" }`, placed after `permissions` and before `notifications`.

**`packages/web/src/components/agents/agent-form.ts`**
- Add `connectorMcpIds: a.connectorMcpIds` and `skillIds: a.skillIds` to `buildUpdateInput`.
- Add `integrations: ["connectorMcpIds", "skillIds"]` to `SECTION_FIELDS`.
- Add `"integrations"` to `SAVEABLE_SECTION_IDS`.

(These three additions are what make the section save through the existing `buildSectionUpdateInput` / `isSectionDirty` machinery, which derives everything from `SECTION_FIELDS`.)

**`packages/web/src/components/agents/sections/IntegrationsSection.tsx`** (new)
- Signature follows the section convention plus `wsId`: `{ a, patch, locked, wsId }` — mirrors `WorkspaceSection`.
- Wraps content in the standard `SectionShell` with a one-line description ("Connectors and skill packages the agent loads when it runs in the sandbox.").
- Renders two pickers stacked: an MCP connector picker bound to `a.connectorMcpIds` and a skill package picker bound to `a.skillIds`.
- On change, calls `patch({ connectorMcpIds: next })` / `patch({ skillIds: next })`.
- Respects `locked` (disables toggles when the agent is enabled/locked, same as other sections).

**`packages/web/src/components/agents/AgentDetail.tsx`**
- Render `{section === "integrations" && <IntegrationsSection a={a} patch={patch} locked={locked} wsId={wsId} />}` alongside the existing section conditionals. `wsId` is already in scope.

### Part 2 — Shared picker primitives (inside `packages/web`)

To avoid duplicating two near-identical list pickers, add small controlled components under `packages/web/src/components/agents/` (e.g. a `shared/` subfolder):

- `VisibleMcpPicker` — fetches `GET /api/workspaces/${wsId}/mcp-instances/visible`, renders a multi-select checkbox list, `value: string[]` + `onChange(next: string[])`.
- `VisibleSkillPicker` — fetches `GET /api/workspaces/${wsId}/skill-packages/visible`, same shape; shows `enabledSkillCount` as a secondary label.

Both: loading state, empty state with a link to manage (`/me/...` and `/admin/...`), sorted by scope (org first) then name, and a `disabled` prop. These stay inside `packages/web` — no cross-package extraction into `@journeyman/theme` (YAGNI; the flow-editor keeps its own variants, which carry extra concerns described below).

### Part 3 — Fix the broken flow-editor pickers

Repoint the dead org-scoped fetches to the workspace endpoints. The flow-editor already exposes a `useWsId()` hook (`packages/flow-editor/src/state/org-context.tsx`), already used elsewhere in `McpToolsTab`.

**`packages/flow-editor/src/properties-panel/McpToolsTab.tsx`**
- Change the visible-list fetch from `/api/orgs/${orgId}/mcp-instances/visible` to `/api/workspaces/${wsId}/mcp-instances/visible` (`wsId` is already obtained via `useWsId()` in this file). Guard the fetch on `wsId` being present.

**`packages/flow-editor/src/properties-panel/SkillsTab.tsx`**
- Import and call `useWsId()`; change the fetch from `/api/orgs/${orgId}/skill-packages/visible` to `/api/workspaces/${wsId}/skill-packages/visible`. The `orgId` prop is no longer needed for the fetch (leave the prop in place if other callers pass it, but stop using it for this request).

This is intentionally a minimal repoint — the flow-editor's MCP tab retains its existing extra behavior (per-node tools override, `customStepId` gating, `requiresMcp`/`requiresSkills` validation), which is out of scope for the agent picker.

## Data flow (confirmation, not new work)

```
IntegrationsSection (pick MCPs + skills)
  → patch({ connectorMcpIds, skillIds })
  → PATCH /api/workspaces/:wsId/agents/:id  (merge into definition JSONB)
  → compile.ts  (→ node.config.mcpInstanceIds / skillPackageIds)
  → worker mcpResolver / skillsResolver  (→ resolved configs)
  → agent-run-step-handler  (provisions workspace)
  → runCustomPrompt  (→ SDK mcpServers / plugins, runs in sandbox)
```

## Verification

- **Static:** `npm run check` (typecheck + import boundaries) passes.
- **Agent UI:** open an agent → MCP & skills section; both lists populate from the workspace endpoints; select items; save; reload → selections persist (confirm via PATCH round-trip and a re-fetch of the agent).
- **Flow-editor:** the MCP and skills tabs now populate (previously empty due to 404s on the org-scoped URLs).
- **Runtime end-to-end:** run an agent with at least one MCP and one skill attached; confirm via run logs / SDK message logging that `runCustomPrompt` receives non-empty `mcps` and `skills`, and that the MCP server / skill plugin is loaded in the sandbox.

## Out of scope (YAGNI)

- No cross-package shared picker component in `@journeyman/theme`.
- No new backend endpoints — the workspace-scoped visible endpoints already exist.
- No `requiresMcp` / `requiresSkills` enforcement for agents (that is a custom-step concept; agents have their own readiness validation).
- No changes to the runtime/compile/worker/sandbox path — already wired.

## File reference map

| Concern | File |
|---|---|
| Section nav + IDs | `packages/web/src/components/agents/sections/SectionNav.tsx` |
| Editable-field wiring | `packages/web/src/components/agents/agent-form.ts` |
| New section | `packages/web/src/components/agents/sections/IntegrationsSection.tsx` (new) |
| Shared pickers | `packages/web/src/components/agents/shared/` (new) |
| Section render | `packages/web/src/components/agents/AgentDetail.tsx` |
| Flow-editor MCP picker | `packages/flow-editor/src/properties-panel/McpToolsTab.tsx` |
| Flow-editor skills picker | `packages/flow-editor/src/properties-panel/SkillsTab.tsx` |
| MCP visible endpoint | `packages/mcp/src/routes/workspace-mcp.ts:73` |
| Skills visible endpoint | `packages/skills/src/routes/workspace-skills.ts:59` |
| Agent type | `packages/core/src/types/agent.types.ts` |
| Agent compile | `packages/agents/src/compile.ts` |
