# Connecting a Windows Machine as a Journeyman Sandbox

This guide sets up a **Windows box** (a laptop, desktop, or server) so Journeyman can run workflows on it — clone repos, build native Windows code (.NET / MSBuild / IIS), run SQL Server, and run headless browser QA — just like it does in Docker for Linux.

> **New to this?** Read the "Big picture" first. Then follow the parts in order. Each part has a ✅ checklist so you can track progress.

---

## Big picture

There are **two machines**:

```
┌──────────────────────────────┐         mTLS gRPC          ┌────────────────────────────────┐
│  Orchestrator (Linux)         │  ───── secure call ─────►  │  Windows box                    │
│  • the Journeyman app          │                            │  • journeyman-agent (you run it) │
│  • holds the CLIENT certs      │  ◄──── logs + result ────  │  • holds the SERVER certs        │
└──────────────────────────────┘                            │  • spawns journeyman-runner      │
                                                              │  • Node + Git + your toolchain   │
                                                              └────────────────────────────────┘
```

- **You install and start a small program — the agent — on the Windows box.** It sits there listening.
- **Journeyman calls into it** over a secure, encrypted line (mTLS gRPC).
- **You only start the agent once.** After that, every workflow run is automatic: Journeyman makes a fresh workspace folder, runs the job, streams logs back, and cleans up.

**Manual vs automatic, in one line:** *you* host + start the agent (once); *Journeyman* drives every run on it (automatically).

---

## Prerequisites at a glance

**On the Windows box — required (the agent needs these to run at all):**
- [ ] Node.js 22
- [ ] Git for Windows (gives you `git` **and Git Bash** — the agent needs it)
- [ ] The agent + runner files (built in Part 1)
- [ ] Server certificates (Part 2)
- [ ] One open inbound firewall port (default **50051**)

**On the Windows box — optional, only if a workflow uses it (per your product):**
- [ ] **Python 3** — only for steps/agents that run Python. Reported as an *advisory* line in the readiness scorecard (a missing interpreter does **not** block startup). Install from python.org or the Microsoft Store and confirm `python --version` works in Git Bash.
- [ ] IIS + Classic ASP / ASP.NET — only for steps that host/run those apps
- [ ] .NET SDK / MSBuild — only for steps that build .NET code
- [ ] SQL Server (local or reachable) — only for steps that need the database
- [ ] A headless browser + matching WebDriver — only for browser QA steps
- [ ] **Serena + a language server** — **required** if any step or agent enables the Serena (code-intelligence) MCP. Serena runs as a local program on this box, so it must be installed here or that MCP fails at run time (the step falls back to plain grep). See **Part 3b**.

> The agent doesn't care what's installed — it just runs whatever commands your steps issue. A box with only the **required** list can already clone repos and run, e.g., PowerShell or Node workflows. Add a toolchain piece **when a workflow needs it**, not before.

**On the orchestrator host:**
- [ ] Client certificates (Part 2)
- [ ] Network access to the Windows box on the agent port

---

## Part 1 — Build the agent + runner (on your dev machine)

There's no installer yet, so you build two bundles in the repo and copy them over.

```bash
# in the journeyman repo, on your dev machine
npm install                                       # make sure deps are linked
node scripts/build-windows-agent.mjs              # → packages/windows-agent/dist/
npm run bundle -w @journeyman/agent-runtime       # → packages/agent-runtime/dist/runner.js
```

You now have:
- `packages/windows-agent/dist/` — `windows-agent.js`, `journeyman-agent.proto`, `manifest.json`
- `packages/agent-runtime/dist/runner.js` — the worker that actually does the AI/build work

You'll copy these to the box in Part 3.

✅ **Done when:** both `dist/` outputs exist.

---

## Part 2 — Certificates (the mutual ID cards)

The two machines prove who they are with certificates. There is **one shared CA**; the box gets a **server** cert, the orchestrator gets a **client** cert.

On any machine with `openssl`:

```bash
# 1) One CA, shared by both sides
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca-key.pem -out ca.pem \
  -days 825 -subj "/CN=jm-ca"

# 2) SERVER cert for the Windows box.
#    IMPORTANT: the SAN must match how the orchestrator will address the box
#    (its hostname or IP) — this is the #1 thing people get wrong.
openssl req -newkey rsa:2048 -nodes -keyout server-key.pem -out server.csr \
  -subj "/CN=win-box"
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial \
  -out server.pem -days 825 \
  -extfile <(printf "subjectAltName=DNS:win-box,IP:192.168.1.50")   # ← your box's hostname/IP

# 3) CLIENT cert for the orchestrator
openssl req -newkey rsa:2048 -nodes -keyout client-key.pem -out client.csr \
  -subj "/CN=jm-orchestrator"
openssl x509 -req -in client.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial \
  -out client.pem -days 825
```

