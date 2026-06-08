# OpenCode Custom Model Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an `opencode` coding model carry optional custom endpoint config (`baseUrl`, `npm`, `apiKeySlot`) so any model works — including local/self-hosted (Ollama, LM Studio, vLLM) and gateway-overridden endpoints — by threading that config per-operation into the OpenCode provider's `Config.provider` block.

**Architecture:** Store config in a new `config` JSONB column on `jm_coding_models`. The worker resolves a step's model config (DB-backed resolver, injected into the harness, mirroring the existing model/skills/mcp resolvers) and attaches it to the step input as `modelConfig`. The custom-AI handler adds the configured API-key slot to its secret slots and forwards `modelConfig` into the operation options, which already flow through the runner to the OpenCode provider. `buildServerConfig` turns `modelConfig` + the model string's providerID + the resolved env into an OpenCode `provider` block. No config ⇒ no block ⇒ OpenCode's built-in catalog (cloud providers unchanged).

**Tech Stack:** TypeScript (ESM, explicit `.ts` import extensions), Vitest, PostgreSQL (`pg`, append-only SQL migrations), Fastify, React + TanStack Query, `@opencode-ai/sdk`.

---

## Reference facts (verified — do not re-derive)

- Migrations are append-only in `packages/migrations/src/sql/`; latest is `040_*`, so the new one is **`041`**. Header style: two `--` comment lines then SQL (see `013_coding_models.sql`).
- `jm_coding_models` columns today: `id, provider, model_id, label, description, sort_order, enabled, deprecated, is_default, supports_thinking, context_window, created_at, updated_at`. Unique `(provider, model_id)`.
- `CodingModel` / `CodingModelCreateInput` / `CodingModelUpdateInput`: `packages/core/src/types/coding-models.types.ts`.
- DB CRUD: `packages/coding-models/src/db.ts` (`insertCodingModel`, `updateCodingModel`, `getCodingModel`, `listAllCodingModels`, `listEnabledCodingModelsByProvider`, `findDefaultCodingModel`, `rowToModel`). `findDefaultCodingModel` is re-exported and already imported in `cli-worker.ts`.
- Admin routes: `packages/coding-models/src/routes/admin.ts` (POST/PATCH read `req.body as any`, validate provider via `isValidCodingProvider`).
- Option types carry `model?: string` today: `RunCustomPromptOptions` (`packages/core/src/types/coding.types.ts`), `ScanReposOptions`/`CheckoutRepoOptions` (`packages/core/src/types/git.types.ts`).
- The OpenCode provider already exists (parity work merged to master): `packages/agent-runtime/src/providers/opencode/` with `buildServerConfig(config, mcps)` in `server-config.ts`, `parseOpenCodeModel`/`resolveOpenCodeModel` in `model.ts`, `#withServer(mcps, env, fn)` in `index.ts`, `startServer` in `client.ts`. `runCustomPrompt` calls `this.#withServer(opts.mcps, opts.env, ...)`.
- Runner forwarding is provider-agnostic: `SandboxInstanceCodingProvider.payload()` (`packages/orchestrator/src/sandbox/sandbox-instance-coding-provider.ts`) spreads all opts except `onLog`/`signal`; the docker backend spreads `op.stdin` into `RunnerRequest.opts`; `dispatch.ts` spreads opts into `provider.runCustomPrompt(opts)`. **So a new `modelConfig` field on the options flows end-to-end with no transport change.**
- Worker harness pre-resolves mcps/skills/model and mutates `stepInput` (`packages/orchestrator/src/workers/worker-harness.ts`, ~lines 205–279). Deps `mcpResolver`/`skillsResolver`/`modelResolver` are injected; `cli-worker.ts` wires them with the DB pool.
- Custom-AI handler builds `effectiveSlots` (provider slots ∪ step slots) then calls `bindingResolver`, and constructs the `runCustomPrompt` options (`packages/orchestrator/src/workers/steps/custom-ai-step-handler.ts`, ~lines 131–207). There is **no** handler test file; `worker-harness.test.ts` exists.
- Provider catalog: `packages/core/src/registries/provider-catalog.ts`; opencode entry advertises only `OPENCODE_API_KEY`.
- Admin UI form: `packages/web/src/routes/AdminCodingModelsPage.tsx` — `ModelForm` with `v`/`set`, `Field` helper, sections "Identity"/"Capabilities"/"Flags". Provider `<select>` bound to `v.provider`.

**Scope note (honest):** the built-in scan/checkout step handlers (`list-workspace-files`, `start-feature-branch`) do not pass a per-step `model` today, so wiring `modelConfig` into them is moot until they do — **deferred**. This plan delivers the full chain for the **custom-AI step** (the path where models are explicitly chosen) and threads `modelConfig` through the shared types + harness so those handlers can adopt it later with a one-line change.

