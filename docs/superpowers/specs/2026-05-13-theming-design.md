# Theming — Design Spec

**Date:** 2026-05-13
**Status:** Approved (brainstorming)
**Scope:** Introduce a user-selectable theme system. Ship dark (current look) + light in v1. Architecture must scale to additional themes without code changes in consuming packages.

---

## Goals

- User can switch between dark and light themes; choice persists per browser.
- Dark theme is visually unchanged from today.
- Adding a future theme is a purely additive change (one CSS variable block, no component edits).
- Consistent theming across all four UI packages: `web`, `flow-editor`, `run-viewer`, `runs-list`.

## Non-goals (v1)

- Per-user persistence to backend (deferred).
- A third theme (architecture supports it; not shipping one).
- High-contrast / accessibility variants.
- Theming PNG exports from the flow editor.
- A dedicated Settings page (toggle stays in sidebar; relocate when other preferences exist).

---

## Architecture

A new shared package `@journeyman/theme` (`packages/theme/`) owns the theme contract: tokens, Tailwind preset, React provider, hook, and toggle component.

```
packages/theme/
├── package.json
├── src/
│   ├── index.ts              ← public exports
│   ├── tokens.css            ← :root + [data-theme="..."] variable blocks
│   ├── tailwind-preset.js    ← shared Tailwind preset
│   ├── ThemeProvider.tsx     ← context + state
│   ├── useTheme.ts           ← hook
│   └── ThemeToggle.tsx       ← sun/moon icon button
└── MIGRATION.md              ← slate→semantic mapping table (Phase 2 contract)
```

**Consumption pattern (per UI package):**
1. Import `@journeyman/theme/tokens.css` at the entry module.
2. Extend the package's `tailwind.config.js` with the shared preset. `flow-editor`, `run-viewer`, and `runs-list` do not currently have a Tailwind config; they will get one in Phase 1.
3. `packages/web/src/main.tsx` wraps the app with `<ThemeProvider>`. The flow editor is embedded inside the web shell, so its DOM inherits `<html data-theme="...">` automatically — no separate provider needed.

**Theme application mechanism:**
- The active theme is signalled by `document.documentElement.dataset.theme` (`"dark"` | `"light"`).
- `tokens.css` defines variables under `[data-theme="dark"]` and `[data-theme="light"]` selectors. Adding a third theme = adding a `[data-theme="custom"]` block.
- We use a `data-theme` attribute (not a class) to avoid colliding with Tailwind's `dark:` variant should it be wanted later for unrelated reasons.

---

## Token set

Sixteen semantic tokens, declared as space-separated RGB triplets so Tailwind alpha modifiers (`bg-surface/40`) compose correctly.

| Token | Dark | Light | Used for |
|---|---|---|---|
| `--color-bg` | `26 26 36` | `255 255 255` | App background (`body`) |
| `--color-surface` | `15 23 42` (slate-900) | `248 250 252` (slate-50) | Cards, panels, modals |
| `--color-surface-raised` | `30 41 59` (slate-800) | `255 255 255` | Inputs, dropdowns, raised cards |
| `--color-surface-hover` | `30 41 59` (slate-800) | `241 245 249` (slate-100) | Row hover, button hover |
| `--color-surface-active` | `51 65 85` (slate-700) | `226 232 240` (slate-200) | Selected row, pressed |
| `--color-border` | `51 65 85` (slate-700) | `226 232 240` (slate-200) | Default borders |
| `--color-border-strong` | `71 85 105` (slate-600) | `203 213 225` (slate-300) | Emphasized borders, focus |
| `--color-text` | `241 245 249` (slate-100) | `15 23 42` (slate-900) | Primary text |
| `--color-text-muted` | `148 163 184` (slate-400) | `71 85 105` (slate-600) | Secondary text, labels |
| `--color-text-subtle` | `100 116 139` (slate-500) | `100 116 139` (slate-500) | Disabled, placeholders |
| `--color-accent` | `99 102 241` (indigo-500) | `79 70 229` (indigo-600) | Primary action, links |
| `--color-accent-hover` | `79 70 229` (indigo-600) | `67 56 202` (indigo-700) | Accent hover state |
| `--color-success` | `16 185 129` (emerald-500) | `5 150 105` (emerald-600) | Success badges, toasts |
| `--color-warning` | `245 158 11` (amber-500) | `217 119 6` (amber-600) | Warning badges |
| `--color-danger` | `239 68 68` (red-500) | `220 38 38` (red-600) | Destructive actions, errors |
| `--color-overlay` | `0 0 0 / 0.6` | `15 23 42 / 0.5` | Modal backdrops |

