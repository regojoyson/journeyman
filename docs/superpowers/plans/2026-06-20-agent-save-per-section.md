# Agent Per-Section Save & Enable Validation Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single top-right "Save changes" button with per-section save footers, and surface structured readiness errors as a clickable banner when enabling an agent fails.

**Architecture:** All state continues to live in `AgentDetail` (parent). New utilities in `agent-form.ts` determine which fields each section owns and whether they differ from the saved copy. Each section's save sends only its fields to the API and merges the result back without clobbering in-flight edits in other sections. Enable errors come from the server as a structured array; a custom inline handler on `agentsApi.enable()` preserves them so the banner can link directly to the broken tab.

**Tech Stack:** React 18, TypeScript, Tailwind v4, Vitest, `@journeyman/core` types

**Branch:** master (work directly, no worktree)

**No commits.** Typecheck runs at the very end.

---

## File Map

| Action | Path |
|---|---|
| Modify | `packages/web/src/components/agents/agent-form.ts` |
| Create | `packages/web/src/components/agents/agent-form.test.ts` |
| Modify | `packages/web/src/api/agents.ts` |
| Modify | `packages/web/src/components/agents/sections/SectionNav.tsx` |
| Modify | `packages/web/src/components/agents/AgentDetail.tsx` |

---

## Task 1: Section utilities in `agent-form.ts`

**Files:**
- Modify: `packages/web/src/components/agents/agent-form.ts`

- [ ] **Step 1: Open the file and append the three new exports**

  Current file ends after `statusLabel`. Add below `statusLabel`:

  ```typescript
  import type { SectionId } from "./sections/SectionNav.tsx";
  ```

  Add this import at the top of the file (alongside the existing `import type { Agent, AgentUpdateInput } from "@journeyman/core"`):

  ```typescript
  import type { Agent, AgentUpdateInput } from "@journeyman/core";
  import type { SectionId } from "./sections/SectionNav.tsx";
  ```

  Then append at the bottom of the file:

  ```typescript
  /** Which Agent fields each section owns. Keys are the saveable sections only. */
  const SECTION_FIELDS: Partial<Record<SectionId, readonly (keyof Agent)[]>> = {
    instructions: ["instructions", "inputs"],
    workspace:    ["provider", "model", "sandboxId", "repoSelections"],
    triggers:     ["triggers"],
    behavior:     ["behavior", "limits", "outputMode"],
    permissions:  ["permissions", "tools"],
    notifications:["notifications"],
  };

  /** Section IDs that have a save action (Runs and Delete are excluded). */
  export const SAVEABLE_SECTION_IDS: readonly SectionId[] = [
    "instructions", "workspace", "triggers", "behavior", "permissions", "notifications",
  ];

  /** True when any of the section's owned fields differ between original and current. */
  export function isSectionDirty(original: Agent, current: Agent, section: SectionId): boolean {
    const fields = SECTION_FIELDS[section] ?? [];
    return fields.some((f) => JSON.stringify(original[f]) !== JSON.stringify(current[f]));
  }

  /** Extract only a section's owned fields as an AgentUpdateInput for the PATCH body. */
  export function buildSectionUpdateInput(a: Agent, section: SectionId): AgentUpdateInput {
    const fields = SECTION_FIELDS[section] ?? [];
    return Object.fromEntries(fields.map((f) => [f, a[f]])) as AgentUpdateInput;
  }
  ```

---

## Task 2: Tests for section utilities

**Files:**
- Create: `packages/web/src/components/agents/agent-form.test.ts`

