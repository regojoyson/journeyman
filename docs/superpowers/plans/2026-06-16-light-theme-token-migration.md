# Light-Theme Token Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the light theme render correctly across all four UI packages by routing every hardcoded color through the theme's semantic CSS variables, with no visual change to dark theme.

**Architecture:** Hybrid token approach. Reuse the existing semantic tokens in `packages/theme/src/tokens.css` for all structural chrome; add 4 new token pairs (`info`, `info-muted`, `canvas`, `canvas-dot`) only where nothing fits. A new `scripts/check-theme-colors.mjs` guardrail is built first, then each package is migrated until that guardrail reports zero violations for it.

**Tech Stack:** CSS custom properties (space-separated RGB triplets + `rgb(var(--x) / <alpha>)`), Tailwind preset color mapping, plain Node ESM scripts (`node:test` for the guardrail's unit test), React/TSX.

**Spec:** `docs/superpowers/specs/2026-06-16-light-theme-token-migration-design.md`

> **Execution note (per user request):** This plan defers the full `npm run typecheck` and the git commit to the final task — there is **one commit at the end**, not per-task. Each migration task is gated instead by the fast, objective `check-theme-colors` scoped lint (zero violations) plus a per-package `tsc` where cheap. This deviates from the skill's frequent-commit default by explicit instruction.

---

## Canonical color mapping table (reference for all migration tasks)

Apply this table everywhere a hardcoded color is replaced. **It is a guide requiring per-color judgment, not a blind find-replace** — see the white-on-accent caveat.

| Hardcoded family (sample hex) | Replace with |
|---|---|
| deepest bg: `#11111a` `#0f0f1e` `#0e0e1a` `#14141e` `#15151f` `#11111c` `#0f0f1a` `#0e0e16` | `var(--color-bg)` |
| surfaces: `#1a1a2a` `#1a1a24` `#1a1a26` `#1f1f2c` `#1f1f2e` `#262638` `#2d2d44` `#23233a` | `var(--color-surface)` |
| raised surfaces: `#2a2a3a` `#2a2a3e` `#34344a` `#353548` | `var(--color-surface-raised)` |
| borders: `#3a3a4e` `#3a3a5e` `#3a2f6e` `#444` | `var(--color-border)` |
| strong borders: `#4a4a5e` `#5a5a6a` `#6a6a7e` `#555` `#666` | `var(--color-border-strong)` |
| bright text: `#fff` `#f0f0f0` `#f5f5f5` `#eee` `#e8eaed` | `var(--color-text)` |
| text: `#ddd` `#ccc` `#c8c8d4` `#bbb` `#b8b8c8` `#b8bcc4` `#b8b8c4` | `var(--color-text)` |
| muted text: `#aaa` `#999` `#9aa0aa` `#9a9aa8` `#888` `#7a7f8c` | `var(--color-text-muted)` |
| subtle text: `#777` `#6a6a7e` `#5a5a6a` | `var(--color-text-subtle)` |
| indigo accent: `#6c5ce7` `#7e6dee` `#a29bfe` `#c4b5fd` `#5848d0` `#4f46e5` `#4338ca` `#7e6dee` | `var(--color-accent)` / `var(--color-accent-hover)` |
| green: `#00b894` `#11c9a3` `#16a34a` `#065f46` `#d1fae5` | `var(--color-success)` |
| red: `#ff7675` `#f87171` `#ff6b6b` `#ff8a8a` `#ffb0af` `#ef4444` `#e17055` `#ee8267` | `var(--color-danger)` |
| amber: `#fdcb6e` `#fbbf24` `#f59e0b` `#f39c12` `#ffae26` `#ffe2a8` `#fef3c7` `#92400e` | `var(--color-warning)` |
| blue info: `#74b9ff` `#4a9eff` `#8fbeff` `#6c8eff` `#5ea0f5` `#4a8fe7` `#6aa3ff` `#6eb8ff` `#00a8ff` | `var(--color-info)` / `var(--color-info-muted)` |
| slate-ish: `#e2e8f0` `#cbd5e1` `#94a3b8` | `var(--color-text-muted)` / `var(--color-border)` |
| canvas dot grid: `#888` *(only in the dot-grid gradient)* | `var(--color-canvas-dot)` |
| modal/overlay backdrops: `rgba(0,0,0,0.6)`, `bg-black/60` | `var(--color-overlay)` (already encodes alpha) |

**CAVEAT — keep white-on-accent literal:** `#fff` / `text-white` that sits **on a colored button or badge** (e.g. `bg-indigo-500 text-white`, `.primary` button) must stay white in both themes. Only `#fff`/`text-white` used as **page/body text** becomes `var(--color-text)`. When a hex is inside an existing `rgb(R G B / a)` or `rgba(R,G,B,a)` blend, swap only the RGB for the token and **keep the alpha**: `rgba(255,118,117,0.15)` → `rgb(var(--color-danger) / 0.15)`.

**Node category legend colors** (`built-in-categories.ts`) are an intentional fixed brand palette — **leave the `color:` hex values as-is**; they are excluded from the guardrail.

---

## File Structure

**Created:**
- `scripts/check-theme-colors.mjs` — guardrail: scans UI packages for raw hex + non-themeable color classes, exits non-zero on violations. Exports `findViolations(content, relPath)` (pure) + CLI runner.
- `scripts/check-theme-colors.test.mjs` — `node:test` unit test for `findViolations`.

**Modified:**
- `packages/theme/src/tokens.css` — add 4 new token pairs to both theme blocks.
- `packages/theme/src/tailwind-preset.js` — register `info`, `info-muted`, `canvas`, `canvas-dot`, `overlay` as Tailwind color names.
- `packages/flow-editor/src/styles.css` + inline-hex `.tsx` (topbar/Topbar, properties-panel/{RequiredSecretsTab,McpToolsTab,SkillsTab,InheritanceChip}, canvas/help-content).
- `packages/run-viewer/src/styles.css` + drawer/NodeDetailDrawer, topbar/RunTopbar, logs/WorkflowLogsPanel.
- `packages/runs-list/src/styles.css` + RunsList, ProviderBadge, Pagination.
- `packages/web/src` — Tailwind class swaps + inline hex (components/Sidebar, components/RunSubmittedToast, routes/RunsListPage, routes/RunDetailPage, auth/modals/*).
- `package.json` (root) — add `check:theme-colors` script and chain it into `check`.

---

## Task 1: Add new theme tokens

**Files:**
- Modify: `packages/theme/src/tokens.css`
- Modify: `packages/theme/src/tailwind-preset.js`

- [ ] **Step 1: Add the 4 new token pairs to the `dark` block**

In `packages/theme/src/tokens.css`, inside the `:root, [data-theme="dark"]` block, after `--color-danger: 239 68 68;` add:

```css
  --color-info: 96 165 250;
  --color-info-muted: 59 130 246;
  --color-canvas: 15 15 30;
  --color-canvas-dot: 136 136 136;
```

- [ ] **Step 2: Add the 4 new token pairs to the `light` block**

In the `[data-theme="light"]` block, after `--color-danger: 220 38 38;` add:

```css
  --color-info: 37 99 235;
  --color-info-muted: 96 165 250;
  --color-canvas: 248 250 252;
  --color-canvas-dot: 203 213 225;
```

- [ ] **Step 3: Register the new names + overlay in the Tailwind preset**

In `packages/theme/src/tailwind-preset.js`, add to the `semantic` object (after `danger`):

```js
  info: withAlpha("--color-info"),
  "info-muted": withAlpha("--color-info-muted"),
  canvas: withAlpha("--color-canvas"),
  "canvas-dot": withAlpha("--color-canvas-dot"),
  overlay: "var(--color-overlay)",
```

Note: `overlay` does **not** use `withAlpha` — `--color-overlay` already carries its own alpha (`rgb(... / 0.x)`).

- [ ] **Step 4: Verify the tokens exist in both blocks**

Run: `grep -c -- '--color-info:' packages/theme/src/tokens.css`
Expected: `2` (one per theme block).

Run: `grep -c -- '--color-canvas' packages/theme/src/tokens.css`
Expected: `4` (canvas + canvas-dot, ×2 blocks).

- [ ] **Step 5: Typecheck the theme package only**

Run: `npm run typecheck -w @journeyman/theme`
Expected: PASS (no output / exit 0). `tailwind-preset.js` is plain JS, so this just confirms nothing broke.

---

## Task 2: Build the `check-theme-colors` guardrail (TDD)

This task builds the objective gate used by Tasks 3–6. It is **not yet** wired into `npm run check` (that happens in Task 7), so it won't break the baseline while migration is in progress.

**Files:**
- Create: `scripts/check-theme-colors.mjs`
- Create: `scripts/check-theme-colors.test.mjs`

- [ ] **Step 1: Write the failing test**

Create `scripts/check-theme-colors.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { findViolations } from "./check-theme-colors.mjs";

test("flags a raw hex color", () => {
  const v = findViolations("a.css", ".x { color: #2a2a3a; }");
  assert.equal(v.length, 1);
  assert.match(v[0], /#2a2a3a/);
});

test("flags non-themeable tailwind classes", () => {
  const v = findViolations("a.tsx", '<div className="text-white bg-black bg-slate-950 text-slate-50" />');
  assert.equal(v.length, 4);
});

test("does NOT flag themed var() usage", () => {
  const v = findViolations("a.css", ".x { color: rgb(var(--color-text) / 1); }");
  assert.equal(v.length, 0);
});

test("does NOT flag remapped slate shades 100-900 or accent classes", () => {
  const v = findViolations("a.tsx", '<div className="bg-slate-900 text-slate-400 bg-accent text-default" />');
  assert.equal(v.length, 0);
});

test("respects an inline allow comment", () => {
  const v = findViolations("a.tsx", '<button className="bg-accent text-white" /> /* theme-colors-allow: white-on-accent */');
  assert.equal(v.length, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/check-theme-colors.test.mjs`
Expected: FAIL — `Cannot find module ... check-theme-colors.mjs` / `findViolations is not a function`.

- [ ] **Step 3: Write the guardrail script**

Create `scripts/check-theme-colors.mjs`:

```js
#!/usr/bin/env node
// Fails when UI code uses hardcoded colors that bypass the theme tokens.
// Themed code must use rgb(var(--color-*) / a) or the semantic Tailwind names.
// See docs/superpowers/specs/2026-06-16-light-theme-token-migration-design.md
//
// Usage:
//   node scripts/check-theme-colors.mjs                 # scan all UI packages
//   node scripts/check-theme-colors.mjs packages/web    # scan one path

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");

// Files whose hardcoded colors are intentional and exempt.
const ALLOWED_FILES = new Set([
  "packages/theme/src/tokens.css",                    // the token definitions themselves
  "packages/flow-editor/src/palette/built-in-categories.ts", // fixed category legend palette
]);

const HEX_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
// Tailwind utilities on non-themeable palettes / out-of-remap slate shades.
const CLASS_RE =
  /\b(?:bg|text|border|ring|from|to|via|fill|stroke|divide|placeholder|outline|shadow|decoration)-(?:white|black|gray|zinc|neutral|stone|slate-(?:50|950))\b/g;

const ALLOW_MARK = /theme-colors-allow/;

export function findViolations(relPath, content) {
  if (ALLOWED_FILES.has(relPath)) return [];
  const violations = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (ALLOW_MARK.test(line)) continue; // explicit per-line exemption
    for (const m of line.matchAll(HEX_RE)) violations.push(`${relPath}:${i + 1}  ${m[0]}`);
    for (const m of line.matchAll(CLASS_RE)) violations.push(`${relPath}:${i + 1}  ${m[0]}`);
  }
  return violations;
}

const UI_PKGS = ["flow-editor", "run-viewer", "runs-list", "web", "theme"];
const EXTS = new Set([".css", ".ts", ".tsx"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".turbo"]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) yield* walk(full);
    } else if (EXTS.has(extname(entry)) && !basename(entry).endsWith(".test.ts")) {
      yield full;
    }
  }
}

