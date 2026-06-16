# Windows Sandbox — Design

**Date:** 2026-06-12
**Status:** Draft (design approved, pending written-spec review)
**Package(s):** `@journeyman/agent-protocol` (new), `@journeyman/sandbox`, `@journeyman/windows-agent` (new), `@journeyman/core`

## 1. Goal

Let workflows run on a real **Windows** machine the same way they run in Docker today — clone repos, build, test, and run native Windows-dependent code/products. The motivating workloads are a **classic Windows web stack**: IIS hosting **classic ASP + .NET**, a **SQL Server** database, and **headless browser QA automation** against those apps.

This adds a fourth execution-environment backend (`machine-windows`) behind the existing pluggable sandbox contract. Callers (orchestrator, worker harness) do not change — they already go through `registry.get(sandbox.type).create(worker).{provision,exec,destroy,materialize,list}`.

### Plain-language summary

A small always-on program (the **agent**) runs on the Windows box. The Linux orchestrator makes a secure network call (gRPC over mTLS) to that agent. For each run, the agent makes a fresh workspace folder and launches the **same `journeyman-runner`** we already ship into Docker, hands it the JSON request, and streams logs + the final result back. Nothing about *what* the runner does changes — only *how we reach it* (a secure call to an agent instead of `docker exec` into a container).

## 2. Decisions (locked)

| Dimension | Decision | Rationale |
|---|---|---|
| Topology | **One persistent, shared Windows box**; per-run workspace folders | Windows toolchains (VS, .NET, SQL Server, IIS) are heavy — install once, reuse every run. Ephemeral VMs would reinstall each time. |
| Connection | **gRPC agent** over the network | Typed contract, native server-streaming for live logs, journeyman-owned persistent service on the box. |
| Exec model | Agent **spawns the existing `journeyman-runner`** subprocess per `Exec` | Same stdio contract as Docker, per-run process isolation, runner bundle reused untouched. |
| Auth | **mTLS** (mutual certs) | The agent is a remote code-execution endpoint; both sides must present certs. |
| Agent runtime mode | **Background Windows service** (headless) | QA browser runs **headless**; nothing needs a visible desktop. IIS, SQL Server, headless browser all run as services. |
| Scope | **Contract + backend + agent**, manual install | Fastest path to running workflows end-to-end. Packaged installer is a later concern. |
| Breadth | **Focused, with extensibility seams** | Build only the headless-service case, but reserve a `session` flag, add capability `tags`, and document the machine-state isolation limit + future VM path. |

## 3. Architecture

```
┌─────────────────────────────┐                 ┌──────────────────────────────────┐
│ Linux · orchestrator        │   gRPC / mTLS   │ Windows box · always on            │
│                             │   (encrypted)   │                                    │
│  workflow run               │                 │  journeyman-agent (gRPC server)    │
│      │                      │  request ─────► │       │ spawns per run             │
│      ▼                      │  ◄──── logs +   │       ▼                            │
│  WindowsBackend (gRPC client)──── result      │  journeyman-runner (child proc)    │
│                             │                 │       │ works in                   │
│                             │                 │       ▼                            │
│                             │                 │  C:\jm-runs\<runId>  (workspace)   │
└─────────────────────────────┘                 └──────────────────────────────────┘
                                                  + operator-installed: IIS, .NET,
                                                    SQL Server, headless browser
```

### 3.1 Components

**A. `@journeyman/agent-protocol`** *(new shared package — single source for the contract)*
- The `.proto` definition + generated TS stubs, consumed by both the orchestrator-side backend (client) and the Windows agent (server). Lives in its own package so the contract has exactly one source of truth and neither side imports the other.
- Service shape:

```proto
service JourneymanAgent {
  rpc Readiness(ReadinessRequest) returns (ReadinessReply); // self-check scorecard (finding 1, 8)
  rpc Provision(ProvisionRequest) returns (ProvisionReply);
  rpc Exec(ExecRequest) returns (stream ExecEvent);          // log lines, then a final result event
  rpc Materialize(stream FileChunk) returns (MaterializeReply); // tar upload, replaces a dir
  rpc Destroy(DestroyRequest) returns (DestroyReply);
  rpc List(ListRequest) returns (ListReply);                 // enumerate run workspaces
}

message ReadinessReply {
  bool ready = 1;
  repeated ReadinessCheck checks = 2;   // {name, ok, detail} for bash, git, node, workspace, smoke-test
}

message ExecRequest {
  string run_id = 1;
  string request_json = 2;        // the runner's RunnerRequest JSON, verbatim
  map<string, string> env = 3;    // per-run secrets (e.g. SQL connection string)
}
message ExecEvent {
  oneof kind {
    LogLine log = 1;              // forwarded runner stderr (NDJSON {line, meta})
    ExecFinal final = 2;          // ok + structured/result + error  → maps to ExecResult
  }
}
```

- `Exec` is **server-streaming** so stderr log lines relay live (mirrors Docker's `onStderr`), with the final `ExecEvent` carrying the `RunnerResponse` JSON.

**B. `WindowsBackend`** — `packages/sandbox/src/backends/windows/windows-backend.ts`, implements `ExecutionEnvironmentBackend`:
- `type = "machine-windows"`, `supportedModes = ["shared"]`, `supportedConnectivity = ["agent"]`.
- `validateConfig(config)`: requires `connection.host`, `connection.port`, and a `connection.certDir`; rejects anything else.
- `create(worker)`: builds a gRPC client (mTLS credentials read from `certDir` on disk, mirroring `makeDockerClient`) and returns a `WindowsExecutionEnvironment`.

**C. `WindowsExecutionEnvironment`** — same dir, implements `IExecutionEnvironment`:

| Method | Behaviour |
|---|---|
| `provision(runId, spec)` | `Provision` RPC → agent creates `<workspaceRoot>\<runId>`. Returns `ProvisionedEnv { runId, type: "machine-windows", handle: "win:<runId>", workspaceDir: "C:\\jm-runs\\<runId>", volume: undefined }`. |
| `exec(env, op)` | Builds the `RunnerRequest` JSON exactly as Docker does (`{ op, provider, opts: { ...stdin, cwd: workspaceDir } }`) → `Exec` RPC → relays `LogLine` events to `op.onLog` → maps the final `ExecEvent` to `ExecResult`. Honors `op.signal` via gRPC call cancellation. |
| `materialize(env, destDir, bundle)` | Streams the tar over `Materialize`; agent **clears `destDir` then extracts** (same replace semantics the contract requires). |
| `destroy(env)` | `Destroy` RPC removes the workspace folder. Idempotent (missing folder = success). |
| `list(filter)` | `List` RPC enumerates `<workspaceRoot>\*` → `ProvisionedEnv[]` (powers the existing prune route). |

**D. `@journeyman/windows-agent`** *(new deployable package — the service that runs on the box)*
- Node gRPC server implementing the service. On `Exec`, spawns the **existing `journeyman-runner`** child process (same bundle that ships into Docker), writes the JSON request to stdin, streams stdout/stderr back over the gRPC stream, returns the final response.
- mTLS **server** credentials (server cert/key + client CA to verify the orchestrator).
- Config: listen address/port, cert paths, `workspaceRoot` (default `C:\jm-runs`), max concurrent runs, and a reserved `session` mode (see §7).
- Runs as a **background Windows service** (headless). Ships with the runner bundle + Node available on PATH (the runner self-sets `IS_SANDBOX=1`; on Windows there is no root, but the env is set for parity).
- **Deterministic shell pinning (see §12, finding 1):** on startup the agent locates Git Bash (Git install dir / registry / PATH) and pins its absolute path for the runner's shell tool, so every box behaves identically regardless of where Git was installed.
- **Readiness self-check (see §12, finding 1):** on startup and on demand (the Test-connection button, §4.1), the agent verifies its own environment — bash, git, node, workspace writability, plus a tiny `git clone` + command smoke test — and reports a pass/fail scorecard. If a required check fails, the agent **refuses runs up front** with an actionable message (e.g. "Git Bash not found — install Git for Windows") rather than failing mid-run.

### 3.2 Wiring / integration points

- **Backend selection is registry-driven (after the Phase 0 refactor, §3.3).** Today the run path is a scattered type-switch (`if type === "docker" …`) and the registry is unused (finding 7). Rather than add a fourth `if (windows)` to every site, Phase 0 makes the existing registry the single seam, so adding `machine-windows` (and every future type) is **implement one backend + register it once** — no edits to the shared call sites. See §3.3 for the refactor; the Windows backend then drops onto the clean foundation.
- **Catalog** — `SANDBOX_CATALOG` (`packages/sandbox/src/sandbox-catalog.ts`): update the `machine-windows` entry from `status: "planned"` → `"available"`, `supportedModes: ["shared"]`, `supportedConnectivity: ["agent"]`, label "Windows machine (agent)". The catalog↔registry drift test keeps this honest.
- **Instance store** — `jm_sandbox_instances.connection` is currently typed `DockerConnection`. Generalize the column's TS type to a union `SandboxConnection = DockerConnection | WindowsAgentConnection`, where `WindowsAgentConnection = { host: string; port: number; certDir?: string }`. The DB column is already `jsonb`, so **no migration is required** — only the TS type widens. The Windows env persists its connection here (type `machine-windows`, `handle: "win:<runId>"`, `volume: null`) so any worker process can rebuild the client to exec/destroy/reconnect — exactly how Docker persists its daemon connection today.

### 3.3 Phase 0 — centralize backend selection (registry-driven)

The current run path chooses backends with scattered `if (type === …)` branches and ignores the registry (finding 7). Before adding Windows, refactor so the registry is the **single backend-selection seam**. This is a behavior-preserving refactor of the existing `local` + `docker` paths, guarded by the existing contract test, the per-backend tests, and the catalog↔registry drift test.

**Changes:**

1. **Backends become self-contained.** Each `ExecutionEnvironmentBackend.create(worker: ResolvedSandbox)` builds a fully-wired `IExecutionEnvironment`, including its own client, from `worker.config`:
   - `DockerBackend` reads `worker.config.connection` and builds its client via a `makeClient(connection)` factory (the per-connection logic currently inlined in `cli-worker.ts` moves here); keeps `defaultImage`/`runnerCmd`.
   - `WindowsBackend` reads `worker.config.connection` (incl. `certDir`) and builds the mTLS gRPC client via `makeWindowsAgentClient(connection)`.
   - `LocalBackend` keeps its `runOperation` + `baseDir` deps.
2. **Run-gating moves into a backend hook.** Add an optional `ExecutionEnvironmentBackend.checkRunnable?(worker): void | Promise<void>`. `DockerBackend` implements the image-readiness gate (the docker-only `if` currently in `ensure-workspace.ts`); other backends no-op. `ensure-workspace` calls `backend.checkRunnable?.(worker)` generically.
3. **One composition root.** Build the registry once (`createDefaultRegistry({ local, docker, windows })`) and share it across the worker (provision/exec) and api-server (teardown). `createDefaultRegistry` is extended so `docker`/`windows` deps each carry a per-connection client factory rather than a single pre-built client.
4. **Call sites collapse to registry lookups:**
   - `ensure-workspace.ts` provision + `connect()` reconnect → `const b = registry.get(worker.type); await b.checkRunnable?.(worker); const env = b.create(worker); … env.provision(runId, spec)`. The `provisionLocal`/`provisionDocker` closures in `cli-worker.ts` are deleted.
   - `composition.ts` `destroyByType` → `registry.get(sb.type).create(asResolved(sb)).destroy(env)`. The per-type switch is deleted.
   - `worker-harness.ts` exec routing is already type-agnostic (`wsEnv.exec`) — unchanged.

**Outcome:** adding `machine-windows` (Phase 1) is **one backend class + one `createDefaultRegistry` registration + catalog entry** — zero edits to the shared provision/teardown/exec call sites. Same for any future type (ecs/ec2/kubernetes).

## 4. Configuration

The sandbox record's `config` (validated by `WindowsBackend.validateConfig`) holds only connection details:

```jsonc
{
  "connection": { "host": "win-box.internal", "port": 50051, "certDir": "/etc/journeyman/win-certs" },
  "workspaceRoot": "C:\\jm-runs",   // optional, default
  "session": "service",             // reserved seam: "service" (only supported value now) | "interactive" (future)
  "tags": ["os:win11", "has-iis", "has-sqlserver", "has-chrome-headless"]  // capability tags for box selection
}
```

- `connection.certDir` is a folder **on the orchestrator host** holding `ca.pem`/`cert.pem`/`key.pem` for the mTLS client — read from disk at client-build time, exactly like Docker's `makeDockerClient` (finding 4). Placed there by deployment; not stored in the DB.
- Per-run secrets (**SQL connection string**, test-account passwords) are **not** here; they ride along per-run as `op.env` environment variables resolved from the secrets vault, exactly like today.

### 4.1 Create/update UX & documentation (required)

When a user **creates or updates** a `machine-windows` sandbox in the UI, the form must show **clear, inline guidance** — a user should not need to read the source to configure it correctly:

- **Field help** for each field: what `agent.host` / `agent.port` mean, what each of the three cert references is and how to generate them, what `workspaceRoot` defaults to, and what `tags` are for.
- **A prerequisites checklist** surfaced at create time (collapsible): the §8 "must install" list (Node 22, Git, agent+runner files, certs, firewall port) plus a note that product tools (IIS, .NET, SQL Server, browser+driver) are the operator's responsibility.
- **A "test connection" affordance** (or at least a clear note) so the user can confirm the agent is reachable and the certs match before saving — mirrors the existing Docker daemon connection-test pattern.
- **Validation messages** that are actionable: e.g. "Couldn't reach the agent at host:port — is the agent running and the firewall port open?", "Certificate mismatch — the agent rejected this client cert."

This guidance lives next to the form (help text / panel), and the full setup walkthrough lives in the package README (`packages/windows-agent/README.md`) and the docs site. The form links to it.

## 5. Data flow (one run)

1. Worker resolves the sandbox → `machine-windows` → `WindowsBackend.create(worker)` builds the mTLS gRPC client.
2. `provision(runId)` → `Provision` RPC → agent `mkdir C:\jm-runs\<runId>` → `ProvisionedEnv` persisted in `jm_sandbox_instances` with the agent connection.
3. (If the step stages skills/files) `materialize(env, destDir, bundle)` → `Materialize` stream → agent clears + extracts the tar.
4. `exec(env, op)` → `Exec` RPC with `request_json` + per-run `env` → agent spawns `journeyman-runner`, pipes the request to stdin → streams `LogLine` events (→ `op.onLog`) → final `ExecFinal` → `ExecResult`.
5. On completion/cancel/failure: `destroy(env)` → `Destroy` RPC removes the workspace folder; instance row marked destroyed.

## 6. Error handling

| Situation | Behaviour |
|---|---|
| Box unreachable / agent down | `provision`/`exec` fail fast with a clear "couldn't reach Windows agent at host:port" error; run fails like any sandbox error. |
| Bad/expired/mismatched certs | mTLS handshake fails with an explicit cert error — **no** silent fallback to insecure. |
| Build/test/run command fails | Runner returns `{ ok: false, error }`; relayed over gRPC as `ExecResult` with `ok: false` — normal step failure. |
| Run cancelled mid-flight | `op.signal` cancels the gRPC call → agent **kills the child runner** and cleans the workspace folder. |
| Crashed/abandoned runs | Existing prune admin route → `list()` → agent reports leftover `C:\jm-runs\*` folders for cleanup. |
| Runner emits no JSON | Same envelope-error path as Docker (`runner produced no JSON …`). |

## 7. Extensibility seams (built now, used later)

These are near-free to reserve now and avoid a redesign when the broader Windows landscape (see §10) arrives:

1. **`session` flag** (`"service" | "interactive"`). Only `"service"` is implemented. Reserving it — and structuring the agent so it can be *launched* either as a background service or inside an auto-login interactive desktop session — means desktop GUI automation (WinAppDriver, visible-browser QA, Office interop, installer UIs) can be added later without reworking the contract.
2. **Capability `tags`** on the sandbox (e.g. `has-visual-studio`, `has-sqlserver`, `interactive`, `os:win11`). Lets a workflow request "a Windows box that can sign code" rather than hard-coding a machine. Pays off the moment a second Windows box exists. (Selection logic itself is out of scope here; the field is reserved and surfaced.)

## 8. Operator prerequisites (manual install, one-time)

**Required for the agent to function:**
- **Node.js 22** — runs the agent and the runner; also puts `node` on PATH for the Claude SDK.
- **Git for Windows** — repo cloning; also provides `ssh` for `git@…` repos. Ensure `git` is on the system PATH.
- **journeyman-agent + journeyman-runner** files copied onto the box.
- **mTLS certificates** — server cert/key + client CA, in a folder the agent reads.
- **One inbound firewall rule** for the agent's gRPC port (e.g. 50051).

**Required for *these* workloads (product-specific):**
- **IIS** + Classic ASP feature + ASP.NET — host/run the apps.
- **.NET Framework / .NET SDK + MSBuild** — build the code.
- **SQL Server** (local) *or* a reachable SQL Server — the database.
- **Headless browser + matching WebDriver** (e.g. Chrome/Edge + driver) — QA automation.

**Not needed:** Docker; AI provider keys baked onto the box (sent per-run from the secret vault).

### Using a Windows 11 laptop as the box

A normal Windows 11 laptop is a fine box — "headless" describes the *browser*, not the machine. Practical caveats are about reachability, not the OS:
- **Don't let it sleep** while acting as the box (the agent can't answer if it's asleep).
- **The orchestrator must reach it** on the gRPC port (same LAN or VPN + the firewall rule).
- **Pin a stable hostname/IP** — laptops change IPs across networks.

## 9. Testing

The agent is **plain Node** — not Windows-specific in its *code*, it just normally lives on a Windows box. This gives a strong test story:

- **Unit tests:** `WindowsBackend` / `WindowsExecutionEnvironment` against a **fake in-memory gRPC server** — no real box.
- **Contract tests:** run the **real agent locally** (even on Linux CI) on a loopback port with test certs, and run it through the shared `runExecutionEnvironmentContract()` suite that `local` and `docker` already pass — proving provision → materialize → exec → destroy → list for real, with mTLS.
- **Manual Windows smoke test:** documented steps to point a dev orchestrator at a real Windows box (or a Windows 11 laptop) and run one workflow end-to-end.

## 10. Out of scope / known limitations

- **Machine-state isolation is files-only.** Per-run workspace folders isolate **files**, not machine-wide state: SQL Server data, IIS sites, **ports**, the registry, the GAC, installed certs, machine env. Two runs that both `iisreset`, seed the same DB, or bind the same port **will collide**. This design is right for build/test/QA on a shared box; it is **not** suitable for destructive/stateful work (e.g. "install this MSI and check the registry"). The future path for that is the **per-run or pooled VM topology** (snapshot → run → revert) discussed during brainstorming — explicitly deferred.
- **One box = one OS + one toolchain set.** Cross-platform matrices (Windows Server vs Windows 11, multiple .NET/VS versions) are served by **registering multiple Windows sandboxes**, not by this single backend. Already supported by the model.
- **Interactive desktop mode** (visible-browser QA, WinAppDriver, Office interop) — reserved via the `session` flag (§7) but not implemented.
- **Box-selection by capability tags** — the field is reserved/surfaced; routing logic is not built here.
- **Packaged installer / NSSM service wrapper / cert-bootstrap helper** — manual install for now (per scope decision).

## 11. Files touched / added

**New:**
- `packages/agent-protocol/` — `.proto`, generated stubs, package boilerplate.
- `packages/sandbox/src/backends/windows/windows-backend.ts`
- `packages/sandbox/src/backends/windows/windows-execution-environment.ts`
- `packages/sandbox/src/backends/windows/windows-grpc-client.ts` (mTLS client wrapper)
- `packages/sandbox/src/backends/windows/*.test.ts`, contract wiring
- `packages/windows-agent/` — the gRPC server, runner-spawn glue, service entrypoint, README (install + cert + firewall steps).

**Changed — Phase 0 refactor (registry-driven selection, §3.3):**
- `packages/core/src/types/execution-environment.types.ts` — add optional `checkRunnable?(worker)` to `ExecutionEnvironmentBackend`; `machine-windows` already in `SandboxType`.
- `packages/sandbox/src/backends/docker/docker-backend.ts` — `create(worker)` builds its client from `worker.config.connection` (via a `makeClient` factory); implements `checkRunnable` (image-readiness gate moved out of the orchestrator).
- `packages/sandbox/src/backends/local/local-backend.ts` — `create(worker)` unchanged in spirit; conforms to the registry path.
- `packages/sandbox/src/default-registry.ts` — `docker`/`windows` deps carry a per-connection client factory; registers all configured backends.
- `packages/orchestrator/src/sandbox/ensure-workspace.ts` — replace `provisionLocal`/`provisionDocker` closures + the docker image `if` with generic `registry.get(type)` + `checkRunnable` + `create` + `provision`; same for `connect()` reconnect.
- `packages/orchestrator/src/cli-worker.ts` — delete the hand-wired provision closures; build/share the registry.
- `packages/api-server/src/composition.ts` — replace `destroyByType` switch with `registry.get(sb.type).create(asResolved(sb)).destroy(...)`; share the same registry.

**Changed — Phase 1 (Windows):**
- `packages/sandbox/src/sandbox-catalog.ts` — `machine-windows` → available.
- `packages/sandbox/src/sandbox-instance-store.ts` — widen `connection` type to `SandboxConnection` union.
- Sandbox create/update form — inline field help, prerequisites checklist, connection-test affordance, and actionable validation messages for the `machine-windows` type (§4.1).
- `packages/windows-agent/README.md` — full setup walkthrough (install, certs, firewall), linked from the form.
- Import-boundary allowances if `agent-protocol` introduces a new edge.

## 12. Dry-run findings — Windows portability & safety

A trace of one full run against the current code (orchestrator call sequence, the Docker pattern we mirror, and the runner's Windows-portability) confirmed the architecture holds. It also surfaced these items, captured here and folded into scope.

**Confirmed OK (no change):** "one shared box + per-run folders" works — the harness calls `provision`/`destroy` once per run regardless of `executionMode`; image-readiness gating is `docker`-only so `machine-windows` is never blocked; per-run secrets already flow through the secret resolver into `op.env`; the runner's PATH handling and workspace path-resolver already use cross-platform `node:path`.

### Finding 1 — The runner's shell tool needs a Unix-style (bash) shell  *(resolved via agent self-check)*
The runner's git operations and the Claude `Bash` tool assume bash. Native Windows has no bash by default — but **Git for Windows (already a prerequisite) ships Git Bash**, and Claude Code supports Windows. This is the load-bearing assumption.
- **One-time (dev):** a small spike proving `runCustomPrompt` + `git clone` works on a real Windows box — validates the *code*.
- **Per-machine (automatic):** the agent does **deterministic shell pinning** (locates and locks Git Bash) and a **readiness self-check** that fails fast with an actionable message, surfaced as a green/red scorecard on the Test-connection button (§3.1 D, §4.1). This is how we verify *every* box without logging into each one.

### Finding 2 — Workspace-confinement guard only recognizes POSIX paths  *(must-fix, security)*
The workspace "fence" (`packages/agent-runtime/src/workspace-guard/extract-paths.ts`, `findBashEscape`) detects out-of-workspace access by matching POSIX absolute paths (`/…`). It does **not** match Windows drive paths (`C:\…`) or UNC paths (`\\server\share`), so on Windows the AI could escape its workspace undetected. The core resolver (`resolve.ts`) is already cross-platform; only the escape-detection regex needs Windows shapes added. Security-relevant — must fix before any real Windows run.
### Finding 3 — Hardcoded `/` separators and `/workspace` convention  *(low risk, contained)*
Two path-spelling issues:
- **3a (fix old code):** `packages/skills/src/bundle-skills.ts` `dirsCommonParent()` finds a parent dir via `lastIndexOf("/")` → returns garbage on Windows paths. Replace with `node:path` `dirname()`. One-liner.
- **3b (build new code right):** Docker fixes the workspace at `/workspace`; Windows uses `C:\jm-runs\<runId>`. The new agent's `exec` must set the runner `cwd` to the **real** Windows folder (not `/workspace`), and `materialize` must map any incoming `/workspace/...` destination onto the Windows workspace dir. New code, so handled correctly from the start — but explicitly called out.

Neither threatens the design; both are caught by the readiness self-check (finding 1) and the shared `IExecutionEnvironment` contract test.
### Finding 4 — mTLS certs come from a `certDir` on disk, not the secrets vault  *(spec correction)*
The original spec resolved the orchestrator's mTLS client certs from the secrets vault. The existing Docker backend does **not** do that — `makeDockerClient` reads `ca.pem`/`cert.pem`/`key.pem` from a `certDir` path on disk (placed there by deployment), and the path lives in the sandbox `config`/`connection`. **Correction: mirror Docker** — the Windows config carries a `certDir` (connection certs read from disk). This is separate from **per-run secrets** (SQL connection string, passwords), which still resolve from the vault into `op.env` per run, unchanged.
### Finding 5 — The client is built in two places (provision *and* teardown)  *(wiring note)*
The sandbox connection is constructed twice in a run's life: at start by the worker (`cli-worker` provision path) and at end by a separate teardown path (`packages/api-server/src/composition.ts` `sandboxReaper`/`destroyByType`), which **rebuilds the client from the persisted connection** because the original worker may be gone. Docker centralizes this in `makeDockerClient(connection)`, called from both. **Mirror it:** one `makeWindowsAgentClient(connection)` factory wired into **both** the provision and teardown paths. Miss the teardown wiring → workspace folders accumulate on the box and never get cleaned up. No design change; just must wire both.
### Finding 6 — New dependencies + package registration  *(housekeeping)*
- **6a:** the repo has **no** gRPC libraries today. Add the standard `@grpc/grpc-js` + a `.proto` loader (e.g. `@grpc/proto-loader` or `ts-proto` for generated types) to the new packages.
- **6b:** register the two new packages in the import-boundary rulebook (`scripts/check-import-boundaries.mjs` `PKG_LAYER`): `@journeyman/agent-protocol` (shared) and `@journeyman/windows-agent` (backend), so `npm run check:boundaries` passes. Mechanical, ~few lines.

---

*Second dry-run pass (run-path wiring, runner stdio discipline, gRPC edges):*

### Finding 7 — Backend selection is a procedural type-switch, not the registry  *(resolved via Phase 0 refactor)*
The production run path does **not** use `InMemoryExecutionEnvironmentRegistry`/`createDefaultRegistry` (they're test-only); backends are chosen by scattered `if (type === …)` branches across ensure-workspace, cli-worker, and composition. Per the user's call, we don't perpetuate the smell by adding a fourth `if (windows)` everywhere. Instead, **Phase 0 (§3.3) makes the registry the single backend-selection seam** — pushing client/cert construction and run-gating into each backend — so adding Windows (and future types) is one backend class + one registration, with no edits to the shared call sites. Behavior-preserving for local/docker, guarded by existing tests.

### Finding 8 — Contract needs a `Readiness` RPC  *(added to proto)*
The self-check (finding 1) and Test-connection (§4.1) need a health call. Added `Readiness(ReadinessRequest) → ReadinessReply { ready, checks[] }` to the `.proto` (§3.1 A).

### Finding 9 — Runner stdout/stderr discipline is airtight  *(confirmed — validates the streaming design)*
Verified the gRPC streaming approach is safe: the runner (`cli.ts` `guardRunnerStdout()`) writes **exactly one** `RunnerResponse` JSON to stdout and reroutes stray `console.log`/`console.info` to stderr; all logs go to stderr as NDJSON `{line, meta}`; `op.signal` propagates into the SDK `query()` abort controller so killing the child cleanly cancels; no temp files are left behind. So: agent streams stderr lines as `LogLine` events, captures stdout, emits it as the final `ExecFinal`. Two reinforcements: (a) the agent must ensure **Node is on PATH** before spawning the runner (the SDK spawns `node` by bare name — covered by the readiness check); (b) the agent must clear a run's `destDir` with **Node `fs.rm`**, not a `sh -c rm -rf` (Docker's materialize uses a shell *inside the Linux container*; the Windows agent can't — folds into finding 3b). Also set a generous gRPC **max-message-size** so a large `ExecFinal` structured result isn't truncated (logs are streamed, so unaffected).