- [ ] **Step 1: Write failing tests**

  Create `packages/web/src/components/agents/agent-form.test.ts`:

  ```typescript
  import { describe, it, expect } from "vitest";
  import type { Agent } from "@journeyman/core";
  import { isSectionDirty, buildSectionUpdateInput } from "./agent-form.ts";

  const base: Agent = {
    id: "a1",
    workspaceId: "ws1",
    orgId: "org1",
    name: "Test",
    instructions: "Do something",
    inputs: [],
    provider: "claude",
    model: "claude-sonnet-4-5",
    connectorMcpIds: [],
    tools: [],
    skillIds: [],
    repoSelections: [],
    sandboxId: undefined,
    permissions: { allowedTools: [] },
    notifications: { on: [] },
    outputMode: "text",
    behavior: {},
    limits: undefined,
    triggers: [],
    status: "draft",
    enabled: false,
    createdBy: "u1",
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
  } as unknown as Agent;

  describe("isSectionDirty", () => {
    it("returns false when no fields in the section have changed", () => {
      expect(isSectionDirty(base, base, "instructions")).toBe(false);
    });

    it("returns true when an owned field changes", () => {
      const edited = { ...base, instructions: "Do something else" };
      expect(isSectionDirty(base, edited, "instructions")).toBe(true);
    });

    it("returns false for a different section even when its fields changed", () => {
      const edited = { ...base, instructions: "Do something else" };
      expect(isSectionDirty(base, edited, "workspace")).toBe(false);
    });

    it("returns true for workspace when model changes", () => {
      const edited = { ...base, model: "claude-opus-4-5" };
      expect(isSectionDirty(base, edited, "workspace")).toBe(true);
    });

    it("returns false for non-saveable sections (runs, delete)", () => {
      // SECTION_FIELDS has no entry for "runs" — no fields means never dirty
      expect(isSectionDirty(base, { ...base, instructions: "changed" }, "runs")).toBe(false);
    });

    it("detects deep changes in triggers array", () => {
      const edited = {
        ...base,
        triggers: [{ type: "api" as const }],
      };
      expect(isSectionDirty(base, edited, "triggers")).toBe(true);
    });
  });

  describe("buildSectionUpdateInput", () => {
    it("returns only the fields owned by the instructions section", () => {
      const result = buildSectionUpdateInput(base, "instructions");
      expect(Object.keys(result).sort()).toEqual(["inputs", "instructions"]);
      expect(result.instructions).toBe("Do something");
      expect(result.inputs).toEqual([]);
    });

    it("returns only the fields owned by the workspace section", () => {
      const result = buildSectionUpdateInput(base, "workspace");
      expect(Object.keys(result).sort()).toEqual(["model", "provider", "repoSelections", "sandboxId"]);
    });

    it("returns only the fields owned by the permissions section", () => {
      const result = buildSectionUpdateInput(base, "permissions");
      expect(Object.keys(result).sort()).toEqual(["permissions", "tools"]);
    });

    it("returns an empty object for non-saveable sections", () => {
      expect(buildSectionUpdateInput(base, "runs")).toEqual({});
    });
  });
  ```

- [ ] **Step 2: Run tests — expect them to fail (functions not yet exported)**

  ```bash
  npm test -w packages/web
  ```

  Expected: several failures mentioning `isSectionDirty` / `buildSectionUpdateInput` are not exported.

- [ ] **Step 3: Verify tests pass after Task 1 code is in place**

  ```bash
  npm test -w packages/web
  ```

  Expected: all tests in `agent-form.test.ts` PASS. The existing SectionShell tests should also still pass.

---

## Task 3: Structured readiness errors from `agentsApi.enable()`

**Files:**
- Modify: `packages/web/src/api/agents.ts`

- [ ] **Step 1: Add the `ReadinessError` interface and update `enable()`**

  Open `packages/web/src/api/agents.ts`. Find:

  ```typescript
  enable: (wsId: string, id: string) =>
    fetch(`${wsBase(wsId)}/${id}/enable`, { method: "POST", credentials: "include" }).then(jsonOrThrow<Agent>),
  ```

  Replace with:

  ```typescript
  enable: async (wsId: string, id: string): Promise<Agent> => {
    const r = await fetch(`${wsBase(wsId)}/${id}/enable`, { method: "POST", credentials: "include" });
    if (r.ok) return r.json() as Promise<Agent>;
    const body = await r.json().catch(() => ({})) as Record<string, unknown>;
    if (r.status === 422 && Array.isArray(body.errors)) {
      const err = new Error((body.error as string) ?? "not_ready");
      (err as any).readinessErrors = body.errors as ReadinessError[];
      throw err;
    }
    throw new Error((body.error as string) ?? `HTTP ${r.status}`);
  },
  ```

  Also add the exported interface near the top of the file (after the `import` lines):

  ```typescript
  export interface ReadinessError {
    field: string;
    message: string;
  }
  ```

---

