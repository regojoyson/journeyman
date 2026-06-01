# Workers Reaper, Manual Cleanup & Logging Continuity Implementation Plan (Plan 6 of 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reap orphaned sandboxes (crashed runs that left containers behind), give operators a manual `list`/`prune` path (CLI + API), and harden logging continuity so provision/teardown surface in the run's log panel and SDK log `meta` survives the container hop.

**Architecture:** A `SandboxReaper` periodically lists `active` rows in `jm_sandbox_instances`, checks each against run status, and destroys + marks orphans (run terminal/missing) — plus label-scans Docker for containers with no tracking row. Manual cleanup is the same `destroy`/`mark` primitives behind a CLI (`journeyman-sandbox list|prune`) and admin API routes. Logging: the provisioner/reaper emit **workflow-level** events (`nodeId: null`) so "provisioning…", "image pulled", "sandbox destroyed" show in the panel; and the runner emits SDK logs as **NDJSON `{line, meta}`** on stderr so the harness can re-attach `meta` to `ctx.log`.

**Tech Stack:** TypeScript, `pg` (`Queryable` seam), Fastify, vitest. Builds on Plans 3–5.

**Depends on:** Plan 3 (`Queryable`, routes pattern), Plan 4 (`sandbox-store`, `DockerExecutionEnvironment`), Plan 5 (provisioner/reaper wiring, runner stderr→onLog).

**Out of scope:** Dockerfile auto-wrap (§8 separate); non-docker worker types (Plan 7).

---

## File Structure (Plan 6)

- `packages/workers/src/sandbox-reaper.ts` — **Create.** `SandboxReaper` (reapOnce + loop) over injected primitives.
- `packages/workers/src/sandbox-reaper.test.ts` — **Create.**
- `packages/workers/src/routes/sandboxes.ts` — **Create.** `registerSandboxRoutes` (list / prune / delete).
- `packages/workers/src/cli-sandbox.ts` — **Create.** `journeyman-sandbox` CLI (list / prune).
- `packages/workers/src/index.ts` — **Modify.** Export reaper + routes.
- `packages/workers/package.json` — **Modify.** Add the `journeyman-sandbox` bin.
- `packages/api-server/src/server.ts` — **Modify.** Register sandbox routes.
- `packages/api-server/src/composition.ts` — **Modify.** Start the reaper loop; emit provision/teardown log events.
- `packages/coding-cli/src/runner/cli.ts` — **Modify.** Emit SDK logs as NDJSON `{line, meta}` on stderr.
- `packages/orchestrator/src/workers/worker-harness.ts` — **Modify.** Parse runner NDJSON stderr → `ctx.log(line, meta)` (via the exec `onLog`).

---

## Task 1: `SandboxReaper`

**Files:**
- Create: `packages/workers/src/sandbox-reaper.ts`
- Test: `packages/workers/src/sandbox-reaper.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workers/src/sandbox-reaper.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { SandboxReaper } from "./sandbox-reaper.ts";
import type { SandboxRecord } from "./sandbox-store.ts";

function sb(runId: string): SandboxRecord {
  return { runId, type: "docker", handle: `c-${runId}`, volume: `v-${runId}`, imageRef: null, owner: null, status: "active" };
}

describe("SandboxReaper.reapOnce", () => {
  it("destroys + marks sandboxes whose run is no longer active", async () => {
    const destroyed: string[] = [];
    const marked: string[] = [];
    const reaper = new SandboxReaper({
      listActive: async () => [sb("a"), sb("b")],
      isRunActive: async (id) => id === "a",   // b's run is terminal/gone → orphan
      destroy: async (s) => { destroyed.push(s.runId); },
      markDestroyed: async (id) => { marked.push(id); },
    });
    const n = await reaper.reapOnce();
    expect(n).toBe(1);
    expect(destroyed).toEqual(["b"]);
    expect(marked).toEqual(["b"]);
  });

  it("keeps sandboxes whose run is still active", async () => {
    const destroyed: string[] = [];
    const reaper = new SandboxReaper({
      listActive: async () => [sb("a")],
      isRunActive: async () => true,
      destroy: async (s) => { destroyed.push(s.runId); },
      markDestroyed: async () => {},
    });
    expect(await reaper.reapOnce()).toBe(0);
    expect(destroyed).toEqual([]);
  });

  it("continues past a destroy error and still marks others", async () => {
    const marked: string[] = [];
    const reaper = new SandboxReaper({
      listActive: async () => [sb("a"), sb("b")],
      isRunActive: async () => false,
      destroy: async (s) => { if (s.runId === "a") throw new Error("docker down"); },
      markDestroyed: async (id) => { marked.push(id); },
    });
    const n = await reaper.reapOnce();
    expect(n).toBe(1);            // only b fully reaped
    expect(marked).toEqual(["b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/workers/src/sandbox-reaper.test.ts`
