# shadcn Theme Adoption — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt the shadcn/ui zinc + monochrome theme across the web UI by making shadcn's token set canonical, aliasing the existing `--color-*` tokens to it (so all components inherit the look), and restyling signature components onto native shadcn classes.

**Architecture:** Approach A from the spec. shadcn variables (zinc/monochrome, RGB triplets) are defined per `[data-theme]` block; the legacy `--color-*` tokens are re-pointed as aliases; the Tailwind preset exposes shadcn color names + a radius scale; buttons/inputs/active-nav are restyled to shadcn classes. No HSL/oklch, no `.dark` class — keep the app's `rgb(var())` + `[data-theme]` conventions.

**Tech Stack:** Tailwind CSS v4 (`@config` JS preset), CSS custom properties, React/TSX.

**Spec:** `docs/superpowers/specs/2026-06-17-shadcn-theme-design.md`

> **Verification model:** this is CSS/config — no unit tests. Each task is gated by `npm run check` (typecheck + boundaries + `check:theme-colors`) and, where visual, a compiled-CSS probe. The browser-preview harness serves the main repo on `:5173`, so visual checks use a self-contained probe with the built CSS inlined into `packages/web/public/probe.html` (served by the running dev server), then removed.

---

## File structure

- **Modify** `packages/theme/src/tokens.css` — replace both `[data-theme]` blocks with shadcn tokens + aliases + `--radius`; keep status/canvas/overlay/shadow tokens.
- **Modify** `packages/theme/src/tailwind-preset.js` — add shadcn color names + radius scale; keep existing semantic names + slate remap + boxShadow.
- **Modify** `packages/web/src/routes/admin-styles.ts` — buttons + inputs → shadcn classes.
- **Modify** `packages/web/src/components/Sidebar.tsx` — active nav item → `bg-accent text-accent-foreground`.
- **Modify** `packages/flow-editor/src/topbar/Topbar.tsx` + `packages/flow-editor/src/styles.css` — flow-editor `.primary` (green Save) + import-wizard button → monochrome primary.
- **Modify (sweep)** web `.tsx` with literal `bg-indigo-*`/`bg-emerald-*`/`bg-amber-*` primary buttons + `white-on-accent` inline text → `bg-primary text-primary-foreground`.

**Untouched (inherit via aliases):** `run-viewer` / `runs-list` `styles.css`, the bulk of `flow-editor/styles.css`, and the already-migrated web `.tsx`. The `check-theme-colors` guardrail is unchanged.

---

## Task 1: shadcn token set + aliases

**Files:** Modify `packages/theme/src/tokens.css`

- [ ] **Step 1: Replace the `:root, [data-theme="dark"]` and `[data-theme="light"]` blocks**

Replace everything from `:root,` through the end of the `[data-theme="light"] { … }` block (lines 8–71) with:

