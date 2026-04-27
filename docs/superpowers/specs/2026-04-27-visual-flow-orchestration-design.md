# Visual Flow Builder & Scalable Orchestration — Design

**Date:** 2026-04-27
**Status:** Draft, awaiting user review
**Scope:** Sub-project of the broader Journeyman roadmap. Covers the visual flow builder UI and the orchestration engine behind it. Depends on the (separate) auth + per-user-credentials sub-project, which is described here only as an interface boundary.

---

## 1. Goal

Let admins (and later, end users) build BPMN-style automation flows visually, with a UX that feels like n8n: chunky tiles, click-to-configure, color-coded categories. Flows can include cycles (back-edges), conditional branches, parallel fan-out/join, and per-phase retry/error handling. Running flows are visualized live on the same canvas. Run history, replay, and resume-from-failed are first-class.

The system must scale horizontally (hundreds of concurrent runs across multiple worker machines) and survive worker crashes without losing run state. Everything ships under MIT or Apache 2.0; no proprietary or restricted-license dependencies.

## 2. Non-goals

- Visual diff/merge of flow versions (text JSON diff is sufficient for v1).
- Real-time collaborative editing (multiple users editing the same flow simultaneously). Edits are single-user; concurrent edits use last-writer-wins with version conflict warnings.
- A general-purpose BPMN modeler. Flows speak Conductor JSON, not BPMN 2.0 XML. Portability to Camunda/Flowable is a non-goal.
- The auth, user management, and credential vault (covered by a separate sub-project; assumed available).

## 3. Stack

| Layer | Choice | License | Reason |
|---|---|---|---|
| Canvas / editor | **React Flow** | MIT | Full control over node rendering — required for n8n-look. Lives in `packages/ui`. |
| Orchestration engine | **Conductor (Orkes OSS fork)** | Apache 2.0 | JSON-native workflow definitions, native cycles + gateways, horizontal scale, retry/error/timeout primitives, run history. Runs as a Docker service alongside Postgres + Redis. |
| API/gateway | **`@journeyman/api-server`** (new package) | — | Sits between UI and Conductor. Handles auth, flow JSON ↔ Conductor JSON conversion, SSE bridge for live events. Replaces `pipeline-server` for new flows. |
| Workers | **`@journeyman/orchestrator`** (new package) | — | Conductor JSON converter, worker harness, run-state DAO, phase registry. Existing phase logic from `packages/pipeline` is re-imported (not copied) and wrapped as Conductor workers. |
| Legacy (kept, frozen) | **`@journeyman/pipeline`**, **`@journeyman/pipeline-server`** | — | Frozen at current behavior; existing flows continue to run. Not extended with new features. Removed once all production flows are migrated to the new stack. |
| State | **Postgres + JSONB** | — | Users, flows, flow versions, runs metadata, credentials (encrypted), audit log. JSONB for `flow.definition` and per-run inputs/outputs. |
| Real-time transport (server → browser) | **SSE** (Server-Sent Events) | — | One-way event push; plain HTTP; auto-reconnect. |
| Real-time transport (browser → server) | **REST** | — | Cancel, pause, retry-failed-step, resume — all plain REST calls. |

Total new infra to operate: Conductor server + Redis (Conductor dependency). Postgres is shared with the rest of Journeyman.

## 4. Flow semantics

Flows are **directed graphs with cycles allowed**, modelled on BPMN concepts but expressed as Conductor JSON.

Supported node types:

| Node type | Purpose | Conductor mapping |
|---|---|---|
| `phase` | Run a Journeyman phase (analyze, clone-repos, implement, etc.) via a worker | `SIMPLE` task |
| `gateway-xor` | Branch on a condition expression; exactly one outgoing edge taken | `SWITCH` task |
| `gateway-and` | Parallel split — all outgoing edges activate; matching join waits for all | `FORK_JOIN` + `JOIN` tasks |
| `loop` | Iterate over a collection or until a condition holds | `DO_WHILE` task |
| `start` | Flow entry point | `START_WORKFLOW` |
| `end` | Terminal node. Multiple end nodes per flow are allowed (success, failure, custom outcomes) | terminate task |
| `subflow` | Invoke another flow as a step | `SUB_WORKFLOW` task |
| `if` | Sugar for `gateway-xor` with two outputs labelled `then` / `else`. Same semantics, friendlier UX for the common case. | `SWITCH` task |
| `timer` | Pause execution for a duration, until a wall-clock time, or until a cron expression fires. Used both in the middle of a flow ("wait 30 minutes before retrying") and as a flow trigger. | `WAIT` task |
| `retry-block` | Wraps a region of nodes (one or more) with a shared retry policy. The whole region re-executes from its entry node when a node inside fails, up to the block's `maxAttempts`. Useful when a multi-step operation must be atomic (e.g. clone → analyze → plan, retry the trio together on transient failure). | `DO_WHILE` with `failurePolicy` |
| `try-catch` | Region with a primary path and one or more catch branches keyed by error class. Cleaner than per-phase error edges when several phases share a recovery path. | `DO_WHILE` + error routing |
| `human-task` (v2 — Phase 6+) | Pause until a user provides input (approve/reject, fill a form). Out of scope for v1 but reserved in the type system. | `HUMAN` task |

Edges:

- Each edge has an optional condition expression evaluated against the run context. Conditions are written in JSONLogic (safe, embeddable — see `IConditionEvaluator`).
- Each `phase` node has a normal output and a separate **error output edge**. On permanent failure (retries exhausted), execution follows the error edge if present; otherwise control bubbles up to the nearest enclosing `try-catch` / `retry-block`, or fails the run.
- Edges have a **type**: `default`, `conditional`, `error`, `else`. Type drives both rendering (color, dash style) and routing logic.
- Cycles are permitted. Runaway loops are prevented by `flow.maxCycleVisits` (default 100): the engine tracks per-node visit counts and aborts the run with a `CycleLimitExceeded` error if any node is visited more than this many times. This is independent of the per-phase retry policy (retries are within a single attempt of a node; cycles are repeated visits to a node via back-edges).

### Retry — three levels (orthogonal)

Retry exists at three levels and they compose. Each is configured separately:

| Level | Where configured | What re-executes | Use case |
|---|---|---|---|
| **Per-phase retry** | Node's "Retry & Errors" tab | Just that one node | Transient API errors (rate limits, network blips) |
| **Retry-block (region)** | The `retry-block` node's properties | Every node inside the block | Multi-step atomic operations |
| **Flow-level retry** | Start node's flow settings | The whole flow | Infra-wide failures, scheduled-job resilience |

A failed phase first exhausts its own per-phase retries, then falls through to the enclosing `retry-block` if any, then to the flow-level retry policy.

Multiple terminal nodes are supported (e.g. one `end` for success, one for each error class). The first end node reached terminates the run with that node's `outcome` label.

## 5. Node anatomy (properties panel)

When a user clicks a node on the canvas, a side drawer opens with five tabs:

### 5.1 Config
- Phase type (dropdown, drives the rest of the form)
- Display name (free text shown on the canvas tile)
- Provider (e.g. Claude / Gemini / Codex for AI phases; GitHub / GitLab for VCS phases)
- Phase-specific fields (prompt template for AI phases, repo selector for VCS phases, etc.) — rendered dynamically from a JSON schema registered per phase type

### 5.2 MCP & Tools
- Multi-select **MCP servers** for this phase. Three sources:
  - Built-in (filesystem, git) — stdio
  - Provided remote (Jira, Slack, Atlassian) — HTTP / SSE, credentials resolved from user vault
  - User-supplied custom — free-form server config block (transport, command/url, args, env)
- **Allowed tools** whitelist (e.g. `Bash, Read, mcp__jira__*`)

