# Coding-Model Admin: Provider Dropdown + Server Validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-text Provider input on the admin Coding Models page with a catalog-sourced dropdown, and reject unknown provider values in the admin REST API.

**Architecture:** Source the dropdown options from `providersForKind("coding-cli")` in `@journeyman/core` (already exported). Add a small pure-function validator in `@journeyman/coding-models` that wraps the catalog set, unit-test it with vitest, and call it from the POST and PATCH admin route handlers. Update the React form to use a `<select>` with a legacy-value fallback for existing rows whose `provider` is not in the catalog.

**Tech Stack:** TypeScript, React (web), Fastify (coding-models routes), vitest.

**Spec:** [docs/superpowers/specs/2026-05-14-coding-model-provider-dropdown-design.md](../specs/2026-05-14-coding-model-provider-dropdown-design.md)

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/coding-models/src/validate-provider.ts` | Create | Pure helper `isValidCodingProvider(value: string): boolean` plus exported `LIST_CODING_PROVIDERS` array for error messages. |
| `packages/coding-models/src/validate-provider.test.ts` | Create | Vitest tests for the helper. |
| `packages/coding-models/package.json` | Modify | Add `vitest` devDep and `"test": "vitest run"` script. |
| `packages/coding-models/src/routes/admin.ts` | Modify | Validate `provider` in POST (always) and PATCH (when present). |
| `packages/web/src/routes/AdminCodingModelsPage.tsx` | Modify | Replace provider `<input>` with `<select>`; legacy-value fallback in edit mode. |

No DB migration, no other packages touched.

---

## Task 1: Validator helper + tests

**Files:**
- Create: `packages/coding-models/src/validate-provider.ts`
- Create: `packages/coding-models/src/validate-provider.test.ts`
- Modify: `packages/coding-models/package.json`

- [ ] **Step 1: Add vitest to package.json**

Modify `packages/coding-models/package.json` — update the `scripts` block and add `vitest` to `devDependencies`:

```json
{
  "name": "@journeyman/coding-models",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@journeyman/core": "*",
    "@journeyman/identity": "*",
    "pg": "^8.13.0"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "@types/pg": "^8.11.10",
    "typescript": "^6.0.3",
    "vitest": "^2.1.9"
  }
}
```

Then install:

```bash
npm install
```

- [ ] **Step 2: Write the failing test**

Create `packages/coding-models/src/validate-provider.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isValidCodingProvider, LIST_CODING_PROVIDERS } from "./validate-provider.ts";