```css
:root,
[data-theme="dark"] {
  color-scheme: dark;

  /* shadcn zinc tokens (canonical). RGB triplets, consumed via rgb(var(--x) / a). */
  --background: 9 9 11;
  --foreground: 250 250 250;
  --card: 24 24 27;            /* elevated above the page */
  --card-foreground: 250 250 250;
  --popover: 24 24 27;
  --popover-foreground: 250 250 250;
  --primary: 250 250 250;      /* monochrome: near-white in dark */
  --primary-foreground: 24 24 27;
  --secondary: 39 39 42;
  --secondary-foreground: 250 250 250;
  --muted: 39 39 42;
  --muted-foreground: 161 161 170;
  --accent: 39 39 42;
  --accent-foreground: 250 250 250;
  --destructive: 239 68 68;
  --destructive-foreground: 250 250 250;
  --border: 39 39 42;
  --input: 39 39 42;
  --ring: 82 82 91;
  --radius: 0.625rem;

  /* status hues (kept for run-state pills/badges) */
  --color-success: 16 185 129;
  --color-warning: 245 158 11;
  --color-info: 96 165 250;
  --color-info-muted: 59 130 246;
  --color-canvas: 9 9 11;
  --color-canvas-dot: 63 63 70;
  --color-overlay: rgb(0 0 0 / 0.6);

  /* legacy aliases -> shadcn (propagate the look to all existing components) */
  --color-bg: var(--background);
  --color-surface: var(--card);
  --color-surface-raised: var(--card);
  --color-surface-hover: var(--accent);
  --color-surface-active: var(--accent);
  --color-border: var(--border);
  --color-border-strong: var(--ring);
  --color-text: var(--foreground);
  --color-text-muted: var(--muted-foreground);
  --color-text-subtle: var(--muted-foreground);
  --color-accent: var(--primary);
  --color-accent-hover: var(--primary);
  --color-danger: var(--destructive);

  /* elevation */
  --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.3);
  --shadow-md: 0 2px 6px rgb(0 0 0 / 0.35), 0 1px 2px rgb(0 0 0 / 0.3);
  --shadow-lg: 0 12px 32px rgb(0 0 0 / 0.45);
}

[data-theme="light"] {
  color-scheme: light;

  --background: 250 250 250;   /* zinc-50: slightly off-white so white cards lift */
  --foreground: 9 9 11;
  --card: 255 255 255;
  --card-foreground: 9 9 11;
  --popover: 255 255 255;
  --popover-foreground: 9 9 11;
  --primary: 24 24 27;         /* monochrome: near-black in light */
  --primary-foreground: 250 250 250;
  --secondary: 244 244 245;
  --secondary-foreground: 24 24 27;
  --muted: 244 244 245;
  --muted-foreground: 113 113 122;
  --accent: 244 244 245;
  --accent-foreground: 24 24 27;
  --destructive: 220 38 38;
  --destructive-foreground: 250 250 250;
  --border: 228 228 231;
  --input: 228 228 231;
  --ring: 161 161 170;
  --radius: 0.625rem;

  --color-success: 5 150 105;
  --color-warning: 202 110 8;
  --color-info: 37 99 235;
  --color-info-muted: 96 165 250;
  --color-canvas: 250 250 250;
  --color-canvas-dot: 212 212 216;
  --color-overlay: rgb(9 9 11 / 0.5);

  --color-bg: var(--background);
  --color-surface: var(--card);
  --color-surface-raised: var(--card);
  --color-surface-hover: var(--accent);
  --color-surface-active: var(--accent);
  --color-border: var(--border);
  --color-border-strong: var(--ring);
  --color-text: var(--foreground);
  --color-text-muted: var(--muted-foreground);
  --color-text-subtle: var(--muted-foreground);
  --color-accent: var(--primary);
  --color-accent-hover: var(--primary);
  --color-danger: var(--destructive);

  --shadow-sm: 0 1px 2px rgb(16 24 40 / 0.05);
  --shadow-md: 0 1px 2px rgb(16 24 40 / 0.04), 0 4px 16px rgb(16 24 40 / 0.06);
  --shadow-lg: 0 12px 32px rgb(16 24 40 / 0.12);
}
```

Leave the trailing `html { transition: … }` rule unchanged.

- [ ] **Step 2: Sanity-check the variables exist in both blocks**

Run: `grep -c -- '--primary:' packages/theme/src/tokens.css`
Expected: `2`

Run: `grep -c -- '--color-bg: var(--background)' packages/theme/src/tokens.css`
Expected: `2`

- [ ] **Step 3: Typecheck the theme package**

Run: `npm run typecheck -w @journeyman/theme`
Expected: PASS (no output / exit 0).

- [ ] **Step 4: Commit**

```bash
git add packages/theme/src/tokens.css
git commit -m "feat(theme): shadcn zinc token set + legacy aliases"
```

---

## Task 2: Tailwind preset — shadcn color names + radius scale

**Files:** Modify `packages/theme/src/tailwind-preset.js`

- [ ] **Step 1: Add a shadcn color map and a radius scale**

In `tailwind-preset.js`, after the `semantic` object (ends line 33), add:

```js
const shadcn = {
  background: withAlpha("--background"),
  foreground: withAlpha("--foreground"),
  card: withAlpha("--card"),
  "card-foreground": withAlpha("--card-foreground"),
  popover: withAlpha("--popover"),
  "popover-foreground": withAlpha("--popover-foreground"),
  primary: withAlpha("--primary"),
  "primary-foreground": withAlpha("--primary-foreground"),
  secondary: withAlpha("--secondary"),
  "secondary-foreground": withAlpha("--secondary-foreground"),
  muted: withAlpha("--muted"),
  "muted-foreground": withAlpha("--muted-foreground"),
  // `accent` is redefined here to shadcn's subtle-gray (--accent), OVERRIDING
  // the earlier semantic `accent` (which was --color-accent → primary). This is
  // correct for shadcn (accent = subtle hover/active gray), but it flips the
  // meaning of any existing `bg-accent`/`text-accent` class from primary to gray.
  // `bg-accent` (hovers/surfaces) is the intended new behavior; standalone
  // `text-accent` usages are migrated to `text-foreground` in Task 4.
  accent: withAlpha("--accent"),
  "accent-foreground": withAlpha("--accent-foreground"),
  destructive: withAlpha("--destructive"),
  "destructive-foreground": withAlpha("--destructive-foreground"),
  border: withAlpha("--border"),
  input: withAlpha("--input"),
  ring: withAlpha("--ring"),
};
```

- [ ] **Step 2: Merge `shadcn` into the colors map and add `borderRadius`**

Change the `theme.extend` object (lines 49–71) so `colors` includes `...shadcn` and a `borderRadius` scale is added:

```js
  theme: {
    extend: {
      colors: {
        ...semantic,
        ...shadcn,
        slate: slateRemap,
      },
      borderRadius: {
        sm: "calc(var(--radius) - 4px)",
        md: "calc(var(--radius) - 2px)",
        lg: "var(--radius)",
        xl: "calc(var(--radius) + 4px)",
      },
      backgroundColor: {
        DEFAULT: withAlpha("--color-bg"),
      },
      textColor: {
        DEFAULT: withAlpha("--color-text"),
      },
      borderColor: {
        DEFAULT: withAlpha("--color-border"),
        strong: withAlpha("--color-border-strong"),
      },
      boxShadow: {
        "card-sm": "var(--shadow-sm)",
        card: "var(--shadow-md)",
        "card-lg": "var(--shadow-lg)",
      },
    },
  },
```

- [ ] **Step 3: Build the web app to confirm classes resolve**

Run: `npm run build:web`
Expected: `✓ built in …` (no errors).

- [ ] **Step 4: Confirm shadcn utilities are emitted**

Run: `grep -oE '\.(bg-primary|text-primary-foreground|border-input|ring-ring)\{' packages/web/dist/assets/*.css | sort -u`
Expected: at least `bg-primary`, `text-primary-foreground` present (others appear once used).
Then: `rm -rf packages/web/dist`

- [ ] **Step 5: Commit**

```bash
git add packages/theme/src/tailwind-preset.js
git commit -m "feat(theme): expose shadcn color names + radius scale in tailwind preset"
```

---

## Task 3: Restyle shared buttons + inputs (admin-styles.ts)

**Files:** Modify `packages/web/src/routes/admin-styles.ts`

- [ ] **Step 1: Replace the button + input/select definitions**

Replace the `inputCls`, `selectCls`, `btnPrimary`, `btnGhost`, `btnDanger`, `card`, `codePill` exports with:

```ts
export const inputCls =
  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-foreground text-sm " +
  "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition";

export const selectCls =
  "rounded-md border border-input bg-transparent px-2 py-1.5 text-foreground text-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition";

export const btnPrimary =
  "rounded-md bg-primary text-primary-foreground hover:bg-primary/90 " +
  "disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-medium transition";

export const btnGhost =
  "rounded-md hover:bg-accent hover:text-accent-foreground px-2.5 py-1.5 text-xs font-medium " +
  "text-muted-foreground transition";

export const btnDanger =
  "rounded-md hover:bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive transition";

export const card =
  "bg-card text-card-foreground border rounded-lg shadow-card";

export const codePill =
  "text-foreground bg-muted border rounded px-1.5 py-0.5 text-xs";
```

