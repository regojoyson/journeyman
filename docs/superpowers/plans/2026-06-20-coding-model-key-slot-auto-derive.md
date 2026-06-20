# Auto-derive coding-model API-key env var name — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the human-typed "Env var name" field from coding models and derive the internal env-var label automatically from `(provider, config, modelId)`, so a typo can never desync the write/read label and cause a 401.

**Architecture:** A single core helper `codingModelKeySlot()` becomes the one source of truth for the label. The worker writes the bound secret under that label; the runner reads it under the same label — computed identically on both sides, so they can never disagree. The old `config.apiKeySlot` string is replaced by an explicit boolean `config.requiresApiKey`.

**Tech Stack:** TypeScript (npm workspaces monorepo), Vitest, React (web UI), PostgreSQL (append-only SQL migrations), `pg`.

**Execution constraints (from user):** Work on `master`. **Do NOT commit** — leave all changes in the working tree. The final task is a typecheck.

---

## File Structure

| File | Change |
|---|---|
| `packages/core/src/types/coding-models.types.ts` | Add `requiresApiKey?: boolean`; deprecate/keep `apiKeySlot` doc note |
| `packages/core/src/registries/coding-model-key-slot.ts` | **New** — `codingModelKeySlot()` helper |
| `packages/core/src/registries/coding-model-key-slot.test.ts` | **New** — helper tests |
| `packages/core/src/index.ts` | Export the new helper |
| `packages/core/src/registries/opencode-slots.ts` | Derive slot from `requiresApiKey` + modelId (not `apiKeySlot`) |
| `packages/core/src/registries/opencode-slots.test.ts` | Update to new signature |
| `packages/core/src/registries/coding-model-slots.test.ts` | Update to new signature |
| `packages/coding-models/src/validate-config.ts` | Drop `apiKeySlot` checks |
| `packages/coding-models/src/validate-config.test.ts` | Update |
| `packages/coding-models/src/routes/org.ts` | `needsKey = config.requiresApiKey` |
| `packages/orchestrator/src/cli-worker.ts` | `modelKeyResolver`: gate on `requiresApiKey`, derive slot |
| `packages/orchestrator/src/workers/steps/agent-run-step-handler.ts` | Use helper + gate on `requiresApiKey` |
| `packages/orchestrator/src/workers/steps/custom-ai-step-handler.ts` | Hoist `model`, pass modelId to `openCodeModelSlots` |
| `packages/agent-runtime/src/providers/aisdk/model.ts` | Derive slot via helper |
| `packages/agent-runtime/src/providers/aisdk/model.test.ts` | Update |
| `packages/agent-runtime/src/providers/opencode/server-config.ts` | Derive slot via helper |
| `packages/agent-runtime/src/providers/opencode/server-config.test.ts` | Update |
| `packages/web/src/routes/AdminCodingModelsPage.tsx` | Remove "Env var name" field; use `requiresApiKey` |
| `packages/migrations/src/sql/063_coding_model_requires_api_key.sql` | **New** — backfill |

---

## Task 1: Add `requiresApiKey` to the config type

**Files:**
- Modify: `packages/core/src/types/coding-models.types.ts`

- [ ] **Step 1: Add the field**

In `interface CodingModelConfig`, add `requiresApiKey` and update the `apiKeySlot` doc to mark it legacy:

```ts
export interface CodingModelConfig {
  /** Custom endpoint base URL, e.g. http://host.docker.internal:1234/v1. */
  baseUrl?: string;
  /** AI-SDK npm package for the provider; defaults to "@ai-sdk/openai-compatible". */
  npm?: string;
  /** Whether this model needs an API key bound (replaces the old typed apiKeySlot). */
  requiresApiKey?: boolean;
  /** @deprecated Legacy typed env-var label. No longer read; the label is derived
   *  by codingModelKeySlot(). Kept only so old JSONB rows still parse. */
  apiKeySlot?: string;
}
```

- [ ] **Step 2: Typecheck the package**

Run: `npm run typecheck --workspace @journeyman/core`
Expected: PASS (field is optional, no call sites break yet).

---

## Task 2: Create the `codingModelKeySlot` helper (TDD)