(`--color-overlay` is declared as an `rgb()`-with-alpha string, not a triplet, since it isn't composed with utility alpha modifiers.)

**Tailwind preset exposes semantic utilities** that resolve to the variables via `rgb(var(--color-*) / <alpha-value>)`:

`bg-bg`, `bg-surface`, `bg-surface-raised`, `bg-surface-hover`, `bg-surface-active`, `border-default`, `border-strong`, `text-default`, `text-muted`, `text-subtle`, `accent`, `accent-hover`, `success`, `warning`, `danger`.

---

## Migration strategy

Hybrid: ship a slate→token remap on day one, then hand-migrate to semantic names gradually.

### Slate remap (Phase 1)

The preset overrides Tailwind's built-in slate palette for the specific shades currently in use. Existing classes keep working but resolve to themed values.

| Existing class | Resolves to |
|---|---|
| `bg-slate-900` | `--color-surface` |
| `bg-slate-800` | `--color-surface-raised` |
| `bg-slate-700` | `--color-surface-active` |
| `border-slate-700` | `--color-border` |
| `border-slate-600` | `--color-border-strong` |
| `text-slate-100`, `text-slate-200` | `--color-text` |
| `text-slate-300`, `text-slate-400` | `--color-text-muted` |
| `text-slate-500` | `--color-text-subtle` |

The full mapping (including alpha cases) lives in `packages/theme/MIGRATION.md`.

### Same-shade-different-meaning cases

Audit finding: some classes carry multiple semantic meanings today (e.g. `bg-slate-900/40` is used for both row-hover and code-block backgrounds). The remap picks one mapping; cases where this looks wrong in light theme are hand-migrated to the correct semantic token at the time of touch.

### Phase 1 — Foundation (single PR)

1. Scaffold `packages/theme/`.
2. Add `tailwind.config.js` to `flow-editor`, `run-viewer`, `runs-list`, all extending the preset.
3. Import `tokens.css` at each package entry.
4. Wrap `packages/web/src/main.tsx` with `<ThemeProvider>`.
5. Add flash-prevention inline script to entry HTMLs.
6. Add `<ThemeToggle />` to `Sidebar.tsx`.
7. Migrate hardcoded body colors in each `styles.css` (e.g. `background: #1a1a24`) to `var(--color-bg)`.
8. Visually verify dark theme is unchanged and light theme is functional end-to-end across all four packages.

### Phase 2 — Gradual (no deadline)

- As files are touched for other work, replace remapped slate classes with semantic ones using `MIGRATION.md` as the contract.
- PR review enforces semantic names in new/changed code; the remap eventually becomes vestigial and can be removed.

---

## Theme state, persistence & toggle

### State

```ts
type Theme = "dark" | "light";

interface ThemeContext {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}
```

No `"system"` value — OS preference is a first-visit fallback only, not a stored choice.

### Resolution order at app start

1. `localStorage.getItem("journeyman.theme")` if `"dark"` or `"light"`.
2. Else `window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"`.
3. Apply by setting `document.documentElement.dataset.theme`.

Until the user explicitly toggles, no value is written to localStorage — so the OS preference continues to track. The first explicit `setTheme` call writes through.

### Flash-of-wrong-theme prevention

Each entry HTML (`packages/web/index.html` and equivalents) embeds a small inline script that runs the resolution algorithm and sets `data-theme` on `<html>` before any CSS or React loads. Roughly:

```html
<script>
  (function () {
    try {
      var stored = localStorage.getItem("journeyman.theme");
      var theme = stored === "dark" || stored === "light"
        ? stored
        : (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
      document.documentElement.dataset.theme = theme;
    } catch (e) {
      document.documentElement.dataset.theme = "dark";
    }
  })();
</script>
```

The script is duplicated across entry HTMLs (acceptable; ~10 lines, never changes).

### Persistence

- `setTheme` writes to `localStorage` under key `journeyman.theme` and updates `dataset.theme` synchronously.
- No backend call. No cross-device sync.
- localStorage failures (private mode) are swallowed; theme applies for the session.

### Toggle UI

- `ThemeToggle.tsx` renders an icon-only button: sun icon in dark theme, moon in light.
- Lives in `Sidebar.tsx` at the bottom near the user area.
- `aria-label` reflects the action ("Switch to light theme" / "Switch to dark theme").
- 150ms CSS transition on `background-color` and `color` properties at `:root` to soften the switch (not `transition: all`).

---

## Testing

- Manual walkthrough of all four packages in both themes: sidebar, all main routes, flow editor canvas + properties panel, run-viewer, runs-list, modals, toasts.
- Vitest unit test in `packages/web` (or `packages/theme` if simpler) asserting `<ThemeProvider>` writes `data-theme` and `localStorage` on toggle, and respects existing localStorage on mount.
- No visual-regression infrastructure added in v1.

---

## Risks

- **Alpha-channel composition.** Tailwind v3 composes alpha modifiers (`bg-surface/40`) only when colors are declared via the `rgb(var(--x) / <alpha-value>)` pattern. Confirmed approach in this spec, but verify with a test utility in Phase 1 step 1. If broken, fall back to opaque tokens and hand-migrate the `/N` usages.
- **Global slate remap.** Any third-party library that happens to use Tailwind's slate classes through our config will pick up themed values. No such library is in use today; revisit if one is added.
- **Same-shade-different-meaning.** Picking a single mapping per slate shade is correct for most usages but wrong for some. Caught during Phase 1 visual review of light theme; fixed inline.

---

## Open questions

None — all design decisions are resolved.
