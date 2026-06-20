# Custom Steps Detail Page Redesign

**Date:** 2026-06-20
**Status:** Approved

## Overview

Redesign the custom steps management UX to mirror the agent detail page pattern: a minimal create popup (name only) leads to a full-page detail view with a left sidebar, per-section saves, and an enable/disable toggle that gates both editability and flow-editor catalog visibility.

The existing all-in-one `EditCustomStepModal.tsx` is removed and replaced by this new flow.

---

## Create Flow

**Trigger:** "+ New custom step" button on the custom steps list page opens a small modal dialog.

**Modal fields:** Name only (single text input + Create button + Cancel).

**On create:** `POST /api/workspaces/:wsId/custom-steps` with `{ name }` — all other fields default. On success, navigate to `/workspaces/:wsId/custom-steps/:id?section=prompt`.

No validation on create — the POST accepts a name-only payload.

---

## Detail Page

**Route:** `/workspaces/:wsId/custom-steps/:id`

**Layout:** Identical structure to `AgentDetail.tsx`:

- Page header: step name, status badge (`draft` | `enabled`), enable toggle
- Below header: locked banner (when enabled), readiness error list (when enable fails), general error line
- Main card: left sidebar (section nav) + right content area + section save bar

### Enable Toggle

The toggle lives in the page header. Its state drives two things:

| State | Fields | Flow editor catalog |
|---|---|---|
| **OFF** (disabled / draft) | Fully editable | **Hidden** — step does not appear in the step picker |
| **ON** (enabled) | **Read-only** | **Visible** — step appears in the step picker |

`locked = step.enabled` — passed as a prop to every section component.

### Toggling ON (enable)

1. Call `POST /api/workspaces/:wsId/custom-steps/:id/enable`.
2. Server runs `checkCustomStepReadiness(step)`:
   - `name` must be non-empty.
   - `promptTemplate` must be non-empty.
3. If validation fails → `422 { error: "not_ready", errors: ReadinessError[] }` → display the error list above the card. Each error is a clickable link that navigates to the relevant section.
4. If validation passes → step is saved with `enabled = true`, page reflects locked state.

### Toggling OFF (disable)

Call `POST /api/workspaces/:wsId/custom-steps/:id/disable`. Always succeeds. Step becomes editable again and disappears from the flow editor catalog.

### Save Behaviour

- **No validation on save.** Sections can be saved with partial/incomplete data at any time.
- `SectionSaveBar` appears at the bottom of the content area when `dirty` (same logic as agents — renders when dirty regardless of locked state).
- When `locked`, the Save button is `disabled={locked || saving}` — it renders but cannot be clicked. The locked banner above the card already explains why.
- Each section PATCH sends only that section's fields.
- Backend blocks PATCH with `409 { error: "step_enabled_readonly" }` when `enabled = true`.

### Unsaved-change guard

When navigating between sections with unsaved changes in the current section, a browser `confirm()` prompt asks the user to discard.

---

## Sidebar Sections

Default landing after create: **Prompt**.

| Section | Fields | Save label |
|---|---|---|
| **Prompt** ★ | `promptTemplate` | Save Prompt |
| Definition | `name`, `description`, `icon` | Save Definition |
| Inputs | `inputFields` | Save Inputs |
| Output | `outputMode`, `outputFields` | Save Output |
| Tools | `defaultTools`, `defaultMcpIds`, `defaultSkillIds`, `requiresSkills`, `requiresMcp` | Save Tools |
| Secrets | `slots` | Save Secrets |
| Delete | Danger zone (confirm + delete) — disabled when `locked` | — |

★ URL param: `?section=prompt`

---

## Backend Changes

### DB migration

Add column to `custom_ai_steps`:

```sql
ALTER TABLE custom_ai_steps ADD COLUMN enabled boolean NOT NULL DEFAULT false;
```

### Core types (`@journeyman/core`)

Add `enabled: boolean` to `CustomAiStep`.

### API routes (`workspace-custom-steps.ts`)

**New endpoints:**

```
POST /api/workspaces/:wsId/custom-steps/:id/enable
POST /api/workspaces/:wsId/custom-steps/:id/disable
```

`/enable` runs `checkCustomStepReadiness` and returns `422 { error: "not_ready", errors }` on failure.

**Updated endpoints:**