**Files:**
- Create: `packages/core/src/registries/coding-model-key-slot.ts`
- Test: `packages/core/src/registries/coding-model-key-slot.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/registries/coding-model-key-slot.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { codingModelKeySlot } from "./coding-model-key-slot.ts";

describe("codingModelKeySlot", () => {
  it("claude → ANTHROPIC_API_KEY", () => {
    expect(codingModelKeySlot({ provider: "claude", config: undefined, modelId: "claude-opus" }))
      .toBe("ANTHROPIC_API_KEY");
  });

  it("aisdk maps by npm package", () => {
    expect(codingModelKeySlot({ provider: "aisdk", config: { npm: "@ai-sdk/anthropic" }, modelId: "x" }))
      .toBe("ANTHROPIC_API_KEY");
    expect(codingModelKeySlot({ provider: "aisdk", config: { npm: "@ai-sdk/openai" }, modelId: "x" }))
      .toBe("OPENAI_API_KEY");
    expect(codingModelKeySlot({ provider: "aisdk", config: { npm: "@ai-sdk/google" }, modelId: "x" }))
      .toBe("GOOGLE_GENERATIVE_AI_API_KEY");
  });

  it("aisdk openai-compatible (label is cosmetic) → stable fallback", () => {
    expect(codingModelKeySlot({
      provider: "aisdk",
      config: { npm: "@ai-sdk/openai-compatible", baseUrl: "https://api.minimax.io/v1" },
      modelId: "MiniMax-M3",
    })).toBe("AISDK_API_KEY");
  });

  it("opencode cloud → standard name from model id", () => {
    expect(codingModelKeySlot({ provider: "opencode", config: {}, modelId: "anthropic/claude-sonnet-4-6" }))
      .toBe("ANTHROPIC_API_KEY");
    expect(codingModelKeySlot({ provider: "opencode", config: {}, modelId: "google/gemini-2.0" }))
      .toBe("GEMINI_API_KEY");
  });

  it("opencode with no provider prefix → fallback", () => {
    expect(codingModelKeySlot({ provider: "opencode", config: { baseUrl: "http://gw/v1" }, modelId: "local-model" }))
      .toBe("OPENCODE_API_KEY");
  });

  it("unknown provider → generic fallback", () => {
    expect(codingModelKeySlot({ provider: "mystery", config: undefined, modelId: undefined }))
      .toBe("API_KEY");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace @journeyman/core -- coding-model-key-slot`
Expected: FAIL — cannot find module `./coding-model-key-slot.ts`.

- [ ] **Step 3: Implement the helper**

Create `packages/core/src/registries/coding-model-key-slot.ts`:

```ts
import type { CodingModelConfig } from "../types/coding-models.types.ts";
import { suggestedKeySlotName } from "./opencode-slots.ts";

/**
 * The internal env-var label the bound API key is placed under at run time.
 * Single source of truth: the worker writes env[label] and the runner reads
 * env[label], both calling this with the same inputs, so they always agree.
 *
 * The label only matters on cloud fallback paths (claude SDK, opencode built-in
 * catalog) which read a specific name from process.env; explicit-apiKey paths
 * (aisdk, opencode custom endpoint) accept any label.
 */
export function codingModelKeySlot(input: {
  provider: string;
  config: CodingModelConfig | undefined;
  modelId: string | undefined;
}): string {
  const { provider, config, modelId } = input;
  if (provider === "claude") return "ANTHROPIC_API_KEY";
  if (provider === "aisdk") {
    const byNpm: Record<string, string> = {
      "@ai-sdk/anthropic": "ANTHROPIC_API_KEY",
      "@ai-sdk/openai": "OPENAI_API_KEY",
      "@ai-sdk/google": "GOOGLE_GENERATIVE_AI_API_KEY",
    };
    return byNpm[config?.npm ?? ""] ?? "AISDK_API_KEY";
  }
  if (provider === "opencode") {
    return suggestedKeySlotName(modelId) || "OPENCODE_API_KEY";
  }
  return "API_KEY";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace @journeyman/core -- coding-model-key-slot`
Expected: PASS (all cases).

- [ ] **Step 5: Export from core**

