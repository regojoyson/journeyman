# Agent MCP + Skills Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users attach MCP connectors and skill packages to an Agent via a new "MCP & skills" section in the agent editor, and fix the flow-editor's MCP/skills pickers to use the workspace-scoped endpoints.

**Architecture:** Pure UI wiring. The runtime (compile → worker resolvers → sandbox `runCustomPrompt`) and the `PATCH /api/workspaces/:wsId/agents/:id` endpoint already consume `connectorMcpIds`/`skillIds`. We add a section to the agent editor, two small controlled pickers backed by the existing workspace-scoped "visible" endpoints, and repoint two stale `fetch` URLs in the flow-editor. No backend, migration, or runtime changes.

**Tech Stack:** React + TypeScript, Vite, Tailwind (web package), Vitest. Spec: `docs/superpowers/specs/2026-06-21-agent-mcp-skills-design.md`.

**Working constraints:**
- Work directly on `master`. **Do not branch.**
- **Do not commit.** Leave all changes in the working tree.
- Verify at the very end with a typecheck (final task).

---

## Background facts (verified against the codebase)

- `Agent` (in `@journeyman/core`) already has `connectorMcpIds: string[]` and `skillIds: string[]` at the root.
- Section save machinery is data-driven: `agent-form.ts` derives dirty-tracking and PATCH bodies from `SECTION_FIELDS` and `SAVEABLE_SECTION_IDS`. Adding a section = adding entries there + a render branch.
- `patch` in `AgentDetail.tsx` has signature `(p: AgentUpdateInput) => void` and shallow-merges into the working agent.
- Section components follow `SectionProps { a, patch, locked }`, optionally `+ wsId` (and `+ orgId` for `WorkspaceSection`). `wsId` and `orgId` are already in scope in `AgentDetail`.
- Wrapper components: `SectionShell({ title, description, children })`, `FieldLabel({ children, help })` from `sections/SectionShell.tsx`.
- Workspace-scoped visible endpoints (already registered):
  - `GET /api/workspaces/:wsId/mcp-instances/visible` → `VisibleMcp { id, name, description: string|null, scope: "user"|"org", enabled: boolean }`
  - `GET /api/workspaces/:wsId/skill-packages/visible` → `VisibleSkill { id, name, scope: "user"|"org", installStatus: "pending"|"installing"|"ready"|"error", enabledSkillCount: number }`
- The flow-editor exposes `useWsId()` from `packages/flow-editor/src/state/org-context.tsx`; `McpToolsTab` already calls it.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/web/src/components/agents/agent-form.test.ts` | Unit test for editable-field wiring | Modify |
| `packages/web/src/components/agents/agent-form.ts` | Editable-field subset, per-section field ownership | Modify |
| `packages/web/src/components/agents/sections/SectionNav.tsx` | Section IDs + nav entries | Modify |
| `packages/web/src/components/agents/shared/VisibleListPickers.tsx` | Reusable MCP + skill multi-select pickers | Create |
| `packages/web/src/components/agents/sections/IntegrationsSection.tsx` | "MCP & skills" section composing the two pickers | Create |
| `packages/web/src/components/agents/AgentDetail.tsx` | Render the new section, short label | Modify |
| `packages/flow-editor/src/properties-panel/McpToolsTab.tsx` | Repoint MCP visible fetch to workspace scope | Modify |
| `packages/flow-editor/src/properties-panel/SkillsTab.tsx` | Repoint skills visible fetch to workspace scope | Modify |

---

## Task 1: Wire `connectorMcpIds` + `skillIds` into the editable form layer (TDD)

**Files:**
- Test: `packages/web/src/components/agents/agent-form.test.ts`
- Modify: `packages/web/src/components/agents/agent-form.ts`

- [ ] **Step 1: Update the `buildUpdateInput` test to expect the two new fields**

In `agent-form.test.ts`, the `buildUpdateInput` test currently asserts an exact object via `toEqual`. Add the two new keys to the expected object so the test pins the new behavior. Replace the existing `expect(out).toEqual({ ... })` block (lines 33–46) with:

```typescript
    expect(out).toEqual({
      instructions: "do the thing",
      inputs: [],
      provider: "claude",
      model: "claude-opus-4-8",
      sandboxId: undefined,
      repoSelections: [{ repo: "acme/api", allowWrites: false }],
      triggers: [{ type: "schedule", cron: "0 2 * * *", timezone: "UTC" }],
      behavior: {},
      outputMode: "text",
      limits: undefined,
      permissions: { allowedTools: [] },
      tools: [],
      connectorMcpIds: [],
      skillIds: [],
      notifications: { on: [] },
    });
