# Workers Docker Backend Implementation Plan (Plan 4 of 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the **`docker` worker backend** (per-instance, push): a `DockerExecutionEnvironment` that provisions a per-run container + volume, `docker exec`s the runner, and tears down; a `sandbox_instances` tracking table + store; and registry wiring. Unit-tested with an injectable docker-command seam, plus a gated real-docker integration test.

**Architecture:** `DockerExecutionEnvironment` implements the Plan 1 `IExecutionEnvironment` by shelling out through an injected `DockerCommandRunner` (so unit tests fake the daemon). `provision` = `docker volume create` + `docker run -d --entrypoint sleep` (idle container, labeled `journeyman.runId`); `exec` = `docker exec -i` the Plan 2 runner, piping the `{op,opts}` request to stdin and parsing the `RunnerResponse` from stdout, streaming stderr to `onLog`; `destroy` = `docker rm -f` + `docker volume rm`; `list` = `docker ps -a --filter label`. A `jm_sandbox_instances` table records `runId → container/volume` so a separate process (the harness, Plan 5) and the reaper (Plan 6) can find them.

**Tech Stack:** TypeScript, `node:child_process`, `pg` (via the `Queryable` seam), vitest. Uses the `journeyman/runner-base` image from Plan 2.

**Depends on:** Plan 1 (`IExecutionEnvironment`/registry), Plan 2 (runner protocol + `runner-base` image), Plan 3 (`Queryable`, worker config shapes).

**Out of scope (Plan 5+):** harness run-start provisioning, `requiresWorkspace` step routing, teardown-on-terminal wiring, the reaper + manual cleanup CLI/API (Plan 6), Dockerfile build/auto-wrap (Plan 5/§8 — Plan 4 supports the **image-ref** path only; `dockerfile` config throws "not yet supported").

---

## File Structure (Plan 4)

- `packages/workers/src/backends/docker/docker-command-runner.ts` — **Create.** `DockerCommandRunner` type + real `spawn`-based impl.
- `packages/workers/src/backends/docker/docker-command-runner.test.ts` — **Create.**
- `packages/workers/src/backends/docker/docker-execution-environment.ts` — **Create.** The env.
- `packages/workers/src/backends/docker/docker-execution-environment.test.ts` — **Create.**
- `packages/workers/src/backends/docker/docker-backend.ts` — **Create.** `dockerSpecFromConfig` + `DockerBackend`.
- `packages/workers/src/backends/docker/docker-backend.test.ts` — **Create.**
- `packages/workers/src/backends/docker/docker-integration.test.ts` — **Create.** Gated real-docker test.
- `packages/migrations/src/sql/034_sandbox_instances.sql` — **Create.**
- `packages/workers/src/sandbox-store.ts` — **Create.** Tracking store.
- `packages/workers/src/sandbox-store.test.ts` — **Create.**
- `packages/workers/src/default-registry.ts` — **Modify.** Optional docker registration.
- `packages/workers/src/default-registry.test.ts` — **Modify.** Assert docker registers when configured.
- `packages/workers/src/index.ts` — **Modify.** Export the docker + sandbox surface.

---

## Task 1: Docker command runner (seam + real impl)

**Files:**
- Create: `packages/workers/src/backends/docker/docker-command-runner.ts`
- Test: `packages/workers/src/backends/docker/docker-command-runner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workers/src/backends/docker/docker-command-runner.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { makeProcessCommandRunner } from "./docker-command-runner.ts";

// Test the spawn wrapper against `node` instead of `docker` (no daemon needed).
const node = makeProcessCommandRunner("node");

describe("makeProcessCommandRunner", () => {
  it("captures stdout and exit code 0", async () => {
    const r = await node(["-e", "process.stdout.write('hi')"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toBe("hi");
  });

  it("pipes stdin to the process", async () => {
    const r = await node(["-e", "process.stdin.on('data', d => process.stdout.write(d))"], { stdin: "echoed" });
    expect(r.stdout).toBe("echoed");
  });

  it("captures stderr and a non-zero exit code", async () => {
    const r = await node(["-e", "process.stderr.write('boom'); process.exit(3)"]);
    expect(r.exitCode).toBe(3);
    expect(r.stderr).toContain("boom");
  });

  it("streams stderr lines to onStderr", async () => {
    const lines: string[] = [];
    await node(["-e", "process.stderr.write('a\\nb\\n')"], { onStderr: (l) => lines.push(l) });
    expect(lines).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/workers/src/backends/docker/docker-command-runner.test.ts`
