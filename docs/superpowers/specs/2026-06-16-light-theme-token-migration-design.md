# Light-Theme Token Migration — Design

**Date:** 2026-06-16
**Status:** Approved (brainstorming) — ready for implementation planning
**Branch:** `worktree-light-theme-token-migration`

## Problem

The app supports a dark and a light theme. Dark works; light is broken. The theme
*infrastructure* is sound — `packages/theme/src/tokens.css` defines both
`[data-theme="dark"]` and `[data-theme="light"]` variable sets, `ThemeProvider`
flips `data-theme` on `<html>`, and `tailwind-preset.js` maps semantic color names
(plus a `slate-100…900` remap) onto those variables.

The failure is **adoption**: large parts of the UI hardcode dark colors that never
flip. In dark mode the hardcoded darks coincidentally match, so it looks correct; in
light mode the page background flips white while those surfaces stay dark → broken.

### Measured scope (raw hardcoded colors that bypass tokens)

| Source | Issue | Count |
|---|---|---|
| `packages/flow-editor/src/styles.css` | hardcoded hex; only ~32 of ~500 colors use `var(--color-*)` | 497 hex |
| `packages/run-viewer/src/styles.css` | same | 68 hex |
| `packages/runs-list/src/styles.css` | same | 32 hex |
| `packages/web` + editor `.tsx` files | inline-style hex + non-themeable Tailwind classes: `text-slate-50` (×130), `text-white` (×15), `bg-black` (×14), `bg-slate-950` (×9), `border-slate-50` (×4) — slate-50/950 sit *outside* the 100–900 remap, so they never theme | ~90 hex + ~170 classes |

Total hex by package: web 91, flow-editor 670, run-viewer 117, runs-list 60, theme 0.

This is a **migration**, not a bug fix: route every hardcoded color through the
existing semantic tokens, adding a small number of new tokens only where nothing fits.

## Goal

Light theme renders correctly across all four UI packages, with **no visual change to
dark theme**. Add a lint guardrail so hardcoded colors cannot silently regress.

## Approach — Hybrid (chosen)

Route all **structural chrome** (backgrounds, surfaces, borders, text, overlays,
accent, success/warning/danger) through the **existing** semantic tokens — they are
already correct in both themes. Add a **small** set of new token pairs only where no
existing token fits.

Rejected alternatives:
- **Map onto existing tokens only** — editor-specific colors (canvas grid, info-blue)
  have no clean home and would be flattened.
- **Full editor token layer** — dozens of new tokens, most duplicating the semantic
  set; heavy to design and maintain.

## Section 1 — Token layer changes

### New token pairs (add to `packages/theme/src/tokens.css`, both themes)

Values are space-separated RGB triplets, matching the existing convention
(`rgb(var(--x) / <alpha-value>)`).

| Token | Why | dark | light |
|---|---|---|---|
| `--color-info` | A full blue "info" family (`#74b9ff`, `#4a9eff`, `#8fbeff`, `#6c8eff`, `#5ea0f5`…) exists with no current token (only accent/success/warning/danger). | `96 165 250` | `37 99 235` |
| `--color-info-muted` | Muted/secondary info text & borders. | `59 130 246` | `96 165 250` |
| `--color-canvas` | Canvas backdrop, distinct from app `bg` (sits behind nodes with a gradient/grid). | `15 15 30` | `248 250 252` |
| `--color-canvas-dot` | The dot-grid (`#888` in `flow-editor/styles.css:454`) — must dim in light mode or it reads as noise. | `136 136 136` | `203 213 225` |

Register `info`, `info-muted`, `canvas`, `canvas-dot` in `packages/theme/src/tailwind-preset.js`
(`semantic` block) so they are available as Tailwind color names too.

### Green primary button

The flow-editor primary button is green (`#00b894`/`#11c9a3`) while the rest of the app's
accent is indigo. **Decision: map the green to the existing `--color-success` token.** No
new brand token. Editor primary CTAs become success-colored (already a themed teal-green).

### Everything else collapses onto existing tokens

| Family (sample hex) | Token |
|---|---|
| deepest bg: `#11111a`, `#0f0f1e`, `#0e0e1a`, `#14141e`, `#15151f`, `#11111c` | `--color-bg` |
| surfaces: `#1a1a2a`, `#1a1a24`, `#1f1f2c`, `#262638`, `#2d2d44`, `#23233a` | `--color-surface` |
| raised surfaces: `#2a2a3a`, `#2a2a3e`, `#34344a`, `#353548` | `--color-surface-raised` |
| borders: `#3a3a4e`, `#3a3a5e`, `#4a4a5e` | `--color-border` |
| strong borders: `#5a5a6a`, `#6a6a7e` | `--color-border-strong` |
| bright text: `#fff`, `#f0f0f0`, `#f5f5f5`, `#eee`, `#e8eaed` | `--color-text` |
| text: `#ddd`, `#ccc`, `#c8c8d4`, `#bbb`, `#b8b8c8` | `--color-text` / `--color-text-muted` |
| muted/subtle text: `#aaa`, `#999`, `#9aa0aa`, `#888`, `#7a7f8c`, `#777`, `#666`, `#555`, `#444` | `--color-text-muted` / `--color-text-subtle` |
| indigo accent: `#6c5ce7`, `#7e6dee`, `#a29bfe`, `#c4b5fd`, `#5848d0`, `#4f46e5`, `#4338ca` | `--color-accent` / `--color-accent-hover` |
| green: `#00b894`, `#11c9a3`, `#16a34a`, `#065f46`, `#d1fae5` | `--color-success` |
| red: `#ff7675`, `#f87171`, `#ff6b6b`, `#ef4444`, `#e17055`, `#ee8267` | `--color-danger` |
| amber: `#fdcb6e`, `#fbbf24`, `#f59e0b`, `#f39c12`, `#ffae26`, `#fef3c7`, `#92400e` | `--color-warning` |
| blue info: `#74b9ff`, `#4a9eff`, `#8fbeff`, `#6c8eff`, `#5ea0f5`, `#4a8fe7`, `#6aa3ff` | `--color-info` / `--color-info-muted` |
| slate-ish: `#e2e8f0`, `#cbd5e1`, `#94a3b8` | `--color-text-muted` / `--color-border` |