Now split the files:

| Goes on the **Windows box** (e.g. `C:\journeyman\certs`) | Goes on the **orchestrator** (e.g. `/etc/journeyman/win-certs`) |
|---|---|
| `ca.pem` | `ca.pem` |
| `server.pem` | `client.pem` |
| `server-key.pem` | `client-key.pem` |

✅ **Done when:** the box folder has `ca/server/server-key.pem`, and the orchestrator folder has `ca/client/client-key.pem`.

---

## Part 3 — Set up the Windows box

1. **Install** Node 22, Git for Windows, and your toolchain (see prerequisites).

2. **Copy the files** from Part 1 to the box, e.g. into `C:\journeyman\`:
   - the contents of `windows-agent/dist/` → `C:\journeyman\` (so `windows-agent.js` + `journeyman-agent.proto` sit together)
   - `runner.js` → `C:\journeyman\runner.js`
   - a production `node_modules` (the agent + runner need `@grpc/grpc-js`, `@grpc/proto-loader`, `tar`, `pino`, `@anthropic-ai/claude-agent-sdk`, …). Easiest: copy your repo's root `node_modules`, or run `npm ci --omit=dev` in a folder containing the agent + runner deps.

3. **Place the server certs** in `C:\journeyman\certs` (from Part 2).

4. **Open the firewall** for the agent port:
   ```powershell
   New-NetFirewallRule -DisplayName "Journeyman Agent" -Direction Inbound -Protocol TCP -LocalPort 50051 -Action Allow
   ```

5. **Start the agent** (PowerShell or cmd):
   ```bat
   set JM_AGENT_PORT=50051
   set JM_AGENT_CERT_DIR=C:\journeyman\certs
   set JM_AGENT_WORKSPACE_ROOT=C:\jm-runs
   set JM_AGENT_RUNNER_CMD=node
   set JM_AGENT_RUNNER_ARGS=C:\journeyman\runner.js
   node C:\journeyman\windows-agent.js
   ```

6. **Read the readiness scorecard.** A healthy start looks like:
   ```
   [readiness] ✓ bash: C:\Program Files\Git\bin\bash.exe
   [readiness] ✓ git: git on PATH
   [readiness] ✓ node: node on PATH
   [readiness] ✓ curl: curl on PATH — ships with Windows 10 1803+
   [readiness] ✓ python: python on PATH
   [readiness] ✓ workspace: C:\jm-runs
   journeyman-agent listening on 0.0.0.0:50051 (mTLS)
   ```
   Any ✗ line on a **required** check tells you exactly what to fix (usually "install Git for Windows" or "make `C:\jm-runs` writable"), and the agent refuses to start until those are green. `python` is **advisory** — a ✗ there is only a heads-up (install Python 3 if a workflow needs it) and does not block startup.

✅ **Done when:** you see "listening … (mTLS)".

> **Keep it running:** a bare `node …` stops when you close the window or reboot. Set the laptop to **never sleep** while it's acting as the box. For always-on use, register the agent as a **Windows service** (e.g. with NSSM) so it auto-starts on boot — a packaged installer for this is a planned follow-up.

---

## Part 3b — Install Serena (required for the code-intelligence MCP)

Serena is a **stdio MCP**: when a step or agent enables it, the runner **starts it as a local program on this Windows box**. Unlike a hosted MCP (which is just a URL), Serena must be **installed here** — otherwise enabling it fails with "command not found" and the step falls back to plain grep search.

> **This is mandatory if you intend to use the Serena MCP**, and it must be done on **every** Windows box that runs steps — there's no shared image like Docker. Skip it only if no workflow/agent will ever enable Serena.

1. **Install uv** (it brings Python with it — you don't install Python separately):
   ```powershell
   powershell -c "irm https://astral.sh/uv/install.ps1 | iex"
   ```
   uv installs to `%USERPROFILE%\.local\bin` — make sure that folder is on **PATH**.

2. **Install a language server** for each language your repos use (these power Serena's lookups). TypeScript/JavaScript example:
   ```powershell
   npm install -g typescript typescript-language-server
   ```
   (Python: `pip install python-lsp-server`; other languages: install the matching LSP.)

3. **Pre-warm Serena** so the first run doesn't pause to download it:
   ```powershell
   uvx --from git+https://github.com/oraios/serena serena-mcp-server --help
   ```

4. **Restart the agent** so it picks up the new PATH, then confirm in the **same shell that starts the agent**:
   ```powershell
   uvx --version
   typescript-language-server --version
   ```
   Both must print a version. The agent — and the runner it spawns — inherit this shell's PATH, so `uvx` must resolve here or the Serena MCP can't launch.

> **Two things, both required:** installing Serena here is the *program* (this part); enabling the Serena MCP in Journeyman is the *instruction to run it* (the MCP/connectors picker on a step or agent). You need **both** — the program with no instruction is never used; the instruction with no program fails.

✅ **Done when:** `uvx --version` works in the agent's shell, and a test run with the Serena MCP enabled starts without a "command not found" error.

---

## Part 4 — Register the box in Journeyman (orchestrator side)

In the web UI → **Sandboxes → New**:

| Field | Value |
|---|---|
| **Type** | Windows machine (agent) |
| **Agent host** | the box's hostname/IP — **must match the cert SAN** from Part 2 |
| **Agent port** | `50051` |
| **mTLS cert folder** | the orchestrator's client-cert folder, e.g. `/etc/journeyman/win-certs` |
| **Workspace root** | leave blank (defaults to `C:\jm-runs`) |

Click **Test connection** → you should get a green readiness scorecard reported back from the box. If not, see Troubleshooting.

✅ **Done when:** Test connection succeeds.

---

## Part 5 — Run a workflow on it

1. Open a workflow. On a step (or the flow's **Defaults**), set the **Sandbox** to your Windows box.
   > ⚠️ If you don't pin a sandbox, the step **silently runs locally**, not on Windows.
2. For long builds, raise the step **timeout** on the **Retry** tab (e.g. `2700` seconds for big .NET builds).
3. Run it. Clone → build → test all happen on the box; the run view streams the logs live.

**Coding providers:** **Claude** and **OpenCode** are supported on Windows. **AISDK is not** (it needs Linux tools) — pick Claude or OpenCode for Windows steps.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Test connection: "couldn't reach the agent" | Agent not running / port closed / wrong host | Confirm the agent prints "listening …"; open port 50051; check host = SAN |
| Test connection: certificate / handshake error | SAN doesn't match the host you typed, or wrong certs in a folder | Re-issue the **server** cert with the right `subjectAltName`; verify ca/client certs on the orchestrator |
| Readiness shows `✗ bash` | Git for Windows not installed | Install Git for Windows; restart the agent |
| Readiness shows `✗ workspace` | `C:\jm-runs` not writable | Create it / fix permissions |
| Run starts but the AI commands fail | `aisdk` provider chosen | Switch the step to Claude or OpenCode |
| Step killed after ~10 min | Default step timeout | Raise the timeout on the step's Retry tab |
| Step ran locally, not on Windows | Sandbox not pinned | Set the sandbox on the node or the flow default |
| Agent won't start: "failed to read mTLS certs" | Missing/incorrect server certs | Put `ca.pem`/`server.pem`/`server-key.pem` in `JM_AGENT_CERT_DIR` |
| Serena MCP step fails / "command not found" / silently falls back to grep | `uvx` or the language server isn't installed, or isn't on the agent's PATH | Do **Part 3b** on this box; restart the agent; verify `uvx --version` in the agent's shell |

---

## Glossary

- **Agent** — the small program you run on the Windows box; it listens for Journeyman and runs the worker for each job.
- **Runner** — the worker the agent launches per run; the same one Journeyman uses in Docker. It does the cloning/building/AI work.
- **mTLS** — "mutual TLS": both sides present certificates, so only your orchestrator can talk to your box and vice-versa.
- **SAN** — the hostname/IP baked into the server certificate; it must match the address you give Journeyman.
- **Readiness scorecard** — the agent's self-check (bash/git/node/workspace) printed at startup and returned by Test connection.

---

## Quick reference

| Thing | Value / command |
|---|---|
| Build agent bundle | `node scripts/build-windows-agent.mjs` |
| Build runner bundle | `npm run bundle -w @journeyman/agent-runtime` |
| Start the agent | `node C:\journeyman\windows-agent.js` (with `JM_AGENT_*` env set) |
| Default port | `50051` |
| Agent cert folder (box) | `JM_AGENT_CERT_DIR` → `ca.pem` + `server.pem` + `server-key.pem` |
| Orchestrator cert folder | the sandbox's "mTLS cert folder" → `ca.pem` + `client.pem` + `client-key.pem` |
| Workspaces on the box | `C:\jm-runs\<runId>` (created per run, deleted after) |
| Supported providers | Claude, OpenCode (not AISDK) |
| Install Serena (per box, for code-intelligence MCP) | `powershell -c "irm https://astral.sh/uv/install.ps1 \| iex"` |
| Serena language server (per language) | `npm install -g typescript typescript-language-server` |
| Pre-warm Serena | `uvx --from git+https://github.com/oraios/serena serena-mcp-server --help` |