Expected: FAIL — cannot resolve `./docker-command-runner.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/workers/src/backends/docker/docker-command-runner.ts`:

```typescript
import { spawn } from "node:child_process";

export interface DockerRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface DockerRunOptions {
  stdin?: string;
  signal?: AbortSignal;
  /** Called for each complete stderr line as it arrives. */
  onStderr?: (line: string) => void;
}

/** Runs a command (default the `docker` binary) and captures stdout/stderr/exit. */
export type DockerCommandRunner = (args: string[], opts?: DockerRunOptions) => Promise<DockerRunResult>;

export function makeProcessCommandRunner(binary = "docker"): DockerCommandRunner {
  return (args, opts = {}) =>
    new Promise<DockerRunResult>((resolve, reject) => {
      const child = spawn(binary, args, { signal: opts.signal });
      let stdout = "";
      let stderr = "";
      let stderrBuf = "";

      child.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
      child.stderr.on("data", (d: Buffer) => {
        const text = d.toString("utf8");
        stderr += text;
        if (opts.onStderr) {
          stderrBuf += text;
          const parts = stderrBuf.split("\n");
          stderrBuf = parts.pop() ?? "";
          for (const line of parts) opts.onStderr(line);
        }
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (opts.onStderr && stderrBuf.length) opts.onStderr(stderrBuf);
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });

      if (opts.stdin !== undefined) {
        child.stdin.write(opts.stdin);
        child.stdin.end();
      }
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/workers/src/backends/docker/docker-command-runner.test.ts`
Expected: PASS (4 tests).

---

## Task 2: DockerExecutionEnvironment

**Files:**
- Create: `packages/workers/src/backends/docker/docker-execution-environment.ts`
- Test: `packages/workers/src/backends/docker/docker-execution-environment.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workers/src/backends/docker/docker-execution-environment.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { DockerCommandRunner, DockerRunResult } from "./docker-command-runner.ts";
import { DockerExecutionEnvironment } from "./docker-execution-environment.ts";

function recorder(responses: Record<string, DockerRunResult>): {
  runner: DockerCommandRunner;
  calls: string[][];
  stdins: (string | undefined)[];
} {
  const calls: string[][] = [];
  const stdins: (string | undefined)[] = [];
  const runner: DockerCommandRunner = async (args, opts) => {
    calls.push(args);
    stdins.push(opts?.stdin);
    const key = args[0];
    return responses[key] ?? { stdout: "", stderr: "", exitCode: 0 };
  };
  return { runner, calls, stdins };
}

const okExec: DockerRunResult = {
  stdout: JSON.stringify({ ok: true, structured: { done: 1 } }),
  stderr: "",
  exitCode: 0,
};

describe("DockerExecutionEnvironment", () => {
  it("provision creates a labeled volume + idle container at /workspace", async () => {
    const { runner, calls } = recorder({ run: { stdout: "container123\n", stderr: "", exitCode: 0 } });
    const env = new DockerExecutionEnvironment({ docker: runner });
    const p = await env.provision("run-1", { imageRef: "img:1" });
    expect(p.type).toBe("docker");
    expect(p.workspaceDir).toBe("/workspace");
    expect(p.volume).toBe("jm-run-run-1");
    expect(p.handle).toBe("container123");
    const volumeCreate = calls.find((c) => c[0] === "volume");
    expect(volumeCreate).toEqual(["volume", "create", "jm-run-run-1"]);
    const run = calls.find((c) => c[0] === "run")!;
    expect(run).toContain("-d");
    expect(run).toContain("--label");
    expect(run).toContain("journeyman.runId=run-1");
    expect(run).toContain("-v");
    expect(run).toContain("jm-run-run-1:/workspace");
    expect(run).toContain("img:1");
  });

  it("exec pipes the {op,opts} request to the runner and parses the response", async () => {
    const { runner, calls, stdins } = recorder({ exec: okExec });
    const env = new DockerExecutionEnvironment({ docker: runner });
    const res = await env.exec(
      { runId: "run-1", type: "docker", handle: "c1", volume: "v1", workspaceDir: "/workspace" },
      { op: "custom-prompt", stdin: { prompt: "hi" }, env: { ANTHROPIC_API_KEY: "k" } },
    );
    expect(res).toEqual({ ok: true, structured: { done: 1 }, error: undefined });
    const exec = calls.find((c) => c[0] === "exec")!;
    expect(exec).toContain("c1");
    expect(exec).toContain("-i");
    expect(exec).toContain("-e");
    expect(exec).toContain("ANTHROPIC_API_KEY=k");
    expect(JSON.parse(stdins[0]!)).toEqual({ op: "custom-prompt", opts: { prompt: "hi" } });
  });

  it("exec returns an error result when the runner exits non-zero with no JSON", async () => {
    const { runner } = recorder({ exec: { stdout: "", stderr: "kaboom", exitCode: 1 } });
    const env = new DockerExecutionEnvironment({ docker: runner });
    const res = await env.exec(
      { runId: "r", type: "docker", handle: "c1", workspaceDir: "/workspace" },
      { op: "x", stdin: {} },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain("kaboom");
  });

  it("destroy removes the container and volume", async () => {
    const { runner, calls } = recorder({});
    const env = new DockerExecutionEnvironment({ docker: runner });
    await env.destroy({ runId: "r", type: "docker", handle: "c1", volume: "v1", workspaceDir: "/workspace" });
    expect(calls).toContainEqual(["rm", "-f", "c1"]);
    expect(calls).toContainEqual(["volume", "rm", "v1"]);
  });

  it("list parses runId-labeled containers", async () => {
    const { runner } = recorder({
      ps: { stdout: "c1 jm-run-a journeyman.runId=a\nc2 jm-run-b journeyman.runId=b\n", stderr: "", exitCode: 0 },
    });
    const env = new DockerExecutionEnvironment({ docker: runner });
    const list = await env.list();
    expect(list.map((e) => e.runId).sort()).toEqual(["a", "b"]);
    expect(list.map((e) => e.handle).sort()).toEqual(["c1", "c2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/workers/src/backends/docker/docker-execution-environment.test.ts`