Expected: FAIL — cannot resolve `./sandbox-reaper.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/workers/src/sandbox-reaper.ts`:

```typescript
import type { SandboxRecord } from "./sandbox-store.ts";

export interface SandboxReaperDeps {
  /** Active tracked sandboxes. */
  listActive: () => Promise<SandboxRecord[]>;
  /** True while the run is still running/non-terminal. */
  isRunActive: (runId: string) => Promise<boolean>;
  /** Destroy the sandbox's container + volume. */
  destroy: (sb: SandboxRecord) => Promise<void>;
  /** Mark the tracking row destroyed. */
  markDestroyed: (runId: string) => Promise<void>;
  /** Optional logger. */
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

/** Reaps sandboxes whose run is terminal/gone but whose container was left behind. */
export class SandboxReaper {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private deps: SandboxReaperDeps) {}

  /** One sweep. Returns the number of sandboxes fully reaped. */
  async reapOnce(): Promise<number> {
    const active = await this.deps.listActive();
    let reaped = 0;
    for (const sb of active) {
      let stillActive: boolean;
      try {
        stillActive = await this.deps.isRunActive(sb.runId);
      } catch {
        continue; // can't determine — leave it for the next sweep
      }
      if (stillActive) continue;
      try {
        await this.deps.destroy(sb);
        await this.deps.markDestroyed(sb.runId);
        reaped += 1;
        this.deps.log?.(`reaped orphaned sandbox for run ${sb.runId}`, { runId: sb.runId });
      } catch (err) {
        this.deps.log?.(`failed to reap sandbox for run ${sb.runId}`, { runId: sb.runId, err: String(err) });
      }
    }
    return reaped;
  }

  /** Start a periodic reap loop. Returns a stop fn. */
  start(intervalMs = 60_000): () => void {
    if (this.timer) return () => this.stop();
    this.timer = setInterval(() => { void this.reapOnce(); }, intervalMs);
    if (typeof this.timer === "object" && "unref" in this.timer) (this.timer as { unref: () => void }).unref();
    return () => this.stop();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/workers/src/sandbox-reaper.test.ts`
Expected: PASS (3 tests).

---

## Task 2: Manual cleanup API routes

**Files:**
- Create: `packages/workers/src/routes/sandboxes.ts`
- Modify: `packages/api-server/src/server.ts`

- [ ] **Step 1: Create the routes**

Create `packages/workers/src/routes/sandboxes.ts`:

```typescript
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { makeRequireAuth } from "@journeyman/identity";
import { listActiveSandboxes, getSandbox, markSandboxDestroyed, type SandboxRecord } from "../sandbox-store.ts";

export interface SandboxRoutesDeps {
  /** Destroy a sandbox's container + volume (backend-specific). */
  destroy: (sb: SandboxRecord) => Promise<void>;
  /** True while a run is still active (to detect orphans). */
  isRunActive: (runId: string) => Promise<boolean>;
}

export async function registerSandboxRoutes(app: FastifyInstance, pool: Pool, deps: SandboxRoutesDeps): Promise<void> {
  const requireAuth = makeRequireAuth({ pool });

  // List active sandboxes (admin).
  app.get("/api/sandboxes", { preHandler: requireAuth({ role: "admin" }) }, async () => {
    return listActiveSandboxes(pool);
  });

  // Force-destroy one sandbox by runId (admin).
  app.delete("/api/sandboxes/:runId", { preHandler: requireAuth({ role: "admin" }) }, async (req, reply) => {
    const { runId } = req.params as { runId: string };
    const sb = await getSandbox(pool, runId);
    if (!sb || sb.status !== "active") return reply.code(404).send({ error: "Not found" });
    await deps.destroy(sb);
    await markSandboxDestroyed(pool, runId);
    return { ok: true };
  });

  // Prune all orphaned sandboxes (run no longer active) (admin).
  app.post("/api/sandboxes/prune", { preHandler: requireAuth({ role: "admin" }) }, async () => {
    const active = await listActiveSandboxes(pool);
    const pruned: string[] = [];
    for (const sb of active) {
      if (await deps.isRunActive(sb.runId)) continue;
      try {
        await deps.destroy(sb);
        await markSandboxDestroyed(pool, sb.runId);
        pruned.push(sb.runId);
      } catch { /* skip; next sweep retries */ }
    }
    return { pruned };
  });
}
```

