# @journeyman/windows-agent

The always-on gRPC service that runs on a **Windows box** so Journeyman workflows can build, test, and run Windows-dependent code there. The orchestrator calls this agent over **mTLS**; on each `Exec` the agent spawns the existing `journeyman-runner` and streams its logs + result back.

See the design: [docs/superpowers/specs/2026-06-12-windows-sandbox-design.md](../../docs/superpowers/specs/2026-06-12-windows-sandbox-design.md).

## What it exposes (gRPC, mTLS)

`Readiness` · `Provision` · `Exec` (server-streaming logs → final result) · `Materialize` (tar upload) · `Destroy` · `List` — defined in `@journeyman/agent-protocol`.

## Prerequisites on the box (one-time)

**Required for the agent:**
- **Node.js 22** (runs the agent + the runner; also puts `node` on PATH for the Claude SDK).
- **Git for Windows** — provides `git` *and* the **Git Bash** the runner's shell tool needs. Ensure `git` is on the system PATH.
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

## Generating test certs (dev)

`spike/make-certs.sh` writes a throwaway CA + server/client certs into `spike/certs/` for the loopback integration test. Not for production.
