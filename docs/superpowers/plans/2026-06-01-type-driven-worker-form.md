# Type-Driven Worker Create/Edit Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the worker create/edit form so each worker type owns its config sub-form behind a uniform descriptor, the Type dropdown is driven by an authoritative capability catalog (all types listed; unbuilt ones disabled), and Docker gains a "Test connection" action.

**Architecture:** A static capability catalog in `@journeyman/workers` (drift-tested against registered backends) is served by `GET /workers/types`. A pure `runWorkerConnectionTest` function backs `POST /workers/test-connection`. The frontend gains a per-type form registry (`WorkerType → WorkerTypeForm`); `WorkerFormModal` becomes a thin shell that delegates per-type config to the selected descriptor.

**Tech Stack:** TypeScript, Fastify (routes in `@journeyman/workers`), `pg`, dockerode, React, Vite, lucide-react, vitest (backend only).

**Spec:** [docs/superpowers/specs/2026-06-01-type-driven-worker-form-design.md](../specs/2026-06-01-type-driven-worker-form-design.md)

**Deviation from spec §6:** The spec called for `readConfig`/`buildConfig` round-trip *unit* tests and a modal render test. The `@journeyman/web` package currently has **no test runner** (no vitest/testing-library, zero `*.test.tsx`), and standing one up is out of proportion to this refactor. Those two frontend checks are therefore covered by `tsc` + the Vite dev-transform check (Task 10) and the manual round-trip smoke (Task 11, Step 4: "edit reopens with the same config"). The high-value backend tests (catalog drift, connection-test logic) are full TDD via the existing vitest in `@journeyman/workers`. If web test infra is added later, port the round-trip checks to pure-function unit tests.

---

## File Structure

**Backend (`@journeyman/workers`)**
- Create: `packages/workers/src/worker-type-catalog.ts` — `WorkerTypeDescriptor`, `WORKER_TYPE_CATALOG`.
- Create: `packages/workers/src/worker-type-catalog.test.ts` — drift test.
- Create: `packages/workers/src/test-connection.ts` — `runWorkerConnectionTest` pure function.
- Create: `packages/workers/src/test-connection.test.ts` — unit tests.
- Modify: `packages/workers/src/backends/docker/docker-client.ts` — add `ping()` to `IDockerClient` + `DockerodeClient`.
- Modify: `packages/workers/src/routes/index.ts` — add `GET …/workers/types`, `POST …/workers/test-connection`.
- Modify: `packages/workers/src/index.ts` — export the catalog + types.

**Frontend (`@journeyman/web`)**
- Modify: `packages/web/src/api/workers.ts` — `WorkerTypeDescriptor`, `getWorkerTypes`, `testWorkerConnection`.
- Create: `packages/web/src/components/workers/types/form-controls.tsx` — shared `Field` / `CheckField` / `Code`.
- Create: `packages/web/src/components/workers/types/LocalConfigForm.tsx` — local config + descriptor.
- Create: `packages/web/src/components/workers/types/DockerConfigForm.tsx` — docker config + descriptor.
- Create: `packages/web/src/components/workers/types/registry.ts` — `workerTypeForms`.
- Modify: `packages/web/src/components/workers/WorkerFormModal.tsx` — thin shell.

---

## Task 1: Worker-type capability catalog

**Files:**
- Create: `packages/workers/src/worker-type-catalog.ts`
- Modify: `packages/workers/src/index.ts`
- Test: `packages/workers/src/worker-type-catalog.test.ts`

- [ ] **Step 1: Write the catalog**

Create `packages/workers/src/worker-type-catalog.ts`:

```ts
import type { WorkerType, ExecutionMode, Connectivity } from "@journeyman/core";

export interface WorkerTypeDescriptor {
  type: WorkerType;
  label: string;
  status: "available" | "planned";
  supportedModes: ExecutionMode[];
  supportedConnectivity: Connectivity[];
  summary: string;
}

/**
 * Authoritative metadata for every worker type. `status: "available"` means a
 * backend exists in code (see default-registry). The drift test keeps this in
 * sync with the registered backends. Modes/connectivity for planned types come
 * from the managed-compute-targets design (§4 matrix).
 */
export const WORKER_TYPE_CATALOG: WorkerTypeDescriptor[] = [
  { type: "local", label: "Local (no isolation)", status: "available",
    supportedModes: ["shared"], supportedConnectivity: [],
    summary: "Runs in-process on the host with a shared workspace. No isolation." },
  { type: "docker", label: "Docker (per-instance)", status: "available",
    supportedModes: ["per-instance"], supportedConnectivity: ["push"],
    summary: "Each run gets its own throwaway container and volume." },
  { type: "machine-linux", label: "Linux machine (SSH)", status: "planned",
    supportedModes: ["shared", "per-instance"], supportedConnectivity: ["push", "agent"],
    summary: "A Linux host reached over SSH (push) or via an installed agent." },
  { type: "machine-windows", label: "Windows machine (SSH)", status: "planned",
    supportedModes: ["shared", "per-instance"], supportedConnectivity: ["push", "agent"],
    summary: "A Windows host reached over SSH (push) or via an installed agent." },
  { type: "ecs", label: "AWS ECS", status: "planned",
    supportedModes: ["per-instance"], supportedConnectivity: ["push", "agent"],
    summary: "One ECS task per run via the AWS API." },
  { type: "ec2", label: "AWS EC2", status: "planned",
    supportedModes: ["shared", "per-instance"], supportedConnectivity: ["push", "agent"],
    summary: "An EC2 instance reached over SSH/API." },
  { type: "kubernetes", label: "Kubernetes", status: "planned",
    supportedModes: ["per-instance"], supportedConnectivity: ["push", "agent"],
    summary: "One pod per run via the cluster API." },
  { type: "cloud", label: "Cloud", status: "planned",
    supportedModes: ["per-instance"], supportedConnectivity: ["push", "agent"],
    summary: "A managed cloud runner via its API." },
];
```

- [ ] **Step 2: Export from the package**

In `packages/workers/src/index.ts`, add after the `createDefaultRegistry` export block:

```ts
export { WORKER_TYPE_CATALOG } from "./worker-type-catalog.ts";
export type { WorkerTypeDescriptor } from "./worker-type-catalog.ts";
```

- [ ] **Step 3: Write the failing drift test**

Create `packages/workers/src/worker-type-catalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import type { OperationRunner } from "@journeyman/core";
import type { IDockerClient } from "./backends/docker/docker-client.ts";
import { createDefaultRegistry } from "./default-registry.ts";
import { WORKER_TYPE_CATALOG } from "./worker-type-catalog.ts";

const runOperation: OperationRunner = async () => ({ ok: true });
const client = {} as IDockerClient;

describe("WORKER_TYPE_CATALOG", () => {
  it("has a unique entry per type", () => {
    const types = WORKER_TYPE_CATALOG.map((d) => d.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it("matches every registered backend (no drift)", () => {
    const registry = createDefaultRegistry({
      runOperation, defaultBaseDir: tmpdir(),
      docker: { client, defaultImage: "journeyman/runner-base:dev" },
    });
    for (const type of registry.available()) {
      const backend = registry.get(type);
      const entry = WORKER_TYPE_CATALOG.find((d) => d.type === type);
      expect(entry, `catalog missing entry for '${type}'`).toBeDefined();
      expect(entry!.status).toBe("available");
      expect([...entry!.supportedModes].sort()).toEqual([...backend.supportedModes].sort());
      expect([...entry!.supportedConnectivity].sort()).toEqual([...backend.supportedConnectivity].sort());
    }
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npm test --workspace=packages/workers -- worker-type-catalog`
Expected: PASS (catalog already matches `local` shared/[] and `docker` per-instance/[push]).

- [ ] **Step 5: Commit**

```bash
git add packages/workers/src/worker-type-catalog.ts packages/workers/src/worker-type-catalog.test.ts packages/workers/src/index.ts
git commit -m "feat(workers): add worker-type capability catalog + drift test"
```

---

## Task 2: Add `ping()` to the Docker client

**Files:**
- Modify: `packages/workers/src/backends/docker/docker-client.ts`

- [ ] **Step 1: Add `ping` to the interface**

In `packages/workers/src/backends/docker/docker-client.ts`, add to `interface IDockerClient` (after `createVolume`):

```ts
  /** Round-trip the daemon; throws if unreachable. */
  ping(): Promise<void>;
```

- [ ] **Step 2: Implement it on `DockerodeClient`**

