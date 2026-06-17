# Custom Agents — Design Spec

**Date:** 2026-06-17
**Status:** Approved design — ready for implementation planning
**Author:** Samuel Rego (with Claude)

## 1. Summary

Custom Agents are a new, first-class product surface in Journeyman: a user defines an
agent (name, instructions, provider+model, connectors, tools, skills, repos, sandbox),
attaches one or more triggers, and the agent runs **autonomously and statelessly** each
time a trigger fires. It is analogous to AWS Bedrock Agents / Anthropic "Claude Routines"
as a *concept*, but it is **not** the same thing as a Journeyman flow.

Internally, an agent reuses the existing execution engine. It is **the source of truth**;
when a trigger fires, a thin compiler builds an ephemeral single-step `WorkflowGraph`
(trigger node → one self-contained `agent-run` step) and submits it to the existing orchestrator. No
changes to Conductor, the worker harness, or sandbox provisioning are required to run an
agent — agents are a new front-end onto the engine that already exists.

### Design decisions (locked)

| Decision | Choice |
|---|---|
| Agent vs flow | Separate first-class entity; compiles to a `WorkflowGraph` internally |
| Compile timing | **At fire-time** — agent is the source of truth, graph is ephemeral |
| Execution shape | **Autonomous one-shot per trigger** (stateless), reusing `runCustomPrompt` |
| Triggers | Manual (always on) + Schedule + API + Webhook — **multi-select** (zero, one, several, or all automated triggers per agent) |
| Webhook trigger | Universal "any app" inbound webhook with a per-agent URL + secret; v1 presets **Jira + GitHub** (Linear/Monday later) |
| Webhook filtering | Condition builder (field / operator / value, AND-combined) + JSONPath payload→input mapping |
| Differentiators in v1 | Per-tool permission grid · structured notifications · payload mapping + filters |
| Instructions | Rich markdown editor (formatting toolbar) |
| Model selection | **Provider first, then model** (Claude / OpenCode / Gemini / Codex via `@journeyman/coding-models`) |
| Repositories | Multi-repo, chosen from **Connections** (git category) |
| Connections | Unified subsystem with a `category` (`git` \| `notification`); single `jm_connections` table; per-connection **Test** + **List** |
| Git credentials | Fine-grained **PAT**; GitHub + GitLab + self-hosted GitLab (instance URL) |
| Notifications | A `notification` Connection (Slack / Console) + channel; structured notify on success/failure |
| RAG / knowledge | **Path A** — exposed as an MCP connector (agentic retrieval); no new core infra |
| Create UX | **Full page** (not a modal) |
| Methodology (BMAD / OpenSpec) | **Process only** — no agent changes; documented as a usage appendix |
| Conversational mode, guardrails catalog, versioning/aliases, cross-run memory, multi-agent | Deferred |

## 2. Goals & non-goals

**Goals**
- Let users create autonomous agents from a single full-page form (matching the reference UI).
- Trigger agents via Manual, Schedule (cron), API (POST), and Webhook (any external app) — any combination.
- Make the webhook trigger a *universal* ingestion point so Jira, GitHub, and any other app can drive agents with zero vendor-specific code, with a usable filter + mapping layer.
- Give each agent real, scoped, temporary access to selected git repositories inside a sandbox.
- Unify external credentials under one **Connections** model (git + notification), each with Test + List.
- Best-in-class differentiators Claude Routines lacks: per-tool permission grid, structured notifications, payload filters + mapping.
- Reuse the orchestrator, sandbox, MCP/skills/secret resolution, run-viewer, and runs-list unchanged.

**Non-goals (v1)**
- Conversational / multi-turn chat agents with persisted memory.
- A named guardrails catalog (tripwires, moderation).
- Agent versioning / aliases.
- Cross-run long-term memory.
- Multi-agent supervisor/collaborator orchestration *as a platform feature* (BMAD-style pipelines are achieved as process — see Appendix A).
- OAuth / GitHub App installation flows for git connections (PAT only in v1).
- Journeyman-hosted vector knowledge bases (RAG is external-via-MCP in v1).
- Linear / Monday webhook presets (Jira + GitHub only in v1).
- **Prompt-injection sanitization / prompt-content control.** The platform does not police,
  filter, or second-guess agent instructions — prompt quality is the author's
  responsibility. The blast radius is bounded instead by the existing **permission grid**
  (§4) and **sandbox isolation**, which constrain what any run can do regardless of how the
  prompt is influenced. No prompt-control feature is built.

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

- **Store** — `jm_agents`, `jm_agent_triggers`, `jm_agent_schedules` (cron).
- **Compiler** — `agent → WorkflowGraph` (one trigger node + one self-contained `agent-run` step carrying the agent's inline config; the step clones repos + runs).
- **`agent-run` step handler** — clones `repoSelections` (shared clone helper) + runs `runCustomPrompt`; leaves the flow-author `custom-ai` step untouched.
- **Trigger index / resolver** — a unified index mapping an inbound event (webhook id, API token, schedule tick) to its agent + trigger config.
- **Scheduler tick** — the only genuinely new runtime mechanism (see §5.4).

### Connections subsystem (new, shared)

A unified credential/integration registry (see §7), used by agents for both repositories and notifications, and reusable by the rest of the platform.

### Type source: `@journeyman/core`

New `agent.types.ts` (`Agent`, `AgentTrigger`) and `connection.types.ts` (`Connection`,
`ConnectionCategory`). Per the project rule, all shared types live here.

### Execution: a dedicated `agent-run` step

The agent compiles to a **single self-contained `agent-run` step** (not a multi-node graph,
and not the flow-author `custom-ai` step). The `agent-run` handler owns the whole agent
lifecycle in one place:

- **clones the agent's `repoSelections`** into the workspace (sharing the existing
  `clone-repos` clone helper — no duplicated logic);
