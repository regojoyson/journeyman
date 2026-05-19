# Custom Phase Icons — Design

**Date:** 2026-05-14
**Status:** Proposed
**Scope:** Per-phase icon for user/org custom phases. Curated Lucide icon set (~40), forward-compatible with future user uploads.

## Problem

Every custom phase currently renders the same `🧩` glyph in the palette and on the canvas. The icon is hardcoded in [useCustomPhasePaletteEntries.ts:42](packages/web/src/flow-editor-integration/useCustomPhasePaletteEntries.ts:42). Authors can't distinguish their custom phases at a glance.

## Goal

Let the author pick an icon when creating or editing a custom phase. Curated set today; leave the door open for uploaded images later without a second schema migration.

Non-goals (this spec):
- User-uploaded raster icons
- SVG uploads
- Per-node-instance icons (the icon belongs to the phase, not the placed node)
- Emoji picker

## Design

### Icon identifier — single string column, scheme-prefixed

`CustomAiPhase.icon` is a nullable string. Values are one of:

| Form                          | Meaning                                                       | Status            |
|-------------------------------|---------------------------------------------------------------|-------------------|
| `null`                        | Use the default (`lucide:Puzzle`)                             | Today             |
| `lucide:<Name>`               | A name from the curated Lucide allowlist                      | Today             |
| `data:image/(png\|jpeg\|webp);base64,…` | Inline uploaded image (capped, downscaled server-side) | Future            |

The scheme prefix means one column carries both shapes — adding uploads later needs zero schema work. The server validates the format on write; an unknown scheme is rejected.

### Curated icon set

A single source-of-truth file: `packages/flow-editor/src/icons/custom-phase-icons.ts`.

Exports:
- `CUSTOM_PHASE_ICON_NAMES: readonly string[]` — the allowlist (~40 names).
- `CUSTOM_PHASE_ICON_COMPONENTS: Record<string, LucideIcon>` — name → component map.
- `DEFAULT_CUSTOM_PHASE_ICON = "lucide:Puzzle"` — the fallback id.

Initial allowlist (final list lives in code; this is the proposed seed):

`Bot`, `Brain`, `Sparkles`, `Wand2`, `Code2`, `Terminal`, `GitBranch`, `GitMerge`, `GitPullRequest`, `Bug`, `Hammer`, `Wrench`, `Cog`, `Workflow`, `Boxes`, `Package`, `FileText`, `FileCode`, `ClipboardCheck`, `ListChecks`, `Search`, `MessageSquare`, `Bell`, `Mail`, `Cpu`, `Database`, `Cloud`, `Shield`, `Lock`, `Key`, `Rocket`, `FlaskConical`, `Microscope`, `BookOpen`, `Pencil`, `PenLine`, `Eye`, `BarChart3`, `Activity`, `Puzzle`.

40 names. All are present in `lucide-react@0.400.x` (already a dep in flow-editor, web, run-viewer).

The allowlist is enforced server-side. Frontend can't smuggle arbitrary names because the create/update route validates `icon` against the same constant (imported from `@journeyman/flow-editor/icons` or duplicated into `@journeyman/core` — see Open Questions).

### Rendering — `resolvePhaseIcon`

Add `packages/flow-editor/src/icons/resolve.tsx`:

```tsx
export function resolvePhaseIcon(
  icon: string | null | undefined,
  opts?: { size?: number; className?: string },
): ReactNode {
  const id = icon ?? DEFAULT_CUSTOM_PHASE_ICON;
  if (id.startsWith("lucide:")) {
    const name = id.slice("lucide:".length);
    const Cmp = CUSTOM_PHASE_ICON_COMPONENTS[name];
    if (Cmp) return <Cmp size={opts?.size ?? 16} className={opts?.className} />;
    return <>{id}</>; // unknown name — render the raw string, surfaces the bug
  }
  if (id.startsWith("data:image/")) {
    return <img src={id} alt="" width={opts?.size ?? 16} height={opts?.size ?? 16} className={opts?.className} />;
  }
  // built-in phases pass plain glyphs like "■", "?", "⊞" — keep them working
  return <>{id}</>;
}
```

Callers that today drop `entry.icon` into JSX:

- [PaletteItem.tsx:60](packages/flow-editor/src/palette/PaletteItem.tsx:60) — `{entry.icon}` → `{resolvePhaseIcon(entry.icon)}`
- Custom-phase canvas node (the node that renders `custom-ai:*` boxes) — same swap
- Any other site that surfaces `PhaseDefinition.icon` directly (grep for `entry.icon`, `\.icon}` in flow-editor and web; touch each)

`PhaseDefinition.icon` stays typed as `string` on the wire — `resolvePhaseIcon` does all the interpretation.

### Data model

Migration `024_custom_phase_icon.sql`:

```sql
ALTER TABLE jm_custom_ai_phases
  ADD COLUMN icon TEXT NULL;
```

