# OpenCode AbortSignal + Skills Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the OpenCode coding provider honor `opts.skills` (deliver skills via OpenCode's native skill registry) and `opts.signal` (cancel a running prompt), reaching parity with the Claude and AISDK providers.

**Architecture:** Two independent provider-only changes. Skills: thread `opts.skills` into the per-call server `Config` as `skills.paths` (one path per enabled skill) so OpenCode auto-registers them and exposes its native `skill` tool. Abort: forward `opts.signal` to `createOpencode` for startup cancellation, and on abort call `client.session.abort({ sessionID })`, throwing an `AbortError` to match Claude/AISDK propagation.

**Tech Stack:** TypeScript, Vitest, `@opencode-ai/sdk` (v2).

**Spec:** `docs/superpowers/specs/2026-06-18-opencode-abort-skills-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `packages/agent-runtime/src/providers/opencode/server-config.ts` | Per-call OpenCode server `Config` | Add `skills` to `ServerConfigRuntime`; emit `skills.paths` from enabled skills |
| `packages/agent-runtime/src/providers/opencode/server-config.test.ts` | `buildServerConfig` unit tests | Add skills cases |
| `packages/agent-runtime/src/providers/opencode/client.ts` | Server start/connect | Add `signal?` param, forward to `createOpencode` |
| `packages/agent-runtime/src/providers/opencode/index.ts` | Provider class; `#withServer` | Thread `skills` + `signal` into the `runCustomPrompt` runtime; pass `signal` to `startServer` |
| `packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.ts` | The prompt operation | Abort: early-throw, session.abort listener, throw on aborted result |
| `packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.test.ts` | Operation unit tests | Add abort cases |

`scanRepos` / `checkoutRepo` are unchanged (deterministic ops; abort/skills not applicable).

---

## Task 1: Skills via the native registry (TDD)

**Files:**
- Modify: `packages/agent-runtime/src/providers/opencode/server-config.ts`
- Modify: `packages/agent-runtime/src/providers/opencode/index.ts`
- Test: `packages/agent-runtime/src/providers/opencode/server-config.test.ts`

- [ ] **Step 1: Write the failing tests**

In `server-config.test.ts`, add an import for the type at the top (after the existing `import type { ResolvedMcpInstance }` line):

```typescript
import type { ResolvedSkillPackage } from "@journeyman/core";
```

Then add these cases inside the existing `describe("buildServerConfig", ...)` block (after the last `it(...)`, before its closing `});`):

```typescript
  it("registers enabled skills as per-skill paths", () => {
    const skills: ResolvedSkillPackage[] = [
      { id: "1", name: "pkgA", localPath: "/ws/skills/pkgA", enabledSkills: ["alpha", "beta"], cliType: "opencode" },
      { id: "2", name: "pkgB", localPath: "/ws/skills/pkgB", enabledSkills: ["gamma"], cliType: "opencode" },
    ];
    const c = buildServerConfig(cfg, { skills });
    expect(c.skills).toEqual({ paths: ["/ws/skills/pkgA/alpha", "/ws/skills/pkgA/beta", "/ws/skills/pkgB/gamma"] });
  });
  it("omits the skills block when there are no skills", () => {
    expect(buildServerConfig(cfg, {}).skills).toBeUndefined();
    expect(buildServerConfig(cfg, { skills: [] }).skills).toBeUndefined();
  });
  it("emits skills alongside the permission/agent blocks", () => {
    const skills: ResolvedSkillPackage[] = [
      { id: "1", name: "p", localPath: "/ws/p", enabledSkills: ["s"], cliType: "opencode" },
    ];
    const c = buildServerConfig(cfg, { skills, maxSteps: 5 });
    expect(c.permission).toMatchObject({ bash: "allow" });
    expect((c.agent as any).build.maxSteps).toBe(5);
    expect(c.skills).toEqual({ paths: ["/ws/p/s"] });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @journeyman/agent-runtime -- server-config`

Expected: FAIL — the new cases fail because `c.skills` is `undefined` (no `skills` key produced yet).

- [ ] **Step 3: Implement the skills block**

In `server-config.ts`, add the `node:path` import at the top (the first existing import is `import { createServer } from "node:net";`):

```typescript
import { join } from "node:path";
```

Add `ResolvedSkillPackage` to the existing core type import. The current line is:

```typescript
import type { CodingModelConfig, ResolvedMcpInstance } from "@journeyman/core";
```

Change it to:

```typescript
import type { CodingModelConfig, ResolvedMcpInstance, ResolvedSkillPackage } from "@journeyman/core";
```

Add `skills` to the `ServerConfigRuntime` interface:

```typescript
export interface ServerConfigRuntime {
  mcps?: ResolvedMcpInstance[];
  model?: string;
  modelConfig?: CodingModelConfig;
  env?: Record<string, string>;
  maxSteps?: number;
  skills?: ResolvedSkillPackage[];
}
```

In `buildServerConfig`, compute the skill paths and add the block to the returned object. The function body becomes:

```typescript
  const permission = { ...BYPASS_PERMISSION, ...config.permission };
  const mcp = { ...(config.mcp ?? {}), ...(runtime.mcps?.length ? toOpenCodeMcpConfigs(runtime.mcps) : {}) };
  const provider = buildProviderBlock(runtime.model, runtime.modelConfig, runtime.env);
  const maxSteps = runtime.maxSteps && runtime.maxSteps > 0 ? runtime.maxSteps : DEFAULT_STEP_BUDGET;
  const skillPaths = (runtime.skills ?? []).flatMap((pkg) => pkg.enabledSkills.map((name) => join(pkg.localPath, name)));
  return {
    permission,
    agent: { build: { maxSteps } },
    ...(Object.keys(mcp).length ? { mcp } : {}),
    ...(provider ? { provider } : {}),
    ...(skillPaths.length ? { skills: { paths: skillPaths } } : {}),
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @journeyman/agent-runtime -- server-config`

Expected: PASS — all `buildServerConfig` cases pass.

- [ ] **Step 5: Thread `opts.skills` through the provider**

In `index.ts`, the current `runCustomPrompt` method passes a runtime object. Add `skills: opts.skills` to it:

```typescript
  async runCustomPrompt(opts: RunCustomPromptOptions): Promise<RunCustomPromptResult> {
    return this.#withServer(
      { mcps: opts.mcps, model: opts.model, modelConfig: opts.modelConfig, env: opts.env, maxSteps: opts.maxSteps, skills: opts.skills },
      (client) => runCustomPrompt(client, this.#config, opts),
    );
  }
```

Add `skills?: ResolvedSkillPackage[];` to the `#withServer` runtime inline type (the `runtime` parameter, which already lists `mcps`/`model`/`modelConfig`/`env`/`maxSteps`):

```typescript
    runtime: {
      mcps?: ResolvedMcpInstance[];
      model?: string;
      modelConfig?: CodingModelConfig;
      env?: Record<string, string>;
      maxSteps?: number;
      skills?: ResolvedSkillPackage[];
    },
```

`ResolvedSkillPackage` is already imported in `index.ts` (it appears in the existing `import type { … }` block from `@journeyman/core`). If the typecheck in the next step reports it missing, add it to that import.

- [ ] **Step 6: Type-check**

Run: `npm run typecheck`

Expected: PASS — no type errors.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-runtime/src/providers/opencode/server-config.ts \
        packages/agent-runtime/src/providers/opencode/server-config.test.ts \
        packages/agent-runtime/src/providers/opencode/index.ts
git commit -m "feat(opencode): register enabled skills via native skills.paths

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Forward `signal` to server startup

**Files:**
- Modify: `packages/agent-runtime/src/providers/opencode/client.ts`
- Modify: `packages/agent-runtime/src/providers/opencode/index.ts`

- [ ] **Step 1: Add a `signal` parameter to `startServer`**

In `client.ts`, the current signature is:

```typescript
export async function startServer(
  config: OpenCodeProviderConfig,
  serverConfig: Record<string, unknown>,
  env: Record<string, string> | undefined,
): Promise<OpenCodeServerHandle> {
```

Change it to accept a signal:

```typescript
export async function startServer(
  config: OpenCodeProviderConfig,
  serverConfig: Record<string, unknown>,
  env: Record<string, string> | undefined,
  signal?: AbortSignal,
): Promise<OpenCodeServerHandle> {
```

Forward it to `createOpencode`. The current call is:

```typescript
    const { client, server } = await createOpencode({
      hostname: config.hostname ?? "127.0.0.1",
      port,
      timeout: resolveServerTimeout(config.timeout),
      config: serverConfig as never,
    });
```

Change it to:

```typescript
    const { client, server } = await createOpencode({
      hostname: config.hostname ?? "127.0.0.1",
      port,
      timeout: resolveServerTimeout(config.timeout),
      config: serverConfig as never,
      ...(signal ? { signal } : {}),
    });
```

External mode (the early `return` at the top of the function) is unchanged — it spawns no server.

- [ ] **Step 2: Pass the runtime signal through `#withServer`**

In `index.ts`, add `signal?: AbortSignal;` to the `#withServer` runtime inline type (alongside the fields added in Task 1):

```typescript
    runtime: {
      mcps?: ResolvedMcpInstance[];
      model?: string;
      modelConfig?: CodingModelConfig;
      env?: Record<string, string>;
      maxSteps?: number;
      skills?: ResolvedSkillPackage[];
      signal?: AbortSignal;
    },
```

