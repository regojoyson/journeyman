# Workflow-Level Config Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `FlowGraph.defaults` block that provides workflow-level fallbacks for `retry`, `executorConfig`, `secretBindings`, and `inputs`; phase nodes inherit via field-level merge and can override or suppress per field; the editor surfaces a per-field `FROM FLOW` / `OVERRIDE` chip on every affected tab; a topbar "Flow Config" button opens a panel to edit the defaults.

**Architecture:** Core types grow a `FlowDefaults` interface and `FlowGraph.defaults` field; the orchestrator's conductor-converter applies defaults just before emitting each phase task via a new `applyFlowDefaults` utility; the editor gains an `InheritanceChip` + `useFieldInheritance` hook wired into the Retry, Config, Required Secrets, and Required Bindings tabs; a new `FlowConfigPanel` (opened from the topbar) owns editing `flow.defaults`.

**Tech Stack:** TypeScript, React, Zod, `@journeyman/core`, `packages/orchestrator`, `packages/flow-editor`, `packages/api-server`

**Constraints:** No unit tests. No commits. Run `npm run typecheck` at the end.

---

## File Map

| Action | Path | Purpose |
|---|---|---|
| Modify | `packages/core/src/types/flow.types.ts` | Add `FlowInputValue.suppress`, `FlowDefaults`, extend `FlowGraph` and `FlowNode` |
| Modify | `packages/core/src/types/pipeline.types.ts` | Add `inputSources` field to `StepRecord` |
| Create | `packages/orchestrator/src/flow-json/apply-flow-defaults.ts` | Pure merge utility |
| Modify | `packages/orchestrator/src/flow-json/conductor-converter.ts` | Call `applyFlowDefaults` in `emitPhase`; inject `_flowDefaultSources` |
| Modify | `packages/orchestrator/src/workers/worker-harness.ts` | Extract `_flowDefaultSources` → `StepRecord.inputSources` |
| Modify | `packages/api-server/src/schemas/update-flow.ts` | Add `flowDefaultsSchema`; add `.nullable()` to four node fields |
| Create | `packages/flow-editor/src/properties-panel/InheritanceChip.tsx` | Small chip: FROM FLOW / OVERRIDE / SUPPRESSED |
| Create | `packages/flow-editor/src/hooks/use-field-inheritance.ts` | Hook returning `FieldState` per value pair |
| Modify | `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx` | Pass `flow.defaults` to each tab |
| Modify | `packages/flow-editor/src/properties-panel/RetryTab.tsx` | Per-field chips on every retry field |
| Modify | `packages/flow-editor/src/properties-panel/ExecutorBlock.tsx` | Chip on provider select |
| Modify | `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx` | Per-slot chip on each binding row |
| Modify | `packages/flow-editor/src/properties-panel/ConfigTab.tsx` | Per-key chip on Required bindings rows |
| Create | `packages/flow-editor/src/flow-config/FlowConfigPanel.tsx` | Panel shell |
| Create | `packages/flow-editor/src/flow-config/DefaultsRetrySection.tsx` | Edit `defaults.retry` |
| Create | `packages/flow-editor/src/flow-config/DefaultsExecutorSection.tsx` | Edit `defaults.executorConfig` |
| Create | `packages/flow-editor/src/flow-config/DefaultsSecretsSection.tsx` | Edit `defaults.secretBindings` |
| Create | `packages/flow-editor/src/flow-config/DefaultsInputsSection.tsx` | Edit `defaults.inputs` |
| Modify | `packages/flow-editor/src/topbar/Topbar.tsx` | Add "Flow Config" icon button; add `onFlowConfig` prop |
| Modify | `packages/flow-editor/src/FlowEditor.tsx` | Wire `FlowConfigPanel` open/close + `onChange` |

---

## Task 1 — Core types

**Files:**
- Modify: `packages/core/src/types/flow.types.ts`

- [ ] **Step 1: Extend `FlowInputValue` with the suppress kind**

  In `flow.types.ts`, find the current `FlowInputValue` type (line 26) and replace it:

  ```ts
  export type FlowInputValue =
    | { kind: "literal"; value: unknown }
    | { kind: "ref"; ref: string }
    | { kind: "suppress" };
  ```

- [ ] **Step 2: Add the `FlowDefaults` interface after `FlowRetryPolicy`**

  After the `FlowRetryPolicy` interface (around line 143), add:

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

- [ ] **Step 3: Add `defaults?` to `FlowGraph`**

  In the `FlowGraph` interface (line 79), add the field after `maxCycleVisits`:

  ```ts
  export interface FlowGraph {
    schemaVersion: FlowSchemaVersion;
    nodes: FlowNode[];
    edges: FlowEdge[];
    maxCycleVisits?: number;
    defaults?: FlowDefaults;
  }
  ```

- [ ] **Step 4: Add `| null` to the four `FlowNode` fields that support suppress-sentinel**

  In the `FlowNode` interface (line 37), update these four lines:

  ```ts
  inputs?: Record<string, FlowInputValue> | null;
  executorConfig?: { provider?: string } | null;
  retry?: RetryPolicy | null;
  secretBindings?: Record<string, SecretBinding> | null;
  ```

  (The `| null` lets a node explicitly suppress a workflow default for that field.)

---

## Task 2 — Schema validation

**Files:**
- Modify: `packages/api-server/src/schemas/update-flow.ts`

- [ ] **Step 1: Add the `suppress` kind to `flowInputValueSchema`**

  Replace the existing `flowInputValueSchema` (line 5):

  ```ts
  const flowInputValueSchema = z.union([
    z.object({ kind: z.literal("literal"), value: z.unknown() }),
    z.object({ kind: z.literal("ref"), ref: z.string() }),
    z.object({ kind: z.literal("suppress") }),
  ]);
  ```

- [ ] **Step 2: Add the `secretBindingSchema` local constant** (needed by `flowDefaultsSchema`)

  After `retryPolicySchema`, add:

  ```ts
  const secretBindingSchema = z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("auto") }),
    z.object({
      mode: z.literal("pinned"),
      scope: z.enum(["user", "org", "global"]),
      name: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    }),
  ]);
  ```

