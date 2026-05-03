# Provider-aware Secret Slots

**Date:** 2026-05-03
**Status:** Approved

## Problem

Two connected bugs:

**Bug A (Editor):** Every issue-provider phase (`get-issue`, `create-issue`, `update-issue-fields`, `comment-on-issue`, `transition-issue`) has a static `slots` array hardcoded to `GITHUB_ACCESS_TOKEN`. `RequiredSecretsTab` reads `phaseDef.slots` directly and never consults the selected provider. Switching the provider dropdown to Jira still shows `GITHUB_ACCESS_TOKEN` instead of `JIRA_API_TOKEN`, `JIRA_EMAIL`, `JIRA_HOST`.

**Bug B (Runtime):** `conductor-converter.ts` puts `resolvedNode.config` into `inputParameters` but never includes `resolvedNode.executorConfig.provider`. Every phase handler reads `input.provider` to dispatch to the correct factory branch — but it is always `undefined`. The factory in `cli-worker.ts` falls through to its hardcoded default (`"jira"` for issue phases). The provider dropdown has had zero effect on runtime behavior.

## Approach

Centralize provider credential requirements in `PROVIDER_CATALOG` (Option B). Secrets are a property of a provider's auth scheme, not of individual phases. All five issue-provider phases for Jira need the same three secrets; all GitHub variants need the same one. One entry per provider is the single source of truth for both the editor and the runtime.

## Design

### 1. Move `SecretSlotDef` to `@journeyman/core`

`SecretSlotDef` currently lives in `packages/flow-editor/src/phase-definition.ts`. Adding it to `PROVIDER_CATALOG` requires it in `core`. The type is simple:

```ts
export interface SecretSlotDef {
  name: string;
  description: string;
  optional?: boolean;
}
```

Move the interface to `packages/core/src/types/secret-slot.types.ts`, export it from `core/src/index.ts`, and re-export it from `packages/flow-editor/src/phase-definition.ts` so existing imports in `RequiredSecretsTab` do not break.

### 2. Add `slots` to `ProviderEntry` in `provider-catalog.ts`

```ts
export interface ProviderEntry {
  kind: ExecutorKind;
  value: string;
  label: string;
  implemented: boolean;
  isDefault?: boolean;
  slots?: SecretSlotDef[];   // ← new
}
```

Populate for all implemented issue-provider entries:

| Provider | Slots |
|---|---|
| `jira` | `JIRA_API_TOKEN`, `JIRA_EMAIL`, `JIRA_HOST` |
| `github-issues` | `GITHUB_ACCESS_TOKEN` |
| `github-projects` | `GITHUB_ACCESS_TOKEN` |

Git-provider and coding-cli entries leave `slots` undefined for now (handled by their own phase-level slots or separate work).

### 3. Remove hardcoded `slots` from issue phase definitions

Drop `slots: [{ name: "GITHUB_ACCESS_TOKEN", ... }]` from all five issue phase tsx files:

- `packages/phases/src/issues/get-issue.tsx`
- `packages/phases/src/issues/create-issue.tsx`
- `packages/phases/src/issues/update-issue-fields.tsx`
- `packages/phases/src/issues/comment-on-issue.tsx`
- `packages/phases/src/issues/transition-issue.tsx`

`PhaseDefinition.slots` remains in the type as an optional escape hatch for any future phase that needs credentials beyond what its provider declares.

### 4. Fix `RequiredSecretsTab` — derive slots from catalog

`RequiredSecretsTab` receives `flow` and `node`. Add logic to compute effective slots:

```ts
// 1. Phase-level override (rare escape hatch)
const phaseSlots = phaseDef?.slots ?? [];

// 2. Provider slots from catalog
const kind = phaseDef?.executor.kind;
const effectiveProvider =
  node.executorConfig?.provider ??
  flow.defaults?.executorConfig?.[kind]?.provider ??
  defaultProviderForKind(kind)?.value;
const providerSlots =
  PROVIDER_CATALOG.find(p => p.value === effectiveProvider)?.slots ?? [];

// 3. Merge: phase-level first, then provider (deduplicated by name)
const slots = phaseSlots.length > 0
  ? phaseSlots
  : providerSlots;
```

When the user changes the provider dropdown, `node.executorConfig.provider` updates → component re-renders → correct slot rows appear automatically.

### 5. Fix `conductor-converter.ts` — forward provider to task input

In `emitPhase`, add `provider` to `inputParameters`:

