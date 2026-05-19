# Per-Kind Provider Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand `FlowDefaults.executorConfig` from a flat `{ provider?: string }` to `Partial<Record<CoreExecutorKind, { provider?: string }>>` so each executor kind (coding-cli, git-provider, ticket-provider, notification) can have its own default provider.

**Architecture:** The type change cascades through four packages — core (type + static map), orchestrator (resolver), api-server (schema), and flow-editor (two UI components). No schema version bump needed; the old flat shape was never in production on this branch. No unit tests. Typecheck runs at the end.

**Tech Stack:** TypeScript, Zod (api-server schema), React (flow-editor)

---

## File Map

| File | Change |
|---|---|
| `packages/core/src/types/flow.types.ts` | Change `FlowDefaults.executorConfig` type |
| `packages/core/src/registries/provider-catalog.ts` | Add `PHASE_KIND_MAP` + `kindForPhaseType` |
| `packages/core/src/index.ts` | Export `PHASE_KIND_MAP` and `kindForPhaseType` |
| `packages/orchestrator/src/flow-json/apply-flow-defaults.ts` | Look up per-kind default in `mergeExecutorConfig` call |
| `packages/api-server/src/schemas/update-flow.ts` | Change `executorConfig` in `flowDefaultsSchema` to `z.record` |
| `packages/flow-editor/src/flow-config/DefaultsExecutorSection.tsx` | Replace single dropdown with 4 per-kind dropdowns |
| `packages/flow-editor/src/properties-panel/ExecutorBlock.tsx` | Change `defaultProvider` lookup to use `kind` prop |

---

## Task 1: Update `FlowDefaults.executorConfig` type in core

**Files:**
- Modify: `packages/core/src/types/flow.types.ts`

- [ ] **Open `packages/core/src/types/flow.types.ts` and locate `FlowDefaults`** (around line 147). It currently reads:

```ts
export interface FlowDefaults {
  /** Default retry policy. Merged field-by-field into each node's `retry`. */
  retry?: RetryPolicy;
  /** Default executor config. Merged field-by-field into each node's `executorConfig`. */
  executorConfig?: { provider?: string };
  /** Default secret bindings. Merged slot-by-slot into each node's `secretBindings`. */
  secretBindings?: Record<string, SecretBinding>;
  /** Default input wiring. Merged key-by-key into each node's `inputs`. */
  inputs?: Record<string, FlowInputValue>;
}
```

- [ ] **Add a top-level import** of `ExecutorKind` at the top of `packages/core/src/types/flow.types.ts` (after the existing `import type { SecretScope } from "./secrets.types.ts";` line):

```ts
import type { ExecutorKind } from "../registries/provider-catalog.ts";
```

`provider-catalog.ts` has no imports from `flow.types.ts`, so there is no circular dependency.

- [ ] **Replace just the `executorConfig` line** inside `FlowDefaults` to use a per-kind record:

```ts
export interface FlowDefaults {
  /** Default retry policy. Merged field-by-field into each node's `retry`. */
  retry?: RetryPolicy;
  /**
   * Default executor provider per ExecutorKind.
   * Each phase resolves its default via kindForPhaseType(phaseType).
   */
  executorConfig?: Partial<Record<ExecutorKind, { provider?: string }>>;
  /** Default secret bindings. Merged slot-by-slot into each node's `secretBindings`. */
  secretBindings?: Record<string, SecretBinding>;
  /** Default input wiring. Merged key-by-key into each node's `inputs`. */
  inputs?: Record<string, FlowInputValue>;
}
```

---

## Task 2: Add `PHASE_KIND_MAP` and `kindForPhaseType` to provider-catalog

**Files:**
- Modify: `packages/core/src/registries/provider-catalog.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Append to `packages/core/src/registries/provider-catalog.ts`** (after the existing `defaultProviderForKind` function):

```ts
/**
 * Static map from phaseType string to its ExecutorKind.
 * Used by the orchestrator to look up the correct per-kind default
 * from FlowDefaults.executorConfig without access to the editor's PhaseRegistry.
 * Must be updated when new phase types are added.
 */
export const PHASE_KIND_MAP: Record<string, ExecutorKind> = {
  // coding-cli
  "analyze-repo":        "coding-cli",
  "cleanup-workspace":   "coding-cli",
  "clone-repos":         "coding-cli",
  "commit-and-push":     "coding-cli",
  "create-workspace":    "coding-cli",
  "implement-changes":   "coding-cli",
  "list-workspace-files":"coding-cli",
  "plan-implementation": "coding-cli",
  "start-feature-branch":"coding-cli",
  // git-provider
  "get-repository":             "git-provider",
  "list-pull-request-comments": "git-provider",
  "list-pull-requests":         "git-provider",
  "open-pull-request":          "git-provider",
  // ticket-provider
  "comment-on-ticket":  "ticket-provider",
  "create-ticket":      "ticket-provider",
  "get-ticket":         "ticket-provider",
  "transition-ticket":  "ticket-provider",
  "update-ticket-fields":"ticket-provider",
  // notification
  "send-message": "notification",
};