**Commands:** single test file → `npx vitest run <path>`; workspace typecheck → `npm run typecheck -w <pkg>`; full → `npm run check`.

---

## Task 1: Migration — add `config` JSONB column

**Files:**
- Create: `packages/migrations/src/sql/041_coding_model_config.sql`

- [ ] **Step 1: Write the migration**

Create `packages/migrations/src/sql/041_coding_model_config.sql`:

```sql
-- 041_coding_model_config.sql
-- Provider-specific config bag for coding models (OpenCode custom endpoints:
-- baseUrl / npm / apiKeySlot). Empty object for all existing/cloud models.
ALTER TABLE jm_coding_models ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}';
```

- [ ] **Step 2: Verify the file is picked up by the migrator listing**

Run: `ls packages/migrations/src/sql/ | sort | tail -3`
Expected: `041_coding_model_config.sql` is the last entry.

- [ ] **Step 3: Commit**

```bash
git add packages/migrations/src/sql/041_coding_model_config.sql
git commit -m "feat(migrations): add config jsonb column to jm_coding_models"
```

---

## Task 2: Core types — `CodingModelConfig` + `config` + `modelConfig`

**Files:**
- Modify: `packages/core/src/types/coding-models.types.ts`
- Modify: `packages/core/src/types/coding.types.ts`
- Modify: `packages/core/src/types/git.types.ts`

- [ ] **Step 1: Add `CodingModelConfig` and the `config` field**

Replace the entire contents of `packages/core/src/types/coding-models.types.ts`:

```typescript
/**
 * Provider-specific configuration for a coding model. Only OpenCode uses it today,
 * to point a model at a custom endpoint (local/self-hosted/gateway). Empty for
 * cloud models, which resolve via OpenCode's built-in provider catalog.
 */
export interface CodingModelConfig {
  /** Custom endpoint base URL, e.g. http://host.docker.internal:1234/v1. */
  baseUrl?: string;
  /** AI-SDK npm package for the provider; defaults to "@ai-sdk/openai-compatible". */
  npm?: string;
  /** Name of the secret slot holding the endpoint API key; blank = no key. */
  apiKeySlot?: string;
}

export type CodingModel = {
  id: string;
  provider: string;
  modelId: string;
  label: string;
  description?: string;
  sortOrder: number;
  enabled: boolean;
  deprecated: boolean;
  isDefault: boolean;
  supportsThinking: boolean;
  contextWindow?: number;
  config?: CodingModelConfig;
  createdAt: string;
  updatedAt: string;
};

export type CodingModelCreateInput = {
  provider: string;
  modelId: string;
  label: string;
  description?: string;
  sortOrder?: number;
  enabled?: boolean;
  deprecated?: boolean;
  isDefault?: boolean;
  supportsThinking?: boolean;
  contextWindow?: number;
  config?: CodingModelConfig;
};

export type CodingModelUpdateInput = Partial<CodingModelCreateInput>;
```

- [ ] **Step 2: Add `modelConfig` to the custom-prompt options**

In `packages/core/src/types/coding.types.ts`, add the import at the top (after the existing imports) and the field to `RunCustomPromptOptions` next to `model?`.

Add import:
```typescript
import type { CodingModelConfig } from "./coding-models.types.ts";
```

In `RunCustomPromptOptions`, immediately after the `model?: string;` line, add:
```typescript
  /** Provider-specific endpoint config for the chosen model (OpenCode custom endpoints). */
  modelConfig?: CodingModelConfig;
```

- [ ] **Step 3: Add `modelConfig` to the git option types**

In `packages/core/src/types/git.types.ts`, add the import near the top (with the other `import type` lines):
```typescript
import type { CodingModelConfig } from "./coding-models.types.ts";
```

In `ScanReposOptions`, after `model?: string;` add:
```typescript
  modelConfig?: CodingModelConfig;
```

In `CheckoutRepoOptions`, after its `model?: string;` add:
```typescript
  modelConfig?: CodingModelConfig;
```

- [ ] **Step 4: Confirm `CodingModelConfig` is exported from core's barrel**

Run: `grep -rn "coding-models.types" packages/core/src/index.ts packages/core/src/types/index.ts 2>/dev/null`
Expected: a re-export line exists (the existing `CodingModel` type is already exported from core, so `CodingModelConfig` rides the same barrel). If `coding-models.types` is **not** re-exported anywhere, add `export * from "./types/coding-models.types.ts";` to `packages/core/src/index.ts`.

- [ ] **Step 5: Typecheck core**

