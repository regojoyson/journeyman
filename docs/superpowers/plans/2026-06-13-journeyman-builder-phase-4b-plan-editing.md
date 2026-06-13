# Journeyman Builder — Phase 4b: Plan Editing & Sessions History — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Builder page's plan preview *editable in place* — change a step's model, toggle tools, pick an MCP/sandbox, map a secret, and resolve gaps inline — plus a sessions sidebar to resume/rename/delete past builds. Edits mutate the in-memory `BuildPlan`, re-run validation, and persist to the session via `PATCH`. Deep edits remain the flow editor's job.

**Architecture:** All edit correctness lives in **pure, immutable `BuildPlan` editors** (`plan-edits.ts`) that mutate the *authoritative* graph node (`workflow.nodes[].model / sandboxId / config.tools / config.mcpInstanceIds`) **and** mirror the change into the matching `stepBindings[].uses` (what the preview renders) so Apply and the UI never drift. Sessions-list view logic is pure (`sessions-view.ts`). The page wires these with React Query (inventory dropdowns: coding models, MCPs, sandboxes, secrets), a debounced persist+validate effect, and an Apply gate that now also requires the latest validation to pass. Components (`StepCard`, `SessionsSidebar`) are thin and verified via the browser preview (the web package has no jsdom).

**Tech Stack:** Vite + React 19, react-router v7, TanStack Query v5, Tailwind v4, Vitest. Cookie auth (`credentials: "include"`).

**Constraints (from the user):** **No `git commit` steps.** **Final step is `npm run check`.** Each code task ends by running its tests; components are verified by typecheck + the browser preview.

**Reference:** Spec `docs/superpowers/specs/2026-06-13-journeyman-builder-design.md` → "The page" (lines 446–497): editable step cards, the ⇄ inputs/outputs reveal, inline-on-step gaps + footer total, secrets-by-name, "Apply disabled until validation passes and all required gaps acknowledged", and "A sessions list lets the user resume past builds." Builds directly on Phase 4 (`BuilderPage.tsx`, `builder-state.ts`, `api/builder.ts`).

**Verified contracts (read before coding):**
- `WorkflowNode` (`packages/core/src/types/flow.types.ts:98`): authoritative fields `model?: string | null`, `sandboxId?` , `config?: Record<string, unknown>` (holds `tools: CanonicalTool[]`, `mcpInstanceIds: string[]`, `skillIds: string[]`, `customStepId`). The assembler writes exactly these (`packages/builder/src/assembler/assemble.ts:94-116`).
- `StepBinding` (`packages/core/src/types/builder.types.ts:15`): display mirror — `uses: { tools?, mcpIds?, skillIds?, model?, connection?, sandboxId?, secrets?: {slot, secretName|null}[] }`, `io: { inputs: {name, from}[]; outputs: {name, type}[] }`. `from` is already human-readable (assembler `describeFrom`).
- `Gap` (`:39`): `{ id, kind, nodeIds: string[], reason, required, fixHint: string|null }`. `canApply` (Phase 4) already blocks on any `required` gap.
- `BuildPlan` (`:50`): `{ newCustomSteps, workflow, defaults: {sandboxId, model}, stepBindings, gaps, summary }`.
- `CANONICAL_TOOLS` (`packages/core/src/types/coding-tools.types.ts:5`) — the fixed tool set for toggles. Exported from `@journeyman/core`.
- Inventory clients (already exist): `codingModelsApi.list(provider)` → `CodingModel[]`; `mcpApi.listMy(orgId)` → `McpInstance[]` (`{id,name}`); `sandboxesApi.listVisible(orgId)` → `Sandbox[]` (`{id,name}`); `fetchVisibleSecrets(orgId)` → `VisibleSecret[]` (`{name,scope}`).
- Validate client: `validateFlowDefinition(definition: WorkflowGraph)` → `FlowValidationReport { ok, errors, missing, warnings, secretWarnings }` (`packages/web/src/api/flows.ts:137`).
- Session backend already supports everything we need (no backend changes): `GET …/builder/sessions` (list), `PATCH …/builder/sessions/:id` (accepts `name`, `status`, `messages`, `buildPlan`, `appliedFlowId`), `DELETE …/builder/sessions/:id`. The **apply route reads `session.buildPlan` from the DB** (`builder-apply.ts:36-43`) — so persisting edits via `PATCH` before Apply is what makes them take effect.

**Scope guard (honest boundaries):**
- Light edits only. Mapping a secret records the chosen name in the binding and **closes the connection/secret gap** so Apply is unblocked; the final per-slot secret wiring on a custom-AI step is completed in the flow editor (spec lines 477–487). Comment this in code; do not claim the worker consumes a field it doesn't.
- API client wrappers (`listBuilderSessions`/`patchBuilderSession`/`deleteBuilderSession`) are thin fetch wiring and are **not** unit-tested — consistent with the existing un-tested `createBuilderSession`/`applyBuilderPlan` in the same file. All real logic is TDD'd in `plan-edits.ts` / `sessions-view.ts` / `builder-state.ts`.

---

## File Structure (Phase 4b)

**Create:**
- `packages/web/src/routes/plan-edits.ts` — pure immutable `BuildPlan` editors (node + binding + defaults + gap resolve)
- `packages/web/src/routes/plan-edits.test.ts`
- `packages/web/src/routes/sessions-view.ts` — pure sessions-list helpers (label, sort)
- `packages/web/src/routes/sessions-view.test.ts`
- `packages/web/src/routes/StepCard.tsx` — one editable step card (model/tools/mcp/sandbox/secret/gaps + ⇄ reveal)
- `packages/web/src/routes/SessionsSidebar.tsx` — resume/rename/delete past sessions

