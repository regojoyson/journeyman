# Rename "Phase" → "Step" — Design

**Date:** 2026-05-19
**Status:** Approved (design)
**Scope:** Rename the term "phase" to "step" everywhere — code, DB columns/tables, package names, directory names, API routes, frontend, and docs. No backwards-compatibility shims.

## Motivation

The codebase mixes two terms for the same concept. `FlowStepDefinition` already calls them **steps**, but the catalog, handlers, custom-AI feature, packages, and DB table all say **phase**. The mixed vocabulary leaks into UX copy ("Custom Phases" page) and into the type system. Standardizing on "step" gives us one word end-to-end and matches the term flow authors already see on flow definitions.

## Approach

**Single big-bang rename in one PR.** No aliases, no route redirects, no JSON migration for old flow files in `examples/` — those get rewritten. This follows the project's "no backwards-compatibility shims" rule (CLAUDE.md).

The typechecker is the safety net for code. SQL strings, registry keys, route paths, and JSONB content are handled by targeted grep + a DB migration with `jsonb` rewrites.

## Naming Map

| Before | After |
|---|---|
| `phase` (variable, prop, field) | `step` |
| `Phase` (type, class, component) | `Step` |
| `PhaseDefinition` | `StepDefinition` |
| `PhaseCatalogEntry` | `StepCatalogEntry` |
| `CustomPhase` / `CustomAiPhase` | `CustomStep` / `CustomAiStep` |
| `phaseId`, `phaseType`, `phaseHandler` | `stepId`, `stepType`, `stepHandler` |
| `*-phase-handler.ts` (file names) | `*-step-handler.ts` |
| `packages/phases/` | `packages/steps/` |
| `packages/custom-phases/` | `packages/custom-steps/` |
| `@journeyman/phases` (npm name) | `@journeyman/steps` |
| `@journeyman/custom-phases` (npm name) | `@journeyman/custom-steps` |
| DB table `jm_custom_ai_phases` | `jm_custom_ai_steps` |
| Any column matching `*_phase_*` | `*_step_*` (rename in-place) |
| API routes `/custom-phases`, `/org-custom-phases`, `/user-custom-phases` | `/custom-steps`, `/org-custom-steps`, `/user-custom-steps` |
| `/phases` catalog route | `/steps` |
| `docs/custom-phases.md` | `docs/custom-steps.md` |
| UI: "Custom Phases", "Phase", "phase" | "Custom Steps", "Step", "step" |

`FlowStepDefinition` already uses "step" and stays as-is.

## Execution Order

Order matters because later layers depend on the earlier ones. Each step is committed individually so the rename can be reviewed in slices.

1. **DB migration** — new SQL file `025_rename_phases_to_steps.sql`:
   - `ALTER TABLE jm_custom_ai_phases RENAME TO jm_custom_ai_steps;`
   - Rename indexes, constraints, sequences that include `phase` in their name.
   - Rename any `*_phase_*` columns to `*_step_*`.
   - Rewrite JSONB content in any flow-definition rows: replace top-level keys `phaseId` → `stepId` and `phaseType` → `stepType` via `jsonb_set` or a regex on the serialized form. Audit which tables hold flow JSONB first (likely `jm_flows`, `jm_runs` snapshot column).
   - Forward-only. No down migration.

2. **`@journeyman/core` types** — rename type/interface members (`PhaseDefinition` → `StepDefinition`, etc.). This is the choke point — everything downstream depends on it. Typecheck fails everywhere until each consumer is updated.

3. **`packages/phases/` → `packages/steps/`** — `git mv` directory, update `package.json` name, internal imports, exports. Update `package.json` workspaces glob if needed (it's `packages/*` so no change).

4. **`packages/custom-phases/` → `packages/custom-steps/`** — same treatment. Update API route paths inside the package.

5. **`packages/orchestrator/`** — rename `src/workers/phases/` directory to `src/workers/steps/`, rename every `*-phase-handler.ts` → `*-step-handler.ts`, rename handler classes and registry keys.

6. **`packages/api-server/`** — update route registrations to point at new paths.

7. **Other backend packages** (`mcp`, `skills`, `identity`, etc.) — update any imports and references.

8. **Frontend** — rename components, pages, routes, hooks, API client functions:
   - `AdminCustomPhasesPage` → `AdminCustomStepsPage`
   - `MyCustomPhasesPage` → `MyCustomStepsPage`
   - `CustomPhasesList`, `EditCustomPhaseModal`, `useCustomPhasePaletteEntries`, `packages/web/src/api/customPhases.ts`, etc.
   - User-visible copy in JSX strings: "Custom Phases" → "Custom Steps", "Phase" → "Step".
   - React Router paths: `/custom-phases` → `/custom-steps`.

9. **Examples & fixtures** — rewrite `phaseId`/`phaseType` in `examples/flows/*.json`. Postman collection updated.

10. **Docs** — `CLAUDE.md`, `README.md`, `ARCHITECTURE.md`, `AGENT.md`, `docs/custom-phases.md` (rename + content), `docs/setup.md`, `docs/security.md`, `docs/troubleshooting.md`, `infra/README.md`, `UNIT_TESTING.md`, `CODE_REVIEW.md`, `VERSION_MANAGEMENT.md`. Prior design docs in `docs/superpowers/specs/` are historical and not rewritten.

11. **Verification** — `npm install` (workspace links rebuild), `npm run check` (typecheck + import boundaries), `npm test`, run the migration against a dev DB, smoke-test the web app: open editor, add a custom step, run a workflow.

## Things the Typechecker Will Not Catch

Manual grep passes after the type-driven rename:

- `rg -i "phase"` across the repo — anything remaining is a string literal, comment, doc, or filename miss.
- SQL files (`packages/migrations/src/sql/`) — older migration filenames keep their historical names (don't rewrite the old `012_custom_ai_phases.sql` filename; the new `025_rename_phases_to_steps.sql` is what matters).
- Registry / discriminator string keys in handler registration.
- Route path strings in Fastify route definitions.
- Test fixture JSON.
- JSONB content in DB rows (handled by migration step 1).

## Out of Scope

- Renaming **historical spec filenames** in `docs/superpowers/specs/` — those are dated artifacts.
- Renaming Postgres role names, table names unrelated to phases, environment variables.
- Renaming the term "flow" anywhere (separate concept).
- Rewriting old migration filenames (e.g. `012_custom_ai_phases.sql`) — migrations are append-only historical record.

## Risks

- **Custom step JSONB in production data**: if any deployment already has saved flows with `phaseId`/`phaseType` in JSONB, the migration's JSONB rewrite must hit them. Audit the schema for JSONB columns containing flow definitions before writing the migration.
- **External API consumers**: anyone calling `/custom-phases` directly will break. Per project rules, acceptable.
- **npm workspace linking**: package renames require `npm install` after the move to relink. Run it before typechecking.

## Acceptance Criteria

- `npm run check` passes.
- `npm test` passes.
- `rg -i "phase" -g '!docs/superpowers/specs/**' -g '!packages/migrations/src/sql/0[01][0-9]_*' -g '!package-lock.json'` returns no matches outside of unrelated word usage (e.g. "phase of the moon" jokes, if any — none expected).
- DB migration applied cleanly against a fresh dev DB and against a DB with pre-existing custom-phase rows.
- Web app boots, custom-steps page loads, a workflow with a custom step runs to completion.
