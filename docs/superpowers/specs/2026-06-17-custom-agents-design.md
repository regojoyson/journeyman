# Custom Agents — Design Spec

**Date:** 2026-06-17
**Status:** Approved design — ready for implementation planning
**Author:** Samuel Rego (with Claude)

## 1. Summary

Custom Agents are a new, first-class product surface in Journeyman: a user defines an
agent (name, instructions, model, connectors, tools, skills, repos, sandbox), attaches
one or more triggers, and the agent runs **autonomously and statelessly** each time a
trigger fires. It is analogous to AWS Bedrock Agents / Anthropic "Claude Routines" as a
*concept*, but it is **not** the same thing as a Journeyman flow.

Internally, an agent reuses the existing execution engine. It is **the source of truth**;
when a trigger fires, a thin compiler builds an ephemeral single-step `WorkflowGraph`
(trigger node → one `custom-ai` step) and submits it to the existing orchestrator. No
changes to Conductor, the worker harness, or sandbox provisioning are required to run an
agent — agents are a new front-end onto the engine that already exists.

### Design decisions (locked)

| Decision | Choice |
|---|---|
| Agent vs flow | Separate first-class entity; compiles to a `WorkflowGraph` internally |
| Compile timing | **At fire-time** — agent is the source of truth, graph is ephemeral |
| Execution shape | **Autonomous one-shot per trigger** (stateless), reusing `runCustomPrompt` |
| Triggers | Manual (always on) + Schedule + API + Webhook — **multi-select** (one, several, or all) |
| Webhook trigger | Universal "any app" inbound webhook (Jira/GitHub/Linear/Monday/custom), per-agent URL + secret |
| Differentiators in v1 | Per-tool permission grid · structured notifications · payload mapping + filters |
| Instructions | Rich markdown editor (formatting toolbar) |
| Repositories | Multi-repo, chosen from **Connected Accounts** |
| Connected Accounts | Full subsystem; credentials are **fine-grained PATs** wrapped in the secrets vault |
| RAG / knowledge | **Path A** — exposed as an MCP connector (agentic retrieval); no new core infra |
| Conversational mode, guardrails catalog, versioning/aliases, cross-run memory, multi-agent | Deferred |

## 2. Goals & non-goals

**Goals**
- Let users create autonomous agents from a single form (matching the reference UI).
- Trigger agents via Manual, Schedule (cron), API (POST), and Webhook (any external app).
- Make the webhook trigger a *universal* ingestion point so Jira and any other SaaS app can drive agents with zero vendor-specific code.
- Give each agent real, scoped, temporary access to selected git repositories inside a sandbox.
- Best-in-class differentiators Claude Routines lacks: per-tool permission grid, structured notifications, payload filters + mapping.
- Reuse the orchestrator, sandbox, MCP/skills/secret resolution, run-viewer, and runs-list unchanged.

**Non-goals (v1)**
- Conversational / multi-turn chat agents with persisted memory.
- A named guardrails catalog (tripwires, moderation).
- Agent versioning / aliases.
- Cross-run long-term memory.
- Multi-agent supervisor/collaborator orchestration.
- OAuth / GitHub App installation flows for git connections (PAT only in v1).
- Journeyman-hosted vector knowledge bases (RAG is external-via-MCP in v1).

## 3. Architecture

```
External app (Jira/GitHub/…)  ─┐
Schedule tick ─────────────────┤
API POST (per-agent token) ────┼──▶ Trigger ingestion core ──▶ Agent compiler ──▶ Orchestrator.submit()
Manual "Run now" ──────────────┘    (auth · dedup · filter ·    (agent record →     (EXISTING: Conductor +
                                     payload→inputs mapping)     ephemeral 1-step     sandbox + MCP/skills
                                                                 WorkflowGraph)       + run-viewer)
```

### New package: `@journeyman/agents`

Mirrors the structure of `@journeyman/custom-steps` and `@journeyman/mcp`.

