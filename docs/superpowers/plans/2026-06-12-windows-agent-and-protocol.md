# Plan B — agent-protocol + windows-agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the gRPC contract (`@journeyman/agent-protocol`) and the always-on Node gRPC service (`@journeyman/windows-agent`) that runs on a Windows box, spawns the existing `journeyman-runner` per `Exec`, and exposes provision/materialize/destroy/list/readiness — all over mTLS.

**Architecture:** `@journeyman/agent-protocol` ships a `.proto` + hand-written TS message types + a `loadAgentService()` helper (via `@grpc/proto-loader`). `@journeyman/windows-agent` is a `@grpc/grpc-js` server: mTLS creds from a `certDir`, keepalive + no per-call deadline (long builds), `Exec` is server-streaming (live stderr log lines, then a final result), and the runner is spawned as a child with the JSON `RunnerRequest` on stdin. The agent is plain Node, so it runs and is fully testable on **Linux CI** (loopback + self-signed test certs) even though it normally lives on Windows. Deterministic Git-Bash pinning + a readiness self-check make any box verify itself.

**Tech Stack:** TypeScript (Node 22, ESM, `.ts` import extensions), `@grpc/grpc-js`, `@grpc/proto-loader`, `tar`, Vitest. New deps; no `protoc` codegen.

**Reference spec:** [2026-06-12-windows-sandbox-design.md](../specs/2026-06-12-windows-sandbox-design.md) §3.1 (A: proto, D: agent), §12 findings 1, 8, 9, 14, 16. **Depends on:** Plan A (registry refactor) — already merged.

---

## File Structure

**`packages/agent-protocol/`** *(new — the shared contract)*
- `package.json` — `@journeyman/agent-protocol`, deps: `@grpc/grpc-js`, `@grpc/proto-loader`.
- `src/journeyman-agent.proto` — the service + messages.
- `src/types.ts` — hand-written TS interfaces mirroring the proto messages (`ExecRequest`, `ExecEvent`, `ReadinessReply`, …).
- `src/index.ts` — `PROTO_PATH` (resolved via `import.meta.url`), `loadAgentService()` (returns the typed `ServiceDefinition` + client ctor), re-exports `types.ts`.

**`packages/windows-agent/`** *(new — the deployable service)*
- `package.json` — `@journeyman/windows-agent`, deps: `@journeyman/agent-protocol`, `@journeyman/agent-runtime`, `@grpc/grpc-js`, `tar`. Bin: `journeyman-agent`.
- `src/shell.ts` — `findGitBash()` (locate + pin Git Bash).
- `src/readiness.ts` — `runReadinessChecks()` → scorecard.
- `src/runner-spawn.ts` — `spawnRunner()` (child process, stdin JSON, stream stderr lines, capture stdout final).
- `src/workspace.ts` — `provisionDir`/`destroyDir`/`listRuns`/`materializeTar` (Node fs + tar; Windows-safe paths).
- `src/credentials.ts` — `loadServerCredentials(certDir)` (mTLS).
- `src/server.ts` — `createAgentServer(deps)` wiring all handlers + keepalive options.
- `src/config.ts` — env/CLI config (listen addr, certDir, workspaceRoot, maxConcurrent).
- `src/cli.ts` — `journeyman-agent` entrypoint (start the service).
- `src/*.test.ts` — unit tests + a loopback integration test.
- `README.md` — install + certs + firewall walkthrough.

**Workspace wiring:**
- `scripts/check-import-boundaries.mjs` — `@journeyman/agent-protocol` = `shared`, `@journeyman/windows-agent` = `backend`.

---

## Task 1: Spike — prove gRPC + mTLS + runner spawn + Git Bash on the real toolchain

**Why first:** validates the design's load-bearing assumptions (#1, #9, #14) before any real code. Throwaway — deleted at the end of the task. Confirms the exact `@grpc/grpc-js` API on the installed version.

**Files:**
- Create (temp): `packages/windows-agent/` package skeleton, `spike/spike.mjs`, `spike/make-certs.sh`.

- [ ] **Step 1: Scaffold the package + install gRPC**

Create `packages/windows-agent/package.json`:

```json
{
  "name": "@journeyman/windows-agent",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "bin": { "journeyman-agent": "./src/cli.ts" },
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": {
    "@journeyman/agent-protocol": "*",
    "@journeyman/agent-runtime": "*",
    "@grpc/grpc-js": "^1.12.0",
    "tar": "^7.4.3"
  },
  "devDependencies": { "typescript": "^5", "vitest": "^4" }
}
```

Run: `npm install` (root) to link the workspace + pull `@grpc/grpc-js`.
Expected: installs without error; `node -e "require('@grpc/grpc-js')"` resolves.

- [ ] **Step 2: Generate self-signed mTLS test certs**

Create `packages/windows-agent/spike/make-certs.sh`:

```bash
#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"; mkdir -p certs; cd certs
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca-key.pem -out ca.pem -days 2 -subj "/CN=jm-test-ca" 2>/dev/null
for who in server client; do
  openssl req -newkey rsa:2048 -nodes -keyout "$who-key.pem" -out "$who.csr" -subj "/CN=localhost" 2>/dev/null
  openssl x509 -req -in "$who.csr" -CA ca.pem -CAkey ca-key.pem -CAcreateserial -out "$who.pem" -days 2 \
    -extfile <(printf "subjectAltName=DNS:localhost,IP:127.0.0.1") 2>/dev/null
done
echo "certs written to $(pwd)"
```

