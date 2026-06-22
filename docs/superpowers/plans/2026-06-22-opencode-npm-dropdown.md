# OpenCode `npm` Package Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the opencode provider's free-text `npm` input in the admin coding-models form with the same dropdown the aisdk provider uses.

**Architecture:** Single-file React change in the admin form. Collapse the provider ternary on the "npm package" field so both opencode and aisdk render one shared `<select>` driven by `AISDK_PROVIDER_PACKAGES`, plus a backward-compat option that preserves any existing custom npm value. No backend, no shared-constant, no validation changes.

**Tech Stack:** React, TypeScript, `@journeyman/core` (`AISDK_PROVIDER_PACKAGES`, `isAiSdkPackage`), Vite, browser preview.

**Spec:** [docs/superpowers/specs/2026-06-22-opencode-npm-dropdown-design.md](../specs/2026-06-22-opencode-npm-dropdown-design.md)

**Note on testing:** This page (`AdminCodingModelsPage.tsx`) has no existing component-test setup in the repo, and the spec scopes this as a presentational swap. Verification is by `npm run typecheck` plus a browser-preview check, not a new unit test — adding a React Testing Library harness for one field would be out of proportion (YAGNI).

---

## File Structure

- **Modify** `packages/web/src/routes/AdminCodingModelsPage.tsx`
  - Line 5: add `isAiSdkPackage` to the existing `@journeyman/core` import.
  - Lines 412-432: replace the `npm package` Field's provider ternary with a single shared `<select>` (+ backward-compat custom option).

---

## Task 1: Unify the npm field as a dropdown for both providers

**Files:**
- Modify: `packages/web/src/routes/AdminCodingModelsPage.tsx:5` (import)
- Modify: `packages/web/src/routes/AdminCodingModelsPage.tsx:412-432` (the Field)

- [ ] **Step 1: Add `isAiSdkPackage` to the core import**

The file currently imports (line 5):

```tsx
import { providersForKind, AISDK_PROVIDER_PACKAGES } from "@journeyman/core";
```

Change it to:

```tsx
import { providersForKind, AISDK_PROVIDER_PACKAGES, isAiSdkPackage } from "@journeyman/core";
```

(`isAiSdkPackage` is exported from `@journeyman/core` alongside `AISDK_PROVIDER_PACKAGES` — see `packages/core/src/index.ts`.)

- [ ] **Step 2: Replace the npm Field body with a single shared select**

Replace the entire `npm package` Field (current lines 412-432, the block starting `<Field label="npm package">` and ending at its closing `</Field>`) with:

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
                {v.config?.npm && !isAiSdkPackage(v.config.npm) && (
                  <option value={v.config.npm}>{v.config.npm} (custom)</option>
                )}
              </select>
            </Field>
```

This removes the `v.provider === "aisdk" ? <select> : <input>` branch — both providers now render the select. The enclosing section (line ~392) already only renders when `v.provider === "opencode" || v.provider === "aisdk"`, so no extra guarding is needed. The trailing `(custom)` option keeps any pre-existing non-listed opencode npm value visible and selectable.

- [ ] **Step 3: Type-check the web package**

Run: `npm run typecheck --workspace @journeyman/web`
Expected: PASS (no errors). `isAiSdkPackage(value: string)` returns `boolean`; the guard `v.config?.npm && !isAiSdkPackage(v.config.npm)` is well-typed because `v.config?.npm` is narrowed to a non-empty string before the call.

- [ ] **Step 4: Verify in the browser preview**

1. Ensure the dev server is running (start it if needed) and open the admin coding-models page (`/admin/coding-models` route, via `AdminCodingModelsPage`).
2. Open the create/edit form and set **Provider = opencode**.
3. Confirm the **npm package** field is now a dropdown showing the four packages: `Anthropic (Claude) — @ai-sdk/anthropic`, `OpenAI (GPT) — @ai-sdk/openai`, `Google (Gemini) — @ai-sdk/google`, `OpenAI-compatible (local / gateway / Azure) — @ai-sdk/openai-compatible`.
4. Confirm switching **Provider = aisdk** still shows the same dropdown (unchanged behavior).
5. Backward-compat check: if an existing opencode model in the list has a custom npm value (one not among the four), open it for edit and confirm the dropdown shows that value as `… (custom)` and selected; saving without changing it preserves the value.

Expected: opencode npm field is a dropdown; existing custom values are preserved.

---

## Task 2: Final type-check (whole repo)

**Files:** none — verification only.

- [ ] **Step 1: Run the repo type-check**

Run: `npm run typecheck`
Expected: PASS for all workspaces. The change is confined to the web package and uses an already-exported helper.

---

## Self-Review

- **Spec coverage:** opencode dropdown reusing `AISDK_PROVIDER_PACKAGES` (Task 1, Step 2) ✓; collapse the ternary so both providers share the select (Step 2) ✓; backward-compat `(custom)` option via `isAiSdkPackage` (Steps 1-2) ✓; backend validation unchanged (no task touches `validate-config.ts`) ✓; aisdk-only Base URL note and model-ID help text untouched (edit is scoped to the npm Field only) ✓; verification via typecheck + preview (Task 1 Step 3-4, Task 2) ✓.
- **Placeholder scan:** none — the full replacement JSX and import line are shown.
- **Type consistency:** `isAiSdkPackage` and `AISDK_PROVIDER_PACKAGES` names match their `@journeyman/core` exports; `v.config?.npm` / `setConfig("npm", …)` match the existing form state usage.
