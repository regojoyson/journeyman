# Workers Docker Backend → dockerode Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the `docker` CLI seam (`DockerCommandRunner`/`makeProcessCommandRunner`) with a **`dockerode`-based `IDockerClient`**, and wire the worker's **`connection`** config (local socket / remote daemon) so it's actually used — removing the local-only limitation. The `IExecutionEnvironment` interface and everything above it (providers, harness, provisioner, reaper, UI) are unchanged.

**Architecture:** A small **`IDockerClient`** interface captures exactly the operations we need (volume/create-remove, run-idle container, exec with stdin/stdout, remove, list-by-label, image-exists, build). `DockerodeClient` implements it over `dockerode`; `makeDockerClient(connection)` builds the client from a worker's `connection` (local socket or remote `host`/TLS). `DockerExecutionEnvironment` + `buildDockerfileImage` call `IDockerClient` instead of building CLI argv. The sandbox row persists the `connection` so the worker harness (exec) and reaper (destroy) — which run in other processes — rebuild the right client.

**Tech Stack:** TypeScript, `dockerode` (+`@types/dockerode`), vitest. Unit tests fake `IDockerClient`; a gated integration test exercises real `dockerode` + Docker.

**Depends on:** Plans 4–6 + Dockerfile auto-wrap (the code being migrated).

**Scope:** local + remote-by-host. **TLS certs sourced from the secret vault are a documented follow-up** (v1 remote supports a reachable `host`, with optional cert dir via env).

---

## File Structure

- `packages/workers/src/backends/docker/docker-client.ts` — **Create.** `IDockerClient` + `DockerodeClient` + `makeDockerClient(connection)`.
- `packages/workers/src/backends/docker/docker-client.test.ts` — **Create.** (parsing/host helpers; the dockerode calls are covered by the gated IT)
- `packages/workers/src/backends/docker/docker-command-runner.ts` + `.test.ts` — **Delete.**
- `packages/workers/src/backends/docker/docker-execution-environment.ts` (+test) — **Rewrite** to use `IDockerClient`.
- `packages/workers/src/backends/docker/build-image.ts` (+test) — **Rewrite** to use `IDockerClient`.
- `packages/workers/src/backends/docker/docker-backend.ts` (+test) — **Modify** deps `docker: DockerCommandRunner` → `client: IDockerClient`.
- `packages/workers/src/backends/docker/docker-integration.test.ts` — **Rewrite** to build a real `dockerode` client.
- `packages/workers/src/default-registry.ts` (+test) — **Modify** `DockerBackendDeps` shape.
- `packages/workers/src/sandbox-store.ts` (+test) — **Modify** persist `connection`.
- `packages/migrations/src/sql/035_sandbox_connection.sql` — **Create.** `connection JSONB` column.
- `packages/workers/src/cli-sandbox.ts` — **Modify** use `makeDockerClient`.
- `packages/workers/src/index.ts` — **Modify** exports.
- `packages/workers/package.json` — **Modify** add `dockerode` + `@types/dockerode`.
- `packages/api-server/src/composition.ts` + `packages/orchestrator/src/cli-worker.ts` — **Modify** build clients from `connection`.

---

## Task 1: `IDockerClient` + `DockerodeClient` + `makeDockerClient`

**Files:** Create `docker-client.ts` (+ small `docker-client.test.ts` for the host parser).

