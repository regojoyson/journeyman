# Custom Step List — Status Chips Design

**Date:** 2026-06-20
**Status:** Approved

## Problem

The custom steps list table renders status with the generic gray `codePill`
style (`enabled ? "enabled" : "draft"`), so the two states are not visually
distinguishable. The flows table already renders status as a **colored** chip
(green for "Ready", amber for "Draft"), but that badge is an inline,
non-reusable helper. We want the custom steps table to use the same colored
chip treatment.

## Goal

Give the custom steps status column the same colored-chip treatment as the
flows table, by extracting the flows badge into a single shared component used
by both tables.

## Current State

- **Flows table** — `packages/web/src/routes/FlowsListPage.tsx:55-65`
  Inline `statusBadge` helper. Styling:
  - container: `inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide`
  - `success` tone (status `"ready"`, label `"Ready"`): `bg-success/10 text-success border-emerald-800/60`
  - `warning` tone (status `"draft"`, label `"Draft"`): `bg-warning/10 text-warning border-amber-800/60`
  - Flow status type: `WorkflowStatus = "draft" | "ready"` (`packages/core/src/types/flow.types.ts`).

- **Custom steps table** — `packages/web/src/components/custom-steps/CustomStepsList.tsx:188`
  Renders `<span className={codePill}>{p.enabled ? "enabled" : "draft"}</span>`.
  Status source is the boolean `enabled` field on `CustomAiStep`
  (`packages/core/src/types/custom-steps.types.ts`). No color differentiation.

- `codePill` is a shared style string in `packages/web/src/routes/admin-styles.ts`
  used by other admin surfaces; it stays as-is.

## Design

### New shared component

`packages/web/src/components/StatusChip.tsx` — purely presentational. Takes a
visual `tone` and a `label`; knows nothing about flows or custom steps. Each
table maps its own data to a tone + label.

```tsx
type StatusTone = "success" | "warning";

const TONE_CLASSES: Record<StatusTone, string> = {
  success: "bg-success/10 text-success border-emerald-800/60",
  warning: "bg-warning/10 text-warning border-amber-800/60",
};

export function StatusChip({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${TONE_CLASSES[tone]}`}>
      {label}
    </span>
  );
}
```

The classes are lifted verbatim from the existing flows badge, so flows render
identically after the change.

### Call site 1 — flows table

In `FlowsListPage.tsx`, delete the inline `statusBadge` helper and render the
shared component in the status column:

```tsx
<StatusChip
  tone={f.status === "ready" ? "success" : "warning"}
  label={f.status === "ready" ? "Ready" : "Draft"}
/>
```

### Call site 2 — custom steps table

In `CustomStepsList.tsx`, replace the gray `codePill` span with:

```tsx
<StatusChip
  tone={p.enabled ? "success" : "warning"}
  label={p.enabled ? "Enabled" : "Draft"}
/>
```

`enabled === true` → green **Enabled**; `enabled === false` → amber **Draft**.

## Scope / YAGNI

- Two tones only (`success`, `warning`) — all either table needs.
- No new status fields, no backend changes, no migration.
- Not placed in `packages/theme` (the badge never lived there);
  `packages/web/src/components/` is the natural shared home alongside both
  consumers.
- `codePill` remains for its other (non-status) uses.

## Verification

- `npm run typecheck` passes.
- Preview check: flows table chips are unchanged (green Ready / amber Draft);
  custom steps table now shows green **Enabled** / amber **Draft** instead of
  gray pills.
