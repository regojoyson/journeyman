# OpenCode Model-Owned Secret Slot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an OpenCode coding model own its required secret — one model-derived key slot, shown in the editor, enforced at publish, and resolved at runtime — replacing the five static catalog dropdowns.

**Architecture:** A pure core helper (`openCodeModelSlots`) is the single source of truth for "what key does this OpenCode model need," used by the editor secrets panel, the publish validator (`flows.ts`), and the worker. The OpenCode catalog entry's static slots are removed; the key comes from the model's stored `config.apiKeySlot`. The admin form gains an Authentication subsection (toggle + prefilled key name); switching a step's model auto-cleans the stale key binding; `buildProviderBlock` is tightened to fire only for custom endpoints (`baseUrl`).

**Tech Stack:** TypeScript (ESM, explicit `.ts` imports), Vitest, React + hooks, Fastify, PostgreSQL (`pg`), `@opencode-ai/sdk`.

> **Execution preference (this run):** Do NOT commit or typecheck per step. Implement all tasks, then run a single `npm run check` + targeted test suites and make one commit in the final task.

---

## Reference facts (verified — do not re-derive)

- `SecretSlotDef` (core, `packages/core/src/types/secret-slot.types.ts`): `{ name: string; description: string; optional?: boolean }`. The flow-editor's local `SecretSlotDef` (`packages/flow-editor/src/step-definition.ts`) is structurally identical, so a core-typed slot is assignable to it.
- `CodingModelConfig` (core, `coding-models.types.ts`): `{ baseUrl?, npm?, apiKeySlot? }`. `CodingModel.config?` exists; the `/api/coding-models?provider=` response includes it (enabled models only).
- `WorkflowNode.model?: string | null` (core flow types). `flow.defaults?.defaultModel` is the workflow default. Effective model = `node.model ?? flow.defaults?.defaultModel`.
- Editor: `RequiredSecretsTab` (`packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx`) gets `{ flow, node, ... }`, computes `effectiveProvider`, and builds the custom-AI slot union as `base = [...providerSlots, ...stepDef.slots]` then merges `customSlots`. `ConfigTab` (`.../ConfigTab.tsx`) renders `CodingModelSelect` and sets the model via `onChange({ ...node, model: modelId ?? null })`. `CodingModelSelect` fetches `/api/coding-models?provider=` itself.
- Publish validation: `packages/api-server/src/routes/flows.ts` builds `declaredSlotNames` for a custom-AI node from DB custom-step slots + `PROVIDER_CATALOG` slots, flags bindings outside that set as orphans, and flags required (non-optional) declared slots with no binding + not visible as inaccessible. It is an `async` handler with `c.pool`.
- Worker: `custom-ai-step-handler.ts` builds `slotsByName` from provider catalog ∪ DB slots ∪ (currently) `modelConfig.apiKeySlot` as **optional**. `input.modelConfig` is threaded by the harness.
- `buildProviderBlock` (`packages/agent-runtime/src/providers/opencode/server-config.ts`) currently emits a block when `baseUrl || npm || apiKeySlot`. `parseOpenCodeModel` (agent-runtime) splits the model id on the first `/`.
- `findCodingModel(pool, provider, modelId)` exists in `@journeyman/coding-models` (ignores the enabled flag).
- No test files exist for `custom-ai-step-handler` or `flows.ts` route validation; `provider-catalog.test.ts`, `server-config.test.ts`, and the coding-models unit tests do exist.

## File structure

**New**
- `packages/core/src/registries/opencode-slots.ts` — `openCodeModelSlots`, `suggestedKeySlotName`.
- `packages/core/src/registries/opencode-slots.test.ts`
- `packages/flow-editor/src/catalogs/use-coding-models.ts` — `useCodingModels(provider)` hook.

**Modified**
- `packages/core/src/index.ts` — export the new helper.
- `packages/core/src/registries/provider-catalog.ts` — empty opencode slots.
- `packages/core/src/registries/provider-catalog.test.ts` — update assertions.
- `packages/agent-runtime/src/providers/opencode/server-config.ts` — gate on `baseUrl`.
- `packages/agent-runtime/src/providers/opencode/server-config.test.ts` — cloud-no-block case.
- `packages/orchestrator/src/workers/steps/custom-ai-step-handler.ts` — use helper (required).
- `packages/api-server/src/routes/flows.ts` — derive + include model slot in validation.
- `packages/flow-editor/src/components/CodingModelSelect.tsx` — use the shared hook.
- `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx` — inject model slot.
- `packages/flow-editor/src/properties-panel/ConfigTab.tsx` — auto-clean on model change.
- `packages/web/src/routes/AdminCodingModelsPage.tsx` — Authentication subsection + prefill.

