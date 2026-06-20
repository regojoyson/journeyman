# Agent Log Level Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-agent `agentLogLevel` setting (none/light/medium/all, default medium) that controls how much coding-CLI transcript streams to agent run logs, mirroring the existing workflow-step picker.

**Architecture:** Add one optional field to the `Agent` type (stored in the existing `definition` JSONB — no DB migration), expose it as a `<select>` in the editor's Behavior section, emit it from the agent→graph compiler, and have the `agent-run` step handler resolve it and pass `{ onLog, agentLogLevel }` into `runCustomPrompt` (reusing the shared `resolveAgentLogLevel` helper). Works across local/docker/windows sandboxes for free — the change is at the `runCustomPrompt` call site, above the transport layer.

**Tech Stack:** TypeScript, React, npm workspaces monorepo; existing `AgentLogLevel` type and `resolveAgentLogLevel` helper.

**Execution constraints (per user):** Work on `master`. **No commits** — leave changes in the working tree. Run a single `npm run typecheck` at the very end instead of per-task commits/test runs. Each task's "verify" step is folded into the final typecheck.

**Spec:** [docs/superpowers/specs/2026-06-21-agent-log-level-design.md](../specs/2026-06-21-agent-log-level-design.md)

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/core/src/types/agent.types.ts` | Agent data model | Add `agentLogLevel?: AgentLogLevel` field + import |
| `packages/web/src/components/agents/sections/BehaviorSection.tsx` | Agent editor Behavior UI | Add Log level `<select>` after Output mode |
| `packages/web/src/components/agents/agent-form.ts` | Per-section dirty/save mapping | Add `agentLogLevel` to `SECTION_FIELDS.behavior` |
| `packages/agents/src/compile.ts` | Agent → WorkflowGraph compiler | Emit `agentLogLevel` into agent-run step config |
| `packages/orchestrator/src/workers/steps/agent-run-step-handler.ts` | agent-run runtime | Resolve + pass `onLog`/`agentLogLevel` to `runCustomPrompt` |

Reused unchanged: `AgentLogLevel` (`packages/core/src/types/coding.types.ts`), `resolveAgentLogLevel` (`packages/orchestrator/src/workers/steps/agent-log-level.ts`).

---

## Task 1: Add `agentLogLevel` to the Agent type

**Files:**
- Modify: `packages/core/src/types/agent.types.ts`

- [ ] **Step 1: Confirm `AgentLogLevel` is importable in this file**

Run: `grep -n "AgentLogLevel" packages/core/src/types/coding.types.ts`
Expected: a line like `export type AgentLogLevel = "none" | "light" | "medium" | "all";`

- [ ] **Step 2: Ensure the type is in scope in agent.types.ts**

Check the top of `packages/core/src/types/agent.types.ts` for existing imports from `./coding.types.ts` (e.g. `CanonicalTool`, `CodingModelConfig`). If there is already an import from `./coding.types.ts`, add `AgentLogLevel` to it. Otherwise add:

```ts
import type { AgentLogLevel } from "./coding.types.ts";
```

(Match the existing import style in the file — relative path with `.ts` extension and `import type`.)

- [ ] **Step 3: Add the field to the `Agent` interface**

In the `Agent` interface, add the field near `outputMode` (execution/behavior grouping):

```ts
  /** How much coding-CLI transcript streams to run logs. Default "medium". */
  agentLogLevel?: AgentLogLevel;
```

Verification deferred to the final typecheck (Task 6). `AgentUpdateInput` derives from `Agent`, so it picks up the field automatically — no separate change.

---

## Task 2: Add the Log level picker to the Behavior section

**Files:**
- Modify: `packages/web/src/components/agents/sections/BehaviorSection.tsx`

- [ ] **Step 1: Confirm the `Agent`/`AgentUpdateInput` import already exists**

The file imports `import type { Agent, AgentUpdateInput } from "@journeyman/core";` at the top. `AgentLogLevel` is also exported from `@journeyman/core`. Add `AgentLogLevel` to that import:

```ts
import type { Agent, AgentUpdateInput, AgentLogLevel } from "@journeyman/core";
```

- [ ] **Step 2: Add the Log level `<select>` after the Output mode block**

Locate the Output mode `<div>` (the block containing `value={a.outputMode}`, ending at its closing `</div>` before the `<div className="pt-4 border-t">` safety-limits block). Insert this new block immediately after the Output mode `</div>`:

```tsx
      <div>
        <FieldLabel help="How much of the agent transcript is streamed to run logs">Log level</FieldLabel>
        <select
          className={inputCls}
          disabled={locked}
          value={a.agentLogLevel ?? "medium"}
          onChange={(e) => patch({ agentLogLevel: e.target.value as AgentLogLevel })}
        >
          <option value="none">None — no agent SDK logs</option>
          <option value="light">Light — only final result line</option>
          <option value="medium">Medium — result + tool calls</option>
          <option value="all">All — full transcript</option>
        </select>
      </div>