Run: `npm run typecheck -w @journeyman/core`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types/coding-models.types.ts packages/core/src/types/coding.types.ts packages/core/src/types/git.types.ts packages/core/src/index.ts
git commit -m "feat(core): CodingModelConfig type + modelConfig on coding option types"
```

---

## Task 3: DB layer — persist `config` + add `findCodingModel`

**Files:**
- Modify: `packages/coding-models/src/db.ts`

- [ ] **Step 1: Map `config` in `rowToModel`**

In `packages/coding-models/src/db.ts`, in `rowToModel`, add a `config` line before `createdAt`:

```typescript
    contextWindow: r.context_window ?? undefined,
    config: r.config && Object.keys(r.config).length ? r.config : undefined,
    createdAt: r.created_at,
```

(Postgres returns JSONB as a parsed object via `pg`, so no `JSON.parse` is needed.)

- [ ] **Step 2: Write `config` in INSERT**

In `insertCodingModel`, change the INSERT to include the `config` column. Replace the columns/VALUES/params with:

```typescript
      ({ rows } = await client.query(
        `INSERT INTO jm_coding_models
           (id, provider, model_id, label, description, sort_order, enabled,
            deprecated, is_default, supports_thinking, context_window, config)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING *`,
        [
          id,
          input.provider,
          input.modelId,
          input.label,
          input.description ?? null,
          input.sortOrder ?? 0,
          input.enabled ?? true,
          input.deprecated ?? false,
          input.isDefault ?? false,
          input.supportsThinking ?? false,
          input.contextWindow ?? null,
          JSON.stringify(input.config ?? {}),
        ],
      ));
