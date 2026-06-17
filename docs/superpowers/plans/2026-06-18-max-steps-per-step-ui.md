# Max Steps — Per-Step UI Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Max steps" number field to the properties panel for custom-AI steps, writing to `config.maxSteps`.

**Architecture:** A single field in `ConfigTab.tsx`, gated to custom-AI (`runCustomPrompt`) coding-CLI steps, beside the existing "Agent log level" field. The value-coercion logic is extracted into a pure exported helper so it can be unit-tested in the flow-editor's logic-test style (no DOM). The backend/worker/sandbox path that carries `config.maxSteps` to the model loop already exists and is verified — this plan adds only the UI.

**Tech Stack:** React (TSX), Vitest (pure-logic tests, no testing-library).

**Spec:** `docs/superpowers/specs/2026-06-18-max-steps-per-step-ui-design.md`

---

### Task 1: Pure coercion helper `nextMaxStepsConfig`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/ConfigTab.tsx` (add exported helper near top, after imports)
- Test: `packages/flow-editor/src/properties-panel/ConfigTab.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/flow-editor/src/properties-panel/ConfigTab.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { nextMaxStepsConfig } from "./ConfigTab.tsx";

describe("nextMaxStepsConfig", () => {
  it("stores a positive integer", () => {
    expect(nextMaxStepsConfig({}, "200")).toEqual({ maxSteps: 200 });
  });

  it("floors a decimal", () => {
    expect(nextMaxStepsConfig({}, "12.9")).toEqual({ maxSteps: 12 });
  });

  it("removes the key when cleared", () => {
    expect(nextMaxStepsConfig({ maxSteps: 50 }, "")).toEqual({});
  });

  it("removes the key for zero, negative, or non-numeric input", () => {
    expect(nextMaxStepsConfig({ maxSteps: 50 }, "0")).toEqual({});
    expect(nextMaxStepsConfig({ maxSteps: 50 }, "-5")).toEqual({});
    expect(nextMaxStepsConfig({ maxSteps: 50 }, "abc")).toEqual({});
  });

  it("preserves other config keys", () => {
    expect(nextMaxStepsConfig({ agentLogLevel: "all" }, "30")).toEqual({
      agentLogLevel: "all",
      maxSteps: 30,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/flow-editor/src/properties-panel/ConfigTab.test.ts`
Expected: FAIL — `nextMaxStepsConfig is not a function` (export does not exist yet).

- [ ] **Step 3: Add the helper**

In `packages/flow-editor/src/properties-panel/ConfigTab.tsx`, after the imports and before the `ConfigTab` component, add:

```ts
/**
 * Compute the next node config when the "Max steps" field changes.
 * Blank / non-numeric / `< 1` removes the key (revert to the provider default);
 * a positive value is stored as a floored integer. Other config keys are kept.
 */
export function nextMaxStepsConfig(
  config: Record<string, unknown>,
  raw: string,
): Record<string, unknown> {
  const next = { ...config };
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n) || n < 1) {
    delete next.maxSteps;
  } else {
    next.maxSteps = Math.floor(n);
  }
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/flow-editor/src/properties-panel/ConfigTab.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/flow-editor/src/properties-panel/ConfigTab.tsx packages/flow-editor/src/properties-panel/ConfigTab.test.ts
git commit -m "feat(flow-editor): add nextMaxStepsConfig helper for per-step max-steps"
```

---

### Task 2: Render the "Max steps" field

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/ConfigTab.tsx` (add JSX block immediately after the "Agent log level" field, which ends at the closing `)}` of its `definition?.executor.kind === "coding-cli" && [...].includes(...)` block)

- [ ] **Step 1: Add the field JSX**

In `ConfigTab.tsx`, immediately **after** the closing `)}` of the existing "Agent log level" block (the block whose label is `Agent log level`), insert:

```tsx
{definition?.executor.kind === "coding-cli"
  && definition.executor.method === "runCustomPrompt" && (
  <div className="je-props__field">
    <label>Max steps</label>
    <input
      type="number"
      min={1}
      step={1}
      placeholder="Default (80)"
      value={(config.maxSteps as number | undefined) ?? ""}
      disabled={readOnly}
      onChange={e => onChange({ ...node, config: nextMaxStepsConfig(config, e.target.value) })}
    />
    <div className="je-props__field-help">
      Most steps the agent can take (tool calls + replies) before it&apos;s stopped.
      Leave blank for the default (80). Raise it for big implementation steps; lower
      it to keep small steps cheap.
    </div>
  </div>
)}
```

Note: the gate is intentionally narrower than the Agent-log-level gate — only
`runCustomPrompt` honors `config.maxSteps` (see spec Non-Goals).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean (no `error TS` lines). `config`, `node`, `onChange`, `definition`, `readOnly` are all already in scope in `ConfigTab`; `nextMaxStepsConfig` is defined in Task 1.

- [ ] **Step 3: Run flow-editor tests**

Run: `npx vitest run packages/flow-editor`
Expected: PASS (all existing tests plus the 5 from Task 1).

- [ ] **Step 4: Visual verification (web preview)**

Start the web app and open a flow with a custom-AI step; confirm the properties
panel shows a "Max steps" field below "Agent log level", with placeholder
`Default (80)`. Confirm the field is **absent** for a non-custom-AI step (e.g. a
"Clone Repos" or "Get Issue" node). Capture a screenshot as proof.

(If the preview cannot be run in this environment, note that and rely on the
typecheck + tests; the gating is a literal boolean over `definition.executor`.)

- [ ] **Step 5: Commit**

```bash
git add packages/flow-editor/src/properties-panel/ConfigTab.tsx
git commit -m "feat(flow-editor): expose per-step Max steps field for custom-AI steps"
```

---

## Self-Review

- **Spec coverage:**
  - "Location & gating" → Task 2 Step 1 (gate on `coding-cli` + `runCustomPrompt`). ✓
  - "Field behavior" (number, empty=default, delete on invalid, floor, disabled) → Task 1 helper + Task 2 input props. ✓
  - "Help text" → Task 2 Step 1 help div. ✓
  - "Data flow / sandbox" → no code (verified pre-existing); no task needed. ✓
  - "Testing" items 1–3 → Task 1 tests. Item 4 (renders only for runCustomPrompt) → not unit-testable without DOM; covered by Task 2 Step 4 visual check + the literal gate. ✓ (documented, not a gap)
- **Placeholder scan:** none — all steps contain concrete code/commands.
- **Type consistency:** helper name `nextMaxStepsConfig` is identical in Task 1 (definition + test) and Task 2 (usage). Field key `maxSteps` consistent with `RunCustomPromptOptions.maxSteps` and `config.maxSteps`.
