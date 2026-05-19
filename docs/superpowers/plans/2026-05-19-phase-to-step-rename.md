# Rename "Phase" → "Step" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename the term "phase" to "step" across the entire codebase — DB, packages, directories, types, API routes, frontend, and docs. No backwards-compatibility shims.

**Architecture:** Big-bang rename executed layer-by-layer (DB → core types → backend packages → frontend → docs). Typechecker is the safety net; SQL strings, route paths, and JSONB content are caught by targeted grep passes and a JSONB-rewrite migration.

**Tech Stack:** TypeScript, Postgres (JSONB), Fastify, React, npm workspaces.

**Constraints (from user):**
- **No `git commit` steps** — leave changes in working tree for user review.
- **No unit tests added** — do not add new test files; existing tests stay (renamed in-place).
- **Typecheck only at the end** — single `npm run check` at the final step.

**Spec:** [docs/superpowers/specs/2026-05-19-phase-to-step-rename-design.md](../specs/2026-05-19-phase-to-step-rename-design.md)

---

## File Structure

This plan moves and renames many files. The end-state layout:

```
packages/
├── steps/              ← was packages/phases/
│   └── src/
│       ├── catalog.ts
│       ├── registry.ts
│       └── … (.meta.ts and .tsx files unchanged in name)
├── custom-steps/       ← was packages/custom-phases/
│   └── src/
│       ├── routes/
│       │   ├── org-custom-steps.ts          ← renamed
│       │   ├── user-custom-steps.ts         ← renamed
│       │   ├── visible.ts
│       │   └── index.ts
│       └── … (other files unchanged in name)
├── orchestrator/src/workers/
│   └── steps/          ← was phases/
│       ├── *-step-handler.ts                ← all renamed
│       └── custom-ai-step-handler.ts
├── api-server/src/routes/
│   └── steps.ts        ← was phases.ts
├── web/src/
│   ├── routes/
│   │   ├── AdminCustomStepsPage.tsx         ← renamed
│   │   └── MyCustomStepsPage.tsx            ← renamed
│   ├── components/custom-steps/             ← renamed dir
│   │   ├── CustomStepsList.tsx              ← renamed
│   │   ├── EditCustomStepModal.tsx          ← renamed
│   │   └── … (others; "Phase" → "Step" in names)
│   ├── api/customSteps.ts                   ← renamed
│   └── flow-editor-integration/
│       ├── useCustomStepPaletteEntries.ts   ← renamed
│       ├── detectCustomStepBreaks.ts        ← renamed
│       ├── useVisibleCustomSteps.ts         ← renamed
│       └── customCatalogEntries.ts          ← content updated, name unchanged
└── migrations/src/sql/
    └── 025_rename_phases_to_steps.sql       ← new
```

DB: `jm_custom_ai_phases` → `jm_custom_ai_steps`. JSONB key `phaseType` → `stepType` and `phaseId` → `stepId` inside flow definitions.

---

## Task 1: DB Migration

**Files:**
- Create: `packages/migrations/src/sql/025_rename_phases_to_steps.sql`

- [ ] **Step 1.1: Identify JSONB columns holding flow definitions**

Run:

```bash
rg -i "jsonb" packages/migrations/src/sql/*.sql | grep -iE "flow|workflow|run|instance|node"
```

Look for columns like `definition`, `nodes`, `snapshot`, `flow_json`, etc. on tables `jm_flows`, `jm_workflows`, `jm_runs`, `jm_workflow_instances`. List the `<table>.<column>` pairs that contain node data with `phaseType`/`phaseId` keys.

- [ ] **Step 1.2: Write the migration SQL**

Write `packages/migrations/src/sql/025_rename_phases_to_steps.sql`:

```sql
-- 025_rename_phases_to_steps.sql — rename "phase" terminology to "step" across schema.
-- Forward-only. No backwards compatibility.

BEGIN;

-- 1. Rename the custom AI phases table.
ALTER TABLE jm_custom_ai_phases RENAME TO jm_custom_ai_steps;

-- 2. Rename the unique constraint and index that embed the old name.
ALTER TABLE jm_custom_ai_steps
  RENAME CONSTRAINT jm_custom_ai_phases_scope_name_unique
  TO jm_custom_ai_steps_scope_name_unique;

ALTER INDEX IF EXISTS idx_jm_custom_ai_phases_org_user
  RENAME TO idx_jm_custom_ai_steps_org_user;

-- 3. Rewrite JSONB content in flow / workflow / instance / run rows.
--    Replace top-level node keys phaseType → stepType, phaseId → stepId,
--    and the node-type discriminator "phase" → "step".
--    Apply to each <table>.<column> identified in Step 1.1.
--    Repeat the UPDATE block for every (table, column) pair found.

-- Example — replace this block once per JSONB column. Substitute <table>/<column>:
UPDATE <table>
SET <column> = (
  regexp_replace(
    regexp_replace(
      regexp_replace(
        <column>::text,
        '"phaseType"', '"stepType"', 'g'
      ),
      '"phaseId"', '"stepId"', 'g'
    ),
    '"type"\s*:\s*"phase"', '"type":"step"', 'g'
  )
)::jsonb
WHERE <column>::text ~ '"phaseType"|"phaseId"|"type"\s*:\s*"phase"';

COMMIT;
```