/** Returns the ExecutorKind for a given phaseType, or undefined if unknown. */
export function kindForPhaseType(phaseType: string): ExecutorKind | undefined {
  return PHASE_KIND_MAP[phaseType];
}
```

- [ ] **Export `PHASE_KIND_MAP` and `kindForPhaseType` from `packages/core/src/index.ts`.**

Find the existing provider-catalog export block (around line 62):

```ts
export {
  PROVIDER_CATALOG,
  providersForKind,
  implementedProvidersForKind,
  defaultProviderForKind,
} from "./registries/provider-catalog.ts";
export type { ProviderEntry } from "./registries/provider-catalog.ts";
// Aliased to avoid colliding with flow-editor's own ExecutorKind (which includes "control").
export type { ExecutorKind as CoreExecutorKind } from "./registries/provider-catalog.ts";
```

Change it to:

```ts
export {
  PROVIDER_CATALOG,
  providersForKind,
  implementedProvidersForKind,
  defaultProviderForKind,
  PHASE_KIND_MAP,
  kindForPhaseType,
} from "./registries/provider-catalog.ts";
export type { ProviderEntry } from "./registries/provider-catalog.ts";
// Aliased to avoid colliding with flow-editor's own ExecutorKind (which includes "control").
export type { ExecutorKind as CoreExecutorKind } from "./registries/provider-catalog.ts";
```

---

## Task 3: Update `applyFlowDefaults` in the orchestrator

**Files:**
- Modify: `packages/orchestrator/src/flow-json/apply-flow-defaults.ts`

- [ ] **Add `kindForPhaseType` to the import** at the top of `packages/orchestrator/src/flow-json/apply-flow-defaults.ts`.

Current import line:

```ts
import type { FlowNode, FlowDefaults, RetryPolicy, SecretBinding, FlowInputValue } from "@journeyman/core";
```

Change to:

```ts
import { kindForPhaseType } from "@journeyman/core";
import type { FlowNode, FlowDefaults, RetryPolicy, SecretBinding, FlowInputValue } from "@journeyman/core";
```

- [ ] **Update the `applyFlowDefaults` function body** to resolve the per-kind executor default before calling `mergeExecutorConfig`.

Current body (the four merge lines inside the function):

```ts
  const retry          = mergeRetry(node.retry, defaults.retry, sources);
  const executorConfig = mergeExecutorConfig(node.executorConfig, defaults.executorConfig, sources);
  const secretBindings = mergeMap(node.secretBindings, defaults.secretBindings, "secretBindings", sources);
  const inputs         = mergeInputs(node.inputs, defaults.inputs, sources);
```

Change to:

```ts
  const phaseKind      = node.phaseType ? kindForPhaseType(node.phaseType) : undefined;
  const kindDefault    = phaseKind ? defaults.executorConfig?.[phaseKind] : undefined;

  const retry          = mergeRetry(node.retry, defaults.retry, sources);
  const executorConfig = mergeExecutorConfig(node.executorConfig, kindDefault, sources);
  const secretBindings = mergeMap(node.secretBindings, defaults.secretBindings, "secretBindings", sources);
  const inputs         = mergeInputs(node.inputs, defaults.inputs, sources);
```

`mergeExecutorConfig` signature and body are unchanged — it still merges two `{ provider?: string }` objects.

---

## Task 4: Update `flowDefaultsSchema` in the API server

**Files:**
- Modify: `packages/api-server/src/schemas/update-flow.ts`

- [ ] **Locate `flowDefaultsSchema`** in `packages/api-server/src/schemas/update-flow.ts` (around line 30):

```ts
const flowDefaultsSchema = z.object({
  retry:          retryPolicySchema.optional(),
  executorConfig: z.object({ provider: z.string().optional() }).optional(),
  secretBindings: z.record(secretBindingSchema).optional(),
  inputs:         z.record(flowInputValueSchema).optional(),
}).optional();
```

- [ ] **Add the `executorKindSchema` constant** directly above `flowDefaultsSchema`:

```ts
const executorKindSchema = z.enum(["coding-cli", "git-provider", "ticket-provider", "notification"]);
```

- [ ] **Change the `executorConfig` line** inside `flowDefaultsSchema`:

```ts
const flowDefaultsSchema = z.object({
  retry:          retryPolicySchema.optional(),
  executorConfig: z.record(executorKindSchema, z.object({ provider: z.string().optional() })).optional(),
  secretBindings: z.record(secretBindingSchema).optional(),
  inputs:         z.record(flowInputValueSchema).optional(),
}).optional();
```

---

## Task 5: Rewrite `DefaultsExecutorSection.tsx` with 4 per-kind dropdowns

**Files:**
- Modify: `packages/flow-editor/src/flow-config/DefaultsExecutorSection.tsx`

- [ ] **Replace the entire file** with the following. Each kind gets its own labelled dropdown. Selecting "— no default —" clears that kind's entry. The section collapses as a whole (not per-kind).

```tsx
import { useState } from "react";
import type { FlowDefaults, CoreExecutorKind } from "@journeyman/core";
import { PROVIDER_CATALOG } from "@journeyman/core";

