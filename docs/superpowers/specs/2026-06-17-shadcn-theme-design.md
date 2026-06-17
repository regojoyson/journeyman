# shadcn Theme Adoption — Design

**Date:** 2026-06-17
**Status:** Approved (brainstorming)

## Goal

Adopt the shadcn/ui visual language across the Journeyman web UI — the **zinc** base neutral with a **monochrome primary** (near-black buttons in light, near-white in dark) — by making shadcn's token system the source of truth, while keeping every existing component working.

## Decisions (locked)

- **Primary:** monochrome / neutral (authentic shadcn). No brand hue for primary actions, links, active-nav, focus, or flow-editor node accents. Semantic status colors (success/warning/danger/info) are kept for run state, badges, and `destructive`.
- **Base neutral:** zinc.
- **Adoption strategy:** Approach A — shadcn tokens become canonical; the existing `--color-*` tokens are re-pointed as **aliases** to them, so all current components inherit the new look with no per-component rewrite. Signature components are then restyled onto native shadcn classes for authenticity.
- **Theme switch mechanism:** unchanged — `[data-theme="light"]` / `[data-theme="dark"]` on `<html>` (the app's existing `ThemeProvider`). Not shadcn's `.dark` class.
- **Token value format:** RGB triplets consumed via `rgb(var(--token) / <alpha>)`, consistent with the existing system (not HSL/oklch). shadcn class names still resolve through the Tailwind preset, so pasted shadcn components work via classes.

## Architecture

Three layers, in `packages/theme`:

1. **shadcn token set** (`tokens.css`) — canonical variables in zinc/monochrome values, defined per `[data-theme]` block.
2. **Legacy aliases** (`tokens.css`) — existing `--color-*` variables re-pointed at the shadcn tokens. This is what propagates the look to all current components and the `styles.css` files (`flow-editor`, `run-viewer`, `runs-list`) with zero edits there.
3. **Tailwind preset** (`tailwind-preset.js`) — exposes shadcn color names + a radius scale derived from `--radius`; keeps the semantic names (now aliased).

### Token values

RGB triplets. Dark `card` is **elevated** (lighter than `background`) — this fixes the prior recessed-card / hard-outline problem.

| Token | Light | Dark |
|---|---|---|
| `--background` | `255 255 255` | `9 9 11` |
| `--foreground` | `9 9 11` | `250 250 250` |
| `--card`, `--popover` | `255 255 255` | `24 24 27` |
| `--card-foreground`, `--popover-foreground` | `9 9 11` | `250 250 250` |
| `--primary` | `24 24 27` | `250 250 250` |
| `--primary-foreground` | `250 250 250` | `24 24 27` |
| `--secondary`, `--muted`, `--accent` | `244 244 245` | `39 39 42` |
| `--secondary-foreground`, `--accent-foreground` | `24 24 27` | `250 250 250` |
| `--muted-foreground` | `113 113 122` | `161 161 170` |
| `--border`, `--input` | `228 228 231` | `39 39 42` |
| `--ring` | `161 161 170` | `82 82 91` |
| `--destructive` | `220 38 38` | `239 68 68` |
| `--destructive-foreground` | `250 250 250` | `250 250 250` |
| `--radius` | `0.625rem` | `0.625rem` |

Status hues keep their existing `--color-success` / `--color-warning` / `--color-info` names and current green/amber/blue values per theme (used by run-state pills/badges). The flow-editor canvas tokens (`--color-canvas`, `--color-canvas-dot`) and `--color-overlay` are retained.

### Alias mapping (legacy → shadcn)

| Legacy `--color-*` | → shadcn |
|---|---|
| `--color-bg` | `--background` |
| `--color-surface` | `--card` |
| `--color-surface-raised` | `--card` |
| `--color-surface-hover` | `--accent` |
| `--color-surface-active` | `--accent` |
| `--color-border` | `--border` |
| `--color-border-strong` | `--border` |
| `--color-text` | `--foreground` |
| `--color-text-muted` | `--muted-foreground` |
| `--color-text-subtle` | `--muted-foreground` |
| `--color-accent` | `--primary` |
| `--color-accent-hover` | `--primary` |
| `--color-danger` | `--destructive` |
| `--color-success` / `--color-warning` / `--color-info` | unchanged (semantic) |

CSS-variable indirection works because `--color-bg: var(--background)` resolves the triplet, and `rgb(var(--color-bg) / 1)` then renders it. The Tailwind-v4 default-border base rule (`*,::before,::after { border-color: rgb(var(--color-border) / 1) }`, already added) keeps working via the alias.

### Tailwind preset

Add color names (each `rgb(var(--NAME) / <alpha-value>)`): `background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground`, `primary`, `primary-foreground`, `secondary`, `secondary-foreground`, `muted`, `muted-foreground`, `accent`, `accent-foreground`, `destructive`, `destructive-foreground`, `border`, `input`, `ring`. Keep the existing semantic names. Add a radius scale: `lg → var(--radius)`, `md → calc(var(--radius) - 2px)`, `sm → calc(var(--radius) - 4px)`, `xl → calc(var(--radius) + 4px)`.

### Signature component restyle

- **Buttons** (`packages/web/src/routes/admin-styles.ts`, flow-editor topbar `Topbar.tsx`):
  - primary → `bg-primary text-primary-foreground hover:bg-primary/90`
  - secondary / cancel → `bg-secondary text-secondary-foreground hover:bg-secondary/80`
  - ghost → `hover:bg-accent hover:text-accent-foreground` (text `text-muted-foreground`)
  - destructive → `text-destructive hover:bg-destructive/10` (quiet) for row actions; `bg-destructive text-destructive-foreground` for primary destructive
  - flow-editor `.primary` (green Save) → neutral primary (status-green reserved for run state)
- **Inputs / selects** (`admin-styles.ts inputCls`/`selectCls`): `border-input bg-transparent ... focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`.
- **Sidebar active item** (`Sidebar.tsx`): from indigo (`--color-info`) to `bg-accent text-accent-foreground` (subtle gray + bold).

## Scope

**Changed:** `packages/theme/src/tokens.css`, `packages/theme/src/tailwind-preset.js`, `packages/web/src/routes/admin-styles.ts`, `packages/web/src/components/Sidebar.tsx`, `packages/flow-editor/src/topbar/Topbar.tsx`.

**Unchanged (inherit via aliases):** `flow-editor` / `run-viewer` / `runs-list` `styles.css`, and the already-migrated web `.tsx` files. The `check-theme-colors` guardrail is unchanged — shadcn class names are token-based, not raw colors.

**Relationship to pending commits:** the two unpushed commits on this branch (standard slate ramp; Tailwind-v4 border-color base rule) are layered under this. The border-color base rule is retained; the slate token values are overwritten by the zinc set.

## Verification

1. `npm run check` — typecheck + import boundaries + `check:theme-colors` all green.
2. `npm run build:web` — compiles (confirms shadcn class names resolve).
3. Compiled-CSS probe of representative surfaces (admin Users table, Org MCPs cards, a form with inputs, flow-editor nodes) in **both** themes, confirming: near-black/near-white monochrome primary buttons; elevated dark cards (card lighter than page); hairline borders resolving to `--border` (not white); neutral active-nav; status colors intact.

(Browser preview note: the harness serves the main repo on `:5173`, so worktree verification uses a self-contained probe with the compiled CSS inlined — see prior theme work.)

## Out of scope

- Renaming the legacy `--color-*` tokens away (kept as permanent aliases).
- Importing shadcn React components or the shadcn CLI.
- Changing typography/spacing scales beyond radius.