### 5.3 Credentials
- Map from env var name → credential reference
- A reference is either `user.<name>` (resolves to the running user's vault entry) or `flow.<name>` (resolves to a flow-level override)
- Flow-level overrides win when both exist
- Values are never stored in flow JSON; only references are

### 5.4 Retry & Errors
| Field | Stored as | Conductor mapping |
|---|---|---|
| Retry enabled | `retry.enabled: bool` | sets `retryCount` to N or 0 |
| Max attempts | `retry.maxAttempts: int` | `retryCount` |
| Backoff strategy | `retry.backoff: "fixed" \| "linear" \| "exponential"` | `retryLogic` |
| Backoff base seconds | `retry.backoffSeconds: int` | `retryDelaySeconds` |
| Backoff multiplier | `retry.backoffMultiplier: number` | `backoffScaleFactor` |
| Per-attempt timeout | `retry.timeoutSeconds: int` | `timeoutSeconds` |
| Retry-on patterns | `retry.retryOn: string[]` | worker-side check, returns `RETRYABLE` vs `FATAL` |
| Stop-on patterns | `retry.stopOn: string[]` | worker-side short-circuit |
| On permanent failure | `retry.onFailure: "error-edge" \| "fail-flow"` | failure edge routing |

A flow-level retry policy lives on the start node:
- `flow.retry.maxAttempts: int` (default 1)
- `flow.retry.backoffSeconds: int` (default 30)

### 5.5 Inputs / Outputs
- **Inputs** — wire upstream node outputs (or run context fields) into this node's named inputs. UI shows `<inputName> ← <upstreamNode.outputPath>` rows.
- **Output schema** — JSON schema for what this node emits, used to populate downstream wiring autocomplete.

## 6. Builder layout

Hybrid collapsible-sidebars layout:
- **Top bar** — flow name, version status (saved/unsaved/dirty), Run / Test-run buttons
- **Left sidebar** (collapsible to icons) — phase palette grouped by category (Tickets, Repos, AI, Conditions, Notify, Custom)
- **Canvas** — React Flow with custom node and edge components matching the n8n visual language
- **Right sidebar** (collapsible to icons) — properties panel (the 5 tabs) when a node is selected; flow-level settings when nothing is selected

Default state on opening a flow: both sidebars open. Each user's collapse preference is remembered in local storage.

## 7. Live-run visualization

Selected option: **canvas-only by default, click a node to open its detail drawer.** Clean default view; multiple concurrent runs are scannable at a glance.

### 7.1 Visual language

| State | Visual |
|---|---|
| Pending (not yet reached) | Dashed gray border, faded fill |
| Running | Solid blue border, pulsing glow, `⟳` icon, animated dashed flow on incoming edge |
| Retry backoff | Solid amber border, `↻` icon, "attempt X of Y" subtext |
| Completed (success) | Solid green border, `✓` icon, duration in subtext |
| Failed (permanent) | Solid red border, `⚠` icon, error-class label in subtext |
| Cycled (visited multiple times) | `×N` badge in top-right corner |

### 7.2 Node detail drawer (on click)

Right-side drawer showing the selected node's:
- Status, attempt counter, started/completed timestamps, duration
- Input payload (JSON viewer)
- Live-streaming output (for active phases) — appended via SSE; final output once completed
- Per-attempt history (timeline of attempts with their errors)
- Logs scoped to this node

### 7.3 Run controls (top bar in run mode)

- **Pause** — Conductor `pauseWorkflow`
- **Cancel** — Conductor `terminate`
- **Retry failed step** — opens contextually on a failed node; calls Conductor `retryWorkflow` from that task
- **Re-run** — clones inputs into a new run

## 8. Run history & replay

### 8.1 Runs list
- Sortable, filterable table: status, run #, trigger source (manual / webhook / schedule), user, started, duration, failed-at-step
- Filters: status, time range, user, flow version
- Each row links to a frozen canvas view of that run

### 8.2 Replay actions on a finished run
1. **Re-run** — submit a new run with the same initial inputs.
2. **Resume from failed step** — Conductor `retryWorkflow` from the failed task; upstream nodes' outputs are kept.
3. **Re-run with edits (fork)** — open the run as a draft in the editor; user tweaks inputs / prompts / wiring; submit as a new run. The original flow definition is unchanged.
4. **Export run** — JSON dump (definition + run state + per-task input/output/logs) for sharing or offline debugging.

### 8.3 Versioning
- Flow definitions are immutable per version. Saving an edit creates a new version.
- Each run records which `flow_version_id` it executed.
- The runs list shows the version number per run.
- Resume / fork-edit always operate against the version the run executed under, never the latest.

## 9. Data model (Postgres)

Core tables (omitting auth tables, which are part of the separate sub-project):

```sql
flows            (id, owner_user_id, name, description, current_version_id, created_at, updated_at)
flow_versions    (id, flow_id, version_number, definition jsonb, created_by_user_id, created_at)
runs             (id, flow_version_id, status, trigger_source, started_by_user_id,
                  conductor_workflow_id, started_at, completed_at, duration_ms,
                  failed_at_node_id nullable, inputs jsonb, outputs jsonb)
run_events       (id, run_id, node_id, event_type, payload jsonb, ts)   -- append-only event log
node_executions  (id, run_id, node_id, attempt, status, started_at, completed_at,
                  input jsonb, output jsonb, error_class nullable, error_message nullable)
flow_credentials (id, flow_id, name, encrypted_value bytea, kms_key_id)
mcp_definitions  (id, scope ("builtin" | "user" | "flow"), name, transport, config jsonb,
                  owner_user_id nullable, owner_flow_id nullable)
```

`run_events` is the source of truth for what the UI's SSE stream replays on reconnect (the server can backfill all events the client missed by `since_event_id`).

## 9.4 Extensibility — adapter interfaces

Every external dependency or environment-specific concern is hidden behind an interface in `@journeyman/core`. Implementations live in their own packages or files. Consumers depend only on the interface. This keeps the system generic and lets us swap any of these without touching the rest:

| Interface (in `@journeyman/core`) | Default v1 impl | Future impls |
|---|---|---|
| `IOrchestratorEngine` | `ConductorOrchestrator` (Orkes) | Temporal, Flowable, in-process for tests |
| `IPhaseHandler` (formalize existing pattern) | wrappers around `@journeyman/pipeline` phases | new domain-specific phases registered by plugins |
| `IPhaseRegistry` | `InMemoryPhaseRegistry` populated at boot | DB-backed registry for runtime-loaded plugins |
| `IMcpProvider` | `BuiltinMcpProvider`, `UserVaultMcpProvider`, `FlowDefinedMcpProvider` | org-level provider, marketplace provider |
| `ICredentialStore` | `EnvCredentialStore` (v1, like today's `.env`) | `PostgresEncryptedCredentialStore` (Phase 5+), Vault, AWS KMS |
| `IFlowStore` | `PostgresFlowStore` | filesystem (for tests / single-user mode), git-backed |
| `IRunStore` | `PostgresRunStore` | ClickHouse for analytics, S3 archival |
| `IEventBus` | `PostgresEventBus` (uses `run_events` table) | NATS / Redis Streams when scale demands it |
| `IWorkspaceProvider` | `DirectoryWorkspaceProvider` (dir-per-run) | `DockerWorkspaceProvider`, `K8sWorkspaceProvider` |
| `IAuthProvider` | `NoAuthProvider` (v1), then `PasswordAuthProvider` (Phase 7) | OIDC, SAML, GitHub OAuth |
| `IUserContext` | resolved by `IAuthProvider`, exposes `userId`, `roles`, scope helpers | — |
| `INotificationChannel` | none in v1 | reuse `@journeyman/notification-provider` |
| `IConditionEvaluator` | `JsonLogicEvaluator` (safe, embeddable) | JS sandbox, custom DSL |
| `IFlowJsonConverter` | `ConductorJsonConverter` | future engine adapters |

### Rules
- **Interface-first.** Every adapter starts as an interface in `@journeyman/core`; the implementation cannot be added until the interface is committed.
- **No cross-imports between adapters.** A `ConductorOrchestrator` doesn't know about `PostgresFlowStore` — it only knows `IFlowStore`.
- **Composition root** is `@journeyman/api-server`'s startup code. It's the only place that wires concrete implementations together. Replacing an implementation = changing one line in the composition root.
- **Plugin registration** for phase types follows the existing `@journeyman/coding-cli` provider pattern: each plugin exports a `register(registry)` function called at server startup.
- **Tests pin to interfaces.** Unit tests use in-memory implementations; integration tests use the real ones. No test depends on a concrete adapter.

## 9.5 Component-based UI

The UI is delivered as standalone React components, **not** as a single monolithic app. The shell app (`packages/ui`) composes these components, but each is independently consumable in any host app — a per-user dashboard, a future marketplace, an admin tool, an embedded customer view.

| Component (npm package) | Inputs (props) | Outputs (callbacks) | Backend assumptions |
|---|---|---|---|
| `<FlowEditor>` (`@journeyman/flow-editor`) | `flow`, `phaseCatalog`, `mcpCatalog`, `credentialOptions`, `readOnly` | `onChange(flow)`, `onSave(flow)`, `onRun(flow, inputs)` | None — purely presentational |
| `<RunViewer>` (`@journeyman/run-viewer`) | `flow`, `runId`, `eventSource`, `onLoadNodeDetail` | `onCancel`, `onPause`, `onRetryStep`, `onForkEdit` | None — consumer provides event source and callbacks |
| `<RunsList>` (`@journeyman/runs-list`) | `runs`, `filters`, `pagination` | `onSelectRun`, `onFilterChange`, `onRerun`, `onLoadMore` | None — consumer provides data |
| `<PropertiesPanel>` (used inside `<FlowEditor>`) | `node`, `phaseCatalog`, `mcpCatalog`, `credentialOptions` | `onChange(node)` | None |
| `<JourneymanShell>` (`packages/ui`) | composes the above against `api-server` REST + SSE | — | Knows about Journeyman's specific backend |

### Why this matters
- **The future user-facing dashboard** can embed `<FlowEditor>` and `<RunViewer>` for a logged-in user against their own data, without re-implementing the canvas.
- **A future marketplace** can render `<FlowEditor readOnly>` to show a published flow.
- **Tests** can render the components with mock data — no server needed.
- **Embeddability** — third parties (or Cadmium internal tools) can drop the components into their own apps with their own backends as long as they implement the same data contracts.

### Rules
- Components must not import from `api-server` or fetch directly. All I/O goes through props/callbacks.
- Components import only from `@journeyman/core` (types) and their own dependencies.
- Each component is published as its own package with its own `package.json`, even though they live in the same monorepo, so consumers can pull just one.
- The shell (`packages/ui`) is the only piece that knows about Journeyman's specific REST/SSE endpoints.

## 9.5.1 Package layout

Two new packages are introduced. The two existing packages (`pipeline`, `pipeline-server`) are kept frozen as legacy and continue to serve their current flows during cutover.

```
packages/
├── core/                          (existing — extended: all new adapter interfaces live here)
├── coding-cli/                    (existing — unchanged)
├── git-provider/                  (existing — unchanged)
├── github-api/                    (existing — unchanged)
├── ticket-provider/               (existing — unchanged)
├── notification-provider/         (existing — unchanged)
├── pipeline/                      (LEGACY — frozen, no new features)
├── pipeline-server/               (LEGACY — frozen, no new features)
│
├── orchestrator/                  (NEW — @journeyman/orchestrator)
│   └── src/
│       ├── engines/
│       │   └── conductor/         (ConductorOrchestrator — implements IOrchestratorEngine)
│       ├── flow-json/             (ConductorJsonConverter — implements IFlowJsonConverter)
│       ├── workers/               (worker harness; phases register via IPhaseRegistry)
│       ├── stores/
│       │   ├── postgres/          (PostgresFlowStore, PostgresRunStore, PostgresEventBus)
│       │   └── memory/            (in-memory impls for tests)
│       ├── workspace/             (DirectoryWorkspaceProvider — implements IWorkspaceProvider)
│       ├── credentials/           (EnvCredentialStore v1; PostgresEncryptedCredentialStore later)
│       ├── conditions/            (JsonLogicEvaluator — implements IConditionEvaluator)
│       └── index.ts               (exports composition helpers, no concrete defaults)
│
├── api-server/                    (NEW — @journeyman/api-server)
│   └── src/
│       ├── routes/                (REST: flows, runs, retry-step, fork, etc.)
│       ├── sse/                   (SSE event stream + replay-since)
│       ├── auth/                  (uses IAuthProvider)
│       ├── composition.ts         (THE wiring point — picks which adapters to use)
│       └── index.ts
│
├── flow-editor/                   (NEW — @journeyman/flow-editor — pure React component)
│   └── src/
│       ├── canvas/                (React Flow + custom nodes/edges)
│       ├── palette/
│       ├── properties-panel/      (the 5-tab panel)
│       └── index.ts               (exports <FlowEditor>)
│
├── run-viewer/                    (NEW — @journeyman/run-viewer — pure React component)
│   └── src/
│       ├── canvas/                (read-only canvas with status visuals)
│       ├── node-detail-drawer/
│       └── index.ts               (exports <RunViewer>)
│
├── runs-list/                     (NEW — @journeyman/runs-list — pure React component)
│   └── src/
│       └── index.ts               (exports <RunsList>)
│
└── ui/                            (existing — becomes the shell that composes the above
                                    against api-server's REST + SSE; ships <JourneymanShell>)
```

### Boundary rules
- `@journeyman/orchestrator` is the only package that talks to Conductor. `api-server` consumes it as a library.
- Phase logic stays in `@journeyman/pipeline` for now and is **re-exported** into the worker harness, not copied. (When `pipeline` is eventually retired, individual phases migrate into per-domain packages or into `orchestrator/workers/phases/`.)
- `@journeyman/core` remains the single source of truth for shared types — both new packages depend on it.
- Legacy `pipeline-server` is left running for existing webhooks/triggers until all flows are migrated. Both servers share the same Postgres database; new tables (`flows`, `flow_versions`, `runs`, etc.) belong to the new stack.

### Migration path
1. **Phase 1** — new packages built, run in parallel with legacy. New flows go through new stack; old flows untouched.
2. **Phase 2** — once new stack is stable, port the highest-value legacy flows by re-creating them in the new editor.
3. **Phase 3** — once the legacy `pipeline-server`'s production traffic drops to zero, mark the legacy packages deprecated. Remove after one release cycle.

## 10. API surface (`@journeyman/api-server`)

REST:
- `GET /flows`, `GET /flows/:id`, `POST /flows`, `PUT /flows/:id` (creates new version)
- `GET /flows/:id/versions`, `GET /flows/:id/versions/:n`
- `POST /flows/:id/runs` — start a run
- `GET /runs?flow_id=&status=&user=&from=&to=`
- `GET /runs/:id` — full run state
- `POST /runs/:id/cancel`, `POST /runs/:id/pause`, `POST /runs/:id/resume`
- `POST /runs/:id/retry-step` — body: `{ node_id }`
- `POST /runs/:id/fork` — opens as editor draft

SSE:
- `GET /runs/:id/events?since=<event_id>` — replays missed events then streams live; emits typed events: `phase.started`, `phase.log`, `phase.failed`, `phase.retrying`, `phase.completed`, `node.cycled`, `run.completed`, `run.failed`, `run.cancelled`

## 11. Worker model

Each phase type ships as a small Node process that:
1. Long-polls Conductor for tasks of its type (`POLL /tasks/poll/<phase-type>`)
2. Resolves credentials by calling `pipeline-server` with the run's user context
3. Executes the existing phase logic from `packages/pipeline`
4. Streams intermediate output as `phase.log` events back through `pipeline-server`'s ingest endpoint
5. Reports `RETRYABLE` vs `FATAL` based on `retry.retryOn` / `retry.stopOn` patterns
6. Returns final result to Conductor

Workers are stateless. Scale by running N copies. A single worker process can host multiple phase types.

## 12. Phased delivery

Seven phases. Each phase is independently shippable, demoable, and merges to main on its own. Later phases never break what earlier phases delivered. Each phase will get its own implementation plan written when we're ready to start it — we do **not** plan all seven up front.

### Phase 1 — Foundation: hand-authored flows running on Conductor
**Goal:** Prove the new stack end-to-end with no UI, using JSON files. Lock in adapter interfaces now so later phases plug into them, not refactor them.
- Define adapter interfaces in `@journeyman/core`: `IOrchestratorEngine`, `IFlowStore`, `IRunStore`, `IEventBus`, `IPhaseRegistry`, `IPhaseHandler`, `IWorkspaceProvider`, `ICredentialStore`, `IConditionEvaluator`, `IAuthProvider`, `IFlowJsonConverter`. (Even ones we don't implement yet — define the interface so callers aren't tempted to import concretes.)
- Scaffold `@journeyman/orchestrator` and `@journeyman/api-server` packages, workspace wiring, typecheck green
- Docker Compose: Conductor server + Redis + (existing) Postgres
- Postgres schema: `flows`, `flow_versions`, `runs`, `run_events`, `node_executions` (new tables only; legacy untouched)
- Implement: `ConductorOrchestrator`, `ConductorJsonConverter`, `PostgresFlowStore`, `PostgresRunStore`, `PostgresEventBus`, `DirectoryWorkspaceProvider`, `EnvCredentialStore`, `JsonLogicEvaluator`, `NoAuthProvider`, `InMemoryPhaseRegistry`
- Worker harness in `orchestrator/workers/`; register the existing `analyze` phase as an `IPhaseHandler`
- Composition root in `api-server/src/composition.ts` — the only place concrete adapters are picked
- Minimal REST in `api-server`: `POST /flows`, `GET /flows/:id`, `POST /flows/:id/runs`, `GET /runs/:id`
- **Demo:** `curl` a hand-edited flow JSON in, observe it run in Conductor's built-in UI, fetch result via REST.
- **Architectural exit criterion:** swap one adapter (e.g. `PostgresFlowStore` → in-memory) by changing only `composition.ts`, with no other file touched. If you can't, the boundaries are wrong.

### Phase 2 — Editor v0 (linear flows)
**Goal:** First UI; replace `curl` with a canvas.
- React Flow editor in `packages/ui`: `start`, `phase`, `end` node types only — no gateways, no loops, no cycles
- Properties panel: **Config tab only** (phase type, display name, provider, prompt template)
- Save/load flows via `api-server`
- "Run" button submits a run; UI shows run id, links to Conductor UI for live status
- **Demo:** Build a linear 3-step flow visually, click Run, see it execute.

### Phase 3 — Live run view + run history
**Goal:** Bring run observation into the product.
- SSE endpoint `GET /runs/:id/events` on `api-server`; bridge from Conductor → SSE
- Read-only canvas in "Run view" mode with the full visual language (pending/running/completed/failed/retry-backoff colors, animated edges)
- Click-node-for-detail drawer: input, live-streaming output, attempts, logs
- Runs list page: table with status, run #, trigger, user, started, duration, failed-at-step + filters
- Re-run action (the simplest replay)
- **Demo:** Watch a run animate live on your own canvas; browse a list of past runs; re-run one.

### Phase 4 — Full BPMN semantics
**Goal:** Cycles, branches, parallel — the BPMN-flavored shape you actually want.
- Add node types: `gateway-xor`, `gateway-and` (with matching join), `loop` (DO_WHILE), `subflow`
- Multiple `end` nodes per flow with `outcome` labels
- Conditional edges (expression on each edge)
- Per-phase error output edge (red, secondary handle on each phase node)
- `flow.maxCycleVisits` enforcement + visit-count badge on cycled nodes
- Editor-side validation (cycle requires at least one end-reachable path; XOR requires conditional edges; etc.)
- **Demo:** Build a flow with a retry loop, parallel fan-out across 3 repos, an error branch, and two end states.

### Phase 5 — Properties panel completion
**Goal:** Full configurability per phase.
- **MCP & Tools tab** — built-in / provided / custom MCP picker, allowed-tools whitelist
- **Credentials tab** — env var → credential reference mapping (depends on auth sub-project; until that lands, falls back to a single static `.env` like today)
- **Retry & Errors tab** — all retry/backoff/timeout/conditional-retry fields per the design
- **Inputs/Outputs tab** — wire upstream node outputs to this node's inputs; output schema editor
- Flow-level retry policy on the start node
- **Demo:** A flow that uses a Jira MCP server, retries on RateLimitError up to 3 times with exponential backoff, routes ValidationError to a Notify node via the error edge.

### Phase 6 — Advanced run actions
**Goal:** Power-user run management.
- Resume from failed step (Conductor `retryWorkflow` from a specific task)
- Fork-edit (open a finished run as an editor draft, tweak inputs/prompts, submit as new run)
- Pause / Cancel buttons on the run view
- Export run as JSON
- **Demo:** A flow fails at step 6; user fixes the prompt in fork-edit, submits a new run that succeeds.

### Phase 7 — Cutover & legacy retirement
**Goal:** Move existing flows off legacy `pipeline-server`.
- Per-user workspace abstraction (`IWorkspace.create()/destroy()`) with directory-per-run impl
- Credential resolution at run time via the auth sub-project's API
- Feature-parity audit vs. legacy `pipeline-server`
- Migration recipes documented for each existing legacy flow
- Mark `@journeyman/pipeline` and `@journeyman/pipeline-server` as deprecated in their `package.json`
- After one release cycle with zero traffic on legacy, remove the legacy packages
- **Demo:** All production flows running on the new stack; legacy packages removed from the repo.

### Cross-phase rules
- Each phase ships behind a feature flag where it can affect existing behavior. New flows are opt-in until Phase 7.
- Each phase ends with: tests passing, typecheck green, manual demo recorded, design doc updated with any deviations.
- We write the **next** phase's implementation plan only when the **current** phase has merged. No batched planning.

Each of these will become its own implementation plan.

## 13. Open dependencies

- **Auth + credentials sub-project** must define: how the worker resolves a credential reference at run time (an internal API the worker calls, which checks `user.is_authorized_for_flow(flow_id)` then returns decrypted env vars). Until that lands, v1 can use a single static `.env` like today.
- **Per-user workspace abstraction** — design as `IWorkspace.create() / .destroy()` in `@journeyman/core` so the directory-per-run impl can be swapped for Docker later.
- **MCP catalog** — needs a simple admin-managed registry of provided MCP servers (separate small project).

## 14. Risk register

| Risk | Mitigation |
|---|---|
| Conductor learning curve | Start with hand-authored Conductor JSON + a single phase before building the converter |
| SSE behind some corporate proxies | Document fallback: long-polling endpoint hits same `run_events` table |
| Cycle UX confusion (which node is "now"?) | Cycle visit-count badge + per-attempt history in node drawer |
| Run history table growth | Partition `run_events` by `run_id` modulo or by month; archive old runs to S3 after N days |
| Flow JSON migrations between schema versions | Each saved version stores its `schema_version`; converter handles upgrades on read |