Expected: FAIL — cannot resolve `./docker-execution-environment.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/workers/src/backends/docker/docker-execution-environment.ts`:

```typescript
import type {
  ExecOp, ExecResult, ExecutionEnvironmentSpec, IExecutionEnvironment, ProvisionedEnv, WorkerType,
} from "@journeyman/core";
import type { DockerCommandRunner } from "./docker-command-runner.ts";

export interface DockerExecutionEnvironmentDeps {
  docker: DockerCommandRunner;
  /** How to invoke the runner inside the container. */
  runnerCmd?: string[];
  /** Fallback image when a spec omits imageRef. */
  defaultImage?: string;
}

const DEFAULT_RUNNER_CMD = ["npx", "tsx", "packages/coding-cli/src/runner/cli.ts"];
const WORKSPACE = "/workspace";

export class DockerExecutionEnvironment implements IExecutionEnvironment {
  readonly type: WorkerType = "docker";

  constructor(private deps: DockerExecutionEnvironmentDeps) {}

  async provision(runId: string, spec: ExecutionEnvironmentSpec): Promise<ProvisionedEnv> {
    const volume = `jm-run-${runId}`;
    const image = spec.imageRef ?? this.deps.defaultImage;
    if (!image) throw new Error("docker provision requires an imageRef or defaultImage");

    await this.deps.docker(["volume", "create", volume]);

    const args = ["run", "-d", "--label", `journeyman.runId=${runId}`, "-v", `${volume}:${WORKSPACE}`];
    if (spec.resources?.cpus) args.push("--cpus", String(spec.resources.cpus));
    if (spec.resources?.memoryMb) args.push("--memory", `${spec.resources.memoryMb}m`);
    if (spec.network === "none") args.push("--network", "none");
    for (const [k, v] of Object.entries(spec.env ?? {})) args.push("-e", `${k}=${v}`);
    args.push("--entrypoint", "sleep", image, "infinity");

    const r = await this.deps.docker(args);
    if (r.exitCode !== 0) throw new Error(`docker run failed: ${r.stderr.trim()}`);
    const handle = r.stdout.trim();
    return { runId, type: "docker", handle, volume, workspaceDir: WORKSPACE };
  }

  async exec(env: ProvisionedEnv, op: ExecOp): Promise<ExecResult> {
    const request = JSON.stringify({ op: op.op, opts: { ...((op.stdin as object) ?? {}), cwd: WORKSPACE } });
    const args = ["exec", "-i", "-w", "/app"];
    for (const [k, v] of Object.entries(op.env ?? {})) args.push("-e", `${k}=${v}`);
    args.push(env.handle, ...(this.deps.runnerCmd ?? DEFAULT_RUNNER_CMD));

    const r = await this.deps.docker(args, {
      stdin: request,
      ...(op.signal ? { signal: op.signal } : {}),
      ...(op.onLog ? { onStderr: (line: string) => op.onLog!(line) } : {}),
    });

    const text = r.stdout.trim();
    if (text) {
      try {
        const parsed = JSON.parse(text) as ExecResult;
        return { ok: parsed.ok, structured: parsed.structured, error: parsed.error };
      } catch {
        // fall through to error handling
      }
    }
    return { ok: false, error: `runner produced no JSON (exit ${r.exitCode}): ${r.stderr.trim() || text}` };
  }

  async destroy(env: ProvisionedEnv): Promise<void> {
    await this.deps.docker(["rm", "-f", env.handle]).catch(() => undefined);
    if (env.volume) await this.deps.docker(["volume", "rm", env.volume]).catch(() => undefined);
  }

  async list(filter?: { runId?: string }): Promise<ProvisionedEnv[]> {
    const args = ["ps", "-a", "--filter", "label=journeyman.runId"];
    if (filter?.runId) args.push("--filter", `label=journeyman.runId=${filter.runId}`);
    args.push("--format", "{{.ID}} {{.Mounts}} {{.Label \"journeyman.runId\"}}");
    const r = await this.deps.docker(args);
    return r.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [handle, , label] = line.split(/\s+/);
        const runId = (label ?? "").replace(/^journeyman\.runId=/, "");
        return { runId, type: "docker" as WorkerType, handle, volume: `jm-run-${runId}`, workspaceDir: WORKSPACE };
      });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/workers/src/backends/docker/docker-execution-environment.test.ts`
