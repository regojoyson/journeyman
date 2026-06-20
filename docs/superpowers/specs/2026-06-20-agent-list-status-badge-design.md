# Agent List Status Badge

**Date:** 2026-06-20

## Summary

Add a styled status badge to the agent list table, following the same pattern used on the Flows list page. The badge replaces the current unstyled plain-text status cell.

## Background

`AgentsList.tsx:87` currently renders `a.enabled ? "enabled" : a.status` as plain text with no visual treatment. The Flows list page (`FlowsListPage.tsx`) uses a `statusBadge()` helper that returns a bordered, colored `<span>` — this same pattern should be applied to the agent list.

The "fields locked when enabled" behavior in `AgentDetail.tsx` (`const locked = a.enabled`) is intentional and stays unchanged.

## Design

### Badge states

| Condition | Label | Tailwind classes |
|---|---|---|
| `a.enabled === true` | Enabled | `bg-success/10 text-success border-emerald-800/60` |
| `a.enabled === false` | In Development | `bg-warning/10 text-warning border-amber-800/60` |

Common wrapper: `inline-block rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide`

### Change

**File:** `packages/web/src/components/agents/AgentsList.tsx`

1. Add `agentStatusBadge(a: Agent): React.ReactNode` helper function.
2. Replace line 87 with `{agentStatusBadge(a)}`.

No other files need to change.

## Out of scope

- AgentDetail header badge (already styled separately via `statusLabel()` + `rounded-full bg-muted`)
- Fields-locked behavior when agent is enabled (already implemented, no change)