---

## Task 1: Core shared helper — `openCodeModelSlots` + `suggestedKeySlotName`

**Files:**
- Create: `packages/core/src/registries/opencode-slots.ts`
- Create: `packages/core/src/registries/opencode-slots.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/registries/opencode-slots.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { openCodeModelSlots, suggestedKeySlotName } from "./opencode-slots.ts";

describe("openCodeModelSlots", () => {
  it("returns one required slot when apiKeySlot is set", () => {
    expect(openCodeModelSlots({ apiKeySlot: "ANTHROPIC_API_KEY" })).toEqual([
      { name: "ANTHROPIC_API_KEY", description: "API key for this model.", optional: false },
    ]);
  });
  it("returns [] when apiKeySlot is absent", () => {
    expect(openCodeModelSlots(undefined)).toEqual([]);
    expect(openCodeModelSlots({})).toEqual([]);
    expect(openCodeModelSlots({ baseUrl: "http://x/v1" })).toEqual([]);
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

- [ ] **Step 2: Implement the helper**

Create `packages/core/src/registries/opencode-slots.ts`:

```typescript
import type { SecretSlotDef } from "../types/secret-slot.types.ts";
import type { CodingModelConfig } from "../types/coding-models.types.ts";

/**
 * The required key slot(s) an OpenCode model needs, derived from its declared
 * config. Single source of truth for the editor, publish validation, and worker.
 * Empty when the model declares no key (e.g. a keyless local endpoint).
 */
export function openCodeModelSlots(config: CodingModelConfig | undefined): SecretSlotDef[] {
  if (config?.apiKeySlot) {
    return [{ name: config.apiKeySlot, description: "API key for this model.", optional: false }];
  }
  return [];
}

/**
 * Smart default secret key name for the admin form, derived from an OpenCode
 * model id "providerID/modelID": `${PROVIDERID}_API_KEY`, with google→GEMINI.
 * Returns "" when there is no provider prefix.
 */