```

This matches the existing Output mode markup (`inputCls`, `disabled={locked}`, `FieldLabel`). Default display is `"medium"` when the field is unset.

---

## Task 3: Wire the field into per-section save

**Files:**
- Modify: `packages/web/src/components/agents/agent-form.ts`

- [ ] **Step 1: Inspect the current `SECTION_FIELDS.behavior` entry**

Run: `grep -n "behavior:" packages/web/src/components/agents/agent-form.ts`
Expected: a line like `  behavior:     ["behavior", "limits", "outputMode"],`

- [ ] **Step 2: Add `agentLogLevel` to the behavior field list**

Change the `behavior` entry in the `SECTION_FIELDS` map to include `agentLogLevel`:

```ts
  behavior:     ["behavior", "limits", "outputMode", "agentLogLevel"],
```

This makes `isSectionDirty("behavior")` detect changes to the field and `buildSectionUpdateInput("behavior")` include it when saving the Behavior section. Match the existing alignment/spacing of the surrounding entries.

---

## Task 4: Emit `agentLogLevel` from the agent compiler

**Files:**
- Modify: `packages/agents/src/compile.ts`

- [ ] **Step 1: Locate the agent-run step config object**

Run: `grep -n "stepType: \"agent-run\"\|outputMode:\|maxSteps:\|config:" packages/agents/src/compile.ts`
Expected: the `config: { ... }` object that includes `outputMode: agent.outputMode`, `maxSteps: agent.behavior.maxTurns`, `timeoutSeconds: agent.behavior.timeoutSeconds`.

- [ ] **Step 2: Add `agentLogLevel` to that config object**

Inside the `config: { ... }` object (next to `outputMode`), add:

```ts
          agentLogLevel: agent.agentLogLevel ?? "medium",
```

Because the compiler always emits a concrete value, the handler's `resolveAgentLogLevel` fallback (`"none"`) never applies to agents — absent agent config becomes `"medium"` here.

---

## Task 5: Consume `agentLogLevel` in the agent-run handler

**Files:**
- Modify: `packages/orchestrator/src/workers/steps/agent-run-step-handler.ts`

- [ ] **Step 1: Add the import for `resolveAgentLogLevel`**

Confirm sibling handlers import it: `grep -n "resolveAgentLogLevel" packages/orchestrator/src/workers/steps/custom-ai-step-handler.ts`
Expected: `import { resolveAgentLogLevel } from "./agent-log-level.ts";`

Add the same import to `agent-run-step-handler.ts` (place it alongside the other `./` step imports, matching their `.ts` extension style):

```ts
import { resolveAgentLogLevel } from "./agent-log-level.ts";
```

- [ ] **Step 2: Resolve the level before the `runCustomPrompt` call**

Find the `const result = await coding.runCustomPrompt({` call (around line 166). Immediately before it, add:

```ts
    const agentLogLevel = resolveAgentLogLevel(input.agentLogLevel);
```

- [ ] **Step 3: Pass `onLog`/`agentLogLevel` into the call**

Inside the `runCustomPrompt({ ... })` argument object, add this as the final property (after `...(maxSteps ? { maxSteps } : {})`), matching the `custom-ai-step-handler` pattern exactly:

```ts
      ...(agentLogLevel !== "none" ? { onLog: ctx.log, agentLogLevel } : {}),
```

This passes logs to `ctx.log` only when the level is not `none`. Across local/docker/windows sandboxes the `SandboxInstanceCodingProvider` (already used when `ctx.exec` is set) forwards `onLog` over the appropriate transport — no backend-specific change needed.

---

## Task 6: Final typecheck

**Files:** none (verification only)

- [ ] **Step 1: Run the workspace typecheck**

Run: `npm run typecheck`
Expected: PASS with no errors. In particular, no errors about `agentLogLevel` being unknown on `Agent`/`AgentUpdateInput`, and no unused-import errors in the three modified TS/TSX files.

- [ ] **Step 2: If errors appear, fix them in place**

Common fixes: ensure `AgentLogLevel` is imported in both `agent.types.ts` and `BehaviorSection.tsx`; ensure the `compile.ts` value is one of the literal union members; ensure `resolveAgentLogLevel` import path uses the `.ts` extension to match sibling files.

- [ ] **Step 3: Leave changes uncommitted**

Per the user's instruction, do **not** commit. Run `git status` to confirm the five files show as modified and report the final typecheck result.

---

## Self-Review Notes

- **Spec coverage:** All five spec changes (type, UI, section-save, compile, handler) map to Tasks 1–5; sandbox compatibility is covered by Task 5 reusing the existing transport (no new code, as the spec concluded). Default `medium` is enforced in two places: UI display (Task 2) and compile emission (Task 4).
- **No DB migration:** field lives in `definition` JSONB — confirmed in spec; no migration task needed.
- **Type consistency:** `agentLogLevel` and `AgentLogLevel` used identically across Tasks 1, 2, 4, 5; `resolveAgentLogLevel` signature matches the sibling handlers.
- **Deviation from default plan format:** per the user, per-task commits and per-task test runs are replaced by a single end-of-plan typecheck (Task 6); work stays on `master` uncommitted.
