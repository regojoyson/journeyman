# Journeyman Builder — Phase 2a: The Assembler — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic **assembler** — a pure function that turns a high-level `AssemblerIntent` (what the LLM will produce) into a real `WorkflowGraph` plus `StepBinding[]` and `Gap[]`, doing all the mechanical wiring (node ids, positions, edges, reference strings, trigger config, pause nodes) the LLM must never hand-write.

**Architecture:** A pure module in `@journeyman/builder` (`src/assembler/`). Input: an `AssemblerIntent` + the injected step catalog + the core availability registry. Output: `{ workflow, stepBindings, gaps }`. No DB, no LLM, no HTTP — fully unit-testable. Reference strings follow the engine's editor-form grammar (`<nodeId>.output.<field>`, `workflow.input.<name>`, `workflow.attribute.<name>`, and `{{ ref }}` inside templates).

**Tech Stack:** TypeScript (ESM, explicit `.ts` extensions), Vitest. Pure functions only.

**Constraints (from the user):** **No `git commit` steps.** **Final step is `npm run check`.** Each task ends by running its tests.

**Scope (Phase 2a):** triggers (manual / webhook / form), a step chain (provider + custom-AI + `human-task` + `webhook-wait` nodes), full input wiring (literal / workflow-input / workflow-attribute / step-output / template), webhook `inputsMapping` + `inputDefs`, and the gap/binding pass (deny-list, unimplemented providers, capability). **Out of scope here (→ Phase 2b):** conditional branching (gateway + conditional edges) and the apply executor. Read-tools/serializers are Phase 3.

**Reference:** Spec `docs/superpowers/specs/2026-06-13-journeyman-builder-design.md`. Builds on Phase 1 (`BuildPlan`/`StepBinding`/`Gap`/`ProposedCustomStep` in core; `builder-availability` registry).

**Reference grammar (load-bearing — verified against `resolve-inputs.ts`):**
- prior step output: `"<nodeId>.output.<field>"` (node id has no dots)
- workflow input: `"workflow.input.<name>"`; workflow attribute: `"workflow.attribute.<name>"`
- a node's `inputs[slot]` is a `WorkflowInputValue`: `{kind:"literal",value}` | `{kind:"ref",ref}` | `{kind:"template",template}`; template tokens are `{{ <ref> }}`.
- a `trigger-webhook` node needs `config.webhookId` + `config.inputsMapping`; `trigger-human` needs `config.fieldOverrides`.
- every node carries a `position {x,y}`; `custom-ai` step nodes carry `config.customStepId`.

---

## File Structure (Phase 2a)