Expected: PASS (5 tests).

---

## Task 3: dockerSpecFromConfig + DockerBackend

**Files:**
- Create: `packages/workers/src/backends/docker/docker-backend.ts`
- Test: `packages/workers/src/backends/docker/docker-backend.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workers/src/backends/docker/docker-backend.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { DockerCommandRunner } from "./docker-command-runner.ts";
import { DockerBackend, dockerSpecFromConfig } from "./docker-backend.ts";

const noopDocker: DockerCommandRunner = async () => ({ stdout: "", stderr: "", exitCode: 0 });
const deps = { docker: noopDocker, defaultImage: "journeyman/runner-base:dev" };

function worker(config: unknown) {
  return { id: "w1", type: "docker" as const, executionMode: "per-instance" as const, config };
}

describe("dockerSpecFromConfig", () => {
  it("maps an image-ref config to a spec", () => {
    const spec = dockerSpecFromConfig(
      { image: { kind: "ref", imageRef: "x:1" }, network: "none", resources: { cpus: 2 } },
      "default:img",
    );
    expect(spec.imageRef).toBe("x:1");
    expect(spec.network).toBe("none");
    expect(spec.resources).toEqual({ cpus: 2 });
  });

  it("falls back to the default image when none given", () => {
    const spec = dockerSpecFromConfig({}, "default:img");
    expect(spec.imageRef).toBe("default:img");
  });

  it("throws for a dockerfile image (not supported until Plan 5)", () => {
    expect(() => dockerSpecFromConfig({ image: { kind: "dockerfile", content: "FROM x" } }, "d"))
      .toThrow(/dockerfile/i);
  });
});

describe("DockerBackend", () => {
  it("declares docker / per-instance / push", () => {
    const b = new DockerBackend(deps);
    expect(b.type).toBe("docker");
    expect(b.supportedModes).toEqual(["per-instance"]);
    expect(b.supportedConnectivity).toEqual(["push"]);
  });

  it("validateConfig rejects a non-object", () => {
    const b = new DockerBackend(deps);
    expect(() => b.validateConfig("nope")).toThrow();
  });

  it("validateConfig rejects an unknown image kind", () => {
    const b = new DockerBackend(deps);
    expect(() => b.validateConfig({ image: { kind: "magic" } })).toThrow(/image/i);
  });

  it("create returns a DockerExecutionEnvironment", async () => {
    const b = new DockerBackend(deps);
    const env = b.create(worker({ image: { kind: "ref", imageRef: "x:1" } }));
    expect(env.type).toBe("docker");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/workers/src/backends/docker/docker-backend.test.ts`