In `packages/core/src/index.ts`, after the `opencode-slots` export (line ~136) add:

```ts
export { codingModelKeySlot } from "./registries/coding-model-key-slot.ts";
```

---

## Task 3: Derive `openCodeModelSlots` from `requiresApiKey` (TDD)

**Files:**
- Modify: `packages/core/src/registries/opencode-slots.ts`
- Test: `packages/core/src/registries/opencode-slots.test.ts`
- Test: `packages/core/src/registries/coding-model-slots.test.ts`

`openCodeModelSlots` declares the secret slot the binding resolver auto-fills for the custom-ai path. It must now derive the name the same way the runner does, and gate on `requiresApiKey` instead of the removed `apiKeySlot`.

- [ ] **Step 1: Rewrite the failing tests**

Replace `packages/core/src/registries/opencode-slots.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { openCodeModelSlots, suggestedKeySlotName } from "./opencode-slots.ts";

describe("openCodeModelSlots", () => {
  it("returns one required slot, named by derivation, when requiresApiKey is true", () => {
    expect(openCodeModelSlots({ requiresApiKey: true }, "anthropic/claude-sonnet-4-6")).toEqual([
      { name: "ANTHROPIC_API_KEY", description: "API key for this model.", optional: false },
    ]);
  });
  it("returns [] when the model does not require a key", () => {
    expect(openCodeModelSlots(undefined, "anthropic/claude")).toEqual([]);
    expect(openCodeModelSlots({}, "anthropic/claude")).toEqual([]);
    expect(openCodeModelSlots({ requiresApiKey: false }, "anthropic/claude")).toEqual([]);
  });
});

describe("suggestedKeySlotName", () => {
  it("derives ${PROVIDERID}_API_KEY from the model id", () => {
    expect(suggestedKeySlotName("anthropic/claude-sonnet-4-6")).toBe("ANTHROPIC_API_KEY");
    expect(suggestedKeySlotName("openai/gpt-4o")).toBe("OPENAI_API_KEY");
    expect(suggestedKeySlotName("openrouter/meta-llama/llama-3.1")).toBe("OPENROUTER_API_KEY");
    expect(suggestedKeySlotName("mistral/large")).toBe("MISTRAL_API_KEY");
  });
  it("overrides google → GEMINI_API_KEY", () => {
    expect(suggestedKeySlotName("google/gemini-2.0-flash")).toBe("GEMINI_API_KEY");
  });
  it("returns '' for a model id with no provider prefix", () => {
    expect(suggestedKeySlotName("claude-opus")).toBe("");
    expect(suggestedKeySlotName(undefined)).toBe("");
  });
});
```

Replace `packages/core/src/registries/coding-model-slots.test.ts` with:

```ts
import { describe, it, expect } from "vitest";
import { codingModelSlots } from "./opencode-slots.ts";

describe("codingModelSlots", () => {
  it("returns the derived key slot when a key is required", () => {
    expect(codingModelSlots({ requiresApiKey: true }, "anthropic/claude-sonnet-4-6")).toEqual([
      { name: "ANTHROPIC_API_KEY", description: "API key for this model.", optional: false },
    ]);
  });
  it("returns [] for a keyless model", () => {
    expect(codingModelSlots({}, "anthropic/claude")).toEqual([]);
    expect(codingModelSlots(undefined, "anthropic/claude")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test --workspace @journeyman/core -- opencode-slots coding-model-slots`
Expected: FAIL — `openCodeModelSlots` does not accept a second arg / still reads `apiKeySlot`.

- [ ] **Step 3: Update the implementation**

In `packages/core/src/registries/opencode-slots.ts`, replace `openCodeModelSlots` (keep `suggestedKeySlotName` and the `codingModelSlots` alias):

```ts
import type { SecretSlotDef } from "../types/secret-slot.types.ts";
import type { CodingModelConfig } from "../types/coding-models.types.ts";
import { codingModelKeySlot } from "./coding-model-key-slot.ts";

/**
 * The required key slot a coding model needs, derived from its config. Single
 * source of truth for the editor, publish validation, and worker. Empty when the
 * model declares no key. The slot NAME is derived (codingModelKeySlot), never
 * typed by a user.
 */
export function openCodeModelSlots(
  config: CodingModelConfig | undefined,
  modelId: string | undefined,
): SecretSlotDef[] {
  if (!config?.requiresApiKey) return [];
  return [{
    name: codingModelKeySlot({ provider: "opencode", config, modelId }),
    description: "API key for this model.",
    optional: false,
  }];
}

/** Generic alias: any coding model that requires a key surfaces exactly that slot. */
export const codingModelSlots = openCodeModelSlots;
```