**Modify:**
- `packages/web/src/api/builder.ts` — add `listBuilderSessions`, `patchBuilderSession`, `deleteBuilderSession`
- `packages/web/src/routes/builder-state.ts` — add `canApplyNow(plan, validation)` (validation-aware apply gate)
- `packages/web/src/routes/builder-state.test.ts` — tests for `canApplyNow`
- `packages/web/src/routes/BuilderPage.tsx` — wire sidebar + editable cards + inventory + debounced persist/validate + new apply gate

---

## Task 1: API client — session list / patch / delete

**Files:**
- Modify: `packages/web/src/api/builder.ts`

- [ ] **Step 1: Add the three wrappers** (after `applyBuilderPlan`, before `streamBuilderChat`)

```typescript
export async function listBuilderSessions(orgId: string): Promise<BuilderSession[]> {
  return api<BuilderSession[]>(`/api/orgs/${orgId}/users/me/builder/sessions`);
}

/** Persist edits to a session (name, status, or the edited build plan). */
export async function patchBuilderSession(
  orgId: string,
  id: string,
  patch: Partial<Pick<BuilderSession, "name" | "status" | "buildPlan">>,
): Promise<{ ok: true }> {
  return api<{ ok: true }>(`/api/orgs/${orgId}/users/me/builder/sessions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function deleteBuilderSession(orgId: string, id: string): Promise<{ ok: true }> {
  return api<{ ok: true }>(`/api/orgs/${orgId}/users/me/builder/sessions/${id}`, {
    method: "DELETE",
  });
}
```

- [ ] **Step 2: Typecheck the web package**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS (no usages yet; just exports).

---

## Task 2: Pure plan editors (`plan-edits.ts`)

Every editor returns a **new** `BuildPlan`, mutating the authoritative graph node and mirroring into the matching `stepBinding`. This is the correctness core of Phase 4b.

**Files:**
- Create: `packages/web/src/routes/plan-edits.test.ts`
- Create: `packages/web/src/routes/plan-edits.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/web/src/routes/plan-edits.test.ts
import { describe, it, expect } from "vitest";
import type { BuildPlan } from "@journeyman/core";
import {
  setStepModel, toggleStepTool, setStepMcpIds, setStepSandbox,
  mapSecretSlot, setDefaultModel, setDefaultSandbox, resolveGap,
} from "./plan-edits.ts";

function planFixture(): BuildPlan {
  return {
    summary: "s",
    newCustomSteps: [],
    defaults: { sandboxId: null, model: null },
    gaps: [
      { id: "g1", kind: "connection", nodeIds: ["n_1"], reason: "needs GitHub", required: true, fixHint: null },
      { id: "g2", kind: "skill", nodeIds: ["n_1"], reason: "optional skill", required: false, fixHint: null },
    ],
    workflow: {
      schemaVersion: 2,
      nodes: [
        { id: "n_1", type: "step", stepType: "custom-ai", displayName: "AI",
          model: "old-model", sandboxId: undefined,
          config: { tools: ["bash"], mcpInstanceIds: [], customStepId: "cs_1" } },
        { id: "n_2", type: "step", stepType: "open-pr", displayName: "PR", config: {} },
      ],
      edges: [],
      inputDefs: [],
    },
    stepBindings: [
      { nodeId: "n_1", stepKind: "ai",
        uses: { tools: ["bash"], mcpIds: [], model: "old-model", secrets: [{ slot: "GITHUB_TOKEN", secretName: null }] },
        io: { inputs: [], outputs: [] } },
      { nodeId: "n_2", stepKind: "provider", uses: { connection: "github" }, io: { inputs: [], outputs: [] } },
    ],
  } as BuildPlan;
}

const node = (p: BuildPlan, id: string) => p.workflow.nodes.find((n) => n.id === id)!;
const binding = (p: BuildPlan, id: string) => p.stepBindings.find((b) => b.nodeId === id)!;

describe("setStepModel", () => {
  it("updates the node model and the binding mirror", () => {
    const next = setStepModel(planFixture(), "n_1", "claude-opus-4-8");
    expect(node(next, "n_1").model).toBe("claude-opus-4-8");
    expect(binding(next, "n_1").uses.model).toBe("claude-opus-4-8");
  });
  it("clears the model when given an empty string", () => {
    const next = setStepModel(planFixture(), "n_1", "");
    expect(node(next, "n_1").model ?? null).toBeNull();
    expect(binding(next, "n_1").uses.model).toBeUndefined();
  });
  it("does not mutate the input plan", () => {
    const p = planFixture();
    setStepModel(p, "n_1", "x");
    expect(node(p, "n_1").model).toBe("old-model");
  });
});

describe("toggleStepTool", () => {
  it("adds a tool when absent (node + binding)", () => {
    const next = toggleStepTool(planFixture(), "n_1", "read-file");
    expect(node(next, "n_1").config!.tools).toEqual(["bash", "read-file"]);
    expect(binding(next, "n_1").uses.tools).toEqual(["bash", "read-file"]);
  });
  it("removes a tool when present", () => {
    const next = toggleStepTool(planFixture(), "n_1", "bash");
    expect(node(next, "n_1").config!.tools).toEqual([]);
    expect(binding(next, "n_1").uses.tools).toEqual([]);
  });
});

