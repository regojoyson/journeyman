# Provider-aware Secret Slots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Required Secrets tab and the runtime slot resolver both reflect the selected provider, fixing two connected bugs where slots were hardcoded to `GITHUB_ACCESS_TOKEN` and `executorConfig.provider` was never forwarded to the task worker.

**Architecture:** Move `SecretSlotDef` into `@journeyman/core`, attach `slots` arrays to each `ProviderEntry` in `PROVIDER_CATALOG`, then update the editor tab and worker harness to look up slots from the catalog using the effective provider. Also forward `executorConfig.provider` through the Conductor converter so the runtime knows which provider to instantiate.

**Tech Stack:** TypeScript, React, `@journeyman/core`, `@journeyman/flow-editor`, `@journeyman/phases`, `@journeyman/orchestrator`.

**User instructions:** No commits. No unit tests. Run `npm run typecheck` at the end.

---

## File Map

| File | Action | What changes |
|---|---|---|
| `packages/core/src/types/secret-slot.types.ts` | **Create** | `SecretSlotDef` interface |
| `packages/core/src/index.ts` | **Modify** | Export `SecretSlotDef` |
| `packages/core/src/registries/provider-catalog.ts` | **Modify** | Add `slots?` to `ProviderEntry`; populate jira, github-issues, github-projects |
| `packages/flow-editor/src/phase-definition.ts` | **Modify** | Replace local `SecretSlotDef` definition with re-export from core |
| `packages/flow-editor/src/index.ts` | **Modify** | Add `SecretSlotDef` to the public exports |
| `packages/phases/src/issues/get-issue.tsx` | **Modify** | Remove hardcoded `slots` array |
| `packages/phases/src/issues/create-issue.tsx` | **Modify** | Remove hardcoded `slots` array |
| `packages/phases/src/issues/update-issue-fields.tsx` | **Modify** | Remove hardcoded `slots` array |
| `packages/phases/src/issues/comment-on-issue.tsx` | **Modify** | Remove hardcoded `slots` array |
| `packages/phases/src/issues/transition-issue.tsx` | **Modify** | Remove hardcoded `slots` array |
| `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx` | **Modify** | Derive slots from catalog using effective provider |
| `packages/orchestrator/src/flow-json/conductor-converter.ts` | **Modify** | Add `provider` to `inputParameters` |
| `packages/orchestrator/src/workers/worker-harness.ts` | **Modify** | Derive slots from catalog using `phaseInput.provider` |

---

## Task 1: Create `SecretSlotDef` in `@journeyman/core`

**Files:**
- Create: `packages/core/src/types/secret-slot.types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create the type file**

Create `packages/core/src/types/secret-slot.types.ts` with this exact content:

```ts
export interface SecretSlotDef {
  name: string;
  description: string;
  optional?: boolean;
}
```

- [ ] **Step 2: Export it from `packages/core/src/index.ts`**

In `packages/core/src/index.ts`, add this line after the existing `export type *` block (after line 13, before the blank line):

```ts
export type * from "./types/secret-slot.types.ts";
```

---

## Task 2: Re-export `SecretSlotDef` from `@journeyman/flow-editor`

**Files:**
- Modify: `packages/flow-editor/src/phase-definition.ts`
- Modify: `packages/flow-editor/src/index.ts`

- [ ] **Step 1: Replace local definition with re-export in `phase-definition.ts`**

In `packages/flow-editor/src/phase-definition.ts`, find and replace the local interface definition (lines 23–32):

```ts
export interface SecretSlotDef {
  /** Slot identifier — what the phase reads at runtime as ctx.env[name].
   *  Convention: SCREAMING_SNAKE_CASE. Validated against ^[A-Z][A-Z0-9_]*$. */
  name: string;
  /** Short, human-friendly explanation. Shown next to the slot in the editor. */
  description: string;
  /** Optional slots: Auto-mode failing to resolve does NOT fail the run.
   *  Phase handler must tolerate ctx.env[name] being undefined. */
  optional?: boolean;
}
```

Replace with a re-export:

```ts
export type { SecretSlotDef } from "@journeyman/core";
```

- [ ] **Step 2: Export `SecretSlotDef` from flow-editor's public index**

In `packages/flow-editor/src/index.ts`, find the block that exports from `"./phase-definition.ts"` (around lines 10–17). It currently reads something like:

```ts
export type {
  PhaseDefinition,
  PhaseRunState,
  PhaseFormProps,
  PhaseSummaryCtx,
  FieldMeta,
  TabVisibility,
  ExecutorKind,
} from "./phase-definition.ts";
```

Add `SecretSlotDef` to that list:

```ts
export type {
  PhaseDefinition,
  PhaseRunState,
  PhaseFormProps,
  PhaseSummaryCtx,
  FieldMeta,
  TabVisibility,
  ExecutorKind,
  SecretSlotDef,
} from "./phase-definition.ts";
```

---

## Task 3: Add `slots` to `ProviderEntry` and populate the catalog

**Files:**
- Modify: `packages/core/src/registries/provider-catalog.ts`

- [ ] **Step 1: Add the import and field to `ProviderEntry`**

At the top of `packages/core/src/registries/provider-catalog.ts`, add the import:

```ts
import type { SecretSlotDef } from "../types/secret-slot.types.ts";
```

Then add `slots?: SecretSlotDef[]` to the `ProviderEntry` interface:

```ts
export interface ProviderEntry {
  kind: ExecutorKind;
  value: string;
  label: string;
  implemented: boolean;
  isDefault?: boolean;
  slots?: SecretSlotDef[];
}
```

- [ ] **Step 2: Populate slots on issue-provider entries**

In `PROVIDER_CATALOG`, update the three implemented issue-provider entries. Replace:

```ts
  // issue-provider
  { kind: "issue-provider", value: "jira",            label: "Jira",            implemented: true, isDefault: true },
  { kind: "issue-provider", value: "github-issues",   label: "GitHub Issues",   implemented: true },
  { kind: "issue-provider", value: "github-projects", label: "GitHub Projects", implemented: true },
  { kind: "issue-provider", value: "linear",          label: "Linear",          implemented: false },
  { kind: "issue-provider", value: "monday",          label: "Monday",          implemented: false },
