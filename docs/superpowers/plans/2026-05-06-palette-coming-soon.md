# Palette "Coming soon" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the flow-editor palette into "Available" (rendered as today) and a collapsible "Coming soon" panel, driven by an editorial `comingSoon` flag on `PhaseDefinition`.

**Architecture:** Add an optional boolean to `PhaseDefinition`. In `Palette.tsx`, partition entries into available (grouped by category, draggable) and coming-soon (flat list, muted, non-draggable) and render the latter in a collapsible panel persisted to `localStorage`. Pass a `disabled` prop into `PaletteItem` to mute styling and disable drag. Add CSS for the new states.

**Tech Stack:** TypeScript, React, plain CSS (no test framework changes; per user direction, no unit tests are added in this plan).

**Per user direction:**
- No commits during implementation.
- No unit tests.
- Run `npm run typecheck` at the very end to validate.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/flow-editor/src/phase-definition.ts` | Modify | Add `comingSoon?: boolean` to `PhaseDefinition`. |
| `packages/flow-editor/src/palette/PaletteItem.tsx` | Modify | Accept `disabled?: boolean`; mute appearance and disable drag when set. |
| `packages/flow-editor/src/palette/Palette.tsx` | Modify | Partition entries; render available groups as today and a collapsible "Coming soon" panel below; persist toggle in `localStorage`. |
| `packages/flow-editor/src/styles.css` | Modify | Styles for `.je-palette__item--disabled`, `.je-palette__coming-soon-header`, `.je-palette__coming-soon-body`. |

---

## Task 1: Add `comingSoon` flag to `PhaseDefinition`

**Files:**
- Modify: `packages/flow-editor/src/phase-definition.ts`

- [ ] **Step 1: Add the optional flag**

In [packages/flow-editor/src/phase-definition.ts](../../../packages/flow-editor/src/phase-definition.ts), inside the `PhaseDefinition<TConfig>` interface, immediately after the `outputSchema?: OutputSchema;` field (currently the last field, around line 118), add:

```ts
  /** When true, this phase is shown in the palette's collapsible
   *  "Coming soon" panel and cannot be dragged onto the canvas.
   *  Default: false (available). Editorial flag — not derived from
   *  provider implementation status. */
  comingSoon?: boolean;
```

No other changes in this file.

---

## Task 2: Add `disabled` support to `PaletteItem`

**Files:**
- Modify: `packages/flow-editor/src/palette/PaletteItem.tsx`

- [ ] **Step 1: Extend the props interface**

In [packages/flow-editor/src/palette/PaletteItem.tsx](../../../packages/flow-editor/src/palette/PaletteItem.tsx), change `PaletteItemProps` to:

```ts
export interface PaletteItemProps {
  entry: PaletteItemEntryLike;
  /** When true, the item is rendered muted, is not draggable, and shows
   *  a "Coming soon" tooltip via the title attribute. */
  disabled?: boolean;
}
```

- [ ] **Step 2: Use `disabled` in the component**

Replace the entire `PaletteItem` function body (everything from `export function PaletteItem` through its closing `}`) with:

```tsx
export function PaletteItem({ entry, disabled = false }: PaletteItemProps) {
  const itemRef = useRef<HTMLDivElement>(null);
  const [popPos, setPopPos] = useState<{ top: number; left: number } | null>(null);

  const onDragStart = (ev: React.DragEvent) => {
    if (disabled) {
      ev.preventDefault();
      return;
    }
    const value = entry.phaseType ?? entry.nodeType ?? "";
    ev.dataTransfer.setData(entry.dragMime, value);
    ev.dataTransfer.effectAllowed = "move";
    setPopPos(null);
  };

  const onMouseEnter = () => {
    if (!entry.description) return;
    const rect = itemRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPopPos({ top: rect.top, left: rect.right + 8 });
  };

  const onMouseLeave = () => setPopPos(null);

  const className = disabled
    ? "je-palette__item je-palette__item--disabled"
    : "je-palette__item";

  return (
    <div
      ref={itemRef}
      className={className}
      draggable={!disabled}
      onDragStart={onDragStart}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      title={disabled ? "Coming soon — not yet available" : undefined}
      aria-disabled={disabled || undefined}
    >
      <div className="je-palette__icon" style={{ background: entry.color }}>{entry.icon}</div>
      <span className="je-palette__label">{entry.label}</span>
      {entry.description && (
        <span className="je-palette__info" aria-label="info">i</span>
      )}
      {popPos && entry.description && createPortal(
        <div
          className="je-palette__popover"
          style={{ position: "fixed", top: popPos.top, left: popPos.left }}
        >
          <div className="je-palette__popover-title">{entry.label}</div>
          <div className="je-palette__popover-desc">{entry.description}</div>
        </div>,
        document.body,
      )}
    </div>
  );
}
```

Notes:
- The hover popover (description tooltip) is preserved for disabled items so users can still read what the phase is about.
- The `title` attribute supplies the native "Coming soon" tooltip, which appears in addition (browsers handle that fine).

---

## Task 3: Partition entries and render "Coming soon" panel in `Palette.tsx`

**Files:**
- Modify: `packages/flow-editor/src/palette/Palette.tsx`

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of [packages/flow-editor/src/palette/Palette.tsx](../../../packages/flow-editor/src/palette/Palette.tsx) with:

```tsx
// packages/flow-editor/src/palette/Palette.tsx
import { useEffect, useMemo, useState } from "react";
import { PaletteItem } from "./PaletteItem.tsx";
import type { ControlNodeCatalog } from "../types.ts";
import type { PhaseDefinition } from "../phase-definition.ts";