- `PATCH /api/workspaces/:wsId/custom-steps/:id` — return `409 { error: "step_enabled_readonly" }` when `enabled = true`.
- `GET /api/workspaces/:wsId/custom-steps/visible` — filter `WHERE enabled = true` so disabled/draft steps are hidden from the flow editor.

### Readiness check (`packages/custom-steps/src/readiness.ts` — new file)

```typescript
export interface ReadinessError { field: string; message: string; }

export function checkCustomStepReadiness(step: CustomAiStep): ReadinessError[] {
  const errs: ReadinessError[] = [];
  if (!step.name.trim())           errs.push({ field: "name",           message: "Name is required" });
  if (!step.promptTemplate.trim()) errs.push({ field: "promptTemplate", message: "Prompt template is required" });
  return errs;
}
```

`field` values map to sidebar sections: `"name"` → Definition, `"promptTemplate"` → Prompt.

---

## Frontend Changes

### New files

| File | Purpose |
|---|---|
| `packages/web/src/components/custom-steps/CustomStepDetail.tsx` | Main detail page — mirrors `AgentDetail.tsx` |
| `packages/web/src/components/custom-steps/sections/PromptSection.tsx` | Prompt template editor |
| `packages/web/src/components/custom-steps/sections/DefinitionSection.tsx` | Name, description, icon |
| `packages/web/src/components/custom-steps/sections/InputsSection.tsx` | Input fields editor (reuse existing `InputFieldsEditor`) |
| `packages/web/src/components/custom-steps/sections/OutputSection.tsx` | Output mode + output fields editor (reuse `OutputSchemaEditor`) |
| `packages/web/src/components/custom-steps/sections/ToolsSection.tsx` | Tools, MCP, skills pickers (reuse `ToolsPicker`) |
| `packages/web/src/components/custom-steps/sections/SecretsSection.tsx` | Secret slots editor (reuse `SecretsEditor`) |
| `packages/web/src/components/custom-steps/sections/DeleteSection.tsx` | Danger zone, confirm + delete |
| `packages/web/src/components/custom-steps/custom-step-form.ts` | `SECTION_FIELDS` map, `isSectionDirty`, `buildSectionUpdateInput` |
| `packages/web/src/api/custom-steps.ts` | API client: `list`, `get`, `create`, `update`, `enable`, `disable`, `delete` |

### Modified files

| File | Change |
|---|---|
| `packages/web/src/components/custom-steps/CustomStepsList.tsx` | "+" → opens create popup modal; Edit row action → `navigate(/workspaces/:wsId/custom-steps/:id)` |
| `packages/web/src/routes/` (router) | Add route for `/workspaces/:wsId/custom-steps/:id` → `CustomStepDetail` |

### Deleted files

- `packages/web/src/components/custom-steps/EditCustomStepModal.tsx`

> **Note:** The sub-editor components currently embedded in the modal tabs (`InputFieldsEditor`, `OutputSchemaEditor`, `ToolsPicker`, `SecretsEditor`, `PromptEditor`, `IconPicker`) must be **extracted to standalone files** before the modal is deleted, so the new section components can import them.

---

## Section Field Ownership Map

```typescript
const SECTION_FIELDS: Record<SectionId, (keyof CustomAiStepUpdateInput)[]> = {
  prompt:     ["promptTemplate"],
  definition: ["name", "description", "icon"],
  inputs:     ["inputFields"],
  output:     ["outputMode", "outputFields"],
  tools:      ["defaultTools", "defaultMcpIds", "defaultSkillIds", "requiresSkills", "requiresMcp"],
  secrets:    ["slots"],
};
```

---

## Error Display (enable validation)

When `POST .../enable` returns `422`:

```tsx
<div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3">
  <p className="text-sm font-semibold text-destructive mb-2">
    ⚠ Can't enable — fix these issues first:
  </p>
  <ul>
    {readinessErrors.map(e => (
      <li key={e.field}>
        <button onClick={() => selectSection(FIELD_TO_SECTION[e.field])}>
          {sectionLabel}
        </button>
        {" — "}{e.message}
      </li>
    ))}
  </ul>
</div>
```

Same pattern as `AgentDetail.tsx:184–213`.

---

## Out of Scope

- No "run now" button (custom steps are building blocks, not agents).
- No run history section.
- No trigger configuration.
- The flow editor's node config panel (properties panel) is unchanged — it still reads from `/visible` which now only returns `enabled=true` steps.
