# Create-Flow Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a guided wizard (basic details → workflow config → inputs → review) that runs at flow creation and is re-openable from the editor, and remove the canvas's standalone "Flow Defaults" panel and "Inputs" drawer so config + inputs have a single home.

**Architecture:** A new `CreateFlowWizard` component lives in `packages/flow-editor/src/create-wizard/`. It is a controlled stepper over one in-memory `WorkflowGraph` draft. It reuses the existing `Defaults*Section` components (config step) and `InputsTab` (inputs step) — no new config UI. Two hosts consume it: `web/NewFlowPage` (create mode → calls `createFlow` once, then navigates to the canvas) and `flow-editor/FlowEditor` (edit mode → patches the live graph via the existing `onChange` path). All pure logic (draft model, seeding, step gating, validation warnings, finish-payload building) lives in a testable `wizard-state.ts`.

**Tech Stack:** React 18 + TypeScript, `@xyflow/react`, vitest (pure-logic tests), `lucide-react` icons. No new dependencies. No API/DB/`@journeyman/core` changes.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/flow-editor/src/create-wizard/wizard-state.ts` | **New.** Pure logic: draft model + types, `seedDefaults`, `createDraft`, `draftFromGraph`, step lists, `canAdvance`, `inputNameWarnings`, `buildCreateArgs`. No React. |
| `packages/flow-editor/src/create-wizard/wizard-state.test.ts` | **New.** vitest unit tests for `wizard-state.ts`. |
| `packages/flow-editor/src/create-wizard/steps/BasicDetailsStep.tsx` | **New.** Name / description / scope form + "Start from: Blank \| Upload JSON" (create mode only). |
| `packages/flow-editor/src/create-wizard/steps/ConfigStep.tsx` | **New.** Renders the four `Defaults*Section`s over `draft.graph.defaults`. |
| `packages/flow-editor/src/create-wizard/steps/InputsStep.tsx` | **New.** Wraps `InputsTab` + shows non-blocking name warnings. |
| `packages/flow-editor/src/create-wizard/steps/ReviewStep.tsx` | **New.** Read-only summary of meta + defaults + declared inputs. |
| `packages/flow-editor/src/create-wizard/CreateFlowWizard.tsx` | **New.** Stepper shell: overlay dialog, step nav, footer (Back / Next / Skip / Finish). |
| `packages/flow-editor/src/styles.css` | **Modify.** Add `.je-wizard*` styles. |
| `packages/flow-editor/src/index.ts` | **Modify.** Export `CreateFlowWizard` + types. |
| `packages/flow-editor/package.json` | **Modify.** Add `"test": "vitest run"` so wizard-state tests run via `npm test`. |
| `packages/flow-editor/src/topbar/Topbar.tsx` | **Modify.** Replace `onFlowConfig` + `onInputsClick` buttons/props with a single `onWorkflowSetup`. |
| `packages/flow-editor/src/FlowEditor.tsx` | **Modify.** Remove `FlowConfigPanel` aside + `flowConfigOpen` state and the `InputsTab` drawer + `inputsDrawerOpen` state; add `setupOpen` state and render `CreateFlowWizard` in edit mode. |
| `packages/flow-editor/src/flow-config/FlowConfigPanel.tsx` | **Delete.** Its only consumer (FlowEditor) is removed; the four section components it composed are kept and reused by `ConfigStep`. |
| `packages/web/src/routes/NewFlowPage.tsx` | **Modify.** Replace the single-form body with `CreateFlowWizard` in create mode. |

---

## Task 1: Wizard state — pure logic (TDD)

**Files:**
- Create: `packages/flow-editor/src/create-wizard/wizard-state.ts`
- Test: `packages/flow-editor/src/create-wizard/wizard-state.test.ts`
- Modify: `packages/flow-editor/package.json`

- [ ] **Step 1: Add a test script to flow-editor so its vitest files run via `npm test`**

In `packages/flow-editor/package.json`, change the `scripts` block from:

```json
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
```

to:

```json
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
```

- [ ] **Step 2: Write the failing test**

Create `packages/flow-editor/src/create-wizard/wizard-state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  seedDefaults,
  createDraft,
  draftFromGraph,
  stepsForMode,
  canAdvance,
  inputNameWarnings,
  buildCreateArgs,
} from "./wizard-state.ts";
import type { WorkflowGraph } from "@journeyman/core";

describe("seedDefaults", () => {
  it("seeds a coding-cli claude provider and an enabled retry policy", () => {
    const d = seedDefaults();
    expect(d.executorConfig?.["coding-cli"]?.provider).toBe("claude");
    expect(d.retry?.enabled).toBe(true);
    expect(d.retry?.maxAttempts).toBe(2);
  });
});

describe("createDraft", () => {
  it("starts from a blank graph (start + end) with seeded defaults and default meta", () => {
    const draft = createDraft();
    expect(draft.meta).toEqual({ name: "New flow", description: "", scope: "user" });
    expect(draft.graph.nodes.map(n => n.type).sort()).toEqual(["end", "trigger-manual"]);
    expect(draft.graph.defaults?.executorConfig?.["coding-cli"]?.provider).toBe("claude");
  });
});

