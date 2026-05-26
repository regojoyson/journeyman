# Generic Step Ref — Design

**Date:** 2026-05-26
**Status:** Draft
**Scope:** Drop the platform-level `issueRef` namespacing concept. Rename to a neutral `ref` across step inputs and the `Issue` shape. Generic-only New Run dialog.

## Problem

The platform treats `issueRef` as a first-class concept with three layers of bias toward Jira/GitHub:

1. **Helpers** — `buildIssueRef(provider, rawId) → "jira:PROJ-123"` and `parseIssueRef`. Define a namespaced string format.
2. **UI** — The New Run dialog has a hardcoded "Issue Ref" widget: a provider dropdown (`jira` | `github` | `monday` | `linear`) plus a raw-id input, combined into `inputs.issueRef`. The dialog renders other inputs from `inputDefs` already but filters out anything named `issueRef`.
3. **Step contracts** — Every issue/repo built-in step declares an input named `issueRef`. The `Issue` shape returned by `get-issue` has fields `issueRef` (namespaced) and `issueRefShort` (display). Custom-AI steps have a special `"issueRef"` member in their input-type union.

Investigation of runtime use revealed the namespacing is mostly vestigial:

- Step handlers (`get-issue`, `transition-issue`, etc.) already treat the value as an opaque string. Provider routing is driven by a separate `input.provider` config field, not by parsing the namespace prefix.
- Only one caller of `parseIssueRef` exists at runtime: `packages/ticket-provider/src/providers/jira/operations/get-issue-schema.ts:32`, which strips the prefix before calling Jira's REST API.
- `buildIssueRef` is only used in the New Run dialog.

So the namespacing convention does nothing functional — it just forces the workflow author to wrap their id in `jira:` (or wherever) for the dialog, and forces the Jira provider to unwrap it. Net cost: complexity + provider bias in the platform core.

## Design

### Naming

Step inputs and the `Issue` identifier field both rename to **`ref`**. Chosen over alternatives (`target`, `id`, `issueKey`) for being short, neutral, and free of domain coupling. Risk of confusion with `WorkflowInputValue.kind = "ref"` is minimal — different layers, used in different contexts.

### Things removed

| Symbol | Location | Replacement |
|---|---|---|
| `buildIssueRef`, `parseIssueRef`, `IssueRefProvider`, `ParsedIssueRef` | `packages/core/src/utils/issue-ref.ts` | none — delete the file and its `index.ts` re-exports |
| The "Issue Ref" provider+id widget | `packages/web/src/routes/RunsListPage.tsx` — `NewRunDialog` | none — dialog renders only from `inputDefs` |
| Provider auto-namespacing | n/a | step's existing `provider` config field already routes; the input is just a raw id |
| `Issue.issueRefShort` field | `packages/core/src/types/issue.types.ts` | collapses into `Issue.ref` since both carried the same data after de-namespacing |
| `"issueRef"` member of `CustomStepInputType` | `packages/core/src/types/custom-steps.types.ts` | use `"string"` |

### Things renamed: `issueRef` → `ref`

**Built-in step input names** (and their meta `inputFields` declarations):
- `create-workspace` — `config.issueRef` → `config.ref`
- `get-issue` — `config.issueRef` → `config.ref`
- `transition-issue` — `config.issueRef` → `config.ref`
- `update-issue-fields` — `config.issueRef` → `config.ref`
- `comment-on-issue` — `config.issueRef` → `config.ref`

**Step handlers** (read the new input name; drop the historical `issueRef`/`id` aliasing):
- `get-issue-step-handler.ts`
- `transition-issue-step-handler.ts`
- `update-issue-fields-step-handler.ts`
- `comment-on-issue-step-handler.ts`
- `create-workspace-step-handler.ts`

Each handler currently reads `input.id ?? input.issueRef`. The new code reads `input.ref` only.

**`Issue` shape** (`packages/core/src/types/issue.types.ts` + `packages/core/src/types/shapes.ts`):
- `Issue.issueRef: string` → `Issue.ref: string`
- `Issue.issueRefShort` removed
- `IssueShape` definition in `shapes.ts` likewise: `ref` only