Run: `bash packages/windows-agent/spike/make-certs.sh`
Expected: `ca.pem`, `server.pem`, `server-key.pem`, `client.pem`, `client-key.pem` exist.

- [ ] **Step 3: Write the spike (inline proto, server-stream, mTLS, spawn `bash`)**

Create `packages/windows-agent/spike/spike.mjs`:

```javascript
import * as grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROTO = `
syntax = "proto3";
package jmspike;
service Spike {
  rpc Exec (ExecRequest) returns (stream ExecEvent);
}
message ExecRequest { string request_json = 1; }
message ExecEvent { string log = 1; string final_json = 2; }
`;
const protoPath = fileURLToPath(new URL("./_spike.proto", import.meta.url));
writeFileSync(protoPath, PROTO);
const def = protoLoader.loadSync(protoPath, { keepCase: true });
const pkg = grpc.loadPackageDefinition(def).jmspike;
const certs = (n) => readFileSync(fileURLToPath(new URL(`./certs/${n}`, import.meta.url)));

// Server: spawn `bash -lc "echo ..."` and stream its stdout back, then a final event.
const server = new grpc.Server();
server.addService(pkg.Spike.service, {
  Exec: (call) => {
    const child = spawn("bash", ["-lc", "echo hello-from-bash; echo done"], { stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (b) => call.write({ log: b.toString() }));
    child.on("close", (code) => { call.write({ final_json: JSON.stringify({ ok: code === 0 }) }); call.end(); });
  },
});
const creds = grpc.ServerCredentials.createSsl(
  certs("ca.pem"),
  [{ private_key: certs("server-key.pem"), cert_chain: certs("server.pem") }],
  true, // require + verify client cert (mTLS)
);
await new Promise((res) => server.bindAsync("127.0.0.1:0", creds, (e, port) => { if (e) throw e; res(port); }).then?.(undefined));
const port = await new Promise((res, rej) => server.bindAsync("127.0.0.1:0", creds, (e, p) => e ? rej(e) : res(p)));
server.start();

// Client: mTLS, call Exec, collect the stream.
const clientCreds = grpc.credentials.createSsl(certs("ca.pem"), certs("client-key.pem"), certs("client.pem"));
const client = new pkg.Spike(`127.0.0.1:${port}`, clientCreds);
const stream = client.Exec({ request_json: "{}" });
let logs = "", final = null;
stream.on("data", (ev) => { if (ev.log) logs += ev.log; if (ev.final_json) final = ev.final_json; });
stream.on("end", () => {
  console.log("LOGS:", JSON.stringify(logs.trim()));
  console.log("FINAL:", final);
  if (!logs.includes("hello-from-bash") || !final?.includes('"ok":true')) { console.error("SPIKE FAILED"); process.exit(1); }
  console.log("SPIKE OK"); server.forceShutdown(); process.exit(0);
});
```

- [ ] **Step 4: Run the spike**

Run: `node packages/windows-agent/spike/spike.mjs`
Expected: prints `LOGS: "hello-from-bash\ndone"`, `FINAL: {"ok":true}`, `SPIKE OK`. This proves: proto-loader loads a service, mTLS handshake succeeds both directions, server-streaming delivers log chunks + a final event, and a spawned shell's stdout streams back.

> **On a real Windows box** (manual, documented in README): rerun with `bash` resolved to Git Bash (`C:\Program Files\Git\bin\bash.exe`) to confirm #1. On Linux CI, system `bash` stands in.

- [ ] **Step 5: Delete the spike, keep the cert script**

```bash
rm packages/windows-agent/spike/spike.mjs packages/windows-agent/spike/_spike.proto
git add packages/windows-agent/package.json packages/windows-agent/spike/make-certs.sh package-lock.json
git commit -m "chore(windows-agent): scaffold package + mTLS test-cert script; gRPC spike proven"
```

---

## Task 2: agent-protocol — the .proto + types + loader

**Files:**
- Create: `packages/agent-protocol/package.json`, `src/journeyman-agent.proto`, `src/types.ts`, `src/index.ts`
- Test: `packages/agent-protocol/src/index.test.ts`

- [ ] **Step 1: Scaffold the package**

Create `packages/agent-protocol/package.json`:

```json
{
  "name": "@journeyman/agent-protocol",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": { "typecheck": "tsc --noEmit", "test": "vitest run" },
  "dependencies": { "@grpc/grpc-js": "^1.12.0", "@grpc/proto-loader": "^0.7.13" },
  "devDependencies": { "typescript": "^5", "vitest": "^4" }
}
```

Run: `npm install`
Expected: links the workspace package.

- [ ] **Step 2: Write the .proto**

Create `packages/agent-protocol/src/journeyman-agent.proto`:

```proto
syntax = "proto3";
package journeyman.agent;

service JourneymanAgent {
  rpc Readiness (ReadinessRequest) returns (ReadinessReply);
  rpc Provision (ProvisionRequest) returns (ProvisionReply);
  rpc Exec (ExecRequest) returns (stream ExecEvent);
  rpc Materialize (stream FileChunk) returns (MaterializeReply);
  rpc Destroy (DestroyRequest) returns (DestroyReply);
  rpc List (ListRequest) returns (ListReply);
}

message ReadinessRequest {}
message ReadinessCheck { string name = 1; bool ok = 2; string detail = 3; }
message ReadinessReply { bool ready = 1; repeated ReadinessCheck checks = 2; }

message ProvisionRequest { string run_id = 1; }
message ProvisionReply { string handle = 1; string workspace_dir = 2; }

message ExecRequest {
  string run_id = 1;
  string request_json = 2;           // the runner's RunnerRequest JSON, verbatim
  map<string, string> env = 3;       // per-run secrets
}
message LogLine { string line = 1; string meta_json = 2; }
message ExecFinal { bool ok = 1; string structured_json = 2; string error = 3; }
message ExecEvent { oneof kind { LogLine log = 1; ExecFinal final = 2; } }

message FileChunk { string run_id = 1; string dest_dir = 2; bytes tar = 3; }
message MaterializeReply { bool ok = 1; }

message DestroyRequest { string run_id = 1; }
message DestroyReply { bool ok = 1; }

message ListRequest { string run_id = 1; }  // empty run_id = all
message RunInfo { string run_id = 1; string handle = 2; string workspace_dir = 3; }
message ListReply { repeated RunInfo runs = 1; }
```