## Task 4: Update `SectionNav` to show dirty-section dots

**Files:**
- Modify: `packages/web/src/components/agents/sections/SectionNav.tsx`

- [ ] **Step 1: Add `dirtyIds` prop and amber dot rendering**

  Open `packages/web/src/components/agents/sections/SectionNav.tsx`.

  Change the function signature from:

  ```typescript
  export function SectionNav({ active, onSelect }: { active: SectionId; onSelect: (id: SectionId) => void }) {
  ```

  To:

  ```typescript
  export function SectionNav({
    active,
    onSelect,
    dirtyIds = [],
  }: {
    active: SectionId;
    onSelect: (id: SectionId) => void;
    dirtyIds?: SectionId[];
  }) {
  ```

  Inside the `return`, find the button content which currently renders:

  ```tsx
  <span className="w-4 text-center opacity-80">{s.icon}</span>
  {s.label}
  ```

  Replace it with:

  ```tsx
  <span className="w-4 text-center opacity-80">{s.icon}</span>
  <span className="flex-1">{s.label}</span>
  {dirtyIds.includes(s.id) && (
    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
  )}
  ```

---

## Task 5: Per-section save in `AgentDetail.tsx`

This task removes the global save button and wires up per-section saving. It does **not** touch the enable/disable flow yet (that's Task 6).

**Files:**
- Modify: `packages/web/src/components/agents/AgentDetail.tsx`

- [ ] **Step 1: Update imports**

  Replace the existing `agent-form.ts` import (drop `buildUpdateInput` — its only caller `save()` is being deleted; add the three new exports):

  ```typescript
  import { isAgentDirty, isSectionDirty, buildSectionUpdateInput, SAVEABLE_SECTION_IDS, agentSummary, statusLabel } from "./agent-form.ts";
  ```

  Add a type-only import for `ReadinessError` from the API module (used in Task 6):

  ```typescript
  import { agentsApi } from "../../api/agents.ts";
  import type { ReadinessError } from "../../api/agents.ts";
  ```

  Add `SECTIONS` to the existing `SectionNav` import (needed for the banner labels in Task 6):

  ```typescript
  import { SectionNav, SECTIONS, type SectionId } from "./sections/SectionNav.tsx";
  ```

- [ ] **Step 2: Add `saving` state and `SECTION_SHORT_LABELS`; remove the `dirty` alias**

  In the state block (after line `const [busy, setBusy] = useState(false);`), add:

  ```typescript
  const [saving, setSaving] = useState(false);
  const [readinessErrors, setReadinessErrors] = useState<ReadinessError[] | null>(null);
  ```

  Remove this line (it used the global dirty flag):

  ```typescript
  const dirty = isAgentDirty(original, a);
  ```

  Add these two constants below the state declarations:

  ```typescript
  const sectionDirty = isSectionDirty(original, a, section);

  const SECTION_SHORT_LABELS: Partial<Record<SectionId, string>> = {
    instructions: "Instructions",
    workspace: "Workspace",
    triggers: "Triggers",
    behavior: "Behavior",
    permissions: "Permissions",
    notifications: "Notifications",
  };
  ```

- [ ] **Step 3: Update `guarded()` to use per-section dirty check**

  Replace:

  ```typescript
  const guarded = (id: SectionId) => {
    if (dirty && !confirm("You have unsaved changes. Discard them?")) return;
    selectSection(id);
  };
  ```

  With:

  ```typescript
  const guarded = (id: SectionId) => {
    if (sectionDirty && !confirm("You have unsaved changes in this section. Discard them?")) return;
    selectSection(id);
  };
  ```

- [ ] **Step 4: Remove the global `save()` function**

  Delete the entire `save` function:

  ```typescript
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await agentsApi.update(wsId, a.id, buildUpdateInput(a));
      setOriginal(updated);
      setA(updated);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };
  ```

- [ ] **Step 5: Add `saveSection()` and a helper to merge only the saved section's fields**

  Add after `toggleEnable` (or after the removed `save` function location):

  ```typescript
  const mergeSection = (prev: Agent, updated: Agent, sectionId: SectionId): Agent => {
    const input = buildSectionUpdateInput(updated, sectionId);
    return { ...prev, ...(input as Partial<Agent>) };
  };

  const saveSection = async (sectionId: SectionId) => {
    setSaving(true);
    setError(null);
    try {
      const input = buildSectionUpdateInput(a, sectionId);
      const updated = await agentsApi.update(wsId, a.id, input);
      setOriginal((prev) => mergeSection(prev, updated, sectionId));
      setA((prev) => mergeSection(prev, updated, sectionId));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };
  ```

- [ ] **Step 6: Add `dirtySections` for the nav dots**

  Below `const sectionDirty = ...`, add:

  ```typescript
  const dirtySections = SAVEABLE_SECTION_IDS.filter((id) =>
    isSectionDirty(original, a, id)
  );
  ```

- [ ] **Step 7: Add the `SectionSaveBar` inline component above the `AgentDetail` function**

  Add this component definition before `export function AgentDetail(...)`:

  ```typescript
  function SectionSaveBar({
    dirty,
    saving,
    locked,
    label,
    onSave,
  }: {
    dirty: boolean;
    saving: boolean;
    locked: boolean;
    label: string;
    onSave: () => void;
  }) {
    if (!dirty) return null;
    return (
      <div className="shrink-0 border-t px-6 py-3 flex items-center justify-between bg-background">
        <span className="text-xs text-muted-foreground">● Unsaved changes</span>
        <button className={btnPrimary} disabled={locked || saving} onClick={onSave}>
          {saving ? "Saving…" : `Save ${label}`}
        </button>
      </div>
    );
  }
  ```

- [ ] **Step 8: Remove the Save button from the header JSX**

  In the header's button row, remove:

  ```tsx
  <button className={btnPrimary} disabled={busy || locked || !dirty} onClick={save}>
    {dirty ? "Save changes" : "Saved"}
  </button>
  ```

- [ ] **Step 9: Refactor the right panel to a flex column with a sticky footer**

  Find:

  ```tsx
  <div className="flex-1 p-6">
    {section === "instructions" && <InstructionsSection a={a} patch={patch} locked={locked} />}
    {section === "workspace" && <WorkspaceSection a={a} patch={patch} locked={locked} wsId={wsId} orgId={orgId} />}
    {section === "triggers" && <TriggersSection a={a} patch={patch} locked={locked} wsId={wsId} />}
    {section === "behavior" && <BehaviorSection a={a} patch={patch} locked={locked} />}
    {section === "permissions" && <PermissionsSection a={a} patch={patch} locked={locked} />}
    {section === "notifications" && <NotificationsSection a={a} patch={patch} locked={locked} wsId={wsId} />}
    {section === "runs" && <RunHistorySection wsId={wsId} agentId={a.id} />}
    {section === "delete" && (
      <DeleteSection a={a} wsId={wsId} locked={locked} onDeleted={() => navigate(backTo)} />
    )}
  </div>
  ```

  Replace with:

  ```tsx
  <div className="flex-1 flex flex-col min-h-0">
    <div className="flex-1 overflow-y-auto p-6">
      {section === "instructions" && <InstructionsSection a={a} patch={patch} locked={locked} />}
      {section === "workspace" && <WorkspaceSection a={a} patch={patch} locked={locked} wsId={wsId} orgId={orgId} />}
      {section === "triggers" && <TriggersSection a={a} patch={patch} locked={locked} wsId={wsId} />}
      {section === "behavior" && <BehaviorSection a={a} patch={patch} locked={locked} />}
      {section === "permissions" && <PermissionsSection a={a} patch={patch} locked={locked} />}
      {section === "notifications" && <NotificationsSection a={a} patch={patch} locked={locked} wsId={wsId} />}
      {section === "runs" && <RunHistorySection wsId={wsId} agentId={a.id} />}
      {section === "delete" && (
        <DeleteSection a={a} wsId={wsId} locked={locked} onDeleted={() => navigate(backTo)} />
      )}
    </div>
    <SectionSaveBar
      dirty={sectionDirty}
      saving={saving}
      locked={locked}
      label={SECTION_SHORT_LABELS[section] ?? ""}
      onSave={() => saveSection(section)}
    />
  </div>
  ```

- [ ] **Step 10: Pass `dirtyIds` to `SectionNav`**

  Find:

  ```tsx
  <SectionNav active={section} onSelect={guarded} />
  ```

  Replace with:

  ```tsx
  <SectionNav active={section} onSelect={guarded} dirtyIds={dirtySections} />
  ```

---

## Task 6: Enable validation error banner in `AgentDetail.tsx`

**Files:**
- Modify: `packages/web/src/components/agents/AgentDetail.tsx`

- [ ] **Step 1: Define `FIELD_TO_SECTION` mapping**

  Add this module-level constant above `SectionSaveBar` (or above `AgentDetail`):

  ```typescript
  const FIELD_TO_SECTION: Record<string, SectionId> = {
    name:         "instructions",
    instructions: "instructions",
    inputs:       "instructions",
    provider:     "workspace",
    model:        "workspace",
    sandbox:      "workspace",
    triggers:     "triggers",
  };
  ```

- [ ] **Step 2: Update `toggleEnable` to capture readiness errors**

  Find the existing `toggleEnable` function:

  ```typescript
  const toggleEnable = async () => {
    if (!a.enabled && dirty) {
      setError("Save your changes before enabling.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = a.enabled ? await agentsApi.disable(wsId, a.id) : await agentsApi.enable(wsId, a.id);
      setOriginal(updated);
      setA(updated);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };
  ```

  Replace with:

  ```typescript
  const toggleEnable = async () => {
    if (!a.enabled && isAgentDirty(original, a)) {
      setError("Save your changes before enabling.");
      return;
    }
    setBusy(true);
    setError(null);
    setReadinessErrors(null);
    try {
      const updated = a.enabled
        ? await agentsApi.disable(wsId, a.id)
        : await agentsApi.enable(wsId, a.id);
      setReadinessErrors(null);
      setOriginal(updated);
      setA(updated);
    } catch (e: any) {
      if ((e as any).readinessErrors) {
        setReadinessErrors((e as any).readinessErrors as ReadinessError[]);
      } else {
        setError(e?.message ?? String(e));
      }
    } finally {
      setBusy(false);
    }
  };
  ```

- [ ] **Step 3: Add the readiness banner to the JSX**

  In the scrollable content area (`<div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-6">`), the current order is:

  ```tsx
  {locked && (...)}
  {showRunForm && (...)}
  {error && <div className="text-sm text-destructive">{error}</div>}
  <div className={`${card} overflow-hidden`}>...
  ```

  Add the readiness banner **before** the locked banner:

  ```tsx
  {readinessErrors && readinessErrors.length > 0 && (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3">
      <p className="text-sm font-semibold text-destructive mb-2">
        ⚠ Can't enable — fix these issues first:
      </p>
      <ul className="space-y-1">
        {readinessErrors.map((e) => {
          const targetSection = FIELD_TO_SECTION[e.field] as SectionId | undefined;
          const label = targetSection
            ? SECTIONS.find((s) => s.id === targetSection)?.label ?? e.field
            : e.field;
          return (
            <li key={e.field} className="text-sm text-destructive">
              {targetSection ? (
                <button
                  className="font-medium underline hover:no-underline"
                  onClick={() => selectSection(targetSection)}
                >
                  {label}
                </button>
              ) : (
                <span className="font-medium">{label}</span>
              )}
              {" — "}{e.message}
            </li>
          );
        })}
      </ul>
    </div>
  )}
  {locked && (
    <div className="rounded-md bg-muted text-muted-foreground text-sm px-4 py-2">
      🔒 Enabled — disable to edit.
    </div>
  )}
  ```

---

## Task 7: Final typecheck

- [ ] **Step 1: Run the web package tests one final time**

  ```bash
  npm test -w packages/web
  ```

  Expected: all tests pass (agent-form.test.ts + SectionShell.test.tsx).

- [ ] **Step 2: Run the full workspace typecheck**

  ```bash
  npm run typecheck
  ```

  Expected: zero errors. Common things to fix if errors appear:
  - `dirty` referenced somewhere still → replace with `sectionDirty` or `isAgentDirty(original, a)`
  - `save` referenced in JSX after deletion → remove the button
  - `(err as any).readinessErrors` type complaint → acceptable, `any` cast is intentional
  - `SAVEABLE_SECTION_IDS` type mismatch → ensure the `filter` result is cast to `SectionId[]`
