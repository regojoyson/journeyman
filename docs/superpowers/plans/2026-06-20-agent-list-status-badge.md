# Agent List Status Badge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain-text status cell in the agents list table with a styled badge matching the pattern used on the Flows list page.

**Architecture:** Add a `agentStatusBadge()` helper directly in `AgentsList.tsx` (same approach as `statusBadge()` in `FlowsListPage.tsx`). Green badge for "Enabled", amber badge for "In Development". Single-file change — no new files, no shared component.

**Tech Stack:** React 18, Tailwind CSS v4, TypeScript

---

## File Map

| Action | File |
|---|---|
| Modify | `packages/web/src/components/agents/AgentsList.tsx` |

---

### Task 1: Add `agentStatusBadge` helper and replace the status cell

**Files:**
- Modify: `packages/web/src/components/agents/AgentsList.tsx`

- [ ] **Step 1: Open the file and locate the two edit points**

File: `packages/web/src/components/agents/AgentsList.tsx`

Edit point A — after the imports (after line 6, before the component function on line 7):
```
import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { agentsApi } from "../../api/agents.ts";
import type { Agent } from "@journeyman/core";
import { btnPrimary, btnGhost, card } from "../../routes/admin-styles.ts";
```

Edit point B — the status cell on line 87:
```tsx
<td className="px-4 py-2">{a.enabled ? "enabled" : a.status}</td>
```

- [ ] **Step 2: Insert the `agentStatusBadge` helper before the component**

Add this function between the imports and the `AgentsList` function declaration (after line 6):

```tsx
function agentStatusBadge(a: Agent) {
  const [cls, label] = a.enabled
    ? ["bg-success/10 text-success border-emerald-800/60", "Enabled"]
    : ["bg-warning/10 text-warning border-amber-800/60", "In Development"];
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  );
}
```

- [ ] **Step 3: Replace the plain-text status cell with the badge**

Replace line 87:
```tsx
<td className="px-4 py-2">{a.enabled ? "enabled" : a.status}</td>
```

With:
```tsx
<td className="px-4 py-2">{agentStatusBadge(a)}</td>
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors related to `AgentsList.tsx`. The `Agent` type is already imported; `agentStatusBadge` takes `Agent` and returns JSX — no new imports needed.
