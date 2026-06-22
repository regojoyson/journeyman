# Agent-run logs fill height + auto-scroll — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agent-run detail page's Logs tab fill the viewport and scroll internally with working auto-scroll, without affecting the workflow-instance logs view that shares the same component.

**Architecture:** Two additive changes. (1) `WorkflowLogsPanel` gets a `--fill` modifier class applied only in its existing tab-owned mode (`height == null`), backed by one new CSS rule, so the panel fills any flex-column parent. (2) `AgentRunDetailPage` becomes a full-height flex column so the panel has a real bounded height to fill, with Details/Tokens tabs wrapped in their own internal-scroll containers.

**Tech Stack:** React 18 + TypeScript, Tailwind utility classes (web), plain CSS (run-viewer), Vite. Verification via the `Claude_Preview` dev server + `npm run check`.

**Working branch:** `master` (per request — no new branch).

**Commits:** None. Do **not** `git add`/`git commit`/`git push` at any point. Leave all changes in the working tree.

**Spec:** [docs/superpowers/specs/2026-06-22-agent-run-logs-fill-height-design.md](../specs/2026-06-22-agent-run-logs-fill-height-design.md)

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/run-viewer/src/styles.css` | run-viewer component styles | Add one rule: `.je-runview__logspanel--fill`. |
| `packages/run-viewer/src/logs/WorkflowLogsPanel.tsx` | Shared logs panel (both views) | Append `--fill` class on the root only when `height == null`. |
| `packages/web/src/routes/AgentRunDetailPage.tsx` | Agent-run detail page (Details/Logs/Tokens tabs) | Full-height flex-column tab body; per-tab scroll wrappers. |

No other files change. No new dependencies, no `@journeyman/core` changes, no API changes.

---

## Pre-flight: confirm the two callers

- [ ] **Step 1: Verify there are exactly two callers and how each passes `height`**

Run:
```bash
grep -rn "WorkflowLogsPanel" packages/web/src packages/run-viewer/src --include="*.tsx" | grep -v "\.test\." | grep -v "index.ts"
```

Expected: matches in only two render sites —
- `packages/run-viewer/src/RunViewer.tsx` (passes `height={logsHeight}` — workflow-instance view, must stay unchanged)
- `packages/web/src/routes/AgentRunDetailPage.tsx` (no `height` — agent-run view, the one being fixed)

If a third render caller appears, stop and re-evaluate the isolation guarantee before continuing.

---

## Task 1: Add the `--fill` CSS rule (run-viewer)

**Files:**
- Modify: `packages/run-viewer/src/styles.css:89`

- [ ] **Step 1: Add the modifier rule directly after the base `.je-runview__logspanel` rule**

The base rule is currently (line 89):
```css
.je-runview__logspanel { display: flex; flex-direction: column; background: rgb(var(--color-bg) / 1); border-top: 1px solid rgb(var(--color-border) / 1); min-height: 0; }
```

Leave that line exactly as-is. Insert a new line immediately after it:
```css
.je-runview__logspanel--fill { flex: 1 1 auto; min-height: 0; height: 100%; }
```

Rationale: `flex: 1 1 auto; min-height: 0` makes the panel fill a flex-column parent; `height: 100%` covers a non-flex definite-height parent. This class is only ever attached in tab-owned mode (Task 2), so it cannot affect the workflow-instance view.

- [ ] **Step 2: Confirm no other rule was touched**

Run:
```bash
git diff packages/run-viewer/src/styles.css
```

Expected: a single added line (`.je-runview__logspanel--fill { ... }`). The base `.je-runview__logspanel` and `.je-runview__logspanel-list` rules are unchanged.

---

## Task 2: Apply `--fill` only in tab-owned mode (WorkflowLogsPanel)

**Files:**
- Modify: `packages/run-viewer/src/logs/WorkflowLogsPanel.tsx:183-184`

- [ ] **Step 1: Replace the panel root element to conditionally append the modifier**

Current code (lines 183-184):
```tsx
  return (
    <div className="je-runview__logspanel" style={props.height != null ? { height: props.height } : undefined}>
```

Replace with:
```tsx
  return (
    <div
      className={`je-runview__logspanel${props.height == null ? " je-runview__logspanel--fill" : ""}`}
      style={props.height != null ? { height: props.height } : undefined}
    >
```

Notes:
- When `height != null` (workflow-instance view): class string is exactly `"je-runview__logspanel"` and `style={{ height }}` is applied — identical to before. The drag handle (already gated on `height != null`) still renders.
- When `height == null` (agent-run view): class becomes `"je-runview__logspanel je-runview__logspanel--fill"` and `style` is `undefined`. The drag handle is already `null` in this mode.

- [ ] **Step 2: Confirm the diff is a no-op for the height-provided path**

Run:
```bash
git diff packages/run-viewer/src/logs/WorkflowLogsPanel.tsx
```

Expected: only the root `<div>` opening tag changed; the `style` ternary is byte-for-byte the same logic; no other lines touched.

---

## Task 3: Full-height flex-column tab body (AgentRunDetailPage)

**Files:**
- Modify: `packages/web/src/routes/AgentRunDetailPage.tsx:283-314`

This converts the chain from the (already `h-full flex flex-col overflow-hidden`) page root down to the content panel into a definite-height flex column, so the no-height logs panel has a real height to fill. Details and Tokens get their own internal-scroll wrappers so their current behavior is preserved.

- [ ] **Step 1: Replace the scrollable body block**

Current code (lines 283-314):
```tsx
      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
        <div className={`${card} overflow-hidden`}>
          <div className="flex min-h-[500px]">

            {/* Sidebar nav */}
            <aside className="w-44 shrink-0 border-r p-3">
              <RunSectionNav active={section} onSelect={setSection} />
            </aside>

            {/* Content panel */}
            <div className="flex-1 p-6">
              {section === "details" && (
                <RunDetailsPanel
                  wi={wi}
                  provider={provider}
                  model={model}
                  isRunning={isRunning}
                  repoName={repoName}
                  prUrl={prUrl}
                  prNumber={prNumber}
                  displayInputs={displayInputs}
                  outputText={outputText}
                />
              )}
              {section === "logs" && <RunLogsPanel events={allEvents} />}
              {section === "tokens" && <RunTokensPanel />}
            </div>

          </div>
        </div>
      </div>
```

Replace with:
```tsx
      {/* Body — full-height flex column so the Logs tab can fill and scroll internally */}
      <div className="flex-1 min-h-0 px-6 py-6">
        <div className={`${card} h-full overflow-hidden`}>
          <div className="flex h-full min-h-0">

            {/* Sidebar nav */}
            <aside className="w-44 shrink-0 border-r p-3">
              <RunSectionNav active={section} onSelect={setSection} />
            </aside>

            {/* Content panel */}
            <div className="flex-1 min-h-0 flex flex-col">
              {section === "details" && (
                <div className="flex-1 min-h-0 overflow-y-auto p-6">
                  <RunDetailsPanel
                    wi={wi}
                    provider={provider}
                    model={model}
                    isRunning={isRunning}
                    repoName={repoName}
                    prUrl={prUrl}
                    prNumber={prNumber}
                    displayInputs={displayInputs}
                    outputText={outputText}
                  />
                </div>
              )}
              {section === "logs" && <RunLogsPanel events={allEvents} />}
              {section === "tokens" && (
                <div className="flex-1 min-h-0 overflow-y-auto p-6">
                  <RunTokensPanel />
                </div>
              )}
            </div>

          </div>
        </div>
      </div>
```

Key changes:
- Body: removed `overflow-y-auto` (page no longer scrolls; it's now a fixed-height region).
- Card: added `h-full` so it fills the body height.
- Row: `min-h-[500px]` → `h-full min-h-0`.
- Content panel: `flex-1 p-6` → `flex-1 min-h-0 flex flex-col`; the shared `p-6` is removed and reapplied per-tab.
- Details/Tokens: wrapped in `flex-1 min-h-0 overflow-y-auto p-6` (internal scroll, preserved behavior).
- Logs: rendered directly into the flex column (no padding wrapper) so the panel fills; `RunLogsPanel` still calls `WorkflowLogsPanel` with no `height`.

- [ ] **Step 2: Confirm `RunLogsPanel` is unchanged and still passes no `height`**

`RunLogsPanel` (lines 121-130) is untouched — it must continue to render:
```tsx
    <WorkflowLogsPanel
      events={events}
      nodes={[]}
      onClose={() => {}}
      hideStepChips
    />
```
No `height` prop = tab-owned mode = `--fill` applies. Do not add a `height` here.

---

## Task 4: Typecheck + import boundaries

- [ ] **Step 1: Run the combined check**

Run:
```bash
npm run check
```

Expected: typecheck passes and import-boundary check passes with no errors. (`npm run check` runs `npm run typecheck` + `npm run check:boundaries`.)

If TypeScript errors appear, fix them in the touched files only — no behavioral changes beyond the spec.

---

## Task 5: Visual verification (preview)

Use the `Claude_Preview` tools (not Bash) per the harness verification workflow. Do not ask the user to check manually.

- [ ] **Step 1: Start / ensure the dev server is running**

`preview_start` (or reuse a running server). The web app is the Vite frontend; navigate to an agent-run detail page that has many log events: `/workspaces/:wsId/agent-runs/:runId`, then select the **Logs** tab.

- [ ] **Step 2: Verify Logs tab fills and scrolls internally**

- `preview_snapshot` — the log list is inside a bounded scroll area filling the tab; the page body does not grow.
- `preview_inspect` on the list (`.je-runview__logspanel-list`) — confirm it has a constrained height and `overflow: auto` produces a scrollbar (scrollHeight > clientHeight).
- `preview_console_logs` / `preview_logs` — no new errors.

- [ ] **Step 3: Verify auto-scroll on live events**

On a running run (live SSE), confirm the list auto-scrolls to the newest entry. Then toggle **Auto-scroll** off, scroll up via `preview_eval`, and confirm position holds as events arrive.

- [ ] **Step 4: Verify Details and Tokens tabs still scroll normally**

Switch tabs; confirm long Details content scrolls within its own area and the layout is intact.

- [ ] **Step 5: Regression-check the workflow-instance logs view**

Open a workflow-instance run (`/workspaces/:wsId/workflow-instances/:id`), open the logs panel:
- It opens at its fixed height, the drag handle still resizes it, and auto-scroll still follows new events.
- `preview_inspect` the panel root — class is exactly `je-runview__logspanel` (no `--fill`) and it carries an inline `height` style.

- [ ] **Step 6: Share proof**

`preview_screenshot` of the working agent-run Logs tab (scrolled/auto-following) and of the unchanged workflow-instance logs panel.

---

## Done criteria

- Agent-run Logs tab fills the viewport, scrolls internally, and auto-scroll follows live events.
- Details/Tokens tabs scroll within their own areas; page does not grow on the Logs tab.
- Workflow-instance logs view is visually and behaviorally unchanged (no `--fill`, fixed height + resize + auto-scroll intact).
- `npm run check` passes.
- No commits made; all changes left in the working tree on `master`.

---

## Self-review notes

- **Spec coverage:** Change 1 (component `--fill`) → Tasks 1–2; Change 2 (page flex layout) → Task 3; isolation guarantee → Pre-flight + Task 2 Step 2 + Task 5 Step 5; verification list → Task 5; `npm run check` → Task 4. All spec sections mapped.
- **Placeholders:** none — every code step shows the exact before/after.
- **Type consistency:** no new types/functions introduced; prop usage (`height`, `events`, `nodes`, `onClose`, `hideStepChips`) matches `WorkflowLogsPanelProps`.
- **User constraints applied:** master branch, no commits, single typecheck at end.
