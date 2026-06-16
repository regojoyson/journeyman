# Plan C — WindowsBackend + wiring + UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the orchestrator-side `machine-windows` backend that talks to the Plan B agent over mTLS gRPC, register it on the Plan A registry (run + teardown), surface it in the catalog with creation validation, and add the create/update UI form + a real connection test.

**Architecture:** `WindowsBackend` (in `@journeyman/sandbox`) builds a per-connection mTLS gRPC client (`makeWindowsAgentClient`) from `worker.config.connection` and returns a `WindowsExecutionEnvironment` that implements `IExecutionEnvironment` by calling the agent's RPCs — `provision`/`destroy`/`list` (unary), `exec` (server-streaming → relays logs to `op.onLog`, maps the final event to `ExecResult`), `materialize` (client-streaming tar). It registers via `createDefaultRegistry({ windows })` in both the worker (cli-worker) and teardown (composition) registries from Plan A. The catalog marks `machine-windows` available; `validateSandboxInput` rejects unsupported mode/connectivity combos. The UI adds a `MachineWindowsConfigForm` descriptor and the existing Test-connection button calls the agent's `Readiness`.

**Tech Stack:** TypeScript (Node 22, ESM, `.ts` imports), `@grpc/grpc-js`, `@journeyman/agent-protocol` (Plan B), Vitest, React (web).

**Reference spec:** [2026-06-12-windows-sandbox-design.md](../specs/2026-06-12-windows-sandbox-design.md) §3.1 (B, C), §3.2, §4, §4.1, findings 12, 16, 17, 18. **Depends on:** Plan A (registry) + Plan B (agent-protocol) — both merged.

---

## File Structure

**Modify (sandbox deps + types):**
- `packages/sandbox/package.json` — add `@journeyman/agent-protocol`, `@grpc/grpc-js`.
- `packages/sandbox/src/sandbox-instance-store.ts` — widen `connection` to `SandboxConnection` union.

**Create (sandbox/windows):**
- `packages/sandbox/src/backends/windows/windows-agent-client.ts` — `WindowsAgentConnection`, `AgentClient`, `makeWindowsAgentClient`.
- `packages/sandbox/src/backends/windows/windows-execution-environment.ts` — `IExecutionEnvironment` over the agent.
- `packages/sandbox/src/backends/windows/windows-backend.ts` — `ExecutionEnvironmentBackend`.
- `packages/sandbox/src/backends/windows/*.test.ts` + contract wiring.

**Modify (sandbox wiring):**
- `packages/sandbox/src/default-registry.ts` — `windows?: WindowsBackendDeps`.
- `packages/sandbox/src/sandbox-catalog.ts` — `machine-windows` → available.
- `packages/sandbox/src/sandbox-record.ts` — catalog-combo validation (finding 18).
- `packages/sandbox/src/test-connection.ts` — `machine-windows` → `Readiness`.
- `packages/sandbox/src/index.ts` — export the new symbols.

**Modify (orchestrator + api-server registries + routes):**
- `packages/orchestrator/src/cli-worker.ts` — add `windows` to the worker registry.
- `packages/api-server/src/composition.ts` — add `windows` to the teardown registry.
- `packages/sandbox/src/routes/index.ts` — pass `makeWindowsAgentClient` into the test-connection deps.

**Modify (web UI):**
- `packages/web/src/components/sandboxes/types/MachineWindowsConfigForm.tsx` (new) + `types/registry.ts` (one line).

---

## Task 1: sandbox deps + widen the connection type

**Files:**
- Modify: `packages/sandbox/package.json`, `packages/sandbox/src/sandbox-instance-store.ts`

- [ ] **Step 1: Add deps**

In `packages/sandbox/package.json` `dependencies`, add:

```json
    "@journeyman/agent-protocol": "*",
    "@grpc/grpc-js": "^1.12.0",
```

Run: `npm install`
Expected: links `@journeyman/agent-protocol`.

- [ ] **Step 2: Widen the persisted connection type**

In `packages/sandbox/src/sandbox-instance-store.ts`, replace the `DockerConnection` import + the `connection` field type with a union. At the top:

```typescript
import type { DockerConnection } from "./backends/docker/docker-client.ts";
import type { WindowsAgentConnection } from "./backends/windows/windows-agent-client.ts";

/** Any backend's persisted connection (so any process can rebuild its client). */
export type SandboxConnection = DockerConnection | WindowsAgentConnection;
```

Change the `connection` field on `SandboxInstanceRecord` and `RecordSandboxInstanceArgs` from `DockerConnection | null` to `SandboxConnection | null`, and the cast in `rowToSandboxInstance` from `as DockerConnection | null` to `as SandboxConnection | null`.

- [ ] **Step 3: Commit-point typecheck (after Task 2 defines `WindowsAgentConnection`)**