Leave `suggestedKeySlotName` unchanged below it.

> Note: this introduces an import cycle risk — `opencode-slots.ts` imports `coding-model-key-slot.ts`, which imports `suggestedKeySlotName` from `opencode-slots.ts`. ES modules handle this (function hoisting + lazy use), but if Vitest reports a circular-init error, move `suggestedKeySlotName` into its own file `key-slot-name.ts` and have both import from there.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test --workspace @journeyman/core -- opencode-slots coding-model-slots coding-model-key-slot`
Expected: PASS.

---

## Task 4: Drop `apiKeySlot` validation (TDD)

**Files:**
- Modify: `packages/coding-models/src/validate-config.ts`
- Test: `packages/coding-models/src/validate-config.test.ts`

- [ ] **Step 1: Update the failing test**

In `packages/coding-models/src/validate-config.test.ts`, remove the two `apiKeySlot`-specific cases (the "rejects an empty-string apiKeySlot" test and the `apiKeySlot` arg in the aisdk valid case). Replace the aisdk valid-config assertion (line ~34) with:

```ts
expect(validateCodingModelConfig("aisdk", { npm: "@ai-sdk/anthropic" })).toBeNull();
expect(validateCodingModelConfig("aisdk", { requiresApiKey: true, npm: "@ai-sdk/anthropic" })).toBeNull();
```

Delete the test named `rejects an empty-string apiKeySlot` entirely.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace @journeyman/coding-models -- validate-config`
Expected: FAIL — the deleted/changed assertions don't match current code that still validates `apiKeySlot`.

- [ ] **Step 3: Remove the `apiKeySlot` checks**

In `packages/coding-models/src/validate-config.ts`, delete both `apiKeySlot` validation blocks:
- In the `aisdk` branch, remove lines:
  ```ts
  if (config.apiKeySlot !== undefined && !config.apiKeySlot.trim()) {
    return "config.apiKeySlot must be a non-empty string";
  }
  ```
- In the `opencode` branch, remove lines:
  ```ts
  if (config.apiKeySlot !== undefined && (typeof config.apiKeySlot !== "string" || !config.apiKeySlot.trim())) {
    return "config.apiKeySlot must be a non-empty string";
  }
  ```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace @journeyman/coding-models -- validate-config`
Expected: PASS.

---

## Task 5: Route binding gate uses `requiresApiKey`

**Files:**
- Modify: `packages/coding-models/src/routes/org.ts:28`

- [ ] **Step 1: Change the gate**

In `validateBinding`, replace:

```ts
const needsKey = Boolean(config?.apiKeySlot?.trim());
```

with:

```ts
const needsKey = Boolean(config?.requiresApiKey);
```

- [ ] **Step 2: Typecheck the package**

Run: `npm run typecheck --workspace @journeyman/coding-models`
Expected: PASS.

---

## Task 6: Worker `modelKeyResolver` derives the slot

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts:493-501`

- [ ] **Step 1: Update the resolver**

Add the import near the other core imports at the top of `cli-worker.ts`:

```ts
import { codingModelKeySlot } from "@journeyman/core";
```

Replace the `modelKeyResolver` body (lines ~493-501):

```ts
modelKeyResolver: async ({ provider, modelId, orgId }) => {
  if (!pool || !orgId) return null;
  const m = await findCodingModel(pool, orgId, provider, modelId);
  if (!m?.apiKeySecretId || !m?.config?.requiresApiKey) return null;
  const value = await fetchSecretById(pool, orgId, m.apiKeySecretId);
  if (value == null) return null;
  const slot = codingModelKeySlot({ provider, config: m.config, modelId });
  return { slot, value };
},
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck --workspace @journeyman/orchestrator`
Expected: PASS.