- [ ] **Step 2: Register in api-server**

In `packages/api-server/src/server.ts`, add the import and (inside `if (c.pool) {`) the registration — passing a `destroy` built from `DockerExecutionEnvironment` and an `isRunActive` built from the workflow-instance store. Compose these in `composition.ts` (Task 4) and expose them on `Composition`; then:

```typescript
import { registerSandboxRoutes } from "@journeyman/workers";
// ...
    if (c.sandboxRoutesDeps) await registerSandboxRoutes(app, c.pool, c.sandboxRoutesDeps);
```

(Add `sandboxRoutesDeps?` to the `Composition` type in `composition.ts`, populated in Task 4.)

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w @journeyman/workers`
Expected: PASS. (api-server typecheck happens in Task 4 after `composition.ts`.)

---

## Task 3: `journeyman-sandbox` CLI

**Files:**
- Create: `packages/workers/src/cli-sandbox.ts`
- Modify: `packages/workers/package.json`

- [ ] **Step 1: Create the CLI**

Create `packages/workers/src/cli-sandbox.ts`:

```typescript
#!/usr/bin/env node
/**
 * journeyman-sandbox — operator cleanup for leftover run sandboxes.
 *   journeyman-sandbox list                 # show active tracked sandboxes
 *   journeyman-sandbox prune                # destroy all tracked sandboxes (use with care)
 *   journeyman-sandbox prune --run <runId>  # destroy one
 */
import { Pool } from "pg";
import { listActiveSandboxes, getSandbox, markSandboxDestroyed } from "./sandbox-store.ts";
import { DockerExecutionEnvironment } from "./backends/docker/docker-execution-environment.ts";
import { makeProcessCommandRunner } from "./backends/docker/docker-command-runner.ts";

const url = process.env.DATABASE_URL;
if (!url) { process.stderr.write("DATABASE_URL not set\n"); process.exit(1); }
const pool = new Pool({ connectionString: url });
const docker = makeProcessCommandRunner("docker");
const RUNNER_IMAGE = process.env.JOURNEYMAN_RUNNER_IMAGE ?? "journeyman/runner-base:dev";

async function destroy(sb: { runId: string; handle: string; volume: string | null }): Promise<void> {
  const env = new DockerExecutionEnvironment({ docker, defaultImage: RUNNER_IMAGE });
  await env.destroy({ runId: sb.runId, type: "docker", handle: sb.handle, volume: sb.volume ?? undefined, workspaceDir: "/workspace" });
  await markSandboxDestroyed(pool, sb.runId);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "list") {
    const rows = await listActiveSandboxes(pool);
    for (const r of rows) process.stdout.write(`${r.runId}\t${r.type}\t${r.handle}\t${r.volume ?? "-"}\n`);
    process.stdout.write(`${rows.length} active sandbox(es)\n`);
    return;
  }
  if (cmd === "prune") {
    const runFlagIdx = rest.indexOf("--run");
    if (runFlagIdx >= 0) {
      const runId = rest[runFlagIdx + 1];
      const sb = await getSandbox(pool, runId);
      if (!sb || sb.status !== "active") { process.stderr.write(`no active sandbox for ${runId}\n`); process.exit(1); }
      await destroy(sb);
      process.stdout.write(`pruned ${runId}\n`);
      return;
    }
    const rows = await listActiveSandboxes(pool);
    for (const r of rows) { await destroy(r); process.stdout.write(`pruned ${r.runId}\n`); }
    process.stdout.write(`pruned ${rows.length} sandbox(es)\n`);
    return;
  }
  process.stderr.write("usage: journeyman-sandbox <list|prune> [--run <runId>]\n");
  process.exit(1);
}

