# Worker DB Secret Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow the standalone `cli-worker` to resolve `pinned` (user/org-scoped) secret bindings by connecting directly to Postgres using `@journeyman/secrets`'s existing `resolveBindings()` function.

**Architecture:** Three coordinated changes — (1) inject `startedByUserId`, `startedByOrgId`, and `flowId` as system fields into every Conductor task's `inputData` so the worker has the context needed to query the correct DB row; (2) add `orgId` to the `WorkerHarness` binding-resolver context; (3) swap the `cli-worker`'s env-only resolver for a DB-backed one when `DATABASE_URL` is present.

**Tech Stack:** TypeScript, `pg` (already in `@journeyman/orchestrator` deps), `@journeyman/secrets` (needs adding to orchestrator deps), Orkes Conductor Community.

---

## File Map

| File | What changes |
|---|---|
| `packages/orchestrator/package.json` | Add `@journeyman/secrets: "*"` to dependencies |
| `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts` | Spread system fields (`startedByUserId`, `startedByOrgId`, `flowId`) into `startWorkflow` input |
| `packages/orchestrator/src/flow-json/conductor-converter.ts` | Add three system field expressions to every phase task's `inputParameters` in `emitPhase` |
| `packages/orchestrator/src/workers/worker-harness.ts` | Add `orgId: string \| null` to `bindingResolver` ctx; extract `startedByOrgId` from `phaseInput` |
| `packages/orchestrator/src/cli-worker.ts` | Create PG pool when `DATABASE_URL` set; replace pinned-binding error with `resolveBindings()` call |

---

## Task 1: Add `@journeyman/secrets` dependency to orchestrator

**Files:**
- Modify: `packages/orchestrator/package.json`

- [ ] **Step 1: Add the dependency**

Open `packages/orchestrator/package.json`. In the `dependencies` object, add:

```json
"@journeyman/secrets": "*"
```

The `dependencies` block should look like:

```json
"dependencies": {
  "@journeyman/coding-cli": "*",
  "@journeyman/core": "*",
  "@journeyman/git-provider": "*",
  "@journeyman/notification-provider": "*",
  "@journeyman/secrets": "*",
  "@journeyman/ticket-provider": "*",
  "json-logic-js": "^2.0.5",
  "pg": "^8.13.0",
  "yaml": "^2.8.3"
}
```

- [ ] **Step 2: Install**

```bash
npm install
```

Expected: no errors; `@journeyman/secrets` is now resolvable from `packages/orchestrator`.

---

## Task 2: Inject system fields into Conductor workflow input

**Files:**
- Modify: `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts`

The `startWorkflow` call currently passes only `args.inputs` (user-supplied flow inputs like `{ issueRef: "..." }`). It must also include `startedByUserId`, `startedByOrgId`, and `flowId` so Conductor makes them available to every task via `${workflow.input.*}` expressions.

- [ ] **Step 1: Update `startWorkflow` call in `submit()`**

Find the `startWorkflow` call near the bottom of `submit()` (currently line 75–77):

```typescript
const engineWorkflowId = await this.deps.client.startWorkflow({
  name: wfName, version: 1, input: args.inputs,
});
```

Replace with:

```typescript
const engineWorkflowId = await this.deps.client.startWorkflow({
  name: wfName,
  version: 1,
  input: {
    ...args.inputs,
    startedByUserId: args.startedByUserId ?? null,
    startedByOrgId: args.startedByOrgId ?? null,
    flowId: args.flowId,
  },
});
```

---

## Task 3: Forward system fields into every phase task's `inputParameters`

**Files:**
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts`

Every SIMPLE task needs `startedByUserId`, `startedByOrgId`, and `flowId` in its `inputParameters` so Conductor resolves them from the workflow input and passes them through to the worker's `task.inputData`.

- [ ] **Step 1: Add system fields to `emitPhase` inputParameters**

In `emitPhase()`, the `inputParameters` IIFE currently returns:

```typescript
inputParameters: (() => {
  const bindings = resolvedNode.secretBindings ?? {};
  return {
    ...(resolvedNode.config ?? {}),
    ...resolveInputs(resolvedNode.inputs),
    provider: resolvedNode.executorConfig?.provider,
    retry: resolvedNode.retry ?? {},
    secretBindings: bindings,
    _flowDefaultSources: defaultSources,
  };
})(),
```

Replace with:

```typescript
inputParameters: (() => {
  const bindings = resolvedNode.secretBindings ?? {};
  return {
    ...(resolvedNode.config ?? {}),
    ...resolveInputs(resolvedNode.inputs),
    provider: resolvedNode.executorConfig?.provider,
    retry: resolvedNode.retry ?? {},
    secretBindings: bindings,
    _flowDefaultSources: defaultSources,
    startedByUserId: "${workflow.input.startedByUserId}",
    startedByOrgId: "${workflow.input.startedByOrgId}",
    flowId: "${workflow.input.flowId}",
  };
})(),
```

---

## Task 4: Add `orgId` to `WorkerHarness` binding-resolver context

**Files:**
- Modify: `packages/orchestrator/src/workers/worker-harness.ts`

The harness already extracts `userId` and `flowId` from `phaseInput`. It needs to also extract `orgId` and pass it in the `bindingResolver` ctx so the DB-backed resolver can call `fetchPinnedUserSecret(pool, orgId, userId, name)`.

- [ ] **Step 1: Extend `bindingResolver` ctx type**

Find the `WorkerHarnessDeps` interface (currently lines 11–28). Change the `bindingResolver` signature from:

```typescript
bindingResolver: (input: {
  ctx: { userId: string | null; flowId: string | null };
  slots: Array<{ name: string; optional?: boolean }>;
  bindings: Record<string, SecretBinding>;
}) => Promise<Record<string, string>>;
```

To:

```typescript
bindingResolver: (input: {
  ctx: { userId: string | null; orgId: string | null; flowId: string | null };
  slots: Array<{ name: string; optional?: boolean }>;
  bindings: Record<string, SecretBinding>;
}) => Promise<Record<string, string>>;
```

- [ ] **Step 2: Extract `orgId` from `phaseInput` and pass it**

In `processOnce()`, after the existing line that extracts `userId` (currently line 96):

```typescript
const userId = (phaseInput as { startedByUserId?: string | null }).startedByUserId ?? null;
```

Add immediately below it:

```typescript
const orgId = (phaseInput as { startedByOrgId?: string | null }).startedByOrgId ?? null;
```

Then update the `bindingResolver` call (currently line 115–119) to include `orgId`:

```typescript
resolvedEnv = await this.deps.bindingResolver({
  ctx: { userId, orgId, flowId },
  slots,
  bindings: declaredBindings,
});
```

---

## Task 5: Replace the `cli-worker` binding resolver with a DB-backed one

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts`