The current `#withServer` body calls `startServer(this.#config, serverConfig, runtime.env)`. Add the signal as the 4th argument:

```typescript
    const serverConfig = buildServerConfig(this.#config, runtime);
    const handle = await startServer(this.#config, serverConfig, runtime.env, runtime.signal);
```

In `runCustomPrompt`, add `signal: opts.signal` to the runtime object (so it now reads):

```typescript
      { mcps: opts.mcps, model: opts.model, modelConfig: opts.modelConfig, env: opts.env, maxSteps: opts.maxSteps, skills: opts.skills, signal: opts.signal },
```

Note: `buildServerConfig` ignores `runtime.signal` (it only reads config-relevant fields), so the extra property is harmless there.

- [ ] **Step 3: Type-check**

Run: `npm run typecheck`

Expected: PASS — no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/agent-runtime/src/providers/opencode/client.ts \
        packages/agent-runtime/src/providers/opencode/index.ts
git commit -m "feat(opencode): forward AbortSignal to managed server startup

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Abort the running prompt (TDD)

**Files:**
- Modify: `packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.ts`
- Test: `packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.test.ts`

- [ ] **Step 1: Write the failing tests**

In `run-custom-prompt.test.ts`, add a fake-client helper that includes `session.abort`. Place it directly after the existing `fakeClient` helper (before `describe("opencode runCustomPrompt", ...)`):

```typescript
function fakeClientWithAbort(
  promptImpl: (params: any) => any,
  abort: ReturnType<typeof vi.fn>,
): OpenCodeClient {
  return {
    session: {
      create: vi.fn().mockResolvedValue({ data: { id: "sess-1" } }),
      prompt: vi.fn().mockImplementation(async (p: any) => promptImpl(p)),
      abort,
    },
  } as unknown as OpenCodeClient;
}
```

Then add a new describe block at the end of the file:

```typescript
describe("opencode runCustomPrompt abort", () => {
  it("throws before creating a session when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const create = vi.fn();
    const client = { session: { create, prompt: vi.fn(), abort: vi.fn() } } as unknown as OpenCodeClient;
    await expect(
      runCustomPrompt(client, cfg, { prompt: "x", outputMode: "text", model: "openai/gpt-4o", signal: ac.signal }),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it("aborts the session and throws when the signal fires mid-run", async () => {
    const ac = new AbortController();
    const abort = vi.fn().mockResolvedValue({ data: true });
    const client = fakeClientWithAbort(() => {
      ac.abort();
      return { data: { info: { error: { name: "MessageAbortedError" } }, parts: [] } };
    }, abort);
    await expect(
      runCustomPrompt(client, cfg, { prompt: "x", outputMode: "text", model: "openai/gpt-4o", signal: ac.signal }),
    ).rejects.toThrow();
    expect(abort).toHaveBeenCalledWith({ sessionID: "sess-1" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @journeyman/agent-runtime -- run-custom-prompt`

Expected: FAIL — the first case fails (no early-abort: `create` IS called), and the second fails (`abort` is never called; the function returns `{ error }` instead of throwing).

- [ ] **Step 3: Implement abort handling**

In `run-custom-prompt.ts`, add a small helper above the `runCustomPrompt` function (after the existing `buildSystem` function):

```typescript
/** A consistent abort error to throw, matching how Claude/AISDK surface cancellation. */
function abortError(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException("Aborted", "AbortError");
}
```

At the very start of `runCustomPrompt` — immediately after `const sessionId = opts.sessionId ?? crypto.randomUUID();` — add the early check:

```typescript
  if (opts.signal?.aborted) throw abortError(opts.signal);
```

The current code creates the session, then calls `client.session.prompt(...)`. Replace the block from `const session = await client.session.create(...)` through the `const res = await client.session.prompt({ ... });` call so the prompt is wrapped with an abort listener. The existing code is:

```typescript
  const session = await client.session.create({ title: "customPrompt" });
  if (!session.data) {
    return { sessionId, error: `opencode session.create failed: ${describeSdkError((session as { error?: unknown }).error)}` };
  }

  const promptText = [opts.cwd ? confinementSystemPrompt(opts.cwd) : "", opts.prompt].filter(Boolean).join("\n\n");

  const res = await client.session.prompt({
    sessionID: session.data.id,
    parts: [{ type: "text", text: promptText }],
    model,
    tools,
    ...(opts.cwd ? { directory: opts.cwd } : {}),
    ...(system ? { system } : {}),
    ...(opts.outputMode === "structured" && opts.outputSchema
      ? { format: { type: "json_schema", schema: opts.outputSchema, retryCount: STRUCTURED_RETRY_COUNT } }
      : {}),
  });
```