- [ ] **Step 3: Add `flowDefaultsSchema`**

  After `secretBindingSchema`, add:

  ```ts
  const flowDefaultsSchema = z.object({
    retry:          retryPolicySchema.optional(),
    executorConfig: z.object({ provider: z.string().optional() }).optional(),
    secretBindings: z.record(secretBindingSchema).optional(),
    inputs:         z.record(flowInputValueSchema).optional(),
  }).optional();
  ```

- [ ] **Step 4: Update `flowNodeSchema` — add `.nullable()` to four fields and replace inline `secretBindingSchema`**

  Replace the `flowNodeSchema` definition:

  ```ts
  const flowNodeSchema = z.object({
    id: z.string(),
    type: z.string(),
    displayName: z.string().optional(),
    phaseType: z.string().optional(),
    config: z.record(z.unknown()).optional(),
    inputs: z.record(flowInputValueSchema).nullable().optional(),
    executorConfig: z.object({ provider: z.string().optional() }).passthrough().nullable().optional(),
    secretBindings: z.record(secretBindingSchema).nullable().optional(),
    position: z.object({ x: z.number(), y: z.number() }).optional(),
    outcome: z.string().optional(),
    retry: retryPolicySchema.nullable().optional(),
  }).passthrough();
  ```

- [ ] **Step 5: Add `defaults` to `flowGraphSchema`**

  Replace the `flowGraphSchema` definition:

  ```ts
  export const flowGraphSchema = z.object({
    schemaVersion: z.literal(1),
    nodes: z.array(flowNodeSchema),
    edges: z.array(flowEdgeSchema),
    maxCycleVisits: z.number().int().nonnegative().optional(),
    defaults: flowDefaultsSchema,
  }).passthrough();
  ```

---

## Task 3 — `applyFlowDefaults` utility

**Files:**
- Create: `packages/orchestrator/src/flow-json/apply-flow-defaults.ts`

- [ ] **Step 1: Create the file with the merge utility**

  ```ts
  import type { FlowNode, FlowDefaults, RetryPolicy, SecretBinding, FlowInputValue } from "@journeyman/core";

  export type FieldSources = Record<string, "node" | "flow-default">;

  /**
   * Merge workflow-level defaults into a single phase node.
   * Returns the resolved node and a sources map for traceability.
   * Only called for `phase` nodes — start/end/gateway nodes are unaffected.
   */
  export function applyFlowDefaults(
    node: FlowNode,
    defaults: FlowDefaults | undefined,
  ): { resolved: FlowNode; sources: FieldSources } {
    if (!defaults) return { resolved: node, sources: {} };

    const sources: FieldSources = {};

    const retry          = mergeRetry(node.retry, defaults.retry, sources);
    const executorConfig = mergeExecutorConfig(node.executorConfig, defaults.executorConfig, sources);
    const secretBindings = mergeMap(node.secretBindings, defaults.secretBindings, "secretBindings", sources);
    const inputs         = mergeInputs(node.inputs, defaults.inputs, sources);

    return {
      resolved: { ...node, retry, executorConfig, secretBindings, inputs },
      sources,
    };
  }

  function mergeRetry(
    node: RetryPolicy | null | undefined,
    def: RetryPolicy | undefined,
    sources: FieldSources,
  ): RetryPolicy | undefined {
    if (node === null) return undefined;
    if (!def) return node ?? undefined;
    if (!node) {
      sources["retry"] = "flow-default";
      return def;
    }
    sources["retry"] = "node";
    return { ...def, ...node };
  }

  function mergeExecutorConfig(
    node: { provider?: string } | null | undefined,
    def: { provider?: string } | undefined,
    sources: FieldSources,
  ): { provider?: string } | undefined {
    if (node === null) return undefined;
    if (!def) return node ?? undefined;
    if (!node) {
      sources["executorConfig"] = "flow-default";
      return def;
    }
    sources["executorConfig"] = "node";
    return { ...def, ...node };
  }

  function mergeMap<V>(
    node: Record<string, V> | null | undefined,
    def: Record<string, V> | undefined,
    key: string,
    sources: FieldSources,
  ): Record<string, V> | undefined {
    if (node === null) return undefined;
    if (!def) return node ?? undefined;
    if (!node) {
      sources[key] = "flow-default";
      return def;
    }
    sources[key] = "node";
    return { ...def, ...node };
  }

  function mergeInputs(
    node: Record<string, FlowInputValue> | null | undefined,
    def: Record<string, FlowInputValue> | undefined,
    sources: FieldSources,
  ): Record<string, FlowInputValue> | undefined {
    if (node === null) return undefined;
    if (!def) return node ?? undefined;
    const merged: Record<string, FlowInputValue> = { ...def, ...(node ?? {}) };
    for (const [k, v] of Object.entries(merged)) {
      if (v.kind === "suppress") {
        delete merged[k];
      } else {
        sources[`inputs.${k}`] = node && k in node ? "node" : "flow-default";
      }
    }
    return merged;
  }
  ```

---

## Task 4 — Integrate in `conductor-converter.ts`