const COMING_SOON_LS_KEY = "flow-editor.palette.comingSoon";

export interface PaletteProps {
  phases: PhaseDefinition<any>[];
  controlCatalog?: ControlNodeCatalog;
}

type AnyEntry =
  | {
      kind: "phase";
      phaseType: string;
      label: string;
      category: string;
      color: string;
      icon: string;
      description?: string;
      comingSoon: boolean;
    }
  | {
      kind: "control";
      nodeType: string;
      label: string;
      category: string;
      color: string;
      icon: string;
      description?: string;
      comingSoon: false;
    };

function entryKey(e: AnyEntry): string {
  return e.kind === "phase" ? `phase:${e.phaseType}` : `control:${e.nodeType}`;
}

function entryDragMime(e: AnyEntry): string {
  return e.kind === "phase"
    ? "application/journeyman-phase"
    : "application/journeyman-control";
}

export function Palette({ phases, controlCatalog }: PaletteProps) {
  const entries = useMemo<AnyEntry[]>(() => [
    ...phases.map((p): AnyEntry => ({
      kind: "phase",
      phaseType: p.phaseType,
      label: p.label,
      category: p.category,
      color: p.color,
      icon: p.icon,
      description: p.description,
      comingSoon: p.comingSoon === true,
    })),
    ...(controlCatalog ?? []).map((c): AnyEntry => ({
      kind: "control",
      nodeType: c.nodeType,
      label: c.label,
      category: c.category,
      color: c.color,
      icon: c.icon,
      description: c.description,
      comingSoon: false,
    })),
  ], [phases, controlCatalog]);

  const available = useMemo(
    () => entries.filter(e => !e.comingSoon),
    [entries],
  );
  const comingSoon = useMemo(
    () => entries.filter(e => e.comingSoon),
    [entries],
  );

  const grouped = useMemo(() => {
    const m = new Map<string, AnyEntry[]>();
    for (const e of available) {
      const arr = m.get(e.category) ?? [];
      arr.push(e);
      m.set(e.category, arr);
    }
    return [...m.entries()];
  }, [available]);

  const [csOpen, setCsOpen] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(COMING_SOON_LS_KEY) === "true";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(COMING_SOON_LS_KEY, String(csOpen));
  }, [csOpen]);

  return (
    <aside className="je-editor__palette">
      <div
        className="je-palette__title"
        style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}
      >
        Phases
      </div>

      {grouped.map(([cat, items]) => (
        <div key={cat}>
          <div className="je-palette__group">{cat}</div>
          {items.map(it => (
            <PaletteItem
              key={entryKey(it)}
              entry={{ ...it, dragMime: entryDragMime(it) }}
            />
          ))}
        </div>
      ))}

      {comingSoon.length > 0 && (
        <div className="je-palette__coming-soon">
          <button
            type="button"
            className="je-palette__coming-soon-header"
            aria-expanded={csOpen}
            onClick={() => setCsOpen(o => !o)}
          >
            <span className="je-palette__coming-soon-caret">{csOpen ? "▾" : "▸"}</span>
            <span className="je-palette__coming-soon-label">Coming soon</span>
            <span className="je-palette__coming-soon-count">({comingSoon.length})</span>
          </button>
          {csOpen && (
            <div className="je-palette__coming-soon-body">
              {comingSoon.map(it => (
                <PaletteItem
                  key={entryKey(it)}
                  entry={{ ...it, dragMime: entryDragMime(it) }}
                  disabled
                />
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
```

Behavior locked in by this task:
- Available entries render exactly as today, grouped by category.
- The "Coming soon" panel is hidden entirely when `comingSoon.length === 0`.
- Default state is collapsed (`localStorage` value defaults to absent → `false`).
- Toggle state persists across reloads under the key `flow-editor.palette.comingSoon`.

---

## Task 4: Add CSS for the disabled item state and the collapsible panel

**Files:**
- Modify: `packages/flow-editor/src/styles.css`

- [ ] **Step 1: Append new rules**

Append the following block to the end of [packages/flow-editor/src/styles.css](../../../packages/flow-editor/src/styles.css):

```css
/* Coming-soon palette items + panel */
.je-palette__item--disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.je-palette__item--disabled:hover { background: #1f1f2c; }

.je-palette__coming-soon { margin-top: 12px; }

.je-palette__coming-soon-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  background: transparent;
  border: none;
  padding: 6px 4px;
  margin-bottom: 4px;
  color: #888;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: pointer;
  text-align: left;
}
.je-palette__coming-soon-header:hover { color: #b8b8c4; }

.je-palette__coming-soon-caret {
  display: inline-block;
  width: 10px;
  font-size: 10px;
}

.je-palette__coming-soon-label { flex: 0 0 auto; }
.je-palette__coming-soon-count { color: #555; }

.je-palette__coming-soon-body { display: block; }
```

No changes to existing rules.

---

## Task 5: Type-check the workspace

**Files:** _(none — verification only)_

- [ ] **Step 1: Run typecheck from the repo root**

Run:

```bash
npm run typecheck
```

Expected: command exits with status `0` and no TypeScript errors. If any errors surface, fix them in the file(s) reported and re-run until clean.

- [ ] **Step 2: Manual smoke check (optional, no automated test)**

Open the flow editor in the running web app and confirm:
1. With no phase flagged `comingSoon: true`, the palette looks identical to before and the "Coming soon" header is absent.
2. After flagging one phase definition with `comingSoon: true` (e.g., temporarily on any phase in `packages/phases/src/registry.ts` exports), the palette shows a "Coming soon (1)" header below the existing groups; that phase no longer appears in its category.
3. Clicking the header expands to show the muted, non-draggable item with a "Coming soon — not yet available" tooltip on hover.
4. Reload the page — the open/closed state of the panel persists.
5. Drag attempts on the disabled item do nothing (no node is created on the canvas).

Revert any temporary `comingSoon: true` flag added purely for the smoke check before stopping.

---

## Self-review notes

- **Spec coverage:** Task 1 covers data model. Task 2 covers item disabled rendering + non-draggable + tooltip. Task 3 covers partitioning, the collapsible panel, count badge, hidden when empty, default collapsed, `localStorage` persistence, control-nodes always available. Task 4 covers visual styling. Task 5 covers verification (typecheck) and manual smoke. No spec items left uncovered.
- **Placeholders:** None.
- **Type consistency:** `comingSoon` is `boolean` everywhere it appears; `disabled` prop on `PaletteItem` is `boolean`. `localStorage` key string literal is centralized in a single `const`.
- **No commits / no unit tests:** Per user direction.