Replace it with:

```typescript
  const session = await client.session.create({ title: "customPrompt" });
  if (!session.data) {
    return { sessionId, error: `opencode session.create failed: ${describeSdkError((session as { error?: unknown }).error)}` };
  }
  const sid = session.data.id;

  const promptText = [opts.cwd ? confinementSystemPrompt(opts.cwd) : "", opts.prompt].filter(Boolean).join("\n\n");

  // Best-effort server-side cancellation: when the run is aborted, tell OpenCode to
  // stop the agent loop. Swallow abort's own errors so they never mask the cancellation.
  const onAbort = () => { void Promise.resolve(client.session.abort({ sessionID: sid })).catch(() => {}); };
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  let res: Awaited<ReturnType<typeof client.session.prompt>>;
  try {
    res = await client.session.prompt({
      sessionID: sid,
      parts: [{ type: "text", text: promptText }],
      model,
      tools,
      ...(opts.cwd ? { directory: opts.cwd } : {}),
      ...(system ? { system } : {}),
      ...(opts.outputMode === "structured" && opts.outputSchema
        ? { format: { type: "json_schema", schema: opts.outputSchema, retryCount: STRUCTURED_RETRY_COUNT } }
        : {}),
    });
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
  }

  if (opts.signal?.aborted) throw abortError(opts.signal);
```

Then, in the result handling, treat a `MessageAbortedError` envelope as an abort too. The current block is:

```typescript
  if (info.error) {
    const error = typeof info.error === "string" ? info.error : JSON.stringify(info.error);
    log.error({ sessionId, error }, "runCustomPrompt failed");
    return { sessionId, error };
  }
```

Replace it with:

```typescript
  if (info.error) {
    if (info.error && typeof info.error === "object" && (info.error as { name?: string }).name === "MessageAbortedError") {
      throw abortError(opts.signal);
    }
    const error = typeof info.error === "string" ? info.error : JSON.stringify(info.error);
    log.error({ sessionId, error }, "runCustomPrompt failed");
    return { sessionId, error };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @journeyman/agent-runtime -- run-custom-prompt`

Expected: PASS — both abort cases pass, and the existing structured/text/none/error cases still pass (they pass no `signal`, so the new code is inert for them).

- [ ] **Step 5: Commit**

```bash
git add packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.ts \
        packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.test.ts
git commit -m "feat(opencode): honor AbortSignal — cancel session and throw on abort

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full agent-runtime test suite**

Run: `npm test -w @journeyman/agent-runtime`

Expected: PASS — all tests green, including the new skills + abort cases and all pre-existing OpenCode tests.

- [ ] **Step 2: Run repo-wide type + boundary checks**

Run: `npm run check`

Expected: PASS — `npm run typecheck` and `npm run check:boundaries` both succeed.

---

## Self-Review

**Spec coverage:**
- Part A skills → `Config.skills.paths` from per-enabled-skill dirs → Task 1 (server-config) + Task 1 Step 5 (threading).
- Part B abort, server startup → `createOpencode({ signal })` → Task 2.
- Part B abort, running prompt → early-throw + `session.abort` listener + throw on aborted result → Task 3.
- Throw-on-abort parity (not error envelope) → Task 3 Step 3 (`abortError`, early throw, post-prompt throw, `MessageAbortedError` branch).
- Best-effort `session.abort` (swallow its errors) → Task 3 Step 3 (`onAbort` `.catch(() => {})`).
- `scanRepos`/`checkoutRepo` unchanged, no core/UI change → reflected in File Structure (no such tasks; `signal`/`skills` already in `RunCustomPromptOptions`).
- Testing requirements (skills paths/omission/coexistence; already-aborted throw-before-create; mid-run abort calls session.abort + throws) → Task 1 Step 1, Task 3 Step 1.

**Placeholder scan:** No TBD/TODO/"handle edge cases". Every code step shows complete code. The credentials-gated verification probe from the spec is intentionally **not** a task here (it cannot run without OpenCode credentials); it is called out to the user at handoff instead.

**Type consistency:** `ServerConfigRuntime` gains `skills?: ResolvedSkillPackage[]` (Task 1) matching the `#withServer` runtime type and `RunCustomPromptOptions.skills` (existing). `startServer`'s new 4th param `signal?: AbortSignal` (Task 2) matches the `#withServer` runtime `signal?: AbortSignal` and `RunCustomPromptOptions.signal`. The fake client's `session.abort` is called as `abort({ sessionID })` in both the test (Task 3 Step 1) and the implementation `onAbort` (Task 3 Step 3) — identical shape. `abortError(signal)` is defined once and used at all three throw sites.