Expected: FAIL — cannot resolve `./docker-backend.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/workers/src/backends/docker/docker-backend.ts`:

```typescript
import type {
  Connectivity, ExecutionEnvironmentBackend, ExecutionEnvironmentSpec, ExecutionMode,
  IExecutionEnvironment, ResolvedWorker, WorkerType,
} from "@journeyman/core";
import type { DockerCommandRunner } from "./docker-command-runner.ts";
import { DockerExecutionEnvironment } from "./docker-execution-environment.ts";

export interface DockerBackendDeps {
  docker: DockerCommandRunner;
  /** Default runner image (e.g. journeyman/runner-base:<version>). */
  defaultImage: string;
  runnerCmd?: string[];
}

/** Build an ExecutionEnvironmentSpec from a docker worker's config. */
export function dockerSpecFromConfig(
  config: Record<string, unknown>,
  defaultImage: string,
): ExecutionEnvironmentSpec {
  const image = config.image as { kind?: string; imageRef?: string; content?: string } | undefined;
  if (image?.kind === "dockerfile") {
    throw new Error("docker worker: dockerfile images are not supported yet (Plan 5)");
  }
  const network = config.network === "none" ? "none" : "full";
  const resources = (config.resources as ExecutionEnvironmentSpec["resources"]) ?? undefined;
  const env = (config.env as Record<string, string>) ?? undefined;
  return {
    imageRef: image?.kind === "ref" && image.imageRef ? image.imageRef : defaultImage,
    network,
    ...(resources ? { resources } : {}),
    ...(env ? { env } : {}),
  };
}

export class DockerBackend implements ExecutionEnvironmentBackend {
  readonly type: WorkerType = "docker";
  readonly supportedModes: ExecutionMode[] = ["per-instance"];
  readonly supportedConnectivity: Connectivity[] = ["push"];

  constructor(private deps: DockerBackendDeps) {}

  validateConfig(config: unknown): void {
    if (config == null) return;
    if (typeof config !== "object") throw new Error("docker worker config must be an object");
    const c = config as Record<string, unknown>;
    if (c.image !== undefined) {
      const image = c.image as { kind?: string };
      if (image.kind !== "ref" && image.kind !== "dockerfile") {
        throw new Error("docker worker config.image.kind must be 'ref' or 'dockerfile'");
      }
    }
    if (c.network !== undefined && c.network !== "full" && c.network !== "none") {
      throw new Error("docker worker config.network must be 'full' or 'none'");
    }
  }

  create(worker: ResolvedWorker): IExecutionEnvironment {
    this.validateConfig(worker.config);
    return new DockerExecutionEnvironment({
      docker: this.deps.docker,
      defaultImage: this.deps.defaultImage,
      ...(this.deps.runnerCmd ? { runnerCmd: this.deps.runnerCmd } : {}),
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/workers/src/backends/docker/docker-backend.test.ts`
Expected: PASS (7 tests).

---

## Task 4: `sandbox_instances` table + tracking store

**Files:**
- Create: `packages/migrations/src/sql/034_sandbox_instances.sql`
- Create: `packages/workers/src/sandbox-store.ts`
- Test: `packages/workers/src/sandbox-store.test.ts`

- [ ] **Step 1: Create the migration**

Create `packages/migrations/src/sql/034_sandbox_instances.sql`:

```sql
CREATE TABLE IF NOT EXISTS jm_sandbox_instances (
  run_id       UUID PRIMARY KEY,
  type         TEXT NOT NULL,
  handle       TEXT NOT NULL,
  volume       TEXT,
  image_ref    TEXT,
  owner        TEXT,
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','destroyed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  destroyed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_jm_sandbox_instances_status ON jm_sandbox_instances (status);
```

- [ ] **Step 2: Write the failing test**

