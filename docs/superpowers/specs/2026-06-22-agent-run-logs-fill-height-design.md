# Agent-run logs: fill viewport + working auto-scroll

**Date:** 2026-06-22
**Status:** Design approved, pending implementation
**Scope:** UI bug fix — `packages/web`, `packages/run-viewer`

## Problem

The agent-run detail page's **Logs** tab does not have a bounded height, and its
auto-scroll (follow-new-logs) does not work. The workflow-instance logs view —
which uses the *same* component — works correctly.

### Root cause

Both views render the same `WorkflowLogsPanel`
([packages/run-viewer/src/logs/WorkflowLogsPanel.tsx](../../../packages/run-viewer/src/logs/WorkflowLogsPanel.tsx)).
The component supports two layout modes:

- **Fixed-height mode** — caller passes a `height` prop. The panel root gets
  `style={{ height }}` and, as a flex column, constrains its inner list
  (`.je-runview__logspanel-list`: `flex: 1 1 auto; min-height: 0` +
  `.je-runview__log`: `overflow: auto`) to a bounded height. The list becomes a
  real scroll container, so `scrollerRef.scrollTop = scrollHeight` (the
  auto-scroll) works.

- **Tab-owned mode** — caller omits `height` (the comment says "CSS controls
  it"). But the CSS provides **no** height constraint in this mode, and the
  agent-run page provides **no** bounded-height ancestor either. The panel grows
  to fit all logs, the inner list never overflows, and the *page* scrolls
  instead. Auto-scroll silently no-ops because the element it targets is never a
  scroll container.

The workflow-instance view ([RunViewer.tsx:143](../../../packages/run-viewer/src/RunViewer.tsx))
always passes `height={logsHeight}` → fixed-height mode → works.

The agent-run view ([AgentRunDetailPage.tsx:121](../../../packages/web/src/routes/AgentRunDetailPage.tsx))
calls it without `height` and inside a page-scroll layout → tab-owned mode with
no real height → broken.

There are exactly two callers; this difference is the whole bug.

## Goal

The agent-run Logs tab fills the remaining viewport height and scrolls
internally like a terminal console, with auto-scroll following new live events —
matching the workflow-instance experience. The Details and Tokens tabs keep
their current behavior. The workflow-instance view is provably unaffected.

## Design

Two coordinated changes. The component change is **purely additive** and gated
on the existing `height == null` distinction, so the workflow-instance path is a
no-op.

### 1. `WorkflowLogsPanel` + `run-viewer/styles.css` — make tab-owned mode fill its parent

When `height` is omitted, give the panel root a modifier class
`je-runview__logspanel--fill` so it fills any flex-column / definite-height
parent:

```css
.je-runview__logspanel--fill { flex: 1 1 auto; min-height: 0; }
```

In the component, append the modifier only in tab-owned mode:

```tsx
const fillClass = props.height == null ? " je-runview__logspanel--fill" : "";
return (
  <div
    className={`je-runview__logspanel${fillClass}`}
    style={props.height != null ? { height: props.height } : undefined}
  >
```

- The base `.je-runview__logspanel` rule and the shared
  `.je-runview__logspanel-list` rule are **not** modified.
- The modifier activates only when `height == null` — i.e. only the agent-run
  caller. The workflow-instance caller always passes a numeric `height`, so it
  never receives the modifier; its inline `style={{ height }}`, drag handle, and
  resize logic are unchanged.
- The drag handle is already `null` when `height == null`, so tab-owned mode
  remains handle-free ("fill, no resize").

Once the panel has a bounded flex height, the inner list's existing
`overflow: auto` makes it a true scroll container and the existing auto-scroll
`useLayoutEffect` works with no change.

### 2. `AgentRunDetailPage.tsx` — make the tab body a full-height flex column

Convert the chain from the page root down to the content panel into a
definite-height flex column so the panel has a real height to fill. The page
root is already `h-full flex flex-col overflow-hidden`; the header is already
`shrink-0`.

- **Body:** `flex-1 min-h-0 overflow-y-auto px-6 py-6` → `flex-1 min-h-0 px-6 py-6`
  (remove page scroll; the body is now a fixed-height region).
- **Card:** add `h-full` so it fills the body height.
- **Row:** `flex min-h-[500px]` → `flex h-full min-h-0`.
- **Content panel:** `flex-1 p-6` → `flex-1 min-h-0 flex flex-col` (drop the
  shared `p-6`; padding is reapplied per tab below).
- **Details / Tokens tabs:** wrap each in
  `<div className="flex-1 min-h-0 overflow-y-auto p-6">` so they scroll
  internally if content is long — behavior preserved, now self-contained.
- **Logs tab:** render `<RunLogsPanel events={allEvents} />` directly in the
  flex-column content panel (no padding wrapper) so it fills. `RunLogsPanel`
  continues to call `WorkflowLogsPanel` without `height`.

The sidebar `<aside className="w-44 shrink-0 border-r p-3">` is unchanged.

## Components touched

| File | Change |
|---|---|
| `packages/run-viewer/src/logs/WorkflowLogsPanel.tsx` | Append `--fill` class when `height == null` (additive). |
| `packages/run-viewer/src/styles.css` | Add `.je-runview__logspanel--fill` rule. |
| `packages/web/src/routes/AgentRunDetailPage.tsx` | Full-height flex-column tab layout; per-tab scroll wrappers. |

No new dependencies, no API changes, no `@journeyman/core` changes.

## Isolation guarantee (workflow-instance view)

- Only two callers exist (verified via grep).
- The workflow-instance caller always passes a numeric `height` →
  `height != null` → no `--fill` modifier, inline height sizing retained, drag
  handle retained, resize callback retained.
- No base or shared CSS rule is modified.
- Net effect on the workflow-instance view: same props in → same DOM + styles
  out.

## Verification

1. Open an agent run with many log events → switch to **Logs**: the list scrolls
   inside a bounded area that fills the viewport; the page itself does not grow.
2. With a live (running) agent run, new events auto-scroll to the bottom.
3. Toggle **Auto-scroll** off, scroll up → position holds as new events arrive.
4. **Details** and **Tokens** tabs still scroll normally when content is long.
5. Open a **workflow-instance** run → logs panel still opens at its fixed height,
   the drag handle still resizes it, and auto-scroll still follows new events —
   unchanged from today.
6. `npm run check` (typecheck + import boundaries) passes.

## Out of scope

- Resizable height on the agent-run Logs tab (Option A is fill-to-viewport, no
  resize handle).
- Any change to log parsing, filtering, or the event stream.
- Token-usage panel content (still a placeholder).