describe("setStepMcpIds / setStepSandbox", () => {
  it("sets mcp ids on node config and binding", () => {
    const next = setStepMcpIds(planFixture(), "n_1", ["m1", "m2"]);
    expect(node(next, "n_1").config!.mcpInstanceIds).toEqual(["m1", "m2"]);
    expect(binding(next, "n_1").uses.mcpIds).toEqual(["m1", "m2"]);
  });
  it("sets the sandbox on node and binding", () => {
    const next = setStepSandbox(planFixture(), "n_2", "sb_1");
    expect(node(next, "n_2").sandboxId).toBe("sb_1");
    expect(binding(next, "n_2").uses.sandboxId).toBe("sb_1");
  });
});

describe("mapSecretSlot", () => {
  it("records the secret name in the binding slot", () => {
    const next = mapSecretSlot(planFixture(), "n_1", "GITHUB_TOKEN", "MY_GH_PAT");
    expect(binding(next, "n_1").uses.secrets).toEqual([{ slot: "GITHUB_TOKEN", secretName: "MY_GH_PAT" }]);
  });
  it("adds the slot if the binding had no secrets array", () => {
    const next = mapSecretSlot(planFixture(), "n_2", "NPM_TOKEN", "MY_NPM");
    expect(binding(next, "n_2").uses.secrets).toEqual([{ slot: "NPM_TOKEN", secretName: "MY_NPM" }]);
  });
});

describe("defaults", () => {
  it("sets default model and sandbox", () => {
    let p = setDefaultModel(planFixture(), "claude-opus-4-8");
    p = setDefaultSandbox(p, "sb_default");
    expect(p.defaults.model).toBe("claude-opus-4-8");
    expect(p.defaults.sandboxId).toBe("sb_default");
  });
});