main().then(() => pool.end()).catch((err) => { process.stderr.write(`${String(err)}\n`); process.exit(1); });
```

- [ ] **Step 2: Add the bin to `packages/workers/package.json`**

Add a `"bin"` field (after `"exports"`):

```json
  "bin": { "journeyman-sandbox": "./src/cli-sandbox.ts" },
```

- [ ] **Step 3: Typecheck + reinstall the bin**

Run: `npm install && npm run typecheck -w @journeyman/workers`
Expected: PASS.

- [ ] **Step 4: Smoke (GATED — DB required)**

If a dev DB is up: `DATABASE_URL=... npx tsx packages/workers/src/cli-sandbox.ts list` → prints "0 active sandbox(es)" (or current rows). Else skip + note.

---

## Task 4: Wire reaper + sandbox-routes deps + provision/teardown log events

**Files:**
- Modify: `packages/api-server/src/composition.ts`

- [ ] **Step 1: Build a shared `destroy` + `isRunActive`, the reaper, and `sandboxRoutesDeps`**

In `composition.ts`, after the `sandboxProvisioner`/`sandboxReaper` from Plan 5, add (pool-gated):

```typescript
import { SandboxReaper, listActiveSandboxes, type SandboxRecord } from "@journeyman/workers";
import { isTerminalStatus } from "@journeyman/core";
// ...
const dockerDestroy = async (sb: SandboxRecord) => {
  const env = new DockerExecutionEnvironment({ docker: dockerCmd, defaultImage: RUNNER_IMAGE });
  await env.destroy({ runId: sb.runId, type: "docker", handle: sb.handle, volume: sb.volume ?? undefined, workspaceDir: "/workspace" });
};
const isRunActive = async (runId: string): Promise<boolean> => {
  const inst = await workflowInstances.get(runId).catch(() => null);
  return !!inst && !isTerminalStatus(inst.status);
};
const sandboxRoutesDeps = pool ? { destroy: dockerDestroy, isRunActive } : undefined;
```

Then start the reaper loop (only when a pool exists):

```typescript
if (pool) {
  const reaper = new SandboxReaper({
    listActive: () => listActiveSandboxes(pool!),
    isRunActive,
    destroy: dockerDestroy,
    markDestroyed: (id) => markSandboxDestroyed(pool!, id),
  });
  reaper.start(Number(process.env.SANDBOX_REAP_INTERVAL_MS ?? 60_000));
  // include reaper.stop() in composition.shutdown alongside the existing teardown.
}
```

Add `sandboxRoutesDeps` to the `Composition` type and object.

- [ ] **Step 2: Emit provision/teardown log events**

Wrap the Plan 5 `sandboxProvisioner` body so it emits **workflow-level** events (`nodeId: null`) via `events`:

```typescript
await events.append({ workflowInstanceId: a.workflowInstanceId, eventType: "step.log",
  payload: { line: `Provisioning ${worker.type} sandbox…` } });
// ...after provision...
await events.append({ workflowInstanceId: a.workflowInstanceId, eventType: "step.log",
  payload: { line: `Sandbox ready (image ${spec.imageRef})` } });
```

and in `sandboxReaper`/teardown:

```typescript
await events.append({ workflowInstanceId, eventType: "step.log", payload: { line: "Sandbox destroyed" } });
```

(Confirm `AppendEventArgs` accepts a null/omitted `nodeId`; the run-viewer treats `nodeId`-less events as workflow-level per §15.)

- [ ] **Step 3: Typecheck api-server**

Run: `npm run typecheck -w @journeyman/api-server`
Expected: PASS.

---

## Task 5: Logging continuity — NDJSON `{line, meta}` over stderr

**Files:**
- Modify: `packages/coding-cli/src/runner/cli.ts`
- Modify: `packages/orchestrator/src/workers/worker-harness.ts`

- [ ] **Step 1: Runner emits structured log lines**

In `packages/coding-cli/src/runner/cli.ts`, change the `onLog` passed to `runRunnerCli` to emit NDJSON so `meta` survives:

```typescript
  const out = await runRunnerCli(input, provider, (line, meta) =>
    process.stderr.write(JSON.stringify({ line, meta }) + "\n"));
