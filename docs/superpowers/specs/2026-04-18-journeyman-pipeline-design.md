# Journeyman Pipeline — Design

**Date:** 2026-04-18
**Status:** Proposed
**Package:** `@journeyman/pipeline` (new)

## 1. Goal

Build a configurable, phase-based pipeline on top of the existing Journeyman adapters (`coding-cli`, `git-provider`, `ticket-provider`, `notification-provider`) that automates ticket → PR flow. The pipeline is webhook-driven, per-customer configurable, and ships with a management HTTP API for status, logs, streaming, and cancellation.

This is the TypeScript equivalent of auto-pilot's Python pipeline controller, using the adapters already built in this monorepo.

## 2. Non-goals (v1)

- Human review loop (review phase is a stub that marks the run `blocked`).
- Multi-process / queue-based horizontal scaling (runs execute in-process).
- Per-customer API keys (single shared bearer token).
- Database-backed state or flow config (interfaces are in place; default impls are filesystem-based).
- Web UI (SSE + REST is enough for v1; UI is a later package).

## 3. Package Layout

New package `packages/pipeline/` in the existing monorepo.

```
packages/pipeline/src/
├── index.ts                        — public exports
├── interface.ts                    — re-exports from @journeyman/core
├── pipeline.ts                     — Pipeline runner + runPipeline()
├── context.ts                      — PipelineContext builder
├── registry/
│   ├── provider-registry.ts        — registers adapters by id, resolves per-flow
│   └── phase-registry.ts           — registers IPhase classes by step name
├── phases/
│   ├── analyze.ts
│   ├── plan.ts
│   ├── implement.ts
│   └── review.ts                   — stub for v1
├── state/
│   ├── file-state-store.ts         — default IStateStore
│   └── file-trace-logger.ts        — default ITraceLogger
├── config/
│   └── yaml-flow-config-source.ts  — default IFlowConfigSource
├── server/
│   ├── http-server.ts              — Fastify boot
│   ├── triggers/
│   │   ├── github-webhook.ts
│   │   ├── gitlab-webhook.ts
│   │   ├── jira-webhook.ts
│   │   └── api-trigger.ts
│   └── api/
│       ├── status.ts               GET  /api/runs/:sessionId
│       ├── list.ts                 GET  /api/runs
│       ├── logs.ts                 GET  /api/runs/:sessionId/logs
│       ├── stream.ts               GET  /api/runs/:sessionId/stream (SSE)
│       ├── cancel.ts               POST /api/runs/:sessionId/cancel
│       ├── resume.ts               POST /api/runs/:sessionId/resume
│       ├── flows.ts                GET  /api/flows
│       ├── providers.ts            GET  /api/providers
│       └── health.ts               GET  /api/health
└── cli.ts                          — `journeyman run ...`
```

New interfaces/types in `@journeyman/core`: `IPhase`, `IStateStore`, `IFlowConfigSource`, `IFlowResolver`, `ITriggerSource`, `ITraceLogger`, `IProviderMeta`, `PipelineRun`, `StepRecord`, `PhaseResult`, `PipelineContext`, `FlowDefinition`, `PipelineTrigger`, `PipelineEvent`.

## 4. Core Types