- runs the existing `runCustomPrompt` agentic loop with the agent's inline instructions,
  provider+model, tools, MCP, skills, structured output, `maxTurns`, and `timeoutSeconds`.

Connectors (MCP), canonical tools, skills, structured output, and sandbox provisioning all
reuse existing resolution. **`custom-ai` is left untouched** so flow authors are unaffected.
Notifications are **not** part of this step — they are an orchestrator-level terminal hook
(see §6) so they fire even if `agent-run` crashes or times out.

## 4. Data model

```ts
// @journeyman/core/src/types/agent.types.ts

interface Agent {
  id: string;
  scope: "user" | "org";          // reuses existing access-grant pattern (cf. custom-steps, MCP)
  userId?: string;
  orgId: string;

  name: string;
  instructions: string;           // markdown + mustache template; uses {{input}} vars (§5b)
  inputs: AgentInputField[];      // named variables (may be empty); filled per-trigger (§5b)
  provider: string;               // chosen FIRST — claude | opencode | gemini | codex
  model: string;                  // chosen from the provider's models (default Claude Opus 4.8)

  // Capabilities — all already resolvable today
  connectorMcpIds: string[];      // MCP instances (RAG/knowledge bases are connectors too)
  tools: CanonicalTool[];         // bash/read-file/write-file/edit-file/search/web-* (gates workspace need)
  skillIds: string[];             // skill packages
  repoSelections: RepoSelection[];// chosen from git Connections (optional)
  sandboxId?: string;             // execution environment (optional; required only if workspace tools used)

  // Differentiators
  permissions: AgentPermissions;
  notifications: AgentNotifications;

  outputMode: "none" | "text" | "structured";
  outputFields?: CustomStepOutputField[]; // when outputMode === "structured"

  behavior: {                     // see §14 — most of these need NEW wiring
    maxTurns?: number;            // NEW: wire to SDK maxTurns / configurable step cap
    timeoutSeconds?: number;      // NEW: enforced by the worker via AbortSignal
    retry?: RetryPolicy;          // reuse RetryPolicy; compiled onto the step node
  };

  triggers: AgentTrigger[];       // zero or more automated triggers; manual is always implicit
  status: "draft" | "active";     // draft while being configured (triggers never fire); Enable runs a readiness check
  enabled: boolean;               // on/off kill-switch once active (§15.1)
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface RepoSelection {
  connectionId: string;           // FK → jm_connections (category "git")
  fullName: string;               // e.g. "acme/acme-api"
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
  connectionId: string;           // FK → jm_connections (category "notification")
  target?: string;                // channel id/name (for token-based providers); omitted for webhook-URL providers
}

// Zero or more automated triggers per agent. Manual "Run now" is always available.
type AgentTrigger =
  | { type: "schedule"; cron: string; timezone: string; fixedInputs?: Record<string, unknown> } // IANA tz mandatory; fixedInputs satisfy required inputs (§5b)
  | { type: "api"; tokenHash: string }                          // per-agent bearer token (shown once)
  | {
      type: "webhook";
      webhookId: string;                                        // dedicated per-agent endpoint + secret
      preset?: "jira" | "github";                               // v1; linear/monday later. omit = custom
      event?: string;                                           // preset-specific event (e.g. "issue_transitioned", "pull_request")
      filters?: ConditionExpr;                                  // condition builder → JSONLogic; AND-combined
      inputsMapping: Record<string, string>;                    // JSONPath payload → agent inputs
    };
```

`tokenHash` and the webhook secret are stored hashed/encrypted; raw values are shown once
on creation (see §6 reveal).

## 5. Triggers

One agent may have **zero or more** automated triggers active simultaneously, plus an
always-available manual "Run now." All triggers converge on one ingestion pipeline:

> **authenticate → verify / dedup → filter → map payload → build inputs → compile → submit → return `runId`**

Idempotency/dedup is keyed on `(triggerId, deliveryId)` using the source's delivery id
(e.g. `X-Atlassian-Webhook-Identifier`, GitHub delivery id) so retried deliveries do not
double-fire.

### 5.1 Manual (always on)
- `POST /agents/:id/runs` — reuses the existing manual submission path.
- **"Run now" opens an inputs form** built from the agent's `inputs` (required mandatory,
  optional pre-filled with defaults); submitting fires the run.
- **Allowed in `draft`** so the agent can be test-run before enabling (automated triggers
  stay off until enabled), and **allowed while enabled** (running is an action, not a
  settings edit, so it works even though the settings tabs are locked).
- A manual run is a **real run** subject to the same permissions — for a safe test, set
  `allowWrites` off (works on `claude/*` only) or use read-only tools.

### 5.2 API
- `POST /agents/:id/fire` with `Authorization: Bearer <token>`.
- Default async: returns `202 { runId, status: "queued" }`; poll run status via existing instance endpoints.
- Optional freeform JSON body becomes the run inputs.
- Per-agent token issued on trigger creation, shown once, stored hashed.

### 5.3 Webhook (universal "any app" trigger)
- `POST /agents/:id/webhook/:webhookId` — a **dedicated endpoint + secret per agent**,
  **auto-provisioned** when the webhook trigger is selected and **owned by the agent**
  (configured inline in the agent's Webhook config tab, not the standalone webhooks page;
  it may still appear in the webhooks list as owned-by-agent). Reusing the same underlying
  webhook object means a "select an existing webhook" option can be added later.
- **Reuses `@journeyman/webhooks`**: signature/auth verification, schema lint/validate,
  payload field extraction, the preset library, and the existing webhook-ingest pipeline
  (retargeted from workflow trigger-nodes to agents).