```

With:

```ts
  // issue-provider
  { kind: "issue-provider", value: "jira", label: "Jira", implemented: true, isDefault: true, slots: [
    { name: "JIRA_API_TOKEN", description: "Atlassian API token (user or service account)" },
    { name: "JIRA_EMAIL",     description: "Atlassian account email associated with the token" },
    { name: "JIRA_HOST",      description: "Your Jira domain, e.g. acme.atlassian.net" },
  ]},
  { kind: "issue-provider", value: "github-issues", label: "GitHub Issues", implemented: true, slots: [
    { name: "GITHUB_ACCESS_TOKEN", description: "GitHub PAT with repo scope" },
  ]},
  { kind: "issue-provider", value: "github-projects", label: "GitHub Projects", implemented: true, slots: [
    { name: "GITHUB_ACCESS_TOKEN", description: "GitHub PAT with repo and project scopes" },
  ]},
  { kind: "issue-provider", value: "linear",  label: "Linear",  implemented: false },
  { kind: "issue-provider", value: "monday",  label: "Monday",  implemented: false },
```

---

## Task 4: Remove hardcoded `slots` from all five issue phase definitions

**Files:**
- Modify: `packages/phases/src/issues/get-issue.tsx`
- Modify: `packages/phases/src/issues/create-issue.tsx`
- Modify: `packages/phases/src/issues/update-issue-fields.tsx`
- Modify: `packages/phases/src/issues/comment-on-issue.tsx`
- Modify: `packages/phases/src/issues/transition-issue.tsx`

- [ ] **Step 1: `get-issue.tsx` — remove slots**

In `packages/phases/src/issues/get-issue.tsx`, remove these lines (they appear between `tabs: ...` and `summary: ...`):

```ts
  slots: [
    {
      name: "GITHUB_ACCESS_TOKEN",
      description: "GitHub PAT with repo and project scopes — used to call the GitHub API.",
    },
  ],
```

- [ ] **Step 2: `create-issue.tsx` — remove slots**

In `packages/phases/src/issues/create-issue.tsx`, remove these lines (between `tabs: ...` and `summary: ...`):

```ts
  slots: [
    {
      name: "GITHUB_ACCESS_TOKEN",
      description: "GitHub PAT with repo and project scopes — used to call the GitHub API.",
    },
  ],
```

- [ ] **Step 3: `update-issue-fields.tsx` — remove slots**

In `packages/phases/src/issues/update-issue-fields.tsx`, remove these lines (between `tabs: ...` and `summary: ...`):

```ts
  slots: [
    {
      name: "GITHUB_ACCESS_TOKEN",
      description: "GitHub PAT with repo and project scopes — used to call the GitHub API.",
    },
  ],
```

- [ ] **Step 4: `comment-on-issue.tsx` — remove slots**

In `packages/phases/src/issues/comment-on-issue.tsx`, remove these lines (between `tabs: ...` and `summary: ...`):

```ts
  slots: [
    {
      name: "GITHUB_ACCESS_TOKEN",
      description: "GitHub PAT with repo and project scopes — used to call the GitHub API.",
    },
  ],
```

- [ ] **Step 5: `transition-issue.tsx` — remove slots**

In `packages/phases/src/issues/transition-issue.tsx`, remove these lines (between `tabs: ...` and `summary: ...`):

```ts
  slots: [
    {
      name: "GITHUB_ACCESS_TOKEN",
      description: "GitHub PAT with repo and project scopes — used to call the GitHub API.",
    },
  ],
```

---

## Task 5: Fix `RequiredSecretsTab` to derive slots from the catalog

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx`

- [ ] **Step 1: Update imports**

In `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx`, the current import from `@journeyman/core` is:

```ts
import type { FlowGraph, FlowNode, SecretBinding, SecretScope } from "@journeyman/core";
```

Replace it with:

```ts
import { PROVIDER_CATALOG } from "@journeyman/core";
import type { FlowGraph, FlowNode, SecretBinding, SecretScope } from "@journeyman/core";
```

