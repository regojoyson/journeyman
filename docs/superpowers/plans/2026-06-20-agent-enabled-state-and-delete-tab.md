# Agent enabled-state + delete-tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce the agent enabled/disabled state machine (Run now only when enabled; read-only when enabled) and move agent deletion into a confirmed in-view tab.

**Architecture:** Pure frontend changes in `packages/web`. The `locked = a.enabled` derivation already exists in `AgentDetail`; this plan gates Run now on it, guards enabling against unsaved edits, closes the Permissions read-only hole, and adds a danger-zone "Delete agent" section while removing the unconfirmed delete from the agent list.

**Tech Stack:** React, TypeScript, Tailwind, react-router-dom.

**Workflow constraints (per user):** Stay on the current branch. **No commits.** No per-task test/commit ceremony — a single `npx tsc --noEmit -p packages/web` at the very end is the verification gate.

**Spec:** `docs/superpowers/specs/2026-06-20-agent-enabled-state-and-delete-tab-design.md`

---

### Task 1: Add a `disabled` prop to ToolsPicker

**Files:**
- Modify: `packages/web/src/components/custom-steps/ToolsPicker.tsx:13-18`, `:34`

- [ ] **Step 1: Add `disabled` to the props type**

Replace the props type (lines 13-18):

```tsx
export function ToolsPicker(props: {
  value: CanonicalTool[];
  onChange: (next: CanonicalTool[]) => void;
  disabledTools?: ReadonlySet<CanonicalTool>;
  unsupportedTools?: ReadonlySet<CanonicalTool>;
  disabled?: boolean;
}) {
```

- [ ] **Step 2: Apply it to every checkbox**

Replace line 34:

```tsx
        const disabled = props.disabled || props.disabledTools?.has(t);
```

(`disabled` is already consumed by the `<input disabled={disabled} />` on line 44 — no other change needed.)

---

### Task 2: Make Permissions read-only when the agent is enabled

**Files:**
- Modify: `packages/web/src/components/agents/sections/PermissionsSection.tsx:11-19`

- [ ] **Step 1: Consume `locked` and pass it to ToolsPicker**

Replace the component body (lines 11-22):

```tsx
export function PermissionsSection({ a, patch, locked }: SectionProps) {
  return (
    <SectionShell title="Permissions" description="Which tools the agent is allowed to use.">
      <div>
        <FieldLabel>Allowed tools</FieldLabel>
        <ToolsPicker
          value={a.permissions.allowedTools}
          onChange={(t: CanonicalTool[]) => patch({ permissions: { allowedTools: t }, tools: t })}
          disabled={locked}
        />
      </div>
    </SectionShell>
  );
}
```

---

### Task 3: Gate "Run now" on enabled + add tooltip

**Files:**
- Modify: `packages/web/src/components/agents/AgentDetail.tsx` (the Run now button in the header)

- [ ] **Step 1: Wrap the button in a titled span and gate on `a.enabled`**

Find:

```tsx
              <button className={btnGhost} disabled={busy} onClick={openRun}>Run now</button>
```

Replace with:

```tsx
              <span title={!a.enabled ? "Enable the agent to run it" : undefined}>
                <button className={btnGhost} disabled={busy || !a.enabled} onClick={openRun}>Run now</button>
              </span>
```

(The `<span>` wrapper is required because browsers suppress `title` tooltips on disabled buttons.)

---

### Task 4: Block enabling while there are unsaved edits

**Files:**
- Modify: `packages/web/src/components/agents/AgentDetail.tsx` (`toggleEnable`)

- [ ] **Step 1: Add a dirty guard to the enabling direction**

Find:

```tsx
  const toggleEnable = async () => {
    setBusy(true);
    setError(null);
```

Replace with:

```tsx
  const toggleEnable = async () => {
    if (!a.enabled && dirty) {
      setError("Save your changes before enabling.");
      return;
    }
    setBusy(true);
    setError(null);
```

(`dirty` and `setError` are already in scope. Disabling — `a.enabled === true` — is never blocked.)

---

### Task 5: Add the "delete" section to the nav

**Files:**
- Modify: `packages/web/src/components/agents/sections/SectionNav.tsx:1-12`, `:14-39`

- [ ] **Step 1: Extend `SectionId` and the `SECTIONS` array**

Replace lines 1-12:

```tsx
export type SectionId =
  | "instructions" | "workspace" | "triggers" | "behavior" | "permissions" | "notifications" | "runs" | "delete";

export const SECTIONS: Array<{ id: SectionId; label: string; icon: string; danger?: boolean }> = [
  { id: "instructions", label: "Instructions & Inputs", icon: "📝" },
  { id: "workspace", label: "Workspace & Model", icon: "⚙️" },
  { id: "triggers", label: "Triggers", icon: "⏱" },
  { id: "behavior", label: "Behavior", icon: "🎛" },
  { id: "permissions", label: "Permissions", icon: "🔐" },
  { id: "notifications", label: "Notifications", icon: "🔔" },
  { id: "runs", label: "Run history", icon: "📊" },
  { id: "delete", label: "Delete agent", icon: "🗑", danger: true },
];
```

- [ ] **Step 2: Render danger items with a separator and destructive color**

Replace the `SECTIONS.map(...)` body (lines 16-38) with:

```tsx
      {SECTIONS.map((s) => {
        const isActive = active === s.id;
        const separated = s.id === "runs" || s.danger;
        return (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={[
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-left transition",
              separated ? "mt-2 pt-3 border-t" : "",
              s.danger
                ? isActive
                  ? "bg-destructive/10 text-destructive font-medium"
                  : "text-destructive/80 hover:bg-destructive/10 hover:text-destructive"
                : isActive
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            ].join(" ")}
          >
            <span className="w-4 text-center opacity-80">{s.icon}</span>
            {s.label}
          </button>
        );
      })}
```

---

### Task 6: Create the DeleteSection component

**Files:**
- Create: `packages/web/src/components/agents/sections/DeleteSection.tsx`

- [ ] **Step 1: Write the component**

Create `packages/web/src/components/agents/sections/DeleteSection.tsx`:

```tsx
import { useState } from "react";
import type { Agent } from "@journeyman/core";
import { agentsApi } from "../../../api/agents.ts";
import { inputCls, btnDanger } from "../../../routes/admin-styles.ts";
import { SectionShell } from "./SectionShell.tsx";

export function DeleteSection({
  a,
  wsId,
  locked,
  onDeleted,
}: {
  a: Agent;
  wsId: string;
  locked: boolean;
  onDeleted: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const matches = confirmText.trim() === a.name;

  const del = async () => {
    if (!matches || locked || busy) return;
    setBusy(true);
    setError(null);
    try {
      await agentsApi.remove(wsId, a.id);
      onDeleted();
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setBusy(false);
    }
  };

  return (
    <SectionShell
      title="Delete agent"
      description="Permanently delete this agent and its run history. This cannot be undone."
    >
      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 space-y-3">
        {locked ? (
          <p className="text-sm text-muted-foreground">Disable the agent before deleting it.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Type <span className="font-medium text-foreground">{a.name}</span> to confirm.
            </p>
            <input
              className={inputCls}
              placeholder={a.name}
              value={confirmText}
              disabled={busy}
              onChange={(e) => setConfirmText(e.target.value)}
            />
            {error && <div className="text-sm text-destructive">{error}</div>}
            <button className={btnDanger} disabled={!matches || busy} onClick={del}>
              {busy ? "Deleting…" : "Delete agent"}
            </button>
          </>
        )}
      </div>
    </SectionShell>
  );
}
```

---

### Task 7: Wire DeleteSection into AgentDetail

**Files:**
- Modify: `packages/web/src/components/agents/AgentDetail.tsx` (imports + section render block)

- [ ] **Step 1: Import DeleteSection**

Add alongside the other section imports (near the `RunHistorySection` import):

```tsx
import { DeleteSection } from "./sections/DeleteSection.tsx";
```

- [ ] **Step 2: Render it for the `delete` section**

Find:

```tsx
              {section === "runs" && <RunHistorySection wsId={wsId} agentId={a.id} />}
```

Add immediately after:

```tsx
              {section === "delete" && (
                <DeleteSection a={a} wsId={wsId} locked={locked} onDeleted={() => navigate(backTo)} />
              )}
```

(`navigate` and `backTo` are already defined in `AgentDetail`.)

---

### Task 8: Remove the unconfirmed Delete button from the agent list

**Files:**
- Modify: `packages/web/src/components/agents/AgentsList.tsx:5`, `:91-102`

- [ ] **Step 1: Remove the Delete button, keep Open**

Find (lines 91-102):

```tsx
              <td className="px-4 py-2 text-right">
                <button className={btnGhost} onClick={() => navigate(`/workspaces/${wsId}/agents/${a.id}`)}>Open</button>
                <button
                  className={btnDanger}
                  onClick={async () => {
                    await agentsApi.remove(wsId, a.id);
                    await refresh();
                  }}
                >
                  Delete
                </button>
              </td>
```

Replace with:

```tsx
              <td className="px-4 py-2 text-right">
                <button className={btnGhost} onClick={() => navigate(`/workspaces/${wsId}/agents/${a.id}`)}>Open</button>
              </td>
```

- [ ] **Step 2: Drop the now-unused `btnDanger` import**

Replace line 5:

```tsx
import { btnPrimary, btnGhost, card } from "../../routes/admin-styles.ts";
```

(`refresh` is still used by the `useEffect` on line 27, so it stays.)

---

### Task 9: Final verification — typecheck

- [ ] **Step 1: Typecheck the web package**

Run: `npx tsc --noEmit -p packages/web`
Expected: exit code 0, no output.

If errors appear, fix them in the relevant task's file and re-run until clean. **No commit** — leave changes in the working tree for review.

---

## Self-Review

**Spec coverage:**
- Run now greyed + tooltip when disabled → Task 3 ✓
- Enable-while-dirty blocked with "Save your changes before enabling." → Task 4 ✓
- Permissions read-only when enabled (ToolsPicker `disabled`) → Tasks 1 + 2 ✓
- Remove delete from agent list → Task 8 ✓
- New red "Delete agent" tab, separated → Tasks 5 + 7 ✓
- Type-the-name confirmation; blocked while enabled → Task 6 ✓
- On success navigate back to agents list → Task 7 (`onDeleted={() => navigate(backTo)}`) ✓

**Placeholder scan:** none — every code step shows full content.

**Type consistency:** `SectionId` adds `"delete"` (Task 5) and the matching render branch uses `"delete"` (Task 7). `DeleteSection` props `{ a, wsId, locked, onDeleted }` (Task 6) match the call site (Task 7). `ToolsPicker` `disabled?: boolean` (Task 1) matches `<ToolsPicker disabled={locked} />` (Task 2). `agentsApi.remove(wsId, a.id): Promise<void>` matches usage (Task 6).