> This file now imports `WindowsAgentConnection` (created in Task 2). Defer `npm run typecheck -w @journeyman/sandbox` to the end of Task 2.

---

## Task 2: gRPC agent client (`windows-agent-client.ts`)

**Files:**
- Create: `packages/sandbox/src/backends/windows/windows-agent-client.ts`, `src/backends/windows/windows-agent-client.test.ts`

- [ ] **Step 1: Write the test** (error path needs no certs/network)

Create `packages/sandbox/src/backends/windows/windows-agent-client.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { makeWindowsAgentClient } from "./windows-agent-client.ts";

describe("makeWindowsAgentClient", () => {
  it("throws a clear error when certDir is missing/unreadable", () => {
    expect(() => makeWindowsAgentClient({ host: "h", port: 50051, certDir: "/nope" }))
      .toThrow(/cert/i);
  });

  it("requires host and port", () => {
    expect(() => makeWindowsAgentClient({ host: "", port: 0, certDir: "/nope" }))
      .toThrow(/host|port/i);
  });
});
```

- [ ] **Step 2: Run it (fails — module missing)**

Run: `npm test -w @journeyman/sandbox -- windows-agent-client`
Expected: FAIL.

- [ ] **Step 3: Implement**

Create `packages/sandbox/src/backends/windows/windows-agent-client.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as grpc from "@grpc/grpc-js";
import { agentServiceDef } from "@journeyman/agent-protocol";
import type {
  ProvisionRequest, ProvisionReply, ExecRequest, ExecEvent, FileChunk,
  MaterializeReply, DestroyRequest, DestroyReply, ListRequest, ListReply, ReadinessReply,
} from "@journeyman/agent-protocol";

export interface WindowsAgentConnection { host: string; port: number; certDir: string; }

/** Typed surface of the dynamically-built gRPC client. */
export interface AgentClient {
  Provision(req: ProvisionRequest, cb: (e: Error | null, r: ProvisionReply) => void): void;
  Destroy(req: DestroyRequest, cb: (e: Error | null, r: DestroyReply) => void): void;
  List(req: ListRequest, cb: (e: Error | null, r: ListReply) => void): void;
  Readiness(req: Record<string, never>, cb: (e: Error | null, r: ReadinessReply) => void): void;
  Exec(req: ExecRequest): grpc.ClientReadableStream<ExecEvent>;
  Materialize(cb: (e: Error | null, r: MaterializeReply) => void): grpc.ClientWritableStream<FileChunk>;
  close(): void;
}

/** Build a per-connection mTLS gRPC client for the Windows agent. */
export function makeWindowsAgentClient(conn: WindowsAgentConnection): AgentClient {
  if (!conn?.host || !conn?.port) {
    throw new Error("windows agent connection needs an explicit host and port");
  }
  let ca: Buffer, cert: Buffer, key: Buffer;
  try {
    ca = readFileSync(join(conn.certDir, "ca.pem"));
    cert = readFileSync(join(conn.certDir, "client.pem"));
    key = readFileSync(join(conn.certDir, "client-key.pem"));
  } catch (e) {
    throw new Error(`failed to read mTLS client certs from ${conn.certDir} (need ca.pem/client.pem/client-key.pem): ${(e as Error).message}`);
  }
  const creds = grpc.credentials.createSsl(ca, key, cert);
  const Svc = agentServiceDef();
  return new Svc(`${conn.host}:${conn.port}`, creds, {
    "grpc.keepalive_time_ms": 30_000,
    "grpc.keepalive_timeout_ms": 10_000,
    "grpc.keepalive_permit_without_calls": 1,
  }) as unknown as AgentClient;
}
```