```

(Note: `sandboxId` is added explicitly because `buildUpdateInput` already returns it — the original test omitted it, but `toEqual` treats an `undefined`-valued key and a missing key as equal, so the original passed. Keep it for clarity.)

- [ ] **Step 2: Add a test that the integrations section owns the new fields**

Append this test inside the existing `describe("buildSectionUpdateInput", ...)` block in `agent-form.test.ts`:

```typescript
  it("returns only the fields owned by the integrations section", () => {
    const result = buildSectionUpdateInput(base, "integrations");
    expect(Object.keys(result).sort()).toEqual(["connectorMcpIds", "skillIds"]);
    expect(result.connectorMcpIds).toEqual([]);
    expect(result.skillIds).toEqual([]);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -w @journeyman/web -- agent-form`
Expected: FAIL — `buildUpdateInput` test fails because the output is missing `connectorMcpIds`/`skillIds`; the new `buildSectionUpdateInput` test fails because the `integrations` section owns no fields yet (returns `{}`). (TypeScript may also flag `"integrations"` as not assignable to `SectionId` until Task 2 — if so, do Task 2 first, then return here.)

- [ ] **Step 4: Add the fields to `buildUpdateInput`**

In `agent-form.ts`, in `buildUpdateInput`, add the two fields after `tools: a.tools,` (line 18):

```typescript
    tools: a.tools,
    connectorMcpIds: a.connectorMcpIds,
    skillIds: a.skillIds,
    notifications: a.notifications,
```

- [ ] **Step 5: Add the section's field ownership and saveable entry**

In `agent-form.ts`, add a key to `SECTION_FIELDS` (after the `permissions` entry, line 45):

```typescript
  permissions:  ["permissions", "tools"],
  integrations: ["connectorMcpIds", "skillIds"],
  notifications:["notifications"],
```

And add `"integrations"` to `SAVEABLE_SECTION_IDS` (line 50–52):

```typescript
export const SAVEABLE_SECTION_IDS: readonly SectionId[] = [
  "instructions", "workspace", "triggers", "behavior", "permissions", "integrations", "notifications",
];
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test -w @journeyman/web -- agent-form`
Expected: PASS (all `agent-form` tests green). Requires Task 2 complete so `"integrations"` is a valid `SectionId`.

---

## Task 2: Add the "integrations" section to the nav

**Files:**
- Modify: `packages/web/src/components/agents/sections/SectionNav.tsx`

- [ ] **Step 1: Add `"integrations"` to the `SectionId` union**

Replace the `SectionId` type (lines 1–2) with:

```typescript
export type SectionId =
  | "instructions" | "workspace" | "triggers" | "behavior" | "permissions" | "integrations" | "notifications" | "runs" | "delete";
```

- [ ] **Step 2: Add the nav entry**

In the `SECTIONS` array, insert after the `permissions` entry (line 9):

```typescript
  { id: "permissions", label: "Permissions", icon: "🔐" },
  { id: "integrations", label: "MCP & skills", icon: "🔌" },
  { id: "notifications", label: "Notifications", icon: "🔔" },
```

- [ ] **Step 3: Typecheck this package**

Run: `npm run typecheck -w @journeyman/web`
Expected: errors only in `AgentDetail.tsx` (missing render branch / short label, fixed in Task 5) and possibly `IntegrationsSection` not yet created. The `SectionNav.tsx` and `agent-form.ts` changes themselves should not error. This is an interim check — full green comes in Task 6's final verification.

---

## Task 3: Create the reusable MCP + skill pickers

**Files:**
- Create: `packages/web/src/components/agents/shared/VisibleListPickers.tsx`

These are controlled multi-select lists styled with the web package's Tailwind conventions (matching `SectionShell`/sections). Each fetches its workspace-scoped visible list once per `wsId`.

- [ ] **Step 1: Create the file with both pickers**

Create `packages/web/src/components/agents/shared/VisibleListPickers.tsx`:

```typescript
import { useEffect, useState } from "react";

interface VisibleMcp {
  id: string;
  name: string;
  description: string | null;
  scope: "user" | "org";
  enabled: boolean;
}

interface VisibleSkill {
  id: string;
  name: string;
  scope: "user" | "org";
  installStatus: "pending" | "installing" | "ready" | "error";
  enabledSkillCount: number;
}

function byScopeThenName<T extends { scope: "user" | "org"; name: string }>(a: T, b: T): number {
  return a.scope === b.scope
    ? a.name.localeCompare(b.name)
    : a.scope === "org" ? -1 : 1;
}

const rowBase =
  "flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition";
const rowOn = "border-primary bg-primary/5";
const rowOff = "border-border hover:bg-accent/50";

function toggleId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

export function VisibleMcpPicker({
  wsId,
  value,
  onChange,
  disabled,
}: {
  wsId: string;
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [available, setAvailable] = useState<VisibleMcp[]>([]);
  const [loading, setLoading] = useState(true);
  const selected = new Set(value);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/workspaces/${wsId}/mcp-instances/visible`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: VisibleMcp[]) => {
        if (!alive) return;
        setAvailable([...rows].filter((m) => m.enabled).sort(byScopeThenName));
      })
      .catch(() => { if (alive) setAvailable([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [wsId]);

  if (loading) return <div className="text-xs text-muted-foreground">Loading…</div>;
  if (available.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        No MCP connectors available. Add some at{" "}
        <a className="text-primary underline" href="/me/mcps" target="_blank" rel="noreferrer">/me/mcps</a>{" "}
        or <a className="text-primary underline" href="/admin/mcps" target="_blank" rel="noreferrer">/admin/mcps</a>.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {available.map((m) => {
        const checked = selected.has(m.id);
        return (
          <label
            key={m.id}
            className={`${rowBase} ${checked ? rowOn : rowOff} ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
            title={m.description ?? ""}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(toggleId(value, m.id))}
            />
            <span className="flex-1">{m.name}</span>
            <span className="text-[10px] text-muted-foreground">{m.scope}</span>
          </label>
        );
      })}
    </div>
  );
}