In the same file, add this method to `class DockerodeClient` (after the constructor, before `createVolume`):

```ts
  async ping(): Promise<void> {
    await this.docker.ping();
  }
```

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit -p packages/workers/tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/workers/src/backends/docker/docker-client.ts
git commit -m "feat(workers): expose ping() on the Docker client"
```

---

## Task 3: `runWorkerConnectionTest` pure function

**Files:**
- Create: `packages/workers/src/test-connection.ts`
- Test: `packages/workers/src/test-connection.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/workers/src/test-connection.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { IDockerClient } from "./backends/docker/docker-client.ts";
import { runWorkerConnectionTest } from "./test-connection.ts";

function fakeClient(pingImpl: () => Promise<void>): IDockerClient {
  return { ping: pingImpl } as unknown as IDockerClient;
}

describe("runWorkerConnectionTest", () => {
  it("returns ok when the docker daemon pings", async () => {
    const res = await runWorkerConnectionTest(
      { type: "docker", config: { connection: { kind: "local" } } },
      { makeDockerClient: () => fakeClient(async () => {}) },
    );
    expect(res).toEqual({ ok: true });
  });

  it("returns the error when the docker daemon is unreachable", async () => {
    const res = await runWorkerConnectionTest(
      { type: "docker", config: { connection: { kind: "local", socketPath: "/nope.sock" } } },
      { makeDockerClient: () => fakeClient(async () => { throw new Error("connect ENOENT /nope.sock"); }) },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain("ENOENT");
  });

  it("rejects types without a backend", async () => {
    const res = await runWorkerConnectionTest(
      { type: "ecs", config: {} },
      { makeDockerClient: () => fakeClient(async () => {}) },
    );
    expect(res).toEqual({ ok: false, error: "No connection test for type 'ecs'" });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test --workspace=packages/workers -- test-connection`
Expected: FAIL — cannot find module `./test-connection.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/workers/src/test-connection.ts`:

```ts
import type { WorkerType } from "@journeyman/core";
import type { IDockerClient, DockerConnection } from "./backends/docker/docker-client.ts";

export interface ConnectionTestResult { ok: boolean; error?: string }

export interface RunWorkerConnectionTestDeps {
  makeDockerClient: (connection?: DockerConnection) => IDockerClient;
}

/** Validate that a worker's connection config can reach its target. Docker only for now. */
export async function runWorkerConnectionTest(
  input: { type: WorkerType; config: Record<string, unknown> },
  deps: RunWorkerConnectionTestDeps,
): Promise<ConnectionTestResult> {
  if (input.type !== "docker") {
    return { ok: false, error: `No connection test for type '${input.type}'` };
  }
  const connection = (input.config.connection as DockerConnection | undefined) ?? { kind: "local" };
  try {
    await deps.makeDockerClient(connection).ping();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? "Connection failed" };
  }
}
```

- [ ] **Step 4: Run the test**

Run: `npm test --workspace=packages/workers -- test-connection`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/workers/src/test-connection.ts packages/workers/src/test-connection.test.ts
git commit -m "feat(workers): add runWorkerConnectionTest pure function"
```

---

## Task 4: Routes — `/workers/types` and `/workers/test-connection`

**Files:**
- Modify: `packages/workers/src/routes/index.ts`

- [ ] **Step 1: Add imports**

In `packages/workers/src/routes/index.ts`, extend the existing import block and add new imports:

```ts
import {
  insertWorker, listWorkers, getWorker, updateWorker, deleteWorker, listVisibleWorkers,
} from "../db.ts";
import { validateWorkerInput, InvalidWorkerInputError } from "../worker-record.ts";
import { WORKER_TYPE_CATALOG } from "../worker-type-catalog.ts";
import { runWorkerConnectionTest } from "../test-connection.ts";
import { makeDockerClient } from "../backends/docker/docker-client.ts";
```

- [ ] **Step 2: Register the two routes**

In `packages/workers/src/routes/index.ts`, immediately after the existing `/workers/visible` route handler block, add:

```ts
  // ---- Capability catalog (all types; unbuilt ones flagged "planned") ----
  app.get("/api/orgs/:orgId/workers/types", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    return WORKER_TYPE_CATALOG;
  });

  // ---- Test connection for a candidate {type, config} ----
  app.post("/api/orgs/:orgId/workers/test-connection", { preHandler: requireAuth() }, async (req, reply) => {
    const { orgId } = req.params as { orgId: string };
    if (req.runContext!.org.id !== orgId) return reply.code(403).send({ error: "Wrong org" });
    const body = req.body as { type?: string; config?: Record<string, unknown> };
    if (!body?.type) return reply.code(400).send({ error: "type is required" });
    return runWorkerConnectionTest(
      { type: body.type as never, config: body.config ?? {} },
      { makeDockerClient },
    );
  });
```

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit -p packages/workers/tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Verify the whole workers suite still passes**

Run: `npm test --workspace=packages/workers`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add packages/workers/src/routes/index.ts
git commit -m "feat(workers): add /workers/types and /workers/test-connection routes"
```

---

## Task 5: Web API client methods

**Files:**
- Modify: `packages/web/src/api/workers.ts`

- [ ] **Step 1: Add the descriptor type**

In `packages/web/src/api/workers.ts`, after the `WorkerScope` type declaration, add:

```ts
export interface WorkerTypeDescriptor {
  type: WorkerType;
  label: string;
  status: "available" | "planned";
  supportedModes: ExecutionMode[];
  supportedConnectivity: Connectivity[];
  summary: string;
}

export interface ConnectionTestResult { ok: boolean; error?: string }
```

- [ ] **Step 2: Add the two client methods**

In the `workersApi` object in `packages/web/src/api/workers.ts`, add after `listVisible`:

```ts
  listTypes: (orgId: string) =>
    fetch(`${orgBase(orgId)}/types`, { credentials: "include" }).then(jsonOrThrow<WorkerTypeDescriptor[]>),
  testConnection: (orgId: string, body: { type: WorkerType; config: Record<string, unknown> }) =>
    postJson(`${orgBase(orgId)}/test-connection`, body).then(jsonOrThrow<ConnectionTestResult>),
```

- [ ] **Step 3: Verify it typechecks**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/api/workers.ts
git commit -m "feat(web): worker types + test-connection API client methods"
```

---

## Task 6: Shared form controls

**Files:**
- Create: `packages/web/src/components/workers/types/form-controls.tsx`

- [ ] **Step 1: Create the shared controls**

These are lifted verbatim from the helpers already in `WorkerFormModal.tsx` so the look is unchanged. Create `packages/web/src/components/workers/types/form-controls.tsx`:

```tsx
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { codePill } from "../../../routes/admin-styles.ts";

/** Inline code/example chip. */
export function Code({ children }: { children: ReactNode }) {
  return <code className={codePill}>{children}</code>;
}

/** Labeled field: icon + label on top, control, then a muted hint line. */
export function Field({ icon: Icon, label, hint, children }: {
  icon: LucideIcon; label: string; hint?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-sm font-medium text-slate-200">
        <Icon size={14} className="text-indigo-400 shrink-0" aria-hidden />
        {label}
      </div>
      {children}
      {hint && <p className="text-xs leading-relaxed text-slate-500">{hint}</p>}
    </div>
  );
}

/** Checkbox row with an icon, label, and hint underneath. */
export function CheckField({ icon: Icon, label, hint, checked, onChange }: {
  icon: LucideIcon; label: string; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <Icon size={14} className="text-indigo-400 shrink-0" aria-hidden />
        {label}
      </label>
      {hint && <p className="ml-6 text-xs leading-relaxed text-slate-500">{hint}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/workers/types/form-controls.tsx
git commit -m "refactor(web): extract shared worker form controls"
```

---

## Task 7: Local config form + descriptor

**Files:**
- Create: `packages/web/src/components/workers/types/LocalConfigForm.tsx`

- [ ] **Step 1: Define the shared descriptor interface and the local form**

Create `packages/web/src/components/workers/types/LocalConfigForm.tsx`:

```tsx
import type { FC } from "react";
import { FolderOpen, Archive, type LucideIcon } from "lucide-react";
import { inputCls } from "../../../routes/admin-styles.ts";
import { Field, CheckField } from "./form-controls.tsx";

export interface WorkerTypeForm {
  icon: LucideIcon;
  readConfig: (raw: Record<string, unknown>) => Record<string, unknown>;
  buildConfig: (state: Record<string, unknown>) => Record<string, unknown>;
  validate?: (state: Record<string, unknown>) => string | null;
  ConfigForm: FC<{ state: Record<string, unknown>; onChange: (s: Record<string, unknown>) => void; editing: boolean }>;
  testConnection?: boolean;
}

interface LocalState { baseDir: string; retainWorkspace: boolean }

const LocalConfigForm: FC<{ state: Record<string, unknown>; onChange: (s: Record<string, unknown>) => void; editing: boolean }> =
  ({ state, onChange }) => {
    const s = state as unknown as LocalState;
    const set = (patch: Partial<LocalState>) => onChange({ ...s, ...patch } as unknown as Record<string, unknown>);
    return (
      <>
        <Field icon={FolderOpen} label="Base folder"
          hint={<>Parent directory where each run's workspace is created. Blank = system temp dir.</>}>
          <input className={inputCls} placeholder="(optional — defaults to a temp dir)" value={s.baseDir}
            onChange={(e) => set({ baseDir: e.target.value })} />
        </Field>
        <CheckField icon={Archive} label="Keep workspace folder after the run"
          hint={<>Leaves the cloned repo and edits on disk for debugging. Off = cleaned up when the run ends.</>}
          checked={s.retainWorkspace} onChange={(v) => set({ retainWorkspace: v })} />
      </>
    );
  };

export const localTypeForm: WorkerTypeForm = {
  icon: FolderOpen,
  readConfig: (raw) => ({
    baseDir: String((raw.baseDir as string) ?? ""),
    retainWorkspace: Boolean(raw.retainWorkspace),
  }),
  buildConfig: (state) => {
    const s = state as unknown as LocalState;
    return { ...(s.baseDir ? { baseDir: s.baseDir } : {}), ...(s.retainWorkspace ? { retainWorkspace: true } : {}) };
  },
  ConfigForm: LocalConfigForm,
};
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/workers/types/LocalConfigForm.tsx
git commit -m "refactor(web): extract local worker config form + descriptor"
```

---

## Task 8: Docker config form + descriptor

**Files:**
- Create: `packages/web/src/components/workers/types/DockerConfigForm.tsx`

- [ ] **Step 1: Create the docker form**

Create `packages/web/src/components/workers/types/DockerConfigForm.tsx`. This lifts the docker block (and all icon/hint content) from the current modal and adds `readConfig`/`buildConfig` reproducing today's exact config shape:

```tsx
import type { FC } from "react";
import { Plug, Terminal, Globe, Box, FileText, Network } from "lucide-react";
import { inputCls, selectCls } from "../../../routes/admin-styles.ts";
import { Field, Code } from "./form-controls.tsx";
import type { WorkerTypeForm } from "./LocalConfigForm.tsx";

type ConnKind = "local" | "remote";
type ImageKind = "ref" | "dockerfile";

interface DockerState {
  connKind: ConnKind; host: string; socketPath: string;
  imageKind: ImageKind; imageRef: string; dockerfile: string;
  network: "full" | "none";
}

const DockerConfigForm: FC<{ state: Record<string, unknown>; onChange: (s: Record<string, unknown>) => void; editing: boolean }> =
  ({ state, onChange }) => {
    const s = state as unknown as DockerState;
    const set = (patch: Partial<DockerState>) => onChange({ ...s, ...patch } as unknown as Record<string, unknown>);
    return (
      <>
        <Field icon={Plug} label="Connection"
          hint={s.connKind === "local"
            ? <>Talk to the Docker daemon on this machine via its Unix socket.</>
            : <>Connect to a remote Docker daemon over TCP (optionally TLS).</>}>
          <select className={`${selectCls} block mt-1 w-full`} value={s.connKind}
            onChange={(e) => set({ connKind: e.target.value as ConnKind })}>
            <option value="local">Local socket</option>
            <option value="remote">Remote daemon</option>
          </select>
        </Field>
        {s.connKind === "local" && (
          <Field icon={Terminal} label="Socket path"
            hint={<>Blank = host default / <Code>DOCKER_HOST</Code>. Rancher Desktop: <Code>~/.rd/docker.sock</Code> ·
              Colima: <Code>~/.colima/default/docker.sock</Code>. The <Code>unix://</Code> prefix is optional.</>}>
            <input className={inputCls} placeholder="/Users/you/.rd/docker.sock" value={s.socketPath}
              onChange={(e) => set({ socketPath: e.target.value })} />
          </Field>
        )}
        {s.connKind === "remote" && (
          <Field icon={Globe} label="Daemon host"
            hint={<>Address of the remote daemon, e.g. <Code>tcp://build-host:2376</Code>.</>}>
            <input className={inputCls} placeholder="tcp://build-host:2376" value={s.host}
              onChange={(e) => set({ host: e.target.value })} />
          </Field>
        )}
        <Field icon={Box} label="Image source"
          hint={s.imageKind === "ref"
            ? <>Pull a ready-made runner image from a registry.</>
            : <>Build from a Dockerfile snippet (cached on first run; the runner bundle is auto-added).</>}>
          <select className={`${selectCls} block mt-1 w-full`} value={s.imageKind}
            onChange={(e) => set({ imageKind: e.target.value as ImageKind })}>
            <option value="ref">Prebuilt image ref</option>
            <option value="dockerfile">Dockerfile</option>
          </select>
        </Field>
        {s.imageKind === "ref" ? (
          <Field icon={Box} label="Image reference"
            hint={<>e.g. <Code>node:22-bookworm</Code>, <Code>python:3.12-slim</Code>, or <Code>myorg/jm-runner:java21</Code>.</>}>
            <input className={inputCls} placeholder="myorg/jm-runner:java21" value={s.imageRef}
              onChange={(e) => set({ imageRef: e.target.value })} />
          </Field>
        ) : (
          <Field icon={FileText} label="Dockerfile"
            hint={<>Standard Dockerfile. Start from a base with your toolchain, e.g. <Code>FROM node:22-bookworm</Code>.</>}>
            <textarea className={inputCls} rows={6} placeholder={"FROM debian:stable-slim\nRUN apt-get update && apt-get install -y python3"}
              value={s.dockerfile} onChange={(e) => set({ dockerfile: e.target.value })} />
          </Field>
        )}
        <Field icon={Network} label="Network"
          hint={s.network === "full"
            ? <>Container can reach the internet — needed for <Code>git clone</Code>, <Code>npm install</Code>, API calls.</>
            : <>No network at all. Use for untrusted code or fully offline runs.</>}>
          <select className={`${selectCls} block mt-1 w-full`} value={s.network}
            onChange={(e) => set({ network: e.target.value as "full" | "none" })}>
            <option value="full">Full (internet)</option>
            <option value="none">None (offline)</option>
          </select>
        </Field>
      </>
    );
  };

export const dockerTypeForm: WorkerTypeForm = {
  icon: Box,
  testConnection: true,
  readConfig: (raw) => {
    const connection = (raw.connection ?? { kind: "local" }) as { kind?: ConnKind; host?: string; socketPath?: string };
    const image = (raw.image ?? { kind: "ref", imageRef: "" }) as { kind?: ImageKind; imageRef?: string; content?: string };
    return {
      connKind: (connection.kind ?? "local"),
      host: connection.host ?? "",
      socketPath: connection.socketPath ?? "",
      imageKind: (image.kind ?? "ref"),
      imageRef: image.imageRef ?? "",
      dockerfile: image.content ?? "",
      network: (raw.network ?? "full"),
    };
  },
  buildConfig: (state) => {
    const s = state as unknown as DockerState;
    return {
      connection: s.connKind === "remote"
        ? { kind: "remote", host: s.host }
        : { kind: "local", ...(s.socketPath ? { socketPath: s.socketPath } : {}) },
      image: s.imageKind === "ref" ? { kind: "ref", imageRef: s.imageRef } : { kind: "dockerfile", content: s.dockerfile },
      network: s.network,
    };
  },
  ConfigForm: DockerConfigForm,
};
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/workers/types/DockerConfigForm.tsx
git commit -m "refactor(web): extract docker worker config form + descriptor"
```

---

## Task 9: Per-type form registry

**Files:**
- Create: `packages/web/src/components/workers/types/registry.ts`

- [ ] **Step 1: Create the registry**

Create `packages/web/src/components/workers/types/registry.ts`:

```ts
import type { WorkerType } from "../../../api/workers.ts";
import type { WorkerTypeForm } from "./LocalConfigForm.tsx";
import { localTypeForm } from "./LocalConfigForm.tsx";
import { dockerTypeForm } from "./DockerConfigForm.tsx";

/** Drop-in point: add a new type's form descriptor here when its backend ships. */
export const workerTypeForms: Partial<Record<WorkerType, WorkerTypeForm>> = {
  local: localTypeForm,
  docker: dockerTypeForm,
};
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/workers/types/registry.ts
git commit -m "refactor(web): add per-type worker form registry"
```

---

## Task 10: Rewrite `WorkerFormModal` as a thin shell

**Files:**
- Modify: `packages/web/src/components/workers/WorkerFormModal.tsx` (full replace)

- [ ] **Step 1: Replace the modal**

Replace the entire contents of `packages/web/src/components/workers/WorkerFormModal.tsx` with:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Info, Tag, Server, Star } from "lucide-react";
import { btnGhost, btnPrimary, card, inputCls, selectCls } from "../../routes/admin-styles.ts";
import {
  workersApi, type Worker, type WorkerType, type WorkerUpsertBody, type WorkerTypeDescriptor,
} from "../../api/workers.ts";
import { Field, CheckField } from "./types/form-controls.tsx";
import { workerTypeForms } from "./types/registry.ts";

export interface WorkerFormModalProps {
  orgId: string;
  scope: "user" | "org";
  /** Present ⇒ edit; absent ⇒ create. */
  worker?: Worker;
  onClose: () => void;
  onSaved: () => void;
}

export function WorkerFormModal(props: WorkerFormModalProps) {
  const editing = Boolean(props.worker);
  const [name, setName] = useState(props.worker?.name ?? "");
  const [type, setType] = useState<WorkerType>(props.worker?.type ?? "local");
  const [isDefault, setIsDefault] = useState(props.worker?.isDefault ?? false);
  const [types, setTypes] = useState<WorkerTypeDescriptor[]>([]);
  const [config, setConfig] = useState<Record<string, unknown>>(() =>
    (workerTypeForms[props.worker?.type ?? "local"]?.readConfig(props.worker?.config ?? {}) ?? {}) as Record<string, unknown>,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const form = workerTypeForms[type];

  useEffect(() => {
    let alive = true;
    workersApi.listTypes(props.orgId).then((rows) => { if (alive) setTypes(rows); }).catch(() => { if (alive) setTypes([]); });
    return () => { alive = false; };
  }, [props.orgId]);

  // When the user switches type (create mode), reset config to that type's defaults.
  function onSelectType(next: WorkerType) {
    setType(next);
    setTestResult(null);
    const f = workerTypeForms[next];
    setConfig((f?.readConfig(props.worker?.type === next ? (props.worker?.config ?? {}) : {}) ?? {}) as Record<string, unknown>);
  }

  const supportedMode = useMemo(
    () => types.find((t) => t.type === type)?.supportedModes?.[0] ?? (type === "docker" ? "per-instance" : "shared"),
    [types, type],
  );

  async function onTest() {
    if (!form) return;
    setTesting(true); setTestResult(null);
    try {
      setTestResult(await workersApi.testConnection(props.orgId, { type, config: form.buildConfig(config) }));
    } catch (e) {
      setTestResult({ ok: false, error: (e as Error)?.message ?? "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form?.validate) {
      const v = form.validate(config);
      if (v) { setError(v); return; }
    }
    setBusy(true); setError(null);
    const builtConfig = form ? form.buildConfig(config) : {};
    const body: WorkerUpsertBody = {
      name, type,
      executionMode: type === "docker" ? "per-instance" : "shared",
      connectivity: type === "docker" ? "push" : null,
      config: builtConfig,
      isDefault,
    };
    try {
      if (editing) {
        const patch: Partial<WorkerUpsertBody> = {
          name: body.name, executionMode: body.executionMode, connectivity: body.connectivity,
          config: body.config, isDefault: body.isDefault,
        };
        if (props.scope === "user") await workersApi.updateMy(props.orgId, props.worker!.id, patch);
        else await workersApi.updateOrg(props.orgId, props.worker!.id, patch);
      } else if (props.scope === "user") {
        await workersApi.createMy(props.orgId, body);
      } else {
        await workersApi.createOrg(props.orgId, body);
      }
      props.onSaved();
      props.onClose();
    } catch (e2) {
      setError((e2 as Error)?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  const ConfigForm = form?.ConfigForm;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className={`${card} w-full max-w-xl max-h-[90vh] overflow-y-auto p-6`}>
        <h2 className="text-lg font-semibold text-slate-100 mb-1">{editing ? "Edit worker" : "New worker"}</h2>
        <div className="flex gap-2 rounded-lg border border-indigo-900/40 bg-indigo-950/30 p-3 mb-4 text-xs leading-relaxed text-slate-300">
          <Info size={16} className="mt-0.5 shrink-0 text-indigo-400" aria-hidden />
          <span>A <b>worker</b> is where a workflow's steps run. Pick a type, then fill its connection/runtime details below.</span>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <Field icon={Tag} label="Name" hint={<>A label you'll recognize in the worker picker.</>}>
            <input className={inputCls} placeholder="Local Docker" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>

          <Field icon={Server} label="Type"
            hint={types.find((t) => t.type === type)?.summary ?? `Mode: ${supportedMode}`}>
            <select className={`${selectCls} block mt-1 w-full`} value={type}
              disabled={editing} onChange={(e) => onSelectType(e.target.value as WorkerType)}>
              {types.map((t) => (
                <option key={t.type} value={t.type} disabled={t.status !== "available"}>
                  {t.label}{t.status !== "available" ? " · coming soon" : ""}
                </option>
              ))}
            </select>
          </Field>

          {ConfigForm
            ? <ConfigForm state={config} onChange={setConfig} editing={editing} />
            : <div className="text-sm text-amber-400">This worker type isn't available yet.</div>}

          {form?.testConnection && (
            <div className="space-y-1">
              <button type="button" onClick={onTest} disabled={testing} className={btnGhost}>
                {testing ? "Testing…" : "Test connection"}
              </button>
              {testResult && (
                <p className={`text-xs ${testResult.ok ? "text-emerald-400" : "text-rose-400"}`}>
                  {testResult.ok ? "✓ Connected" : `✗ ${testResult.error}`}
                </p>
              )}
            </div>
          )}

          <CheckField icon={Star} label="Set as default worker"
            hint={<>New workflows run on this worker unless they pick a different one.</>}
            checked={isDefault} onChange={setIsDefault} />

          {error && <div className="text-sm text-rose-400">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={props.onClose} className={btnGhost}>Cancel</button>
            <button type="submit" disabled={busy || !ConfigForm} className={btnPrimary}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `npx tsc --noEmit -p packages/web/tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Verify Vite transforms the modal cleanly**

Start the dev server (`web` from `.claude/launch.json`) if not already up, then fetch the transformed module:

Run (browser/devtools or preview eval):
```js
fetch('/src/components/workers/WorkerFormModal.tsx', { headers: { Accept: 'application/javascript' } })
  .then(r => r.text())
  .then(t => ({ ok: !t.trimStart().startsWith('<!doctype'), err: /SyntaxError|Transform failed/i.test(t) }));
```
Expected: `{ ok: true, err: false }`.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/workers/WorkerFormModal.tsx
git commit -m "refactor(web): make WorkerFormModal a thin type-driven shell"
```

---

## Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole repo**

Run: `npm run typecheck`
Expected: exit 0.

- [ ] **Step 2: Run the workers test suite**

Run: `npm test --workspace=packages/workers`
Expected: PASS (including the new catalog drift + test-connection suites).

- [ ] **Step 3: Import-boundary check**

Run: `npm run check:boundaries`
Expected: exit 0 (web imports api/workers; no new cross-package violations).

- [ ] **Step 4: Manual smoke (logged-in dev server)**

In the running `web` dev server, open `/me/workers` → New worker:
- Type dropdown lists all 8 types; the 6 unbuilt show "· coming soon" and are not selectable.
- Selecting **Docker** shows the docker config fields; **Test connection** pings the daemon (green ✓ on success; the `ENOENT` error on a bad socket path).
- Selecting **Local** shows base-folder + retain.
- Save creates the worker; edit reopens with the same config (round-trip intact); type is locked in edit mode.

- [ ] **Step 5: Final commit (if any uncommitted verification fixups)**

```bash
git add -A
git commit -m "chore: type-driven worker form verification fixups" || echo "nothing to commit"
```