Replace the `<table>`/`<column>` placeholder with one `UPDATE` block per JSONB column from Step 1.1. If no JSONB flow data exists in the schema, omit Section 3.

- [ ] **Step 1.3: Verify migration list**

Run:

```bash
ls packages/migrations/src/sql/ | tail -5
```

Expected: `025_rename_phases_to_steps.sql` is present and is the highest-numbered file.

---

## Task 2: Rename Core Types

**Files:**
- Modify: `packages/core/src/types/custom-phases.types.ts` → rename to `custom-steps.types.ts`
- Modify: `packages/core/src/types/custom-phase-icons.ts` → rename to `custom-step-icons.ts`
- Modify: `packages/core/src/types/custom-phase-icons.test.ts` → rename to `custom-step-icons.test.ts`
- Modify: `packages/core/src/interfaces/phase-registry.interface.ts` → rename to `step-registry.interface.ts`
- Modify: `packages/core/src/log/append-phase-event.ts` → rename to `append-step-event.ts`
- Modify: `packages/core/src/log/append-phase-event.test.ts` → rename to `append-step-event.test.ts`
- Modify: `packages/core/src/types/flow.types.ts`
- Modify: `packages/core/src/validation/validate-for-publish.ts`
- Modify: `packages/core/src/utils/validate-workflow.ts`
- Modify: `packages/core/src/registries/provider-catalog.ts`
- Modify: `packages/core/src/index.ts` (re-export updates)

- [ ] **Step 2.1: Rename core type files with git mv (preserves history)**

Run:

```bash
cd packages/core/src
git mv types/custom-phases.types.ts types/custom-steps.types.ts
git mv types/custom-phase-icons.ts types/custom-step-icons.ts
git mv types/custom-phase-icons.test.ts types/custom-step-icons.test.ts
git mv interfaces/phase-registry.interface.ts interfaces/step-registry.interface.ts
git mv log/append-phase-event.ts log/append-step-event.ts
git mv log/append-phase-event.test.ts log/append-step-event.test.ts
cd -
```

- [ ] **Step 2.2: Rewrite identifiers inside renamed core files and their callers**

Apply these case-preserving replacements across all `.ts`/`.tsx` files under `packages/core/src/`:

| Find | Replace |
|---|---|
| `CustomPhaseScope` | `CustomStepScope` |
| `CustomPhaseOutputMode` | `CustomStepOutputMode` |
| `CustomPhaseInputType` | `CustomStepInputType` |
| `CustomPhaseInputField` | `CustomStepInputField` |
| `CustomPhaseJsonSchema` | `CustomStepJsonSchema` |
| `CustomAiPhase` | `CustomAiStep` |
| `CustomAiPhaseCreateInput` | `CustomAiStepCreateInput` |
| `CustomAiPhaseUpdateInput` | `CustomAiStepUpdateInput` |
| `CustomPhaseExportPayloadV1` | `CustomStepExportPayloadV1` |
| `CUSTOM_PHASE_EXPORT_KIND` | `CUSTOM_STEP_EXPORT_KIND` |
| `CUSTOM_PHASE_EXPORT_VERSION` | `CUSTOM_STEP_EXPORT_VERSION` |
| `"journeyman.customPhase"` | `"journeyman.customStep"` |
| `CUSTOM_PHASE_ICON_NAMES` | `CUSTOM_STEP_ICON_NAMES` |
| `DEFAULT_CUSTOM_PHASE_ICON_ID` | `DEFAULT_CUSTOM_STEP_ICON_ID` |
| `PhaseDefinition` | `StepDefinition` |
| `PhaseCatalogEntry` | `StepCatalogEntry` |
| `IPhaseHandler` | `IStepHandler` |
| `IPhaseRegistry` | `IStepRegistry` |
| `phaseConfigValidators` | `stepConfigValidators` |
| `phaseHandler` | `stepHandler` |
| `phaseType` (property/param) | `stepType` |
| `phaseId` | `stepId` |
| `phaseEvent` | `stepEvent` |
| `appendPhaseEvent` | `appendStepEvent` |
| `prettifyPhaseType` | `prettifyStepType` |
| `kindForPhaseType` | `kindForStepType` |
| node-type literal `"phase"` (inside `node.type === "phase"`, `type: "phase"`) | `"step"` |

Command for each substitution (example):

```bash
rg -l "CustomPhaseScope" packages/core/src | xargs sed -i '' 's/CustomPhaseScope/CustomStepScope/g'
```