```

- [ ] **Step 3: Write `config` in UPDATE**

In `updateCodingModel`, add `config = $12` to the SET clause and the param. Replace the UPDATE query + params with:

```typescript
      ({ rows } = await client.query(
        `UPDATE jm_coding_models SET
           provider = $2,
           model_id = $3,
           label = $4,
           description = $5,
           sort_order = $6,
           enabled = $7,
           deprecated = $8,
           is_default = $9,
           supports_thinking = $10,
           context_window = $11,
           config = $12,
           updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [
          id,
          next.provider,
          next.modelId,
          next.label,
          next.description ?? null,
          next.sortOrder,
          next.enabled,
          next.deprecated,
          next.isDefault,
          next.supportsThinking,
          next.contextWindow ?? null,
          JSON.stringify(next.config ?? {}),
        ],
      ));
```

- [ ] **Step 4: Add `findCodingModel`**

In `packages/coding-models/src/db.ts`, add after `findDefaultCodingModel`:

```typescript
export async function findCodingModel(
  pool: Pool,
  provider: string,
  modelId: string,
): Promise<CodingModel | null> {
  const { rows } = await pool.query(
    `SELECT * FROM jm_coding_models WHERE provider = $1 AND model_id = $2 LIMIT 1`,
    [provider, modelId],
  );
  return rows[0] ? rowToModel(rows[0]) : null;
}
```

- [ ] **Step 5: Export `findCodingModel` from the package barrel**

Run: `grep -n "findDefaultCodingModel" packages/coding-models/src/index.ts`
Then in `packages/coding-models/src/index.ts`, add `findCodingModel` to the same export statement that lists `findDefaultCodingModel` (e.g. `export { …, findDefaultCodingModel, findCodingModel } from "./db.ts";`).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck -w @journeyman/coding-models`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/coding-models/src/db.ts packages/coding-models/src/index.ts
git commit -m "feat(coding-models): persist config column + findCodingModel lookup"
```

---

## Task 4: Config validation + admin routes accept `config`

**Files:**
- Create: `packages/coding-models/src/validate-config.ts`
- Create: `packages/coding-models/src/validate-config.test.ts`
- Modify: `packages/coding-models/src/routes/admin.ts`
- Modify: `packages/coding-models/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/coding-models/src/validate-config.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateCodingModelConfig } from "./validate-config.ts";

describe("validateCodingModelConfig", () => {
  it("returns null for a non-opencode provider regardless of config", () => {
    expect(validateCodingModelConfig("claude", { baseUrl: "not-a-url" } as any)).toBeNull();
  });
  it("returns null when opencode config is absent or empty", () => {
    expect(validateCodingModelConfig("opencode", undefined)).toBeNull();
    expect(validateCodingModelConfig("opencode", {})).toBeNull();
  });
  it("accepts a valid base URL", () => {
    expect(validateCodingModelConfig("opencode", { baseUrl: "http://host.docker.internal:1234/v1" })).toBeNull();
  });
  it("rejects an invalid base URL", () => {
    expect(validateCodingModelConfig("opencode", { baseUrl: "not a url" })).toMatch(/baseUrl/);
  });
  it("rejects a non-string npm", () => {
    expect(validateCodingModelConfig("opencode", { npm: 123 as any })).toMatch(/npm/);
  });
  it("rejects an empty-string apiKeySlot", () => {
    expect(validateCodingModelConfig("opencode", { apiKeySlot: "" })).toMatch(/apiKeySlot/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/coding-models/src/validate-config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the validator**

Create `packages/coding-models/src/validate-config.ts`:

```typescript
import type { CodingModelConfig } from "@journeyman/core";

/**
 * Validate provider-specific coding-model config. Only enforced for "opencode";
 * other providers ignore config. Returns an error message, or null if valid.
 */
export function validateCodingModelConfig(
  provider: string,
  config: CodingModelConfig | undefined,
): string | null {
  if (provider !== "opencode" || !config) return null;

  if (config.baseUrl !== undefined) {
    if (typeof config.baseUrl !== "string" || !config.baseUrl.trim()) {
      return "config.baseUrl must be a non-empty string";
    }
    try {
      new URL(config.baseUrl);
    } catch {
      return `config.baseUrl is not a valid URL: ${config.baseUrl}`;
    }
  }
  if (config.npm !== undefined && (typeof config.npm !== "string" || !config.npm.trim())) {
    return "config.npm must be a non-empty string";
  }
  if (config.apiKeySlot !== undefined && (typeof config.apiKeySlot !== "string" || !config.apiKeySlot.trim())) {
    return "config.apiKeySlot must be a non-empty string";
  }
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/coding-models/src/validate-config.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Export it and use it in the routes**

In `packages/coding-models/src/index.ts`, add: `export { validateCodingModelConfig } from "./validate-config.ts";`

In `packages/coding-models/src/routes/admin.ts`, add to the import from `../validate-provider.ts` a new import line below it:
```typescript
import { validateCodingModelConfig } from "../validate-config.ts";
```

In the **POST** handler, after the `isValidCodingProvider` check and before the `try {`, add:
```typescript
      const cfgErr = validateCodingModelConfig(String(b.provider), b.config);
      if (cfgErr) return reply.code(400).send({ error: cfgErr });
```
And add `config: b.config,` to the `insertCodingModel(pool, { … })` object (after `contextWindow: b.contextWindow,`).

In the **PATCH** handler, after the provider check block and before the `try {`, add:
```typescript
      const patchBody = (req.body ?? {}) as { provider?: unknown; config?: CodingModelConfig };
      const effectiveProvider = typeof patchBody.provider === "string" ? patchBody.provider : existing.provider;
      if (Object.prototype.hasOwnProperty.call(patchBody, "config")) {
        const cfgErr = validateCodingModelConfig(effectiveProvider, patchBody.config);
        if (cfgErr) return reply.code(400).send({ error: cfgErr });
      }
```
Add the type import at the top of `admin.ts`:
```typescript
import type { CodingModelConfig } from "@journeyman/core";
```
(The existing `updateCodingModel(pool, id, req.body as any)` already forwards `config` through `CodingModelUpdateInput`.)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck -w @journeyman/coding-models`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/coding-models/src/validate-config.ts packages/coding-models/src/validate-config.test.ts packages/coding-models/src/routes/admin.ts packages/coding-models/src/index.ts
git commit -m "feat(coding-models): validate + accept opencode model config in admin routes"
```

---

## Task 5: Provider catalog — bindable standard key slots for OpenCode

**Files:**
- Modify: `packages/core/src/registries/provider-catalog.ts`
- Test: `packages/core/src/registries/provider-catalog.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/registries/provider-catalog.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { providersForKind } from "./provider-catalog.ts";

describe("opencode provider slots", () => {
  it("advertises the common cloud-provider key slots so they are bindable", () => {
    const opencode = providersForKind("coding-cli").find((p) => p.value === "opencode")!;
    const names = (opencode.slots ?? []).map((s) => s.name);
    for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"]) {
      expect(names, `missing slot ${k}`).toContain(k);
    }
  });
  it("keeps all opencode slots optional", () => {
    const opencode = providersForKind("coding-cli").find((p) => p.value === "opencode")!;
    expect((opencode.slots ?? []).every((s) => s.optional)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/core/src/registries/provider-catalog.test.ts`
Expected: FAIL — only `OPENCODE_API_KEY` present.

- [ ] **Step 3: Extend the opencode entry**

In `packages/core/src/registries/provider-catalog.ts`, replace the opencode line:

```typescript
  { kind: "coding-cli", value: "opencode", label: "OpenCode", implemented: true, slots: [
    { name: "OPENCODE_API_KEY", description: "OpenCode API key.", optional: true },
  ]},
```

with:

```typescript
  { kind: "coding-cli", value: "opencode", label: "OpenCode", implemented: true, slots: [
    { name: "OPENCODE_API_KEY",   description: "OpenCode API key.", optional: true },
    { name: "ANTHROPIC_API_KEY",  description: "Anthropic key (for anthropic/* models).", optional: true },
    { name: "OPENAI_API_KEY",     description: "OpenAI key (for openai/* models).", optional: true },
    { name: "GEMINI_API_KEY",     description: "Google Gemini key (for google/* models).", optional: true },
    { name: "OPENROUTER_API_KEY", description: "OpenRouter key (for openrouter/* models).", optional: true },
  ]},
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/core/src/registries/provider-catalog.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/registries/provider-catalog.ts packages/core/src/registries/provider-catalog.test.ts
git commit -m "feat(core): bindable standard key slots on the opencode provider entry"
```

---

## Task 6: `buildServerConfig` emits the `provider` block

**Files:**
- Modify: `packages/agent-runtime/src/providers/opencode/server-config.ts`
- Modify: `packages/agent-runtime/src/providers/opencode/server-config.test.ts`

- [ ] **Step 1: Update the test to the new signature + provider block**

Replace the `describe("buildServerConfig", …)` block in `packages/agent-runtime/src/providers/opencode/server-config.test.ts` with:

```typescript
describe("buildServerConfig", () => {
  it("sets bypass-style permissions including skill", () => {
    const c = buildServerConfig(cfg, { mcps: undefined, model: undefined, modelConfig: undefined, env: undefined });
    expect(c.permission).toMatchObject({ bash: "allow", edit: "allow", webfetch: "allow", websearch: "allow", skill: "allow" });
  });
  it("includes mcp only when instances are present", () => {
    expect(buildServerConfig(cfg, {}).mcp).toBeUndefined();
    const mcps: ResolvedMcpInstance[] = [{ id: "1", name: "fs", transport: "stdio", command: "x", args: [], env: {}, systemPrompt: null }];
    expect(buildServerConfig(cfg, { mcps }).mcp).toHaveProperty("fs");
  });
  it("omits the provider block when there is no modelConfig", () => {
    expect(buildServerConfig(cfg, { model: "anthropic/claude-sonnet-4-6" }).provider).toBeUndefined();
  });
  it("emits a provider block keyed by the model's providerID with baseURL + npm default", () => {
    const c = buildServerConfig(cfg, {
      model: "lmstudio/llama-3.1",
      modelConfig: { baseUrl: "http://host.docker.internal:1234/v1" },
    });
    expect(c.provider).toEqual({
      lmstudio: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "http://host.docker.internal:1234/v1" } },
    });
  });
  it("injects apiKey from env when apiKeySlot is set", () => {
    const c = buildServerConfig(cfg, {
      model: "myvllm/mistral",
      modelConfig: { baseUrl: "http://gw/v1", npm: "@ai-sdk/openai-compatible", apiKeySlot: "MY_KEY" },
      env: { MY_KEY: "secret-123" },
    });
    expect((c.provider as any).myvllm.options).toEqual({ baseURL: "http://gw/v1", apiKey: "secret-123" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/agent-runtime/src/providers/opencode/server-config.test.ts`
Expected: FAIL — `buildServerConfig` still takes `(config, mcps)` and emits no `provider`.

- [ ] **Step 3: Implement the new signature + provider block**

In `packages/agent-runtime/src/providers/opencode/server-config.ts`, add the import at the top:

```typescript
import type { CodingModelConfig } from "@journeyman/core";
import { parseOpenCodeModel } from "./model.ts";
```

Replace the entire `buildServerConfig` function with:

```typescript
export interface ServerConfigRuntime {
  mcps?: ResolvedMcpInstance[];
  model?: string;
  modelConfig?: CodingModelConfig;
  env?: Record<string, string>;
}

/**
 * Assemble the OpenCode `Config` passed at managed-server spawn: bypass-style
 * permissions, merged MCP, and — when the chosen model carries custom endpoint
 * config — a `provider` block keyed by the model string's providerID. No
 * modelConfig ⇒ no provider block ⇒ OpenCode uses its built-in catalog.
 */
export function buildServerConfig(
  config: OpenCodeProviderConfig,
  runtime: ServerConfigRuntime,
): Record<string, unknown> {
  const permission = { ...BYPASS_PERMISSION, ...config.permission };
  const mcp = { ...(config.mcp ?? {}), ...(runtime.mcps?.length ? toOpenCodeMcpConfigs(runtime.mcps) : {}) };
  const provider = buildProviderBlock(runtime.model, runtime.modelConfig, runtime.env);
  return {
    permission,
    ...(Object.keys(mcp).length ? { mcp } : {}),
    ...(provider ? { provider } : {}),
  };
}

/** Build OpenCode's `provider` entry for a custom endpoint, or undefined if none. */
function buildProviderBlock(
  model: string | undefined,
  modelConfig: CodingModelConfig | undefined,
  env: Record<string, string> | undefined,
): Record<string, unknown> | undefined {
  if (!modelConfig) return undefined;
  const hasCustom = modelConfig.baseUrl || modelConfig.npm || modelConfig.apiKeySlot;
  if (!hasCustom) return undefined;
  const parsed = model ? parseOpenCodeModel(model) : undefined;
  if (!parsed) return undefined;

  const apiKey = modelConfig.apiKeySlot ? env?.[modelConfig.apiKeySlot] : undefined;
  const options: Record<string, unknown> = {
    ...(modelConfig.baseUrl ? { baseURL: modelConfig.baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
  };
  return {
    [parsed.providerID]: {
      npm: modelConfig.npm ?? "@ai-sdk/openai-compatible",
      options,
    },
  };
}
```

Keep the existing `BYPASS_PERMISSION`, `applyEnv`, and `freePort` exports unchanged. Ensure `ResolvedMcpInstance` and `OpenCodeProviderConfig` imports already present remain.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/agent-runtime/src/providers/opencode/server-config.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/providers/opencode/server-config.ts packages/agent-runtime/src/providers/opencode/server-config.test.ts
git commit -m "feat(opencode): emit Config.provider block from model custom config"
```

---

## Task 7: Thread `model`/`modelConfig`/`env` through the provider

**Files:**
- Modify: `packages/agent-runtime/src/providers/opencode/index.ts`

- [ ] **Step 1: Update `#withServer` and the three call sites**

In `packages/agent-runtime/src/providers/opencode/index.ts`, replace the `#withServer` method and the three operation methods with:

```typescript
  /** Start a managed server with op-specific config, run `fn`, always close. */
  async #withServer<T>(
    runtime: {
      mcps?: ResolvedMcpInstance[];
      model?: string;
      modelConfig?: import("@journeyman/core").CodingModelConfig;
      env?: Record<string, string>;
    },
    fn: (client: Awaited<ReturnType<typeof startServer>>["client"]) => Promise<T>,
  ): Promise<T> {
    const serverConfig = buildServerConfig(this.#config, runtime);
    const handle = await startServer(this.#config, serverConfig, runtime.env);
    try {
      return await fn(handle.client);
    } finally {
      handle.close();
    }
  }

  async scanRepos(opts: ScanReposOptions): Promise<ScanReposResult> {
    return this.#withServer(
      { model: opts.model, modelConfig: opts.modelConfig },
      (client) => scanRepos(client, this.#config, opts),
    );
  }

  async checkoutRepo(opts: CheckoutRepoOptions): Promise<CheckoutRepoResult> {
    return this.#withServer(
      { model: opts.model, modelConfig: opts.modelConfig },
      (client) => checkoutRepo(client, this.#config, opts),
    );
  }

  async runCustomPrompt(opts: RunCustomPromptOptions): Promise<RunCustomPromptResult> {
    return this.#withServer(
      { mcps: opts.mcps, model: opts.model, modelConfig: opts.modelConfig, env: opts.env },
      (client) => runCustomPrompt(client, this.#config, opts),
    );
  }
```

(`buildServerConfig` is already imported in this file; `ResolvedMcpInstance` is already imported. The `CodingModelConfig` inline import keeps the import list minimal.)

- [ ] **Step 2: Typecheck + run the opencode provider tests**

Run: `npm run typecheck -w @journeyman/agent-runtime && npx vitest run packages/agent-runtime/src/providers/opencode`
Expected: typecheck clean; all opencode tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/agent-runtime/src/providers/opencode/index.ts
git commit -m "feat(opencode): thread model/modelConfig/env into buildServerConfig"
```

---

## Task 8: Harness resolves `modelConfig` onto the step input

**Files:**
- Modify: `packages/orchestrator/src/workers/worker-harness.ts`
- Modify: `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 1: Add the resolver dep type**

In `packages/orchestrator/src/workers/worker-harness.ts`, find the deps interface block containing `modelResolver?: (input: { provider: string }) => Promise<string | undefined>;` and add directly below it:

```typescript
  modelConfigResolver?: (input: { provider: string; modelId: string }) =>
    Promise<import("@journeyman/core").CodingModelConfig | undefined>;
```

- [ ] **Step 2: Resolve and attach `modelConfig` after the model is resolved**

In `worker-harness.ts`, find the block that ends with:
```typescript
          if (sysModel) {
            (stepInput as { model?: string }).model = sysModel;
          }
        } catch (err: any) {
          rlog.warn({ err: err?.message }, "model resolver failed; deferring to provider default");
        }
      }
    }
```
Immediately **after** that closing `}` (i.e. after the model-resolution block), add:

```typescript
    // Resolve provider-specific model config (e.g. OpenCode custom endpoints) so the
    // operation can emit a provider block / bind the endpoint's key slot.
    const resolvedModel = (stepInput as { model?: unknown }).model;
    const cfgProvider = (stepInput as { provider?: string }).provider;
    if (
      this.deps.modelConfigResolver &&
      typeof resolvedModel === "string" && resolvedModel &&
      typeof cfgProvider === "string" && cfgProvider
    ) {
      try {
        const mc = await this.deps.modelConfigResolver({ provider: cfgProvider, modelId: resolvedModel });
        if (mc) (stepInput as { modelConfig?: unknown }).modelConfig = mc;
      } catch (err: any) {
        rlog.warn({ err: err?.message }, "model config resolver failed; continuing without custom config");
      }
    }
```

- [ ] **Step 3: Wire the resolver in cli-worker**

In `packages/orchestrator/src/cli-worker.ts`, change the import on line ~30 to add `findCodingModel`:
```typescript
import { findDefaultCodingModel, findCodingModel } from "@journeyman/coding-models";
```

In the harness deps object, directly after the `modelResolver: async ({ provider }) => { … },` block, add:
```typescript
  modelConfigResolver: async ({ provider, modelId }) => {
    if (!pool) return undefined;
    const m = await findCodingModel(pool, provider, modelId);
    return m?.config;
  },
```

- [ ] **Step 4: Typecheck the orchestrator**

Run: `npm run typecheck -w @journeyman/orchestrator`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/workers/worker-harness.ts packages/orchestrator/src/cli-worker.ts
git commit -m "feat(orchestrator): resolve coding model config onto step input"
```

---

## Task 9: Custom-AI handler consumes `modelConfig`

**Files:**
- Modify: `packages/orchestrator/src/workers/steps/custom-ai-step-handler.ts`

- [ ] **Step 1: Read `modelConfig` and add its api-key slot to the effective slots**

In `packages/orchestrator/src/workers/steps/custom-ai-step-handler.ts`, locate the slot-union block:
```typescript
    const slotsByName = new Map<string, { name: string; optional?: boolean }>();
    for (const s of providerSlots) slotsByName.set(s.name, s);
    for (const s of dbSlots)       slotsByName.set(s.name, s);
    const effectiveSlots = Array.from(slotsByName.values());
```
Replace it with:
```typescript
    const slotsByName = new Map<string, { name: string; optional?: boolean }>();
    for (const s of providerSlots) slotsByName.set(s.name, s);
    for (const s of dbSlots)       slotsByName.set(s.name, s);
    const modelConfig = (input.modelConfig as CodingModelConfig | undefined) ?? undefined;
    if (modelConfig?.apiKeySlot) {
      slotsByName.set(modelConfig.apiKeySlot, { name: modelConfig.apiKeySlot, optional: true });
    }
    const effectiveSlots = Array.from(slotsByName.values());
```

- [ ] **Step 2: Forward `modelConfig` into the operation options**

In the same file, in the `coding.runCustomPrompt({ … })` call, add after the `...(model ? { model } : {}),` line:
```typescript
      ...(modelConfig ? { modelConfig } : {}),
```

- [ ] **Step 3: Add the type import**

At the top of the file, add `CodingModelConfig` to the existing `@journeyman/core` type import (the one that already imports `ResolvedMcpInstance`, `ResolvedSkillPackage`, `SecretBinding`). If unsure, add a dedicated line:
```typescript
import type { CodingModelConfig } from "@journeyman/core";
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck -w @journeyman/orchestrator`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/workers/steps/custom-ai-step-handler.ts
git commit -m "feat(orchestrator): custom-ai step binds api-key slot + forwards modelConfig"
```

---

## Task 10: Admin UI — conditional "Custom endpoint" section

**Files:**
- Modify: `packages/web/src/routes/AdminCodingModelsPage.tsx`

- [ ] **Step 1: Initialize `config` in the empty form**

In `packages/web/src/routes/AdminCodingModelsPage.tsx`, in the `EMPTY` object, add a line after `supportsThinking: false,`:
```typescript
  config: {},
```

- [ ] **Step 2: Add a helper to update nested config**

Inside `ModelForm`, directly after the `set` helper definition, add:
```typescript
  const setConfig = (k: "baseUrl" | "npm" | "apiKeySlot", val: string) =>
    setV((prev) => ({ ...prev, config: { ...(prev.config ?? {}), [k]: val || undefined } }));
```

- [ ] **Step 3: Render the section only for opencode**

In `ModelForm`'s JSX, after the "Capabilities" `</section>` and before the "Flags" `<section …>`, insert:
```tsx
        {v.provider === "opencode" && (
          <section className="space-y-3">
            <h3 className="text-sm font-medium text-slate-200">Custom endpoint (optional)</h3>
            <p className="text-xs text-slate-400">
              Leave blank for cloud models (Claude, OpenAI, Gemini) — they use built-in defaults.
              Fill in for local/self-hosted endpoints. Inside Docker, <code>localhost</code> is the
              container — use <code>host.docker.internal</code> or a reachable service address.
            </p>
            <Field label="Base URL">
              <input
                className={`${inputCls} font-mono text-sm`}
                value={v.config?.baseUrl ?? ""}
                onChange={(e) => setConfig("baseUrl", e.target.value)}
                placeholder="http://host.docker.internal:1234/v1"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="npm package">
                <input
                  className={`${inputCls} font-mono text-sm`}
                  value={v.config?.npm ?? ""}
                  onChange={(e) => setConfig("npm", e.target.value)}
                  placeholder="@ai-sdk/openai-compatible"
                />
              </Field>
              <Field label="API key slot">
                <input
                  className={`${inputCls} font-mono text-sm`}
                  value={v.config?.apiKeySlot ?? ""}
                  onChange={(e) => setConfig("apiKeySlot", e.target.value)}
                  placeholder="MY_LLM_KEY (blank = no key)"
                />
              </Field>
            </div>
          </section>
        )}
```

- [ ] **Step 4: Typecheck the web package**

Run: `npm run typecheck -w @journeyman/web`
Expected: no errors. (`CodingModelCreateInput` now includes `config`, so `v.config` typechecks.)

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/routes/AdminCodingModelsPage.tsx
git commit -m "feat(web): opencode custom-endpoint fields in coding-model form"
```

---

## Task 11: Cross-cutting verification

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck + import boundaries**

Run: `npm run check`
Expected: clean across all workspaces; "✓ Layer boundaries clean across all packages."

- [ ] **Step 2: Run the touched test suites**

Run:
```bash
npx vitest run packages/core packages/coding-models packages/agent-runtime
```
Expected: PASS, including the new `validate-config`, `provider-catalog`, and `server-config` tests.

- [ ] **Step 3: Apply the migration (only if infra is running)**

Run: `npm run migrate`
Expected: migration `041_coding_model_config` applies; or a clear "no database" message if infra is down (then skip — applies on next deploy).

- [ ] **Step 4: Manual smoke (optional, needs a local OpenAI-compatible server)**

Via the admin UI (or API), create an opencode model: model id `lmstudio/llama-3.1`, Base URL `http://host.docker.internal:1234/v1`, npm blank, API key slot blank. Run a custom-AI step that selects it and confirm the prompt reaches the local server. Delete the throwaway model afterward.

- [ ] **Step 5: Final commit (only if verification-driven fixes were made)**

```bash
git add -A
git commit -m "test(opencode-config): verification fixes"
```

---

## Self-review notes (spec coverage)

- Storage (JSONB `config`) → Task 1. Core types (`CodingModelConfig`, `config`, `modelConfig`) → Task 2. DB persist + `findCodingModel` → Task 3. API accept + validation → Task 4. Standard key slots → Task 5. `provider` block emission → Task 6. Provider threading → Task 7. Worker resolution → Task 8. Handler consumption (slot + forward) → Task 9. UI → Task 10. Verification → Task 11.
- **Type consistency:** `CodingModelConfig { baseUrl?, npm?, apiKeySlot? }` used identically across core types, validator, `buildServerConfig` (`ServerConfigRuntime`), `#withServer`, harness dep, and handler. `buildServerConfig(config, runtime)` signature updated in Task 6 and matched in Task 7. `findCodingModel(pool, provider, modelId)` defined in Task 3, used in Task 8.
- **Deferred (documented):** built-in scan/checkout step handlers don't pass a per-step `model` today, so `modelConfig` there is a no-op until they do — `ScanReposOptions`/`CheckoutRepoOptions` already carry the field (Task 2) so adoption is a one-line change later.
- **Backward compatibility:** no `config` ⇒ `buildServerConfig` emits no `provider` block ⇒ existing cloud OpenCode + Claude models are unchanged (covered by the Task 6 "omits provider block" test).
- **DB test note:** `coding-models` has no DB-integration test harness; `config` round-trip is covered by typecheck + the pure `validate-config` and `buildServerConfig` unit tests, plus the optional Task 11 migration/manual smoke.