```ts
interface IProviderMeta {
  id: string;
  name: string;
  description: string;
  category: "coding-cli" | "git" | "ticket" | "notification";
}

interface IPhase {
  readonly name: string;
  run(ctx: PipelineContext, stepConfig: unknown): Promise<PhaseResult>;
}

type PhaseResult =
  | { status: "ok"; artifacts: Record<string, unknown> }
  | { status: "blocked"; reason: string; waitFor?: "ticket-comment" | "pr-comment" | "manual" }
  | { status: "failed"; error: { message: string; code?: string; cause?: unknown } };

interface PipelineContext {
  sessionId: string;
  ticketKey: string;
  flowName: string;
  customerId?: string;
  signal: AbortSignal;
  providers: {
    ticket: ITicketProvider;
    git: IGitProvider;
    coding: ICodingCLI;
    notification: INotificationProvider;
  };
  artifacts: Record<string, unknown>;
  state: PipelineRun;
  trace: ITraceLogger;
  emit(event: PipelineEvent): void;
}

interface PipelineRun {
  sessionId: string;
  ticketKey: string;
  flowName: string;
  customerId?: string;
  status: "running" | "blocked" | "completed" | "failed" | "cancelling" | "cancelled";
  currentStep: string | null;
  steps: StepRecord[];
  artifacts: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface StepRecord {
  name: string;
  attempt: number;
  status: "pending" | "running" | "ok" | "blocked" | "failed" | "cancelled";
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: { message: string; code?: string; stack?: string };
  blockedReason?: string;
}

interface FlowDefinition {
  name: string;
  providers: { ticket: string; git: string; coding: string; notification: string };
  steps: { name: string; config?: Record<string, unknown>; retry?: { attempts: number; backoffMs: number }; timeoutMs?: number }[];
}

interface IFlowConfigSource { getFlow(name: string): Promise<FlowDefinition>; listFlows(): Promise<string[]>; }
interface IStateStore       { load(sessionId: string): Promise<PipelineRun | null>; save(run: PipelineRun): Promise<void>; findByTicket(ticketKey: string): Promise<PipelineRun[]>; find(query: { status?: PipelineRun["status"]; limit?: number }): Promise<PipelineRun[]>; }
interface ITraceLogger      { log(sessionId: string, step: string, line: string, level?: "info"|"warn"|"error"): Promise<void>; read(sessionId: string, step?: string): AsyncIterable<{ ts: string; level: string; step: string; message: string }>; }
interface ITriggerSource    { id: string; mount(app: FastifyInstance, onTrigger: (t: PipelineTrigger) => void): void; }
interface IFlowResolver     { resolve(trigger: PipelineTrigger): Promise<{ flowName: string; customerId?: string }>; }

interface PipelineTrigger {
  sourceId: string;
  ticketKey: string;
  flowName?: string;
  customerId?: string;
  rawPayload: unknown;
  receivedAt: string;
}

type PipelineEvent =
  | { type: "runStarted";   sessionId: string; ticketKey: string; flowName: string; at: string }
  | { type: "stepStarted";  sessionId: string; step: string; attempt: number; at: string }
  | { type: "stepEnded";    sessionId: string; step: string; attempt: number; status: StepRecord["status"]; durationMs: number; at: string }
  | { type: "logLine";      sessionId: string; step: string; level: string; line: string; at: string }
  | { type: "statusChanged";sessionId: string; from: PipelineRun["status"]; to: PipelineRun["status"]; at: string }
  | { type: "runEnded";     sessionId: string; status: PipelineRun["status"]; at: string };
```

Every adapter provider class exposes a `static meta: IProviderMeta`. The `ProviderRegistry` auto-discovers them by importing the provider classes and indexing by `meta.id` + `meta.category`.

## 5. Configuration

### 5.1 Layout

```
config/
├── pipeline.yaml                   — global config
└── flows/
    ├── default.yaml                — one FlowDefinition per file
    ├── customer-acme.yaml
    └── quick-fix.yaml
```

### 5.2 `pipeline.yaml`

```yaml
defaults:
  flow: default

customers:
  acme:   { flow: customer-acme }
  globex: { flow: quick-fix }

customerMapping:
  byJiraProject: { EV: acme, GLX: globex }
  byGitRepo:     { "acme/*": acme }

server:
  port: 3000
  bearerTokenEnv: JOURNEYMAN_API_TOKEN
  triggers:
    - { id: github-webhook, path: /webhooks/github, secretEnv: GITHUB_WEBHOOK_SECRET }
    - { id: gitlab-webhook, path: /webhooks/gitlab, secretEnv: GITLAB_WEBHOOK_SECRET }
    - { id: jira-webhook,   path: /webhooks/jira,   secretEnv: JIRA_WEBHOOK_SECRET }
    - { id: api,            path: /api/trigger }

state:
  store: file
  path: .pipeline-state

trace:
  logger: file
  path: logs
```

### 5.3 `flows/<name>.yaml`

```yaml
name: customer-acme
providers: { ticket: jira, git: github, coding: claude, notification: slack }
steps:
  - { name: analyze }
  - { name: security-scan }
  - { name: plan, config: { brainstormRounds: 2 } }
  - { name: implement, config: { coding: codex }, retry: { attempts: 2, backoffMs: 5000 }, timeoutMs: 1800000 }
  - { name: review }
```

`YamlFlowConfigSource` globs `config/flows/*.yaml` at startup, validates each with a Zod schema, and indexes by `name`. Invalid flow → fail fast with file path + error. Optional chokidar hot-reload for dev.

### 5.4 Flow resolution order

1. Explicit `trigger.flowName` from the trigger payload or API call.
2. Customer-level `customers[customerId].flow` — `customerId` extracted by the trigger using `customerMapping`.
3. Global `defaults.flow`.

`IFlowResolver` encapsulates this chain; the default implementation reads `pipeline.yaml`. Swap for a DB-backed resolver later without touching the runner.

## 6. Runner (`Pipeline.run(trigger)`)