Create `packages/workers/src/sandbox-store.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { Queryable } from "./db.ts";
import { recordSandbox, getSandbox, markSandboxDestroyed, listActiveSandboxes } from "./sandbox-store.ts";

function fakeDb(rows: any[] = []): Queryable & { calls: Array<{ text: string; params?: unknown[] }> } {
  const calls: Array<{ text: string; params?: unknown[] }> = [];
  return {
    calls,
    async query(text: string, params?: unknown[]) {
      calls.push({ text, params });
      return { rows };
    },
  };
}

describe("sandbox-store", () => {
  it("recordSandbox upserts the active row", async () => {
    const db = fakeDb();
    await recordSandbox(db, { runId: "r1", type: "docker", handle: "c1", volume: "v1", imageRef: "x:1", owner: "o1" });
    expect(db.calls[0].text).toMatch(/insert into jm_sandbox_instances/i);
    expect(db.calls[0].params).toEqual(["r1", "docker", "c1", "v1", "x:1", "o1"]);
  });

  it("getSandbox returns the row by runId or null", async () => {
    const found = fakeDb([{ run_id: "r1", type: "docker", handle: "c1", volume: "v1", status: "active" }]);
    expect((await getSandbox(found, "r1"))?.handle).toBe("c1");
    const none = fakeDb([]);
    expect(await getSandbox(none, "r1")).toBeNull();
  });

  it("markSandboxDestroyed sets status + destroyed_at", async () => {
    const db = fakeDb();
    await markSandboxDestroyed(db, "r1");
    expect(db.calls[0].text).toMatch(/update jm_sandbox_instances/i);
    expect(db.calls[0].text).toMatch(/status = 'destroyed'/i);
    expect(db.calls[0].params).toEqual(["r1"]);
  });

  it("listActiveSandboxes filters status = active", async () => {
    const db = fakeDb([]);
    await listActiveSandboxes(db);
    expect(db.calls[0].text).toMatch(/where status = 'active'/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/workers/src/sandbox-store.test.ts`
Expected: FAIL — cannot resolve `./sandbox-store.ts`.

- [ ] **Step 4: Write the implementation**

Create `packages/workers/src/sandbox-store.ts`:

```typescript
import type { Queryable } from "./db.ts";

export interface SandboxRecord {
  runId: string;
  type: string;
  handle: string;
  volume: string | null;
  imageRef: string | null;
  owner: string | null;
  status: "active" | "destroyed";
}

export interface RecordSandboxArgs {
  runId: string;
  type: string;
  handle: string;
  volume?: string | null;
  imageRef?: string | null;
  owner?: string | null;
}

function rowToSandbox(r: Record<string, any>): SandboxRecord {
  return {
    runId: r.run_id,
    type: r.type,
    handle: r.handle,
    volume: r.volume ?? null,
    imageRef: r.image_ref ?? null,
    owner: r.owner ?? null,
    status: r.status,
  };
}

export async function recordSandbox(db: Queryable, args: RecordSandboxArgs): Promise<void> {
  await db.query(
    `INSERT INTO jm_sandbox_instances (run_id, type, handle, volume, image_ref, owner)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (run_id) DO UPDATE SET
       type = EXCLUDED.type, handle = EXCLUDED.handle, volume = EXCLUDED.volume,
       image_ref = EXCLUDED.image_ref, owner = EXCLUDED.owner, status = 'active'`,
    [args.runId, args.type, args.handle, args.volume ?? null, args.imageRef ?? null, args.owner ?? null],
  );
}

export async function getSandbox(db: Queryable, runId: string): Promise<SandboxRecord | null> {
  const { rows } = await db.query(
    `SELECT run_id, type, handle, volume, image_ref, owner, status FROM jm_sandbox_instances WHERE run_id = $1`,
    [runId],
  );
  return rows[0] ? rowToSandbox(rows[0]) : null;
}

export async function markSandboxDestroyed(db: Queryable, runId: string): Promise<void> {
  await db.query(
    `UPDATE jm_sandbox_instances SET status = 'destroyed', destroyed_at = now() WHERE run_id = $1`,
    [runId],
  );
}

export async function listActiveSandboxes(db: Queryable): Promise<SandboxRecord[]> {
  const { rows } = await db.query(
    `SELECT run_id, type, handle, volume, image_ref, owner, status FROM jm_sandbox_instances WHERE status = 'active'`,
  );
  return rows.map(rowToSandbox);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/workers/src/sandbox-store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Apply the migration (GATED — Postgres required)**

If a dev DB is up: Run `npm run migrate` — expect `034_sandbox_instances` applied. Else skip + note.

---

## Task 5: Registry wiring + exports

**Files:**
- Modify: `packages/workers/src/default-registry.ts`
- Modify: `packages/workers/src/default-registry.test.ts`
- Modify: `packages/workers/src/index.ts`

- [ ] **Step 1: Extend the failing test**

Replace `packages/workers/src/default-registry.test.ts` with:

```typescript
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import type { OperationRunner } from "@journeyman/core";
import type { DockerCommandRunner } from "./backends/docker/docker-command-runner.ts";
import { createDefaultRegistry } from "./default-registry.ts";