- **Store** — `jm_agents`, `jm_agent_triggers` (and `jm_agent_schedules` for cron).
- **Compiler** — `agent → WorkflowGraph` (one trigger node + one `custom-ai` step carrying
  the agent's inline config).
- **Trigger index / resolver** — a unified index that maps an inbound event (webhook id,
  API token, schedule tick) to its agent + trigger config.
- **Scheduler tick** — the only genuinely new runtime mechanism (see §5.4).

### Type source: `@journeyman/core`

New `agent.types.ts` holding `Agent`, `AgentTrigger`, and related option/result types.
Per the project rule, all shared types live here; `@journeyman/agents` imports them.

### Execution reuse

The compiled `custom-ai` step runs through the existing `runCustomPrompt` agentic loop.
Connectors (MCP), canonical tools, skills, structured output, and sandbox provisioning all
work with no new execution code. **One extension is required:** the `custom-ai` step
handler must accept an **inline** prompt/config supplied by the agent compiler, in addition
to its current path of loading a saved `customStepId` from the DB. (We extend the handler;
we do **not** introduce a new step type.)

## 4. Data model

```ts
// @journeyman/core/src/types/agent.types.ts

interface Agent {
  id: string;
  scope: "user" | "org";          // reuses existing access-grant pattern (cf. custom-steps, MCP)
  userId?: string;
  orgId: string;

  name: string;
  instructions: string;           // markdown; the prompt — "what Claude should do each session"
  model: string;                  // provider+model via @journeyman/coding-models (default Claude Opus 4.8)

  // Capabilities — all already resolvable today
  connectorMcpIds: string[];      // MCP instances (RAG/knowledge bases are connectors too)
  tools: CanonicalTool[];         // bash/read-file/write-file/edit-file/search/web-* (gates workspace need)
  skillIds: string[];             // skill packages
  repoSelections: RepoSelection[];// chosen from Connected Accounts (optional)
  sandboxId?: string;             // execution environment (optional; required only if workspace tools used)

  // Differentiators
  permissions: AgentPermissions;
  notifications: AgentNotifications;

  outputMode: "none" | "text" | "structured";
  outputFields?: CustomStepOutputField[]; // when outputMode === "structured"

  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface RepoSelection {
  connectionId: string;           // FK → jm_git_connections
  fullName: string;               // e.g. "cadmium/api-server"
  branch: string;                 // branch to start from (default: repo default branch)
  allowWrites: boolean;           // false → agent may push claude/* branches only
}

interface AgentPermissions {
  allowedTools: CanonicalTool[];          // → { tools, allowedTools } passed to runCustomPrompt
  connectors: Record<string, { enabled: boolean }>; // per-MCP-connector enable
  // per-repo write gating lives on RepoSelection.allowWrites
}

interface AgentNotifications {
  on: ("success" | "failure")[];
  channel: { provider: "slack" | "console"; target?: string }; // via @journeyman/notification-provider
}

// One agent has 0..n automated triggers (manual is always implicitly available).
type AgentTrigger =
  | { type: "schedule"; cron: string; timezone: string }        // IANA tz mandatory
  | { type: "api"; tokenHash: string }                          // per-agent bearer token (shown once)
  | {
      type: "webhook";
      webhookId: string;                                        // dedicated per-agent endpoint + secret
      preset?: "jira" | "github" | "linear" | "monday" | "custom";
      filters?: ConditionExpr;                                  // JSONLogic — reuses existing evaluator
      inputsMapping: Record<string, string>;                    // JSONPath payload → agent inputs
    };
```

`tokenHash` and the webhook secret are stored hashed/encrypted; raw values are shown once
on creation.

## 5. Triggers

One agent may have **zero or more** automated triggers active simultaneously, plus an
always-available manual "Run now." All triggers converge on one ingestion pipeline:

> **authenticate → verify / dedup → filter → map payload → build inputs → compile → submit → return `runId`**

Idempotency/dedup is keyed on `(triggerId, deliveryId)` using the source's delivery id
(e.g. `X-Atlassian-Webhook-Identifier`, GitHub delivery id) so retried deliveries do not
double-fire.

### 5.1 Manual (always on)
- `POST /agents/:id/runs` — reuses the existing manual submission path. No config.

### 5.2 API
- `POST /agents/:id/fire` with `Authorization: Bearer <token>`.
- Default async: returns `202 { runId, status: "queued" }`; poll run status via existing instance endpoints.
- Optional freeform JSON body becomes the run inputs.
- Per-agent token issued on trigger creation, shown once, stored hashed.

### 5.3 Webhook (universal "any app" trigger)
- `POST /agents/:id/webhook/:webhookId` — a **dedicated endpoint + secret per agent**.
- **Reuses `@journeyman/webhooks`**: HMAC signature verification on raw bytes, schema
  lint/validate, payload field extraction, and the preset library; and the existing
  webhook-ingest pipeline, retargeted from workflow trigger-nodes to agents.
- **Preset** (`jira`/`github`/`linear`/`monday`/`custom`) pre-fills event filters and the
  payload→inputs JSONPath mapping. `custom` leaves both open.
- **Filters** reuse the existing JSONLogic condition evaluator (e.g. "only Bug issuetype",
  "only PRs targeting main").
- This is the same zero-vendor-code pattern as Jira Automation's "Send web request": any
  app that can POST can drive an agent.

### 5.4 Schedule (cron) — the one new runtime mechanism
- `jm_agent_schedules`: canonical cron string + **mandatory IANA timezone**.
- A **scheduler tick** in the orchestrator worker polls for due schedules and fires them
  through the same submit path. The tick must be durable (missed fires visible) and define
  catch-up-vs-skip behaviour explicitly (v1: skip missed, fire next due).
- Minimum interval and DST handling follow the stored cron + tz.

## 6. Execution (compile → run)

When any trigger fires:

1. **Resolve** the agent record and its mapped inputs (from webhook payload via mapping,
   freeform API body, or empty for schedule/manual).
2. **Compile** to an ephemeral `WorkflowGraph`: `trigger-<type>` node → one `custom-ai`
   step whose config carries the agent's inline instructions, model, tools, MCP ids, skill
   ids, repo selections, sandbox id, permissions, and output schema.
3. **Submit** via `IOrchestratorEngine.submit()` with `triggerSource` set
   (`manual` | `api` | `webhook` | `schedule`) and the instance tagged with `agentId`.
4. The worker harness behaves as it already does: provisions a sandbox **only if** the
   agent's tools require a workspace, resolves MCPs/skills/secrets (including the git
   credential — see §7), runs `runCustomPrompt`'s agentic loop, and captures structured
   output.