- **Auth method (security type)** is a per-webhook setting
  `{ type: "hmac" | "token" | "none", header?, algorithm?, secretRef? }`:
  - **hmac** — sender signs the raw body (e.g. GitHub `X-Hub-Signature-256`); strongest.
  - **token** — shared secret in a header (e.g. Jira "Send web request"); works everywhere.
  - **none** — no secret check (only the unguessable URL + rate-limit + dedup); **off by
    default**, opt-in with a warning, for internal tests only.
  The **preset picks a safe default** (GitHub → hmac, Jira → token) and the user may
  override. HMAC/token generate a secret revealed once (§6). An **org policy can forbid
  `none`** so unauthenticated agent webhooks cannot be created.
- **Presets (v1): Jira + GitHub.** Each preset supplies the available **events**, the
  **filterable fields**, and a default payload→inputs mapping. `custom` (no preset) leaves
  everything open. Linear / Monday presets are a fast follow.
  - *Jira* — events: issue transitioned / created / updated / comment added. Fields:
    project, issue type, status (to/from), priority, labels, assignee, reporter, component.
    Default map: `$.issue.key → ticketKey`.
  - *GitHub* — events: pull_request, issues, push, release. Fields: action, target/base
    branch, labels, title, body, author, draft, merged. Default map:
    `$.pull_request.number → prNumber`.
- **Filter builder** — a list of `field / operator / value` rows (AND-combined), compiled to
  the existing JSONLogic condition evaluator. Operators: `is`, `is not`, `contains`,
  `is one of`, `matches regex`.
- **Mapping** — JSONPath rows mapping payload fields to named agent inputs (reuses the
  existing webhook field-extract logic).
- This is the same zero-vendor-code pattern as Jira Automation's "Send web request": any
  app that can POST can drive an agent.

### 5.4 Schedule (cron) — the one new runtime mechanism
- `jm_agent_schedules`: canonical cron string + **mandatory IANA timezone**.
- A **scheduler tick** in the orchestrator worker polls for due schedules and fires them
  through the same submit path. Durable (missed fires visible); v1 catch-up policy: skip
  missed, fire next due. DST handled via the stored tz.

## 5b. Inputs & variables (trigger → instructions)

An agent declares named **inputs** (variables); each trigger fills them; the **instructions**
reference them via `{{ }}` templating. Inputs are optional — an agent may have none.

```ts
interface AgentInputField {            // mirrors custom-step inputFields
  name: string;                        // e.g. "ticketKey"
  type: "text" | "number" | "boolean";
  required: boolean;
  default?: unknown;
  description?: string;
}
// on Agent: inputs: AgentInputField[]
```

**How each trigger fills inputs:**
- **Webhook** — JSONPath mapping from the payload (`$.issue.key → ticketKey`), per §5.3.
- **API** — taken from the JSON request body keys.
- **Schedule** — no payload; inputs use their `default` (or fixed values set on the schedule).
- **Manual** — a small form (the `trigger-human` form) to enter values, else defaults.

**How instructions use them:** the agent's `instructions` are a **mustache template**
(reusing the custom-step `promptTemplate` mechanism). Available variables:
- each input by name — `{{ticketKey}}`, `{{note}}`;
- `{{trigger.type}}` / trigger metadata (which trigger fired, timestamp);
- `{{payload}}` — the whole raw inbound payload, for when specific fields weren't mapped.

Missing optional inputs fall back to their `default`; the renderer is applied before the
`agent-run` step executes. This is the same template + input-field machinery the `custom-ai`
step already provides — reused, not new.

**Required-input satisfiability (dry-test issue #3).** Every **required** input must be
fillable by each enabled trigger, or the agent fails at runtime. Enforced as:
- **Webhook** — a mapping entry must target each required input (or the input has a default);
  checked at the Enable gate.
- **Schedule** — has no payload, so each required input needs a **default** *or* a **fixed
  value set on the schedule**. The schedule trigger therefore carries optional
  `fixedInputs: Record<string, unknown>`; checked at the Enable gate.
- **API** — required inputs are part of the documented contract; a call whose body omits a
  required input is rejected `400` at runtime.
- **Manual** — the Run-now form marks required inputs mandatory.

## 6. Execution (compile → run) and the create-time reveal

**Create-time reveal (shown once).** When an agent with a webhook and/or API trigger is
created, the post-create screen reveals the **webhook URL + signing secret** and/or the
**API bearer token**. These are shown once; the raw values are not retrievable afterward
(rotate to regenerate). The webhook URL is what a user pastes into Jira's "Send web request"
or GitHub's webhook settings.

**On any trigger firing:**

1. **Resolve** the agent record and its mapped inputs (from webhook payload via mapping,
   freeform API body, or empty for schedule/manual).
2. **Compile** to an ephemeral `WorkflowGraph`: `trigger-<type>` node → one **`agent-run`**
   step whose config carries the agent's inline instructions, provider+model, tools, MCP
   ids, skill ids, **repoSelections**, sandbox id, permissions, behavior
   (maxTurns/timeout/retry), and output schema. The `agent-run` handler clones the repos
   itself (shared clone helper) and runs the loop — one self-contained step, not a
   multi-node graph.
3. **Submit** via `IOrchestratorEngine.submit()` with `triggerSource` set
   (`manual` | `api` | `webhook` | `schedule`) and the instance tagged with `agentId`.
4. The worker harness behaves as it already does: provisions a sandbox **only if** the
   agent's tools require a workspace, resolves MCPs/skills/secrets (including git
   credentials — see §7), runs `runCustomPrompt`'s agentic loop, captures structured output.
5. On terminal state the worker emits the configured **notification** (success/failure) via
   the agent's notification Connection (see §7.4).

Each fire is a normal `WorkflowInstance` tagged with `agentId`, so the **run-viewer** (live
canvas + per-step logs) and **runs-list** (filterable table) work unchanged — scoped to the
agent.

## 7. Connections (unified credential/integration subsystem)

A single subsystem replaces the earlier "Connected Accounts" idea. A **Connection** is a
reusable, encrypted credential + config, classified by **category**. Today: `git` and
`notification`; new providers drop in under an existing category with no new subsystem.