**Files:**
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts`

- [ ] **Step 1: Import `applyFlowDefaults`**

  At the top of the file, alongside existing imports, add:

  ```ts
  import { applyFlowDefaults } from "./apply-flow-defaults.ts";
  ```

- [ ] **Step 2: Apply defaults at the start of `emitPhase`**

  In the `emitPhase` method (line 165), replace:

  ```ts
  emitPhase(node: FlowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    if (!node.phaseType) throw new FlowValidationError(`Phase node '${node.id}' missing phaseType`);
    const r = node.retry ?? {};
  ```

  with:

  ```ts
  emitPhase(node: FlowNode): { tasks: ConductorTaskDef[]; nextNodeId: string | null } {
    if (!node.phaseType) throw new FlowValidationError(`Phase node '${node.id}' missing phaseType`);
    const { resolved: resolvedNode, sources: defaultSources } = applyFlowDefaults(node, this.graph.defaults);
    const r = resolvedNode.retry ?? {};
  ```

  Then replace every subsequent reference to `node.` in `emitPhase` with `resolvedNode.`:

  ```ts
  const enabled = r.enabled === true;

  const task: SimpleTask = {
    type: "SIMPLE",
    name: resolvedNode.phaseType,
    taskReferenceName: resolvedNode.id,
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
    retryCount: enabled ? (r.maxAttempts ?? 3) : 0,
    retryLogic: enabled ? mapBackoff(r.backoff ?? "exponential") : "FIXED",
    retryDelaySeconds: enabled ? (r.backoffSeconds ?? 5) : 0,
    backoffScaleFactor: enabled ? (r.backoffMultiplier ?? 2) : 1,
    timeoutSeconds: r.timeoutSeconds ?? 600,
    responseTimeoutSeconds: r.timeoutSeconds ?? 600,
  };
  return { tasks: [task], nextNodeId: this.successor(resolvedNode.id) };
  ```

  Note: `this.graph.defaults` — `graph` is the `FlowGraph` held by the converter. Verify the field name by checking the constructor; if it's stored under a different name (e.g., `this.flow`), use that.

---

## Task 5 — Run traceability: `StepRecord.inputSources` + worker harness

**Files:**
- Modify: `packages/core/src/types/pipeline.types.ts`
- Modify: `packages/orchestrator/src/workers/worker-harness.ts`

- [ ] **Step 1: Add `inputSources` to `StepRecord`**

  In `packages/core/src/types/pipeline.types.ts`, extend `StepRecord`:

  ```ts
  export type StepRecord = {
    id: string;
    phase: string;
    attempt: number;
    status: "pending" | "running" | "ok" | "blocked" | "failed" | "cancelled";
    startedAt?: string;
    endedAt?: string;
    durationMs?: number;
    input?: unknown;
    output?: unknown;
    error?: { message: string; code?: string; stack?: string };
    blockedReason?: string;
    waitFor?: "ticket-comment" | "pr-comment" | "manual";
    /** Per-field source: "node" = explicit on the phase node; "flow-default" = inherited from FlowGraph.defaults. */
    inputSources?: Record<string, "node" | "flow-default">;
  };
  ```

- [ ] **Step 2: Extract `_flowDefaultSources` in `worker-harness.ts`**

  In `worker-harness.ts`, find where `StepRecord` entries are created (look for `status: "running"` or `status: "ok"` assignments). Wherever `input` is set from `task.inputData`, also extract `inputSources`:

  ```ts
  const rawInput = task.inputData ?? {};
  const inputSources = (rawInput as { _flowDefaultSources?: Record<string, "node" | "flow-default"> })._flowDefaultSources;
  // Strip the internal key before passing to the phase handler
  const phaseInput: Record<string, unknown> = { ...rawInput };
  delete (phaseInput as Record<string, unknown>)["_flowDefaultSources"];
  ```

  Then when constructing the StepRecord (or updating it), include `inputSources`:

  ```ts
  inputSources,
  ```

  Use `phaseInput` instead of `rawInput` when passing data to the phase handler so `_flowDefaultSources` is not visible to phase code.

---

## Task 6 — `InheritanceChip` component

**Files:**
- Create: `packages/flow-editor/src/properties-panel/InheritanceChip.tsx`

- [ ] **Step 1: Create the chip component**

  ```tsx
  export type ChipKind = "inherited" | "override" | "suppressed";

  interface InheritanceChipProps {
    kind: ChipKind;
    onReset?: () => void;   // shown only on "override" chip
  }

  const CHIP_STYLES: Record<ChipKind, React.CSSProperties> = {
    inherited:  { background: "#1a2a1a", border: "1px solid #2e4a2e", color: "#7fc480" },
    override:   { background: "#2a2010", border: "1px solid #4a3a10", color: "#fdcb6e" },
    suppressed: { background: "#2a1a1a", border: "1px solid #4a2020", color: "#e17055" },
  };

  const CHIP_LABELS: Record<ChipKind, string> = {
    inherited:  "FROM FLOW",
    override:   "OVERRIDE",
    suppressed: "SUPPRESSED",
  };

  export function InheritanceChip({ kind, onReset }: InheritanceChipProps) {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontSize: 9, fontWeight: 600, letterSpacing: "0.04em",
        padding: "1px 5px", borderRadius: 3,
        ...CHIP_STYLES[kind],
      }}>
        {CHIP_LABELS[kind]}
        {kind === "override" && onReset && (
          <button
            type="button"
            onClick={onReset}
            title="Reset to flow default"
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "inherit", padding: 0, fontSize: 10, lineHeight: 1,
            }}
          >↺</button>
        )}
      </span>
    );
  }
  ```

---

## Task 7 — `useFieldInheritance` hook

**Files:**
- Create: `packages/flow-editor/src/hooks/use-field-inheritance.ts`

- [ ] **Step 1: Create the hook**

  ```ts
  export type FieldState = "inherited" | "override" | "local" | "unset";

  export interface FieldInheritance {
    state: FieldState;
    /** The effective value — node value if set, default value if inherited, undefined if unset. */
    resolvedValue: unknown;
  }

  /**
   * Compute the inheritance state for a single config field.
   *
   * @param nodeValue   - The raw value on the node (undefined = not set on node).
   * @param defaultValue - The raw value from flow.defaults (undefined = no default).
   */
  export function useFieldInheritance(
    nodeValue: unknown,
    defaultValue: unknown,
  ): FieldInheritance {
    const hasNode    = nodeValue !== undefined && nodeValue !== null;
    const hasDefault = defaultValue !== undefined;

    if (nodeValue === null) {
      return { state: "inherited", resolvedValue: undefined }; // suppressed sentinel — shown as suppressed sub-state
    }
    if (!hasNode && !hasDefault) {
      return { state: "unset", resolvedValue: undefined };
    }
    if (!hasNode && hasDefault) {
      return { state: "inherited", resolvedValue: defaultValue };
    }
    if (hasNode && !hasDefault) {
      return { state: "local", resolvedValue: nodeValue };
    }
    // Both set — node overrides default
    return { state: "override", resolvedValue: nodeValue };
  }
  ```

  Note: `null` nodeValue means the user explicitly suppressed the workflow default. We return `state: "inherited"` with `resolvedValue: undefined` — the caller checks `nodeValue === null` separately to show the "SUPPRESSED" chip variant.

---

## Task 8 — Update `PropertiesPanel` to pass `flowDefaults` to tabs

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/PropertiesPanel.tsx`