function roots(argv) {
  if (argv.length) return argv.map((p) => join(REPO_ROOT, p));
  return UI_PKGS.map((p) => join(REPO_ROOT, "packages", p, "src"));
}

let all = [];
for (const root of roots(process.argv.slice(2))) {
  for (const file of walk(root)) {
    const rel = relative(REPO_ROOT, file);
    all = all.concat(findViolations(rel, readFileSync(file, "utf8")));
  }
}

if (all.length) {
  console.error(`✗ ${all.length} hardcoded color(s) bypass theme tokens:\n`);
  for (const v of all) console.error("  " + v);
  console.error(
    "\nReplace with rgb(var(--color-*) / a) or a semantic Tailwind name." +
      "\nFor a legitimate exception add a `theme-colors-allow` comment on the line.",
  );
  process.exit(1);
} else {
  console.log("✓ No hardcoded colors bypass theme tokens.");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test scripts/check-theme-colors.test.mjs`
Expected: PASS — `# pass 5`, `# fail 0`.

- [ ] **Step 5: Sanity-run against the current tree (expect existing violations)**

Run: `node scripts/check-theme-colors.mjs packages/theme/src`
Expected: `✓ No hardcoded colors bypass theme tokens.` (tokens.css is allowlisted; nothing else in theme/src has raw hex).

Run: `node scripts/check-theme-colors.mjs packages/runs-list/src`
Expected: FAIL listing many violations (this package is migrated in Task 5). This confirms the scanner detects the real problem.

---

## Task 3: Migrate `flow-editor`

**Files:**
- Modify: `packages/flow-editor/src/styles.css`
- Modify: `packages/flow-editor/src/topbar/Topbar.tsx`
- Modify: `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx`
- Modify: `packages/flow-editor/src/properties-panel/McpToolsTab.tsx`
- Modify: `packages/flow-editor/src/properties-panel/SkillsTab.tsx`
- Modify: `packages/flow-editor/src/properties-panel/InheritanceChip.tsx`
- Modify: `packages/flow-editor/src/canvas/help-content.tsx`

- [ ] **Step 1: Migrate `styles.css` per the canonical mapping table**

Replace every hardcoded hex with `rgb(var(--color-X) / <alpha>)` using the table at the top of this plan. Worked examples (from the current file):

Topbar block:
```css
/* BEFORE */
.je-editor__topbar { background: #11111a; border-bottom: 1px solid #2a2a3a; }
.je-editor__topbar button { background: #2a2a3e; border: 1px solid #3a3a4e; color: #ddd; }
.je-editor__topbar button:hover:not(:disabled) { background: #34344a; border-color: #4a4a5e; color: #fff; }
.je-editor__topbar button.primary { background: #00b894; border-color: #00b894; color: #fff; }

/* AFTER */
.je-editor__topbar { background: rgb(var(--color-bg) / 1); border-bottom: 1px solid rgb(var(--color-border) / 1); }
.je-editor__topbar button { background: rgb(var(--color-surface-raised) / 1); border: 1px solid rgb(var(--color-border) / 1); color: rgb(var(--color-text) / 1); }
.je-editor__topbar button:hover:not(:disabled) { background: rgb(var(--color-surface-active) / 1); border-color: rgb(var(--color-border-strong) / 1); color: rgb(var(--color-text) / 1); }
.je-editor__topbar button.primary { background: rgb(var(--color-success) / 1); border-color: rgb(var(--color-success) / 1); color: #fff; /* theme-colors-allow: white-on-success */ }
```

Alpha-blend example (node header gradient, ~line 290):
```css
/* BEFORE */ background: linear-gradient(180deg, rgb(255 118 117 / 0.18) 0%, rgb(42 42 62 / 1) 75%);
/* AFTER  */ background: linear-gradient(180deg, rgb(var(--color-danger) / 0.18) 0%, rgb(var(--color-surface-raised) / 1) 75%);
```

Canvas dot-grid (~line 454):
```css
/* BEFORE */ background-image: linear-gradient(45deg, transparent 50%, #888 50%), linear-gradient(135deg, #888 50%, transparent 50%);
/* AFTER  */ background-image: linear-gradient(45deg, transparent 50%, rgb(var(--color-canvas-dot) / 1) 50%), linear-gradient(135deg, rgb(var(--color-canvas-dot) / 1) 50%, transparent 50%);
```

Modal backdrop (~line 1284):
```css
/* BEFORE */ .fe-modal-backdrop { background: rgba(0,0,0,0.6); }
/* AFTER  */ .fe-modal-backdrop { background: var(--color-overlay); }
```

- [ ] **Step 2: Migrate inline-style hex in the `.tsx` files**

In each listed `.tsx`, replace inline `style` hex with token equivalents per the table. Example pattern:
```tsx
// BEFORE
<span style={{ color: "#888" }}>...</span>
// AFTER
<span style={{ color: "rgb(var(--color-text-muted))" }}>...</span>
```
For colored backgrounds with text, keep `color: "#fff"` only when on an accent/success/danger background and add a trailing `/* theme-colors-allow: white-on-accent */` comment on that line.

- [ ] **Step 3: Run the guardrail scoped to flow-editor**

Run: `node scripts/check-theme-colors.mjs packages/flow-editor/src`
Expected: `✓ No hardcoded colors bypass theme tokens.` If it lists any, fix each listed `file:line` and re-run until clean.

- [ ] **Step 4: Typecheck flow-editor**

Run: `npm run typecheck -w @journeyman/flow-editor`
Expected: PASS.

---

## Task 4: Migrate `run-viewer`

**Files:**
- Modify: `packages/run-viewer/src/styles.css`
- Modify: `packages/run-viewer/src/drawer/NodeDetailDrawer.tsx`
- Modify: `packages/run-viewer/src/topbar/RunTopbar.tsx`
- Modify: `packages/run-viewer/src/logs/WorkflowLogsPanel.tsx`

- [ ] **Step 1: Migrate `styles.css` per the canonical mapping table**

Worked example (status pills, top of file):
```css
/* BEFORE */
.je-runview__topbar { background: #11111a; border-bottom: 1px solid #2a2a3a; }
.je-runview__pill.pending   { background: rgba(150,150,170,0.15); color: #aaa; }
.je-runview__pill.running   { background: rgba(74,158,255,0.15); color: #4a9eff; }
.je-runview__pill.completed { background: rgba(0,184,148,0.15);  color: #00b894; }
.je-runview__pill.failed    { background: rgba(255,118,117,0.15); color: #ff7675; }
.je-runview__pill.paused    { background: rgba(253,203,110,0.15); color: #fdcb6e; }

/* AFTER */
.je-runview__topbar { background: rgb(var(--color-bg) / 1); border-bottom: 1px solid rgb(var(--color-border) / 1); }
.je-runview__pill.pending   { background: rgb(var(--color-text-subtle) / 0.15); color: rgb(var(--color-text-muted) / 1); }
.je-runview__pill.running   { background: rgb(var(--color-info) / 0.15);    color: rgb(var(--color-info) / 1); }
.je-runview__pill.completed { background: rgb(var(--color-success) / 0.15); color: rgb(var(--color-success) / 1); }
.je-runview__pill.failed    { background: rgb(var(--color-danger) / 0.15);  color: rgb(var(--color-danger) / 1); }
.je-runview__pill.paused    { background: rgb(var(--color-warning) / 0.15); color: rgb(var(--color-warning) / 1); }
```

- [ ] **Step 2: Migrate inline-style hex in the listed `.tsx` files**

Same procedure as Task 3 Step 2, applied to NodeDetailDrawer, RunTopbar, WorkflowLogsPanel.

- [ ] **Step 3: Run the guardrail scoped to run-viewer**

Run: `node scripts/check-theme-colors.mjs packages/run-viewer/src`
Expected: `✓ No hardcoded colors bypass theme tokens.`

- [ ] **Step 4: Typecheck run-viewer**

Run: `npm run typecheck -w @journeyman/run-viewer`
Expected: PASS.

---

## Task 5: Migrate `runs-list`

**Files:**
- Modify: `packages/runs-list/src/styles.css`
- Modify: `packages/runs-list/src/RunsList.tsx`
- Modify: `packages/runs-list/src/ProviderBadge.tsx`
- Modify: `packages/runs-list/src/Pagination.tsx`

- [ ] **Step 1: Migrate `styles.css` per the canonical mapping table**

Worked example (filters + table, top of file):
```css
/* BEFORE */
.je-runslist__filters select { background: #2a2a3e; border: 1px solid #444; color: #ddd; }
.je-runslist__table thead tr { color: #888; border-bottom: 1px solid #2a2a3a; }
.je-runslist__table tbody tr { border-bottom: 1px solid #1f1f2c; }
.je-runslist__table tbody tr:hover { background: #1f1f2c; }

/* AFTER */
.je-runslist__filters select { background: rgb(var(--color-surface-raised) / 1); border: 1px solid rgb(var(--color-border) / 1); color: rgb(var(--color-text) / 1); }
.je-runslist__table thead tr { color: rgb(var(--color-text-muted) / 1); border-bottom: 1px solid rgb(var(--color-border) / 1); }
.je-runslist__table tbody tr { border-bottom: 1px solid rgb(var(--color-surface) / 1); }
.je-runslist__table tbody tr:hover { background: rgb(var(--color-surface) / 1); }
```

- [ ] **Step 2: Migrate inline-style hex in RunsList, ProviderBadge, Pagination**

Same procedure as Task 3 Step 2.

- [ ] **Step 3: Run the guardrail scoped to runs-list**

Run: `node scripts/check-theme-colors.mjs packages/runs-list/src`
Expected: `✓ No hardcoded colors bypass theme tokens.`

- [ ] **Step 4: Typecheck runs-list**

Run: `npm run typecheck -w @journeyman/runs-list`
Expected: PASS.

---

## Task 6: Migrate `web` shell

**Files:**
- Modify: `packages/web/src/components/Sidebar.tsx`
- Modify: `packages/web/src/components/RunSubmittedToast.tsx`
- Modify: `packages/web/src/routes/RunsListPage.tsx`
- Modify: `packages/web/src/routes/RunDetailPage.tsx`
- Modify: `packages/web/src/auth/modals/IdleWarningModal.tsx`
- Modify: `packages/web/src/auth/modals/SessionExpiredModal.tsx`
- Modify: any remaining `web/src` files the guardrail reports

- [ ] **Step 1: Swap non-themeable Tailwind classes**

Apply across `packages/web/src`:
- `text-slate-50` → `text-default`; `border-slate-50` → `border-DEFAULT`
- `bg-black/60` (modal backdrop) → `bg-overlay` (drop the `/60` — the token already encodes alpha). Example:
  ```tsx
  // BEFORE: className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60"
  // AFTER:  className="fixed inset-0 z-[1000] flex items-center justify-center bg-overlay"
  ```
- `bg-slate-950` → `bg-bg`; standalone `bg-black` → `bg-surface` (or `bg-bg` for a page backdrop — pick by context).
- Accent buttons: `bg-indigo-500 ... text-white hover:bg-indigo-400` → `bg-accent ... text-white hover:bg-accent-hover`. **Keep `text-white`** (white-on-accent) and add `{/* theme-colors-allow: white-on-accent */}` on the same JSX line, e.g.:
  ```tsx
  <button className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover">{/* theme-colors-allow: white-on-accent */}
  ```

- [ ] **Step 2: Migrate inline-style hex in the listed `.tsx` files**

Same procedure as Task 3 Step 2 (Sidebar, RunSubmittedToast, RunsListPage, RunDetailPage).

- [ ] **Step 3: Run the guardrail scoped to web**

Run: `node scripts/check-theme-colors.mjs packages/web/src`
Expected: `✓ No hardcoded colors bypass theme tokens.` Fix every reported `file:line` until clean.

- [ ] **Step 4: Typecheck web**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS.

---

## Task 7: Wire guardrail into CI, full verification, single commit

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Add the guardrail to the root scripts and chain into `check`**

In root `package.json` `scripts`, add:
```json
    "check:theme-colors": "node scripts/check-theme-colors.mjs",
```
and change `check` to include it:
```json
    "check": "npm run typecheck && npm run check:boundaries && npm run check:theme-colors",
```

- [ ] **Step 2: Run the full guardrail across all UI packages**

Run: `npm run check:theme-colors`
Expected: `✓ No hardcoded colors bypass theme tokens.` If anything is reported, fix it in the owning package and re-run.

- [ ] **Step 3: Run the guardrail's unit test**

Run: `node --test scripts/check-theme-colors.test.mjs`
Expected: `# pass 5  # fail 0`.

- [ ] **Step 4: Full typecheck + boundaries (the "typecheck at end" gate)**

Run: `npm run check`
Expected: all workspace `typecheck` pass, `✓ Layer boundaries clean`, `✓ No hardcoded colors bypass theme tokens.`

- [ ] **Step 5: Visual verification in both themes**

Start the web dev server (`npm run dev:web`) and use the browser preview workflow. For each migrated surface (flow editor canvas + topbar + properties panel, run viewer + node drawer, runs list, web sidebar/modals), screenshot in **dark** (`document.documentElement.dataset.theme = "dark"`) and **light** (`= "light"`). Confirm: dark is unchanged vs. before; light has no dark-on-light or invisible-text regions. Note any color that reads wrong and adjust its mapping (re-run the scoped guardrail after edits).

- [ ] **Step 6: Single commit of the whole migration**

```bash
git add packages/theme packages/flow-editor packages/run-viewer packages/runs-list packages/web scripts/check-theme-colors.mjs scripts/check-theme-colors.test.mjs package.json
git commit -m "feat(theme): make light theme work by migrating hardcoded colors to tokens

Route all hardcoded UI colors through the semantic theme tokens so the
light theme renders correctly; dark theme is unchanged. Adds info/
info-muted/canvas/canvas-dot tokens, maps the editor green to success,
and adds a check:theme-colors guardrail wired into npm run check.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Notes for the executor

- **Order matters:** Task 1 (tokens) and Task 2 (guardrail) must come before any migration task. Tasks 3–6 are independent of each other and may be done in any order or in parallel.
- **The guardrail is your gate:** a migration task is done when its scoped `check-theme-colors` run is clean AND its package typechecks. Don't eyeball completeness — let the script find stragglers.
- **Per-color judgment:** the mapping table covers families; when a specific hex is ambiguous, choose the token whose role matches (a background → a surface token, a 1px border → a border token, body text → a text token). The white-on-accent caveat is the one hard rule.
- **No commits until Task 7** (per user request) — but you may use `git stash`/diffs freely to inspect work in progress.