Then add an import for `defaultProviderFor` from the executor-common-config (already used elsewhere in this package):

```ts
import { defaultProviderFor } from "../executor-common-config.ts";
```

- [ ] **Step 2: Replace the static slots derivation**

In `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx`, find this block inside `RequiredSecretsTab` (around lines 64–66):

```ts
  const registry = usePhaseRegistry();
  const phaseDef = node.phaseType ? registry.get(node.phaseType) : undefined;
  const slots: SecretSlotDef[] = phaseDef?.slots ?? [];
```

Replace with:

```ts
  const registry = usePhaseRegistry();
  const phaseDef = node.phaseType ? registry.get(node.phaseType) : undefined;

  const kind = phaseDef?.executor.kind;
  const effectiveProvider =
    node.executorConfig?.provider ??
    (kind && kind !== "control"
      ? flow.defaults?.executorConfig?.[kind]?.provider
      : undefined) ??
    (kind ? defaultProviderFor(kind) : undefined);
  const providerSlots = PROVIDER_CATALOG.find(p => p.value === effectiveProvider)?.slots ?? [];
  const slots: SecretSlotDef[] = phaseDef?.slots?.length ? phaseDef.slots : providerSlots;
```

---

## Task 6: Fix `conductor-converter.ts` — forward provider to task input

**Files:**
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts`

- [ ] **Step 1: Add `provider` to `inputParameters`**

In `packages/orchestrator/src/flow-json/conductor-converter.ts`, find the `inputParameters` object inside `emitPhase` (around lines 190–199):

```ts
      inputParameters: (() => {
        const bindings = resolvedNode.secretBindings ?? {};
        return {
          ...(resolvedNode.config ?? {}),
          ...resolveInputs(resolvedNode.inputs),
          retry: resolvedNode.retry ?? {},
          secretBindings: bindings,
          _flowDefaultSources: defaultSources,
        };
      })(),
```

Replace with:

```ts
      inputParameters: (() => {
        const bindings = resolvedNode.secretBindings ?? {};
        return {
          ...(resolvedNode.config ?? {}),
          ...resolveInputs(resolvedNode.inputs),
          provider: resolvedNode.executorConfig?.provider,
          retry: resolvedNode.retry ?? {},
          secretBindings: bindings,
          _flowDefaultSources: defaultSources,
        };
      })(),
```

---

## Task 7: Fix `worker-harness.ts` — derive slots from catalog

**Files:**
- Modify: `packages/orchestrator/src/workers/worker-harness.ts`

- [ ] **Step 1: Update imports**

In `packages/orchestrator/src/workers/worker-harness.ts`, the current imports from `@journeyman/core` are:

```ts
import { createLogger } from "@journeyman/core";
import type {
  IEventBus, IPhaseRegistry, IWorkspaceProvider,
  SecretBinding,
} from "@journeyman/core";
```

Replace with:

```ts
import { createLogger, PROVIDER_CATALOG, kindForPhaseType } from "@journeyman/core";
import type {
  IEventBus, IPhaseRegistry, IWorkspaceProvider,
  SecretBinding,
} from "@journeyman/core";
```

- [ ] **Step 2: Replace static slot derivation with catalog lookup**

In `packages/orchestrator/src/workers/worker-harness.ts`, find this block inside `processOnce` (around lines 104–113):

```ts
    let resolvedEnv: Record<string, string>;
    try {
      const phaseDef = this.deps.registry.get(phaseType);
      const slots = (phaseDef as unknown as { slots?: Array<{ name: string; optional?: boolean }> })?.slots ?? [];

      resolvedEnv = await this.deps.bindingResolver({
        ctx: { userId, flowId },
        slots,
        bindings: declaredBindings,
      });
```

Replace with:

```ts
    let resolvedEnv: Record<string, string>;
    try {
      const phaseDef = this.deps.registry.get(phaseType);
      const phaseKind = kindForPhaseType(phaseType);
      const provider = (phaseInput as { provider?: string }).provider;
      const providerSlots = phaseKind
        ? (PROVIDER_CATALOG.find(p => p.value === provider && p.kind === phaseKind)?.slots ?? [])
        : [];
      const phaseSlots = (phaseDef as unknown as { slots?: Array<{ name: string; optional?: boolean }> })?.slots ?? [];
      const slots = phaseSlots.length > 0 ? phaseSlots : providerSlots;

      resolvedEnv = await this.deps.bindingResolver({
        ctx: { userId, flowId },
        slots,
        bindings: declaredBindings,
      });
```

---

## Task 8: Typecheck all packages

- [ ] **Step 1: Run typecheck from the repo root**

```bash
npm run typecheck
```

Expected: zero errors. If there are errors, they will be type mismatches caused by the `SecretSlotDef` move or the `kind !== "control"` guard. Common fixes:

- If TypeScript complains about `flow.defaults?.executorConfig?.[kind]` where `kind` includes `"control"`: the `kind && kind !== "control"` guard in Task 5 Step 2 narrows the type — double-check the guard is in place.
- If TypeScript complains about `SecretSlotDef` not found somewhere: check the re-export chain — `core` → `phase-definition.ts` → any consumer.