```ts
inputParameters: {
  ...(resolvedNode.config ?? {}),
  ...resolveInputs(resolvedNode.inputs),
  provider: resolvedNode.executorConfig?.provider,   // ← new
  retry: resolvedNode.retry ?? {},
  secretBindings: bindings,
  _flowDefaultSources: defaultSources,
},
```

`resolvedNode` already has flow-defaults merged in via `applyFlowDefaults`, so `executorConfig.provider` is the fully-resolved effective provider at this point.

### 6. Fix `worker-harness` — derive slots from catalog

Replace the static `phaseDef.slots` read with a catalog lookup using the task's provider:

```ts
// Before
const slots = (phaseDef as unknown as { slots?: ... })?.slots ?? [];

// After
import { PROVIDER_CATALOG, kindForPhaseType } from "@journeyman/core";

const provider = (phaseInput as { provider?: string }).provider;
const phaseKind = kindForPhaseType(phaseType);
const providerSlots =
  PROVIDER_CATALOG.find(p => p.value === provider && p.kind === phaseKind)?.slots ?? [];
const phaseSlots =
  (phaseDef as unknown as { slots?: Array<{ name: string; optional?: boolean }> })?.slots ?? [];
const slots = phaseSlots.length > 0 ? phaseSlots : providerSlots;
```

## End-to-end example

**User selects GitHub Issues on a Get Issue phase:**

1. `node.executorConfig = { provider: "github-issues" }`.
2. Required Secrets tab shows one row: `GITHUB_ACCESS_TOKEN`. User leaves it on Auto.
3. Flow is saved. `conductor-converter` emits:
   ```json
   { "issueRef": "owner/repo#42", "provider": "github-issues",
     "secretBindings": { "GITHUB_ACCESS_TOKEN": { "mode": "auto" } } }
   ```
4. Worker reads `provider = "github-issues"`, looks up catalog → slot `GITHUB_ACCESS_TOKEN`.
5. `bindingResolver` resolves it from the secret store → `ctx.env.GITHUB_ACCESS_TOKEN`.
6. `GitHubIssuesProvider({ token: env.GITHUB_ACCESS_TOKEN })` is instantiated. ✅

**User selects Jira:**

1. `node.executorConfig = { provider: "jira" }`.
2. Required Secrets tab shows three rows: `JIRA_API_TOKEN`, `JIRA_EMAIL`, `JIRA_HOST`. Each has auto/pin binding.
3. Converter emits all three in `secretBindings`, plus `"provider": "jira"`.
4. Worker resolves all three → `ctx.env.JIRA_API_TOKEN`, `ctx.env.JIRA_EMAIL`, `ctx.env.JIRA_HOST`.
5. `JiraProvider({ apiToken, email, host })` is instantiated. ✅

## Binding UX (unchanged)

Each slot row in the editor shows the existing auto/pin dropdown:
- **Auto** — finds the secret by exact name (e.g. `JIRA_API_TOKEN`) in order: user → org → global. First match wins.
- **Pin** — user picks one specific secret from any tier by name.

An org can store all three Jira secrets at org scope with those exact names; everyone leaves binding on Auto and the preview reads "✓ Will use: JIRA_API_TOKEN from Organization".

## Files changed

| File | Change |
|---|---|
| `packages/core/src/types/secret-slot.types.ts` | New — `SecretSlotDef` interface |
| `packages/core/src/index.ts` | Export `SecretSlotDef` |
| `packages/core/src/registries/provider-catalog.ts` | Add `slots` to `ProviderEntry`; populate for jira, github-issues, github-projects |
| `packages/flow-editor/src/phase-definition.ts` | Re-export `SecretSlotDef` from core |
| `packages/phases/src/issues/get-issue.tsx` | Remove hardcoded `slots` |
| `packages/phases/src/issues/create-issue.tsx` | Remove hardcoded `slots` |
| `packages/phases/src/issues/update-issue-fields.tsx` | Remove hardcoded `slots` |
| `packages/phases/src/issues/comment-on-issue.tsx` | Remove hardcoded `slots` |
| `packages/phases/src/issues/transition-issue.tsx` | Remove hardcoded `slots` |
| `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx` | Derive slots from catalog using effective provider |
| `packages/orchestrator/src/flow-json/conductor-converter.ts` | Add `provider` to `inputParameters` |
| `packages/orchestrator/src/workers/worker-harness.ts` | Derive slots from catalog using `phaseInput.provider` |