```ts
// @journeyman/core/src/types/connection.types.ts
type ConnectionCategory = "git" | "notification";

interface Connection {
  id: string;
  scope: "user" | "org";
  category: ConnectionCategory;
  provider: string;          // git: "github" | "gitlab" ; notification: "slack" | "console"
  label: string;
  baseUrl?: string;          // git self-hosted instance URL / slack workspace; defaults per provider
  secretRef: string;         // → encrypted credential in @journeyman/secrets (AES)
  config?: Record<string, unknown>; // provider-specific (e.g. slack method: "token" | "webhook")
  createdBy: string; createdAt: string; updatedAt: string;
}
```

Every connection follows the same lifecycle: **Connect → Test → List → (agent picks).**
The **Test** and **List** actions reuse the existing `testConnection` UI/API pattern
already used by sandboxes and MCP instances.

### 7.1 Git connections
- Providers: **GitHub** (implemented) and **GitLab** (stub today — must be built).
- Credential: **fine-grained PAT**, encrypted in the vault.
- `baseUrl`: `github.com` (fixed) / `gitlab.com` (default, editable for **self-hosted
  GitLab** e.g. `https://gitlab.acme.com`). GitLab.com and self-hosted share one
  base-URL-aware `GitLabProvider`.
- **Test** → validate token (whoami) + report accessible repo count.
- **List** → `listRepos()` (new on `IGitProvider` + GitHub/GitLab impls) — powers both the
  test preview and the agent repo picker.
- Self-hosted GitLab on the public internet needs no special networking; a private-network
  instance requires running the agent on a sandbox backend inside that network (noted as a
  deployment consideration). Private CA certs must be trusted in the sandbox image.

### 7.2 Repo selection & run-time credential flow (agents)
- Repo picker lists a connection's repos (`listRepos`), multi-select, per-repo branch +
  `allowWrites`. Saved as `Agent.repoSelections[]` referencing `connectionId`.
- At run time the worker resolves the connection's token from the vault into
  `StepContext.env` (same binding-resolver path used for MCP/skill secrets), injected into
  the **ephemeral per-instance sandbox only**.
- `agent-runtime` configures git auth (credential helper / `http.extraHeader`) and clones
  the selected repos. Pushes use the same token, gated by `allowWrites` (off → `claude/*`
  only). PR/MR opened via `@journeyman/git-provider` with the same token. Sandbox teardown
  destroys the injected token.

### 7.3 Notification connections
- Providers: **Slack** (stub today — must be built) and **Console** (implemented, zero-config).
- Slack connect method (`config.method`): **bot token** (`xoxb-…` → can list channels, post
  anywhere, testable) or **incoming webhook URL** (single fixed channel, no listing).
- **Test** → post a test message. **List** → `listChannels()` (token method only).
- Extensible later: Teams, Discord, email/SMTP, generic webhook — new providers under the
  `notification` category.

### 7.4 Notification use by agents
- The agent's Notifications config picks a **notification Connection** + a **channel**
  (`target`) and toggles **notify on success / failure**.
- On terminal run state the worker posts via `@journeyman/notification-provider`, resolving
  the connection credential from the vault. (Implementing `SlackProvider` is the one new
  piece; `ConsoleProvider` already works.)

### 7.5 Connection lifecycle (references, delete, rotate)

A connection may be referenced by many agents (`repoSelections.connectionId` and
`notifications.connectionId`).

- **Usage tracking** — the connections list shows **"used by N agents"** with the list.
- **Delete (in use)** — **blocked**. Deletion is refused while any agent references the
  connection; the UI shows the referencing agents so the user detaches/replaces them first.
  An unreferenced connection deletes normally.
- **Rotate** — allowed freely; pasting a new token **re-validates** it and all referencing
  agents pick it up on their next run (no per-agent change). This is the intended rotation
  path.
- **Test surfacing** — a credential that later fails (`401`, §15.3) is flagged
  "needs attention" on the connection **and** on every agent that uses it.

## 8. RAG / knowledge (Path A — connector-based)

RAG is **not** a new core subsystem in v1. A knowledge base is exposed to the agent as an
**MCP connector** (a vector-store or docs-search service speaking MCP), attached in the
Connectors tab and resolved by the existing `@journeyman/mcp` registry + secret resolution.

- Retrieval is **agentic**: the model calls the retrieval tool during its loop as needed.
- We may ship a few **preset RAG connectors** for convenience.
- The agent data model is unchanged — a KB is just an entry in `connectorMcpIds`.
- **Future option (documented, not built):** Journeyman-hosted knowledge bases (ingest →
  embed → pgvector) behind the same connector slot; auto-retrieve-on-trigger. Both can be
  added later without changing the agent model.

## 9. UI

Journeyman's monochrome theme; reuses the MCP, sandbox, tools, and skills pickers from
`flow-editor`. **Create-then-configure** flow (not one giant form):

- **Agents list** (`MyAgentsPage` / `AdminAgentsPage`): name, status (draft/active),
  active triggers, repos, last run; "Create agent" button.
- **Step 0 — name-first create modal**: takes just the **Name** (instructions optional) and
  creates a **draft** agent, then routes to its edit page. Keeps the entry point tiny.