describe("resolveGap", () => {
  it("removes the gap by id (unblocking Apply when it was required)", () => {
    const next = resolveGap(planFixture(), "g1");
    expect(next.gaps.map((g) => g.id)).toEqual(["g2"]);
  });
  it("is a no-op for an unknown id", () => {
    expect(resolveGap(planFixture(), "nope").gaps).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @journeyman/web -- plan-edits`
Expected: FAIL — `Cannot find module "./plan-edits.ts"`.

- [ ] **Step 3: Implement `plan-edits.ts`**

```typescript
// packages/web/src/routes/plan-edits.ts
import type { BuildPlan, CanonicalTool, StepBinding, WorkflowNode } from "@journeyman/core";

/** Replace the node with the given id by `fn(node)`, returning a new plan. Pure. */
function mapNode(plan: BuildPlan, nodeId: string, fn: (n: WorkflowNode) => WorkflowNode): BuildPlan {
  return {
    ...plan,
    workflow: {
      ...plan.workflow,
      nodes: plan.workflow.nodes.map((n) => (n.id === nodeId ? fn(n) : n)),
    },
  };
}

/** Replace the binding for the given node id by `fn(binding)`, returning a new plan. Pure. */
function mapBinding(plan: BuildPlan, nodeId: string, fn: (b: StepBinding) => StepBinding): BuildPlan {
  return {
    ...plan,
    stepBindings: plan.stepBindings.map((b) => (b.nodeId === nodeId ? fn(b) : b)),
  };
}

function withConfig(n: WorkflowNode, patch: Record<string, unknown>): WorkflowNode {
  return { ...n, config: { ...(n.config ?? {}), ...patch } };
}

/** Change (or clear, when empty) a step's model override. Updates node + binding. */
export function setStepModel(plan: BuildPlan, nodeId: string, model: string): BuildPlan {
  const value = model.trim() === "" ? null : model.trim();
  const p = mapNode(plan, nodeId, (n) => ({ ...n, model: value }));
  return mapBinding(p, nodeId, (b) => ({ ...b, uses: { ...b.uses, model: value ?? undefined } }));
}

/** Toggle one canonical tool on/off for an AI step. Updates node.config.tools + binding. */
export function toggleStepTool(plan: BuildPlan, nodeId: string, tool: CanonicalTool): BuildPlan {
  const node = plan.workflow.nodes.find((n) => n.id === nodeId);
  const current = ((node?.config?.tools as CanonicalTool[] | undefined) ?? []);
  const next = current.includes(tool) ? current.filter((t) => t !== tool) : [...current, tool];
  const p = mapNode(plan, nodeId, (n) => withConfig(n, { tools: next }));
  return mapBinding(p, nodeId, (b) => ({ ...b, uses: { ...b.uses, tools: next } }));
}

/** Set the MCP instance ids an AI step uses. Updates node.config.mcpInstanceIds + binding. */
export function setStepMcpIds(plan: BuildPlan, nodeId: string, ids: string[]): BuildPlan {
  const p = mapNode(plan, nodeId, (n) => withConfig(n, { mcpInstanceIds: ids }));
  return mapBinding(p, nodeId, (b) => ({ ...b, uses: { ...b.uses, mcpIds: ids } }));
}

/** Set (or clear) a step's sandbox override. Updates node.sandboxId + binding. */
export function setStepSandbox(plan: BuildPlan, nodeId: string, sandboxId: string | null): BuildPlan {
  const p = mapNode(plan, nodeId, (n) => ({ ...n, sandboxId: sandboxId ?? undefined }));
  return mapBinding(p, nodeId, (b) => ({ ...b, uses: { ...b.uses, sandboxId: sandboxId ?? undefined } }));
}

/**
 * Map a credential slot to a vault secret by name (convention; value never carried).
 * Records the choice in the binding for display. The final per-slot wiring on a
 * custom-AI step is completed in the flow editor; here it lets the user close a
 * connection gap (see `resolveGap`) without leaving the Builder.
 */
export function mapSecretSlot(plan: BuildPlan, nodeId: string, slot: string, secretName: string | null): BuildPlan {
  return mapBinding(plan, nodeId, (b) => {
    const secrets = [...(b.uses.secrets ?? [])];
    const i = secrets.findIndex((s) => s.slot === slot);
    if (i >= 0) secrets[i] = { slot, secretName };
    else secrets.push({ slot, secretName });
    return { ...b, uses: { ...b.uses, secrets } };
  });
}

export function setDefaultModel(plan: BuildPlan, model: string): BuildPlan {
  return { ...plan, defaults: { ...plan.defaults, model: model.trim() === "" ? null : model.trim() } };
}

export function setDefaultSandbox(plan: BuildPlan, sandboxId: string | null): BuildPlan {
  return { ...plan, defaults: { ...plan.defaults, sandboxId } };
}

/** Acknowledge/resolve a gap by removing it from the list (unblocks the Apply gate). */
export function resolveGap(plan: BuildPlan, gapId: string): BuildPlan {
  return { ...plan, gaps: plan.gaps.filter((g) => g.id !== gapId) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @journeyman/web -- plan-edits`
Expected: PASS (all cases).

---

## Task 3: Pure sessions-list view helpers (`sessions-view.ts`)

**Files:**
- Create: `packages/web/src/routes/sessions-view.test.ts`
- Create: `packages/web/src/routes/sessions-view.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/web/src/routes/sessions-view.test.ts
import { describe, it, expect } from "vitest";
import type { BuilderSession } from "../api/builder.ts";
import { sessionLabel, sessionStatusBadge, orderSessions } from "./sessions-view.ts";

const s = (over: Partial<BuilderSession>): BuilderSession => ({
  id: "1", name: "Build a QA flow", status: "active", messages: [], buildPlan: null, appliedFlowId: null, ...over,
});

describe("sessionLabel", () => {
  it("uses the session name when present", () => {
    expect(sessionLabel(s({ name: "Nightly SRE agent" }))).toBe("Nightly SRE agent");
  });
  it("falls back to the first user message, truncated", () => {
    const long = "a".repeat(80);
    const out = sessionLabel(s({ name: "", messages: [{ role: "user", content: long }] }));
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.startsWith("aaaa")).toBe(true);
  });
  it("falls back to 'Untitled build' when nothing is available", () => {
    expect(sessionLabel(s({ name: "", messages: [] }))).toBe("Untitled build");
  });
});

describe("sessionStatusBadge", () => {
  it("maps statuses to a short label", () => {
    expect(sessionStatusBadge(s({ status: "applied" }))).toBe("applied");
    expect(sessionStatusBadge(s({ status: "active" }))).toBe("draft");
    expect(sessionStatusBadge(s({ status: "archived" }))).toBe("archived");
  });
});

describe("orderSessions", () => {
  it("puts active drafts before applied/archived, preserving input order within a group", () => {
    const list = [
      s({ id: "a", status: "applied" }),
      s({ id: "b", status: "active" }),
      s({ id: "c", status: "archived" }),
      s({ id: "d", status: "active" }),
    ];
    expect(orderSessions(list).map((x) => x.id)).toEqual(["b", "d", "a", "c"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @journeyman/web -- sessions-view`
Expected: FAIL — `Cannot find module "./sessions-view.ts"`.

- [ ] **Step 3: Implement `sessions-view.ts`**

```typescript
// packages/web/src/routes/sessions-view.ts
import type { BuilderSession } from "../api/builder.ts";

/** Display label: session name, else the first user prompt (truncated), else a default. */
export function sessionLabel(session: BuilderSession): string {
  const name = session.name?.trim();
  if (name) return name;
  const firstUser = session.messages.find((m) => m.role === "user")?.content?.trim();
  if (firstUser) return firstUser.length > 60 ? `${firstUser.slice(0, 57)}…` : firstUser;
  return "Untitled build";
}

/** Short human badge for a session's status. */
export function sessionStatusBadge(session: BuilderSession): string {
  switch (session.status) {
    case "applied":  return "applied";
    case "archived": return "archived";
    default:         return "draft";
  }
}

/** Active drafts first, then applied, then archived. Stable within each group. */
export function orderSessions(sessions: BuilderSession[]): BuilderSession[] {
  const rank: Record<BuilderSession["status"], number> = { active: 0, applied: 1, archived: 2 };
  return sessions
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank[a.s.status] - rank[b.s.status] || a.i - b.i)
    .map((x) => x.s);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @journeyman/web -- sessions-view`
Expected: PASS.

---

## Task 4: Validation-aware Apply gate (`canApplyNow`)

The Phase 4 `canApply(plan)` only checks gaps. The spec requires Apply to also wait until validation passes after edits.

**Files:**
- Modify: `packages/web/src/routes/builder-state.ts`
- Modify: `packages/web/src/routes/builder-state.test.ts`

- [ ] **Step 1: Add the failing test** (append to `builder-state.test.ts`)

```typescript
import { canApplyNow } from "./builder-state.ts";
import type { FlowValidationReport } from "../api/flows.ts";

describe("canApplyNow", () => {
  const okPlan = { summary: "s", newCustomSteps: [], stepBindings: [], gaps: [],
    workflow: { schemaVersion: 2, nodes: [], edges: [] }, defaults: { sandboxId: null, model: null } } as never;
  const okReport: FlowValidationReport = { ok: true, errors: [], missing: [], warnings: [], secretWarnings: [] };
  const badReport: FlowValidationReport = { ok: false, errors: ["bad"], missing: [], warnings: [], secretWarnings: [] };

  it("allows apply when no validation has run yet (plan + no required gaps)", () => {
    expect(canApplyNow(okPlan, null)).toBe(true);
  });
  it("allows apply when validation passed", () => {
    expect(canApplyNow(okPlan, okReport)).toBe(true);
  });
  it("blocks apply when the latest validation failed", () => {
    expect(canApplyNow(okPlan, badReport)).toBe(false);
  });
  it("blocks apply with no plan", () => {
    expect(canApplyNow(null, okReport)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @journeyman/web -- builder-state`
Expected: FAIL — `canApplyNow` is not exported.

- [ ] **Step 3: Implement `canApplyNow`** (append to `builder-state.ts`)

```typescript
import type { FlowValidationReport } from "../api/flows.ts";

/**
 * Apply gate used after inline edits: a plan with no required gaps, and — if a
 * validation has run — a passing report. Null report ⇒ not yet validated, allowed.
 */
export function canApplyNow(plan: BuildPlan | null, validation: FlowValidationReport | null): boolean {
  if (!canApply(plan)) return false;
  return validation === null || validation.ok;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -w @journeyman/web -- builder-state`
Expected: PASS (existing + new cases).

---

## Task 5: `StepCard` component (editable step card)

Renders one `StepBinding` (+ its node) as an editable card: model field, tool toggles (AI steps), MCP & sandbox selects, secret slot mapping, inline gaps with a **Resolve** action, and a ⇄ inputs/outputs reveal. All edits call `onChange(nextPlan)` using the Task-2 editors; it never mutates the plan itself.

**Files:**
- Create: `packages/web/src/routes/StepCard.tsx`

- [ ] **Step 1: Write the component**

```tsx
// packages/web/src/routes/StepCard.tsx
import { useState } from "react";
import type { BuildPlan, CanonicalTool, Gap, StepBinding } from "@journeyman/core";
import { CANONICAL_TOOLS } from "@journeyman/core";
import {
  setStepModel, toggleStepTool, setStepMcpIds, setStepSandbox, mapSecretSlot, resolveGap,
} from "./plan-edits.ts";

export interface StepCardInventory {
  models: string[];
  mcps: { id: string; name: string }[];
  sandboxes: { id: string; name: string }[];
  secrets: string[];
}

export function StepCard(props: {
  plan: BuildPlan;
  binding: StepBinding;
  inventory: StepCardInventory;
  onChange: (next: BuildPlan) => void;
}) {
  const { plan, binding, inventory, onChange } = props;
  const id = binding.nodeId;
  const [showIo, setShowIo] = useState(false);
  const gaps = plan.gaps.filter((g) => g.nodeIds.includes(id));
  const isAi = binding.stepKind === "ai";
  const tools = (binding.uses.tools ?? []) as CanonicalTool[];

  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/40 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-slate-100">
          <span className="rounded bg-slate-800 px-1.5 text-xs text-slate-400">{binding.stepKind}</span>
          <span>{id}</span>
        </div>
        <button className="text-xs text-slate-400 hover:text-slate-200" onClick={() => setShowIo((v) => !v)}>
          ⇄ I/O
        </button>
      </div>

      {/* Inputs / outputs reveal (human-readable wiring) */}
      {showIo && (
        <div className="mt-2 rounded bg-slate-950/60 p-2 text-xs text-slate-300">
          {binding.io.inputs.length === 0 && binding.io.outputs.length === 0 ? (
            <span className="text-slate-500">No wired inputs or outputs.</span>
          ) : (
            <>
              {binding.io.inputs.map((inp) => (
                <div key={inp.name}>← <b>{inp.name}</b> from {inp.from}</div>
              ))}
              {binding.io.outputs.map((out) => (
                <div key={out.name}>→ <b>{out.name}</b> ({out.type})</div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Model (AI steps) */}
      {isAi && (
        <label className="mt-2 block text-xs text-slate-400">
          Model
          <input
            list={`models-${id}`}
            className="mt-1 w-full rounded bg-slate-800 px-2 py-1 text-sm text-slate-100"
            defaultValue={binding.uses.model ?? ""}
            placeholder="(workflow default)"
            onBlur={(e) => onChange(setStepModel(plan, id, e.target.value))}
          />
          <datalist id={`models-${id}`}>
            {inventory.models.map((m) => <option key={m} value={m} />)}
          </datalist>
        </label>
      )}

      {/* Tools (AI steps) */}
      {isAi && (
        <div className="mt-2">
          <div className="text-xs text-slate-400">Tools</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {CANONICAL_TOOLS.map((t) => {
              const on = tools.includes(t);
              return (
                <button key={t}
                  className={on
                    ? "rounded bg-indigo-500/30 px-2 py-0.5 text-xs text-indigo-200"
                    : "rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400"}
                  onClick={() => onChange(toggleStepTool(plan, id, t))}>
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* MCPs (AI steps) */}
      {isAi && inventory.mcps.length > 0 && (
        <label className="mt-2 block text-xs text-slate-400">
          MCP
          <select
            className="mt-1 w-full rounded bg-slate-800 px-2 py-1 text-sm text-slate-100"
            value={(binding.uses.mcpIds ?? [])[0] ?? ""}
            onChange={(e) => onChange(setStepMcpIds(plan, id, e.target.value ? [e.target.value] : []))}>
            <option value="">(none)</option>
            {inventory.mcps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
      )}

      {/* Sandbox (any step) */}
      {inventory.sandboxes.length > 0 && (
        <label className="mt-2 block text-xs text-slate-400">
          Sandbox
          <select
            className="mt-1 w-full rounded bg-slate-800 px-2 py-1 text-sm text-slate-100"
            value={binding.uses.sandboxId ?? ""}
            onChange={(e) => onChange(setStepSandbox(plan, id, e.target.value || null))}>
            <option value="">(workflow default)</option>
            {inventory.sandboxes.map((sb) => <option key={sb.id} value={sb.id}>{sb.name}</option>)}
          </select>
        </label>
      )}

      {/* Secret slots */}
      {(binding.uses.secrets ?? []).map((sec) => (
        <label key={sec.slot} className="mt-2 block text-xs text-slate-400">
          Secret · <code className="text-slate-300">{sec.slot}</code>
          <select
            className="mt-1 w-full rounded bg-slate-800 px-2 py-1 text-sm text-slate-100"
            value={sec.secretName ?? ""}
            onChange={(e) => onChange(mapSecretSlot(plan, id, sec.slot, e.target.value || null))}>
            <option value="">(unmapped)</option>
            {inventory.secrets.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
      ))}

      {/* Inline gaps on this step */}
      {gaps.map((g: Gap) => (
        <div key={g.id} className="mt-2 flex items-center justify-between rounded border border-amber-900/40 bg-amber-950/30 px-2 py-1 text-xs text-amber-200/90">
          <span>{g.required ? "⚠️ " : "• "}{g.reason}</span>
          <button className="rounded bg-amber-500/20 px-2 py-0.5 text-amber-200 hover:bg-amber-500/30"
            onClick={() => onChange(resolveGap(plan, g.id))}>
            Resolve
          </button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS.

---

## Task 6: `SessionsSidebar` component

**Files:**
- Create: `packages/web/src/routes/SessionsSidebar.tsx`

- [ ] **Step 1: Write the component**

```tsx
// packages/web/src/routes/SessionsSidebar.tsx
import type { BuilderSession } from "../api/builder.ts";
import { sessionLabel, sessionStatusBadge, orderSessions } from "./sessions-view.ts";

export function SessionsSidebar(props: {
  sessions: BuilderSession[];
  activeId: string | null;
  onNew: () => void;
  onResume: (s: BuilderSession) => void;
  onDelete: (s: BuilderSession) => void;
}) {
  const { sessions, activeId, onNew, onResume, onDelete } = props;
  return (
    <div className="flex w-56 flex-col border-r border-slate-800 pr-3">
      <button
        className="mb-3 rounded-md bg-indigo-500/20 px-3 py-2 text-sm text-indigo-200 hover:bg-indigo-500/30"
        onClick={onNew}>
        + New build
      </button>
      <div className="flex-1 space-y-1 overflow-y-auto">
        {sessions.length === 0 && <div className="px-2 py-1 text-xs text-slate-500">No past builds yet.</div>}
        {orderSessions(sessions).map((s) => (
          <div key={s.id}
            className={`group flex items-center justify-between rounded px-2 py-1.5 text-sm ${
              s.id === activeId ? "bg-slate-800 text-slate-100" : "text-slate-300 hover:bg-slate-800/60"}`}>
            <button className="min-w-0 flex-1 truncate text-left" onClick={() => onResume(s)} title={sessionLabel(s)}>
              <span className="truncate">{sessionLabel(s)}</span>
              <span className="ml-1 text-[10px] uppercase text-slate-500">{sessionStatusBadge(s)}</span>
            </button>
            <button
              className="ml-1 hidden text-slate-500 hover:text-rose-300 group-hover:inline"
              title="Delete" onClick={() => onDelete(s)}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS.

---

## Task 7: Wire it all into `BuilderPage`

Integrate the sidebar (list/new/resume/delete), editable step cards, inventory dropdowns (React Query), a debounced **persist (`PATCH buildPlan`) + re-validate** effect on plan edits, and the new `canApplyNow` gate. Resume loads a session's messages + plan into state.

**Files:**
- Modify: `packages/web/src/routes/BuilderPage.tsx`

- [ ] **Step 1: Replace the file with the wired version**

```tsx
// packages/web/src/routes/BuilderPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { BuildPlan } from "@journeyman/core";
import { useAuth } from "../AuthContext.tsx";
import {
  createBuilderSession, applyBuilderPlan, streamBuilderChat,
  listBuilderSessions, patchBuilderSession, deleteBuilderSession,
  type BuilderSession,
} from "../api/builder.ts";
import { validateFlowDefinition, type FlowValidationReport } from "../api/flows.ts";
import { codingModelsApi } from "../api/codingModels.ts";
import { mcpApi } from "../api/mcp.ts";
import { sandboxesApi } from "../api/sandboxes.ts";
import { fetchVisibleSecrets } from "../api/secrets.ts";
import { reduceChatEvent, canApplyNow, type BuilderChatState, type ChatMsg } from "./builder-state.ts";
import { StepCard, type StepCardInventory } from "./StepCard.tsx";
import { SessionsSidebar } from "./SessionsSidebar.tsx";
import { setDefaultModel, setDefaultSandbox } from "./plan-edits.ts";
import { btnPrimary, card, inputCls } from "./admin-styles.ts";

const EMPTY: BuilderChatState = { messages: [], plan: null, error: null, streaming: false };

export function BuilderPage() {
  const { activeOrgId } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [state, setState] = useState<BuilderChatState>(EMPTY);
  const [sending, setSending] = useState(false);
  const [appliedFlowId, setAppliedFlowId] = useState<string | null>(null);
  const [validation, setValidation] = useState<FlowValidationReport | null>(null);

  // --- Sessions list ---
  const sessionsQ = useQuery({
    queryKey: ["builder-sessions", activeOrgId],
    queryFn: () => listBuilderSessions(activeOrgId!),
    enabled: !!activeOrgId,
  });

  // --- Inventory for the edit dropdowns ---
  const inventory = useInventory(activeOrgId);

  const plan = state.plan;

  // --- Debounced persist + re-validate whenever the edited plan changes ---
  const debTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!plan || !activeOrgId || !sessionId) return;
    if (debTimer.current) clearTimeout(debTimer.current);
    debTimer.current = setTimeout(() => {
      void patchBuilderSession(activeOrgId, sessionId, { buildPlan: plan }).catch(() => {});
      void validateFlowDefinition(plan.workflow).then(setValidation).catch(() => setValidation(null));
    }, 500);
    return () => { if (debTimer.current) clearTimeout(debTimer.current); };
  }, [plan, activeOrgId, sessionId]);

  const applyM = useMutation({
    mutationFn: async () => {
      if (!activeOrgId || !sessionId) throw new Error("no session");
      return applyBuilderPlan(activeOrgId, sessionId);
    },
    onSuccess: (r) => { setAppliedFlowId(r.workflowId); void sessionsQ.refetch(); },
  });

  function resetToNew() {
    setSessionId(null);
    setState(EMPTY);
    setAppliedFlowId(null);
    setValidation(null);
    setInput("");
  }

  function resume(s: BuilderSession) {
    setSessionId(s.id);
    setState({ messages: s.messages as ChatMsg[], plan: s.buildPlan, error: null, streaming: false });
    setAppliedFlowId(s.appliedFlowId);
    setValidation(null);
  }

  async function remove(s: BuilderSession) {
    if (!activeOrgId) return;
    await deleteBuilderSession(activeOrgId, s.id).catch(() => {});
    if (s.id === sessionId) resetToNew();
    void sessionsQ.refetch();
  }

  async function send() {
    const message = input.trim();
    if (!message || !activeOrgId || sending) return;
    setInput("");
    setState((s) => ({ ...s, messages: [...s.messages, { role: "user", content: message } as ChatMsg], error: null, streaming: true }));
    setSending(true);
    try {
      let id = sessionId;
      if (!id) {
        const created = await createBuilderSession(activeOrgId, message.slice(0, 60));
        id = created.id;
        setSessionId(id);
        void sessionsQ.refetch();
      }
      await streamBuilderChat({
        orgId: activeOrgId, sessionId: id, message,
        onEvent: (ev) => setState((s) => reduceChatEvent(s, ev)),
      });
    } catch (e) {
      setState((s) => ({ ...s, error: (e as Error).message, streaming: false }));
    } finally {
      setSending(false);
    }
  }

  function onPlanChange(next: BuildPlan) {
    setState((s) => ({ ...s, plan: next }));
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] gap-4 p-4">
      <SessionsSidebar
        sessions={sessionsQ.data ?? []}
        activeId={sessionId}
        onNew={resetToNew}
        onResume={resume}
        onDelete={(s) => void remove(s)}
      />

      {/* Chat */}
      <div className="flex w-2/5 flex-col">
        <h1 className="mb-3 text-lg font-medium text-slate-100">Builder</h1>
        <div className="flex-1 space-y-3 overflow-y-auto pr-2">
          {state.messages.map((m, i) => (
            <div key={i} className={m.role === "user"
              ? "ml-auto max-w-[85%] rounded-md bg-indigo-500/20 px-3 py-2 text-sm text-slate-100"
              : "mr-auto max-w-[85%] rounded-md bg-slate-800/70 px-3 py-2 text-sm text-slate-200"}>
              {m.content}
            </div>
          ))}
          {state.error && <div className="text-sm text-rose-300">Error: {state.error}</div>}
          {state.streaming && <div className="text-xs text-slate-500">…thinking</div>}
        </div>
        <div className="mt-3 flex gap-2">
          <input className={inputCls} placeholder="Describe the workflow you want…"
            value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void send(); }} disabled={sending} />
          <button className={btnPrimary} onClick={() => void send()} disabled={sending || !input.trim()}>Send</button>
        </div>
      </div>

      {/* Plan preview + editing */}
      <div className={`flex-1 overflow-y-auto p-4 ${card}`}>
        {!plan ? (
          <div className="p-10 text-center text-sm text-slate-500">
            Describe a goal on the left and the plan will appear here.
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="font-medium text-slate-100">Plan preview</p>
              <p className="text-sm text-slate-300">{plan.summary}</p>
            </div>

            {/* Workflow defaults */}
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-400">
                Default model
                <input className="mt-1 w-full rounded bg-slate-800 px-2 py-1 text-sm text-slate-100"
                  list="default-models" defaultValue={plan.defaults.model ?? ""}
                  placeholder="(system default)"
                  onBlur={(e) => onPlanChange(setDefaultModel(plan, e.target.value))} />
                <datalist id="default-models">
                  {inventory.models.map((m) => <option key={m} value={m} />)}
                </datalist>
              </label>
              <label className="text-xs text-slate-400">
                Default sandbox
                <select className="mt-1 w-full rounded bg-slate-800 px-2 py-1 text-sm text-slate-100"
                  value={plan.defaults.sandboxId ?? ""}
                  onChange={(e) => onPlanChange(setDefaultSandbox(plan, e.target.value || null))}>
                  <option value="">(none)</option>
                  {inventory.sandboxes.map((sb) => <option key={sb.id} value={sb.id}>{sb.name}</option>)}
                </select>
              </label>
            </div>

            {/* Editable step cards */}
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-slate-500">Steps</p>
              {plan.stepBindings.map((b) => (
                <StepCard key={b.nodeId} plan={plan} binding={b} inventory={inventory} onChange={onPlanChange} />
              ))}
            </div>

            {/* Gap footer + validation */}
            {plan.gaps.length > 0 && (
              <div className="text-xs text-amber-300/90">
                {plan.gaps.filter((g) => g.required).length} required ·{" "}
                {plan.gaps.filter((g) => !g.required).length} optional gap(s) remaining
              </div>
            )}
            {validation && !validation.ok && (
              <div className="text-xs text-rose-300">
                Validation: {validation.errors.concat(validation.missing).join("; ") || "failed"}
              </div>
            )}

            {appliedFlowId ? (
              <a className={btnPrimary} href={`/workflows/${appliedFlowId}/edit`}>Open the draft flow →</a>
            ) : (
              <button className={btnPrimary} disabled={!canApplyNow(plan, validation) || applyM.isPending}
                onClick={() => applyM.mutate()}>
                {applyM.isPending ? "Applying…" : "Apply"}
              </button>
            )}
            {applyM.isError && <p className="text-sm text-rose-300">{(applyM.error as Error).message}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

/** Load the edit dropdowns' option data. Failures degrade to empty lists. */
function useInventory(orgId: string | null): StepCardInventory {
  const models = useQuery({
    queryKey: ["coding-models", "claude"],
    queryFn: () => codingModelsApi.list("claude"),
    enabled: !!orgId,
  });
  const mcps = useQuery({
    queryKey: ["builder-mcps", orgId],
    queryFn: () => mcpApi.listMy(orgId!),
    enabled: !!orgId,
  });
  const sandboxes = useQuery({
    queryKey: ["builder-sandboxes", orgId],
    queryFn: () => sandboxesApi.listVisible(orgId!),
    enabled: !!orgId,
  });
  const secrets = useQuery({
    queryKey: ["builder-secrets", orgId],
    queryFn: () => fetchVisibleSecrets(orgId!),
    enabled: !!orgId,
  });
  return useMemo<StepCardInventory>(() => ({
    models: (models.data ?? []).map((m) => m.modelId),
    mcps: (mcps.data ?? []).map((m) => ({ id: m.id, name: m.name })),
    sandboxes: (sandboxes.data ?? []).map((s) => ({ id: s.id, name: s.name })),
    secrets: (secrets.data ?? []).map((s) => s.name),
  }), [models.data, mcps.data, sandboxes.data, secrets.data]);
}
```

> **Note on `m.modelId`:** confirm the `CodingModel` field name during Step 2; if the type uses `model_id` or `name`, adjust the `.map((m) => m.modelId)` accordingly (this is the only field reference not yet verified against `@journeyman/core`).

- [ ] **Step 2: Typecheck the web package**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS. If the `CodingModel` model-id field differs, fix the one `.map` and re-run.

- [ ] **Step 3: Run the full web test suite**

Run: `npm test -w @journeyman/web`
Expected: PASS — `plan-edits`, `sessions-view`, `builder-state`, `sse-parse`.

---

## Task 8: Browser-preview verification

The web package has no jsdom; verify the UI behaves in the running app.

- [ ] **Step 1: Ensure the dev server is up** (preview_start if needed; `@journeyman/web` runs on :5173, proxying `/api` → :4000). Navigate to `/builder`.

- [ ] **Step 2: Verify the sessions sidebar** — `preview_snapshot`: the "+ New build" button and any past sessions render; hovering a row reveals the ✕ delete control.

- [ ] **Step 3: Verify editing** — with a plan present (resume a session that has a `buildPlan`, or run one chat turn): `preview_click` a tool chip and `preview_snapshot` to confirm it toggles highlighted; change the model field and confirm no console errors (`preview_console_logs`).

- [ ] **Step 4: Verify the ⇄ reveal** — `preview_click` the "⇄ I/O" button on a step card; `preview_snapshot` shows the human-readable inputs/outputs (or "No wired inputs or outputs").

- [ ] **Step 5: Verify gap resolve + Apply gate** — `preview_click` a gap's **Resolve**; confirm it disappears and (once required gaps are gone and validation is ok) the **Apply** button enables. Capture a `preview_screenshot` of the edited preview pane as proof.

---

## Task 9: Final type + boundary check

- [ ] **Step 1: Run the repo-wide check**

Run: `npm run check`
Expected: PASS — typecheck (all workspaces) + import boundaries clean.

---

## Self-Review (completed during authoring)

- **Spec coverage:** editable step cards (Task 5), ⇄ I/O reveal (Task 5), inline gaps + footer total (Tasks 5/7), secrets-by-name (Task 5 `mapSecretSlot`), Apply gated on validation + required gaps (Task 4 `canApplyNow`), sessions list/resume/delete (Tasks 1/3/6/7), model/MCP/sandbox quick-swaps + defaults (Tasks 2/5/7). Deep edits explicitly deferred to the editor (scope guard).
- **Placeholder scan:** none — every code step is complete. The single unverified field (`CodingModel.modelId`) is called out with a fix instruction in Task 7.
- **Type consistency:** editor names (`setStepModel`/`toggleStepTool`/`setStepMcpIds`/`setStepSandbox`/`mapSecretSlot`/`setDefaultModel`/`setDefaultSandbox`/`resolveGap`) match across `plan-edits.ts`, `StepCard.tsx`, and `BuilderPage.tsx`. `StepCardInventory` shape matches `useInventory`'s return and `StepCard`'s prop. `BuilderSession` reused from `api/builder.ts` everywhere. `canApplyNow` signature matches its test and the page call site.