`IDockerClient`:
```ts
export interface DockerConnection {
  kind: "local" | "remote";
  host?: string;            // e.g. "tcp://build-host:2376" or "build-host:2376"
  certDir?: string;         // optional TLS cert dir (ca.pem/cert.pem/key.pem)
}
export interface IDockerClient {
  createVolume(name: string): Promise<void>;
  removeVolume(name: string): Promise<void>;
  runIdle(o: { image: string; volume: string; mountPath: string; labels: Record<string,string>;
    env?: Record<string,string>; cpus?: number; memoryMb?: number; network?: "none" | "full" }): Promise<string>;
  exec(containerId: string, o: { cmd: string[]; env?: Record<string,string>; stdin?: string;
    onStderr?: (line: string) => void; signal?: AbortSignal }): Promise<{ stdout: string; exitCode: number }>;
  removeContainer(id: string): Promise<void>;
  listByLabel(labelKey: string, labelValue?: string): Promise<Array<{ id: string; runId: string }>>;
  imageExists(tag: string): Promise<boolean>;
  buildImage(o: { contextDir: string; dockerfileName: string; tag: string }): Promise<void>;
}
export function parseDockerHost(host: string): { host: string; port: number; protocol: "http" | "https" };
export function makeDockerClient(connection?: DockerConnection): IDockerClient; // DockerodeClient
```

`DockerodeClient` uses dockerode:
- `createVolume` → `docker.createVolume({ Name })`; `removeVolume` → `docker.getVolume(name).remove()`.
- `runIdle` → `docker.createContainer({ Image, Entrypoint:["sleep"], Cmd:["infinity"], Labels, Env:[`K=V`…], HostConfig:{ Binds:[`${volume}:${mountPath}`], NanoCpus: cpus?cpus*1e9:undefined, Memory: memoryMb?memoryMb*1024*1024:undefined, NetworkMode: network==="none"?"none":undefined } })` then `c.start()`; return `c.id`.
- `exec` → `c.exec({ Cmd, Env, AttachStdin:true, AttachStdout:true, AttachStderr:true })`; `start({ hijack:true, stdin:true })`; `modem.demuxStream(stream, stdoutW, stderrW)`; write stdin + end; collect stdout; line-buffer stderr → `onStderr`; on end `await exec.inspect()` → `ExitCode`.
- `removeContainer` → `docker.getContainer(id).remove({ force:true })`.
- `listByLabel` → `docker.listContainers({ all:true, filters:{ label:[labelValue?`${labelKey}=${labelValue}`:labelKey] } })` → map `{ id:Id, runId: Labels[labelKey] }`.
- `imageExists` → `docker.getImage(tag).inspect()` returns ⇒ true; throws ⇒ false.
- `buildImage` → `docker.buildImage({ context: contextDir, src:[dockerfileName] }, { t:tag, dockerfile:dockerfileName })` then `await new Promise((res,rej)=>docker.modem.followProgress(stream, e=>e?rej(e):res(), ()=>{}))`.
- `makeDockerClient({kind:"remote",host,certDir})` → `new Docker({ ...parseDockerHost(host), ...(certDir?{ca,cert,key read from certDir}:{}) })`; local → `new Docker()`.

Unit-test `parseDockerHost` (tcp/https/bare forms). The dockerode method bodies are covered by the gated IT (Task 8).

---

## Task 2: Rewrite `DockerExecutionEnvironment` over `IDockerClient`

Deps `{ client: IDockerClient; runnerCmd?: string[]; defaultImage?: string }`.
- `provision`: `await client.createVolume(vol)`; `handle = await client.runIdle({ image, volume:vol, mountPath:"/workspace", labels:{"journeyman.runId":runId}, env:spec.env, cpus:spec.resources?.cpus, memoryMb:spec.resources?.memoryMb, network:spec.network })`; return `{ runId, type:"docker", handle, volume:vol, workspaceDir:"/workspace" }`.
- `exec`: `const r = await client.exec(env.handle, { cmd: runnerCmd ?? ["journeyman-runner"], env: op.env, stdin: JSON.stringify({ op:op.op, opts:{ ...(op.stdin as object), cwd:"/workspace" } }), onStderr: ndjsonForward(op.onLog), signal: op.signal })`; parse `r.stdout` JSON → `ExecResult` (with `structured ?? result` flatten); fallback error.
- `destroy`: `removeContainer(handle)`; `removeVolume(volume)` (best-effort).
- `list`: `client.listByLabel("journeyman.runId", filter?.runId)` → `ProvisionedEnv[]`.