---

## Task 7: `agent-run-step-handler` uses the helper

**Files:**
- Modify: `packages/orchestrator/src/workers/steps/agent-run-step-handler.ts:135-147`

- [ ] **Step 1: Add the import**

At the top with the other `@journeyman/core` imports, ensure `codingModelKeySlot` is imported:

```ts
import { codingModelKeySlot } from "@journeyman/core";
```

- [ ] **Step 2: Update the injection block**

Replace the model-owned key block (lines ~135-147):

```ts
const model = typeof input.model === "string" && input.model ? input.model : undefined;
if (provider && model && orgId) {
  try {
    const cm = await findCodingModel(this.deps.pool, orgId, provider, model);
    if (cm?.apiKeySecretId && cm.config?.requiresApiKey) {
      const value = await fetchSecretById(this.deps.pool, orgId, cm.apiKeySecretId);
      if (value != null) {
        const slot = codingModelKeySlot({ provider, config: cm.config, modelId: model });
        env[slot] = value;
      }
    }
  } catch (err: any) {
    log.warn({ err: err?.message }, "model key resolution failed; continuing without model-owned key");
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace @journeyman/orchestrator`
Expected: PASS.

---

## Task 8: `custom-ai-step-handler` passes modelId to `openCodeModelSlots`

**Files:**
- Modify: `packages/orchestrator/src/workers/steps/custom-ai-step-handler.ts:138-142,184`

`openCodeModelSlots` now needs the model id, but `model` is currently declared at line ~184 (after the slot loop at ~140). Hoist it.

- [ ] **Step 1: Hoist `model` above the slot loop**

Before line ~138 (`const modelConfig = ...`), add:

```ts
const model = typeof input.model === "string" && input.model ? input.model : undefined;
```

Then delete the later duplicate declaration at line ~184 (`const model = typeof input.model === "string" && input.model ? input.model : undefined;`) so `model` is declared once.

- [ ] **Step 2: Pass modelId to the slot helper**

Replace line ~140:

```ts
for (const s of openCodeModelSlots(modelConfig, model)) {
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck --workspace @journeyman/orchestrator`
Expected: PASS (no redeclaration, `model` in scope at both sites).

---

## Task 9: aisdk runner derives the slot (TDD)

**Files:**
- Modify: `packages/agent-runtime/src/providers/aisdk/model.ts:44-45`
- Test: `packages/agent-runtime/src/providers/aisdk/model.test.ts`

- [ ] **Step 1: Update the failing test**

In `model.test.ts`, the anthropic case currently puts the key under `apiKeySlot: "ANTHROPIC_API_KEY"`. Change it to rely on derivation — the env key is now derived from npm:

```ts
it("loads anthropic and passes the resolved api key", async () => {
  const m: any = await resolveModel(
    { modelId: "claude-sonnet-4-6", config: { npm: "@ai-sdk/anthropic" }, env: { ANTHROPIC_API_KEY: "sk-1" } },
    { importer },
  );
  expect(m).toMatchObject({ vendor: "anthropic", id: "claude-sonnet-4-6", key: "sk-1" });
});
```

Add a case proving openai-compatible reads from the derived fallback label:

```ts
it("openai-compatible reads the key from the derived label", async () => {
  const m: any = await resolveModel(
    {
      modelId: "MiniMax-M3",
      config: { npm: "@ai-sdk/openai-compatible", baseUrl: "https://api.minimax.io/v1" },
      env: { AISDK_API_KEY: "sk-mini" },
    },
    { importer: async () => fakeCompat },
  );
  expect(m).toMatchObject({ vendor: "compat", id: "MiniMax-M3" });
});
```