No backfill — existing rows stay `NULL`, which resolves to the default. No NOT NULL constraint; null is a meaningful "use default" sentinel.

### Type changes (`@journeyman/core`)

In [custom-phases.types.ts](packages/core/src/types/custom-phases.types.ts):

```ts
export interface CustomAiPhase {
  // …existing fields…
  icon?: string | null;
}

export interface CustomAiPhaseCreateInput {
  // …existing…
  icon?: string | null;
}

export type CustomAiPhaseUpdateInput = Partial<Omit<CustomAiPhaseCreateInput, "scope">>;
// (icon is already covered by Partial)
```

### Server (`@journeyman/custom-phases`)

`db.ts`:
- `rowToPhase` reads `r.icon ?? null`.
- `insertCustomAiPhase` includes `icon` in the INSERT (default `null`).
- `updateCustomAiPhase` patches `icon` when `patch.icon !== undefined` (allow setting `null` to reset).

Route validation (in both `routes/user-custom-phases.ts` and `routes/org-custom-phases.ts`, ideally factored into a shared validator):

```ts
function validateIcon(icon: unknown): string | null {
  if (icon === null || icon === undefined) return null;
  if (typeof icon !== "string") throw new BadRequest("icon must be a string or null");
  if (icon.startsWith("lucide:")) {
    const name = icon.slice("lucide:".length);
    if (!CUSTOM_PHASE_ICON_NAMES.includes(name)) {
      throw new BadRequest(`Unknown icon: ${name}`);
    }
    return icon;
  }
  // data:image/... will land here once uploads ship; reject for now.
  throw new BadRequest("Unsupported icon scheme");
}
```

The allowlist is imported by the server from a shared constants module. To avoid making `@journeyman/custom-phases` depend on `@journeyman/flow-editor` (a React package), put the **list of names only** (no Lucide imports) in `@journeyman/core` as `CUSTOM_PHASE_ICON_NAMES`. Flow-editor imports both `CUSTOM_PHASE_ICON_NAMES` (from core) and the Lucide components, and builds `CUSTOM_PHASE_ICON_COMPONENTS` locally.

### Synthesizer (`useCustomPhasePaletteEntries`)

[buildSyntheticPhase](packages/web/src/flow-editor-integration/useCustomPhasePaletteEntries.ts:35):

```ts
icon: p.icon ?? "lucide:Puzzle",
```

(One-line change. Default kept consistent with `DEFAULT_CUSTOM_PHASE_ICON`.)

### Admin UI — icon picker

[EditCustomPhaseModal.tsx](packages/web/src/components/custom-phases/EditCustomPhaseModal.tsx) gains an `Icon` field next to name/description.

Picker layout:
- Section heading `Icon` with current selection rendered at ~24px.
- Below: a CSS grid of all curated icons (~8 columns × 5 rows for 40). Each tile is a button: icon at ~20px, name as `title` attribute, `aria-pressed` on the selected one.
- A `Reset to default` link button (sets `icon` back to `null`, UI shows the default Puzzle).

No upload affordance yet — leave a single comment in the picker component noting where it'll slot in so the next implementer doesn't redesign.

### API surface

No new endpoints. The existing create/update routes accept the new `icon` field. The visible-list response (`GET /api/orgs/:id/custom-phases/visible`) now includes `icon`.

## Why these trade-offs

- **One column, scheme-prefixed string** beats `(icon_kind, icon_value)` because uploads land without a schema change and there's nothing to keep in sync.
- **Lucide over emoji** because the rest of the app already uses Lucide (consistent stroke weight, theme-aware color). Emoji would render inconsistently across OSes.
- **40 icons** is enough breadth without becoming a wall. The picker fits one viewport without scrolling.
- **Null sentinel for "use default"** beats writing the default id at create time — it lets us change the default later without migrating rows.

## Risks

- **Bundle size.** Lucide is tree-shaken, but importing 40 named exports adds ~8–12 KB gzipped to the editor bundle. Acceptable.
- **Picker churn if Lucide drops a name.** Mitigated by pinning the version; if it happens, the resolver renders the raw `lucide:<Name>` string and the picker hides the missing entry.
- **Allowlist drift.** Server and client must agree. Shared constant in `@journeyman/core` is the single source.

## Open questions

1. Confirm the 40-name seed list above is the one we ship, or substitute/remove specific names.
2. Confirm `Puzzle` as the default (keeps continuity with today's `🧩`).
3. Should the picker group icons (e.g. "AI", "Code", "Review", "Notify") or stay as one flat grid? Flat grid is simpler — propose flat for v1.

## Out of scope (future)

- User-uploaded raster icons (the `data:image/...` branch of `resolvePhaseIcon` already exists; needs only an upload UI + server-side downscale + size cap).
- Per-node-instance icon override.
- Icon search/filter in the picker.