describe("draftFromGraph", () => {
  it("deep-copies the graph so edits to the draft do not mutate the source", () => {
    const source: WorkflowGraph = {
      schemaVersion: 2,
      nodes: [{ id: "start", type: "trigger-manual" }, { id: "end", type: "end" }],
      edges: [],
      inputDefs: [{ name: "a", type: "string", required: true }],
    } as unknown as WorkflowGraph;
    const draft = draftFromGraph(source, { name: "Existing", description: "", scope: "org" });
    draft.graph.inputDefs!.push({ name: "b", type: "string" });
    expect(source.inputDefs).toHaveLength(1);
    expect(draft.meta.name).toBe("Existing");
  });
});

describe("stepsForMode", () => {
  it("includes basics first in create mode and omits it in edit mode", () => {
    expect(stepsForMode("create")).toEqual(["basics", "config", "inputs", "review"]);
    expect(stepsForMode("edit")).toEqual(["config", "inputs", "review"]);
  });
});

describe("canAdvance", () => {
  it("blocks the basics step until a non-empty name is present", () => {
    const draft = createDraft();
    draft.meta.name = "   ";
    expect(canAdvance("basics", draft)).toBe(false);
    draft.meta.name = "My flow";
    expect(canAdvance("basics", draft)).toBe(true);
  });
  it("never blocks config, inputs, or review", () => {
    const draft = createDraft();
    expect(canAdvance("config", draft)).toBe(true);
    expect(canAdvance("inputs", draft)).toBe(true);
    expect(canAdvance("review", draft)).toBe(true);
  });
});

describe("inputNameWarnings", () => {
  it("warns on empty and duplicate input names", () => {
    const graph = {
      schemaVersion: 2, nodes: [], edges: [],
      inputDefs: [
        { name: "ok", type: "string" },
        { name: "", type: "string" },
        { name: "ok", type: "string" },
      ],
    } as unknown as WorkflowGraph;
    const w = inputNameWarnings(graph);
    expect(w.some(m => m.includes("no name"))).toBe(true);
    expect(w.some(m => m.includes('Duplicate input name "ok"'))).toBe(true);
  });
  it("returns no warnings for a clean or empty input list", () => {
    expect(inputNameWarnings({ schemaVersion: 2, nodes: [], edges: [] } as unknown as WorkflowGraph)).toEqual([]);
  });
});