const runOperation: OperationRunner = async () => ({ ok: true });
const docker: DockerCommandRunner = async () => ({ stdout: "", stderr: "", exitCode: 0 });

describe("createDefaultRegistry", () => {
  it("always registers the local backend", () => {
    const r = createDefaultRegistry({ runOperation, defaultBaseDir: tmpdir() });
    expect(r.available()).toContain("local");
    expect(r.available()).not.toContain("docker");
  });

  it("registers docker when docker config is provided", () => {
    const r = createDefaultRegistry({
      runOperation,
      defaultBaseDir: tmpdir(),
      docker: { docker, defaultImage: "journeyman/runner-base:dev" },
    });
    expect(r.available()).toContain("local");
    expect(r.available()).toContain("docker");
    expect(r.get("docker").type).toBe("docker");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/workers/src/default-registry.test.ts`
Expected: FAIL — `docker` option not supported / not registered.

- [ ] **Step 3: Update `default-registry.ts`**

Replace `packages/workers/src/default-registry.ts` with:

```typescript
import type { OperationRunner } from "@journeyman/core";
import { InMemoryExecutionEnvironmentRegistry } from "./registry/in-memory-execution-environment-registry.ts";
import { LocalBackend } from "./backends/local/local-backend.ts";
import { DockerBackend, type DockerBackendDeps } from "./backends/docker/docker-backend.ts";

export interface DefaultRegistryOptions {
  runOperation: OperationRunner;
  defaultBaseDir: string;
  /** When provided, also register the docker backend. */
  docker?: DockerBackendDeps;
}

/** Build a registry with the always-available `local` backend (+ `docker` when configured). */
export function createDefaultRegistry(
  opts: DefaultRegistryOptions,
): InMemoryExecutionEnvironmentRegistry {
  const registry = new InMemoryExecutionEnvironmentRegistry();
  registry.register(
    new LocalBackend({ runOperation: opts.runOperation, defaultBaseDir: opts.defaultBaseDir }),
  );
  if (opts.docker) {
    registry.register(new DockerBackend(opts.docker));
  }
  return registry;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/workers/src/default-registry.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Export the docker + sandbox surface**

Append to `packages/workers/src/index.ts`:

```typescript
export { makeProcessCommandRunner } from "./backends/docker/docker-command-runner.ts";
export type { DockerCommandRunner, DockerRunResult, DockerRunOptions } from "./backends/docker/docker-command-runner.ts";
export { DockerExecutionEnvironment } from "./backends/docker/docker-execution-environment.ts";
export type { DockerExecutionEnvironmentDeps } from "./backends/docker/docker-execution-environment.ts";
export { DockerBackend, dockerSpecFromConfig } from "./backends/docker/docker-backend.ts";
export type { DockerBackendDeps } from "./backends/docker/docker-backend.ts";
export {
  recordSandbox, getSandbox, markSandboxDestroyed, listActiveSandboxes,
} from "./sandbox-store.ts";
export type { SandboxRecord, RecordSandboxArgs } from "./sandbox-store.ts";
```

---

## Task 6: Gated real-docker integration test

**Files:**
- Create: `packages/workers/src/backends/docker/docker-integration.test.ts`

This exercises the full real path (provision → exec → destroy) against the `journeyman/runner-base:dev` image from Plan 2, using the **unknown-op** response so it needs **no API key**. It is skipped unless `JM_DOCKER_IT=1`.

- [ ] **Step 1: Write the integration test**

Create `packages/workers/src/backends/docker/docker-integration.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { makeProcessCommandRunner } from "./docker-command-runner.ts";
import { DockerExecutionEnvironment } from "./docker-execution-environment.ts";

const RUN_IT = process.env.JM_DOCKER_IT === "1";
const IMAGE = process.env.JM_RUNNER_IMAGE ?? "journeyman/runner-base:dev";

describe.skipIf(!RUN_IT)("DockerExecutionEnvironment (real docker)", () => {
  it("provisions, execs the runner (unknown op), and destroys", async () => {
    const env = new DockerExecutionEnvironment({ docker: makeProcessCommandRunner("docker"), defaultImage: IMAGE });
    const runId = `it-${Date.now()}`;
    const p = await env.provision(runId, { imageRef: IMAGE });
    try {
      expect(p.handle.length).toBeGreaterThan(0);
      const res = await env.exec(p, { op: "definitely-not-a-real-op", stdin: {} });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/unknown op/);
    } finally {
      await env.destroy(p);
    }
  }, 120_000);
});
```

- [ ] **Step 2: Run (GATED — Docker + the runner image required)**

If Docker is available and `journeyman/runner-base:dev` exists (built in Plan 2):
Run: `JM_DOCKER_IT=1 npx vitest run packages/workers/src/backends/docker/docker-integration.test.ts`
Expected: PASS (1 test) — provision/exec/destroy against a real container.

If not: the test is skipped by default (`describe.skipIf`); note it as not exercised here.

---

## Task 7: Full verification

**Files:** none.

- [ ] **Step 1: Workers unit suite**

Run: `npm test -w @journeyman/workers`
Expected: PASS — Plan 1–3 suites (33) + docker-command-runner (4) + docker-execution-environment (5) + docker-backend (7) + sandbox-store (4) + default-registry (now 2) = 54 tests (the docker integration test is skipped without `JM_DOCKER_IT=1`).

- [ ] **Step 2: Typecheck workers**

Run: `npm run typecheck -w @journeyman/workers`
Expected: PASS.

- [ ] **Step 3: Repo-wide checks**

Run: `npm run check`
Expected: PASS (boundaries: workers still imports only `core`/`identity` + `pg`/`fastify` + node builtins).

---

## Self-Review

**Spec coverage (Plan 4 scope):**
- §3.1/§4 docker as a registered backend type → Tasks 3, 5.
- §5/§6 provision (idle container + named volume + label) / exec (runner over `docker exec`, stdin request → stdout response, stderr→onLog) / destroy / list → Task 2.
- §8 image-ref path; dockerfile path explicitly deferred (throws) → Task 3 (`dockerSpecFromConfig`).
- §10/§11 resource limits (`--cpus`/`--memory`) + network (`--network none`) + per-exec secret env (`-e`) → Task 2.
- §10 sandbox tracking table + store (for the harness/reaper to find containers) → Task 4.
- Deferred & noted: harness run-start provisioning + `requiresWorkspace` routing + teardown-on-terminal → Plan 5; reaper + manual cleanup → Plan 6; Dockerfile build/auto-wrap → Plan 5.

**Placeholder scan:** No TBD/TODO; every code step is complete with commands + expected output. The real-docker test (Task 6) and the migration apply (Task 4 Step 6) are explicitly gated with documented fallbacks (env flag / DB presence) — not silent skips.

**Type consistency:** `DockerCommandRunner`/`DockerRunResult`/`DockerRunOptions` (Task 1) are used by the env (Task 2), backend (Task 3), registry (Task 5), and integration test (Task 6). `DockerExecutionEnvironment` implements `IExecutionEnvironment` (Plan 1) — `provision(runId, spec)`/`exec(env, op)`/`destroy(env)`/`list(filter)` signatures + `ProvisionedEnv` shape (`runId`/`type`/`handle`/`volume`/`workspaceDir`) match. `dockerSpecFromConfig` returns `ExecutionEnvironmentSpec` (Plan 1). The `Queryable` seam (Plan 3) is reused by `sandbox-store.ts`. `createDefaultRegistry`'s new `docker?: DockerBackendDeps` option matches `DockerBackend`'s constructor.