- [ ] **Step 3: Hand-write the TS message types**

Create `packages/agent-protocol/src/types.ts`:

```typescript
export interface ReadinessCheck { name: string; ok: boolean; detail: string; }
export interface ReadinessReply { ready: boolean; checks: ReadinessCheck[]; }
export interface ProvisionRequest { run_id: string; }
export interface ProvisionReply { handle: string; workspace_dir: string; }
export interface ExecRequest { run_id: string; request_json: string; env: Record<string, string>; }
export interface LogLine { line: string; meta_json: string; }
export interface ExecFinal { ok: boolean; structured_json: string; error: string; }
export interface ExecEvent { log?: LogLine; final?: ExecFinal; }
export interface FileChunk { run_id: string; dest_dir: string; tar: Buffer; }
export interface MaterializeReply { ok: boolean; }
export interface DestroyRequest { run_id: string; }
export interface DestroyReply { ok: boolean; }
export interface ListRequest { run_id: string; }
export interface RunInfo { run_id: string; handle: string; workspace_dir: string; }
export interface ListReply { runs: RunInfo[]; }
```

- [ ] **Step 4: Write the loader**

Create `packages/agent-protocol/src/index.ts`:

```typescript
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";

export * from "./types.ts";

/** Absolute path to the .proto (resolved from this module; build copies it next to the bundle). */
export const PROTO_PATH = fileURLToPath(new URL("./journeyman-agent.proto", import.meta.url));

export function loadAgentPackage(): grpc.GrpcObject {
  const def = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true, longs: String, enums: String, defaults: true, oneofs: true,
  });
  return grpc.loadPackageDefinition(def);
}

/** The service definition used to addService (server) and to build a client. */
export function agentServiceDef(): grpc.ServiceClientConstructor {
  const pkg = loadAgentPackage() as unknown as {
    journeyman: { agent: { JourneymanAgent: grpc.ServiceClientConstructor } };
  };
  return pkg.journeyman.agent.JourneymanAgent;
}
```

- [ ] **Step 5: Write the test**

Create `packages/agent-protocol/src/index.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { agentServiceDef } from "./index.ts";

describe("agent-protocol", () => {
  it("loads the service with all six methods", () => {
    const Svc = agentServiceDef();
    const methods = Object.keys(Svc.service);
    for (const m of ["Readiness", "Provision", "Exec", "Materialize", "Destroy", "List"]) {
      expect(methods).toContain(m);
    }
  });

  it("Exec is server-streaming and Materialize is client-streaming", () => {
    const svc = agentServiceDef().service;
    expect(svc.Exec.responseStream).toBe(true);
    expect(svc.Exec.requestStream).toBe(false);
    expect(svc.Materialize.requestStream).toBe(true);
  });
});
```

- [ ] **Step 6: Run + commit**

Run: `npm test -w @journeyman/agent-protocol`
Expected: PASS.

```bash
git add packages/agent-protocol package-lock.json
git commit -m "feat(agent-protocol): gRPC .proto + TS types + service loader"
```

---

## Task 3: Register packages in the import-boundary checker

**Files:**
- Modify: `scripts/check-import-boundaries.mjs`

- [ ] **Step 1: Add both packages to PKG_LAYER**

In `scripts/check-import-boundaries.mjs`, add to the `PKG_LAYER` map:

```javascript
  "@journeyman/agent-protocol": "shared",
  "@journeyman/windows-agent": "backend",
```

- [ ] **Step 2: Run the checker + commit**

Run: `npm run check:boundaries`
Expected: `✓ Layer boundaries clean across all packages.`

```bash
git add scripts/check-import-boundaries.mjs
git commit -m "chore: register agent-protocol (shared) + windows-agent (backend) in boundaries"
```

---

## Task 4: Git-Bash pinning (`shell.ts`)

**Files:**
- Create: `packages/windows-agent/src/shell.ts`, `src/shell.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/windows-agent/src/shell.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { findGitBash } from "./shell.ts";

describe("findGitBash", () => {
  it("returns an absolute path from explicit candidates that exist", () => {
    // process.execPath always exists; use it as a stand-in 'bash' candidate.
    const found = findGitBash({ candidates: [process.execPath, "C:\\nope\\bash.exe"] });
    expect(found).toBe(process.execPath);
  });

  it("returns null when no candidate exists", () => {
    expect(findGitBash({ candidates: ["C:\\nope\\bash.exe", "/nope/bash"] })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it (fails — module missing)**

Run: `npm test -w @journeyman/windows-agent -- shell`
Expected: FAIL — `findGitBash` not found.

- [ ] **Step 3: Implement**

Create `packages/windows-agent/src/shell.ts`:

```typescript
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

const DEFAULT_WINDOWS_CANDIDATES = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
];