1. `IFlowResolver.resolve(trigger)` → `{ flowName, customerId }`.
2. `IFlowConfigSource.getFlow(flowName)`.
3. Create `PipelineRun` with a new `sessionId` (uuid v4), `status: running`, empty `steps`, empty `artifacts`. Persist via `IStateStore.save`. Emit `runStarted`.
4. `ProviderRegistry.resolveForFlow(flow)` → concrete adapter instances. Build `PipelineContext` (including an `AbortController` and its signal).
5. For each `step` in `flow.steps`:
   1. If `ctx.signal.aborted` → mark run `cancelled`, save, emit `runEnded`, return.
   2. Resolve `IPhase` from `PhaseRegistry` by `step.name` (unknown name → fail fast at flow-load time, not here).
   3. Per-step attempt loop (1..`retry.attempts + 1`, default 1):
      - Append `StepRecord { status: running, attempt, startedAt }`. Save. Emit `stepStarted`.
      - Apply `step.timeoutMs` via `AbortSignal.timeout` merged with `ctx.signal`.
      - Call `phase.run(ctx, step.config)` inside try/catch.
      - On uncaught throw → convert to `PhaseResult.failed`.
      - Merge `artifacts` (on `ok`) into `ctx.artifacts`.
      - Update `StepRecord` with outcome, `endedAt`, `durationMs`, `output`/`error`. Save. Emit `stepEnded`.
      - On `ok` → break attempt loop, move to next step.
      - On `blocked` → set `run.status = blocked`, save, emit `runEnded`, return (no further attempts).
      - On `failed` → if attempts remain, sleep `backoffMs`, retry; else set `run.status = failed`, save, emit `runEnded`, return.
6. All steps ok → `run.status = completed`. Save. Emit `statusChanged` + `runEnded`. `providers.notification.send(...)` with summary.

All state saves are atomic (write-tmp + rename for `FileStateStore`).

## 7. Phases

Each phase is a small class extending `BasePhase`. Phases only read from and write to `ctx.artifacts` — they never import each other. This is what makes steps reorderable and pluggable.

### 7.1 `AnalyzePhase` (`analyzing`)
- Reads: `ctx.ticketKey`, `ctx.providers.ticket`.
- Does: `ticket.getTicket` → `coding.analyze({ ticket })` → produces `TICKET.md` + structured summary.
- Writes: `artifacts.ticket`, `artifacts.ticketMd`, `artifacts.analysis`.
- Side effects: ticket comment at start and end.
- Blocked condition: missing required ticket fields → `blocked("missing acceptance criteria", "ticket-comment")`.

### 7.2 `PlanPhase` (`planning`)
- Reads: `artifacts.analysis`, `artifacts.ticketMd`.
- Does: `coding.plan({ analysis, rounds: config.brainstormRounds })`.
- Writes: `artifacts.plan`, `artifacts.planMd`.
- Side effects: ticket comment with plan summary.
- Blocked condition: plan requests clarification.

### 7.3 `ImplementPhase` (`developing`)
- Reads: `artifacts.plan`, `artifacts.ticket`.
- Does: `coding.cloneRepos` → `coding.implement({ plan, repoPath })` → `coding.commitPushRepos` → `git.createPullRequest`.
- Writes: `artifacts.branch`, `artifacts.commitSha`, `artifacts.prUrl`, `artifacts.diffStats`.
- Side effects: ticket comment with PR link; `notification.send`.
- Failure modes: push rejected, PR creation failed, tool errors.

### 7.4 `ReviewPhase` (`awaiting-review`) — stub for v1
- Returns `blocked(reason: "awaiting human review", waitFor: "pr-comment")` unconditionally.
- Real review logic lands when the human loop is implemented.

### 7.5 Registry

```ts
phaseRegistry.register("analyze",   () => new AnalyzePhase());
phaseRegistry.register("plan",      () => new PlanPhase());
phaseRegistry.register("implement", () => new ImplementPhase());
phaseRegistry.register("review",    () => new ReviewPhase());
```

Custom phases (e.g. `security-scan`) register the same way. Flows referencing unknown step names fail fast at flow load.

## 8. HTTP Server

### 8.1 Framework
Fastify. Chosen for native async, schema validation, low overhead. Nothing in the design depends on the choice — `ITriggerSource.mount` takes whichever app instance.

### 8.2 Triggers (inbound)

All trigger sources normalize their payload into `PipelineTrigger` and call `onTrigger(trigger)`. The server wires `onTrigger` to `pipeline.run(trigger)` **fire-and-forget** and returns `202 Accepted { sessionId }`.

- `GitHubWebhookTrigger` — HMAC signature verification via `x-hub-signature-256`; accepts `issues.labeled`, `pull_request.review.submitted`, `issue_comment.created`; extracts ticket key via configured regex; resolves `customerId` via `customerMapping.byGitRepo`.
- `GitLabWebhookTrigger` — same pattern with GitLab token + event types.
- `JiraWebhookTrigger` — status transitions to `Ready` (configurable).
- `ApiTrigger` — `POST /api/trigger` with bearer auth, body `{ ticketKey, flowName?, customerId? }`.

### 8.3 Management API

| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/runs/:sessionId` | Full `PipelineRun`. |
| GET  | `/api/runs?ticket=&status=&limit=` | List runs. |
| GET  | `/api/runs/:sessionId/logs?step=&tail=` | Trace lines (via `ITraceLogger.read`). |
| GET  | `/api/runs/:sessionId/stream` | SSE live updates from `EventBus`. Supports `Last-Event-ID` reconnect replay. |
| POST | `/api/runs/:sessionId/cancel` | Cooperative cancel. |
| POST | `/api/runs/:sessionId/resume` | Resume a `blocked` run. |
| GET  | `/api/flows` | Registered flows + summaries. |
| GET  | `/api/providers` | Registered providers with `meta`. |
| GET  | `/api/health` | Liveness + registry counts. |

### 8.4 Event bus

In-process pub/sub keyed by `sessionId`. `Pipeline` emits `PipelineEvent` values during the run loop. `SseStreamHandler` subscribes per-request and writes SSE frames. Same bus can later feed WebSocket/metrics/DB-write-behind without runner changes. A small per-session ring buffer (e.g. last 500 events) supports `Last-Event-ID` replay.

### 8.5 Auth
- Bearer token (env var) for `ApiTrigger` and all `/api/*` management routes.
- Webhook triggers use their provider's signature scheme.
- Per-customer keys = later.

## 9. Cancel, Resume, Recovery

### 9.1 Cancel
- `POST /api/runs/:sessionId/cancel` → `run.status = cancelling`, save, `abortController.abort()`.
- `ctx.signal` is threaded into every adapter call that accepts an `AbortSignal` (Claude SDK `query`, fetch, child processes).
- Between steps and after each adapter call, runner re-checks `ctx.signal.aborted`.
- Current phase unwinds → current step marked `cancelled`, run marked `cancelled`, `runEnded` emitted.
- Cancelling a finished run is an idempotent no-op that returns current state.

### 9.2 Resume after `blocked`
- Two triggers (both deferred to human-loop work, but the mechanism is in place):
  1. External webhook (Jira/PR comment) matches a `blocked` run → `pipeline.resume(sessionId, resumeContext)`.
  2. Manual `POST /api/runs/:sessionId/resume`.
- `pipeline.resume(sessionId)` reloads `PipelineRun`, rebuilds `PipelineContext` from stored `artifacts` and provider resolution for the stored `flowName`, and continues the step loop from the step after the blocked step (or re-runs the blocked step if its `waitFor` says so — per-phase configurable).

### 9.3 Crash recovery
- State saved after every transition → a crash mid-step leaves the last `StepRecord` as `running`.
- On boot, `Pipeline.recover()` scans `IStateStore` for runs with `status: running`; marks the dangling step `failed` with `code: "process-crash"` and the run `failed`. No auto-resume.

## 10. Observability

- `ctx.trace.log(...)` emits a `logLine` event **and** appends to the trace store.
- `FileTraceLogger` writes `logs/<sessionId>/<step>.log`. Lines are JSON: `{ ts, level, step, message, meta? }`.
- `/api/runs/:sessionId/logs` streams these; `/stream` adds them to SSE in real time.
- `tail -f logs/<sessionId>/<step>.log` works for local debugging.

## 11. Testing

| Layer | Approach |
|---|---|
| `Pipeline` runner | Unit tests with fake `IPhase`, fake `IStateStore`, fake `ProviderRegistry`. Verify transitions, retries, cancel, blocked/resume, crash recovery. |
| Each phase | Unit tests with mocked adapters. Assert adapter calls + emitted artifacts + result shape. |
| Adapter meta | Contract test per adapter: `static meta` is non-empty and matches its category. |
| Flow loading | YAML fixtures → Zod validation errors for bad flows; successful parse for good ones. |
| Triggers | Replay recorded webhook payloads; assert normalized `PipelineTrigger` + signature verification. |
| HTTP API | Integration tests against a booted server with in-memory `IStateStore` + fake runner. Assert route contracts + SSE event shape. |
| E2E smoke | `ApiTrigger` → analyze → plan → implement → completed, using fake providers registered under real ids. |

Test runner: Vitest, per-package `vitest.config.ts`.

## 12. Dependencies to add

- `fastify` + `@fastify/sensible`
- `zod` (flow schema validation)
- `js-yaml` (YAML parsing)
- `chokidar` (optional, dev hot-reload)
- `uuid`
- `vitest` (per-package dev dep)

## 13. Open questions (to resolve during planning)

- Exact shape of `ICodingCLI.analyze` / `plan` / `implement` arguments and return types (currently stubs in `ClaudeProvider`). These need to be finalized in `@journeyman/core` before phases can be implemented against them.
- Regex/extraction rules for mapping webhook payloads → `ticketKey` — lives in `pipeline.yaml` or per-trigger config?
- Per-step `timeoutMs` default — leave undefined, or pick a sensible global default?