(On Linux, drop the empty `''` after `-i`.)

- [ ] **Step 2.3: Update `packages/core/src/index.ts` re-exports**

Open it and replace any `from "./types/custom-phases.types.ts"` → `from "./types/custom-steps.types.ts"`, `from "./interfaces/phase-registry.interface.ts"` → `from "./interfaces/step-registry.interface.ts"`, `from "./log/append-phase-event.ts"` → `from "./log/append-step-event.ts"`, and `from "./types/custom-phase-icons.ts"` → `from "./types/custom-step-icons.ts"`.

- [ ] **Step 2.4: Verify no `phase`/`Phase` identifiers remain in core (except in comments referencing history)**

Run:

```bash
rg -n "phase|Phase" packages/core/src --type ts | grep -v "// "
```

Review remaining matches manually — anything in source identifiers should be empty. Comments referencing "phase of the moon" style usage are fine.

---

## Task 3: Rename `packages/phases` → `packages/steps`

**Files:**
- Move: `packages/phases/` → `packages/steps/`
- Modify: `packages/steps/package.json`
- Modify: `packages/steps/src/index.ts`, `catalog.ts`, `registry.ts`, plus every `.meta.ts`/`.tsx` under it
- Modify: `scripts/check-import-boundaries.mjs`

- [ ] **Step 3.1: Move the directory**

```bash
git mv packages/phases packages/steps
```

- [ ] **Step 3.2: Update `package.json` name**

Edit `packages/steps/package.json`:

```json
{
  "name": "@journeyman/steps",
  "version": "0.1.0",
  "description": "Built-in step definitions for the Journeyman flow editor.",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./catalog": "./src/catalog.ts"
  },
  …
}
```

(Description and exports unchanged in shape, only `phase` → `step` in strings.)

- [ ] **Step 3.3: Rewrite identifiers inside `packages/steps/src/`**

Apply same substitution table from Step 2.2 across `packages/steps/src/**`. Key additional substitutions in this package:

| Find | Replace |
|---|---|
| `phasesCatalog` / `phaseCatalog` | `stepsCatalog` / `stepCatalog` |
| `getPhaseDefinition` | `getStepDefinition` |
| `phaseRegistry` | `stepRegistry` |
| any local `phase`/`Phase` variable, function, or type name | `step`/`Step` |

Run:

```bash
rg -l "[Pp]hase" packages/steps/src | xargs sed -i '' -E 's/PhaseDefinition/StepDefinition/g; s/PhaseCatalogEntry/StepCatalogEntry/g; s/phasesCatalog/stepsCatalog/g; s/phaseType/stepType/g; s/phaseId/stepId/g; s/"phase"/"step"/g; s/Phase(?=[A-Z])/Step/g'
```

Then sweep remaining cases manually:

```bash
rg -n "[Pp]hase" packages/steps/src
```

- [ ] **Step 3.4: Update boundary script**

Edit `scripts/check-import-boundaries.mjs`:

- In `PKG_LAYER`, change `"@journeyman/phases": "ui"` → `"@journeyman/steps": "ui"`.
- In `SUBPATH_OVERRIDES`, change `"@journeyman/phases/catalog"` → `"@journeyman/steps/catalog"`.
- Update header comments mentioning `@journeyman/phases`.

- [ ] **Step 3.5: Update root `package.json` if it references the package by name**

```bash
rg '"@journeyman/phases"' package.json
```

If matches found, replace with `"@journeyman/steps"`.

---

## Task 4: Rename `packages/custom-phases` → `packages/custom-steps`

**Files:**
- Move: `packages/custom-phases/` → `packages/custom-steps/`
- Move: `packages/custom-steps/src/routes/org-custom-phases.ts` → `org-custom-steps.ts`
- Move: `packages/custom-steps/src/routes/user-custom-phases.ts` → `user-custom-steps.ts`
- Modify: `packages/custom-steps/package.json`, all `.ts` files in package

- [ ] **Step 4.1: Move package and route files**

```bash
git mv packages/custom-phases packages/custom-steps
cd packages/custom-steps/src/routes
git mv org-custom-phases.ts org-custom-steps.ts
git mv user-custom-phases.ts user-custom-steps.ts
cd -
```

- [ ] **Step 4.2: Update `packages/custom-steps/package.json`**