- **Agent edit page (used for both create-continue and later editing)** — a header (name +
  status badge + Run now / Enable) with a **horizontal tab bar across the top** (AWS-console
  style); each tab **saves independently** ("Save section") and shows a status marker
  (✓ complete / ! needs attention). **Run history is a tab too**, so config and monitoring
  live on one page. Tabs:
  - **Instructions & Inputs** — rich-markdown instructions + the **inputs** editor (§5b) and
    an **inputs helper** beside the editor: shows available variables (`{{ticketKey}}`,
    `{{note}}`, `{{payload}}`, `{{trigger.type}}`) with an **Insert variable** dropdown.
  - **Workspace & model** — multi-repo picker (from a git Connection) · environment (sandbox)
    · **Provider select (first) → Model select (then)**.
  - **Triggers** — multi-select Webhook / Schedule / API (manual always on); each selected
    trigger expands its **full inline config** (webhook: preset + security type + filter +
    mapping; schedule: cadence + timezone + next-runs; API: endpoint + token + inputs).
  - **Connectors** (MCP, incl. RAG) · **Skills** · **Tools** (canonical) · **Behavior**
    (maxTurns, timeout, output mode, retry) · **Notifications** (connection + channel +
    success/failure) · **Permissions** (per-tool read/write grid).
  - **Skills** are picked like Connectors — from the `@journeyman/skills` registry (not a
    Connection). A private skill *repo* reuses a git Connection only to clone it. Reuses the
    existing flow-editor SkillsTab; resolved at run time by `skillsResolver`.
- **One page = view + edit + run history.** The same agent page serves all three (run
  history is a tab). No separate read-only viewer.
- **Draft → Enable.** An agent stays `status: "draft"` while being configured; **triggers do
  not fire** until it is **enabled**, and Enable runs a **readiness check** (required fields,
  ≥1 valid trigger, etc.). After enabling, the per-agent `enabled` flag is the on/off
  kill-switch (§15.1).
- **Enable readiness gate.** Enabling runs a validation check; if any item fails, Enable is
  blocked and the relevant tab shows `!` with the reason. Required to enable:
  - Name set · Instructions non-empty · Provider + model chosen (implemented provider).
  - If any workspace tool is enabled → a sandbox is set; if repos are attached → their git
    connection is healthy.
  - Each configured trigger is complete (webhook: preset + auth + mapping; schedule: cron +
    timezone; API: token issued). Zero automated triggers is allowed = a manual-only agent.
  - Every **required** input is satisfiable by each enabled trigger (mapping or default) — see §5b / issue in §16.
  - If notify-on-* is enabled → a valid notification connection + channel.
  - All referenced connections are healthy (not "needs attention").
- **Enabled = read-only.** While an agent is enabled, its settings tabs are **locked**
  (read-only, Save hidden, a "disable to edit" banner). The user must **Disable** to make
  changes, then re-Enable. This prevents editing a live agent's behaviour mid-flight. **Run
  history stays viewable** in either state.
- **Reveal (shown once)** — when a webhook/API trigger is first configured, its URL + secret
  / token are revealed once (§6).
- **Connections** page (`Settings → Connections`): grouped by category (Git accounts /
  Notification channels); a single "New connection" form with a **Type** toggle
  (Git / Notification), per-provider fields, and **Test connection** with whoami/repo or
  test-message/channel result.
- **Agent run history**: runs-list filtered by `agentId`, click-through to the run-viewer.

UI stack: Tailwind v4 + lucide-react + plain React hooks + `@journeyman/theme` (no form
library), per existing conventions.

## 10. What is new vs. reused

| New (build it) | Reused (already exists) |
|---|---|
| `@journeyman/agents` pkg: store, **fire-time compiler**, agent-trigger index | Orchestrator submit · Conductor · sandbox provisioning |
| `Agent` + `AgentTrigger` + `Connection` types in core | `runCustomPrompt` agentic loop · `custom-ai` (left untouched) |
| New **`agent-run` step** (clones repos + runs in one step; maxTurns/timeout/retry) | `clone-repos` clone helper (shared, not duplicated) |
| **Auto-notification orchestrator hook** (on terminal run state) | `INotificationProvider` · run-terminal events |
| **Scheduler tick** (cron + IANA tz) + `jm_agent_schedules` | Webhook ingest (HMAC, presets, extract, dedup, filters) |
| Agent CRUD routes + `/fire` + `/webhook` + run-now | MCP / skills / secret binding resolution |
| **Connections** subsystem: `jm_connections`, page, Test/List per provider | Secrets vault (AES) · `testConnection` UI/API pattern (sandboxes/MCP) |
| `GitLabProvider` (base-URL aware) + `listRepos()` on IGitProvider + `/git/repos` route + repo picker | GitHub provider · git-provider REST (PR/MR) |
| `SlackProvider` (post + `listChannels` + test) | `ConsoleProvider` · `INotificationProvider` interface |
| Webhook **filter builder** UI (Jira/GitHub presets) | JSONLogic evaluator · webhook field-extract |
| Per-tool permission grid · provider→model picker · full-page agents UI · post-create reveal | WorkflowInstance store · run-viewer · runs-list · access-grant/scope pattern |

## 11. End-to-end flow (acceptance narrative)

1. **Connect** (one-time): user adds a **git Connection** (PAT + instance URL, Test → repos)
   and a **notification Connection** (Slack token, Test → channels).
2. **Create agent** (full page): Name + Instructions; pick Provider→Model; add repos from the
   git Connection; pick a sandbox; select triggers (e.g. Webhook); configure Connectors,
   Behavior, Notifications (Slack channel), Permissions, and Webhook config (Jira preset,
   filter `status → In Development`, map `$.issue.key → ticketKey`). Click **Create**.
3. **Reveal**: copy the webhook URL + secret; paste into Jira Automation "Send web request".
4. **Fire**: a Jira transition POSTs the webhook → auth + dedup + filter pass → payload
   mapped to inputs → compiled to a 1-step graph → submitted.
5. **Run**: sandbox provisioned; git token injected; repos cloned; agentic loop runs
   (reads ticket via the Atlassian connector, edits code, opens a PR gated by `allowWrites`).
6. **Notify + record**: Slack success/failure message posted; run appears in the agent's
   history, openable in the run-viewer.

This exercises every new piece end to end.

## 12. Open questions / follow-ups

- **Schedule semantics:** confirm minimum interval and catch-up-vs-skip at implementation
  (v1 default: skip missed, fire next due).