describe("buildCreateArgs", () => {
  it("trims the name and omits an empty description", () => {
    const draft = createDraft();
    draft.meta.name = "  Ship it  ";
    draft.meta.description = "   ";
    const args = buildCreateArgs(draft);
    expect(args.name).toBe("Ship it");
    expect(args.description).toBeUndefined();
    expect(args.scope).toBe("user");
    expect(args.definition).toBe(draft.graph);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run packages/flow-editor/src/create-wizard/wizard-state.test.ts`
Expected: FAIL — cannot resolve `./wizard-state.ts` (module does not exist yet).

- [ ] **Step 4: Write the implementation**

Create `packages/flow-editor/src/create-wizard/wizard-state.ts`:

```ts
import type {
  WorkflowGraph,
  WorkflowDefaults,
  WorkflowScope,
} from "@journeyman/core";
import { createBlankFlow } from "../state/flow-graph.ts";

export type WizardMode = "create" | "edit";
export type WizardStepId = "basics" | "config" | "inputs" | "review";

export interface WizardMeta {
  name: string;
  description: string;
  scope: WorkflowScope;
}

export interface WizardDraft {
  meta: WizardMeta;
  graph: WorkflowGraph;
}

export interface CreateFlowArgs {
  scope: WorkflowScope;
  name: string;
  description?: string;
  definition: WorkflowGraph;
}

/** Sensible defaults pre-filled on a fresh create draft, so the config step is a quick confirm. */
export function seedDefaults(): WorkflowDefaults {
  return {
    executorConfig: { "coding-cli": { provider: "claude" } },
    retry: { enabled: true, maxAttempts: 2, backoff: "exponential", backoffSeconds: 5 },
  };
}

/** A fresh create-mode draft: blank graph + seeded defaults + default meta. */
export function createDraft(): WizardDraft {
  const graph = createBlankFlow();
  return {
    meta: { name: "New flow", description: "", scope: "user" },
    graph: { ...graph, defaults: { ...seedDefaults(), ...(graph.defaults ?? {}) } },
  };
}

/** An edit-mode draft seeded from a live graph. Deep-copied so Cancel discards cleanly. */
export function draftFromGraph(graph: WorkflowGraph, meta: WizardMeta): WizardDraft {
  return { meta: { ...meta }, graph: structuredClone(graph) };
}

const CREATE_STEPS: WizardStepId[] = ["basics", "config", "inputs", "review"];
const EDIT_STEPS: WizardStepId[] = ["config", "inputs", "review"];

export function stepsForMode(mode: WizardMode): WizardStepId[] {
  return mode === "create" ? CREATE_STEPS : EDIT_STEPS;
}

/** Whether the user may advance past `step`. Only basics gates (on a non-empty name). */
export function canAdvance(step: WizardStepId, draft: WizardDraft): boolean {
  if (step === "basics") return draft.meta.name.trim().length > 0;
  return true;
}

/** Non-blocking warnings for the inputs step: empty or duplicate input names. */
export function inputNameWarnings(graph: WorkflowGraph): string[] {
  const defs = graph.inputDefs ?? [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  defs.forEach((d, i) => {
    const name = d.name.trim();
    if (!name) {
      warnings.push(`Input ${i + 1} has no name.`);
    } else if (seen.has(name)) {
      warnings.push(`Duplicate input name "${name}".`);
    } else {
      seen.add(name);
    }
  });
  return warnings;
}

/** Build the argument object for the web `createFlow` API from a finished draft. */
export function buildCreateArgs(draft: WizardDraft): CreateFlowArgs {
  return {
    scope: draft.meta.scope,
    name: draft.meta.name.trim(),
    description: draft.meta.description.trim() || undefined,
    definition: draft.graph,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/flow-editor/src/create-wizard/wizard-state.test.ts`
Expected: PASS — all tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/flow-editor/src/create-wizard/wizard-state.ts \
        packages/flow-editor/src/create-wizard/wizard-state.test.ts \
        packages/flow-editor/package.json
git commit -m "feat(flow-editor): wizard-state core logic for create-flow wizard"
```

---

## Task 2: Step components

**Files:**
- Create: `packages/flow-editor/src/create-wizard/steps/ConfigStep.tsx`
- Create: `packages/flow-editor/src/create-wizard/steps/InputsStep.tsx`
- Create: `packages/flow-editor/src/create-wizard/steps/BasicDetailsStep.tsx`
- Create: `packages/flow-editor/src/create-wizard/steps/ReviewStep.tsx`

These are presentational and reuse existing components. There is no React-component test harness in this repo (existing tests are pure-logic vitest), so these are verified by `npm run typecheck` and the preview at the end of the plan — no unit tests are added for them.

- [ ] **Step 1: Create `ConfigStep.tsx`**

```tsx
import type { WorkflowDefaults } from "@journeyman/core";
import { DefaultsExecutorSection } from "../../flow-config/DefaultsExecutorSection.tsx";
import { DefaultsModelSection } from "../../flow-config/DefaultsModelSection.tsx";
import { DefaultsSandboxSection } from "../../flow-config/DefaultsSandboxSection.tsx";
import { DefaultsRetrySection } from "../../flow-config/DefaultsRetrySection.tsx";

export interface ConfigStepProps {
  defaults: WorkflowDefaults;
  onChange: (next: WorkflowDefaults) => void;
  readOnly?: boolean;
}

export function ConfigStep({ defaults, onChange, readOnly }: ConfigStepProps): JSX.Element {
  return (
    <div className="je-wizard__config">
      <p className="je-wizard__hint">
        These values are inherited by every step. Each step can override any field later on the canvas.
      </p>
      <DefaultsExecutorSection defaults={defaults} onChange={onChange} readOnly={readOnly} />
      <DefaultsModelSection    defaults={defaults} onChange={onChange} readOnly={readOnly} />
      <DefaultsSandboxSection  defaults={defaults} onChange={onChange} readOnly={readOnly} />
      <DefaultsRetrySection    defaults={defaults} onChange={onChange} readOnly={readOnly} />
    </div>
  );
}
```

- [ ] **Step 2: Create `InputsStep.tsx`**

```tsx
import type { WorkflowGraph, WorkflowInputDef, WorkflowAttributeDef } from "@journeyman/core";
import { InputsTab } from "../../inputs-tab/InputsTab.tsx";
import { inputNameWarnings } from "../wizard-state.ts";

export interface InputsStepProps {
  graph: WorkflowGraph;
  onPatchInputs: (next: WorkflowInputDef[]) => void;
  onPatchAttributes: (next: WorkflowAttributeDef[]) => void;
}

export function InputsStep({ graph, onPatchInputs, onPatchAttributes }: InputsStepProps): JSX.Element {
  const warnings = inputNameWarnings(graph);
  return (
    <div className="je-wizard__inputs">
      <InputsTab graph={graph} onPatchInputs={onPatchInputs} onPatchAttributes={onPatchAttributes} />
      {warnings.length > 0 && (
        <ul className="je-wizard__warnings">
          {warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `BasicDetailsStep.tsx`**

This step also carries the create-mode "Start from" choice (Blank / Upload JSON), preserving the capability today's `NewFlowPage` has. When a valid JSON is uploaded, `onReplaceGraph` swaps the draft graph.

```tsx
import { useState } from "react";
import type { WorkflowGraph, WorkflowScope } from "@journeyman/core";
import type { WizardMeta } from "../wizard-state.ts";

export interface BasicDetailsStepProps {
  meta: WizardMeta;
  allowedScopes: WorkflowScope[];
  onChange: (next: WizardMeta) => void;
  /** Replace the draft graph from an uploaded definition (Blank keeps the seeded one). */
  onReplaceGraph: (graph: WorkflowGraph) => void;
}

function parseFlowJson(text: string): WorkflowGraph {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`);
  }
  if (!raw || typeof raw !== "object") throw new Error("Expected a JSON object at the root.");
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.nodes)) throw new Error("Missing or invalid 'nodes' array.");
  if (!Array.isArray(obj.edges)) throw new Error("Missing or invalid 'edges' array.");
  if (typeof obj.schemaVersion !== "string" && typeof obj.schemaVersion !== "number") {
    throw new Error("Missing 'schemaVersion'.");
  }
  return obj as unknown as WorkflowGraph;
}

const scopeLabel = (s: WorkflowScope): string =>
  s === "user" ? "Personal (only me)" : s === "org" ? "Organization" : "Global (all orgs)";

export function BasicDetailsStep({ meta, allowedScopes, onChange, onReplaceGraph }: BasicDetailsStepProps): JSX.Element {
  const [source, setSource] = useState<"blank" | "upload">("blank");
  const [uploadName, setUploadName] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFile = async (file: File): Promise<void> => {
    setUploadError(null);
    setUploadName(file.name);
    try {
      onReplaceGraph(parseFlowJson(await file.text()));
    } catch (e) {
      setUploadError((e as Error).message);
    }
  };

  return (
    <div className="je-wizard__basics">
      <label className="je-wizard__label">Name</label>
      <input
        className="je-wizard__input"
        value={meta.name}
        onChange={e => onChange({ ...meta, name: e.target.value })}
      />

      <label className="je-wizard__label">Description (optional)</label>
      <textarea
        className="je-wizard__input"
        rows={3}
        value={meta.description}
        onChange={e => onChange({ ...meta, description: e.target.value })}
      />

      <label className="je-wizard__label">Scope</label>
      <select
        className="je-wizard__input"
        value={meta.scope}
        onChange={e => onChange({ ...meta, scope: e.target.value as WorkflowScope })}
      >
        {allowedScopes.map(s => <option key={s} value={s}>{scopeLabel(s)}</option>)}
      </select>

      <label className="je-wizard__label">Start from</label>
      <div className="je-wizard__source">
        <button
          type="button"
          className={source === "blank" ? "active" : ""}
          onClick={() => setSource("blank")}
        >Blank</button>
        <button
          type="button"
          className={source === "upload" ? "active" : ""}
          onClick={() => setSource("upload")}
        >Upload JSON</button>
      </div>
      {source === "upload" && (
        <div className="je-wizard__upload">
          <label className="je-wizard__file">
            <input
              type="file"
              accept=".json,application/json"
              style={{ display: "none" }}
              onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ""; }}
            />
            Choose file…
          </label>
          {uploadName && !uploadError && <span className="je-wizard__file-name">Loaded {uploadName}</span>}
          {uploadError && <span className="je-wizard__error">{uploadError}</span>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Create `ReviewStep.tsx`**

```tsx
import type { WorkflowGraph } from "@journeyman/core";
import type { WizardMeta, WizardMode } from "../wizard-state.ts";

export interface ReviewStepProps {
  mode: WizardMode;
  meta: WizardMeta;
  graph: WorkflowGraph;
}

export function ReviewStep({ mode, meta, graph }: ReviewStepProps): JSX.Element {
  const defaults = graph.defaults ?? {};
  const inputs = graph.inputDefs ?? [];
  const codingProvider = defaults.executorConfig?.["coding-cli"]?.provider ?? "— none —";
  return (
    <div className="je-wizard__review">
      {mode === "create" && (
        <dl className="je-wizard__summary">
          <dt>Name</dt><dd>{meta.name || "—"}</dd>
          <dt>Scope</dt><dd>{meta.scope}</dd>
        </dl>
      )}
      <dl className="je-wizard__summary">
        <dt>Coding provider</dt><dd>{codingProvider}</dd>
        <dt>Default model</dt><dd>{defaults.defaultModel ?? "— system default —"}</dd>
        <dt>Retry</dt><dd>{defaults.retry?.enabled ? `${defaults.retry.maxAttempts ?? 1} attempts` : "off"}</dd>
        <dt>Inputs</dt>
        <dd>{inputs.length ? inputs.map(i => i.name).join(", ") : "none declared"}</dd>
      </dl>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors). The step files reference only existing exports (`DefaultsExecutorSection`, `DefaultsModelSection`, `DefaultsSandboxSection`, `DefaultsRetrySection`, `InputsTab`) and `wizard-state.ts` from Task 1.

- [ ] **Step 6: Commit**

```bash
git add packages/flow-editor/src/create-wizard/steps/
git commit -m "feat(flow-editor): create-flow wizard step components"
```

---

## Task 3: CreateFlowWizard shell + styles + export

**Files:**
- Create: `packages/flow-editor/src/create-wizard/CreateFlowWizard.tsx`
- Modify: `packages/flow-editor/src/styles.css`
- Modify: `packages/flow-editor/src/index.ts`

- [ ] **Step 1: Create `CreateFlowWizard.tsx`**

```tsx
import { useState } from "react";
import type {
  WorkflowGraph,
  WorkflowInputDef,
  WorkflowAttributeDef,
  WorkflowDefaults,
  WorkflowScope,
} from "@journeyman/core";
import {
  type WizardMode,
  type WizardMeta,
  type WizardDraft,
  type WizardStepId,
  type CreateFlowArgs,
  createDraft,
  draftFromGraph,
  stepsForMode,
  canAdvance,
  buildCreateArgs,
} from "./wizard-state.ts";
import { BasicDetailsStep } from "./steps/BasicDetailsStep.tsx";
import { ConfigStep } from "./steps/ConfigStep.tsx";
import { InputsStep } from "./steps/InputsStep.tsx";
import { ReviewStep } from "./steps/ReviewStep.tsx";

export interface CreateFlowWizardProps {
  mode: WizardMode;
  /** edit mode: seed from the live graph. */
  initialGraph?: WorkflowGraph;
  /** edit mode: meta to seed (only `name` is shown anywhere in edit mode). */
  initialMeta?: WizardMeta;
  /** create mode: scopes the user may choose. Defaults to ["user"]. */
  allowedScopes?: WorkflowScope[];
  readOnly?: boolean;
  busy?: boolean;
  error?: string | null;
  /** create mode finish. */
  onCreate?: (args: CreateFlowArgs) => void;
  /** edit mode finish. */
  onSave?: (graph: WorkflowGraph) => void;
  onCancel: () => void;
}

const STEP_TITLES: Record<WizardStepId, string> = {
  basics: "Basic details",
  config: "Workflow config",
  inputs: "Inputs",
  review: "Review",
};

export function CreateFlowWizard(props: CreateFlowWizardProps): JSX.Element {
  const { mode, readOnly, busy } = props;
  const allowedScopes = props.allowedScopes ?? ["user"];

  const [draft, setDraft] = useState<WizardDraft>(() =>
    mode === "edit" && props.initialGraph
      ? draftFromGraph(props.initialGraph, props.initialMeta ?? { name: "", description: "", scope: "user" })
      : createDraft(),
  );

  const steps = stepsForMode(mode);
  const [stepIdx, setStepIdx] = useState(0);
  const step = steps[stepIdx];
  const isLast = stepIdx === steps.length - 1;

  const setMeta = (meta: WizardMeta): void => setDraft(d => ({ ...d, meta }));
  const setDefaults = (defaults: WorkflowDefaults): void =>
    setDraft(d => ({ ...d, graph: { ...d.graph, defaults: Object.keys(defaults).length ? defaults : undefined } }));
  const setInputs = (inputDefs: WorkflowInputDef[]): void =>
    setDraft(d => ({ ...d, graph: { ...d.graph, inputDefs } }));
  const setAttributes = (attributeDefs: WorkflowAttributeDef[]): void =>
    setDraft(d => ({ ...d, graph: { ...d.graph, attributeDefs } }));
  const replaceGraph = (graph: WorkflowGraph): void => setDraft(d => ({ ...d, graph }));

  const finish = (): void => {
    if (mode === "create") props.onCreate?.(buildCreateArgs(draft));
    else props.onSave?.(draft.graph);
  };

  // "Skip to canvas" is allowed in create mode whenever the name gate is satisfied.
  const canSkip = mode === "create" && !readOnly && canAdvance("basics", draft);
  const canNext = canAdvance(step, draft);

  return (
    <div className="je-wizard__overlay" role="dialog" aria-modal="true" onClick={props.onCancel}>
      <div className="je-wizard" onClick={e => e.stopPropagation()}>
        <header className="je-wizard__header">
          <ol className="je-wizard__steps">
            {steps.map((s, i) => (
              <li key={s} className={i === stepIdx ? "active" : i < stepIdx ? "done" : ""}>
                {STEP_TITLES[s]}
              </li>
            ))}
          </ol>
          <button type="button" className="je-wizard__close" aria-label="Close" onClick={props.onCancel}>×</button>
        </header>

        <div className="je-wizard__body">
          {step === "basics" && (
            <BasicDetailsStep
              meta={draft.meta}
              allowedScopes={allowedScopes}
              onChange={setMeta}
              onReplaceGraph={replaceGraph}
            />
          )}
          {step === "config" && (
            <ConfigStep defaults={draft.graph.defaults ?? {}} onChange={setDefaults} readOnly={readOnly} />
          )}
          {step === "inputs" && (
            <InputsStep graph={draft.graph} onPatchInputs={setInputs} onPatchAttributes={setAttributes} />
          )}
          {step === "review" && <ReviewStep mode={mode} meta={draft.meta} graph={draft.graph} />}
        </div>

        {props.error && <div className="je-wizard__error">{props.error}</div>}

        <footer className="je-wizard__footer">
          <button type="button" onClick={props.onCancel} disabled={busy}>Cancel</button>
          <div className="je-wizard__footer-spacer" />
          {canSkip && !isLast && (
            <button type="button" onClick={finish} disabled={busy}>Skip to canvas</button>
          )}
          {stepIdx > 0 && (
            <button type="button" onClick={() => setStepIdx(i => i - 1)} disabled={busy}>Back</button>
          )}
          {!isLast ? (
            <button type="button" className="primary" onClick={() => setStepIdx(i => i + 1)} disabled={busy || !canNext}>
              Next
            </button>
          ) : (
            <button type="button" className="primary" onClick={finish} disabled={busy || readOnly}>
              {busy ? "Saving…" : mode === "create" ? "Create" : "Save"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add wizard styles to `styles.css`**

Append to `packages/flow-editor/src/styles.css`:

```css
/* ===== Create-flow wizard ===== */
.je-wizard__overlay {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(0, 0, 0, 0.55);
  display: flex; align-items: center; justify-content: center;
}
.je-wizard {
  width: min(640px, 92vw); max-height: 88vh;
  display: flex; flex-direction: column;
  background: #15151f; border: 1px solid #2a2a3a; border-radius: 8px;
  color: #eee; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}
.je-wizard__header { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid #2a2a3a; }
.je-wizard__steps { display: flex; gap: 16px; list-style: none; margin: 0; padding: 0; flex: 1; font-size: 12px; }
.je-wizard__steps li { color: #777; }
.je-wizard__steps li.active { color: #fff; font-weight: 600; }
.je-wizard__steps li.done { color: #00b894; }
.je-wizard__close { background: none; border: none; color: #888; font-size: 18px; cursor: pointer; }
.je-wizard__body { padding: 16px; overflow-y: auto; }
.je-wizard__footer { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-top: 1px solid #2a2a3a; }
.je-wizard__footer-spacer { flex: 1; }
.je-wizard__footer button { background: #1f1f2c; border: 1px solid #2a2a3a; color: #ddd; padding: 7px 14px; border-radius: 5px; font-size: 12px; cursor: pointer; }
.je-wizard__footer button:disabled { opacity: 0.5; cursor: not-allowed; }
.je-wizard__footer button.primary { background: #00b894; border-color: #00b894; color: #fff; font-weight: 600; }
.je-wizard__label { display: block; color: #aaa; font-size: 11px; text-transform: uppercase; margin: 12px 0 4px; }
.je-wizard__input { width: 100%; background: #1f1f2c; border: 1px solid #2a2a3a; color: #fff; border-radius: 4px; padding: 8px 10px; font-size: 13px; font-family: inherit; box-sizing: border-box; }
.je-wizard__source { display: flex; gap: 8px; }
.je-wizard__source button { background: #1a1a24; border: 1px solid #2a2a3a; color: #aaa; border-radius: 5px; padding: 7px 14px; font-size: 12px; cursor: pointer; }
.je-wizard__source button.active { background: #2a2a3e; border-color: #4a4a5e; color: #fff; }
.je-wizard__upload { margin-top: 10px; display: flex; align-items: center; gap: 10px; }
.je-wizard__file { background: #1f1f2c; border: 1px solid #2a2a3a; color: #ddd; border-radius: 4px; padding: 8px 10px; font-size: 12px; cursor: pointer; }
.je-wizard__file-name { font-size: 11px; color: #bbb; }
.je-wizard__hint { font-size: 11px; color: #888; margin: 0 0 12px; }
.je-wizard__warnings { margin: 10px 0 0; padding-left: 18px; color: #fdcb6e; font-size: 12px; }
.je-wizard__error { color: #ff7675; font-size: 12px; padding: 0 16px 8px; }
.je-wizard__summary { display: grid; grid-template-columns: 140px 1fr; gap: 6px 12px; font-size: 13px; margin: 0 0 12px; }
.je-wizard__summary dt { color: #888; }
.je-wizard__summary dd { margin: 0; color: #eee; }
```

- [ ] **Step 3: Export from `index.ts`**

In `packages/flow-editor/src/index.ts`, add after the `createBlankFlow` export line (line 3):

```ts
export { CreateFlowWizard } from "./create-wizard/CreateFlowWizard.tsx";
export type { CreateFlowWizardProps } from "./create-wizard/CreateFlowWizard.tsx";
export { buildCreateArgs, createDraft } from "./create-wizard/wizard-state.ts";
export type { CreateFlowArgs, WizardMeta } from "./create-wizard/wizard-state.ts";
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/flow-editor/src/create-wizard/CreateFlowWizard.tsx \
        packages/flow-editor/src/styles.css \
        packages/flow-editor/src/index.ts
git commit -m "feat(flow-editor): CreateFlowWizard stepper shell + styles + exports"
```

---

## Task 4: Wire create mode into NewFlowPage

**Files:**
- Modify: `packages/web/src/routes/NewFlowPage.tsx`

- [ ] **Step 1: Replace the page body with the wizard**

Replace the entire contents of `packages/web/src/routes/NewFlowPage.tsx` with:

```tsx
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CreateFlowWizard, type CreateFlowArgs } from "@journeyman/flow-editor";
import { createFlow } from "../api/flows.ts";
import { useAuth } from "../AuthContext.tsx";

export function NewFlowPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { role, isPlatformAdmin } = useAuth();

  const allowedScopes: ("user" | "org" | "global")[] = [
    "user",
    ...(role === "admin" || isPlatformAdmin ? (["org"] as const) : []),
    ...(isPlatformAdmin ? (["global"] as const) : []),
  ];

  const m = useMutation({
    mutationFn: (args: CreateFlowArgs) => createFlow(args),
    onSuccess: ({ workflow }, args) => {
      qc.invalidateQueries({ queryKey: ["flows"] });
      qc.setQueryData(["flow-graph", workflow.id], args.definition);
      navigate(`/workflows/${workflow.id}/edit`);
    },
  });

  return (
    <CreateFlowWizard
      mode="create"
      allowedScopes={allowedScopes}
      busy={m.isPending}
      error={m.isError ? (m.error as Error).message : null}
      onCreate={(args) => m.mutate(args)}
      onCancel={() => navigate("/workflows")}
    />
  );
}
```

> Note: `createFlow`'s `args` type (`{ scope; orgId?; name; description?; definition }`) is structurally compatible with `CreateFlowArgs` (no `orgId` is sent, matching today's behavior). The route target `/workflows` matches the existing flows-list route used elsewhere; if the project's list route differs, use that path.

- [ ] **Step 2: Build the web bundle to verify it compiles**

Run: `npm run build:web`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/routes/NewFlowPage.tsx
git commit -m "feat(web): use CreateFlowWizard on the new-flow page"
```

---

## Task 5: Wire edit mode + remove the old canvas entry points

**Files:**
- Modify: `packages/flow-editor/src/topbar/Topbar.tsx`
- Modify: `packages/flow-editor/src/FlowEditor.tsx`
- Delete: `packages/flow-editor/src/flow-config/FlowConfigPanel.tsx`

- [ ] **Step 1: Replace the two Topbar buttons with one "Workflow setup" button**

In `packages/flow-editor/src/topbar/Topbar.tsx`:

(a) Remove `FormInput` from the `lucide-react` import (it was only used by the Inputs button). The import block becomes:

```tsx
import {
  Check,
  Copy,
  Download,
  FileCode2,
  Loader2,
  Play,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  X,
} from "lucide-react";
```

(b) In `TopbarProps`, replace these two props:

```tsx
  onFlowConfig?: () => void;
  /** Open the workflow input schema drawer. */
  onInputsClick?: () => void;
```

with:

```tsx
  /** Open the workflow-setup wizard (workflow config + inputs). */
  onWorkflowSetup?: () => void;
```

(c) In the JSX, replace the two `IconButton`s (the `p.onInputsClick` block and the `p.onFlowConfig` block) with a single button:

```tsx
        {p.onWorkflowSetup && (
          <IconButton
            className="je-icon-btn--workflow-setup"
            label="Workflow setup"
            hint="Edit workflow config (provider, model, sandbox, retry) and inputs"
            icon={<SlidersHorizontal size={16} aria-hidden="true" focusable="false" />}
            onClick={p.onWorkflowSetup}
          />
        )}
```

- [ ] **Step 2: Update FlowEditor — imports, state, handlers, render**

In `packages/flow-editor/src/FlowEditor.tsx`:

(a) Replace the `FlowConfigPanel` import (line 8) with the wizard import:

```tsx
import { CreateFlowWizard } from "./create-wizard/CreateFlowWizard.tsx";
```

(b) Replace the two state lines (128–129):

```tsx
  const [flowConfigOpen, setFlowConfigOpen] = useState(false);
  const [inputsDrawerOpen, setInputsDrawerOpen] = useState(false);
```

with:

```tsx
  const [setupOpen, setSetupOpen] = useState(false);
```

(c) In `focusNode` (lines 135–139), remove the `setFlowConfigOpen(false);` line so it becomes:

```tsx
  const focusNode = useCallback((id: string): void => {
    s.setSelectedNodeId(id);
    setFocusRequest(prev => ({ nodeId: id, tick: (prev?.tick ?? 0) + 1 }));
  }, [s]);
```

(d) In the `Topbar` props (lines 189–190), replace:

```tsx
          onFlowConfig={() => setFlowConfigOpen(o => !o)}
          onInputsClick={() => setInputsDrawerOpen(true)}
```

with:

```tsx
          onWorkflowSetup={() => setSetupOpen(true)}
```

(e) In the body IIFE, change `rightPanelOpen` and `closeRightPanel` (lines 212–220) to drop `flowConfigOpen`:

```tsx
          const rightPanelOpen = !!s.selectedEdge || !!s.selectedNode;
          const gridCols = rightPanelOpen
            ? `${paletteWidth}px 6px 1fr 6px ${propsWidth}px`
            : `${paletteWidth}px 6px 1fr`;
          const closeRightPanel = (): void => {
            s.setSelectedNodeId(null);
            s.setSelectedEdgeId(null);
          };
```

(f) In `Canvas`'s `onSelect`/`onEdgeSelect` (lines 228–229), remove the `setFlowConfigOpen(false)` calls:

```tsx
                onSelect={nodeId => { s.setSelectedNodeId(nodeId); }}
                onEdgeSelect={edgeId => { s.setSelectedEdgeId(edgeId); }}
```

(g) Replace the right-panel branch that rendered `FlowConfigPanel` (lines 238–262) so the panel is only the edge inspector or properties panel:

```tsx
                  {s.selectedEdge ? (
                    <EdgeInspector
                      flow={heal.healed}
                      edge={s.selectedEdge}
                      onChange={s.updateEdge}
                      onClose={closeRightPanel}
                    />
                  ) : (
                    <PropertiesPanel
                      flow={heal.healed}
                      node={s.selectedNode}
                      mcpCatalog={props.mcpCatalog ?? []}
                      orgId={props.orgId}
                      onChange={onUpdateNode}
                      onClose={closeRightPanel}
                      readOnly={effectiveReadOnly}
                    />
                  )}
```

(h) Delete the entire inputs-drawer block (lines 268–303 — the `{inputsDrawerOpen && (...)}` JSX).

(i) Add the wizard render. Place it next to the other modals (e.g. just before the `{publishOpen && ...}` block):

```tsx
        {setupOpen && (
          <CreateFlowWizard
            mode="edit"
            initialGraph={heal.healed}
            initialMeta={{ name: props.flowName, description: "", scope: "user" }}
            readOnly={effectiveReadOnly}
            onSave={(graph) => { props.onChange(graph); setSetupOpen(false); }}
            onCancel={() => setSetupOpen(false)}
          />
        )}
```

- [ ] **Step 3: Delete the now-unused FlowConfigPanel**

```bash
git rm packages/flow-editor/src/flow-config/FlowConfigPanel.tsx
```

> The four `Defaults*Section` components in `packages/flow-editor/src/flow-config/` are **kept** — `ConfigStep` (Task 2) imports them directly.

- [ ] **Step 4: Confirm no other references to the removed symbols remain**

Run:
```bash
rg -n 'FlowConfigPanel|onFlowConfig|onInputsClick|flowConfigOpen|inputsDrawerOpen' packages/flow-editor/src packages/web/src
```
Expected: no matches (empty output). If anything appears, remove that reference.

- [ ] **Step 5: Typecheck + boundaries**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run check:boundaries`
Expected: PASS (web→flow-editor is an allowed dependency; no new cross-imports introduced).

- [ ] **Step 6: Commit**

```bash
git add packages/flow-editor/src/topbar/Topbar.tsx packages/flow-editor/src/FlowEditor.tsx
git commit -m "feat(flow-editor): re-openable workflow-setup wizard; remove standalone config panel + inputs drawer"
```

---

## Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the wizard-state test suite**

Run: `npx vitest run packages/flow-editor/src/create-wizard/wizard-state.test.ts`
Expected: PASS (all Task 1 tests green).

- [ ] **Step 2: Run the full project check**

Run: `npm run check`
Expected: typecheck + import-boundary check both PASS.

- [ ] **Step 3: Build the web app**

Run: `npm run build:web`
Expected: build succeeds.

- [ ] **Step 4: Manual smoke test (preview)**

Start the web dev server and verify:
1. **Create:** "New flow" opens the wizard. Step 1 requires a name; "Next" advances through Workflow config (provider pre-filled to Claude, retry enabled) and Inputs; "Review" shows the summary; "Create" lands on the canvas with the chosen defaults/inputs applied. "Skip to canvas" creates immediately once a name is set.
2. **Edit:** On the canvas, the topbar shows a single "Workflow setup" button (no separate "Flow Config" / "Inputs" buttons). Opening it shows Config → Inputs → Review (no Basics step); "Save" applies changes to the live graph; "Cancel" discards with no change. Nodes/edges are untouched after a round-trip.

- [ ] **Step 5: Commit (if the smoke test required any fixes)**

```bash
git add -A
git commit -m "fix(flow-editor): wizard smoke-test adjustments"
```

---

## Self-Review Notes

- **Spec coverage:** basic-details/config/inputs/review steps (Task 2–3); reuse of `FlowConfigPanel` sections + `InputsTab` (Task 2); create-then-canvas flow (Task 4); re-openable edit mode (Task 5); removal of both standalone entry points + `FlowConfigPanel` deletion (Task 5); seeded defaults, skip-to-canvas, light validation, deep-copy isolation (Task 1 + 3); upload-JSON edge case preserved (Task 2 BasicDetailsStep). No API/DB/core changes (spec non-goal) — confirmed, none introduced.
- **Type consistency:** `CreateFlowArgs`, `WizardMeta`, `WizardDraft`, `WizardStepId`, `WizardMode` defined in Task 1 and used unchanged in Tasks 2–5. `buildCreateArgs`/`createDraft`/`draftFromGraph`/`stepsForMode`/`canAdvance`/`inputNameWarnings`/`seedDefaults` names match across tasks. Section component names (`DefaultsExecutorSection`, `DefaultsModelSection`, `DefaultsSandboxSection`, `DefaultsRetrySection`) verified against the current `flow-config/` directory.
- **Compute target → sandbox:** the rename already landed on this branch; the plan uses `DefaultsSandboxSection`. The wizard never references the underlying field name directly, so it is insulated from any follow-on rename.