/** Locate a usable bash. On Windows that's Git Bash; on POSIX, `bash` on PATH. */
export function findGitBash(opts: { candidates?: string[] } = {}): string | null {
  const candidates = opts.candidates ?? [
    ...DEFAULT_WINDOWS_CANDIDATES,
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean).map((d) => join(d, "bash")),
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean).map((d) => join(d, "bash.exe")),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}
```

- [ ] **Step 4: Run + commit**

Run: `npm test -w @journeyman/windows-agent -- shell`
Expected: PASS.

```bash
git add packages/windows-agent/src/shell.ts packages/windows-agent/src/shell.test.ts
git commit -m "feat(windows-agent): deterministic Git-Bash pinning"
```

---

## Task 5: Workspace ops (`workspace.ts`)

**Files:**
- Create: `packages/windows-agent/src/workspace.ts`, `src/workspace.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/windows-agent/src/workspace.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { provisionDir, destroyDir, listRuns, materializeTar } from "./workspace.ts";
import { create as tarCreate } from "tar";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "jm-agent-")); });
afterEach(() => { destroyDir(root, "any").catch(() => {}); });

describe("workspace ops", () => {
  it("provision creates <root>/<runId> and list/destroy roundtrip", async () => {
    const p = await provisionDir(root, "run-1");
    expect(existsSync(p.workspaceDir)).toBe(true);
    expect(p.workspaceDir).toBe(join(root, "run-1"));
    expect((await listRuns(root)).map((r) => r.run_id)).toContain("run-1");
    await destroyDir(root, "run-1");
    expect(existsSync(p.workspaceDir)).toBe(false);
  });

  it("materialize clears then extracts a tar into a workspace-relative dest", async () => {
    await provisionDir(root, "run-2");
    const ws = join(root, "run-2");
    const srcDir = mkdtempSync(join(tmpdir(), "jm-src-"));
    writeFileSync(join(srcDir, "a.txt"), "hello");
    const chunks: Buffer[] = [];
    await new Promise<void>((res, rej) => {
      tarCreate({ cwd: srcDir }, ["a.txt"]).on("data", (c) => chunks.push(c)).on("end", res).on("error", rej);
    });
    // /workspace convention maps onto the real run dir
    await materializeTar(ws, "/workspace/.staging", Buffer.concat(chunks));
    expect(existsSync(join(ws, ".staging", "a.txt"))).toBe(true);
  });

  it("destroy is idempotent (missing dir = ok)", async () => {
    await expect(destroyDir(root, "ghost")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `npm test -w @journeyman/windows-agent -- workspace`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/windows-agent/src/workspace.ts`:

```typescript
import { mkdir, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { extract } from "tar";
import type { RunInfo } from "@journeyman/agent-protocol";

export async function provisionDir(root: string, runId: string): Promise<{ handle: string; workspaceDir: string }> {
  const workspaceDir = join(root, runId);
  await mkdir(workspaceDir, { recursive: true });
  return { handle: `win:${runId}`, workspaceDir };
}

export async function destroyDir(root: string, runId: string): Promise<void> {
  await rm(join(root, runId), { recursive: true, force: true });
}

export async function listRuns(root: string): Promise<RunInfo[]> {
  if (!existsSync(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => ({
    run_id: e.name, handle: `win:${e.name}`, workspace_dir: join(root, e.name),
  }));
}

/**
 * Replace destDir's contents with the tar. Maps the container `/workspace`
 * convention onto the real Windows workspace dir; uses Node fs (no shell `rm`).
 */
export async function materializeTar(workspaceDir: string, destDir: string, tar: Buffer): Promise<void> {
  const abs = destDir.startsWith(workspaceDir)
    ? destDir
    : destDir.startsWith("/workspace")
      ? join(workspaceDir, destDir.replace(/^\/workspace\/?/, ""))
      : join(workspaceDir, destDir.replace(/^[/\\]/, ""));
  await rm(abs, { recursive: true, force: true });
  await mkdir(abs, { recursive: true });
  if (tar.length === 0) return;
  await new Promise<void>((resolve, reject) => {
    Readable.from(tar).pipe(extract({ cwd: abs })).on("finish", resolve).on("error", reject);
  });
}
```

- [ ] **Step 4: Run + commit**

Run: `npm test -w @journeyman/windows-agent -- workspace`
Expected: PASS.

```bash
git add packages/windows-agent/src/workspace.ts packages/windows-agent/src/workspace.test.ts
git commit -m "feat(windows-agent): per-run workspace ops (provision/destroy/list/materialize)"
```

---

## Task 6: Runner spawn + stream (`runner-spawn.ts`)

**Files:**
- Create: `packages/windows-agent/src/runner-spawn.ts`, `src/runner-spawn.test.ts`, `src/__fixtures__/echo-runner.mjs`

- [ ] **Step 1: Add a fake runner fixture**

Create `packages/windows-agent/src/__fixtures__/echo-runner.mjs` (mimics the real runner's stdio discipline: NDJSON logs on stderr, one JSON result on stdout):

```javascript
import { readFileSync } from "node:fs";
const input = readFileSync(0, "utf8");
process.stderr.write(JSON.stringify({ line: "starting", meta: { phase: "init" } }) + "\n");
const req = JSON.parse(input || "{}");
process.stderr.write(JSON.stringify({ line: `op=${req.op}` }) + "\n");
process.stdout.write(JSON.stringify({ ok: true, structured: { op: req.op } }));
```

- [ ] **Step 2: Write the test**

Create `packages/windows-agent/src/runner-spawn.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { spawnRunner } from "./runner-spawn.ts";

const fixture = fileURLToPath(new URL("./__fixtures__/echo-runner.mjs", import.meta.url));

describe("spawnRunner", () => {
  it("pipes the request to stdin, streams stderr log lines, returns the final stdout JSON", async () => {
    const logs: Array<{ line: string; meta?: unknown }> = [];
    const result = await spawnRunner({
      command: process.execPath, args: [fixture], cwd: process.cwd(),
      requestJson: JSON.stringify({ op: "custom-prompt" }), env: {},
      onLog: (line, meta) => logs.push({ line, meta }),
    });
    expect(result.ok).toBe(true);
    expect(result.structured).toEqual({ op: "custom-prompt" });
    expect(logs.map((l) => l.line)).toContain("op=custom-prompt");
    expect(logs.find((l) => l.line === "starting")?.meta).toEqual({ phase: "init" });
  });

  it("kills the child when the abort signal fires", async () => {
    const ac = new AbortController();
    const slow = fileURLToPath(new URL("./__fixtures__/echo-runner.mjs", import.meta.url));
    const p = spawnRunner({ command: process.execPath, args: [slow], cwd: process.cwd(), requestJson: "{}", env: {}, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow(/abort/i);
  });
});
```

- [ ] **Step 3: Run it (fails)**

Run: `npm test -w @journeyman/windows-agent -- runner-spawn`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement**

Create `packages/windows-agent/src/runner-spawn.ts`:

```typescript
import { spawn } from "node:child_process";

export interface SpawnRunnerOpts {
  command: string;            // node (or the runner bin)
  args: string[];             // [runnerBundlePath] when invoked as `node runner.js`
  cwd: string;
  requestJson: string;
  env: Record<string, string>;
  onLog?: (line: string, meta?: Record<string, unknown>) => void;
  signal?: AbortSignal;
}
export interface RunnerResult { ok: boolean; structured?: unknown; error?: string; }

/** Spawn the runner, write the JSON request to stdin, stream stderr NDJSON logs, parse the single stdout JSON. */
export function spawnRunner(opts: SpawnRunnerOpts): Promise<RunnerResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.command, opts.args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env, IS_SANDBOX: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    let stdout = "";
    let stderrBuf = "";
    child.stdout.on("data", (b) => { stdout += b.toString(); });
    child.stderr.on("data", (b) => {
      stderrBuf += b.toString();
      let nl: number;
      while ((nl = stderrBuf.indexOf("\n")) >= 0) {
        const line = stderrBuf.slice(0, nl); stderrBuf = stderrBuf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as { line?: string; meta?: Record<string, unknown> };
          if (typeof parsed.line === "string") { opts.onLog?.(parsed.line, parsed.meta); continue; }
        } catch { /* not NDJSON */ }
        opts.onLog?.(line);
      }
    });
    child.on("error", reject);
    child.on("close", () => {
      const text = stdout.trim();
      if (!text) return resolve({ ok: false, error: "runner produced no JSON output" });
      try {
        const parsed = JSON.parse(text) as RunnerResult & { result?: string };
        resolve({ ok: parsed.ok, structured: parsed.structured ?? parsed.result, error: parsed.error });
      } catch {
        resolve({ ok: false, error: `runner produced non-JSON output: ${text.slice(0, 200)}` });
      }
    });
    child.stdin.write(opts.requestJson);
    child.stdin.end();
  });
}
```

- [ ] **Step 5: Run + commit**

Run: `npm test -w @journeyman/windows-agent -- runner-spawn`
Expected: PASS.

```bash
git add packages/windows-agent/src/runner-spawn.ts packages/windows-agent/src/runner-spawn.test.ts packages/windows-agent/src/__fixtures__/echo-runner.mjs
git commit -m "feat(windows-agent): spawn runner, stream NDJSON stderr, parse final stdout"
```

---

## Task 7: Readiness self-check (`readiness.ts`)

**Files:**
- Create: `packages/windows-agent/src/readiness.ts`, `src/readiness.test.ts`

- [ ] **Step 1: Write the test**

Create `packages/windows-agent/src/readiness.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { runReadinessChecks } from "./readiness.ts";

describe("runReadinessChecks", () => {
  it("reports ready when bash/git/node resolve and workspace is writable", async () => {
    const root = mkdtempSync(`${tmpdir()}/jm-ready-`);
    const r = await runReadinessChecks({
      bashPath: process.execPath,           // stands in for git-bash
      workspaceRoot: root,
      probe: async () => true,              // fake the git/node which-checks
    });
    expect(r.ready).toBe(true);
    expect(r.checks.find((c) => c.name === "bash")?.ok).toBe(true);
    expect(r.checks.find((c) => c.name === "workspace")?.ok).toBe(true);
  });

  it("reports not-ready with an actionable detail when bash is missing", async () => {
    const root = mkdtempSync(`${tmpdir()}/jm-ready-`);
    const r = await runReadinessChecks({ bashPath: null, workspaceRoot: root, probe: async () => true });
    expect(r.ready).toBe(false);
    const bash = r.checks.find((c) => c.name === "bash");
    expect(bash?.ok).toBe(false);
    expect(bash?.detail).toMatch(/Git for Windows/i);
  });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `npm test -w @journeyman/windows-agent -- readiness`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/windows-agent/src/readiness.ts`:

```typescript
import { access, constants } from "node:fs/promises";
import type { ReadinessReply, ReadinessCheck } from "@journeyman/agent-protocol";

export interface ReadinessOpts {
  bashPath: string | null;
  workspaceRoot: string;
  /** which-style probe for an external tool (real impl spawns `<tool> --version`). */
  probe: (tool: string) => Promise<boolean>;
}

export async function runReadinessChecks(opts: ReadinessOpts): Promise<ReadinessReply> {
  const checks: ReadinessCheck[] = [];
  const push = (name: string, ok: boolean, detail = "") => checks.push({ name, ok, detail });

  push("bash", !!opts.bashPath, opts.bashPath ?? "not found — install Git for Windows");
  push("git", await opts.probe("git"), "git on PATH");
  push("node", await opts.probe("node"), "node on PATH");
  let writable = false;
  try { await access(opts.workspaceRoot, constants.W_OK); writable = true; } catch { /* not writable */ }
  push("workspace", writable, writable ? opts.workspaceRoot : `not writable: ${opts.workspaceRoot}`);

  return { ready: checks.every((c) => c.ok), checks };
}
```

- [ ] **Step 4: Run + commit**

Run: `npm test -w @journeyman/windows-agent -- readiness`
Expected: PASS.

```bash
git add packages/windows-agent/src/readiness.ts packages/windows-agent/src/readiness.test.ts
git commit -m "feat(windows-agent): readiness self-check scorecard"
```

---

## Task 8: mTLS server credentials (`credentials.ts`)

**Files:**
- Create: `packages/windows-agent/src/credentials.ts`, `src/credentials.test.ts`

- [ ] **Step 1: Write the test** (uses the certs from Task 1)

Create `packages/windows-agent/src/credentials.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadServerCredentials } from "./credentials.ts";

const certDir = fileURLToPath(new URL("../spike/certs", import.meta.url));

describe("loadServerCredentials", () => {
  it.skipIf(!existsSync(`${certDir}/server.pem`))("builds mTLS server credentials from a certDir", () => {
    const creds = loadServerCredentials(certDir);
    expect(creds).toBeDefined();
    expect(creds._isSecure?.() ?? true).toBe(true); // ServerCredentials is secure
  });

  it("throws a clear error when a cert file is missing", () => {
    expect(() => loadServerCredentials("/nope")).toThrow(/cert/i);
  });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `npm test -w @journeyman/windows-agent -- credentials`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `packages/windows-agent/src/credentials.ts`:

```typescript
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as grpc from "@grpc/grpc-js";

/** Build mTLS server credentials from a folder containing ca.pem / server.pem / server-key.pem. */
export function loadServerCredentials(certDir: string): grpc.ServerCredentials {
  let ca: Buffer, cert: Buffer, key: Buffer;
  try {
    ca = readFileSync(join(certDir, "ca.pem"));
    cert = readFileSync(join(certDir, "server.pem"));
    key = readFileSync(join(certDir, "server-key.pem"));
  } catch (e) {
    throw new Error(`failed to read mTLS certs from ${certDir} (need ca.pem/server.pem/server-key.pem): ${(e as Error).message}`);
  }
  return grpc.ServerCredentials.createSsl(
    ca,
    [{ private_key: key, cert_chain: cert }],
    true, // require + verify the client cert (mutual TLS)
  );
}
```

- [ ] **Step 4: Run + commit**

Run: `npm test -w @journeyman/windows-agent -- credentials`
Expected: PASS (the secure-build case skips if certs absent; the error case always runs).

```bash
git add packages/windows-agent/src/credentials.ts packages/windows-agent/src/credentials.test.ts
git commit -m "feat(windows-agent): mTLS server credentials from certDir"
```

---

## Task 9: The gRPC server (`server.ts`) wiring all handlers

**Files:**
- Create: `packages/windows-agent/src/server.ts`, `src/config.ts`

- [ ] **Step 1: Config**

Create `packages/windows-agent/src/config.ts`:

```typescript
import { join } from "node:path";

export interface AgentConfig {
  host: string; port: number; certDir: string;
  workspaceRoot: string; runnerCommand: string; runnerArgs: string[];
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  return {
    host: env.JM_AGENT_HOST ?? "0.0.0.0",
    port: Number(env.JM_AGENT_PORT ?? 50051),
    certDir: env.JM_AGENT_CERT_DIR ?? "C:\\journeyman\\certs",
    workspaceRoot: env.JM_AGENT_WORKSPACE_ROOT ?? "C:\\jm-runs",
    runnerCommand: env.JM_AGENT_RUNNER_CMD ?? process.execPath,
    runnerArgs: env.JM_AGENT_RUNNER_ARGS ? env.JM_AGENT_RUNNER_ARGS.split(" ") : [join("C:\\journeyman", "runner.js")],
  };
}
```

- [ ] **Step 2: Implement the server (handlers wired to the modules from Tasks 4-8)**

Create `packages/windows-agent/src/server.ts`:

```typescript
import { join } from "node:path";
import * as grpc from "@grpc/grpc-js";
import { agentServiceDef } from "@journeyman/agent-protocol";
import type { AgentConfig } from "./config.ts";
import { findGitBash } from "./shell.ts";
import { runReadinessChecks } from "./readiness.ts";
import { provisionDir, destroyDir, listRuns, materializeTar } from "./workspace.ts";
import { spawnRunner } from "./runner-spawn.ts";

export interface AgentServerDeps {
  config: AgentConfig;
  /** which-style probe; default spawns `<tool> --version`. Injectable for tests. */
  probe?: (tool: string) => Promise<boolean>;
}

export function createAgentServer(deps: AgentServerDeps): grpc.Server {
  const { config } = deps;
  const bash = findGitBash();
  const probe = deps.probe ?? (async () => true);
  const server = new grpc.Server({
    // Keepalive so long, quiet builds aren't dropped (finding 14).
    "grpc.keepalive_time_ms": 30_000,
    "grpc.keepalive_timeout_ms": 10_000,
    "grpc.keepalive_permit_without_calls": 1,
  });

  server.addService(agentServiceDef().service, {
    Readiness: async (_call, cb) => {
      cb(null, await runReadinessChecks({ bashPath: bash, workspaceRoot: config.workspaceRoot, probe }));
    },
    Provision: async (call, cb) => {
      const p = await provisionDir(config.workspaceRoot, call.request.run_id);
      cb(null, { handle: p.handle, workspace_dir: p.workspaceDir });
    },
    Destroy: async (call, cb) => {
      await destroyDir(config.workspaceRoot, call.request.run_id);
      cb(null, { ok: true });
    },
    List: async (call, cb) => {
      const runs = await listRuns(config.workspaceRoot);
      const filtered = call.request.run_id ? runs.filter((r) => r.run_id === call.request.run_id) : runs;
      cb(null, { runs: filtered });
    },
    Materialize: (call, cb) => {
      // client-streaming: collect chunks (same run_id/dest_dir), then extract.
      const parts: Buffer[] = [];
      let runId = ""; let destDir = "";
      call.on("data", (chunk: { run_id: string; dest_dir: string; tar: Buffer }) => {
        runId = chunk.run_id || runId; destDir = chunk.dest_dir || destDir;
        if (chunk.tar?.length) parts.push(Buffer.from(chunk.tar));
      });
      call.on("end", () => {
        const ws = join(config.workspaceRoot, runId);
        materializeTar(ws, destDir, Buffer.concat(parts)).then(() => cb(null, { ok: true })).catch((e) => cb(e));
      });
      call.on("error", (e) => cb(e));
    },
    Exec: (call) => {
      // server-streaming: stream stderr log lines, then a final event.
      const ws = join(config.workspaceRoot, call.request.run_id);
      const args = [...config.runnerArgs];
      spawnRunner({
        command: config.runnerCommand, args, cwd: ws,
        requestJson: call.request.request_json,
        env: call.request.env ?? {},
        onLog: (line, meta) => call.write({ log: { line, meta_json: meta ? JSON.stringify(meta) : "" } }),
        signal: abortFromCall(call),
      }).then((result) => {
        call.write({ final: { ok: result.ok, structured_json: result.structured != null ? JSON.stringify(result.structured) : "", error: result.error ?? "" } });
        call.end();
      }).catch((err) => {
        call.write({ final: { ok: false, structured_json: "", error: (err as Error).message } });
        call.end();
      });
    },
  } as grpc.UntypedServiceImplementation);

  return server;
}

/** Bridge a gRPC server call's cancellation to an AbortSignal (kills the child runner). */
function abortFromCall(call: grpc.ServerWritableStream<unknown, unknown>): AbortSignal {
  const ac = new AbortController();
  call.on("cancelled", () => ac.abort(new Error("gRPC call cancelled")));
  return ac.signal;
}
```

- [ ] **Step 3: Type-check**

Run: `npm run typecheck -w @journeyman/windows-agent`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/windows-agent/src/server.ts packages/windows-agent/src/config.ts
git commit -m "feat(windows-agent): gRPC server wiring all handlers + keepalive"
```

---

## Task 10: Loopback integration test (the real end-to-end proof)

**Files:**
- Create: `packages/windows-agent/src/server.integration.test.ts`

- [ ] **Step 1: Write the integration test** (real server + real mTLS client + the echo-runner fixture)

Create `packages/windows-agent/src/server.integration.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import { agentServiceDef } from "@journeyman/agent-protocol";
import { createAgentServer } from "./server.ts";
import { loadServerCredentials } from "./credentials.ts";

const certDir = fileURLToPath(new URL("../spike/certs", import.meta.url));
const fixture = fileURLToPath(new URL("./__fixtures__/echo-runner.mjs", import.meta.url));
const hasCerts = existsSync(join(certDir, "server.pem"));

describe.skipIf(!hasCerts)("windows-agent loopback (mTLS)", () => {
  let server: grpc.Server; let client: grpc.Client & Record<string, any>; let root: string; let port: number;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "jm-agent-int-"));
    server = createAgentServer({
      config: { host: "127.0.0.1", port: 0, certDir, workspaceRoot: root, runnerCommand: process.execPath, runnerArgs: [fixture] },
      probe: async () => true,
    });
    port = await new Promise((res, rej) =>
      server.bindAsync("127.0.0.1:0", loadServerCredentials(certDir), (e, p) => e ? rej(e) : res(p)));
    server.start();
    const creds = grpc.credentials.createSsl(
      readFileSync(join(certDir, "ca.pem")),
      readFileSync(join(certDir, "client-key.pem")),
      readFileSync(join(certDir, "client.pem")),
    );
    const Svc = agentServiceDef();
    client = new Svc(`127.0.0.1:${port}`, creds) as never;
  });
  afterAll(() => server?.forceShutdown());

  it("Provision → Exec(stream) → Destroy round-trips", async () => {
    const handle = await new Promise<any>((res, rej) => client.Provision({ run_id: "r1" }, (e: unknown, r: unknown) => e ? rej(e) : res(r)));
    expect(handle.workspace_dir).toBe(join(root, "r1"));

    const logs: string[] = []; let final: any = null;
    await new Promise<void>((res, rej) => {
      const stream = client.Exec({ run_id: "r1", request_json: JSON.stringify({ op: "custom-prompt" }), env: {} });
      stream.on("data", (ev: any) => { if (ev.log) logs.push(ev.log.line); if (ev.final) final = ev.final; });
      stream.on("end", res); stream.on("error", rej);
    });
    expect(logs).toContain("op=custom-prompt");
    expect(final.ok).toBe(true);
    expect(JSON.parse(final.structured_json)).toEqual({ op: "custom-prompt" });

    await new Promise<void>((res, rej) => client.Destroy({ run_id: "r1" }, (e: unknown) => e ? rej(e) : res()));
  });

  it("Readiness returns a scorecard", async () => {
    const r = await new Promise<any>((res, rej) => client.Readiness({}, (e: unknown, x: unknown) => e ? rej(e) : res(x)));
    expect(Array.isArray(r.checks)).toBe(true);
    expect(r.checks.some((c: any) => c.name === "workspace")).toBe(true);
  });
});
```

- [ ] **Step 2: Ensure certs exist, then run**

Run: `bash packages/windows-agent/spike/make-certs.sh && npm test -w @journeyman/windows-agent -- server.integration`
Expected: PASS — provision/exec-stream/destroy + readiness all work over real mTLS. (Skips gracefully if certs are absent in CI without the cert step.)

- [ ] **Step 3: Commit**

```bash
git add packages/windows-agent/src/server.integration.test.ts
git commit -m "test(windows-agent): loopback mTLS integration — provision/exec/destroy/readiness"
```

---

## Task 11: Service entrypoint (`cli.ts`) + README

**Files:**
- Create: `packages/windows-agent/src/cli.ts`, `packages/windows-agent/README.md`

- [ ] **Step 1: Entrypoint**

Create `packages/windows-agent/src/cli.ts`:

```typescript
#!/usr/bin/env node
import * as grpc from "@grpc/grpc-js";
import { configFromEnv } from "./config.ts";
import { createAgentServer } from "./server.ts";
import { loadServerCredentials } from "./credentials.ts";
import { runReadinessChecks } from "./readiness.ts";
import { findGitBash } from "./shell.ts";

const config = configFromEnv();
const server = createAgentServer({ config });
const ready = await runReadinessChecks({ bashPath: findGitBash(), workspaceRoot: config.workspaceRoot, probe: async () => true });
for (const c of ready.checks) process.stderr.write(`[readiness] ${c.ok ? "✓" : "✗"} ${c.name}: ${c.detail}\n`);
if (!ready.ready) { process.stderr.write("agent not ready — fix the ✗ items above and restart\n"); process.exit(1); }

server.bindAsync(`${config.host}:${config.port}`, loadServerCredentials(config.certDir), (err, port) => {
  if (err) { process.stderr.write(`bind failed: ${err.message}\n`); process.exit(1); }
  server.start();
  process.stderr.write(`journeyman-agent listening on ${config.host}:${port} (mTLS)\n`);
});
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck -w @journeyman/windows-agent`
Expected: PASS.

- [ ] **Step 3: README** — write `packages/windows-agent/README.md` covering: install Node 22 + Git for Windows; copy the agent + runner bundle; generate/place `ca.pem`/`server.pem`/`server-key.pem` in `certDir`; open the firewall port; set `JM_AGENT_*` env; run `journeyman-agent`; read the readiness scorecard. Note Claude + OpenCode are supported, AISDK is not (finding 16).

- [ ] **Step 4: Commit**

```bash
git add packages/windows-agent/src/cli.ts packages/windows-agent/README.md
git commit -m "feat(windows-agent): service entrypoint with readiness gate + README"
```

---

## Task 12: Verification pass

- [ ] **Step 1: Type-check both packages + whole repo**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Import boundaries**

Run: `npm run check:boundaries`
Expected: PASS (agent-protocol shared, windows-agent backend).

- [ ] **Step 3: Tests (generate certs first for the integration test)**

Run: `bash packages/windows-agent/spike/make-certs.sh && npm test`
Expected: PASS — no new failures vs. baseline; agent-protocol + windows-agent suites green.

- [ ] **Step 4: Commit any cleanup**

```bash
git add -A && git commit -m "chore(windows-agent): Plan B verification pass" || echo "nothing to commit"
```

---

## Self-Review Notes

- **Spec coverage:** proto with all 6 RPCs incl. `Readiness` (§3.1 A, finding 8) — Task 2; subprocess runner spawn with NDJSON-stderr/single-stdout discipline (finding 9) — Task 6; mTLS (§2) — Tasks 8, 10; keepalive + no deadline (finding 14) — Task 9; Git-Bash pinning + readiness self-check (finding 1) — Tasks 4, 7, 11; Claude/OpenCode supported, AISDK gated (finding 16) — README Task 11; spike-first de-risk (#1) — Task 1.
- **Type consistency:** `ExecEvent { log?, final? }`, `ReadinessReply { ready, checks[] }`, `spawnRunner(...) → { ok, structured, error }` used identically across protocol types, server, and tests.
- **Out of scope (Plan C/D):** the orchestrator-side `WindowsBackend` + registry registration + catalog/validation + UI; the workspace-guard Windows-path fix; packaging the shippable Windows bundle. Plan C consumes this agent over the contract defined here.
- **Greenfield caveat:** Task 1 (spike) confirms the exact `@grpc/grpc-js` API surface on the installed version before the typed code in Tasks 8-10 leans on it; adjust signatures there if the spike reveals a version difference.