Set `"name": "@journeyman/custom-steps"`. Keep `exports` shape, only update path strings if they reference `custom-phases` (they don't — they reference `./src/...`).

- [ ] **Step 4.3: Rewrite SQL table name in `db.ts`**

```bash
sed -i '' 's/jm_custom_ai_phases/jm_custom_ai_steps/g' packages/custom-steps/src/db.ts
```

- [ ] **Step 4.4: Rewrite identifiers and route paths**

Apply substitution table from Step 2.2 across `packages/custom-steps/src/**`. Plus:

| Find | Replace |
|---|---|
| `registerCustomPhaseRoutes` | `registerCustomStepRoutes` |
| `CustomPhaseImportError` | `CustomStepImportError` |
| Route path string `'/custom-phases'` | `'/custom-steps'` |
| Route path string `'/org-custom-phases'` | `'/org-custom-steps'` |
| Route path string `'/user-custom-phases'` | `'/user-custom-steps'` |
| Body field `'phase'` (in export.ts error message and payload) | `'step'` |

Run:

```bash
rg -l "[Pp]hase|/custom-phases|/org-custom-phases|/user-custom-phases" packages/custom-steps/src | xargs sed -i '' \
  -e 's|/custom-phases|/custom-steps|g' \
  -e 's|/org-custom-phases|/org-custom-steps|g' \
  -e 's|/user-custom-phases|/user-custom-steps|g' \
  -e 's/registerCustomPhaseRoutes/registerCustomStepRoutes/g' \
  -e 's/CustomPhaseImportError/CustomStepImportError/g'
```

Then identifier sweep:

```bash
rg -n "[Pp]hase" packages/custom-steps/src
```

Fix remaining occurrences case-by-case.

- [ ] **Step 4.5: Update `packages/custom-steps/src/index.ts` and `routes/index.ts`**

Confirm `index.ts` re-exports `registerCustomStepRoutes` and the renamed route modules:

```typescript
export { registerCustomStepRoutes } from "./routes/index.ts";
```

And `routes/index.ts` imports from `./org-custom-steps.ts` and `./user-custom-steps.ts`.

---

## Task 5: Rename Orchestrator Phase Handlers

**Files:**
- Move: `packages/orchestrator/src/workers/phases/` → `packages/orchestrator/src/workers/steps/`
- Rename every `*-phase-handler.ts` → `*-step-handler.ts` inside that directory
- Modify: `packages/orchestrator/src/cli-worker.ts`, `index.ts`, and any file importing from the old path

- [ ] **Step 5.1: Move handler directory**

```bash
git mv packages/orchestrator/src/workers/phases packages/orchestrator/src/workers/steps
```

- [ ] **Step 5.2: Rename handler files**

```bash
cd packages/orchestrator/src/workers/steps
for f in *-phase-handler.ts; do
  git mv "$f" "${f/-phase-handler/-step-handler}"
done
cd -
```

Verify:

```bash
ls packages/orchestrator/src/workers/steps/
```

Expected: filenames like `clone-repos-step-handler.ts`, `custom-ai-step-handler.ts`, etc. No `-phase-handler.ts` remaining.

- [ ] **Step 5.3: Rewrite identifiers inside renamed handlers**

For each handler file, the class name uses pattern `<ThingDoer>PhaseHandler`. Rename to `<ThingDoer>StepHandler`. Also rename internal references to `IPhaseHandler` / `phaseType`.

```bash
rg -l "PhaseHandler|phaseType|phaseId|IPhaseHandler" packages/orchestrator/src | xargs sed -i '' \
  -e 's/PhaseHandler/StepHandler/g' \
  -e 's/IPhaseHandler/IStepHandler/g' \
  -e 's/phaseType/stepType/g' \
  -e 's/phaseId/stepId/g' \
  -e 's/phaseRegistry/stepRegistry/g' \
  -e 's/PhaseRegistry/StepRegistry/g'
```

- [ ] **Step 5.4: Update import paths in orchestrator**

```bash
rg -l 'workers/phases' packages/orchestrator/src | xargs sed -i '' 's|workers/phases|workers/steps|g'
rg -l '-phase-handler' packages/orchestrator/src | xargs sed -i '' 's/-phase-handler/-step-handler/g'
```

- [ ] **Step 5.5: Update orchestrator package imports of `@journeyman/phases` / `@journeyman/custom-phases`**

```bash
rg -l '@journeyman/phases|@journeyman/custom-phases' packages/orchestrator/src | xargs sed -i '' \
  -e 's|@journeyman/phases|@journeyman/steps|g' \
  -e 's|@journeyman/custom-phases|@journeyman/custom-steps|g'
```

- [ ] **Step 5.6: Update `packages/orchestrator/package.json` dependencies**

Edit `packages/orchestrator/package.json` — replace `"@journeyman/phases": "*"` and `"@journeyman/custom-phases": "*"` with `"@journeyman/steps": "*"` and `"@journeyman/custom-steps": "*"` respectively.

- [ ] **Step 5.7: Update node-type discriminator and JSONB references**

```bash
rg -l '"type" *: *"phase"|=== *"phase"|type === "phase"|isPhaseNode|labelNode.*phase' packages/orchestrator/src
```

Open each match and replace the discriminator literal `"phase"` with `"step"`, and rename `isPhaseNode` → `isStepNode`.

```bash
rg -l 'isPhaseNode' packages/ | xargs sed -i '' 's/isPhaseNode/isStepNode/g'
```

For the literal `"phase"` discriminator (where it's clearly the node type), do a careful manual sweep:

```bash
rg -n '"phase"' packages/orchestrator/src
```

---

## Task 6: API Server Routes

**Files:**
- Move: `packages/api-server/src/routes/phases.ts` → `packages/api-server/src/routes/steps.ts`
- Modify: `packages/api-server/src/server.ts`, `composition.ts`, `routes/flows.ts`, `schemas/update-flow.ts`

- [ ] **Step 6.1: Rename routes file**

```bash
git mv packages/api-server/src/routes/phases.ts packages/api-server/src/routes/steps.ts
```

- [ ] **Step 6.2: Rewrite identifiers and import paths**

```bash
rg -l '[Pp]hase' packages/api-server/src | xargs sed -i '' \
  -e 's/registerPhasesRoutes/registerStepsRoutes/g' \
  -e 's|routes/phases|routes/steps|g' \
  -e 's|@journeyman/custom-phases|@journeyman/custom-steps|g' \
  -e 's|@journeyman/phases|@journeyman/steps|g' \
  -e 's/registerCustomPhaseRoutes/registerCustomStepRoutes/g' \
  -e 's/phaseType/stepType/g' \
  -e 's/phaseId/stepId/g'
```

- [ ] **Step 6.3: Update route path strings**

Inside `packages/api-server/src/routes/steps.ts`, update any registered path from `/phases` to `/steps`. Open the file and check the `app.get('/phases', …)` style declarations:

```bash
rg -n "'/phases'|\"/phases\"" packages/api-server/src
```

Replace with `/steps`.

- [ ] **Step 6.4: Update node-type discriminator and `phaseType` references in `flows.ts`**

Inside `packages/api-server/src/routes/flows.ts`, replace `node.type === "phase"` → `node.type === "step"` and `node.phaseType` → `node.stepType`. The `sed` in Step 6.2 covers `phaseType`; for the discriminator:

```bash
sed -i '' 's/node\.type === "phase"/node.type === "step"/g; s/n\.type === "phase"/n.type === "step"/g; s/"custom-ai"/"custom-ai"/g' packages/api-server/src/routes/flows.ts
```

(Leave `"custom-ai"` value unchanged — that's the `stepType` identifier for the custom-AI step, not the term being renamed.)

- [ ] **Step 6.5: Update `packages/api-server/package.json` dependencies**

Replace `"@journeyman/phases"` and `"@journeyman/custom-phases"` with the new names.

---

## Task 7: Other Backend Packages

**Files:**
- Modify: `packages/mcp/src/**`, `packages/skills/src/**`, `packages/secrets/src/**`, `packages/identity/src/**`, `packages/coding-cli/src/**`, `packages/coding-models/src/**`, `packages/git-provider/src/**`, `packages/github-api/src/**`, `packages/ticket-provider/src/**`, `packages/notification-provider/src/**`

- [ ] **Step 7.1: Find affected files**

```bash
rg -l "[Pp]hase|@journeyman/phases|@journeyman/custom-phases" packages/mcp packages/skills packages/secrets packages/identity packages/coding-cli packages/coding-models packages/git-provider packages/github-api packages/ticket-provider packages/notification-provider 2>/dev/null
```

- [ ] **Step 7.2: Apply substitutions across listed packages**

For each package directory found:

```bash
rg -l "[Pp]hase|@journeyman/phases|@journeyman/custom-phases" packages/<pkg>/src | xargs sed -i '' \
  -e 's|@journeyman/phases|@journeyman/steps|g' \
  -e 's|@journeyman/custom-phases|@journeyman/custom-steps|g' \
  -e 's/PhaseDefinition/StepDefinition/g' \
  -e 's/PhaseCatalogEntry/StepCatalogEntry/g' \
  -e 's/IPhaseHandler/IStepHandler/g' \
  -e 's/IPhaseRegistry/IStepRegistry/g' \
  -e 's/PhaseHandler/StepHandler/g' \
  -e 's/phaseType/stepType/g' \
  -e 's/phaseId/stepId/g' \
  -e 's/phaseHandler/stepHandler/g' \
  -e 's/phaseRegistry/stepRegistry/g' \
  -e 's/CustomAiPhase/CustomAiStep/g' \
  -e 's/CustomPhase/CustomStep/g' \
  -e 's/customPhase/customStep/g'
```

- [ ] **Step 7.3: Update `package.json` dependencies for each backend package**

For each package found in 7.1 whose `package.json` lists `@journeyman/phases` or `@journeyman/custom-phases` as a dep:

```bash
rg -l '"@journeyman/phases"|"@journeyman/custom-phases"' packages/*/package.json
```

Edit each match: rename to `@journeyman/steps` / `@journeyman/custom-steps`.

---

## Task 8: Frontend Renames

**Files:**
- Move: `packages/web/src/components/custom-phases/` → `custom-steps/`
- Rename component files inside that dir (`CustomPhasesList.tsx` → `CustomStepsList.tsx`, etc.)
- Move: `packages/web/src/routes/AdminCustomPhasesPage.tsx` → `AdminCustomStepsPage.tsx`
- Move: `packages/web/src/routes/MyCustomPhasesPage.tsx` → `MyCustomStepsPage.tsx`
- Move: `packages/web/src/api/customPhases.ts` → `customSteps.ts`
- Move: `packages/web/src/flow-editor-integration/useCustomPhasePaletteEntries.ts` → `useCustomStepPaletteEntries.ts`
- Move: `packages/web/src/flow-editor-integration/detectCustomPhaseBreaks.ts` → `detectCustomStepBreaks.ts`
- Move: `packages/web/src/flow-editor-integration/useVisibleCustomPhases.ts` → `useVisibleCustomSteps.ts`
- Modify: `packages/web/src/App.tsx`, `Sidebar.tsx`, `FlowEditorPage.tsx`, `customCatalogEntries.ts`, all touched components
- Modify: `packages/flow-editor/src/palette/Palette.tsx`, `canvas/Canvas.tsx`, `canvas/auto-populate-defaults.ts`
- Modify: `packages/run-viewer/src/**` references

- [ ] **Step 8.1: Move the components directory**

```bash
git mv packages/web/src/components/custom-phases packages/web/src/components/custom-steps
```

- [ ] **Step 8.2: Rename component files inside `custom-steps/`**

```bash
cd packages/web/src/components/custom-steps
git mv CustomPhasesList.tsx CustomStepsList.tsx
git mv EditCustomPhaseModal.tsx EditCustomStepModal.tsx
cd -
```

(The other files — `IconPicker.tsx`, `InputFieldsEditor.tsx`, `OutputSchemaEditor.tsx`, `PromptEditor.tsx`, `SecretsEditor.tsx`, `ToolsPicker.tsx` — don't have "Phase" in their filename and stay as-is. Their contents will be updated by the sed pass below.)

- [ ] **Step 8.3: Rename route page files**

```bash
cd packages/web/src/routes
git mv AdminCustomPhasesPage.tsx AdminCustomStepsPage.tsx
git mv MyCustomPhasesPage.tsx MyCustomStepsPage.tsx
cd -
```

- [ ] **Step 8.4: Rename API client and integration files**

```bash
cd packages/web/src
git mv api/customPhases.ts api/customSteps.ts
cd flow-editor-integration
git mv useCustomPhasePaletteEntries.ts useCustomStepPaletteEntries.ts
git mv detectCustomPhaseBreaks.ts detectCustomStepBreaks.ts
git mv useVisibleCustomPhases.ts useVisibleCustomSteps.ts
cd ../../../..
```

- [ ] **Step 8.5: Rewrite identifiers and import paths across `packages/web/src/`**

```bash
rg -l '[Pp]hase|/custom-phases|customPhases|customPhase' packages/web/src | xargs sed -i '' \
  -e 's|components/custom-phases|components/custom-steps|g' \
  -e 's|api/customPhases|api/customSteps|g' \
  -e 's|useCustomPhasePaletteEntries|useCustomStepPaletteEntries|g' \
  -e 's|useVisibleCustomPhases|useVisibleCustomSteps|g' \
  -e 's|detectCustomPhaseBreaks|detectCustomStepBreaks|g' \
  -e 's|AdminCustomPhasesPage|AdminCustomStepsPage|g' \
  -e 's|MyCustomPhasesPage|MyCustomStepsPage|g' \
  -e 's|CustomPhasesList|CustomStepsList|g' \
  -e 's|EditCustomPhaseModal|EditCustomStepModal|g' \
  -e 's|/custom-phases|/custom-steps|g' \
  -e 's/customPhases/customSteps/g' \
  -e 's/customPhase/customStep/g' \
  -e 's/CustomPhase/CustomStep/g' \
  -e 's/CustomAiPhase/CustomAiStep/g' \
  -e 's/PhaseDefinition/StepDefinition/g' \
  -e 's/phaseType/stepType/g' \
  -e 's/phaseId/stepId/g' \
  -e 's/IPhaseHandler/IStepHandler/g'
```

- [ ] **Step 8.6: Update user-visible JSX copy**

Sweep React text strings replacing **user-facing** label text:

```bash
rg -n '"Custom Phases"|"Custom Phase"|>Phase<|>Phases<|"Phase "|"Phases "|placeholder.*[Pp]hase' packages/web/src packages/flow-editor/src packages/run-viewer/src
```

Open each match and replace:

- `"Custom Phases"` → `"Custom Steps"`
- `"Custom Phase"` → `"Custom Step"`
- `>Phase<` → `>Step<` (JSX text node)
- `>Phases<` → `>Steps<`
- Phrases like `"Add Phase"` → `"Add Step"`, `"phase node"` → `"step node"`, etc.

This is judgment-based — do not auto-replace, since "phase" appears in unrelated contexts (e.g. lifecycle, animation). Update only labels referring to the workflow concept.

- [ ] **Step 8.7: Update `packages/web/package.json`, `packages/flow-editor/package.json`, `packages/run-viewer/package.json` dependencies**

```bash
rg -l '"@journeyman/phases"|"@journeyman/custom-phases"' packages/*/package.json
```

For each match: rename to `@journeyman/steps` / `@journeyman/custom-steps`.

- [ ] **Step 8.8: Sweep `packages/flow-editor/src/` and `packages/run-viewer/src/` for code references**

```bash
rg -l '[Pp]hase' packages/flow-editor/src packages/run-viewer/src | xargs sed -i '' \
  -e 's/PhaseDefinition/StepDefinition/g' \
  -e 's/PhaseCatalogEntry/StepCatalogEntry/g' \
  -e 's/phaseType/stepType/g' \
  -e 's/phaseId/stepId/g' \
  -e 's/phaseHandler/stepHandler/g' \
  -e 's/CustomPhase/CustomStep/g' \
  -e 's/customPhase/customStep/g' \
  -e 's|@journeyman/phases|@journeyman/steps|g' \
  -e 's|@journeyman/custom-phases|@journeyman/custom-steps|g'
```

- [ ] **Step 8.9: Update node-type discriminator `"phase"` → `"step"` in flow-editor**

```bash
rg -n '"phase"' packages/flow-editor/src packages/run-viewer/src
```

Open each match and change literal `"phase"` to `"step"` only where it's a node-type discriminator (`type === "phase"`, `type: "phase"`, `kind: "phase"`, etc.). Skip occurrences in comments, prop names, or unrelated string values. Examples to change:

- `packages/flow-editor/src/palette/Palette.tsx:16: kind: "phase";` → `kind: "step";`
- `packages/flow-editor/src/palette/Palette.tsx:37: e.kind === "phase"` → `e.kind === "step"`
- `packages/flow-editor/src/canvas/auto-populate-defaults.ts:11: node.type !== "phase"` → `node.type !== "step"`
- `packages/flow-editor/src/canvas/Canvas.tsx:41,45,99: newNode.type !== "phase"` etc. → `"step"`

Confirm with a follow-up grep that the discriminator now reads `"step"` consistently.

- [ ] **Step 8.10: Update web router paths**

In `packages/web/src/App.tsx` (and any router-config file), replace router paths:

```bash
rg -n "'/custom-phases'|\"/custom-phases\"" packages/web/src
```

Replace with `/custom-steps`.

---

## Task 9: Examples, Fixtures, Postman, and Docs

**Files:**
- Modify: `examples/flows/*.json`
- Modify: `docs/journeyman-pipeline.postman_collection.json`
- Modify: `docs/custom-phases.md` → renamed to `docs/custom-steps.md`
- Modify: `README.md`, `CLAUDE.md`, `ARCHITECTURE.md`, `AGENT.md`, `UNIT_TESTING.md`, `CODE_REVIEW.md`, `VERSION_MANAGEMENT.md`, `infra/README.md`, `docs/setup.md`, `docs/security.md`, `docs/troubleshooting.md`

- [ ] **Step 9.1: Rewrite example flow JSON files**

```bash
sed -i '' \
  -e 's/"phaseType"/"stepType"/g' \
  -e 's/"phaseId"/"stepId"/g' \
  -e 's/"type": *"phase"/"type":"step"/g' \
  -e 's/"type":"phase"/"type":"step"/g' \
  examples/flows/*.json
```

Then verify:

```bash
rg -n 'phase' examples/flows/
```

Any remaining matches should be in human-readable description fields — fix them as well.

- [ ] **Step 9.2: Rewrite Postman collection**

```bash
sed -i '' \
  -e 's|/custom-phases|/custom-steps|g' \
  -e 's|/org-custom-phases|/org-custom-steps|g' \
  -e 's|/user-custom-phases|/user-custom-steps|g' \
  -e 's|/phases|/steps|g' \
  -e 's/"phaseType"/"stepType"/g' \
  -e 's/"phaseId"/"stepId"/g' \
  -e 's/Custom Phase/Custom Step/g' \
  -e 's/Custom Phases/Custom Steps/g' \
  docs/journeyman-pipeline.postman_collection.json
```

Manually review any remaining `"phase"` strings in the collection.

- [ ] **Step 9.3: Rename and rewrite `docs/custom-phases.md`**

```bash
git mv docs/custom-phases.md docs/custom-steps.md
sed -i '' \
  -e 's/Custom Phases/Custom Steps/g' \
  -e 's/custom phases/custom steps/g' \
  -e 's/Custom Phase/Custom Step/g' \
  -e 's/custom phase/custom step/g' \
  -e 's/phase/step/g' \
  -e 's/Phase/Step/g' \
  docs/custom-steps.md
```

Then read the file end-to-end and fix any awkward sentences where the global replace produced wrong grammar.

- [ ] **Step 9.4: Update `CLAUDE.md`, `README.md`, `ARCHITECTURE.md`, `AGENT.md`**

For each file, do a careful sed targeting workflow-concept usages (not e.g. "phase 1 of development"). Start with the high-confidence replacements:

```bash
for f in CLAUDE.md README.md ARCHITECTURE.md AGENT.md; do
  sed -i '' \
    -e 's|@journeyman/phases|@journeyman/steps|g' \
    -e 's|@journeyman/custom-phases|@journeyman/custom-steps|g' \
    -e 's|packages/phases|packages/steps|g' \
    -e 's|packages/custom-phases|packages/custom-steps|g' \
    -e 's/phase catalog/step catalog/g' \
    -e 's/Phase catalog/Step catalog/g' \
    -e 's/built-in phase/built-in step/g' \
    -e 's/Built-in phase/Built-in step/g' \
    -e 's/PhaseDefinition/StepDefinition/g' \
    -e 's/phaseType/stepType/g' \
    -e 's/Phase /Step /g' \
    -e 's/phase /step /g' \
    -e 's/per-node phase/per-node step/g' \
    -e 's/custom phase/custom step/g' \
    -e 's/Custom phase/Custom step/g' \
    -e 's/Custom Phase/Custom Step/g' \
    "$f"
done
```

Then read each file and fix unintended replacements (e.g. "phase 1", "phase of work" — domain phrases unrelated to the workflow concept).

- [ ] **Step 9.5: Update other docs**

```bash
for f in UNIT_TESTING.md CODE_REVIEW.md VERSION_MANAGEMENT.md infra/README.md docs/setup.md docs/security.md docs/troubleshooting.md; do
  sed -i '' \
    -e 's|@journeyman/phases|@journeyman/steps|g' \
    -e 's|@journeyman/custom-phases|@journeyman/custom-steps|g' \
    -e 's|packages/phases|packages/steps|g' \
    -e 's|packages/custom-phases|packages/custom-steps|g' \
    -e 's/Custom Phases/Custom Steps/g' \
    -e 's/Custom Phase/Custom Step/g' \
    -e 's/custom phase/custom step/g' \
    -e 's/phaseType/stepType/g' \
    "$f"
done
```

Review each file and fix lingering "phase"/"Phase" word-uses related to the concept.

---

## Task 10: Final Sweep and Typecheck

- [ ] **Step 10.1: Reinstall to relink renamed workspaces**

```bash
npm install
```

Expected: npm relinks `@journeyman/steps` and `@journeyman/custom-steps` symlinks under `node_modules/`. Any errors here indicate a `package.json` name mismatch.

- [ ] **Step 10.2: Global grep for stragglers**

```bash
rg -i "phase" \
  -g '!package-lock.json' \
  -g '!docs/superpowers/specs/**' \
  -g '!packages/migrations/src/sql/0[01][0-9]_*.sql' \
  -g '!packages/migrations/src/sql/02[0-4]_*.sql' \
  -g '!node_modules' \
  -g '!.git' \
  | head -100
```

Review the output. Any match in source code identifiers, imports, exports, route paths, JSX text labels, or markdown referring to the workflow concept is a miss — fix it.

Acceptable remaining matches:
- Historical migration filenames in `packages/migrations/src/sql/` (e.g. `012_custom_ai_phases.sql`, `014_custom_phase_default_tools.sql`, …) — these are append-only history.
- Historical design docs in `docs/superpowers/specs/` (dated artifacts).
- Unrelated word usage (e.g. "phase of the moon"), if any.

- [ ] **Step 10.3: Confirm renamed packages are wired**

```bash
ls packages/
```

Expected: `steps/`, `custom-steps/` present; no `phases/`, `custom-phases/`.

```bash
rg '"name"' packages/steps/package.json packages/custom-steps/package.json
```

Expected:

```
packages/steps/package.json:  "name": "@journeyman/steps",
packages/custom-steps/package.json:  "name": "@journeyman/custom-steps",
```

```bash
rg '@journeyman/phases|@journeyman/custom-phases' packages/ scripts/ 2>/dev/null
```

Expected: no matches.

- [ ] **Step 10.4: Final typecheck**

```bash
npm run check
```

Expected: passes (both `typecheck` and `check:boundaries`). If failures appear:

- **Type errors**: open the failing file, find the residual `Phase` identifier or import path, replace, rerun.
- **Boundary errors**: `scripts/check-import-boundaries.mjs` should already list `@journeyman/steps` (Task 3.4). If it still references `@journeyman/phases`, fix it.

Once `npm run check` passes, the rename is done. Stop here — no commit, no tests run per user direction. Hand off to user for review of the working tree.
