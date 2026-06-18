# OpenCode `maxSteps` Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the OpenCode coding provider honor the per-step `maxSteps` config (with a default of 80), so the step cap works identically across Claude, AISDK, and OpenCode.

**Architecture:** OpenCode's SDK exposes a native cap, `AgentConfig.maxSteps` ("max agentic iterations before forcing a text-only response"). It lives on an *agent* in the server `Config.agent` map. The provider already starts a fresh managed server per operation and assembles a per-call `Config` in `server-config.ts`, so we inject `agent: { build: { maxSteps } }` (overriding only `maxSteps` on OpenCode's default `build` agent) and thread `opts.maxSteps` through from `runCustomPrompt`. No prompt-body change, no core/UI change — `maxSteps` already exists end-to-end.

**Tech Stack:** TypeScript, Vitest, `@opencode-ai/sdk`.

**Spec:** `docs/superpowers/specs/2026-06-18-opencode-maxsteps-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/agent-runtime/src/providers/opencode/server-config.ts` | Assembles the per-call OpenCode server `Config` | Add `maxSteps` to `ServerConfigRuntime`; inject `agent.build.maxSteps` with default 80 |
| `packages/agent-runtime/src/providers/opencode/server-config.test.ts` | Unit tests for `buildServerConfig` | Add cases for the `agent` block + no-regression check |
| `packages/agent-runtime/src/providers/opencode/index.ts` | Provider class; `#withServer` wiring | Pass `maxSteps: opts.maxSteps` into the `runCustomPrompt` runtime |

`scanRepos` / `checkoutRepo` are deterministic built-in ops with their own fixed budgets and are intentionally left unchanged.

---

## Task 0: Verify the default-agent / merge assumption (probe, no commit)

This de-risks the whole approach before any code change. Confirm (1) a bare `session.prompt` runs under the `build` agent and (2) a partial `agent: { build: { maxSteps } }` override merges onto (not replaces) the built-in `build` config so tools still work.

**Files:** none (throwaway probe).

- [ ] **Step 1: Run a managed-server probe**

This requires a working OpenCode model credential in the environment (same as the integration tests). Create a scratch file `packages/agent-runtime/scratch-maxsteps-probe.mts`:

```typescript
import { createOpencode } from "@opencode-ai/sdk/v2";

const { client, server } = await createOpencode({
  hostname: "127.0.0.1",
  port: 0,
  timeout: 60_000,
  config: {
    permission: { bash: "allow", edit: "allow", webfetch: "allow", websearch: "allow", skill: "allow" },
    agent: { build: { maxSteps: 2 } },
  } as never,
});

const session = await client.session.create({ title: "probe" });
const res = await client.session.prompt({
  sessionID: session.data!.id,
  parts: [{ type: "text", text: "List the files in the current directory using your tools, then say DONE." }],
  model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" }, // adjust to an available model
  tools: { bash: true },
});
console.log("INFO:", JSON.stringify((res.data as any)?.info, null, 2));
console.log("PARTS:", JSON.stringify((res.data as any)?.parts?.map((p: any) => p.type), null, 2));
server.close();
```

Run: `npx tsx packages/agent-runtime/scratch-maxsteps-probe.mts`