**Ticket-provider operations** (`packages/ticket-provider/src/providers/jira/operations/*`):
- `getIssue`, `updateIssue`, `transitionIssue`, `createIssue`, `getIssueSchema` — all currently accept `{ issueRef }` and read the namespaced form. New signature: `{ ref }`, the raw provider id (e.g. `PROJ-123`).
- `get-issue-schema.ts:32` — drop the `parseIssueRef(opts.issueRef).rawId` line; just use `opts.ref` directly.
- The provider returns `Issue.ref` set to the raw id (no `jira:` prefix).

**Coding-CLI operations** (`packages/coding-cli/src/providers/{claude,opencode}/operations/{checkout-repo,create-workspace}.ts`):
- Wherever they accept `issueRef` in their option types, rename to `ref`.

**Pipeline types** (`packages/core/src/types/pipeline.types.ts`, `interfaces/pipeline.interface.ts`):
- Legacy `PipelineRun` / `PipelineEvent` types still carry `issueRef`/`issueRefShort`. Rename `issueRef` → `ref`; drop `issueRefShort`. (These types appear unused by the orchestrator — they're vestiges of the pre-flow-editor pipeline model. If the rename surfaces unused-code, leave the cleanup to a follow-up rather than expanding scope here.)
- `IPipelineStore` methods `findByIssueRef` / `findActiveForIssueRef` → `findByRef` / `findActiveForRef`.

**Git types** (`packages/core/src/types/git.types.ts`):
- `Repo`-related types referencing `issueRef` (likely `cleanupRepos` opts) → `ref`.

**UI step config editors** (`packages/steps/src/issues/*.tsx`, `packages/steps/src/repos/create-workspace.tsx`):
- Bound to the renamed config field; label changes from "Issue ref" to "Ref".

**Custom-step type & adapters**:
- `CustomStepInputType` union — drop `"issueRef"`.
- `packages/custom-steps/src/shape-adapter.ts` — drop the `issueRef` case (collapses into the string case).
- `packages/web/src/components/custom-steps/InputFieldsEditor.tsx` — drop the `"issueRef"` option from the type select.
- `packages/flow-editor/src/properties-panel/ValuePicker.tsx` — drop any `issueRef`-specific picker UI.

### New Run dialog

`packages/web/src/routes/RunsListPage.tsx` — `NewRunDialog`:
- Delete the entire "Issue Ref" `<label>` block (the provider dropdown + raw-id input + the `→ jira:PROJ-123` preview line).
- Delete state `provider`, `rawId`, and the `issueRef` derived value.
- Delete the `dynamicDefs` filter that skips `name !== "issueRef"`. All declared inputs render in the same dynamic loop.
- Delete imports of `buildIssueRef`, `IssueRefProvider`.
- Submit: drop the `if (issueRef.trim()) inputs.issueRef = …` line. The dynamic loop is the only source of inputs.

The dialog becomes a pure renderer over `inputDefs`.

### No migration

Per user decision, the change is a clean break:
- Existing workflows that reference `config.issueRef` or `getIssue.output.issue.issueRef` will fail validation on next publish.
- Existing workflow instances in the DB with `inputs.issueRef = "jira:PROJ-123"` continue to exist; the value is no longer read by anything.
- The user will clean up workflows manually post-deploy. No load-time strip, no SQL migration, no auto-rename.

## What stays

- The concept "this run is about a particular external thing" is still expressible — workflow authors declare an input called `ref` (or any name they like) and bind it through to whichever step needs it.
- The ticket-provider's `provider` field still routes between Jira/GitHub/etc. — provider selection just moves entirely to step-level config instead of being parsed out of the id string.
- Webhook presets, `WebhookProvider` enum, `correlationSuggestions` — all untouched. (Future Spec B.)

## Testing

Manual: load the New Run dialog and confirm it renders only the inputs declared in `inputDefs`. Run a workflow with an issue step end-to-end against Jira to confirm `Issue.ref` carries the raw key and the provider call succeeds.

No new automated tests (per user constraint on the implementation).

## Open questions

None. Naming, scope, and migration policy are all locked in.