- [ ] **Step 1: Import `FlowDefaults`**

  Add `FlowDefaults` to the import from `@journeyman/core`:

  ```ts
  import type { FlowGraph, FlowNode, FlowDefaults } from "@journeyman/core";
  ```

- [ ] **Step 2: Thread `flowDefaults` into each tab**

  Pass `flowDefaults={flow.defaults}` to `ConfigTab`, `RetryTab`, `RequiredSecretsTab`. `McpToolsTab` and `IoTab` do not need it.

  In the tab render block:

  ```tsx
  {effectiveActive === "config"          && <ConfigTab          flow={flow} node={node} onChange={onChange} readOnly={readOnly} mcpCatalog={mcpCatalog} flowDefaults={flow.defaults} />}
  {effectiveActive === "retry"           && <RetryTab           node={node} onChange={onChange} readOnly={readOnly} flowDefaults={flow.defaults} />}
  {effectiveActive === "requiredSecrets" && <RequiredSecretsTab flow={flow} node={node} orgId={orgId} onChange={onChange} readOnly={readOnly} flowDefaults={flow.defaults} />}
  ```

---

## Task 9 — Update `RetryTab` with per-field inheritance chips

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/RetryTab.tsx`

- [ ] **Step 1: Add imports**

  ```ts
  import type { FlowDefaults } from "@journeyman/core";
  import { useFieldInheritance } from "../hooks/use-field-inheritance.ts";
  import { InheritanceChip } from "./InheritanceChip.tsx";
  ```

- [ ] **Step 2: Add `flowDefaults` to `RetryTabProps`**

  ```ts
  export interface RetryTabProps {
    node: FlowNode;
    onChange: (next: FlowNode) => void;
    readOnly?: boolean;
    flowDefaults?: FlowDefaults;
  }
  ```

- [ ] **Step 3: Compute per-field inheritance state in the component body**

  In `RetryTab`, after `const r = node.retry ?? {};`, add:

  ```ts
  const def = flowDefaults?.retry;
  const enabledState    = useFieldInheritance(node.retry?.enabled,           def?.enabled);
  const maxState        = useFieldInheritance(node.retry?.maxAttempts,        def?.maxAttempts);
  const backoffState    = useFieldInheritance(node.retry?.backoff,            def?.backoff);
  const backoffSecState = useFieldInheritance(node.retry?.backoffSeconds,     def?.backoffSeconds);
  const multiplierState = useFieldInheritance(node.retry?.backoffMultiplier,  def?.backoffMultiplier);
  const timeoutState    = useFieldInheritance(node.retry?.timeoutSeconds,     def?.timeoutSeconds);
  const onFailState     = useFieldInheritance(node.retry?.onFailure,          def?.onFailure);

  function chipFor(state: import("../hooks/use-field-inheritance.ts").FieldState, onReset: () => void) {
    if (state === "inherited") return <InheritanceChip kind="inherited" />;
    if (state === "override")  return <InheritanceChip kind="override" onReset={onReset} />;
    return null;
  }
  ```

- [ ] **Step 4: Add chip to each field's `FieldLabel`**

  For each field that has a corresponding state, add the chip inline after the label row. Example for "Retry enabled":

  ```tsx
  <div className="je-props__field">
    <div className="je-props__field-label-row">
      <label className="je-switch" style={{ margin: 0 }}>
        <input
          type="checkbox"
          checked={!!(enabledState.resolvedValue ?? r.enabled)}
          disabled={readOnly}
          onChange={e => set({ ...r, enabled: e.target.checked })}
        />
        <span className="je-switch__track" aria-hidden="true">
          <span className="je-switch__thumb" />
        </span>
        <span className="je-switch__label">Retry enabled</span>
      </label>
      {chipFor(enabledState.state, () => set({ ...r, enabled: undefined }))}
      <FieldInfo text="When enabled, the phase re-runs automatically on failure before the flow gives up." />
    </div>
  </div>
  ```

  Apply the same pattern (chip after the `FieldLabel` or label row, `resolvedValue` used as fallback display value) to: Max attempts, Backoff strategy, Backoff base, Backoff multiplier, Per-attempt timeout, On permanent failure.

  For the "reset" callback on each OVERRIDE chip, set the corresponding field to `undefined` on the retry object:
  - Max attempts reset: `() => set({ ...r, maxAttempts: undefined })`
  - Backoff reset: `() => set({ ...r, backoff: undefined })`
  - etc.

---

## Task 10 — Update `ExecutorBlock` with inheritance chip

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/ExecutorBlock.tsx`

- [ ] **Step 1: Add imports and prop**

  ```ts
  import type { FlowDefaults } from "@journeyman/core";
  import { useFieldInheritance } from "../hooks/use-field-inheritance.ts";
  import { InheritanceChip } from "./InheritanceChip.tsx";

  export interface ExecutorBlockProps {
    kind: ExecutorKind;
    value: { provider?: string } | undefined;
    onChange: (next: { provider?: string }) => void;
    readOnly?: boolean;
    flowDefaults?: FlowDefaults;
  }
  ```

- [ ] **Step 2: Compute state and render chip**

  ```tsx
  export function ExecutorBlock({ kind, value, onChange, readOnly, flowDefaults }: ExecutorBlockProps) {
    const cfg = executorCommonConfig[kind];
    if (!cfg.provider || cfg.provider.length === 0) return null;
    const options = visibleProvidersFor(kind);
    if (options.length === 0) return null;

    const defaultProvider = flowDefaults?.executorConfig?.provider;
    const { state } = useFieldInheritance(value?.provider, defaultProvider);
    const effectiveProvider = value?.provider ?? defaultProvider ?? "";

    return (
      <div className="je-props__field">
        <div className="je-props__field-label-row">
          <label>Provider</label>
          {state === "inherited" && <InheritanceChip kind="inherited" />}
          {state === "override"  && (
            <InheritanceChip
              kind="override"
              onReset={() => onChange({ ...(value ?? {}), provider: undefined })}
            />
          )}
        </div>
        <select
          value={effectiveProvider}
          disabled={readOnly}
          onChange={e => onChange({ ...(value ?? {}), provider: e.target.value })}
        >
          {options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    );
  }
  ```