> The `fakeCompat` stub does not expose `key`; this case only asserts resolution succeeds with the derived env label present. (To assert the key value, extend `fakeCompat.createOpenAICompatible` to return `key: o.apiKey` and assert `key: "sk-mini"`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace @journeyman/agent-runtime -- aisdk/model`
Expected: FAIL — current code reads `config.apiKeySlot`, which is now absent, so `apiKey` is undefined and the anthropic `key` assertion fails.

- [ ] **Step 3: Update the implementation**

In `packages/agent-runtime/src/providers/aisdk/model.ts`, add the import:

```ts
import { codingModelKeySlot } from "@journeyman/core";
```

Replace lines ~44-45:

```ts
const slot = codingModelKeySlot({ provider: "aisdk", config: opts.config, modelId: opts.modelId });
const apiKey = opts.env?.[slot] ?? process.env[slot];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace @journeyman/agent-runtime -- aisdk/model`
Expected: PASS.

---

## Task 10: opencode runner derives the slot (TDD)

**Files:**
- Modify: `packages/agent-runtime/src/providers/opencode/server-config.ts:50-73`
- Test: `packages/agent-runtime/src/providers/opencode/server-config.test.ts`

- [ ] **Step 1: Update the failing test**

In `server-config.test.ts`, the custom-endpoint case (line ~42-45) puts the key under `apiKeySlot: "MY_KEY"`. The label is now derived. For a custom endpoint whose model id has a provider prefix, the derived label is `suggestedKeySlotName(modelId)`. Update that test to set the env under the derived name. Replace the test:

```ts
it("injects apiKey from env under the derived label", () => {
  const c = buildServerConfig(cfg, {
    model: "minimax/MiniMax-M3",
    modelConfig: { baseUrl: "http://gw/v1", npm: "@ai-sdk/openai-compatible", requiresApiKey: true },
    env: { MINIMAX_API_KEY: "sk-9" },
  });
  const block = (c.provider as any).minimax.options;
  expect(block.apiKey).toBe("sk-9");
  expect(block.baseURL).toBe("http://gw/v1");
});
```

Also update the "omits the provider block for a cloud model" test (line ~34-37) to use `requiresApiKey: true` instead of `apiKeySlot`:

```ts
it("omits the provider block for a cloud model (no baseUrl)", () => {
  const c = buildServerConfig(cfg, {
    model: "anthropic/claude-sonnet-4-6",
    modelConfig: { requiresApiKey: true },
  });
  expect(c.provider).toBeUndefined();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test --workspace @journeyman/agent-runtime -- opencode/server-config`
Expected: FAIL — current code reads `modelConfig.apiKeySlot` (absent), so `apiKey` is undefined.

- [ ] **Step 3: Update the implementation**

In `packages/agent-runtime/src/providers/opencode/server-config.ts`, add the import:

```ts
import { codingModelKeySlot } from "@journeyman/core";
```

In `buildProviderBlock`, replace line ~59:

```ts
const slot = codingModelKeySlot({ provider: "opencode", config: modelConfig, modelId: model });
const apiKey = modelConfig.requiresApiKey ? env?.[slot] : undefined;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --workspace @journeyman/agent-runtime -- opencode/server-config`
Expected: PASS.

---

## Task 11: Remove the "Env var name" field from the UI

**Files:**
- Modify: `packages/web/src/routes/AdminCodingModelsPage.tsx:165-181,307-335`

- [ ] **Step 1: Update the form state helpers**

Replace `setConfig` to drop `apiKeySlot` from its key union (line ~165):

```ts
const setConfig = (k: "baseUrl" | "npm", val: string) =>
  setV((prev) => ({ ...prev, config: { ...(prev.config ?? {}), [k]: val || undefined } }));
```

Replace `requiresKey` and `setRequiresKey` (lines ~169-181):

```ts
const requiresKey = Boolean(v.config?.requiresApiKey);
const setRequiresKey = (b: boolean) =>
  setV((prev) => ({
    ...prev,
    apiKeySecretId: b ? prev.apiKeySecretId : undefined,
    config: { ...(prev.config ?? {}), requiresApiKey: b || undefined },
  }));
```

- [ ] **Step 2: Remove the field and its import**

Delete the entire "Env var name" `<Field>` block (lines ~317-326):

```tsx
{(v.provider === "opencode" || v.provider === "aisdk") && (
  <Field label="Env var name">
    <input
      className={`${inputCls} font-mono text-sm`}
      value={v.config?.apiKeySlot ?? ""}
      onChange={(e) => setConfig("apiKeySlot", e.target.value)}
      placeholder="ANTHROPIC_API_KEY"
    />
  </Field>
)}
```

Remove `suggestedKeySlotName` from the import on line 5 (keep `providersForKind`, `AISDK_PROVIDER_PACKAGES`):

```ts
import { providersForKind, AISDK_PROVIDER_PACKAGES } from "@journeyman/core";
```

The auth section now contains only the "Requires an API key" toggle and the `SecretBindingField`.

- [ ] **Step 3: Typecheck the package**

Run: `npm run typecheck --workspace @journeyman/web`
Expected: PASS — no remaining references to `apiKeySlot` or `suggestedKeySlotName`.

---

## Task 12: Migration — backfill `requiresApiKey`

**Files:**
- Create: `packages/migrations/src/sql/063_coding_model_requires_api_key.sql`

- [ ] **Step 1: Write the migration**

Create `packages/migrations/src/sql/063_coding_model_requires_api_key.sql`:

```sql
-- 063_coding_model_requires_api_key.sql
-- The typed config.apiKeySlot label is replaced by an explicit boolean
-- config.requiresApiKey. The env-var label is now derived at run time, so the
-- stored apiKeySlot is dropped. Any model that previously declared a key slot is
-- marked as requiring a key.

UPDATE jm_coding_models
   SET config = (coalesce(config, '{}'::jsonb) - 'apiKeySlot')
                || '{"requiresApiKey": true}'::jsonb
 WHERE coalesce(config->>'apiKeySlot', '') <> '';
```

- [ ] **Step 2: Run the migration against the dev DB**

Run: `npm run migrate`
Expected: applies `063_...` with no error.

- [ ] **Step 3: Verify the backfill (manual check)**

Run:
```bash
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d journeyman \
  -c "SELECT model_id, config->>'requiresApiKey' AS requires, config ? 'apiKeySlot' AS has_slot FROM jm_coding_models;"
```
Expected: rows that had a slot now show `requires = true` and `has_slot = f`.

> Note: the MiniMax-M3 row still has no `api_key_secret_id`. Binding an org secret to it is a separate data fix (out of scope) — the user does that in the UI after this lands.

---

## Task 13: Full typecheck + boundary check (final gate)

**Files:** none (verification only).

- [ ] **Step 1: Run the full typecheck and import-boundary check**

Run: `npm run check`
Expected: PASS — `npm run typecheck` and `npm run check:boundaries` both succeed with no errors.

- [ ] **Step 2: Run the touched packages' tests**

Run:
```bash
npm test --workspace @journeyman/core
npm test --workspace @journeyman/coding-models
npm test --workspace @journeyman/agent-runtime
```
Expected: PASS (no regressions in the affected suites).

- [ ] **Step 3: Confirm no stray `apiKeySlot` reads remain**

Run: `grep -rn "apiKeySlot" packages/ --include="*.ts" --include="*.tsx" | grep -v "\.test\." | grep -v "coding-models.types.ts"`
Expected: no results (the only remaining mention is the deprecated field doc in the core type).

---

## Self-Review

**Spec coverage:**
- Shared deriver in core → Task 2. ✓
- `requiresApiKey` replaces flag → Tasks 1, 4, 5, 11. ✓
- UI field removed → Task 11. ✓
- Validation/route → Tasks 4, 5. ✓
- Slot helpers → Task 3. ✓
- Worker single derived path → Tasks 6, 7 (+ Task 8 keeps custom-ai's slot declaration consistent). ✓
- Runner derives label → Tasks 9, 10. ✓
- Migration backfill → Task 12. ✓
- Testing section of spec → covered per-task + Task 13. ✓
- Out of scope (MiniMax data fix, validateBinding-bypass root cause) → noted, not implemented. ✓

**Placeholder scan:** none — every code step shows full code.

**Type consistency:** `codingModelKeySlot({ provider, config, modelId })` signature is identical across Tasks 2, 3, 6, 7, 9, 10. `openCodeModelSlots(config, modelId)` two-arg signature is consistent across Tasks 3 and 8. `config.requiresApiKey` used consistently. `findCodingModel(pool, orgId, provider, modelId)` matches existing signature.

**User-constraint compliance:** No `git commit`/`git add` steps anywhere; work stays on `master`; final task is the typecheck gate.
