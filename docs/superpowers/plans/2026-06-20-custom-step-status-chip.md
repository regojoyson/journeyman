# Custom Step Status Chips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the custom steps list status as a colored chip (green Enabled / amber Draft) using a shared `StatusChip` component also adopted by the flows table.

**Architecture:** Extract the flows table's inline colored badge into a new presentational `StatusChip` component (props: `tone`, `label`). Update both the flows table and the custom steps table to use it. No backend, type, or data changes.

**Tech Stack:** React + TypeScript, Tailwind CSS (`@journeyman/web` package).

**Constraints (from user):** Work on `master` branch. No commits. Run `npm run typecheck` once at the end.

---

### Task 1: Create the shared `StatusChip` component

**Files:**
- Create: `packages/web/src/components/StatusChip.tsx`

- [ ] **Step 1: Write the component**

Create `packages/web/src/components/StatusChip.tsx` with exactly:

```tsx
type StatusTone = "success" | "warning";

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-success/10 text-success border-emerald-800/60",
  warning: "bg-warning/10 text-warning border-amber-800/60",
};

export function StatusChip({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${TONE_CLASSES[tone]}`}
    >
      {label}
    </span>
  );
}
```

The container classes and the two tone class strings are copied verbatim from the
existing flows badge so flows render identically.

---

### Task 2: Adopt `StatusChip` in the flows table

**Files:**
- Modify: `packages/web/src/routes/FlowsListPage.tsx` (remove inline `statusBadge` at lines 55-65; update the status `<td>` at line ~108)

- [ ] **Step 1: Add the import**

At the top of `FlowsListPage.tsx`, with the other component imports, add:

```tsx
import { StatusChip } from "../components/StatusChip";
```

- [ ] **Step 2: Delete the inline `statusBadge` helper**

Remove this block (currently lines 55-65):

```tsx
const statusBadge = (status: Workflow["status"]) => {
  const cls = status === "ready"
    ? "bg-success/10 text-success border-emerald-800/60"
    : "bg-warning/10 text-warning border-amber-800/60";
  const label = status === "ready" ? "Ready" : "Draft";
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  );
};
```

- [ ] **Step 3: Update the status cell**

Replace the status `<td>` (currently `<td className="px-6 py-3">{statusBadge(f.status)}</td>`) with:

```tsx
<td className="px-6 py-3">
  <StatusChip
    tone={f.status === "ready" ? "success" : "warning"}
    label={f.status === "ready" ? "Ready" : "Draft"}
  />
</td>
```

---

### Task 3: Adopt `StatusChip` in the custom steps table

**Files:**
- Modify: `packages/web/src/components/custom-steps/CustomStepsList.tsx` (status `<td>` at line ~188)

- [ ] **Step 1: Add the import**

At the top of `CustomStepsList.tsx`, with the other component imports, add:

```tsx
import { StatusChip } from "../StatusChip";
```

- [ ] **Step 2: Replace the `codePill` status cell**

Replace the current status cell:

```tsx
<td className="px-6 py-3">
  <span className={codePill}>{p.enabled ? "enabled" : "draft"}</span>
</td>
```

with:

```tsx
<td className="px-6 py-3">
  <StatusChip
    tone={p.enabled ? "success" : "warning"}
    label={p.enabled ? "Enabled" : "Draft"}
  />
</td>
```

- [ ] **Step 3: Remove the now-unused `codePill` import (only if unused)**

Check whether `codePill` is still referenced anywhere else in `CustomStepsList.tsx`.
If this was its only use, remove `codePill` from the import from `admin-styles`
(leave the other imports from that module intact). If `codePill` is used elsewhere
in the file, leave the import as-is.

---

### Task 4: Verify

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: PASS with no new errors. In particular, no "unused variable `codePill`"
or "unused `statusBadge`" / missing-import errors in the two modified files.

- [ ] **Step 2: (Optional) Preview check**

If a preview/dev server is available, confirm:
- Flows table chips unchanged — green **Ready**, amber **Draft**.
- Custom steps table now shows green **Enabled** / amber **Draft** (no longer gray pills).

Do NOT commit — leave changes in the working tree per user instruction.

---

## Notes

- `codePill` (`packages/web/src/routes/admin-styles.ts`) stays — it is used by other
  admin surfaces. Only the custom steps status usage is replaced.
- Two tones (`success`, `warning`) cover both tables; no other tones are added.