describe("isValidCodingProvider", () => {
  it("accepts every coding-cli provider in the core catalog", () => {
    expect(LIST_CODING_PROVIDERS.length).toBeGreaterThan(0);
    for (const value of LIST_CODING_PROVIDERS) {
      expect(isValidCodingProvider(value)).toBe(true);
    }
  });

  it("rejects unknown provider values", () => {
    expect(isValidCodingProvider("clade")).toBe(false);
    expect(isValidCodingProvider("openai")).toBe(false);
    expect(isValidCodingProvider("")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isValidCodingProvider(undefined as unknown as string)).toBe(false);
    expect(isValidCodingProvider(null as unknown as string)).toBe(false);
    expect(isValidCodingProvider(123 as unknown as string)).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test --workspace @journeyman/coding-models`
Expected: FAIL — cannot find module `./validate-provider.ts`.

- [ ] **Step 4: Implement the helper**

Create `packages/coding-models/src/validate-provider.ts`:

```ts
import { providersForKind } from "@journeyman/core";

const VALID = new Set(providersForKind("coding-cli").map((p) => p.value));

export const LIST_CODING_PROVIDERS: readonly string[] = [...VALID];

export function isValidCodingProvider(value: unknown): value is string {
  return typeof value === "string" && VALID.has(value);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --workspace @journeyman/coding-models`
Expected: PASS — 3 tests pass.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck --workspace @journeyman/coding-models`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add packages/coding-models/package.json \
        packages/coding-models/src/validate-provider.ts \
        packages/coding-models/src/validate-provider.test.ts \
        package-lock.json
git commit -m "feat(coding-models): add catalog-backed coding-cli provider validator"
```

---

## Task 2: Validate provider in admin POST and PATCH

**Files:**
- Modify: `packages/coding-models/src/routes/admin.ts`

- [ ] **Step 1: Add the import and validation to POST**

Edit `packages/coding-models/src/routes/admin.ts`. Add the import near the top alongside the existing imports:

```ts
import { isValidCodingProvider, LIST_CODING_PROVIDERS } from "../validate-provider.ts";
```

In the `POST /api/admin/coding-models` handler, immediately after the existing presence check (around line 39-41), insert the provider validation:

```ts
      if (!b?.provider || !b?.modelId || !b?.label) {
        return reply.code(400).send({ error: "provider, modelId, label required" });
      }
      if (!isValidCodingProvider(b.provider)) {
        return reply.code(400).send({
          error: `Unknown coding-cli provider: ${b.provider}. Allowed: ${LIST_CODING_PROVIDERS.join(", ")}`,
        });
      }
```

- [ ] **Step 2: Add validation to PATCH**

In the `PATCH /api/admin/coding-models/:id` handler, after the `existing` lookup and before the `updateCodingModel` call (around line 73-75), insert:

```ts
      const patch = req.body as Record<string, unknown> | undefined;
      if (patch && Object.prototype.hasOwnProperty.call(patch, "provider")) {
        if (!isValidCodingProvider(patch.provider)) {
          return reply.code(400).send({
            error: `Unknown coding-cli provider: ${String(patch.provider)}. Allowed: ${LIST_CODING_PROVIDERS.join(", ")}`,
          });
        }
      }
```

(Validate only when `provider` is in the patch body, since PATCH is partial.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace @journeyman/coding-models`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/coding-models/src/routes/admin.ts
git commit -m "feat(coding-models): reject unknown coding-cli providers in admin API"
```

---

## Task 3: Provider dropdown in admin UI

**Files:**
- Modify: `packages/web/src/routes/AdminCodingModelsPage.tsx`

- [ ] **Step 1: Add the catalog import**

Edit the import block at the top of `packages/web/src/routes/AdminCodingModelsPage.tsx`:

```tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { CodingModel, CodingModelCreateInput } from "@journeyman/core";
import { providersForKind } from "@journeyman/core";
import { codingModelsApi } from "../api/codingModels.ts";
import {
  btnGhost,
  btnPrimary,
  btnDanger,
  card,
  inputCls,
} from "./admin-styles.ts";
```

- [ ] **Step 2: Add a module-level constant for the options**

Below the imports and above `const EMPTY`, insert:

```tsx
const CODING_PROVIDERS = providersForKind("coding-cli");
```

- [ ] **Step 3: Replace the provider input with a select**

Find the Provider Field around line 168:

```tsx
            <Field label="Provider">
              <input className={inputCls} value={v.provider} onChange={(e) => set("provider", e.target.value)} placeholder="claude" />
            </Field>
```

Replace it with:

```tsx
            <Field label="Provider">
              <select
                className={inputCls}
                value={v.provider}
                onChange={(e) => set("provider", e.target.value)}
              >
                {!CODING_PROVIDERS.some((p) => p.value === v.provider) && v.provider && (
                  <option value={v.provider} disabled>
                    {v.provider} (unknown)
                  </option>
                )}
                {CODING_PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                    {!p.implemented ? " (not yet implemented)" : ""}
                  </option>
                ))}
              </select>
            </Field>
```

The disabled `(unknown)` option only renders for an edit on a legacy row whose stored provider isn't in the catalog. It keeps the value visible and forces the admin to pick a valid one to save.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck --workspace @journeyman/web`
Expected: No errors.

(If the workspace name differs, use the name from `packages/web/package.json`.)

- [ ] **Step 5: Manual smoke test**

Start the web app (e.g. `npm run dev --workspace @journeyman/web` or whatever the project uses) and:

1. Open the admin Coding Models page.
2. Click "New model" — the Provider field is a dropdown with Claude / Gemini / Codex; Claude is preselected (matches `EMPTY.provider`).
3. Save a row with provider = Claude and a fresh `modelId` — succeeds.
4. Try a raw API call to confirm the server guard:

   ```bash
   curl -X POST http://localhost:<port>/api/admin/coding-models \
     -H 'Content-Type: application/json' \
     --cookie '<auth cookie>' \
     -d '{"provider":"clade","modelId":"x","label":"y"}'
   ```

   Expected: HTTP 400 with body `{"error":"Unknown coding-cli provider: clade. Allowed: claude, gemini, codex"}`.
5. Edit the row created in step 3 — dropdown shows the current value selected; switching providers and saving works.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/routes/AdminCodingModelsPage.tsx
git commit -m "feat(web): catalog-backed provider dropdown on admin Coding Models page"
```

---

## Done criteria

- `npm test --workspace @journeyman/coding-models` passes.
- `npm run typecheck` passes for `@journeyman/coding-models` and `@journeyman/web`.
- Admin "New model" form shows a provider dropdown sourced from the core catalog.
- `POST /api/admin/coding-models` with an unknown provider returns 400 with the allowed-list message.
- `PATCH /api/admin/coding-models/:id` with `{ "provider": "<bad>" }` returns 400; PATCHes without a `provider` field still work.
- Editing an existing row whose `provider` isn't in the catalog renders a disabled `"<value> (unknown)"` option pre-selected.