Expected: the run completes (not an "unknown agent" error), tool-call parts are present (proving `build`'s tool behavior survived the partial override), and the transcript shows the loop was bounded near 2 steps. If instead you see an error about an unknown/empty agent or no tool parts when tools were expected, the merge assumption is **false** — use the fallback noted below.

- [ ] **Step 2: Decide variant, then delete the scratch file**

If the probe behaves as expected, proceed with this plan as written (override `build`). If it failed, switch every `agent: { build: { maxSteps } }` in the tasks below to a dedicated agent — `agent: { journeyman: { maxSteps, mode: "primary" } }` in `buildServerConfig` — AND add `agent: "journeyman"` to the `client.session.prompt({ ... })` body in `operations/run-custom-prompt.ts`. The default value, threading, and tests are otherwise identical.

Run: `rm packages/agent-runtime/scratch-maxsteps-probe.mts`

Expected: scratch file removed (it must not be committed).

---

## Task 1: Inject `maxSteps` into the server config (TDD)

**Files:**
- Modify: `packages/agent-runtime/src/providers/opencode/server-config.ts`
- Test: `packages/agent-runtime/src/providers/opencode/server-config.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these cases inside the existing `describe("buildServerConfig", ...)` block in `server-config.test.ts` (after the last `it(...)`, before the closing `});` on line 50):

```typescript
  it("caps the build agent at the requested maxSteps", () => {
    const c = buildServerConfig(cfg, { maxSteps: 25 });
    expect(c.agent).toEqual({ build: { maxSteps: 25 } });
  });
  it("applies the default step budget (80) when maxSteps is omitted", () => {
    const c = buildServerConfig(cfg, {});
    expect(c.agent).toEqual({ build: { maxSteps: 80 } });
  });
  it("applies the default step budget when maxSteps is non-positive", () => {
    expect((buildServerConfig(cfg, { maxSteps: 0 }).agent as any).build.maxSteps).toBe(80);
    expect((buildServerConfig(cfg, { maxSteps: -5 }).agent as any).build.maxSteps).toBe(80);
  });
  it("still emits permission/mcp/provider blocks alongside the agent block", () => {
    const mcps: ResolvedMcpInstance[] = [{ id: "1", name: "fs", transport: "stdio", command: "x", args: [], env: {}, systemPrompt: null }];
    const c = buildServerConfig(cfg, {
      mcps,
      model: "lmstudio/llama-3.1",
      modelConfig: { baseUrl: "http://host:1234/v1" },
      maxSteps: 10,
    });
    expect(c.permission).toMatchObject({ bash: "allow" });
    expect(c.mcp).toHaveProperty("fs");
    expect(c.provider).toHaveProperty("lmstudio");
    expect(c.agent).toEqual({ build: { maxSteps: 10 } });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @journeyman/agent-runtime -- server-config`

Expected: FAIL — the four new cases fail because `c.agent` is `undefined` (no `agent` key produced yet).

- [ ] **Step 3: Implement the injection**

In `server-config.ts`, add a default constant near the top (after the imports, above `BYPASS_PERMISSION`):

```typescript
/** Default agent step budget when the step doesn't specify maxSteps — matches the Claude/AISDK providers. */
const DEFAULT_STEP_BUDGET = 80;
```

Add `maxSteps` to the `ServerConfigRuntime` interface:

```typescript
export interface ServerConfigRuntime {
  mcps?: ResolvedMcpInstance[];
  model?: string;
  modelConfig?: CodingModelConfig;
  env?: Record<string, string>;
  maxSteps?: number;
}
```

In `buildServerConfig`, compute the budget and add the `agent` block to the returned object. The function body becomes:

```typescript
  const permission = { ...BYPASS_PERMISSION, ...config.permission };
  const mcp = { ...(config.mcp ?? {}), ...(runtime.mcps?.length ? toOpenCodeMcpConfigs(runtime.mcps) : {}) };
  const provider = buildProviderBlock(runtime.model, runtime.modelConfig, runtime.env);
  const maxSteps = runtime.maxSteps && runtime.maxSteps > 0 ? runtime.maxSteps : DEFAULT_STEP_BUDGET;
  return {
    permission,
    agent: { build: { maxSteps } },
    ...(Object.keys(mcp).length ? { mcp } : {}),
    ...(provider ? { provider } : {}),
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @journeyman/agent-runtime -- server-config`

Expected: PASS — all `buildServerConfig` cases (existing + 4 new) pass.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/providers/opencode/server-config.ts \
        packages/agent-runtime/src/providers/opencode/server-config.test.ts
git commit -m "feat(opencode): cap build agent at maxSteps (default 80) in server config

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Thread `opts.maxSteps` from `runCustomPrompt` into the server runtime

`buildServerConfig` now reads `runtime.maxSteps`, but `runCustomPrompt`'s `#withServer` call doesn't pass it yet, so it always falls back to the default. This task connects the user's value.

**Files:**
- Modify: `packages/agent-runtime/src/providers/opencode/index.ts:64-69` (the `runCustomPrompt` method)

- [ ] **Step 1: Pass `maxSteps` into the runtime object**

In `index.ts`, the current `runCustomPrompt` method is:

```typescript
  async runCustomPrompt(opts: RunCustomPromptOptions): Promise<RunCustomPromptResult> {
    return this.#withServer(
      { mcps: opts.mcps, model: opts.model, modelConfig: opts.modelConfig, env: opts.env },
      (client) => runCustomPrompt(client, this.#config, opts),
    );
  }
```

Change the runtime object to include `maxSteps`:

```typescript
  async runCustomPrompt(opts: RunCustomPromptOptions): Promise<RunCustomPromptResult> {
    return this.#withServer(
      { mcps: opts.mcps, model: opts.model, modelConfig: opts.modelConfig, env: opts.env, maxSteps: opts.maxSteps },
      (client) => runCustomPrompt(client, this.#config, opts),
    );
  }
```

Note: the `#withServer` runtime parameter type already lists `mcps`/`model`/`modelConfig`/`env`; add `maxSteps?: number;` to that inline type (the `runtime` parameter of `#withServer`, around line 33-38) so it type-checks:

```typescript
    runtime: {
      mcps?: ResolvedMcpInstance[];
      model?: string;
      modelConfig?: CodingModelConfig;
      env?: Record<string, string>;
      maxSteps?: number;
    },
```

- [ ] **Step 2: Type-check the package**

Run: `npm run typecheck`

Expected: PASS — no type errors. (`buildServerConfig`'s `ServerConfigRuntime` already accepts `maxSteps` from Task 1, so the value flows through cleanly.)

- [ ] **Step 3: Commit**

```bash
git add packages/agent-runtime/src/providers/opencode/index.ts
git commit -m "feat(opencode): thread runCustomPrompt maxSteps into server runtime

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full agent-runtime test suite**

Run: `npm test -w @journeyman/agent-runtime`

Expected: PASS — all tests green, including the existing `run-custom-prompt` tests (the prompt body is unchanged in this approach) and the new `server-config` cases.

- [ ] **Step 2: Run repo-wide type + boundary checks**

Run: `npm run check`

Expected: PASS — `npm run typecheck` and `npm run check:boundaries` both succeed.

---

## Self-Review

**Spec coverage:**
- "Native agent maxSteps via `agent.build.maxSteps`" → Task 1.
- "Thread `opts.maxSteps` through `#withServer`" → Task 2.
- "Default 80 matching Claude/AISDK" → Task 1, `DEFAULT_STEP_BUDGET` + tests.
- "Pre-implementation verification probe + dedicated-agent fallback" → Task 0.
- "scanRepos/checkoutRepo unchanged" → explicitly excluded in File Structure.
- "No core/UI change" → no such task; `maxSteps` already exists end-to-end (confirmed: type at `coding.types.ts:77`, handler at `custom-ai-step-handler.ts:197`, UI at `ConfigTab.tsx:350`).
- Testing requirements (agent block value, default, no-regression of permission/mcp/provider) → Task 1 Step 1.

**Placeholder scan:** No TBD/TODO/"handle edge cases". All code steps show complete code. The one model id in Task 0 is marked "adjust to an available model" because it's a throwaway probe dependent on local credentials — not shipped code.

**Type consistency:** `ServerConfigRuntime.maxSteps?: number` (Task 1) matches the `#withServer` runtime inline type `maxSteps?: number` (Task 2) and `RunCustomPromptOptions.maxSteps` (existing, `coding.types.ts:77`). The produced shape `{ build: { maxSteps } }` is asserted identically in every test case.