When `DATABASE_URL` is set, create a PG pool at startup and use `resolveBindings()` from `@journeyman/secrets`. When it is absent, keep the existing env-only path.

`resolveBindings()` expects `ctx: RunContext` which has shape `{ user: { id: string; username: string }, org: { id: string; slug: string }, ... }`. Since the worker only has `userId` and `orgId` strings (no `username`/`slug`), construct a minimal stub that satisfies the fields `resolveBindings` actually accesses (`ctx.user.id` and `ctx.org.id`).

- [ ] **Step 1: Add imports**

At the top of `packages/orchestrator/src/cli-worker.ts`, add after the existing imports:

```typescript
import { resolveBindings } from "@journeyman/secrets";
import pg from "pg";
const { Pool } = pg;
```

- [ ] **Step 2: Create the PG pool (optional)**

After the `log` and `envFile` lines at the top of the file (before the `baseUrl` line), add:

```typescript
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

if (pool) {
  // Verify connectivity at startup — fail fast if DB is unreachable.
  await pool.query("SELECT 1");
  log.info("worker DB pool connected");
}
```

- [ ] **Step 3: Replace `cliBindingResolver`**

Remove the current `cliBindingResolver` function entirely and replace with:

```typescript
const cliBindingResolver = async (input: {
  ctx: { userId: string | null; orgId: string | null; flowId: string | null };
  slots: Array<{ name: string; optional?: boolean }>;
  bindings: Record<string, SecretBinding>;
}): Promise<Record<string, string>> => {
  const { ctx, slots, bindings } = input;

  if (pool) {
    // DB-backed resolution: supports auto + pinned (user / org / global).
    if (!ctx.userId || !ctx.orgId) {
      const pinnedSlot = slots.find(s => (bindings[s.name] ?? { mode: "auto" }).mode === "pinned");
      if (pinnedSlot) {
        const err = new Error(
          `pinned binding for slot "${pinnedSlot.name}" requires userId/orgId context — ` +
          `was the flow started via api-server?`,
        ) as Error & { name: string; missing: string[] };
        err.name = "MissingSecretsError";
        err.missing = [pinnedSlot.name];
        throw err;
      }
    }
    const runCtx = {
      user: { id: ctx.userId ?? "", username: "" },
      org: { id: ctx.orgId ?? "", slug: "" },
      membershipId: "",
      role: "member" as const,
      isPlatformAdmin: false,
      tokenKind: "access-jwt" as const,
    };
    const result = await resolveBindings({ pool, ctx: runCtx, bindings, slots });
    return result.values;
  }

  // Env-only path (no DATABASE_URL): auto bindings from process.env only.
  const out: Record<string, string> = {};
  const missing: string[] = [];
  for (const slot of slots) {
    const b = bindings[slot.name] ?? { mode: "auto" as const };
    if (b.mode === "pinned") {
      const err = new Error(
        `cli-worker cannot resolve pinned binding for slot "${slot.name}" — ` +
        `set DATABASE_URL or run via api-server.`,
      ) as Error & { name: string; missing: string[] };
      err.name = "MissingSecretsError";
      err.missing = [slot.name];
      throw err;
    }
    const v = process.env[`JM_GLOBAL_${slot.name}`] ?? process.env[slot.name];
    if (v != null) { out[slot.name] = v; continue; }
    if (!slot.optional) missing.push(slot.name);
  }
  if (missing.length > 0) {
    const err = new Error(`Missing required secrets: ${missing.join(", ")}`) as Error & { name: string; missing: string[] };
    err.name = "MissingSecretsError";
    err.missing = missing;
    throw err;
  }
  return out;
};
```

---

## Task 6: Typecheck

- [ ] **Step 1: Run typecheck on the orchestrator package**

```bash
cd packages/orchestrator && npm run typecheck
```

Expected: `0 errors`. Fix any type errors before proceeding.

Common issues to watch for:
- `RunContext` import: `RunContext` is exported from `@journeyman/core` (from `packages/core/src/types/identity.types.ts`). If `resolveBindings` complains about the stub ctx not matching `RunContext`, import the type and cast: `runCtx as RunContext`.
- `Pool` import: `pg` is a CommonJS module; if `import pg from "pg"` doesn't resolve `Pool`, use `import { Pool } from "pg"` instead.

- [ ] **Step 2: Run typecheck on all packages**

```bash
npm run typecheck
```

Expected: `0 errors` across the workspace.