- [ ] **Step 2: Typecheck web**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/routes/admin-styles.ts
git commit -m "feat(theme): shadcn buttons + inputs in shared admin styles"
```

---

## Task 4: Convert literal brand-color primary buttons → monochrome

Literal `bg-indigo-*` / `bg-emerald-*` / `bg-amber-*` buttons don't use `--color-accent`, so the alias won't touch them. Convert them to `bg-primary`, and flip any `text-white` that now sits on a primary (monochrome) background to `text-primary-foreground` (otherwise it's white-on-white in dark).

**Files:** Modify (sweep) web `.tsx` under `packages/web/src`.

- [ ] **Step 1: See the scope**

Run:
```bash
grep -rlE 'bg-(indigo|emerald|amber)-(400|500|600)(/[0-9]+)?( hover:bg-(indigo|emerald|amber)-(400|500))?' packages/web/src --include='*.tsx'
```
Expected: a list including LoginPage, SetupWizardPage, SecretsEditor, auth/modals/*, and webhooks/* files.

- [ ] **Step 2: Run the button-color codemod**

```bash
grep -rlE 'bg-(indigo|emerald|amber)-(400|500|600)' packages/web/src --include='*.tsx' \
  | xargs perl -i -pe '
    s/\bbg-indigo-600 hover:bg-indigo-500\b/bg-primary hover:bg-primary\/90/g;
    s/\bbg-indigo-500 hover:bg-indigo-400\b/bg-primary hover:bg-primary\/90/g;
    s/\bbg-indigo-500\/90 hover:bg-indigo-400\b/bg-primary hover:bg-primary\/90/g;
    s/\bbg-indigo-500\b/bg-primary/g;
    s/\bbg-emerald-600 hover:bg-emerald-500\b/bg-primary hover:bg-primary\/90/g;
    s/\bbg-amber-600 hover:bg-amber-500\b/bg-primary hover:bg-primary\/90/g;
  '
```

- [ ] **Step 3: Flip `text-white` that now sits on `bg-primary`**

```bash
grep -rlE 'bg-primary[^"]*text-white' packages/web/src --include='*.tsx' \
  | xargs perl -i -pe 's/(bg-primary[^"]*?)text-white/${1}text-primary-foreground/g'
```

- [ ] **Step 4: Fix inline `white-on-accent` text (now monochrome primary)**

The `theme-colors-allow: white-on-accent` markers sit on inline styles with `color: "#fff"` over an accent (now primary) background. Find them:

Run: `grep -rn 'white-on-accent' packages/web/src`
Expected: includes `packages/web/src/routes/RunsListPage.tsx`.

For each match, change the `"#fff"` on that line to `"rgb(var(--primary-foreground) / 1)"` and update the comment to `white-on-primary`. Example (RunsListPage run button):

```tsx
// before
color: canRun ? "#fff" /* theme-colors-allow: white-on-accent */ : "rgb(var(--color-border-strong) / 1)",
// after
color: canRun ? "rgb(var(--primary-foreground) / 1)" /* theme-colors-allow: white-on-primary */ : "rgb(var(--color-border-strong) / 1)",
```

- [ ] **Step 5: Migrate standalone `text-accent` → `text-foreground`**

After Task 2, `accent` is shadcn's subtle gray, so a standalone `text-accent` would render gray (low contrast). In monochrome there is no colored accent text — convert it to the foreground color. (Leave `text-accent-foreground`, `bg-accent`, and `border-accent` alone.)

```bash
grep -rlE '\btext-accent\b' packages/web/src --include='*.tsx' \
  | xargs perl -i -pe 's/\btext-accent\b(?!-foreground)/text-foreground/g'
```

Run: `grep -rnE '\btext-accent\b(?!-foreground)' packages/web/src` → expected: no matches.

- [ ] **Step 6: Verify no brand-color buttons remain + typecheck**

Run: `grep -rnE 'bg-(indigo|emerald)-(400|500|600)' packages/web/src --include='*.tsx' | head`
Expected: no button matches (status badges using `*-500/10` tints, if any, are fine — only solid button fills were targeted).

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src
git commit -m "feat(theme): convert literal brand-color primary buttons to monochrome primary"
```

---

## Task 5: Sidebar active state + flow-editor primary buttons

**Files:** Modify `packages/web/src/components/Sidebar.tsx`, `packages/flow-editor/src/styles.css`, `packages/flow-editor/src/topbar/Topbar.tsx`

- [ ] **Step 1: Sidebar active nav → shadcn accent (not indigo)**

In `Sidebar.tsx`, the `navStyle` callback sets the active item with `--color-info`. Replace the active `color` and `background` lines:

