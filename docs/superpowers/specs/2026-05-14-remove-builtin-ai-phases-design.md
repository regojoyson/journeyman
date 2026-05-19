# Remove Built-in AI & Commit-Push Phases

**Date:** 2026-05-14
**Status:** Approved (user pre-approved; no-stop mode)

## Motivation

Four built-in phases duplicate what user-defined custom AI phases already cover. Removing them cuts dead code, type surface, and provider methods, and steers users to the more flexible `custom-ai` phase.

## Phases removed

| Phase type            | Category    | Replacement                |
|-----------------------|-------------|----------------------------|
| `analyze-repo`        | Coding Agent| `custom-ai` phase          |
| `plan-implementation` | Coding Agent| `custom-ai` phase          |
| `implement-changes`   | Coding Agent| `custom-ai` phase          |
| `commit-and-push`     | Workspace   | `custom-ai` phase (bash)   |

## Deletions

**Phase definitions** (`packages/phases/src/`):
- `ai/analyze-repo.{tsx,meta.ts}`
- `ai/plan-implementation.{tsx,meta.ts}`
- `ai/implement-changes.{tsx,meta.ts}`
- `repos/commit-and-push.{tsx,meta.ts}`

**Orchestrator handlers** (`packages/orchestrator/src/workers/phases/`):
- `analyze-repo-phase-handler.ts`
- `plan-implementation-phase-handler.ts`
- `implement-changes-phase-handler.ts`
- `commit-and-push-phase-handler.ts`

**Coding-CLI operations**:
- `packages/coding-cli/src/providers/claude/operations/{analyze,plan,implement,commit-push-repos}.ts`
- `packages/coding-cli/src/providers/opencode/operations/{plan,implement,commit-push-repos}.ts`

## Edits

- `packages/phases/src/registry.ts` — drop imports + entries
- `packages/phases/src/catalog.ts` — drop imports + catalog entries
- `packages/orchestrator/src/index.ts` — drop handler exports
- `packages/orchestrator/src/cli-worker.ts` — drop handler imports + `registry.register` calls
- `packages/core/src/registries/provider-catalog.ts` — drop 4 entries from `PHASE_TYPE_TO_KIND`
- `packages/core/src/interfaces/coding-cli.interface.ts` — drop `analyze`, `plan`, `implement`, `commitPushRepos` methods + related imports
- `packages/core/src/types/coding.types.ts` — drop `AnalyzeOptions/Result`, `PlanOptions/Result`, `ImplementOptions/Result`; drop `"analyze"`, `"plan"`, `"implement"`, `"commitPushRepos"` from operation-name union
- `packages/core/src/types/git.types.ts` — drop `CommitPushReposOptions/Result`
- Provider classes (claude/gemini/codex/opencode) — drop 4 methods + imports
- `packages/flow-editor/**` — drop any hard references; flows that reference removed phase types should still load (custom phase registry is data-driven)

## Out of scope

- Migration of existing flows that reference removed phase types (will surface as "unknown phase" — acceptable, user can replace with custom).
- Removing `docs/superpowers/plans/2026-05-14-commit-push-secret-slot.md` (unrelated WIP).

## Verification

- `npm run typecheck` clean across all packages.
- `grep -r "analyze-repo\|plan-implementation\|implement-changes\|commit-and-push\|commitPushRepos" packages/` returns only the spec file itself.