- [ ] **Step 3: Pass `flowDefaults` from `ConfigTab` to `ExecutorBlock`**

  In `ConfigTab.tsx`, add `flowDefaults?: FlowDefaults` to `ConfigTabProps` and thread it through:

  ```tsx
  <ExecutorBlock
    kind={definition.executor.kind}
    value={executorConfig}
    onChange={next => onChange({ ...node, executorConfig: next })}
    readOnly={readOnly}
    flowDefaults={flowDefaults}
  />
  ```

---

## Task 11 — Update `RequiredSecretsTab` with per-slot chips

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx`

- [ ] **Step 1: Add imports and prop**

  ```ts
  import type { FlowDefaults } from "@journeyman/core";
  import { useFieldInheritance } from "../hooks/use-field-inheritance.ts";
  import { InheritanceChip } from "./InheritanceChip.tsx";
  ```

  Add `flowDefaults?: FlowDefaults` to `RequiredSecretsTabProps`.

- [ ] **Step 2: Thread `flowDefaults` into `SlotRow`**

  Add `defaultBinding?: SecretBinding` to `SlotRowProps`. In the map over `slots`, pass:

  ```tsx
  <SlotRow
    key={slot.name}
    slot={slot}
    binding={binding}
    defaultBinding={flowDefaults?.secretBindings?.[slot.name]}
    ...
  />
  ```

- [ ] **Step 3: Show chip in `SlotRow`**

  In `SlotRow`, add `defaultBinding?: SecretBinding` to props. Compute state:

  ```ts
  const { state } = useFieldInheritance(
    node.secretBindings?.[slot.name],   // raw node value (undefined if not explicitly set)
    defaultBinding,
  );
  ```

  Wait — `SlotRow` doesn't have access to `node`. Instead, pass the raw node binding (before the `getBinding` fallback):

  In the parent `RequiredSecretsTab`, change how you pass `binding` to `SlotRow`:

  ```tsx
  const rawBinding = node.secretBindings?.[slot.name];  // undefined if not set on node
  const effectiveBinding = rawBinding ?? flowDefaults?.secretBindings?.[slot.name] ?? { mode: "auto" };
  ```

  Pass both:
  ```tsx
  <SlotRow
    ...
    binding={effectiveBinding}
    rawNodeBinding={rawBinding}
    defaultBinding={flowDefaults?.secretBindings?.[slot.name]}
    ...
  />
  ```

  In `SlotRow`, compute and render chip below the select:

  ```tsx
  const { state } = useFieldInheritance(rawNodeBinding, defaultBinding);
  // ...
  <div style={{ marginTop: 4 }}>
    {state === "inherited" && <InheritanceChip kind="inherited" />}
    {state === "override"  && (
      <InheritanceChip kind="override" onReset={() => onChange(defaultBinding ?? { mode: "auto" })} />
    )}
  </div>
  ```

---

## Task 12 — Update `ConfigTab` Required bindings with per-key chips

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/ConfigTab.tsx`

- [ ] **Step 1: Add imports**

  ```ts
  import type { FlowDefaults } from "@journeyman/core";
  import { useFieldInheritance } from "../hooks/use-field-inheritance.ts";
  import { InheritanceChip } from "./InheritanceChip.tsx";
  ```

- [ ] **Step 2: Add `flowDefaults` to `ConfigTabProps`**

  ```ts
  export interface ConfigTabProps {
    flow: FlowGraph;
    node: FlowNode;
    onChange: (next: FlowNode) => void;
    readOnly?: boolean;
    mcpCatalog?: McpCatalog;
    flowDefaults?: FlowDefaults;
  }
  ```

- [ ] **Step 3: Add chip to each Required bindings row**

  In the `bindOnlyFields.map` block, for each `key`, compute the state and render a chip after the `isBound ? renderBoundPill : empty` block:

  ```tsx
  {bindOnlyFields.map(([key, meta]) => {
    const isBound = boundKeys.has(key);
    const isRequired = !!meta.required;
    const defaultInput = flowDefaults?.inputs?.[key];
    const nodeInput = inputsMap[key];
    // useFieldInheritance needs to be called at the top level of a component,
    // so extract this into a small inner component or compute outside JSX.
    // Pattern: compute inline using the pure function directly (no hook rules issue
    // since this is deterministic and the array is stable).
    const hasDefault = defaultInput !== undefined && defaultInput.kind !== "suppress";
    const inheritState = nodeInput
      ? (hasDefault ? "override" : "local")
      : (hasDefault ? "inherited" : "unset");

    return (
      <div key={key} className="je-props__field">
        <div className="je-props__field-label-row">
          <label>
            {meta.label ?? key}
            {isRequired && <span className="je-props__required-mark">*</span>}
          </label>
          {inheritState === "inherited" && <InheritanceChip kind="inherited" />}
          {inheritState === "override"  && (
            <InheritanceChip kind="override" onReset={() => handleUnbind(key)} />
          )}
          {renderFieldBindControl(key)}
        </div>
        {isBound ? renderBoundPill(key) : (
          inheritState === "inherited" && defaultInput ? (
            <div className="je-props__bound-pill" style={{ opacity: 0.6 }}>
              <span className="je-props__bound-pill-icon" aria-hidden>↳</span>
              <code className="je-props__bound-pill-ref">
                {defaultInput.kind === "ref" ? defaultInput.ref : String(defaultInput)}
              </code>
            </div>
          ) : (
            <div className="je-props__bind-only-empty">
              {isRequired ? "Required — bind from upstream" : "Optional — not bound"}
            </div>
          )
        )}
      </div>
    );
  })}
  ```

  Note: `inheritState` is computed inline (not via the hook) to avoid calling hooks inside a `.map()`. The logic is equivalent to `useFieldInheritance` but inlined.

---

## Task 13 — `FlowConfigPanel` and section components

**Files:**
- Create: `packages/flow-editor/src/flow-config/FlowConfigPanel.tsx`
- Create: `packages/flow-editor/src/flow-config/DefaultsRetrySection.tsx`
- Create: `packages/flow-editor/src/flow-config/DefaultsExecutorSection.tsx`
- Create: `packages/flow-editor/src/flow-config/DefaultsSecretsSection.tsx`
- Create: `packages/flow-editor/src/flow-config/DefaultsInputsSection.tsx`