5. On terminal state the worker emits the configured **notification** (success/failure) via
   `@journeyman/notification-provider`.

Each fire is a normal `WorkflowInstance` tagged with `agentId`, so the **run-viewer** (live
canvas + per-step logs) and **runs-list** (filterable table) work unchanged — scoped to the
agent.

## 7. Connected Accounts & repository access

Repos are selected from connected git accounts. There is no such concept today, so this is
a new subsystem.

### 7.1 Connect (once)
- **Connected Accounts** page (web). User adds an account → new `jm_git_connections` row:
  provider (`github`/`gitlab`), label, scope (user/org), and a reference to a secret.
- Credential = a **fine-grained PAT**, encrypted in the secrets vault (`@journeyman/secrets`,
  AES). The connection row references the secret id. (OAuth / GitHub App installation are
  deferred.)

### 7.2 Build the agent
- Repo picker calls `GET /git/repos?connectionId=…` → new **`listRepos()`** method on
  `IGitProvider` (+ GitHub/GitLab implementations), using the connection's token via
  `@journeyman/github-api`.
- Agent stores `repoSelections[]` (connection, full name, branch, allowWrites).

### 7.3 Run-time credential flow
- The worker resolves the connection's token from the vault into `StepContext.env` using
  the **same binding-resolver path** that already injects MCP/skill secrets.
- The token is injected as an env var into the **ephemeral per-instance sandbox only**.
- Inside the box, `agent-runtime` configures git auth (credential helper / `http.extraHeader`)
  and clones the selected repos into the workspace.
- The agentic loop edits code. **Pushes use the same token, gated by
  `RepoSelection.allowWrites`** (off → `claude/*` branches only).