This table is the **canonical mapping reference** for implementation. It is a guide,
not a mechanical find-replace (see caveat below).

## Section 2 — Migration mechanics (by location)

**a. The three `styles.css` files** (flow-editor 497, run-viewer 68, runs-list 32):
replace each hex with `rgb(var(--color-X) / <alpha>)`. Where a hex was already an alpha
blend (e.g. `rgb(255 118 117 / 0.18)` node-header gradient at `flow-editor/styles.css:290`,
`:1743`), swap the literal RGB for the token (`var(--color-danger)`, `var(--color-accent)`)
and keep the alpha. The canvas dot-grid gradient (`:454`) uses `var(--color-canvas-dot)`.

**b. Non-themeable Tailwind classes** in `web` `.tsx`:
- `text-slate-50` (×130), `border-slate-50` (×4) → `text-default` / `border-DEFAULT`
- `text-white` (×15) → `text-default` **only where it is body text**; keep literal
  `text-white` where it sits on a colored accent button (white-on-indigo is correct in
  both themes).
- `bg-black` (×14), `bg-slate-950` (×9) → `bg-surface` / `bg-bg` as appropriate.

**c. Inline-style hex in `.tsx`** (Topbar, Sidebar, NodeDetailDrawer, RequiredSecretsTab,
McpToolsTab, SkillsTab, InheritanceChip, RunsListPage, RunDetailPage, RunSubmittedToast,
ProviderBadge, Pagination, built-in-categories, help-content): replace inline
`style={{ color: "#888" }}` with `rgb(var(--color-text-muted))`, or lift to a className
where one already fits.

**Caveat (applies everywhere): keep white-on-accent literal.** `#fff`/`text-white` on a
button/badge background must stay white in both themes; `#fff` used as page text becomes
`--color-text`. Judgment is per-color — there is no safe global find-replace. The mapping
table + this caveat are what make the change reviewable.

**Node category accent colors** (`built-in-categories.ts`): these are an intentional
fixed legend palette. Keep the accent colors as-is (saturated enough to read on both
themes); only ensure their surrounding *backgrounds/text* use tokens.

## Section 3 — Phasing, verification, guardrails

### Phases (each independently shippable; each ends with a light-mode check)

1. **Tokens** — add the 4 new token pairs to `tokens.css` + register them in
   `tailwind-preset.js`. No visual change yet; foundation for the rest.
2. **flow-editor** — `styles.css` (497) + inline-hex `.tsx` (Topbar, RequiredSecretsTab,
   McpToolsTab, SkillsTab, InheritanceChip, help-content, built-in-categories).
3. **run-viewer** — `styles.css` (68) + NodeDetailDrawer, RunTopbar, WorkflowLogsPanel.
4. **runs-list** — `styles.css` (32) + RunsList, ProviderBadge, Pagination.
5. **web shell** — Tailwind class swaps (`slate-50`, `text-white`, `bg-black`,
   `bg-slate-950`) + inline hex in Sidebar, RunsListPage, RunDetailPage, RunSubmittedToast.

### Verification (per phase)

Run the dev server, exercise both themes (toggle `data-theme`), and use the browser
preview to screenshot each migrated surface in **both** themes: dark must look
unchanged, light must be correct. Run `npm run check` (typecheck + boundaries) after
each phase.

### Lint guardrail

Add a `check:theme-colors` script (extends the `scripts/` pattern, e.g.
`scripts/check-theme-colors.mjs`) that greps the UI packages for raw hex literals and
non-themeable color classes (`text-white`, `bg-black`, `slate-(50|950)`, `gray-`,
`zinc-`, `neutral-`, `stone-`) and fails when found, with an allowlist for the
legitimate exceptions (white-on-accent literals, `tokens.css` itself, category legend
palette). Wire it into `npm run check`. This prevents silent regression.

## Plain-language summary

The app already knows how to be light or dark — it has a switch and a list of "use this
color here" rules. But big chunks of the screen ignored the rules and wrote dark colors
by hand. Those hand-written darks look fine at night and wrong in the day. We go through
those chunks and replace each hand-written color with the matching rule, add 4 new rules
for things the list didn't cover (an "info blue", and the canvas backdrop + its dots),
and add a tripwire so nobody hand-writes a color again.

## Out of scope

- No redesign of the light palette beyond the values above (can tune later).
- No changes to dark theme appearance.
- Node category legend colors stay as a fixed brand palette.
- System `prefers-color-scheme` auto-detection (theme defaults to dark; explicit toggle
  only) — unchanged.