**Create:**
- `packages/builder/src/assembler/intent.ts` — `AssemblerIntent` and sub-types (the LLM's output contract)
- `packages/builder/src/assembler/refs.ts` — pure helpers that build ref strings + `WorkflowInputValue`s
- `packages/builder/src/assembler/refs.test.ts`
- `packages/builder/src/assembler/assemble.ts` — `assemble(intent, deps)` → `{ workflow, stepBindings, gaps }`
- `packages/builder/src/assembler/assemble.test.ts`
- `packages/builder/src/assembler/gaps.ts` — availability/gap detection (deny-list, unimplemented provider, capability)
- `packages/builder/src/assembler/gaps.test.ts`

**Modify:**
- `packages/builder/package.json` — add `@journeyman/steps` dependency (for the catalog type) if not already resolvable
- `packages/builder/src/index.ts` — export the assembler entrypoint

---

## Task 1: Intent contract + ref helpers

**Files:**
- Create: `packages/builder/src/assembler/intent.ts`
- Create: `packages/builder/src/assembler/refs.ts`
- Test: `packages/builder/src/assembler/refs.test.ts`

- [ ] **Step 1: Create `packages/builder/src/assembler/intent.ts`**

```ts
import type { CanonicalTool } from "@journeyman/core";
import type { WorkflowInputDef } from "@journeyman/core";

/** A value bound to a step input slot, expressed at intent level. */
export type InputIntent =
  | { from: "literal"; value: unknown }
  | { from: "workflow-input"; name: string }
  | { from: "workflow-attribute"; name: string }
  | { from: "step-output"; stepRef: string; field: string } // stepRef = a StepIntent.ref
  | { from: "template"; template: string };                  // raw text with {{ refs }} (intent refs)

export interface InputBindingIntent {
  slot: string;
  value: InputIntent;
}

/** One mapping from the webhook payload into a workflow input. */
export interface WebhookInputIntent {
  name: string;
  type: WorkflowInputDef["type"];
  fromPath: string; // JSONPath into the payload, e.g. "$.pull_request.number"
}

export type TriggerIntent =
  | { kind: "manual" }
  | {
      kind: "webhook";
      /** existing webhook record id, or null if it's a gap to resolve. */
      webhookId: string | null;
      listensFor?: string[];
      inputs?: WebhookInputIntent[];
    }
  | { kind: "form"; inputs?: WebhookInputIntent[] };

export type StepKindIntent = "provider" | "ai" | "human-task" | "webhook-wait";

export interface StepIntent {
  /** intent-local handle the LLM uses to wire other steps to this one's output. */
  ref: string;
  kind: StepKindIntent;
  label: string;
  /** built-in/provider/custom-ai step type (e.g. "get-issue", "custom-ai"); omitted for waits. */
  stepType?: string;
  /** for custom-ai: existing id OR a ProposedCustomStep placeholder id. */
  customStepId?: string;
  /** for provider steps: chosen provider value (e.g. "github", "jira"). */
  provider?: string;
  /** AI bindings. */
  model?: string;
  tools?: CanonicalTool[];
  mcpIds?: string[];
  skillIds?: string[];
  sandboxId?: string;
  /** provider connection/credential name (a secret). */
  connection?: string;
  /** secret slots tagged by name (convention) — values never carried. */
  secrets?: { slot: string; secretName: string | null }[];
  /** input wiring. */
  inputs?: InputBindingIntent[];
  /** webhook-wait config: which webhook it waits on (id or null=gap). */
  waitWebhookId?: string | null;
  /** human-task config. */
  assignee?: string;
  taskPrompt?: string;
}

export interface AssemblerIntent {
  summary: string;
  triggers: TriggerIntent[];
  /** ordered main chain; index order defines default edges and node layout. */
  steps: StepIntent[];
  defaults?: { sandboxId?: string | null; model?: string | null };
}
```

- [ ] **Step 2: Write the failing test for ref helpers**

Create `packages/builder/src/assembler/refs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { refString, toInputValue, isValidNodeId } from "./refs.ts";
import type { InputIntent } from "./intent.ts";

describe("refString", () => {
  it("builds a step-output ref", () => {
    expect(refString({ from: "step-output", stepRef: "n_2", field: "diff" })).toBe("n_2.output.diff");
  });
  it("builds workflow-input and attribute refs", () => {
    expect(refString({ from: "workflow-input", name: "repo" })).toBe("workflow.input.repo");
    expect(refString({ from: "workflow-attribute", name: "baseUrl" })).toBe("workflow.attribute.baseUrl");
  });
  it("returns null for kinds that are not single refs", () => {
    expect(refString({ from: "literal", value: 1 })).toBeNull();
    expect(refString({ from: "template", template: "x" })).toBeNull();
  });
});

describe("toInputValue", () => {
  it("maps literal", () => {
    expect(toInputValue({ from: "literal", value: 42 })).toEqual({ kind: "literal", value: 42 });
  });
  it("maps a single ref", () => {
    const v: InputIntent = { from: "step-output", stepRef: "a", field: "out" };
    expect(toInputValue(v)).toEqual({ kind: "ref", ref: "a.output.out" });
  });
  it("maps a template verbatim (refs already embedded as {{ }})", () => {
    expect(toInputValue({ from: "template", template: "Fix {{ workflow.input.key }}" }))
      .toEqual({ kind: "template", template: "Fix {{ workflow.input.key }}" });
  });
});

describe("isValidNodeId", () => {
  it("accepts ids without dots", () => {
    expect(isValidNodeId("n_1")).toBe(true);
    expect(isValidNodeId("get-ticket")).toBe(true);
  });
  it("rejects ids containing a dot (would break ref parsing)", () => {
    expect(isValidNodeId("a.b")).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run packages/builder/src/assembler/refs.test.ts`
Expected: FAIL — cannot resolve `./refs.ts`.

- [ ] **Step 4: Create `packages/builder/src/assembler/refs.ts`**

```ts
import type { WorkflowInputValue } from "@journeyman/core";
import type { InputIntent } from "./intent.ts";

/** Node ids must not contain a dot — the ref grammar splits on the first dot. */
export function isValidNodeId(id: string): boolean {
  return id.length > 0 && !id.includes(".");
}

/** The editor-form ref string for a single-binding InputIntent, or null if it isn't one. */
export function refString(v: InputIntent): string | null {
  switch (v.from) {
    case "step-output":         return `${v.stepRef}.output.${v.field}`;
    case "workflow-input":      return `workflow.input.${v.name}`;
    case "workflow-attribute":  return `workflow.attribute.${v.name}`;
    default:                    return null;
  }
}

/** Convert an InputIntent into the stored WorkflowInputValue. */
export function toInputValue(v: InputIntent): WorkflowInputValue {
  if (v.from === "literal") return { kind: "literal", value: v.value };
  if (v.from === "template") return { kind: "template", template: v.template };
  const ref = refString(v);
  // refString is non-null for the remaining kinds (step-output / workflow-input / workflow-attribute).
  return { kind: "ref", ref: ref! };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run packages/builder/src/assembler/refs.test.ts`
Expected: PASS (8 assertions across 3 describes).

---

## Task 2: Gap detection (`gaps.ts`)

**Files:**
- Create: `packages/builder/src/assembler/gaps.ts`
- Test: `packages/builder/src/assembler/gaps.test.ts`

Gap detection maps an intent's steps to `Gap[]` using the core availability registry: a provider step whose provider is not `implemented`, or whose specific operation is on the unsupported-operations deny-list, becomes a `not-implemented` gap; a webhook trigger/wait with `webhookId === null` becomes a `webhook` gap.

- [ ] **Step 1: Write the failing test**

Create `packages/builder/src/assembler/gaps.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { detectGaps } from "./gaps.ts";
import type { AssemblerIntent } from "./intent.ts";

const base: AssemblerIntent = { summary: "", triggers: [{ kind: "manual" }], steps: [] };

describe("detectGaps", () => {
  it("flags an unimplemented provider step (Slack) as not-implemented", () => {
    const intent: AssemblerIntent = {
      ...base,
      steps: [{ ref: "notify", kind: "provider", label: "Notify", stepType: "send-message", provider: "slack" }],
    };
    const gaps = detectGaps(intent, { nodeIdByRef: { notify: "n_1" } });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].kind).toBe("not-implemented");
    expect(gaps[0].nodeIds).toEqual(["n_1"]);
  });

  it("flags a deny-listed operation (Jira transition) as not-implemented", () => {
    const intent: AssemblerIntent = {
      ...base,
      steps: [{ ref: "move", kind: "provider", label: "Move", stepType: "transition-issue", provider: "jira" }],
    };
    const gaps = detectGaps(intent, { nodeIdByRef: { move: "n_1" } });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].kind).toBe("not-implemented");
    expect(gaps[0].reason).toMatch(/updateStatus/);
  });

  it("does not flag an implemented provider operation (GitHub PR comment)", () => {
    const intent: AssemblerIntent = {
      ...base,
      steps: [{ ref: "c", kind: "provider", label: "Comment", stepType: "comment-on-pull-request", provider: "github" }],
    };
    expect(detectGaps(intent, { nodeIdByRef: { c: "n_1" } })).toHaveLength(0);
  });

  it("flags a webhook trigger with no webhook as a webhook gap", () => {
    const intent: AssemblerIntent = {
      summary: "", steps: [],
      triggers: [{ kind: "webhook", webhookId: null, listensFor: ["pull_request"] }],
    };
    const gaps = detectGaps(intent, { nodeIdByRef: {}, triggerNodeIds: ["t_1"] });
    expect(gaps).toHaveLength(1);
    expect(gaps[0].kind).toBe("webhook");
    expect(gaps[0].required).toBe(true);
  });

  it("flags a webhook-wait with no webhook as a webhook gap", () => {
    const intent: AssemblerIntent = {
      ...base,
      steps: [{ ref: "w", kind: "webhook-wait", label: "Wait for CI", waitWebhookId: null }],
    };
    const gaps = detectGaps(intent, { nodeIdByRef: { w: "n_1" } });
    expect(gaps.some((g) => g.kind === "webhook" && g.nodeIds.includes("n_1"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/builder/src/assembler/gaps.test.ts`
Expected: FAIL — cannot resolve `./gaps.ts`.

- [ ] **Step 3: Create `packages/builder/src/assembler/gaps.ts`**

```ts
import {
  PROVIDER_CATALOG,
  unsupportedOperationForStep,
  type Gap,
} from "@journeyman/core";
import type { AssemblerIntent } from "./intent.ts";

export interface GapDeps {
  /** intent step ref → assigned node id. */
  nodeIdByRef: Record<string, string>;
  /** assigned ids of trigger nodes, in trigger order. */
  triggerNodeIds?: string[];
}

function providerImplemented(provider: string): boolean {
  const entry = PROVIDER_CATALOG.find((p) => p.value === provider);
  return entry?.implemented === true;
}

let gapSeq = 0;
function gapId(): string {
  gapSeq += 1;
  return `gap_${gapSeq}`;
}

/** Detect availability gaps for an intent (provider stubs, deny-listed ops, missing webhooks). */
export function detectGaps(intent: AssemblerIntent, deps: GapDeps): Gap[] {
  const gaps: Gap[] = [];

  // Provider step availability.
  for (const s of intent.steps) {
    if (s.kind === "provider" && s.stepType && s.provider) {
      const nodeId = deps.nodeIdByRef[s.ref];
      if (!nodeId) continue;
      const denied = unsupportedOperationForStep(s.provider, s.stepType);
      if (denied) {
        gaps.push({
          id: gapId(), kind: "not-implemented", nodeIds: [nodeId],
          reason: denied.reason, required: true, fixHint: null,
        });
      } else if (!providerImplemented(s.provider)) {
        gaps.push({
          id: gapId(), kind: "not-implemented", nodeIds: [nodeId],
          reason: `The ${s.provider} provider is not implemented yet.`,
          required: true, fixHint: null,
        });
      }
    }
    // webhook-wait needing a webhook.
    if (s.kind === "webhook-wait" && (s.waitWebhookId === null || s.waitWebhookId === undefined)) {
      const nodeId = deps.nodeIdByRef[s.ref];
      if (nodeId) {
        gaps.push({
          id: gapId(), kind: "webhook", nodeIds: [nodeId],
          reason: "This wait needs a webhook to resume on; none is configured.",
          required: true, fixHint: "Configure a webhook in settings.",
        });
      }
    }
  }

  // Webhook trigger needing a webhook record.
  intent.triggers.forEach((t, i) => {
    if (t.kind === "webhook" && t.webhookId === null) {
      const nodeId = deps.triggerNodeIds?.[i];
      gaps.push({
        id: gapId(), kind: "webhook", nodeIds: nodeId ? [nodeId] : [],
        reason: "This trigger needs a webhook; none is configured.",
        required: true, fixHint: "Configure a webhook in settings.",
      });
    }
  });

  return gaps;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/builder/src/assembler/gaps.test.ts`
Expected: PASS (5 tests).

> Note: the GitHub-PR-comment "does not flag" test relies on `comment-on-pull-request` having an implemented provider (`github`, `implemented: true`). The earlier exploration flagged that `comment-on-pull-request` is missing from `PHASE_KIND_MAP`, but `detectGaps` keys off the **intent's explicit `provider` value**, not `kindForStepType`, so the missing map entry does not affect this check.

---

## Task 3: The assembler core (`assemble.ts`)

**Files:**
- Create: `packages/builder/src/assembler/assemble.ts`
- Test: `packages/builder/src/assembler/assemble.test.ts`
- Modify: `packages/builder/src/index.ts`

The assembler assigns node ids (`n_1`, `n_2`, … and `t_1`, … for triggers), positions, builds nodes (triggers → steps → a single `end`), default edges in chain order plus trigger→first-step edges, input wiring, webhook trigger config + `inputDefs`, pause nodes, then `StepBinding[]` and `Gap[]`.

- [ ] **Step 1: Write the failing test**

Create `packages/builder/src/assembler/assemble.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assemble } from "./assemble.ts";
import type { AssemblerIntent } from "./intent.ts";

describe("assemble — structure", () => {
  it("builds trigger → step → end with default edges and unique, dot-free node ids", () => {
    const intent: AssemblerIntent = {
      summary: "Get a ticket and comment.",
      triggers: [{ kind: "manual" }],
      steps: [
        { ref: "get", kind: "provider", label: "Get issue", stepType: "get-issue", provider: "jira",
          inputs: [{ slot: "ref", value: { from: "workflow-input", name: "ticketKey" } }] },
      ],
    };
    const { workflow, stepBindings } = assemble(intent, {});
    // node ids
    const ids = workflow.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);          // unique
    expect(ids.every((id) => !id.includes("."))).toBe(true);
    // a trigger, a step, and an end node exist
    expect(workflow.nodes.some((n) => n.type === "trigger-manual")).toBe(true);
    expect(workflow.nodes.some((n) => n.type === "step" && n.stepType === "get-issue")).toBe(true);
    expect(workflow.nodes.some((n) => n.type === "end")).toBe(true);
    // the step's input is wired as a ref
    const step = workflow.nodes.find((n) => n.stepType === "get-issue")!;
    expect(step.inputs!.ref).toEqual({ kind: "ref", ref: "workflow.input.ticketKey" });
    // every edge connects existing nodes
    for (const e of workflow.edges) {
      expect(ids).toContain(e.source);
      expect(ids).toContain(e.target);
    }
    // a binding exists for the step
    expect(stepBindings.find((b) => b.stepKind === "provider")).toBeDefined();
  });

  it("wires step-output refs between steps using assigned node ids", () => {
    const intent: AssemblerIntent = {
      summary: "",
      triggers: [{ kind: "manual" }],
      steps: [
        { ref: "a", kind: "ai", label: "Analyze", stepType: "custom-ai", customStepId: "tmp-a",
          model: "claude-opus", tools: ["read-file"] },
        { ref: "b", kind: "provider", label: "Comment", stepType: "comment-on-pull-request", provider: "github",
          inputs: [{ slot: "body", value: { from: "step-output", stepRef: "a", field: "summary" } }] },
      ],
    };
    const { workflow } = assemble(intent, {});
    const a = workflow.nodes.find((n) => n.config?.customStepId === "tmp-a")!;
    const b = workflow.nodes.find((n) => n.stepType === "comment-on-pull-request")!;
    expect(b.inputs!.body).toEqual({ kind: "ref", ref: `${a.id}.output.summary` });
  });

  it("builds a webhook trigger with config + inputDefs, and includes a webhook gap when unconfigured", () => {
    const intent: AssemblerIntent = {
      summary: "",
      triggers: [{ kind: "webhook", webhookId: null, listensFor: ["pull_request.opened"],
        inputs: [{ name: "prNumber", type: "number", fromPath: "$.pull_request.number" }] }],
      steps: [{ ref: "x", kind: "provider", label: "Get repo", stepType: "get-repository", provider: "github" }],
    };
    const { workflow, gaps } = assemble(intent, {});
    const trig = workflow.nodes.find((n) => n.type === "trigger-webhook")!;
    expect(trig.config!.inputsMapping).toEqual({ prNumber: { fromPath: "$.pull_request.number", type: "number" } });
    expect(trig.config!.listensFor).toEqual(["pull_request.opened"]);
    expect(workflow.inputDefs).toEqual([{ name: "prNumber", type: "number" }]);
    expect(gaps.some((g) => g.kind === "webhook")).toBe(true);
  });

  it("emits human-task and webhook-wait pause nodes with the right node types", () => {
    const intent: AssemblerIntent = {
      summary: "",
      triggers: [{ kind: "manual" }],
      steps: [
        { ref: "rev", kind: "human-task", label: "Review", assignee: "oncall", taskPrompt: "Approve?" },
        { ref: "ci", kind: "webhook-wait", label: "Wait CI", waitWebhookId: "wh-ci" },
      ],
    };
    const { workflow, stepBindings } = assemble(intent, {});
    expect(workflow.nodes.some((n) => n.type === "human-task")).toBe(true);
    expect(workflow.nodes.some((n) => n.type === "webhook-wait")).toBe(true);
    expect(stepBindings.some((b) => b.stepKind === "human-task")).toBe(true);
    expect(stepBindings.some((b) => b.stepKind === "webhook-wait")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/builder/src/assembler/assemble.test.ts`
Expected: FAIL — cannot resolve `./assemble.ts`.

- [ ] **Step 3: Create `packages/builder/src/assembler/assemble.ts`**

```ts
import type {
  WorkflowGraph, WorkflowNode, WorkflowEdge, WorkflowNodeType,
  WorkflowInputDef, StepBinding, Gap, StepKind,
} from "@journeyman/core";
import { WORKFLOW_SCHEMA_VERSION } from "@journeyman/core";
import type { AssemblerIntent, StepIntent, TriggerIntent } from "./intent.ts";
import { toInputValue } from "./refs.ts";
import { detectGaps } from "./gaps.ts";

export interface AssembleDeps {
  /** Reserved for future catalog-driven checks; unused in Phase 2a. */
  catalog?: unknown;
}

export interface AssembleResult {
  workflow: WorkflowGraph;
  stepBindings: StepBinding[];
  gaps: Gap[];
}

const X_STEP = 240; // horizontal spacing between chained nodes
const Y = 0;

function triggerNodeType(t: TriggerIntent): WorkflowNodeType {
  switch (t.kind) {
    case "manual":  return "trigger-manual";
    case "webhook": return "trigger-webhook";
    case "form":    return "trigger-human";
  }
}

function stepNodeType(s: StepIntent): WorkflowNodeType {
  if (s.kind === "human-task") return "human-task";
  if (s.kind === "webhook-wait") return "webhook-wait";
  return "step";
}

function bindingKind(s: StepIntent): StepKind {
  if (s.kind === "human-task") return "human-task";
  if (s.kind === "webhook-wait") return "webhook-wait";
  if (s.kind === "ai") return "ai";
  return "provider";
}

export function assemble(intent: AssemblerIntent, _deps: AssembleDeps = {}): AssembleResult {
  const nodes: WorkflowNode[] = [];
  const edges: WorkflowEdge[] = [];
  const inputDefs: WorkflowInputDef[] = [];
  const triggerNodeIds: string[] = [];
  const nodeIdByRef: Record<string, string> = {};
  let col = 0;
  let edgeSeq = 0;
  const edge = (source: string, target: string): WorkflowEdge => ({
    id: `e_${++edgeSeq}`, source, target, type: "default",
  });

  // --- Triggers ---
  intent.triggers.forEach((t, i) => {
    const id = `t_${i + 1}`;
    triggerNodeIds.push(id);
    const config: Record<string, unknown> = {};
    if (t.kind === "webhook") {
      config.webhookId = t.webhookId ?? "";
      if (t.listensFor) config.listensFor = t.listensFor;
      const mapping: Record<string, { fromPath: string; type: string }> = {};
      for (const inp of t.inputs ?? []) {
        mapping[inp.name] = { fromPath: inp.fromPath, type: inp.type };
        inputDefs.push({ name: inp.name, type: inp.type });
      }
      config.inputsMapping = mapping;
    } else if (t.kind === "form") {
      config.fieldOverrides = {};
      for (const inp of t.inputs ?? []) inputDefs.push({ name: inp.name, type: inp.type });
    }
    nodes.push({
      id, type: triggerNodeType(t), displayName: t.kind, config,
      position: { x: col * X_STEP, y: Y },
    });
  });
  col += 1;

  // --- Steps (chain) ---
  const stepNodeIds: string[] = [];
  intent.steps.forEach((s, i) => {
    const id = `n_${i + 1}`;
    nodeIdByRef[s.ref] = id;
    stepNodeIds.push(id);
    const node: WorkflowNode = {
      id, type: stepNodeType(s), displayName: s.label,
      position: { x: col * X_STEP, y: Y },
    };
    col += 1;

    const config: Record<string, unknown> = {};
    if (node.type === "step") {
      node.stepType = s.stepType;
      if (s.stepType === "custom-ai" && s.customStepId) config.customStepId = s.customStepId;
      if (s.kind === "ai") {
        if (s.tools) config.tools = s.tools;
        if (s.mcpIds) config.mcpInstanceIds = s.mcpIds;
        if (s.skillIds) config.skillIds = s.skillIds;
      }
      if (s.provider) node.executorConfig = { provider: s.provider };
      if (s.model) node.model = s.model;
      if (s.sandboxId) node.sandboxId = s.sandboxId;
    } else if (node.type === "webhook-wait") {
      config.webhookId = s.waitWebhookId ?? "";
    } else if (node.type === "human-task") {
      if (s.assignee) config.assignee = s.assignee;
      if (s.taskPrompt) config.prompt = s.taskPrompt;
    }
    node.config = config;

    // input wiring
    if (s.inputs && s.inputs.length > 0) {
      const inputs: Record<string, ReturnType<typeof toInputValue>> = {};
      for (const b of s.inputs) inputs[b.slot] = toInputValue(b.value);
      node.inputs = inputs;
    }
    nodes.push(node);
  });

  // --- end node ---
  const endId = "end";
  nodes.push({ id: endId, type: "end", displayName: "End", config: {}, position: { x: col * X_STEP, y: Y } });

  // --- edges: each trigger → first step (or end); steps in chain; last → end ---
  const firstTarget = stepNodeIds[0] ?? endId;
  for (const tId of triggerNodeIds) edges.push(edge(tId, firstTarget));
  for (let i = 0; i < stepNodeIds.length - 1; i++) edges.push(edge(stepNodeIds[i], stepNodeIds[i + 1]));
  if (stepNodeIds.length > 0) edges.push(edge(stepNodeIds[stepNodeIds.length - 1], endId));

  // --- step bindings ---
  const stepBindings: StepBinding[] = intent.steps.map((s) => {
    const nodeId = nodeIdByRef[s.ref];
    const uses: StepBinding["uses"] = {};
    if (s.kind === "ai") {
      if (s.tools) uses.tools = s.tools;
      if (s.mcpIds) uses.mcpIds = s.mcpIds;
      if (s.skillIds) uses.skillIds = s.skillIds;
      if (s.model) uses.model = s.model;
    } else if (s.kind === "provider" && s.connection) {
      uses.connection = s.connection;
    }
    if (s.sandboxId) uses.sandboxId = s.sandboxId;
    if (s.secrets) uses.secrets = s.secrets;
    const inputs = (s.inputs ?? []).map((b) => ({
      name: b.slot,
      from: describeFrom(b.value),
    }));
    return { nodeId, stepKind: bindingKind(s), uses, io: { inputs, outputs: [] } };
  });

  const gaps = detectGaps(intent, { nodeIdByRef, triggerNodeIds });

  const workflow: WorkflowGraph = {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    nodes,
    edges,
    inputDefs,
  };
  return { workflow, stepBindings, gaps };
}

/** Human-readable source description for the inputs/outputs (⇄) reveal. */
function describeFrom(v: { from: string } & Record<string, unknown>): string {
  switch (v.from) {
    case "literal":            return "a fixed value";
    case "workflow-input":     return `flow input ${String(v.name)}`;
    case "workflow-attribute": return `flow attribute ${String(v.name)}`;
    case "step-output":        return `step ${String(v.stepRef)} · output ${String(v.field)}`;
    case "template":           return "a template";
    default:                   return "unknown";
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/builder/src/assembler/assemble.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Export the assembler from `packages/builder/src/index.ts`**

Add to the existing barrel:

```ts
export { assemble, type AssembleResult, type AssembleDeps } from "./assembler/assemble.ts";
export type {
  AssemblerIntent, TriggerIntent, StepIntent, InputIntent, InputBindingIntent, WebhookInputIntent,
} from "./assembler/intent.ts";
export { detectGaps, type GapDeps } from "./assembler/gaps.ts";
export { toInputValue, refString, isValidNodeId } from "./assembler/refs.ts";
```

- [ ] **Step 6: Run the whole builder package's tests**

Run: `npm test -w @journeyman/builder`
Expected: PASS — the Phase 1 store test plus the three new assembler tests (refs, gaps, assemble).

---

## Final: Typecheck the whole repo (no commit)

- [ ] **Step 1: Run the full type + import-boundary check**

Run: `npm run check`
Expected: PASS — `npm run typecheck` (all workspaces incl. `@journeyman/builder`) and `npm run check:boundaries` (clean). If `check:boundaries` flags `@journeyman/builder` importing `@journeyman/steps` (added in Task 3 if needed) or `@journeyman/core`, those are allowed peer/lower-layer imports — confirm the reported edge is one of those; if it flags something else, fix it. **Do not commit** — leave changes for review.

---

## Self-review checklist (run before handoff)

- **Spec coverage (Phase 2a slice):** intent contract ✓ (Task 1); ref grammar emission (`<nodeId>.output.<field>`, `workflow.input/attribute`, `{{ }}` templates) ✓ (Task 1); gap detection (provider stub, deny-listed op, missing webhook) ✓ (Task 2); assembler core — triggers (manual/webhook/form), step chain, custom-ai config, pause nodes, input wiring, webhook `inputsMapping` + `inputDefs`, default edges, step bindings ✓ (Task 3). Conditional branching + apply executor are Phase 2b; read-tools/serializers are Phase 3.
- **No placeholders:** every code step has complete code; every run step has a command + expected result.
- **Type consistency:** `InputIntent`/`StepIntent`/`TriggerIntent`/`AssemblerIntent` defined once (Task 1) and consumed by Tasks 2–3; `toInputValue` returns `WorkflowInputValue` (core); `StepBinding`/`Gap`/`StepKind` imported from core (Phase 1); node ids are dot-free (`n_*`, `t_*`, `end`) so they satisfy the ref grammar.
- **Ref-grammar fidelity:** `refString` produces exactly the strings `resolve-inputs.ts`'s `parseRef` accepts; templates are passed through verbatim expecting `{{ }}` tokens.
- **No commit steps anywhere; final step is `npm run check`.** ✓

> **Deferred to Phase 2b:** conditional branching (gateway-xor + `conditional`/`else` edges with `branchLabel` + JsonLogic `condition`, per the verified encoding) and the apply executor (`insertCustomAiStep` → rewrite placeholder ids → `c.workflows.create` draft → rollback via `deleteCustomAiStep`). Both have their exact contracts gathered and ready to plan.