export function suggestedKeySlotName(modelId: string | undefined): string {
  const providerID = modelId && modelId.includes("/") ? modelId.slice(0, modelId.indexOf("/")) : "";
  if (!providerID) return "";
  const overrides: Record<string, string> = { google: "GEMINI_API_KEY" };
  return overrides[providerID] ?? `${providerID.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
}
```

- [ ] **Step 3: Export from the core barrel**

In `packages/core/src/index.ts`, add (near the other `registries` / `provider-catalog` exports):

```typescript
export * from "./registries/opencode-slots.ts";
```

Verify the file has a provider-catalog export already: `grep -n "provider-catalog" packages/core/src/index.ts` — place the new line beside it.

---

## Task 2: Empty the OpenCode catalog slots

**Files:**
- Modify: `packages/core/src/registries/provider-catalog.ts`
- Modify: `packages/core/src/registries/provider-catalog.test.ts`

- [ ] **Step 1: Update the failing test first**

In `packages/core/src/registries/provider-catalog.test.ts`, replace the existing opencode assertion and the recently-added cloud-slots block. Replace this:

```typescript
  it("includes an opencode coding-cli entry with its key slot", () => {
    const oc = PROVIDER_CATALOG.find(p => p.kind === "coding-cli" && p.value === "opencode");
    expect(oc).toBeDefined();
    expect(oc?.slots?.some(s => s.name === "OPENCODE_API_KEY")).toBe(true);
  });
```
with:
```typescript
  it("includes an opencode coding-cli entry with no static slots (key is model-derived)", () => {
    const oc = PROVIDER_CATALOG.find(p => p.kind === "coding-cli" && p.value === "opencode");
    expect(oc).toBeDefined();
    expect(oc?.slots ?? []).toEqual([]);
  });
```

And delete the entire `describe("opencode provider slots", () => { ... })` block (the one asserting `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`/… and "keeps all opencode slots optional"). Remove the now-unused `providersForKind` import if nothing else uses it (keep it if other tests in the file reference it).

- [ ] **Step 2: Empty the slots in the catalog**

In `packages/core/src/registries/provider-catalog.ts`, replace the opencode entry:

```typescript
  { kind: "coding-cli", value: "opencode", label: "OpenCode", implemented: true, slots: [
    { name: "OPENCODE_API_KEY",   description: "OpenCode API key.", optional: true },
    { name: "ANTHROPIC_API_KEY",  description: "Anthropic key (for anthropic/* models).", optional: true },
    { name: "OPENAI_API_KEY",     description: "OpenAI key (for openai/* models).", optional: true },
    { name: "GEMINI_API_KEY",     description: "Google Gemini key (for google/* models).", optional: true },
    { name: "OPENROUTER_API_KEY", description: "OpenRouter key (for openrouter/* models).", optional: true },
  ]},
```
with:
```typescript
  // OpenCode has no framework-level key slot — each coding model declares its own
  // required secret (config.apiKeySlot), surfaced via openCodeModelSlots().
  { kind: "coding-cli", value: "opencode", label: "OpenCode", implemented: true, slots: [] },
```

---

## Task 3: Gate `buildProviderBlock` on `baseUrl`

**Files:**
- Modify: `packages/agent-runtime/src/providers/opencode/server-config.ts`
- Modify: `packages/agent-runtime/src/providers/opencode/server-config.test.ts`

- [ ] **Step 1: Add the failing test (cloud model, only apiKeySlot → no block)**

In `packages/agent-runtime/src/providers/opencode/server-config.test.ts`, inside `describe("buildServerConfig", …)`, add:

```typescript
  it("omits the provider block for a cloud model that has only an apiKeySlot (no baseUrl)", () => {
    const c = buildServerConfig(cfg, {
      model: "anthropic/claude-sonnet-4-6",
      modelConfig: { apiKeySlot: "ANTHROPIC_API_KEY" },
      env: { ANTHROPIC_API_KEY: "sk-x" },
    });
    expect(c.provider).toBeUndefined();
  });
```

- [ ] **Step 2: Tighten the gate**

In `packages/agent-runtime/src/providers/opencode/server-config.ts`, in `buildProviderBlock`, replace:

```typescript
  if (!modelConfig) return undefined;
  const hasCustom = modelConfig.baseUrl || modelConfig.npm || modelConfig.apiKeySlot;
  if (!hasCustom) return undefined;
  const parsed = model ? parseOpenCodeModel(model) : undefined;
  if (!parsed) return undefined;
```
with:
```typescript
  if (!modelConfig?.baseUrl) return undefined; // a custom endpoint is defined by its URL
  const parsed = model ? parseOpenCodeModel(model) : undefined;
  if (!parsed) return undefined;
```

(The remaining body — building `options` with `baseURL` + `apiKey` from `env[apiKeySlot]` — is unchanged. The existing "emits a provider block …" and "injects apiKey …" tests both set `baseUrl`, so they still pass.)

---

## Task 4: Worker uses the helper (required slot)

**Files:**
- Modify: `packages/orchestrator/src/workers/steps/custom-ai-step-handler.ts`

- [ ] **Step 1: Import the helper**

Add to the `@journeyman/core` import group near the top of the file (it already imports `defaultProviderForKind, PROVIDER_CATALOG` from `@journeyman/core` on a value-import line):

```typescript
import { defaultProviderForKind, PROVIDER_CATALOG, openCodeModelSlots } from "@journeyman/core";
```
(Replace the existing `import { defaultProviderForKind, PROVIDER_CATALOG } from "@journeyman/core";` line.)

- [ ] **Step 2: Replace the optional-apiKeySlot block with the required helper**

Replace:
```typescript
    const modelConfig = (input.modelConfig as CodingModelConfig | undefined) ?? undefined;
    if (modelConfig?.apiKeySlot) {
      slotsByName.set(modelConfig.apiKeySlot, { name: modelConfig.apiKeySlot, optional: true });
    }
    const effectiveSlots = Array.from(slotsByName.values());
```
with:
```typescript
    const modelConfig = (input.modelConfig as CodingModelConfig | undefined) ?? undefined;
    // OpenCode models declare their own required key slot; non-opencode → []ered.
    for (const s of openCodeModelSlots(modelConfig)) {
      slotsByName.set(s.name, { name: s.name, optional: s.optional });
    }
    const effectiveSlots = Array.from(slotsByName.values());
```

(`CodingModelConfig` is already imported in this file from the earlier feature.)

---

## Task 5: Publish validation derives the model slot — `flows.ts`

**Files:**
- Modify: `packages/api-server/src/routes/flows.ts`

- [ ] **Step 1: Add imports**

At the top of `packages/api-server/src/routes/flows.ts`, add:
```typescript
import { openCodeModelSlots } from "@journeyman/core";
import { findCodingModel } from "@journeyman/coding-models";
```

- [ ] **Step 2: Derive and include the model slot in the declared set + required check**

In the custom-AI branch (the `if (node.stepType === "custom-ai") { … }` block), after `providerSlots` is computed and before `declaredSlotNames` is built, add:

```typescript
      // OpenCode models carry their required key on the model config (not the
      // catalog). Resolve the effective model and include its slot so the mapped
      // key isn't flagged as an orphan and the required key is enforced.
      let modelSlots: { name: string; description: string; optional?: boolean }[] = [];
      if (providerValue === "opencode") {
        const effModel =
          (node.model as string | null | undefined) ?? definition.defaults?.defaultModel ?? undefined;
        if (effModel) {
          const cm = await findCodingModel(c.pool, "opencode", effModel);
          modelSlots = openCodeModelSlots(cm?.config);
        }
      }
```

Then change the `declaredSlotNames` construction:
```typescript
      declaredSlotNames = new Set([
        ...dbSlots.map(s => s.name),
        ...providerSlots.map(s => s.name),
      ]);
```
to:
```typescript
      declaredSlotNames = new Set([
        ...dbSlots.map(s => s.name),
        ...providerSlots.map(s => s.name),
        ...modelSlots.map(s => s.name),
      ]);
```

And the required-accessibility loop:
```typescript
      for (const slot of [...dbSlots, ...providerSlots]) {
```
to:
```typescript
      for (const slot of [...dbSlots, ...providerSlots, ...modelSlots]) {
```

(`c.pool` is the route's pool — confirm the handler's request/context variable name in this file and use it; the route already `await`s `getCustomAiStep(c.pool, …)` earlier, so reuse that same identifier.)

---

## Task 6: Shared `useCodingModels` hook + dedupe CodingModelSelect

**Files:**
- Create: `packages/flow-editor/src/catalogs/use-coding-models.ts`
- Modify: `packages/flow-editor/src/components/CodingModelSelect.tsx`

- [ ] **Step 1: Create the hook**

Create `packages/flow-editor/src/catalogs/use-coding-models.ts`:

```typescript
import { useEffect, useState } from "react";
import type { CodingModel } from "@journeyman/core";

/** Fetch enabled coding models for a provider (with their config). Empty until loaded. */
export function useCodingModels(provider: string | undefined): CodingModel[] {
  const [models, setModels] = useState<CodingModel[]>([]);
  useEffect(() => {
    if (!provider) { setModels([]); return; }
    let alive = true;
    fetch(`/api/coding-models?provider=${encodeURIComponent(provider)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: CodingModel[]) => { if (alive) setModels(rows); })
      .catch(() => { if (alive) setModels([]); });
    return () => { alive = false; };
  }, [provider]);
  return models;
}
```

- [ ] **Step 2: Use the hook in CodingModelSelect (single fetch path)**

Replace the body of `packages/flow-editor/src/components/CodingModelSelect.tsx` from the `useState`/`useEffect` block with the hook. Change:
```typescript
import { useEffect, useState } from "react";
import type { CodingModel } from "@journeyman/core";
```
to:
```typescript
import type { CodingModel } from "@journeyman/core";
import { useCodingModels } from "../catalogs/use-coding-models.ts";
```
and replace:
```typescript
  const [models, setModels] = useState<CodingModel[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!provider) { setModels([]); return; }
    let alive = true;
    setLoading(true);
    fetch(`/api/coding-models?provider=${encodeURIComponent(provider)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: CodingModel[]) => { if (alive) setModels(rows); })
      .catch(() => { if (alive) setModels([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [provider]);
```
with:
```typescript
  const models = useCodingModels(provider);
  const loading = false;
```

(`describeModel` and the `<select>` JSX stay unchanged.)

---

## Task 7: RequiredSecretsTab injects the model-derived slot

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx`

- [ ] **Step 1: Imports**

Add:
```typescript
import { openCodeModelSlots } from "@journeyman/core";
import { useCodingModels } from "../catalogs/use-coding-models.ts";
```

- [ ] **Step 2: Derive the OpenCode model slot**

After the `providerSlots` line (`const providerSlots = PROVIDER_CATALOG.find(p => p.value === effectiveProvider)?.slots ?? [];`), add:

```typescript
  // OpenCode models declare their key on the model config (catalog slots are empty).
  // Resolve the effective model (node model or flow default) and derive its one slot.
  const codingModels = useCodingModels(effectiveProvider === "opencode" ? effectiveProvider : undefined);
  const effectiveModelId = node.model ?? flow.defaults?.defaultModel ?? undefined;
  const openCodeSlots: SecretSlotDef[] =
    effectiveProvider === "opencode"
      ? openCodeModelSlots(codingModels.find(m => m.modelId === effectiveModelId)?.config)
      : [];
```

- [ ] **Step 3: Inject into the custom-AI union**

In the `slots` IIFE, change the custom-ai base:
```typescript
    if (node.stepType === "custom-ai") {
      const base = [...providerSlots, ...(stepDef?.slots ?? [])];
```
to:
```typescript
    if (node.stepType === "custom-ai") {
      const base = [...providerSlots, ...openCodeSlots, ...(stepDef?.slots ?? [])];
```

(Built-in OpenCode steps keep the existing else-branch behavior — no key row — which is the documented deferral.)

---

## Task 8: ConfigTab auto-cleans the stale key on model change

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/ConfigTab.tsx`

- [ ] **Step 1: Import the hook**

Add near the other imports:
```typescript
import { useCodingModels } from "../catalogs/use-coding-models.ts";
```

- [ ] **Step 2: Resolve coding models at component top (hooks can't be in the IIFE)**

In the `ConfigTab` component body, near where `executorConfig`/`flowDefaults` are already available, add:

```typescript
  const codingProvider =
    executorConfig?.provider ?? flowDefaults?.executorConfig?.["coding-cli"]?.provider;
  const codingModels = useCodingModels(codingProvider);
```

(If `executorConfig`/`flowDefaults` are computed lower down, place these two lines immediately after them, still at the top level of the component — not inside the `supportsModelSelection` IIFE.)

- [ ] **Step 3: Prune the stale binding in the model onChange**

In the `CodingModelSelect` usage, replace:
```typescript
              onChange={(modelId) => onChange({ ...node, model: modelId ?? null })}
```
with:
```typescript
              onChange={(modelId) => {
                const next: WorkflowNode = { ...node, model: modelId ?? null };
                // Auto-clean: drop the previous model's key binding when it is no
                // longer the new model's declared key (OpenCode model-owned key only).
                if (codingProvider === "opencode" && node.secretBindings) {
                  const oldKey = codingModels.find(m => m.modelId === node.model)?.config?.apiKeySlot;
                  const newKey = modelId
                    ? codingModels.find(m => m.modelId === modelId)?.config?.apiKeySlot
                    : undefined;
                  if (oldKey && oldKey !== newKey && node.secretBindings[oldKey]) {
                    const { [oldKey]: _drop, ...rest } = node.secretBindings;
                    next.secretBindings = rest;
                  }
                }
                onChange(next);
              }}
```

(`WorkflowNode` is already imported in ConfigTab.)

---

## Task 9: Admin form — Authentication subsection + prefill

**Files:**
- Modify: `packages/web/src/routes/AdminCodingModelsPage.tsx`

- [ ] **Step 1: Import the prefill helper**

Add `suggestedKeySlotName` to the existing `@journeyman/core` import:
```typescript
import { providersForKind, suggestedKeySlotName } from "@journeyman/core";
```
(The file already imports `providersForKind`; extend that line.)

- [ ] **Step 2: Add Authentication helpers in ModelForm**

In `ModelForm`, after the existing `setConfig` helper, add:
```typescript
  const requiresKey = Boolean(v.config?.apiKeySlot);
  const setRequiresKey = (b: boolean) =>
    setV((prev) => ({
      ...prev,
      config: {
        ...(prev.config ?? {}),
        apiKeySlot: b ? (prev.config?.apiKeySlot || suggestedKeySlotName(prev.modelId) || "API_KEY") : undefined,
      },
    }));
```

- [ ] **Step 3: Render the Authentication section and trim the Custom endpoint section**

Replace the entire `{v.provider === "opencode" && ( … Custom endpoint … )}` section with two sections:

```tsx
        {v.provider === "opencode" && (
          <section className="space-y-3">
            <h3 className="text-sm font-medium text-slate-200">Authentication</h3>
            <Toggle
              label="Requires an API key"
              hint="The workflow will require a secret mapped to this key for every step using this model."
              checked={requiresKey}
              onChange={setRequiresKey}
            />
            {requiresKey && (
              <Field label="Secret key name">
                <input
                  className={`${inputCls} font-mono text-sm`}
                  value={v.config?.apiKeySlot ?? ""}
                  onChange={(e) => setConfig("apiKeySlot", e.target.value)}
                  placeholder="ANTHROPIC_API_KEY"
                />
              </Field>
            )}
          </section>
        )}

        {v.provider === "opencode" && (
          <section className="space-y-3">
            <h3 className="text-sm font-medium text-slate-200">Custom endpoint (optional)</h3>
            <p className="text-xs text-slate-400">
              Leave blank for cloud models — they use built-in defaults. Fill in for
              local/self-hosted endpoints. Inside Docker, <code>localhost</code> is the container —
              use <code>host.docker.internal</code> or a reachable service address.
            </p>
            <Field label="Base URL">
              <input
                className={`${inputCls} font-mono text-sm`}
                value={v.config?.baseUrl ?? ""}
                onChange={(e) => setConfig("baseUrl", e.target.value)}
                placeholder="http://host.docker.internal:1234/v1"
              />
            </Field>
            <Field label="npm package">
              <input
                className={`${inputCls} font-mono text-sm`}
                value={v.config?.npm ?? ""}
                onChange={(e) => setConfig("npm", e.target.value)}
                placeholder="@ai-sdk/openai-compatible"
              />
            </Field>
          </section>
        )}
```

(This removes the old "API key slot" field from the Custom endpoint grid — it now lives in Authentication. `Toggle`, `Field`, `inputCls`, `setConfig` already exist in the file.)

---

## Task 10: Single verification + commit (per execution preference)

**Files:** none (verification only).

- [ ] **Step 1: Typecheck + boundaries**

Run: `npm run check`
Expected: clean across all workspaces; "✓ Layer boundaries clean across all packages."

- [ ] **Step 2: Run the affected unit suites**

Run:
```bash
npx vitest run packages/core packages/coding-models packages/agent-runtime
```
Expected: PASS — including the new `opencode-slots` test, the updated `provider-catalog` test, and the updated `server-config` test.

- [ ] **Step 3: Single commit**

```bash
git add packages/core packages/agent-runtime packages/orchestrator packages/api-server packages/flow-editor packages/web docs/superpowers
git commit -m "feat(opencode): model-owned required secret slot (one model-derived key in editor/publish/worker)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(Note: the working tree also contains the prior OpenCode custom-model-config changes and unrelated kit/registry-auth work. Scope the `git add` to the paths above so unrelated changes aren't swept in; adjust if the reviewer wants the prior OpenCode work committed together.)

---

## Self-review notes (spec coverage)

- Shared helper (single source) → Task 1; used by worker (4), flows.ts (5), editor (7). Empty catalog slots → Task 2. `buildProviderBlock` baseUrl gate → Task 3. Effective-model rule (`node.model ?? flow default`) applied in editor (7) and flows.ts (5); worker already resolves it via the harness. Editor displays the model-derived required slot (7); publish enforces it + avoids orphan (5); admin Authentication subsection + prefill (9); auto-clean on model change (8). Test updates (2, 3) + new helper test (1).
- **Type consistency:** `openCodeModelSlots(config: CodingModelConfig | undefined): SecretSlotDef[]` and `suggestedKeySlotName(modelId): string` used identically in all consumers; core `SecretSlotDef` is structurally assignable to the editor's local `SecretSlotDef`. `findCodingModel(pool, "opencode", modelId)` matches its definition.
- **Deferred (documented in spec):** built-in OpenCode steps show no key row in the editor; pinned-but-disabled model not shown in the editor list (runtime still resolves via `findCodingModel`).
- **Test-harness note:** `flows.ts` and `custom-ai-step-handler` have no existing unit harness; their changes are covered by `npm run check` (typecheck) plus the pure-helper/catalog/server-config unit tests. The publish-validation behavior is verified manually (map a key on an OpenCode-model custom-AI node → publishes without orphan; unmapped → flagged required).
```