- [ ] **Step 4: Run the test + typecheck (clears Task 1's deferred check)**

Run: `npm test -w @journeyman/sandbox -- windows-agent-client && npm run typecheck -w @journeyman/sandbox`
Expected: test PASS; typecheck PASS (the store's `WindowsAgentConnection` import now resolves).

- [ ] **Step 5: Commit**

```bash
git add packages/sandbox/src/backends/windows/windows-agent-client.ts packages/sandbox/src/backends/windows/windows-agent-client.test.ts packages/sandbox/src/sandbox-instance-store.ts packages/sandbox/package.json package-lock.json
git commit -m "feat(sandbox): mTLS gRPC client for the windows agent + widen connection type"
```

---

## Task 3: WindowsExecutionEnvironment (over the agent)

**Files:**
- Create: `packages/sandbox/src/backends/windows/windows-execution-environment.ts`, `src/backends/windows/windows-execution-environment.test.ts`

- [ ] **Step 1: Write the test** (fake `AgentClient`, plus the shared contract)

Create `packages/sandbox/src/backends/windows/windows-execution-environment.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { WindowsExecutionEnvironment } from "./windows-execution-environment.ts";
import { runExecutionEnvironmentContract } from "../contract.ts";
import type { AgentClient } from "./windows-agent-client.ts";

/** A fake agent client: Provision/Destroy/List/Readiness unary; Exec echoes {op}; Materialize accepts + ok. */
function fakeClient(): AgentClient {
  return {
    Provision: (req, cb) => cb(null, { handle: `win:${req.run_id}`, workspace_dir: `C:\\jm-runs\\${req.run_id}` }),
    Destroy: (_req, cb) => cb(null, { ok: true }),
    List: (_req, cb) => cb(null, { runs: [] }),
    Readiness: (_req, cb) => cb(null, { ready: true, checks: [] }),
    Exec: (req) => {
      const s = new EventEmitter() as EventEmitter & { cancel?: () => void };
      const op = JSON.parse(req.request_json).op;
      queueMicrotask(() => {
        s.emit("data", { log: { line: "starting", meta_json: "" } });
        s.emit("data", { final: { ok: true, structured_json: JSON.stringify({ op }), error: "" } });
        s.emit("end");
      });
      return s as never;
    },
    Materialize: (cb) => {
      const w = new EventEmitter() as EventEmitter & { write?: unknown; end?: unknown };
      (w as { write: (c: unknown) => boolean }).write = () => true;
      (w as { end: () => void }).end = () => queueMicrotask(() => cb(null, { ok: true }));
      return w as never;
    },
    close: () => {},
  } as AgentClient;
}

describe("WindowsExecutionEnvironment", () => {
  it("provision returns the agent handle + workspace dir", async () => {
    const env = new WindowsExecutionEnvironment({ client: fakeClient() });
    const p = await env.provision("r1", {});
    expect(p).toMatchObject({ runId: "r1", type: "machine-windows", handle: "win:r1", workspaceDir: "C:\\jm-runs\\r1" });
  });

  it("exec builds the runner request, relays logs, maps the final event", async () => {
    const env = new WindowsExecutionEnvironment({ client: fakeClient() });
    const p = await env.provision("r2", {});
    const logs: string[] = [];
    const r = await env.exec(p, { op: "custom-prompt", stdin: { x: 1 }, onLog: (l) => logs.push(l) });
    expect(r.ok).toBe(true);
    expect(r.structured).toEqual({ op: "custom-prompt" });
    expect(logs).toContain("starting");
  });
});

// Shared contract — fake client's Exec echoes {op}, matching the contract's expectation.
runExecutionEnvironmentContract("machine-windows", () => new WindowsExecutionEnvironment({ client: fakeClient() }));
```

- [ ] **Step 2: Run it (fails)**

Run: `npm test -w @journeyman/sandbox -- windows-execution-environment`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/sandbox/src/backends/windows/windows-execution-environment.ts`:

```typescript
import type {
  ExecOp, ExecResult, ExecutionEnvironmentSpec, FileBundle, IExecutionEnvironment, ProvisionedEnv, SandboxType,
} from "@journeyman/core";
import type { AgentClient } from "./windows-agent-client.ts";
import type { ExecEvent } from "@journeyman/agent-protocol";

export interface WindowsExecutionEnvironmentDeps { client: AgentClient; }

export class WindowsExecutionEnvironment implements IExecutionEnvironment {
  readonly type: SandboxType = "machine-windows";
  constructor(private deps: WindowsExecutionEnvironmentDeps) {}

  async provision(runId: string, _spec: ExecutionEnvironmentSpec): Promise<ProvisionedEnv> {
    const r = await new Promise<{ handle: string; workspace_dir: string }>((res, rej) =>
      this.deps.client.Provision({ run_id: runId }, (e, x) => (e ? rej(e) : res(x))));
    return { runId, type: "machine-windows", handle: r.handle, workspaceDir: r.workspace_dir };
  }

  async exec(env: ProvisionedEnv, op: ExecOp): Promise<ExecResult> {
    const request = JSON.stringify({
      op: op.op, provider: op.provider,
      opts: { ...((op.stdin as object) ?? {}), cwd: env.workspaceDir },
    });
    return new Promise<ExecResult>((resolve, reject) => {
      const stream = this.deps.client.Exec({ run_id: env.runId, request_json: request, env: op.env ?? {} });
      if (op.signal) op.signal.addEventListener("abort", () => stream.cancel(), { once: true });
      let final: ExecResult | undefined;
      stream.on("data", (ev: ExecEvent) => {
        if (ev.log && op.onLog) {
          const meta = ev.log.meta_json ? safeParse(ev.log.meta_json) : undefined;
          op.onLog(ev.log.line, meta);
        }
        if (ev.final) {
          final = {
            ok: ev.final.ok,
            ...(ev.final.structured_json ? { structured: safeParse(ev.final.structured_json) } : {}),
            ...(ev.final.error ? { error: ev.final.error } : {}),
          };
        }
      });
      stream.on("end", () => resolve(final ?? { ok: false, error: "agent produced no final event" }));
      stream.on("error", (e: Error) => reject(e));
    });
  }

  async destroy(env: ProvisionedEnv): Promise<void> {
    await new Promise<void>((res, rej) =>
      this.deps.client.Destroy({ run_id: env.runId }, (e) => (e ? rej(e) : res())));
  }

  async list(filter?: { runId?: string }): Promise<ProvisionedEnv[]> {
    const r = await new Promise<{ runs: Array<{ run_id: string; handle: string; workspace_dir: string }> }>((res, rej) =>
      this.deps.client.List({ run_id: filter?.runId ?? "" }, (e, x) => (e ? rej(e) : res(x))));
    return r.runs.map((run) => ({
      runId: run.run_id, type: "machine-windows" as SandboxType, handle: run.handle, workspaceDir: run.workspace_dir,
    }));
  }

  async materialize(env: ProvisionedEnv, destDir: string, bundle: FileBundle): Promise<void> {
    const tar = bundle.tar instanceof Buffer ? bundle.tar : await streamToBuffer(bundle.tar);
    await new Promise<void>((resolve, reject) => {
      const call = this.deps.client.Materialize((e) => (e ? reject(e) : resolve()));
      // Chunk to stay well under gRPC's default 4MB message cap.
      const CHUNK = 1024 * 1024;
      if (tar.length === 0) {
        call.write({ run_id: env.runId, dest_dir: destDir, tar: Buffer.alloc(0) });
      } else {
        for (let i = 0; i < tar.length; i += CHUNK) {
          call.write({ run_id: env.runId, dest_dir: destDir, tar: tar.subarray(i, i + CHUNK) });
        }
      }
      call.end();
    });
  }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
async function streamToBuffer(src: NodeJS.ReadableStream): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of src) parts.push(Buffer.from(c as Buffer));
  return Buffer.concat(parts);
}
```

- [ ] **Step 4: Run the test + contract**

Run: `npm test -w @journeyman/sandbox -- windows-execution-environment`
Expected: PASS — unit tests + the shared `IExecutionEnvironment contract: machine-windows` suite.

- [ ] **Step 5: Commit**

```bash
git add packages/sandbox/src/backends/windows/windows-execution-environment.ts packages/sandbox/src/backends/windows/windows-execution-environment.test.ts
git commit -m "feat(sandbox): WindowsExecutionEnvironment over the gRPC agent (passes contract)"
```

---

## Task 4: WindowsBackend

**Files:**
- Create: `packages/sandbox/src/backends/windows/windows-backend.ts`, `src/backends/windows/windows-backend.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/sandbox/src/backends/windows/windows-backend.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { WindowsBackend } from "./windows-backend.ts";
import type { AgentClient } from "./windows-agent-client.ts";
import type { ResolvedSandbox } from "@journeyman/core";

const worker: ResolvedSandbox = {
  id: "w1", type: "machine-windows", executionMode: "shared", connectivity: "agent",
  config: { connection: { host: "win-box", port: 50051, certDir: "/c" } },
};

describe("WindowsBackend", () => {
  it("declares machine-windows / shared / agent", () => {
    const b = new WindowsBackend({ makeClient: () => ({} as AgentClient) });
    expect(b.type).toBe("machine-windows");
    expect(b.supportedModes).toEqual(["shared"]);
    expect(b.supportedConnectivity).toEqual(["agent"]);
  });

  it("validateConfig requires connection host/port/certDir", () => {
    const b = new WindowsBackend({ makeClient: () => ({} as AgentClient) });
    expect(() => b.validateConfig({})).toThrow(/connection/i);
    expect(() => b.validateConfig({ connection: { host: "h", port: 1, certDir: "/c" } })).not.toThrow();
  });

  it("create builds the client from the worker connection", () => {
    const makeClient = vi.fn(() => ({} as AgentClient));
    const env = new WindowsBackend({ makeClient }).create(worker);
    expect(makeClient).toHaveBeenCalledWith({ host: "win-box", port: 50051, certDir: "/c" });
    expect(env.type).toBe("machine-windows");
  });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `npm test -w @journeyman/sandbox -- windows-backend`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/sandbox/src/backends/windows/windows-backend.ts`:

```typescript
import type {
  Connectivity, ExecutionEnvironmentBackend, ExecutionMode,
  IExecutionEnvironment, ResolvedSandbox, SandboxType,
} from "@journeyman/core";
import type { AgentClient, WindowsAgentConnection } from "./windows-agent-client.ts";
import { WindowsExecutionEnvironment } from "./windows-execution-environment.ts";

export interface WindowsBackendDeps {
  /** Build a per-connection mTLS gRPC client (per-process). */
  makeClient: (connection: WindowsAgentConnection) => AgentClient;
}

export class WindowsBackend implements ExecutionEnvironmentBackend {
  readonly type: SandboxType = "machine-windows";
  readonly supportedModes: ExecutionMode[] = ["shared"];
  readonly supportedConnectivity: Connectivity[] = ["agent"];

  constructor(private deps: WindowsBackendDeps) {}

  validateConfig(config: unknown): void {
    if (config == null || typeof config !== "object") throw new Error("machine-windows config must be an object");
    const c = (config as Record<string, unknown>)["connection"] as Partial<WindowsAgentConnection> | undefined;
    if (!c || typeof c.host !== "string" || !c.host.trim()) throw new Error("machine-windows config.connection.host is required");
    if (typeof c.port !== "number" || !c.port) throw new Error("machine-windows config.connection.port is required");
    if (typeof c.certDir !== "string" || !c.certDir.trim()) throw new Error("machine-windows config.connection.certDir is required");
  }

  create(worker: ResolvedSandbox): IExecutionEnvironment {
    this.validateConfig(worker.config);
    const conn = (worker.config as Record<string, unknown>)["connection"] as WindowsAgentConnection;
    return new WindowsExecutionEnvironment({ client: this.deps.makeClient(conn) });
  }
}
```

- [ ] **Step 4: Run + commit**

Run: `npm test -w @journeyman/sandbox -- windows-backend`
Expected: PASS.

```bash
git add packages/sandbox/src/backends/windows/windows-backend.ts packages/sandbox/src/backends/windows/windows-backend.test.ts
git commit -m "feat(sandbox): WindowsBackend (machine-windows, shared, agent)"
```

---

## Task 5: Registry option + catalog + exports

**Files:**
- Modify: `packages/sandbox/src/default-registry.ts`, `src/sandbox-catalog.ts`, `src/index.ts`

- [ ] **Step 1: default-registry — add `windows`**

In `packages/sandbox/src/default-registry.ts`, import + option + registration:

```typescript
import { WindowsBackend, type WindowsBackendDeps } from "./backends/windows/windows-backend.ts";
```

Add to `DefaultRegistryOptions`:

```typescript
  /** When provided, also register the machine-windows backend. */
  windows?: WindowsBackendDeps;
```

And in `createDefaultRegistry`, after the docker block:

```typescript
  if (opts.windows) registry.register(new WindowsBackend(opts.windows));
```

- [ ] **Step 2: catalog — mark available**

In `packages/sandbox/src/sandbox-catalog.ts`, replace the `machine-windows` entry:

```typescript
  { type: "machine-windows", label: "Windows machine (agent)", status: "available",
    supportedModes: ["shared"], supportedConnectivity: ["agent"],
    summary: "A persistent Windows box reached via an installed gRPC agent (mTLS). Runs native Windows builds/tests." },
```

- [ ] **Step 3: exports**

In `packages/sandbox/src/index.ts`, add:

```typescript
export { WindowsBackend } from "./backends/windows/windows-backend.ts";
export type { WindowsBackendDeps } from "./backends/windows/windows-backend.ts";
export { WindowsExecutionEnvironment } from "./backends/windows/windows-execution-environment.ts";
export { makeWindowsAgentClient } from "./backends/windows/windows-agent-client.ts";
export type { AgentClient, WindowsAgentConnection } from "./backends/windows/windows-agent-client.ts";
export type { SandboxConnection } from "./sandbox-instance-store.ts";
```

- [ ] **Step 4: Update the catalog drift test if present**

Run: `npm test -w @journeyman/sandbox -- sandbox-catalog`
If it fails because the registry it builds doesn't register windows, pass `windows: { makeClient: () => ({}) as never }` to its `createDefaultRegistry(...)` call so the catalog↔registry drift test sees `machine-windows`. Re-run until PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck -w @journeyman/sandbox`
Expected: PASS.

```bash
git add packages/sandbox/src/default-registry.ts packages/sandbox/src/sandbox-catalog.ts packages/sandbox/src/index.ts packages/sandbox/src/sandbox-catalog.test.ts
git commit -m "feat(sandbox): register machine-windows in the registry + mark available in catalog"
```

---

## Task 6: Creation validation — reject unsupported combos (finding 18)

**Files:**
- Modify: `packages/sandbox/src/sandbox-record.ts`
- Test: `packages/sandbox/src/sandbox-record.test.ts` (create or extend)

- [ ] **Step 1: Write the failing test**

Create/extend `packages/sandbox/src/sandbox-record.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateSandboxInput } from "./sandbox-record.ts";

describe("validateSandboxInput — catalog combos", () => {
  it("accepts machine-windows with shared + agent", () => {
    expect(() => validateSandboxInput({ name: "w", type: "machine-windows", executionMode: "shared", connectivity: "agent" })).not.toThrow();
  });

  it("rejects machine-windows with an unsupported mode/connectivity", () => {
    expect(() => validateSandboxInput({ name: "w", type: "machine-windows", executionMode: "per-instance", connectivity: "push" }))
      .toThrow(/machine-windows/i);
  });

  it("still accepts docker per-instance + push", () => {
    expect(() => validateSandboxInput({ name: "w", type: "docker", executionMode: "per-instance", connectivity: "push" })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it (fails — no combo check yet)**

Run: `npm test -w @journeyman/sandbox -- sandbox-record`
Expected: FAIL — the unsupported-combo case does not throw today.

- [ ] **Step 3: Implement the combo check**

In `packages/sandbox/src/sandbox-record.ts`, import the catalog and add the check at the end of `validateSandboxInput`:

```typescript
import { SANDBOX_CATALOG } from "./sandbox-catalog.ts";
```

```typescript
  // Reject (type, mode, connectivity) combinations the catalog doesn't support.
  const desc = SANDBOX_CATALOG.find((d) => d.type === input.type);
  if (desc) {
    if (!desc.supportedModes.includes(input.executionMode as ExecutionMode)) {
      throw new InvalidSandboxInputError(
        `${desc.type} does not support executionMode '${String(input.executionMode)}' (allowed: ${desc.supportedModes.join(", ")})`,
      );
    }
    const conn = input.connectivity;
    if (conn !== undefined && conn !== null && !desc.supportedConnectivity.includes(conn as Connectivity)) {
      throw new InvalidSandboxInputError(
        `${desc.type} does not support connectivity '${String(conn)}' (allowed: ${desc.supportedConnectivity.join(", ") || "none"})`,
      );
    }
  }
```

> `SandboxInputShape` already carries `type`/`executionMode`/`connectivity`. No signature change.

- [ ] **Step 4: Run + commit**

Run: `npm test -w @journeyman/sandbox -- sandbox-record`
Expected: PASS (and existing local/docker creation still validates — re-run the broader suite if unsure).

```bash
git add packages/sandbox/src/sandbox-record.ts packages/sandbox/src/sandbox-record.test.ts
git commit -m "feat(sandbox): validate sandbox mode/connectivity against the catalog (finding 18)"
```

---

## Task 7: Connection test — machine-windows → Readiness

**Files:**
- Modify: `packages/sandbox/src/test-connection.ts`, `packages/sandbox/src/routes/index.ts`
- Test: `packages/sandbox/src/test-connection.test.ts` (create or extend)

- [ ] **Step 1: Write the test**

Create/extend `packages/sandbox/src/test-connection.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { runWorkerConnectionTest } from "./test-connection.ts";
import type { AgentClient } from "./backends/windows/windows-agent-client.ts";

const dockerDeps = { makeDockerClient: () => ({ ping: async () => {} }) as never };

describe("runWorkerConnectionTest — machine-windows", () => {
  it("returns ok + readiness checks when the agent reports ready", async () => {
    const client = {
      Readiness: (_r: unknown, cb: (e: Error | null, r: unknown) => void) => cb(null, { ready: true, checks: [{ name: "bash", ok: true, detail: "" }] }),
      close: () => {},
    } as unknown as AgentClient;
    const r = await runWorkerConnectionTest(
      { type: "machine-windows", config: { connection: { host: "h", port: 1, certDir: "/c" } } },
      { ...dockerDeps, makeWindowsClient: () => client },
    );
    expect(r.ok).toBe(true);
  });

  it("returns not-ok with the failing check detail", async () => {
    const client = {
      Readiness: (_r: unknown, cb: (e: Error | null, r: unknown) => void) => cb(null, { ready: false, checks: [{ name: "bash", ok: false, detail: "not found — install Git for Windows" }] }),
      close: () => {},
    } as unknown as AgentClient;
    const r = await runWorkerConnectionTest(
      { type: "machine-windows", config: { connection: { host: "h", port: 1, certDir: "/c" } } },
      { ...dockerDeps, makeWindowsClient: () => client },
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Git for Windows/i);
  });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `npm test -w @journeyman/sandbox -- test-connection`
Expected: FAIL — `machine-windows` returns "No connection test".

- [ ] **Step 3: Implement**

In `packages/sandbox/src/test-connection.ts`, extend deps + add the branch:

```typescript
import type { AgentClient, WindowsAgentConnection } from "./backends/windows/windows-agent-client.ts";
import type { ReadinessReply } from "@journeyman/agent-protocol";

export interface RunWorkerConnectionTestDeps {
  makeDockerClient: (connection: DockerConnection) => IDockerClient;
  makeWindowsClient?: (connection: WindowsAgentConnection) => AgentClient;
}
```

Replace the early `if (input.type !== "docker")` block with:

```typescript
  if (input.type === "machine-windows") {
    if (!deps.makeWindowsClient) return { ok: false, error: "windows connection test not configured" };
    const conn = input.config.connection as WindowsAgentConnection | undefined;
    try {
      const client = deps.makeWindowsClient(conn as WindowsAgentConnection);
      const ready = await new Promise<ReadinessReply>((res, rej) =>
        client.Readiness({}, (e, r) => (e ? rej(e) : res(r))));
      client.close();
      if (ready.ready) return { ok: true };
      const failed = ready.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join("; ");
      return { ok: false, error: failed || "agent not ready" };
    } catch (err) {
      return { ok: false, error: (err as Error)?.message ?? "Connection failed" };
    }
  }
  if (input.type !== "docker") {
    return { ok: false, error: `No connection test for type '${input.type}'` };
  }
```

- [ ] **Step 4: Wire the route deps**

In `packages/sandbox/src/routes/index.ts`, find the `runWorkerConnectionTest(..., { makeDockerClient })` call and add `makeWindowsClient`:

```typescript
import { makeWindowsAgentClient } from "../backends/windows/windows-agent-client.ts";
// ...
return runWorkerConnectionTest(
  { type: body.type as never, config: body.config ?? {} },
  { makeDockerClient, makeWindowsClient: makeWindowsAgentClient },
);
```

- [ ] **Step 5: Run + commit**

Run: `npm test -w @journeyman/sandbox -- test-connection && npm run typecheck -w @journeyman/sandbox`
Expected: PASS.

```bash
git add packages/sandbox/src/test-connection.ts packages/sandbox/src/test-connection.test.ts packages/sandbox/src/routes/index.ts
git commit -m "feat(sandbox): machine-windows connection test calls the agent Readiness RPC"
```

---

## Task 8: Wire the windows backend into the worker + teardown registries

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts`, `packages/api-server/src/composition.ts`

- [ ] **Step 1: Worker registry (provision/exec)**

In `packages/orchestrator/src/cli-worker.ts`, import `makeWindowsAgentClient` from `@journeyman/sandbox` and add a `windows` block to the `createDefaultRegistry({...})` call:

```typescript
  windows: {
    makeClient: (connection) => makeWindowsAgentClient(connection),
  },
```

(Add `makeWindowsAgentClient` to the existing `@journeyman/sandbox` import.)

- [ ] **Step 2: Teardown registry**

In `packages/api-server/src/composition.ts`, add the same `windows` block to the `teardownRegistry`'s `createDefaultRegistry({...})` call, importing `makeWindowsAgentClient` from `@journeyman/sandbox`:

```typescript
    windows: { makeClient: (connection) => makeWindowsAgentClient(connection) },
```

- [ ] **Step 3: Typecheck both + commit**

Run: `npm run typecheck -w @journeyman/orchestrator && npm run typecheck -w @journeyman/api-server`
Expected: PASS.

```bash
git add packages/orchestrator/src/cli-worker.ts packages/api-server/src/composition.ts
git commit -m "feat: register machine-windows in worker + teardown registries"
```

---

## Task 9: UI — MachineWindowsConfigForm + registry

**Files:**
- Create: `packages/web/src/components/sandboxes/types/MachineWindowsConfigForm.tsx`
- Modify: `packages/web/src/components/sandboxes/types/registry.ts`

- [ ] **Step 1: Create the form descriptor**

Create `packages/web/src/components/sandboxes/types/MachineWindowsConfigForm.tsx`:

```tsx
import type { FC } from "react";
import { Server, Network, FolderKey, Hash } from "lucide-react";
import { inputCls } from "../../../routes/admin-styles.ts";
import { Field, Code } from "./form-controls.tsx";
import type { SandboxTypeForm } from "./LocalConfigForm.tsx";

interface WinState { host: string; port: string; certDir: string; workspaceRoot: string }

const MachineWindowsConfigForm: FC<{ state: Record<string, unknown>; onChange: (s: Record<string, unknown>) => void; editing: boolean }> =
  ({ state, onChange }) => {
    const s = state as unknown as WinState;
    const set = (patch: Partial<WinState>) => onChange({ ...s, ...patch } as unknown as Record<string, unknown>);
    return (
      <>
        <Field icon={Server} label="Agent host"
          hint={<>Hostname/IP of the Windows box running <Code>journeyman-agent</Code>. Must be reachable from the orchestrator.</>}>
          <input className={inputCls} placeholder="win-box.internal" value={s.host} onChange={(e) => set({ host: e.target.value })} />
        </Field>
        <Field icon={Network} label="Agent port" hint={<>The agent's gRPC port (default <Code>50051</Code>). Open it in the box's firewall.</>}>
          <input className={inputCls} placeholder="50051" value={s.port} onChange={(e) => set({ port: e.target.value })} />
        </Field>
        <Field icon={FolderKey} label="mTLS cert folder"
          hint={<>Folder on the orchestrator host with <Code>ca.pem</Code>, <Code>client.pem</Code>, <Code>client-key.pem</Code>.</>}>
          <input className={inputCls} placeholder="/etc/journeyman/win-certs" value={s.certDir} onChange={(e) => set({ certDir: e.target.value })} />
        </Field>
        <Field icon={Hash} label="Workspace root (optional)"
          hint={<>Where per-run folders are created on the box. Blank = <Code>C:\jm-runs</Code>.</>}>
          <input className={inputCls} placeholder="C:\jm-runs" value={s.workspaceRoot} onChange={(e) => set({ workspaceRoot: e.target.value })} />
        </Field>
        <p className="text-xs text-zinc-500 mt-1">
          Prerequisites on the box: Node 22, Git for Windows, the agent + runner, certs, an open firewall port.
          Supported AI providers: Claude and OpenCode (AISDK is not supported on Windows).
        </p>
      </>
    );
  };

export const machineWindowsTypeForm: SandboxTypeForm = {
  icon: Server,
  readConfig: (raw) => {
    const conn = (raw.connection ?? {}) as { host?: string; port?: number; certDir?: string };
    return {
      host: String(conn.host ?? ""), port: String(conn.port ?? "50051"),
      certDir: String(conn.certDir ?? ""), workspaceRoot: String((raw.workspaceRoot as string) ?? ""),
    };
  },
  buildConfig: (state) => {
    const s = state as unknown as WinState;
    return {
      connection: { host: s.host, port: Number(s.port) || 50051, certDir: s.certDir },
      ...(s.workspaceRoot ? { workspaceRoot: s.workspaceRoot } : {}),
    };
  },
  validate: (state) => {
    const s = state as unknown as WinState;
    if (!s.host?.trim()) return "Agent host is required";
    if (!s.certDir?.trim()) return "mTLS cert folder is required";
    if (!(Number(s.port) > 0)) return "Agent port must be a number";
    return null;
  },
  ConfigForm: MachineWindowsConfigForm,
  testConnection: true,
};
```

> Confirm the icon names exist in `lucide-react` (e.g. `Server`, `Network`, `FolderKey`, `Hash`). Swap any that don't resolve for ones that do (the import will fail the typecheck otherwise).

- [ ] **Step 2: Register it**

In `packages/web/src/components/sandboxes/types/registry.ts`:

```typescript
import { machineWindowsTypeForm } from "./MachineWindowsConfigForm.tsx";
// ...
export const sandboxTypeForms: Partial<Record<SandboxType, SandboxTypeForm>> = {
  local: localTypeForm,
  docker: dockerTypeForm,
  "machine-windows": machineWindowsTypeForm,
};
```

- [ ] **Step 3: Typecheck web + commit**

Run: `npm run typecheck -w @journeyman/web`
Expected: PASS.

```bash
git add packages/web/src/components/sandboxes/types/MachineWindowsConfigForm.tsx packages/web/src/components/sandboxes/types/registry.ts
git commit -m "feat(web): machine-windows sandbox form + connection test"
```

---

## Task 10: Verification pass

- [ ] **Step 1: Typecheck all**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Boundaries**

Run: `npm run check:boundaries`
Expected: PASS (sandbox→agent-protocol is backend→shared; sandbox already backend).

- [ ] **Step 3: Tests**

Run: `npm test`
Expected: PASS — no new failures; the `machine-windows` contract suite + new unit tests green.

- [ ] **Step 4: Manual sanity (optional)**

Start the api-server + worker, create a `machine-windows` sandbox in the UI pointing at a real (or Plan B loopback) agent, hit **Test connection** → expect the readiness result. Pin a workflow node to it and confirm a step routes to the box.

- [ ] **Step 5: Commit any cleanup**

```bash
git add -A && git commit -m "chore(sandbox): Plan C verification pass" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage:** `WindowsBackend`/`WindowsExecutionEnvironment` over the agent (§3.1 B/C) — Tasks 2-4; registry registration in worker + teardown (§3.2/§3.3) — Tasks 5, 8; catalog available + label/modes/connectivity — Task 5; creation validation of combos (finding 18) — Task 6; connection test → `Readiness` (§4.1) — Task 7; UI form + test-connection button (finding 12) — Task 9; AISDK-unsupported surfaced in the form copy (finding 16).
- **Type consistency:** `WindowsAgentConnection { host, port, certDir }`, `AgentClient` method surface, and `makeClient(connection)` are identical across client/env/backend/registry/test-connection.
- **Contract:** `WindowsExecutionEnvironment` passes the shared `runExecutionEnvironmentContract` (Task 3) using a fake client whose `Exec` echoes `{op}` — same bar as local/docker.
- **Out of scope (Plan D):** the AISDK *runtime* gate (`createCodingProvider` throwing on win32) — only documented in the form copy here; the workspace-guard Windows-path fix (#2); packaging the shippable Windows bundle (#15); the >10-min step-timeout verification (#13). The run-view "which sandbox did this step use" surfacing (finding 17) is a small follow-up, not blocking.