- Opening a PR/MR uses the **same connection token** via `@journeyman/git-provider` (REST).
- Run ends → sandbox is destroyed → the injected token is gone.

**Security model:** token encrypted at rest, decrypted only at run-time, injected only into
the ephemeral per-instance sandbox, destroyed with it. Least-privilege relies on the user
scoping the fine-grained PAT to the intended repos.

## 8. RAG / knowledge (Path A — connector-based)

RAG is **not** a new core subsystem in v1. A knowledge base is exposed to the agent as an
**MCP connector** (e.g. a vector-store or docs-search service that speaks MCP), attached in
the Connectors tab and resolved by the existing `@journeyman/mcp` registry + secret
resolution.

- Retrieval is **agentic**: the model calls the retrieval tool during its loop when it needs
  context.
- We may ship a few **preset RAG connectors** for convenience.
- The agent data model is unchanged — a KB is just an entry in `connectorMcpIds`.
- **Future option (documented, not built):** Journeyman-hosted knowledge bases (ingest →
  embed → pgvector) behind the *same* connector slot, and auto-retrieve-on-trigger
  (prepend top-k from the trigger payload to the instructions). Both can be added later
  without changing the agent model.

## 9. UI

Single-page creation form matching the reference screenshot, in Journeyman's monochrome
theme. Reuses the MCP, sandbox, tools, and skills pickers from `flow-editor`.

- **Agents list** (`MyAgentsPage` / `AdminAgentsPage`): name, active triggers, repos,
  status, last run; "Create agent" button.
- **Create/Edit Agent**: Name · rich-markdown Instructions · dedicated multi-repo picker ·
  environment (sandbox) · model · **multi-select triggers** · tabs:
  **Connectors** (MCP) · **Behavior** (max steps, timeout, output mode, retry) ·
  **Notifications** (success/failure toggles + channel) · **Permissions** (per-tool
  read/write grid) · **Trigger config** (preset, filters, payload mapping, cron + tz).
- **Connected Accounts** page + Add-PAT modal.
- **Repo picker**: searchable multi-select from a connected account, per-repo branch +
  allow-writes.
- **Agent run history**: runs-list filtered by `agentId`, click-through to the run-viewer.

UI stack: Tailwind v4 + lucide-react + plain React hooks + `@journeyman/theme` (no form
library), per existing conventions.

## 10. What is new vs. reused

| New (build it) | Reused (already exists) |
|---|---|
| `@journeyman/agents` pkg: store, **fire-time compiler**, agent-trigger index | Orchestrator submit · Conductor · sandbox provisioning |
| `Agent` + `AgentTrigger` types in core | `custom-ai` execution / `runCustomPrompt` loop (extended for inline spec) |
| **Scheduler tick** (cron + IANA tz) + `jm_agent_schedules` | Webhook ingest (HMAC, presets, extract, dedup, filters) |
| Agent CRUD routes + `/fire` + `/webhook` + run-now | MCP / skills / secret binding resolution |
| **Connected Accounts**: `jm_git_connections`, page, PAT-wrapped secret | Secrets vault (AES) · git-provider REST (PR/MR) |
| `listRepos()` on `IGitProvider` + `/git/repos` route + repo picker widget | WorkflowInstance store · run-viewer · runs-list |
| Per-tool permission grid · structured notifications config · agents UI | notification-provider · access-grant / scope pattern |

## 11. Open questions / follow-ups

- **Schedule semantics:** confirm minimum interval and catch-up-vs-skip policy at
  implementation time (v1 default: skip missed, fire next due).
- **Multi-trigger run attribution:** each trigger produces its own `WorkflowInstance` tagged
  with both `agentId` and the firing trigger — confirm the run-history grouping in the UI.
- **`listRepos` pagination & rate limits** for large orgs.
- **Preset RAG connectors:** which services to ship first (if any) in v1.
- **DB migrations:** `jm_agents`, `jm_agent_triggers`, `jm_agent_schedules`,
  `jm_git_connections` — author per `docs/constitution/DATABASE_ARCHITECTURE.md` (append-only).