- [ ] **Step 1: Create `DefaultsRetrySection.tsx`**

  ```tsx
  import { useState } from "react";
  import type { FlowDefaults, RetryPolicy, BackoffStrategy } from "@journeyman/core";

  interface Props {
    defaults: FlowDefaults;
    onChange: (next: FlowDefaults) => void;
    readOnly?: boolean;
  }

  export function DefaultsRetrySection({ defaults, onChange, readOnly }: Props) {
    const [open, setOpen] = useState(true);
    const r = defaults.retry ?? {};
    const set = (next: RetryPolicy) => onChange({ ...defaults, retry: next });

    return (
      <div style={{ borderTop: "1px solid #2a2a3a", paddingTop: 8, marginTop: 8 }}>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 12, padding: 0, marginBottom: 6 }}
        >
          {open ? "▾" : "▸"} Default retry policy
        </button>
        {open && (
          <div style={{ paddingLeft: 8 }}>
            <div className="je-props__field">
              <label className="je-switch" style={{ margin: 0 }}>
                <input type="checkbox" checked={!!r.enabled} disabled={readOnly}
                  onChange={e => set({ ...r, enabled: e.target.checked })} />
                <span className="je-switch__track" aria-hidden><span className="je-switch__thumb" /></span>
                <span className="je-switch__label">Enabled</span>
              </label>
            </div>
            <div className="je-props__field">
              <label>Max attempts</label>
              <input type="number" min={1} max={10} value={r.maxAttempts ?? 3} disabled={readOnly}
                onChange={e => set({ ...r, maxAttempts: Number(e.target.value) || 1 })} />
            </div>
            <div className="je-props__field">
              <label>Backoff strategy</label>
              <select value={r.backoff ?? "exponential"} disabled={readOnly}
                onChange={e => set({ ...r, backoff: e.target.value as BackoffStrategy })}>
                <option value="fixed">fixed</option>
                <option value="linear">linear</option>
                <option value="exponential">exponential</option>
              </select>
            </div>
            <div className="je-props__field">
              <label>Backoff base (seconds)</label>
              <input type="number" min={0} value={r.backoffSeconds ?? 5} disabled={readOnly}
                onChange={e => set({ ...r, backoffSeconds: Number(e.target.value) || 0 })} />
            </div>
            <div className="je-props__field">
              <label>Backoff multiplier</label>
              <input type="number" min={1} step={0.1} value={r.backoffMultiplier ?? 2} disabled={readOnly}
                onChange={e => set({ ...r, backoffMultiplier: Number(e.target.value) || 1 })} />
            </div>
            <div className="je-props__field">
              <label>Per-attempt timeout (s)</label>
              <input type="number" min={0} value={r.timeoutSeconds ?? 600} disabled={readOnly}
                onChange={e => set({ ...r, timeoutSeconds: Number(e.target.value) || 0 })} />
            </div>
            <div className="je-props__field">
              <label>On permanent failure</label>
              <select value={r.onFailure ?? "error-edge"} disabled={readOnly}
                onChange={e => set({ ...r, onFailure: e.target.value as RetryPolicy["onFailure"] })}>
                <option value="error-edge">Route via error edge</option>
                <option value="fail-flow">Fail the whole flow</option>
              </select>
            </div>
            <button
              type="button"
              disabled={readOnly}
              onClick={() => onChange({ ...defaults, retry: undefined })}
              style={{ fontSize: 11, color: "#e17055", background: "none", border: "1px solid #4a2020", borderRadius: 3, padding: "2px 8px", cursor: "pointer", marginTop: 4 }}
            >
              Clear retry default
            </button>
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 2: Create `DefaultsExecutorSection.tsx`**

  ```tsx
  import { useState } from "react";
  import type { FlowDefaults } from "@journeyman/core";

  interface Props {
    defaults: FlowDefaults;
    onChange: (next: FlowDefaults) => void;
    readOnly?: boolean;
  }

  export function DefaultsExecutorSection({ defaults, onChange, readOnly }: Props) {
    const [open, setOpen] = useState(true);
    const provider = defaults.executorConfig?.provider ?? "";

    return (
      <div style={{ borderTop: "1px solid #2a2a3a", paddingTop: 8, marginTop: 8 }}>
        <button type="button" onClick={() => setOpen(o => !o)}
          style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 12, padding: 0, marginBottom: 6 }}>
          {open ? "▾" : "▸"} Default provider
        </button>
        {open && (
          <div style={{ paddingLeft: 8 }}>
            <div className="je-props__field">
              <label>Provider</label>
              <input
                type="text"
                value={provider}
                disabled={readOnly}
                placeholder="e.g. claude, github"
                onChange={e => onChange({ ...defaults, executorConfig: { provider: e.target.value || undefined } })}
              />
              <div className="je-props__field-help">
                Applied to all phases. Each phase can override. Common values: <code>claude</code>, <code>gemini</code>, <code>github</code>.
              </div>
            </div>
            <button type="button" disabled={readOnly}
              onClick={() => onChange({ ...defaults, executorConfig: undefined })}
              style={{ fontSize: 11, color: "#e17055", background: "none", border: "1px solid #4a2020", borderRadius: 3, padding: "2px 8px", cursor: "pointer", marginTop: 4 }}>
              Clear provider default
            </button>
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 3: Create `DefaultsSecretsSection.tsx`**

  ```tsx
  import { useState } from "react";
  import type { FlowDefaults, SecretBinding } from "@journeyman/core";

  interface Props {
    defaults: FlowDefaults;
    onChange: (next: FlowDefaults) => void;
    readOnly?: boolean;
  }

  export function DefaultsSecretsSection({ defaults, onChange, readOnly }: Props) {
    const [open, setOpen] = useState(true);
    const bindings = defaults.secretBindings ?? {};

    const setBinding = (slot: string, mode: "auto" | "remove") => {
      const next = { ...bindings };
      if (mode === "remove") delete next[slot];
      else next[slot] = { mode: "auto" };
      onChange({ ...defaults, secretBindings: Object.keys(next).length ? next : undefined });
    };

    const addSlot = (name: string) => {
      if (!name) return;
      onChange({ ...defaults, secretBindings: { ...bindings, [name]: { mode: "auto" } } });
    };

    return (
      <div style={{ borderTop: "1px solid #2a2a3a", paddingTop: 8, marginTop: 8 }}>
        <button type="button" onClick={() => setOpen(o => !o)}
          style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 12, padding: 0, marginBottom: 6 }}>
          {open ? "▾" : "▸"} Default secret bindings
        </button>
        {open && (
          <div style={{ paddingLeft: 8 }}>
            {Object.entries(bindings).map(([slot]) => (
              <div key={slot} className="je-props__field" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <code style={{ flex: 1, fontSize: 11 }}>{slot}</code>
                <span style={{ fontSize: 11, color: "#888" }}>auto</span>
                <button type="button" disabled={readOnly} onClick={() => setBinding(slot, "remove")}
                  style={{ background: "none", border: "1px solid #444", color: "#888", padding: "0 6px", borderRadius: 3, cursor: "pointer" }}>×</button>
              </div>
            ))}
            {!readOnly && (
              <SlotAdder onAdd={addSlot} />
            )}
          </div>
        )}
      </div>
    );
  }

  function SlotAdder({ onAdd }: { onAdd: (name: string) => void }) {
    const [draft, setDraft] = useState("");
    return (
      <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
        <input
          type="text"
          value={draft}
          placeholder="SLOT_NAME"
          onChange={e => setDraft(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
          style={{ flex: 1, fontFamily: "ui-monospace, monospace", fontSize: 11, background: "#1f1f2c", border: "1px solid #444", color: "#ddd", padding: "3px 6px", borderRadius: 4 }}
        />
        <button type="button"
          onClick={() => { onAdd(draft); setDraft(""); }}
          disabled={!draft}
          style={{ background: "#2a2a3e", border: "1px solid #444", color: "#ddd", padding: "3px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>
          + Add
        </button>
      </div>
    );
  }
  ```

- [ ] **Step 4: Create `DefaultsInputsSection.tsx`**

  ```tsx
  import { useState } from "react";
  import type { FlowDefaults, FlowInputValue } from "@journeyman/core";

  interface Props {
    defaults: FlowDefaults;
    onChange: (next: FlowDefaults) => void;
    readOnly?: boolean;
  }

  export function DefaultsInputsSection({ defaults, onChange, readOnly }: Props) {
    const [open, setOpen] = useState(true);
    const inputs = defaults.inputs ?? {};

    const setRef = (key: string, ref: string) => {
      onChange({ ...defaults, inputs: { ...inputs, [key]: { kind: "ref", ref } } });
    };
    const removeKey = (key: string) => {
      const next = { ...inputs };
      delete next[key];
      onChange({ ...defaults, inputs: Object.keys(next).length ? next : undefined });
    };
    const renameKey = (oldKey: string, newKey: string) => {
      if (oldKey === newKey) return;
      const next: Record<string, FlowInputValue> = {};
      for (const [k, v] of Object.entries(inputs)) next[k === oldKey ? newKey : k] = v;
      onChange({ ...defaults, inputs: next });
    };
    const addRow = () => onChange({ ...defaults, inputs: { ...inputs, "": { kind: "ref", ref: "" } } });

    return (
      <div style={{ borderTop: "1px solid #2a2a3a", paddingTop: 8, marginTop: 8 }}>
        <button type="button" onClick={() => setOpen(o => !o)}
          style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 12, padding: 0, marginBottom: 6 }}>
          {open ? "▾" : "▸"} Default input wiring
        </button>
        {open && (
          <div style={{ paddingLeft: 8 }}>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 8 }}>
              Common inputs (e.g. <code>dirPath</code>, <code>targetDir</code>) wired here apply to all phases
              that don't set them explicitly.
            </div>
            {Object.entries(inputs).map(([k, v]) => (
              <div key={k} style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 4 }}>
                <input
                  type="text" value={k} disabled={readOnly}
                  placeholder="inputName"
                  style={{ flex: 1, fontFamily: "ui-monospace, monospace", fontSize: 11, background: "#1f1f2c", border: "1px solid #444", color: "#ddd", padding: "3px 6px", borderRadius: 4 }}
                  onChange={e => renameKey(k, e.target.value)}
                />
                <input
                  type="text"
                  value={v.kind === "ref" ? v.ref : ""}
                  disabled={readOnly}
                  placeholder="node-id.output.field"
                  style={{ flex: 2, fontFamily: "ui-monospace, monospace", fontSize: 11, background: "#1f1f2c", border: "1px solid #444", color: "#ddd", padding: "3px 6px", borderRadius: 4 }}
                  onChange={e => setRef(k, e.target.value)}
                />
                <button type="button" disabled={readOnly} onClick={() => removeKey(k)}
                  style={{ background: "none", border: "1px solid #444", color: "#888", padding: "0 6px", borderRadius: 3, cursor: "pointer" }}>×</button>
              </div>
            ))}
            {!readOnly && (
              <button type="button" onClick={addRow}
                style={{ marginTop: 4, background: "#2a2a3e", border: "1px solid #444", color: "#ddd", padding: "3px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer" }}>
                + Add input default
              </button>
            )}
          </div>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 5: Create `FlowConfigPanel.tsx`**

  ```tsx
  import type { FlowGraph, FlowDefaults } from "@journeyman/core";
  import { X } from "lucide-react";
  import { DefaultsRetrySection } from "./DefaultsRetrySection.tsx";
  import { DefaultsExecutorSection } from "./DefaultsExecutorSection.tsx";
  import { DefaultsSecretsSection } from "./DefaultsSecretsSection.tsx";
  import { DefaultsInputsSection } from "./DefaultsInputsSection.tsx";

  export interface FlowConfigPanelProps {
    flow: FlowGraph;
    onChange: (next: FlowGraph) => void;
    onClose: () => void;
    readOnly?: boolean;
  }

  export function FlowConfigPanel({ flow, onChange, onClose, readOnly }: FlowConfigPanelProps) {
    const defaults = flow.defaults ?? {};
    const updateDefaults = (next: FlowDefaults) =>
      onChange({ ...flow, defaults: Object.keys(next).length ? next : undefined });

    return (
      <aside className="je-editor__props" style={{ borderLeft: "1px solid #2a2a3a" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div className="je-props__title" style={{ margin: 0 }}>Flow Defaults</div>
          <button type="button" onClick={onClose}
            style={{ background: "none", border: "none", color: "#888", cursor: "pointer", padding: 4 }}>
            <X size={14} aria-hidden />
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#888", marginBottom: 12 }}>
          Values set here are inherited by all phase nodes. Each node can override individual fields.
        </div>

        <DefaultsExecutorSection defaults={defaults} onChange={updateDefaults} readOnly={readOnly} />
        <DefaultsRetrySection    defaults={defaults} onChange={updateDefaults} readOnly={readOnly} />
        <DefaultsSecretsSection  defaults={defaults} onChange={updateDefaults} readOnly={readOnly} />
        <DefaultsInputsSection   defaults={defaults} onChange={updateDefaults} readOnly={readOnly} />
      </aside>
    );
  }
  ```

---

## Task 14 — Add Flow Config button to `Topbar`

**Files:**
- Modify: `packages/flow-editor/src/topbar/Topbar.tsx`

- [ ] **Step 1: Add `onFlowConfig` prop and the button**

  Add `SlidersHorizontal` to the lucide imports:

  ```ts
  import {
    Check, Copy, Download, FileCode2, Loader2, Play,
    Save, ShieldCheck, SlidersHorizontal, X,
  } from "lucide-react";
  ```

  Add `onFlowConfig?: () => void` to `TopbarProps`.

  In the JSX, add the button between the "View JSON" button and the "Validate" button:

  ```tsx
  {p.onFlowConfig && (
    <IconButton
      label="Flow Config"
      hint="Edit workflow-level defaults (provider, retry, secrets, inputs)"
      icon={<SlidersHorizontal size={16} aria-hidden="true" focusable="false" />}
      onClick={p.onFlowConfig}
    />
  )}
  ```

---

## Task 15 — Wire `FlowConfigPanel` into `FlowEditor`

**Files:**
- Modify: `packages/flow-editor/src/FlowEditor.tsx`

- [ ] **Step 1: Add import**

  ```ts
  import { FlowConfigPanel } from "./flow-config/FlowConfigPanel.tsx";
  ```

- [ ] **Step 2: Add `flowConfigOpen` state and handlers**

  ```ts
  const [flowConfigOpen, setFlowConfigOpen] = useState(false);
  ```

- [ ] **Step 3: Pass `onFlowConfig` to `Topbar`**

  ```tsx
  <Topbar
    ...
    onFlowConfig={() => setFlowConfigOpen(o => !o)}
  />
  ```

- [ ] **Step 4: Render `FlowConfigPanel` in place of `PropertiesPanel` when open**

  Wrap the right panel area:

  ```tsx
  {flowConfigOpen ? (
    <FlowConfigPanel
      flow={heal.healed}
      onChange={props.onChange}
      onClose={() => setFlowConfigOpen(false)}
      readOnly={props.readOnly}
    />
  ) : (
    <PropertiesPanel
      flow={heal.healed}
      node={s.selectedNode}
      mcpCatalog={props.mcpCatalog ?? []}
      orgId={props.orgId}
      onChange={onUpdateNode}
      readOnly={props.readOnly}
    />
  )}
  ```

---

## Task 16 — Typecheck all packages

- [ ] **Step 1: Run typecheck**

  ```bash
  npm run typecheck
  ```

  Expected: zero type errors. If errors appear, fix them before considering the plan complete. Common issues to watch for:
  - `FlowNode.retry`, `FlowNode.inputs`, `FlowNode.executorConfig`, `FlowNode.secretBindings` changed to `| null` — any code that passed these fields as non-nullable (e.g., `node.retry ?? {}`) needs to handle `null` explicitly
  - `FlowInputValue` now has a third union member `{ kind: "suppress" }` — any exhaustive switch/if on `kind` needs a `suppress` branch or a default case
  - `FlowGraph.defaults` is new optional field — no breakage expected since it's additive
  - `StepRecord.inputSources` is new optional field — no breakage expected
  - `applyFlowDefaults` returns `{ resolved, sources }` — ensure `conductor-converter.ts` destructures it correctly
  - Check that `this.graph` (or whatever field holds `FlowGraph` in the converter) is typed as `FlowGraph` (not a narrower type) so `.defaults` is accessible

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by task |
|---|---|
| `FlowInputValue.suppress` kind | Task 1 |
| `FlowDefaults` interface | Task 1 |
| `FlowGraph.defaults` field | Task 1 |
| `FlowNode` fields `\| null` | Task 1 |
| Schema validation — `flowDefaultsSchema` | Task 2 |
| Schema — node fields `.nullable()` | Task 2 |
| `applyFlowDefaults` utility | Task 3 |
| Orchestrator integration point | Task 4 |
| `StepRecord.inputSources` | Task 5 |
| Worker harness traceability | Task 5 |
| `InheritanceChip` component | Task 6 |
| `useFieldInheritance` hook | Task 7 |
| `PropertiesPanel` threads `flowDefaults` | Task 8 |
| RetryTab per-field chips | Task 9 |
| ExecutorBlock chip | Task 10 |
| RequiredSecretsTab per-slot chips | Task 11 |
| ConfigTab Required bindings chips | Task 12 |
| `FlowConfigPanel` + 4 section components | Task 13 |
| Topbar Flow Config button | Task 14 |
| FlowEditor wiring | Task 15 |
| Typecheck | Task 16 |

**Type consistency check:**
- `FlowDefaults` defined in Task 1, imported in Tasks 3, 4, 6–15 ✓
- `applyFlowDefaults` returns `{ resolved: FlowNode; sources: FieldSources }` in Task 3; destructured as `{ resolved: resolvedNode, sources: defaultSources }` in Task 4 ✓
- `FieldState` type exported from `use-field-inheritance.ts` (Task 7), used in Task 9 ✓
- `ChipKind` exported from `InheritanceChip.tsx` (Task 6), used in Tasks 9–12 ✓
- `FlowConfigPanel` props (`flow`, `onChange`, `onClose`, `readOnly`) defined in Task 13 Step 5, used in Task 15 ✓
- All section components accept `{ defaults: FlowDefaults; onChange: (next: FlowDefaults) => void; readOnly?: boolean }` ✓

**Placeholder check:** No TBDs, TODOs, or "similar to above" references. All code blocks are complete. ✓
