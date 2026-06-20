# Agent Sandbox Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sandbox `<select>` dropdown to the agent Workspace & Model section so users can pin an agent to a specific execution environment.

**Architecture:** `orgId` is already available in `AgentDetail` but not forwarded to `WorkspaceSection`. We thread it through, then fetch `sandboxesApi.listVisible(orgId)` on mount and render a dropdown that patches `sandboxId` on the agent. No backend changes needed — `sandboxId` is already persisted.

**Tech Stack:** React, TypeScript, Tailwind via `inputCls`, `sandboxesApi` from `packages/web/src/api/sandboxes.ts`

---

### Task 1: Thread `orgId` from `AgentDetail` into `WorkspaceSection`

**Files:**
- Modify: `packages/web/src/components/agents/AgentDetail.tsx:18`
- Modify: `packages/web/src/components/agents/sections/WorkspaceSection.tsx:8-13`

- [ ] **Step 1: Expose `orgId` in `AgentDetail`**

In `AgentDetail.tsx` line 18, the prop is currently aliased as unused (`_orgId`). Remove the alias:

```tsx
// Before
export function AgentDetail({ wsId, orgId: _orgId, initial }: { wsId: string; orgId: string; initial: Agent }) {

// After
export function AgentDetail({ wsId, orgId, initial }: { wsId: string; orgId: string; initial: Agent }) {
```

- [ ] **Step 2: Pass `orgId` to `WorkspaceSection`**

In `AgentDetail.tsx`, find the `WorkspaceSection` render (currently line ~158):

```tsx
// Before
{section === "workspace" && <WorkspaceSection a={a} patch={patch} locked={locked} wsId={wsId} />}

// After
{section === "workspace" && <WorkspaceSection a={a} patch={patch} locked={locked} wsId={wsId} orgId={orgId} />}
```

- [ ] **Step 3: Add `orgId` to `SectionProps` in `WorkspaceSection`**

In `packages/web/src/components/agents/sections/WorkspaceSection.tsx`, update the interface:

```tsx
// Before
export interface SectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
  wsId: string;
}

// After
export interface SectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
  wsId: string;
  orgId: string;
}
```

- [ ] **Step 4: Destructure `orgId` in the component signature**

```tsx
// Before
export function WorkspaceSection({ a, patch, locked, wsId }: SectionProps) {

// After
export function WorkspaceSection({ a, patch, locked, wsId, orgId }: SectionProps) {
```

---

### Task 2: Fetch sandboxes and render the picker

**Files:**
- Modify: `packages/web/src/components/agents/sections/WorkspaceSection.tsx`

- [ ] **Step 1: Import `sandboxesApi` and the `Sandbox` type**

Add to the existing imports at the top of `WorkspaceSection.tsx`:

```tsx
import { sandboxesApi, type Sandbox } from "../../../api/sandboxes.ts";
```

- [ ] **Step 2: Add `sandboxes` state**

Inside `WorkspaceSection`, alongside the existing `useState` calls, add:

```tsx
const [sandboxes, setSandboxes] = useState<Sandbox[]>([]);
```

- [ ] **Step 3: Fetch sandboxes on mount**

Add a `useEffect` (alongside the existing two) that fetches visible org sandboxes:

```tsx
useEffect(() => {
  sandboxesApi.listVisible(orgId).then(setSandboxes).catch(() => setSandboxes([]));
}, [orgId]);
```

- [ ] **Step 4: Render the sandbox `<select>`**

In the JSX return, add the sandbox picker **between** the Model `<div>` and the Git connection `<div ref={browseRef}>`:

```tsx
<div>
  <FieldLabel>Sandbox</FieldLabel>
  <select
    className={inputCls}
    disabled={locked}
    value={a.sandboxId ?? ""}
    onChange={(e) => patch({ sandboxId: e.target.value || undefined })}
  >
    <option value="">— auto (system default) —</option>
    {sandboxes.filter((s) => s.enabled).map((s) => (
      <option key={s.id} value={s.id}>
        {s.name} · {s.type}
      </option>
    ))}
  </select>
</div>
```

---

### Task 3: Typecheck

**Files:** none (verification only)

- [ ] **Step 1: Run the full typecheck**

```bash
npm run typecheck
```

Expected: zero errors. The two changed files are the only ones affected — `AgentDetail` now passes the required `orgId` prop, and `WorkspaceSection` now has it in its interface.