const KIND_LABELS: Record<CoreExecutorKind, string> = {
  "coding-cli":      "Coding CLI",
  "git-provider":    "Git Provider",
  "ticket-provider": "Ticket Provider",
  "notification":    "Notification",
};

const EXECUTOR_KINDS: CoreExecutorKind[] = ["coding-cli", "git-provider", "ticket-provider", "notification"];

// Providers grouped by kind, excluding the "control" kind (editor-only)
const CATALOG_BY_KIND = (() => {
  const groups: Record<string, Array<{ value: string; label: string; implemented: boolean }>> = {};
  for (const p of PROVIDER_CATALOG) {
    if (!groups[p.kind]) groups[p.kind] = [];
    groups[p.kind].push({ value: p.value, label: p.label, implemented: p.implemented });
  }
  return groups;
})();

interface Props {
  defaults: FlowDefaults;
  onChange: (next: FlowDefaults) => void;
  readOnly?: boolean;
}

export function DefaultsExecutorSection({ defaults, onChange, readOnly }: Props) {
  const [open, setOpen] = useState(true);

  const setKindProvider = (kind: CoreExecutorKind, provider: string) => {
    const current = defaults.executorConfig ?? {};
    if (!provider) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [kind]: _removed, ...rest } = current;
      onChange({ ...defaults, executorConfig: Object.keys(rest).length ? rest : undefined });
    } else {
      onChange({ ...defaults, executorConfig: { ...current, [kind]: { provider } } });
    }
  };

  return (
    <div style={{ borderTop: "1px solid #2a2a3a", paddingTop: 8, marginTop: 8 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 12, padding: 0, marginBottom: 6 }}
      >
        {open ? "▾" : "▸"} Default providers
      </button>
      {open && (
        <div style={{ paddingLeft: 8 }}>
          {EXECUTOR_KINDS.map(kind => {
            const entries = CATALOG_BY_KIND[kind] ?? [];
            const selected = defaults.executorConfig?.[kind]?.provider ?? "";
            return (
              <div key={kind} className="je-props__field" style={{ marginBottom: 8 }}>
                <label>{KIND_LABELS[kind]}</label>
                <select
                  value={selected}
                  disabled={readOnly}
                  onChange={e => setKindProvider(kind, e.target.value)}
                >
                  <option value="">— no default —</option>
                  {entries.map(p => (
                    <option key={p.value} value={p.value} disabled={!p.implemented}>
                      {p.label}{!p.implemented ? " (coming soon)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
          <div className="je-props__field-help">
            Applied to phases that don't set their own provider. Each phase can override per-node.
          </div>
        </div>
      )}
    </div>
  );
}
```

---

## Task 6: Update `ExecutorBlock.tsx` inheritance chip lookup

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/ExecutorBlock.tsx`

- [ ] **Locate the `defaultProvider` line** in `packages/flow-editor/src/properties-panel/ExecutorBlock.tsx` (line 22):

```ts
  const defaultProvider = flowDefaults?.executorConfig?.provider;
```

- [ ] **Change it** to use the `kind` prop (already available) to look up the per-kind default:

```ts
  const defaultProvider = flowDefaults?.executorConfig?.[kind]?.provider;
```

That is the only change to this file. `kind` is already the first prop of `ExecutorBlockProps` and is passed in from `ConfigTab` via `definition.executor.kind`.

---

## Task 7: Typecheck all packages

- [ ] **Run typecheck from the repo root:**

```bash
npm run typecheck
```

Expected: zero errors across all packages. If TypeScript reports that `FlowDefaults.executorConfig` is now incompatible somewhere, the error message will point to the exact location — update that usage to index by kind (e.g. `executorConfig?.["coding-cli"]?.provider`) or to the new record shape.

Common places to double-check if errors appear:
- Any code that reads `defaults.executorConfig.provider` directly (old flat access pattern) — change to `defaults.executorConfig?.["<kind>"]?.provider`
- Any code that writes `executorConfig: { provider: "..." }` onto a `FlowDefaults` object — change to `executorConfig: { "<kind>": { provider: "..." } }`