export function VisibleSkillPicker({
  wsId,
  value,
  onChange,
  disabled,
}: {
  wsId: string;
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [available, setAvailable] = useState<VisibleSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const selected = new Set(value);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/workspaces/${wsId}/skill-packages/visible`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: VisibleSkill[]) => {
        if (!alive) return;
        setAvailable([...rows].sort(byScopeThenName));
      })
      .catch(() => { if (alive) setAvailable([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [wsId]);

  if (loading) return <div className="text-xs text-muted-foreground">Loading…</div>;
  if (available.length === 0) {
    return (
      <div className="text-xs text-muted-foreground">
        No skill packages available. Add some at{" "}
        <a className="text-primary underline" href="/me/skills" target="_blank" rel="noreferrer">/me/skills</a>{" "}
        or <a className="text-primary underline" href="/admin/skills" target="_blank" rel="noreferrer">/admin/skills</a>.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {available.map((s) => {
        const checked = selected.has(s.id);
        return (
          <label
            key={s.id}
            className={`${rowBase} ${checked ? rowOn : rowOff} ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
            title={`${s.enabledSkillCount} enabled skill${s.enabledSkillCount === 1 ? "" : "s"}`}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(toggleId(value, s.id))}
            />
            <span className="flex-1">{s.name}</span>
            <span className="text-[10px] text-muted-foreground">{s.enabledSkillCount} skills</span>
            <span className="text-[10px] text-muted-foreground">{s.scope}</span>
          </label>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @journeyman/web`
Expected: no new errors originating in `VisibleListPickers.tsx`. (Pre-existing `AgentDetail.tsx`/missing-section errors remain until Task 5.)

---

## Task 4: Create the IntegrationsSection

**Files:**
- Create: `packages/web/src/components/agents/sections/IntegrationsSection.tsx`

- [ ] **Step 1: Create the section component**

Create `packages/web/src/components/agents/sections/IntegrationsSection.tsx`:

```typescript
import type { Agent, AgentUpdateInput } from "@journeyman/core";
import { SectionShell, FieldLabel } from "./SectionShell.tsx";
import { VisibleMcpPicker, VisibleSkillPicker } from "../shared/VisibleListPickers.tsx";

export interface IntegrationsSectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
  wsId: string;
}

