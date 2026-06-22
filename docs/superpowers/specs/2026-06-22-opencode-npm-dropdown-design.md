# OpenCode `npm` package field → dropdown

**Date:** 2026-06-22
**Status:** Approved (design)
**Area:** `web` (AdminCodingModelsPage)

## Problem

In the admin coding-models form, the **opencode** provider renders its `config.npm` field
as a free-text `<input>`, while the **aisdk** provider renders the same field as a `<select>`
dropdown populated from a shared list. The opencode field should be a dropdown too, matching
aisdk, so users pick from known provider packages instead of typing a string.

## Current state

`packages/web/src/routes/AdminCodingModelsPage.tsx`, the `npm package` Field
(~lines 413-431) branches on provider:

```tsx
{v.provider === "aisdk" ? (
  <select className={inputCls} value={v.config?.npm ?? ""} onChange={(e) => setConfig("npm", e.target.value)}>
    <option value="" disabled>Select a provider package…</option>
    {AISDK_PROVIDER_PACKAGES.map((p) => (
      <option key={p.npm} value={p.npm}>{p.label} — {p.npm}</option>
    ))}
  </select>
) : (
  <input className={`${inputCls} font-mono text-sm`} value={v.config?.npm ?? ""}
    onChange={(e) => setConfig("npm", e.target.value)} placeholder="@ai-sdk/openai-compatible" />
)}
```

The option list lives in `packages/core/src/registries/aisdk-packages.ts`:

```ts
export const AISDK_PROVIDER_PACKAGES: AiSdkPackage[] = [
  { npm: "@ai-sdk/anthropic",         label: "Anthropic (Claude)" },
  { npm: "@ai-sdk/openai",            label: "OpenAI (GPT)" },
  { npm: "@ai-sdk/google",            label: "Google (Gemini)" },
  { npm: "@ai-sdk/openai-compatible", label: "OpenAI-compatible (local / gateway / Azure)", requiresBaseUrl: true },
];
```

Both `AISDK_PROVIDER_PACKAGES` and `isAiSdkPackage` are exported from `@journeyman/core`
(the form already imports `AISDK_PROVIDER_PACKAGES`).

## Decision

Reuse the existing `AISDK_PROVIDER_PACKAGES` list for opencode too (per brainstorming). No new
constant, no separate opencode-specific list.

## Design

Scope: one file — `packages/web/src/routes/AdminCodingModelsPage.tsx`. No backend changes, no
new shared constants.

Collapse the provider ternary so **both** opencode and aisdk render the same `<select>` (the
enclosing "Custom endpoint" section already only renders when provider is `opencode` or
`aisdk`):

```tsx
<Field label="npm package">
  <select
    className={inputCls}
    value={v.config?.npm ?? ""}
    onChange={(e) => setConfig("npm", e.target.value)}
  >
    <option value="" disabled>Select a provider package…</option>
    {AISDK_PROVIDER_PACKAGES.map((p) => (
      <option key={p.npm} value={p.npm}>{p.label} — {p.npm}</option>
    ))}
    {/* backward-compat: surface an existing custom npm value not in the list */}
    {v.config?.npm && !isAiSdkPackage(v.config.npm) && (
      <option value={v.config.npm}>{v.config.npm} (custom)</option>
    )}
  </select>
</Field>
```

Add `isAiSdkPackage` to the existing `@journeyman/core` import.

### Deliberate decisions

1. **Backward compatibility.** opencode's `npm` was free text, so existing rows may hold a
   value outside the four packages (or be empty). A plain `<select>` would render an unmatched
   value as blank and silently drop it on save. The extra `(custom)` option keeps any existing
   value visible and selectable, so editing an old model does not quietly change it.

2. **Backend validation unchanged.** opencode validation in
   `packages/coding-models/src/validate-config.ts` continues to accept any non-empty `npm`
   string. The dropdown guides new choices to the four supported packages, but validation is
   not tightened — this avoids breaking existing custom-npm rows and needs no migration. This
   is technically sound: the opencode server resolves provider packages itself, so it is not
   limited to the agent-runtime esbuild bundle the way aisdk is.

### Not changing

- The aisdk-only note that Base URL is required for `@ai-sdk/openai-compatible`.
- The provider-conditional model-ID help text and placeholders.

Only the npm control is unified.

## Verification

- Load the admin coding-models page, switch provider to opencode, confirm the `npm` field is a
  dropdown with the four packages.
- Edit an existing opencode model that had a custom npm value; confirm it still appears
  (as `… (custom)`) and is preserved on save.
- `npm run typecheck` clean.

## Out of scope

- A separate opencode-specific package list.
- Adding new packages to `AISDK_PROVIDER_PACKAGES`.
- Backend validation changes / DB migration.
