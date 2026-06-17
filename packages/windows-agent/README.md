# @journeyman/windows-agent

The always-on gRPC service that runs on a **Windows box** so Journeyman workflows can build, test, and run Windows-dependent code there. The orchestrator calls this agent over **mTLS**; on each `Exec` the agent spawns the existing `journeyman-runner` and streams its logs + result back.

See the design: [docs/superpowers/specs/2026-06-12-windows-sandbox-design.md](../../docs/superpowers/specs/2026-06-12-windows-sandbox-design.md).

## What it exposes (gRPC, mTLS)

`Readiness` · `Provision` · `Exec` (server-streaming logs → final result) · `Materialize` (tar upload) · `Destroy` · `List` — defined in `@journeyman/agent-protocol`.

## Prerequisites on the box (one-time)

**Required for the agent:**
- **Node.js 22** (runs the agent + the runner; also puts `node` on PATH for the Claude SDK).
- **Git for Windows** — provides `git` *and* the **Git Bash** the runner's shell tool needs. Ensure `git` is on the system PATH.
- **curl** — ships with Windows 10 1803+ (`curl.exe`); ensure it's on the system PATH so steps/AI can reach HTTP endpoints. The readiness scorecard checks for it.
- The **agent + runner bundle** copied onto the box (see Packaging, Plan D).
- **mTLS certs** in `JM_AGENT_CERT_DIR`: `ca.pem`, `server.pem`, `server-key.pem`.
- One **inbound firewall rule** for `JM_AGENT_PORT` (default 50051).

**Required for your workloads (product-specific):** IIS + Classic ASP/ASP.NET, .NET SDK / MSBuild, SQL Server (local or reachable), a headless browser + WebDriver.

**Coding providers on Windows:** **Claude** ✅ (uses Git Bash) and **OpenCode** ✅ (ships a native `opencode.exe`) are supported. **AISDK is not supported on Windows** (it hardcodes `bash`/`rg`). Gemini/Codex are unimplemented.

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `JM_AGENT_HOST` | `0.0.0.0` | bind host |
| `JM_AGENT_PORT` | `50051` | bind port |
| `JM_AGENT_CERT_DIR` | `C:\journeyman\certs` | folder with `ca.pem`/`server.pem`/`server-key.pem` |
| `JM_AGENT_WORKSPACE_ROOT` | `C:\jm-runs` | per-run workspace folders live here |
| `JM_AGENT_RUNNER_CMD` | the agent's `node` | command to launch the runner |
| `JM_AGENT_RUNNER_ARGS` | `C:\journeyman\runner.js` | args (the runner bundle path) |

## Run it

```
journeyman-agent
```

On startup it prints a **readiness scorecard** (bash / git / node / workspace) and **refuses to start** if a required check fails — so a misconfigured box is caught immediately, not mid-run.

## Long builds (step timeout)

Windows build/QA steps often exceed the default **10-minute** step timeout. Raise it per step on the **Retry** tab (or for the whole flow under **Defaults → Retry**) — e.g. `2700` seconds for large .NET builds. That value flows to Conductor's `timeoutSeconds` *and* `responseTimeoutSeconds` for the step, and the agent's gRPC keepalive holds the connection open during quiet compile stretches.

## Packaging & install

Build a shippable bundle:

```
node scripts/build-windows-agent.mjs
```

This writes `packages/windows-agent/dist/`:
- `windows-agent.js` — the bundled agent entrypoint
- `journeyman-agent.proto` — loaded at runtime (kept beside the bundle)
- `manifest.json` — entry + externals + box requirements

To install on a box: copy `dist/` + the **runner bundle** (`runner.js` + prod `node_modules`) to the machine; install **Node 22** and **Git for Windows**; `npm ci --omit=dev` for the externals (`@grpc/grpc-js`, `@grpc/proto-loader`, `tar`); place certs in `JM_AGENT_CERT_DIR`; open the firewall port; run `node windows-agent.js` (or register it as a Windows service). A full installer / NSSM service wrapper and auto-bundling the Node binary are a later iteration.

## Generating test certs (dev)

`spike/make-certs.sh` writes a throwaway CA + server/client certs into `spike/certs/` for the loopback integration test. Not for production.