```tsx
// before
color: isActive ? "rgb(var(--color-info) / 1)" : "rgb(var(--color-text-subtle) / 1)",
background: isActive ? "rgb(var(--color-info) / 0.13)" : "transparent",
// after
color: isActive ? "rgb(var(--accent-foreground) / 1)" : "rgb(var(--color-text-subtle) / 1)",
background: isActive ? "rgb(var(--accent) / 1)" : "transparent",
```

Also change the brand wordmark hover/pin button accent if it uses `--color-info` for a *background highlight* — leave informational icons alone; only the active-nav highlight changes.

- [ ] **Step 2: Flow-editor `.primary` (Save) → monochrome primary**

In `packages/flow-editor/src/styles.css`, replace the `.je-editor__topbar button.primary` rule's success colors:

```css
.je-editor__topbar button.primary {
  background: rgb(var(--primary) / 1);
  border-color: rgb(var(--primary) / 1);
  color: rgb(var(--primary-foreground) / 1);
  font-weight: 600;
}
```

And its hover rule:

```css
.je-editor__topbar button.primary:hover:not(:disabled) {
  background: rgb(var(--primary) / 0.9);
  border-color: rgb(var(--primary) / 0.9);
  filter: none;
}
```

- [ ] **Step 3: Import-wizard button (Topbar.tsx) → monochrome primary**

In `packages/flow-editor/src/topbar/Topbar.tsx` (~line 422), replace the success/`#fff` inline style:

```tsx
background: "rgb(var(--primary) / 1)", border: "1px solid rgb(var(--primary) / 1)", color: "rgb(var(--primary-foreground) / 1)",
```
(remove the `theme-colors-allow: white-on-success` comment — no longer hardcoded white.)

- [ ] **Step 4: Guardrail + typecheck**

Run: `node scripts/check-theme-colors.mjs packages/flow-editor/src packages/web/src`
Expected: `✓ No hardcoded colors bypass theme tokens.`

Run: `npm run typecheck -w @journeyman/flow-editor && npm run typecheck -w @journeyman/web`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/Sidebar.tsx packages/flow-editor/src/styles.css packages/flow-editor/src/topbar/Topbar.tsx
git commit -m "feat(theme): monochrome active-nav + flow-editor primary buttons"
```

---

## Task 6: Full verification + visual probe + ship

**Files:** none (verification only)

- [ ] **Step 1: Full check**

Run: `npm run check`
Expected: typecheck (all workspaces) PASS, `✓ Layer boundaries clean`, `✓ No hardcoded colors bypass theme tokens.`

- [ ] **Step 2: Guardrail unit test**

Run: `node --test scripts/check-theme-colors.test.mjs`
Expected: `# pass 8  # fail 0`.

- [ ] **Step 3: Build + visual probe (both themes)**

Run: `npm run build:web`. Then generate a self-contained probe with the compiled CSS inlined and write it to `packages/web/public/probe.html` (a card + table + form + primary/secondary buttons; default `data-theme="dark"` with a toggle button). Open it via the running dev server at `http://localhost:5173/probe.html`. Confirm in BOTH themes:
- monochrome primary buttons (near-black in light, near-white in dark) with correct foreground text;
- dark cards are elevated (card lighter than the near-black page);
- borders are subtle hairlines (resolve to `--border`, not white);
- inputs show an `--input` border + a neutral focus ring;
- status pills (run states) keep their semantic colors.

Then: `rm -f packages/web/public/probe.html && rm -rf packages/web/dist`

- [ ] **Step 4: Ship**

Confirm the working tree is clean (`git status`), then fast-forward `master` and push (rebasing onto `origin/master` first, as `master` moves):

```bash
git fetch origin
git rebase origin/master
npm run check          # re-verify on the integrated tree
git push origin HEAD:master
```

---

## Notes for the executor

- **Order matters:** Task 1 (tokens) and Task 2 (preset) are the foundation — do them first; everything else depends on the shadcn vars/classes existing.
- **The alias is the engine:** after Tasks 1–2, most of the app already looks shadcn (via `--color-* → shadcn`). Tasks 3–5 are targeted authenticity fixes, chiefly making white-on-primary text flip correctly in dark and the active-nav/primary buttons native.
- **Don't touch status colors:** `--color-success/warning/info` and run-state pills stay semantic. Only the brand/accent goes monochrome.
- **Keep the Tailwind-v4 default-border base rule** in `packages/web/src/styles.css` — it now resolves to `--border` via the alias.