export function IntegrationsSection({ a, patch, locked, wsId }: IntegrationsSectionProps) {
  return (
    <SectionShell
      title="MCP & skills"
      description="Connectors and skill packages the agent loads when it runs in the sandbox. MCP connectors give the agent extra tools; skill packages add reusable instructions."
    >
      <div>
        <FieldLabel help="MCP servers the agent can call at runtime">MCP connectors</FieldLabel>
        <VisibleMcpPicker
          wsId={wsId}
          value={a.connectorMcpIds}
          onChange={(ids) => patch({ connectorMcpIds: ids })}
          disabled={locked}
        />
      </div>

      <div>
        <FieldLabel help="Skill packages loaded into the agent's context">Skill packages</FieldLabel>
        <VisibleSkillPicker
          wsId={wsId}
          value={a.skillIds}
          onChange={(ids) => patch({ skillIds: ids })}
          disabled={locked}
        />
      </div>
    </SectionShell>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @journeyman/web`
Expected: no new errors in `IntegrationsSection.tsx`. (`AgentDetail.tsx` still errors on the missing render branch until Task 5.)

---

## Task 5: Render the section in AgentDetail

**Files:**
- Modify: `packages/web/src/components/agents/AgentDetail.tsx`

- [ ] **Step 1: Import the section**

Add the import alongside the other section imports (after the `PermissionsSection` import, line ~14):

```typescript
import { PermissionsSection } from "./sections/PermissionsSection.tsx";
import { IntegrationsSection } from "./sections/IntegrationsSection.tsx";
import { NotificationsSection } from "./sections/NotificationsSection.tsx";
```

- [ ] **Step 2: Add the short label**

In the `SECTION_SHORT_LABELS` object (lines 74–81), add the `integrations` entry after `permissions`:

```typescript
    permissions: "Permissions",
    integrations: "MCP & skills",
    notifications: "Notifications",
```

- [ ] **Step 3: Add the render branch**

In the section-render block, add a branch after the `permissions` branch (line 251):

```typescript
                {section === "permissions" && <PermissionsSection a={a} patch={patch} locked={locked} />}
                {section === "integrations" && <IntegrationsSection a={a} patch={patch} locked={locked} wsId={wsId} />}
                {section === "notifications" && <NotificationsSection a={a} patch={patch} locked={locked} wsId={wsId} />}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS for the `@journeyman/web` package (no remaining agent-editor errors).

---

## Task 6: Fix the flow-editor MCP + skills pickers

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/McpToolsTab.tsx`
- Modify: `packages/flow-editor/src/properties-panel/SkillsTab.tsx`

- [ ] **Step 1: Repoint the MCP visible fetch to the workspace endpoint**

In `McpToolsTab.tsx`, the visible-list effect (lines 69–88) currently fetches the org URL and depends on `orgId`. `wsId` is already available via `useWsId()` (line 51). Replace the effect body so it fetches the workspace endpoint and guards on `wsId`:

```typescript
  useEffect(() => {
    if (!wsId) { setAvailable([]); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    fetch(`/api/workspaces/${wsId}/mcp-instances/visible`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: VisibleMcp[]) => {
        if (!alive) return;
        const sorted = [...rows]
          .filter((m) => m.enabled)
          .sort((a, b) =>
            a.scope === b.scope
              ? a.name.localeCompare(b.name)
              : a.scope === "org" ? -1 : 1
          );
        setAvailable(sorted);
      })
      .catch(() => { if (alive) setAvailable([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [wsId]);
```

Note: the `orgId` prop is now unused by the fetch. Leave the prop in `McpToolsTabProps` and the destructure as-is (callers still pass it; removing it is out of scope and risks breaking `PropertiesPanel`). The TypeScript config does not error on an unused destructured prop here, but if `noUnusedLocals`/lint flags `orgId`, prefix it as `_orgId` in the destructure on line 50.

- [ ] **Step 2: Repoint the skills visible fetch to the workspace endpoint**

In `SkillsTab.tsx`:

First add the `useWsId` import after the existing imports (line 2):

```typescript
import { useEffect, useState } from "react";
import type { WorkflowNode } from "@journeyman/core";
import { useWsId } from "../state/org-context.tsx";
```

Then inside `SkillsTab` (currently `export function SkillsTab({ node, orgId, onChange, readOnly })`, line 30), add `const wsId = useWsId();` as the first line of the body and change the effect (lines 36–53) to use it:

```typescript
export function SkillsTab({ node, orgId, onChange, readOnly }: SkillsTabProps) {
  const wsId = useWsId();
  const [available, setAvailable] = useState<VisibleSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const selected = getSelectedIds(node);
  const enabledIds = new Set(selected);

  useEffect(() => {
    if (!wsId) { setAvailable([]); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    fetch(`/api/workspaces/${wsId}/skill-packages/visible`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: VisibleSkill[]) => {
        if (!alive) return;
        const sorted = [...rows].sort((a, b) =>
          a.scope === b.scope
            ? a.name.localeCompare(b.name)
            : a.scope === "org" ? -1 : 1
        );
        setAvailable(sorted);
      })
      .catch(() => { if (alive) setAvailable([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [wsId]);
```

Same note as Step 1: `orgId` becomes unused by the fetch. Leave the prop in place; if `noUnusedLocals` flags it, rename the destructured binding to `_orgId`.

- [ ] **Step 3: Typecheck the flow-editor package**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: PASS. If it errors on an unused `orgId`, apply the `_orgId` rename noted above and re-run.

---

## Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the agent-form unit tests**

Run: `npm test -w @journeyman/web -- agent-form`
Expected: PASS — all `agent-form` tests green, including the new `integrations` section test.

- [ ] **Step 2: Run the full typecheck + boundary check**

Run: `npm run check`
Expected: PASS (typecheck across all workspaces + import-boundary check + theme-color check). This is the definitive gate.

If `npm run check` surfaces a pre-existing failure unrelated to these files, note it but confirm no *new* failures were introduced by this change (compare against the file list in this plan).

- [ ] **Step 3: Leave changes uncommitted**

Do **not** run `git commit`. Confirm the working tree contains exactly the files listed in the File Structure table:

Run: `git status --short`
Expected: modified/created entries only for the 8 files in this plan (plus any pre-existing dirty files from before this work).

---

## Self-Review Notes

- **Spec coverage:** Part 1 (Integrations section) → Tasks 1, 2, 4, 5. Part 2 (shared pickers) → Task 3. Part 3 (flow-editor fix) → Task 6. Verification → Task 7. All spec sections covered.
- **Type consistency:** `connectorMcpIds`/`skillIds` are the canonical `Agent` field names used end-to-end (test fixture, `buildUpdateInput`, `SECTION_FIELDS`, `IntegrationsSection`, picker `onChange`). Picker component names `VisibleMcpPicker`/`VisibleSkillPicker` match between Task 3 (definition) and Task 4 (use). `SectionId` value `"integrations"` matches between Task 2 (union), Task 1 (`SECTION_FIELDS`/`SAVEABLE_SECTION_IDS`), and Task 5 (label + render branch).
- **No backend/runtime changes:** confirmed — the workspace endpoints and the compile→worker→sandbox path already exist (see spec "What already works").
