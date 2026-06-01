# Archon vs. Journeyman: Feature Comparison

## What They Share (Core Overlap)

| Capability | Archon | Journeyman |
|---|---|---|
| AI-assisted code implementation | Claude (primary), Codex, OpenCode, Pi, Copilot | Claude (primary), Gemini/Codex stubs |
| Ticket → PR automation | Yes (GitHub Issues native) | Yes (GitHub Issues + Projects, Jira partial) |
| PR creation & management | GitHub, GitLab, Gitea | GitHub only |
| Retry logic | Per-node, configurable backoff | Per-step, configurable backoff |
| Durable execution / persistence | SQLite/PostgreSQL | PostgreSQL + Conductor |
| Human approval gates | Approval nodes (multi-attempt) | Human Task nodes (form-based) |
| Webhook triggers | GitHub webhooks, custom | Multi-provider webhooks + HMAC |
| Secrets management | Env vars + encrypted DB | AES-encrypted vault, user/org scoped |
| Web UI | Chat-based execution monitor | Visual canvas editor + run viewer |
| Per-run isolation | Git worktrees (built-in) | External (planned sandboxes) |
| MCP support | Not present | Native per-node MCP picker |
| Skills support | Not present | Native per-node skills config |

---

## What Archon Has That Journeyman Is Missing

### 1. YAML Workflow-as-Code (Biggest Gap)
Archon workflows are version-controlled YAML files sitting next to your codebase in `.archon/workflows/`. Journeyman stores flows only in PostgreSQL. This means:
- No diff reviews of workflow changes
- No branch-per-workflow experiments
- No "infrastructure as code" portability — flows are locked to the DB

### 2. Multi-Platform Adapters (Slack, Telegram, Discord, GitHub bot)
Archon deploys the *same workflow* to CLI, Web, Slack, Telegram, Discord, and GitHub events without modification. Journeyman has no runtime message interfaces — Slack notifications are a stub, there's no bot/chat trigger mode.

### 3. Loop Nodes (Iterative Refinement)
Archon has a `loop` node type that retries an AI prompt with different inputs until a success condition (`until: "COMPLETE"`) is met. This enables self-healing: implement → test → loop back if tests fail. Journeyman has the type defined but not executable.

### 4. Script Nodes (TypeScript/Python via Bun/UV)
Archon can run `.ts` or `.py` scripts as workflow nodes with auto-resolved deps. Journeyman has no equivalent — it's bash or AI steps only.

### 5. Extended Thinking Budget Per-Node
```yaml
thinking:
  enabled: true
  budget_tokens: 5000
```
Archon exposes Claude's extended thinking at the workflow level. Journeyman has no mechanism for this.

### 6. Pre-Built Workflow Templates (20+)
Archon ships `idea-to-pr`, `fix-github-issue`, `comprehensive-pr-review`, `adversarial-development`, `interactive-prd`, etc. as ready-to-use YAML files. Journeyman has no bundled flow templates.

### 7. Multi-Agent Review Patterns
Archon has dedicated review agent commands: `archon-code-review-agent`, `archon-error-handling-agent`, `archon-test-coverage-agent`, `archon-comment-quality-agent`, `archon-self-fix-all`. These run in parallel and synthesize results. Journeyman has no multi-agent coordination pattern.

### 8. Web Research During Workflows
`archon-web-research` fetches external context (docs, issues, RFCs) before implementation. Journeyman has no equivalent.

### 9. CLI-First Distribution (Homebrew, 30-second install)
Archon is installable via `brew install archon` or a curl script. Journeyman requires standing up Postgres + Redis + Conductor.

### 10. GitHub OAuth Device Flow (No PAT Required)
Archon handles auth without personal access tokens. Journeyman requires manual secret entry.

### 11. `trigger_rule` / DAG Conditional Dependencies
```yaml
depends_on: [node-a, node-b]
trigger_rule: one_success
```
Archon supports per-edge trigger semantics (one_success, all_success, one_failure). Journeyman's fork/join is fixed join-mode — no per-dependency trigger rules.

---

## What Journeyman Has That Archon Lacks

| Feature | Journeyman Advantage |
|---|---|
| **Visual Canvas Editor** | n8n-style drag-drop node builder vs. Archon's YAML-only authoring |
| **MCP per-node** | Model Context Protocol servers configurable at step granularity |
| **Skills per-node** | Skill bundles attached per-node, not global |
| **RBAC** | Workflow-level and instance-level grants, org/user roles |
| **Jira, Linear, Monday.com** | Ticket provider interfaces + partial Jira implementation |
| **Webhook Wait (correlation)** | Pause mid-run, resume on matching webhook via correlation key |
| **Fork/Join w/ `first-wins`** | Race pattern: first branch to succeed cancels all others |
| **Conductor-backed durability** | Battle-tested Orkes Conductor for orchestration vs. custom executor |
| **Type-safe interfaces** | All providers defined in `@journeyman/core`; boundary-checked imports |

---

## Most Critical Gaps to Address

Ranked by impact on Journeyman's core value proposition:

**1. Workflow-as-Code / YAML export** — The inability to version-control flows as files is the single biggest architectural gap. Teams can't diff, branch, or PR workflow changes. Even a YAML export/import would help immediately.

**2. Loop / Iterative Refinement Node** — Without loops, Journeyman can't implement "run tests, fix failures, repeat" patterns. This is foundational to autonomous coding agents.

**3. Slack notifications** (currently a stub) — The notification story is broken for production use. Any real team needs Slack alerts when runs fail or PRs are opened.

**4. Multi-platform triggers** — Journeyman has no way to trigger runs from Slack commands, GitHub events, or Telegram. Everything requires the web UI or direct API calls.

**5. Pre-built flow templates** — There's no "getting started" story for new users. Archon's 20+ templates lower the barrier to value dramatically.

**6. GitLab & Linear providers** — These are fully stubbed but commonly used in enterprise environments.

**7. Extended Thinking / effort controls** — Journeyman has no way to configure reasoning budget per-step, which matters for cost control in long pipelines.