- **Slack connect default:** bot token vs incoming webhook — both supported; pick the default
  during implementation.
- **`listRepos` / `listChannels` pagination & rate limits** for large orgs/workspaces.
- **Multi-trigger run attribution:** each firing trigger produces its own `WorkflowInstance`
  tagged with `agentId` + the firing trigger; confirm run-history grouping in the UI.
- **DB migrations:** `jm_agents`, `jm_agent_triggers`, `jm_agent_schedules`, `jm_connections`
  — author per `docs/constitution/DATABASE_ARCHITECTURE.md` (append-only).
- **Preset RAG connectors:** which services to ship first (if any).

## 13. Suggested implementation phases

1. **Agent core** — `@journeyman/agents` (types, store, fire-time compiler), the new
   **`agent-run` step** (clones repoSelections via the shared clone helper + runs the loop),
   manual trigger + run-now, full-page agents UI (basics/workspace/provider→model/behavior/
   permissions/notifications-shell), run history. **Includes the behavior wiring gaps (§14):
   `maxTurns` → SDK + configurable step cap; `timeoutSeconds` → worker AbortSignal
   enforcement; per-agent `retry` compiled onto the step node. Gate the provider picker to
   implemented providers (Claude, OpenCode) only.**
2. **Connections + repos** — `jm_connections`, Connections page, git provider Test/List,
   `GitLabProvider` (base-URL aware) + `listRepos` + repo picker; wire repoSelections into
   the run-time credential flow so the `agent-run` step clones them (§14, gap #1).
3. **Automated triggers** — webhook (presets Jira/GitHub, filter builder, mapping, dedup),
   API token + `/fire`, scheduler tick; the create-time reveal.
4. **Notifications + polish** — **the automatic on-terminal-state notification hook
   (§14, gap #4)**, `SlackProvider` (post/list/test), notification Connections, the per-tool
   permission grid, structured notify wiring.

## 14. End-to-end verification — every Create-Agent option → execution path

Traceability audit (against the current codebase) of each configurable option to a concrete
runtime path. ✅ = reuse, works today; ⚠️ = needs building (named below). This is the
authoritative list of gaps the implementation must close for the form to work end to end.

| Create-Agent option | Status | Path / gap |
|---|---|---|
| Name | ✅ | Stored on the agent record |
| Instructions (markdown) | ✅ | Passed as the prompt to `runCustomPrompt` |
| Provider | ⚠️ gate | Only **Claude / OpenCode** implement `runCustomPrompt`; Gemini/Codex are stubs → restrict the picker |
| Model | ✅ | Passed to the provider/SDK |
| **Repositories** | ⚠️ #1 | The new `agent-run` step clones `repoSelections` internally, sharing the existing `clone-repos` clone helper (no duplication) + the git-token binding |
| Environment (sandbox) | ✅ | Existing sandbox provisioning (local/docker/windows) |
| Connectors (MCP) | ✅ | `mcpResolver` → `runCustomPrompt` |
| Skills | ✅ | `skillsResolver` → materialized into sandbox |
| Tools (canonical) | ✅ | `tool-mapping` → `{ tools, allowedTools }` |
| Output mode (none/text/structured) | ✅ | `outputFieldsToJsonSchema` → json_schema |
| **Behavior: max steps** | ⚠️ #2 | Not wired — add `maxTurns` to `RunCustomPromptOptions` + Claude SDK; make AI-SDK `STEP_CAP` configurable |
| **Behavior: timeout** | ⚠️ #3 | `AbortSignal` is plumbed but no auto-timeout — worker must abort after `timeoutSeconds` |
| Behavior: retry | ⚠️ small | `RetryPolicy` + Conductor retry exist; compiler must set retry on the step node |
| **Notifications (on success/failure)** | ⚠️ #4 | No automatic terminal-state hook today (only a manual `send-message` step); build the hook + implement `SlackProvider` |
| Permissions: tool allow-list | ✅ | Maps to `{ tools, allowedTools }` |
| Permissions: connector enable | ✅ | Controls which MCPs are resolved |
| Permissions: connector read/**write** granularity | ⚠️ coarse | MCP exposes all of a connector's tools; fine write-vs-read gating *within* a connector isn't enforceable without tool-name filtering — v1 treats it as enable/disable + (optional) allow/deny by tool name |
| Permissions: repo writes (`allowWrites`) | ✅* | Push gating via branch policy; *enforced by the clone/push logic built in gap #1 |
| Triggers: manual | ✅ | Existing manual submission |
| Triggers: webhook + filters + mapping | ⚠️ build | Reuses webhook ingest + JSONLogic + extract; agent-trigger index + Jira/GitHub presets are new |
| Triggers: API token / `/fire` | ⚠️ build | Token issuance + endpoint new; submit reused |
| Triggers: schedule (cron) | ⚠️ build | New scheduler tick + `jm_agent_schedules` |
| Create-time reveal (URL/secret/token) | ⚠️ build | New endpoints + one-time secret display |

**Verdict:** the architecture is sound and ~half the surface is pure reuse, but the form does
**not** work end to end as-is. Four substantive gaps (**#1 repo auto-clone, #2 max-steps
wiring, #3 timeout enforcement, #4 auto-notification hook**) plus provider gating and the
new trigger/connection machinery must be built. All are assigned to phases in §13.

## 15. Production readiness

Operational guardrails required to run agents safely at scale, on top of the §14 feature
gaps. Worked through one item at a time.

### 15.1 Safety rails (the brakes)

Agents fire autonomously, so a webhook storm, a misconfiguration, or a loop could start
huge numbers of runs and burn significant model cost. Three controls prevent runaway
behaviour:

1. **Concurrency limit** — `maxConcurrentRuns` per **agent** and per **org**. Before
   submitting a run, the trigger/submit path checks the current running count; if at the
   limit, the run waits in the existing Redis/Conductor queue rather than overwhelming the
   system.
2. **Daily run cap + spend budget** — `dailyRunCap` and a `budget` (max tokens and/or cost)
   per **agent** and per **org**. A per-day counter and a token/cost tally (the coding
   providers already report usage) are checked before each run; over the cap → skip the run
   and surface why. Counters reset daily.
3. **Kill-switch** — the per-agent `enabled` flag (already in the model) plus a new
   **org-level `paused` flag** (pause-all). The trigger ingestion checks both before
   starting any run; an admin toggles them in the UI.

**Stop semantics (dry-test issue #5)** — two distinct actions:
- **Disable agent / pause-all** — stops *new* fires and **drops queued (not-yet-started)
  runs**, but **lets in-flight runs finish gracefully** (cancelling mid-run can leave
  half-done branches/PRs). Disabling also re-unlocks the settings for editing (§9).
- **Cancel a run** — per-run, aborts one in-flight run via the existing `AbortSignal`;
  sandbox teardown still runs (partial artifacts may remain — issue #5b below).
- **Cancel all running** — a separate admin action for true emergencies (hard stop).

**Data model additions** (org settings + per-agent overrides):

```ts
interface AgentSafetyLimits {       // on Agent (overrides) and on org settings (defaults)
  maxConcurrentRuns?: number;
  dailyRunCap?: number;
  budget?: { maxTokens?: number; maxCostUsd?: number };
}
// org settings also carry: paused: boolean   // global kill-switch
```

**Enforcement points:** the trigger ingestion core (§5) checks `paused`, concurrency, daily
cap, and budget *before* compiling/submitting; the worker records token/cost usage per run
so the tally stays current. All four checks fail safe (skip + log) rather than silently
proceeding.

### 15.2 Reliability (do it once, clean up, no duplicates)

A run must execute once, clean up after itself, and avoid duplicate side effects even under
retries, restarts, and crashes.

1. **Idempotent ingestion (dedup).** Inbound events carry a unique delivery id
   (`X-Atlassian-Webhook-Identifier`, GitHub delivery id). A **dedup store** keyed on
   `(triggerId, deliveryId)` with a TTL records seen ids; a repeat delivery is acknowledged
   and ignored. (Postgres table or Redis with expiry.)
2. **Durable, single-fire scheduler.** Schedules live in `jm_agent_schedules`. A due
   schedule is **claimed via a row lock / leader election** so exactly one worker fires it,
   even with multiple workers; on restart the scheduler reads the DB and resumes (v1 policy:
   skip missed, fire next due — §5.4).
3. **Guaranteed sandbox teardown.** Teardown runs in a `finally`-style block so it executes
   on success, failure, crash, or timeout. A periodic **janitor** sweeps orphaned sandboxes
   (older than a threshold) as a backstop against leaks.
4. **Idempotent PR/MR creation.** Use a deterministic per-ticket branch
   (e.g. `claude/<ticketKey>`); before opening a PR/MR, check whether one already exists for
   that branch and **update it instead of creating a duplicate**, so a retried run does not
   produce a second PR.

These make a run **safe to retry** — the core requirement for the retry policy (§14) and the
at-least-once delivery model (§5) to be usable in production.

### 15.3 Security (protect the keys and the public door)

Scope is the credentials and the public endpoint — not prompt content (see §2 non-goal).

1. **Secret redaction in logs.** Tokens flow through every run; a leaked log line exposes
   them. Add a redaction filter at the single centralized logging point (`sdk-logger`) that
   masks token-shaped values (`glpat-…`, `xoxb-…`, `github_pat_…`) and known resolved secret
   values before any log is emitted.
2. **Master key in a KMS.** The AES vault key must not live in a file/env on disk. Store it
   in a managed KMS; the secrets service delegates encrypt/decrypt to the KMS so the key is
   never resident on app disk. (Local dev key; KMS in production.)
3. **Public-endpoint hardening.** On top of HMAC verification, the webhook endpoint enforces
   a **per-webhook rate limit** (reject excess → `429`) and a **max body size** (reject
   oversized → `413`) to prevent spam/DoS and oversized-payload abuse.
4. **Credential health / expiry detection.** PATs expire or get revoked. On a `401` during a
   run, mark the Connection **"needs attention"** and notify the owner; optionally a periodic
   health check tests connections and flags dead credentials proactively ("reconnect").

Tenant isolation (one org cannot read another's Connections/secrets) is already provided by
the existing user/org access-grant scope model and is reused unchanged.

### 15.4 Observability (see it, get alerted, audit it)

Autonomous agents need a big-picture view on top of the existing per-run logs (run-viewer).

1. **Metrics.** Emit counters/timers from the worker on run terminal state — runs started,
   succeeded, failed, duration, and tokens/cost — tagged by agent + org, exported to the
   metrics stack with a simple dashboard. (Builds on the existing `step.completed` /
   `step.failed` events.)
2. **Alerts.** Threshold rules over those metrics — failure rate over X%, a run timed out /
   stuck, budget near cap (ties to §15.1) — routed to a Slack channel or email.
3. **Audit log.** An append-only audit table recording `actor · action · target · timestamp`
   for sensitive actions: agent create/edit/delete, Connection create/edit/delete, manual
   "run now", and kill-switch/pause toggles.

**Per-run logging reuses the workflow logs.** An agent run is a WorkflowInstance, so the
run-viewer canvas, per-step logs, live status, and events stream all apply unchanged —
filtered by `agentId`. No new per-run logging system. Three additions on top of that reuse:
(a) **secret redaction** in those logs (§15.3 #1 — critical since agent runs carry git/Slack
tokens); (b) **tokens/cost + duration surfaced per run** (the providers report usage; feeds
the §15.1 budget); (c) a **log retention policy** (agents run far more often than hand-run
workflows, so set a keep-for-N-days + auto-clean). The §15.4 metrics/alerts/audit sit on top
of these per-run logs as the aggregate/operational view.

## 16. Resolved edge cases (dry-test)

Smaller issues surfaced by the full-lifecycle dry test, resolved with these behaviors:

1. **Test connection — three outcomes, not two.** Distinguish: bad credential (`401` → error),
   valid but **zero accessible repos/channels** (warn: "connected, but nothing visible —
   check token scope"), and success. Never leave the picker mysteriously empty.
2. **Slack channel picker depends on method.** Bot-token connections → show a channel picker
   (`listChannels`); incoming-webhook-URL connections → **no picker** (channel is fixed by
   the URL); the Notifications tab shows "posts to the webhook's configured channel".
3. **Unknown-variable warning.** On save, parse `{{ }}` in instructions and **warn
   (non-blocking)** for any variable not in the agent's inputs or the known set
   (`payload`, `trigger.*`) — catches typos like `{{ticketKy}}`.
4. **Rotate webhook secret.** The webhook signing secret/token has a **rotate** action
   (mirrors the API-token rotate), revealing the new value once; the sender must be updated.
5. **Queued runs are visible.** When the concurrency limit (§15.1) is hit, the run is created
   with status `queued` and shows in history; it is dropped if the agent is disabled.
6. **Webhook response by state.** Disabled agent → **`200/202` ack + skip** (so Jira/GitHub
   don't retry or alarm), logged "skipped: disabled". Filtered-out event → `200` ack +
   "skipped: filtered". Bad auth → `401`. Deleted agent / unknown webhook id → `410 Gone`.
7. **Partial work on cancel (#5b).** Cancelling mid-run may leave a partial `claude/*` branch
   and no PR; sandbox teardown still runs; the run is marked `cancelled` with whatever
   artifacts exist. **No auto-rollback in v1** — documented behaviour.
8. **Org-wide runs view.** In addition to the per-agent Run-history tab, reuse `runs-list` as
   an admin **"All agent runs"** page, filterable by agent / status / trigger.

---

## Appendix A — Methodology usage (BMAD / OpenSpec) — process, not features

This appendix documents how spec-driven methodologies run **on top of** the agent platform.
**None of this requires changes to the agent product** — it is configuration and convention.

### A.1 BMAD lifecycle (PDLC + AIDLC), Jira-orchestrated
- **Roles are agents.** Analyst / PM / Architect (PDLC) and Scrum Master / Dev / QA (AIDLC)
  are each an `Agent` with role-specific instructions.
- **Jira is the orchestrator.** Each Jira status transition fires the webhook of the agent
  bound to that status (e.g. *In Development* → Dev agent, *In Testing* → QA agent).
- **Context lives in git + the ticket — no context store to manage.** Self-contained
  artifact documents (BMAD principle) plus the Jira ticket as the running ledger. The
  **ticket key** is the correlation key across runs. Agents read/write the ticket via the
  **Atlassian MCP connector** (so the Jira provider stub is not a prerequisite).
- **Polyrepo (one product, many code repos):** a dedicated **docs repo**
  (`acme-product-docs`) holds the PRD / architecture / stories; the architecture's
  `repo-map.md` lists which repo owns what; each story declares `repos: [...]`. At run time
  an agent clones the **docs repo (always) + the story's listed code repos** into one
  workspace. This maps directly onto `Agent.repoSelections[]` (multi-repo, GitHub + GitLab).
- How an agent decides which code repos to clone (story-declared / agent-fixed / clone-all)
  is purely configuration.

### A.2 OpenSpec fit
- **Fits the platform** the same way BMAD does — files-in-git + CLI/slash-commands, no
  server, runs via `bash` + file tools in the sandbox. No agent changes.
- **Weaker fit for this deployment:** OpenSpec is single-repo by design (multi-repo is beta,
  non-cloning, "not for automation") and has no role/status model, so the Jira-status→role
  assembly line isn't native to it. BMAD is the closer fit for the polyrepo + status setup.

### A.3 How BMAD / OpenSpec are delivered (decision: NOT via skills)

**Decision:** BMAD and OpenSpec are **not** delivered through `@journeyman/skills`. The
skills system is left as-is for genuine `SKILL.md` packages (e.g. superpowers). The reason:
the skill registry only discovers skills laid out as `skills/<name>/SKILL.md` (frontmatter:
name + description); the raw BMAD-METHOD / OpenSpec repos lack that layout, so they would
discover **0 skills**. Rather than author wrapper skill packages, we use the agent's
existing settings:

- **BMAD** = a playbook made of **files**. Commit BMAD (`.bmad-core/` + the PRD/architecture/
  stories) into the **brain repo** (the docs repo, for polyrepo products — see A.1). Every
  agent clones that repo, so the files travel with it. The agent's **Instructions** tell it
  to follow the BMAD workflow. Upgrade BMAD by re-running its installer in the brain repo and
  committing — all agents pick up the new version on the next run (optionally pin a version
  or automate the upgrade with a scheduled agent).
- **OpenSpec** = a **command-line tool**. Install it once in the sandbox **environment**
  (baked into the image or a cached setup script) and drive it from **Instructions**.
  Upgrade by bumping its version in the environment.

Rule of thumb: **files → keep them in the repo; tool → install it in the sandbox; real skill
→ pick it in the Skills tab.** Wrapping a methodology as a `SKILL.md` skill remains possible
later but is explicitly **out of scope** for v1.

Sandbox support is uniform across local / docker / windows for all of repos, tools, and
skills (cloned on the host, delivered via the shared `materialize()` API). No backend gaps.

### A.4 Takeaway
The agent platform is **methodology-agnostic**: BMAD, OpenSpec, Spec Kit, or a custom
convention all run as process on top of the same agent, using settings the agent already has
(**Instructions + Repositories + Environment**, plus optional Connectors/Tools/Skills). The
v1 spec does not change for any of them, and the existing skills system is untouched.