```

(`runRunnerCli`'s `onLog` is already `CodingCliLogFn` = `(line, meta?) => void`; no signature change.)

- [ ] **Step 2: Harness parses runner stderr NDJSON back into `ctx.log`**

The exec `onLog` (wired in Plan 5 via `SandboxCodingProvider` → `op.onLog` → `DockerExecutionEnvironment` `onStderr`) currently forwards a raw stderr line. Make the handler's `onLog` (which is `ctx.log`) tolerant of both NDJSON and plain text. Add a small helper used where `op.onLog` is invoked — simplest: in `DockerExecutionEnvironment.exec`, parse each stderr line before calling `op.onLog`:

```typescript
      ...(op.onLog ? { onStderr: (line: string) => {
        try {
          const parsed = JSON.parse(line) as { line?: string; meta?: Record<string, unknown> };
          if (parsed && typeof parsed.line === "string") { op.onLog!(parsed.line, parsed.meta); return; }
        } catch { /* not NDJSON — forward raw */ }
        op.onLog!(line);
      } } : {}),
```

(This lives in `docker-execution-environment.ts`; update its test to assert NDJSON lines are parsed to `(line, meta)` and non-JSON lines pass through raw.)

- [ ] **Step 3: Update the docker env test + run**

Add to `packages/workers/src/backends/docker/docker-execution-environment.test.ts` a case where the fake docker runner invokes `onStderr` with an NDJSON line and asserts `op.onLog` receives the parsed `(line, meta)`. (Requires the fake runner to call `opts.onStderr`.)

Run: `npx vitest run packages/workers/src/backends/docker/docker-execution-environment.test.ts`
Expected: PASS.

---

## Task 6: Exports + full verification

**Files:**
- Modify: `packages/workers/src/index.ts`

- [ ] **Step 1: Export the new surface**

Append to `packages/workers/src/index.ts`:

```typescript
export { SandboxReaper } from "./sandbox-reaper.ts";
export type { SandboxReaperDeps } from "./sandbox-reaper.ts";
export { registerSandboxRoutes } from "./routes/sandboxes.ts";
export type { SandboxRoutesDeps } from "./routes/sandboxes.ts";
```

- [ ] **Step 2: Unit suites**

Run: `npm test -w @journeyman/workers && npm test -w @journeyman/coding-cli`
Expected: PASS (workers: +reaper 3 + docker-env NDJSON case; coding-cli unchanged count).

- [ ] **Step 3: Repo-wide checks**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 4: Gated checks (DB / Docker)**

- DB up: `journeyman-sandbox list` works; `POST /api/sandboxes/prune` returns `{pruned:[...]}`.
- Docker up: leave a labeled container with a `destroyed`/missing run, run `reapOnce()` (or wait for the loop), confirm it's removed. Else document as unverified.

---

## Self-Review

**Spec coverage (Plan 6 scope):**
- §10 background reaper (orphan detection + destroy + mark) → Task 1, wired Task 4.
- §10 manual cleanup (`list`/`prune` CLI + `GET`/`DELETE`/`prune` API) → Tasks 2–3.
- §15 logging continuity: provision/teardown as workflow-level events → Task 4 Step 2; SDK log `meta` preserved via NDJSON over stderr → Task 5.
- Deferred & noted: label-scan for fully-untracked containers (reaper currently sweeps DB-tracked rows; a `docker ps` label sweep via `env.list()` can be added to `reapOnce` later); Dockerfile auto-wrap (§8); other worker types (Plan 7).

**Placeholder scan:** No TBD/TODO. `SandboxReaper`, routes, and CLI have full code + tests where unit-testable. The composition wiring references real symbols from Plans 3–5. DB/Docker steps are explicitly gated.

**Type consistency:** `SandboxRecord` (Plan 4) flows through `SandboxReaper` (Task 1), routes (Task 2), CLI (Task 3), composition (Task 4). `SandboxReaperDeps` (`listActive`/`isRunActive`/`destroy`/`markDestroyed`) matches the composition wiring. `registerSandboxRoutes(app, pool, deps)` mirrors `registerWorkerRoutes`. The runner `onLog` stays `CodingCliLogFn`; the NDJSON envelope `{line, meta}` is produced in `cli.ts` (Task 5 Step 1) and parsed in `docker-execution-environment.ts` (Task 5 Step 2).