`ndjsonForward(onLog)` = the existing parse-`{line,meta}`-or-raw helper.

Test with a fake `IDockerClient` (records calls; exec returns a canned stdout; onStderr fed NDJSON + raw).

---

## Task 3: Rewrite `buildDockerfileImage` over `IDockerClient`

`deps { content; client: IDockerClient; bundleRef; tagPrefix? }`: hash → tag; `if (await client.imageExists(tag)) return tag`; write temp Dockerfile; `await client.buildImage({ contextDir:dir, dockerfileName:"Dockerfile", tag })`; cleanup; return tag. Test with fake client (imageExists true ⇒ no build; false ⇒ buildImage called; deterministic tag).

---

## Task 4: `docker-backend.ts` deps + `resolveDockerSpec`

`DockerBackendDeps`/`ResolveDockerSpecDeps`: `docker: DockerCommandRunner` → `client: IDockerClient`. `resolveDockerSpec` passes `client` to `buildDockerfileImage`. Update tests to fake `IDockerClient`.

---

## Task 5: Persist `connection` on the sandbox row

- Migration `035_sandbox_connection.sql`: `ALTER TABLE jm_sandbox_instances ADD COLUMN IF NOT EXISTS connection JSONB;`
- `SandboxRecord` + `RecordSandboxArgs` gain `connection?: DockerConnection | null`; `recordSandbox` inserts it; `rowToSandbox` reads it. Update tests.

---

## Task 6: Registry + CLI + exports

- `default-registry.ts`: `docker?: DockerBackendDeps` now carries `client`. Update test (build a fake client).
- `cli-sandbox.ts`: `makeDockerClient(sb.connection ?? { kind:"local" })` per row.
- `index.ts`: export `makeDockerClient`, `parseDockerHost`, types `IDockerClient`, `DockerConnection`; drop `makeProcessCommandRunner`/`DockerCommandRunner`.
- `package.json`: add `"dockerode": "^4.0.2"` dep + `"@types/dockerode": "^3.3.31"` dev. Delete `docker-command-runner.ts` + test.

---

## Task 7: Wire composition + cli-worker from `connection`

- `composition.ts` provisioner: `const connection = (worker.config as any).connection ?? { kind:"local" }`; `const client = makeDockerClient(connection)`; `env = new DockerExecutionEnvironment({ client, defaultImage })`; `spec = await resolveDockerSpec(worker.config, { client, defaultImage, bundleRef })`; on `recordSandbox`, store `connection`.
- `dockerDestroy(sb)`: `makeDockerClient(sb.connection ?? { kind:"local" })` → `env.destroy`. (reaper + routes use this.)
- `cli-worker.ts` `sandboxResolver`: `makeDockerClient(sb.connection ?? { kind:"local" })` → `env.exec`.

---

## Task 8: Verify

- `npm install` (dockerode).
- `npm test -w @journeyman/workers` (all fakes) + `npm run check`.
- Migration applied (gated DB).
- Gated integration (`JM_DOCKER_IT=1`): rewrite to `makeDockerClient()` (local) → provision → exec unknown-op → destroy; + build-from-Dockerfile. Re-run the real Postgres+Docker sandbox E2E equivalent.

---

## Self-Review

**Coverage:** dockerode replaces CLI for all ops (Tasks 1–4); remote `connection` wired end-to-end via persisted sandbox `connection` (Tasks 5,7); interface above docker unchanged. **Deferred:** TLS certs from the secret vault (v1 remote = host + optional cert dir); multi-arch/musl unchanged from prior scope.

**Placeholders:** none — testable units fake `IDockerClient`; dockerode method bodies covered by the gated IT.

**Type consistency:** `IDockerClient`/`DockerConnection` flow through env, build-image, backend, registry, store, composition, cli-worker. `makeDockerClient(connection)` is the single construction point. `ProvisionedEnv`/`ExecResult`/`ExecutionEnvironmentSpec` (Plan 1) unchanged.
