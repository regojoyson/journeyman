# Journeyman Pipeline — Design

**Date:** 2026-04-18
**Status:** Proposed (v1)
**Packages:** `@journeyman/pipeline` (runner), `@journeyman/pipeline-server` (HTTP)

## 1. Goal

Build two new packages that turn the existing Journeyman adapters (`coding-cli`, `git-provider`, `ticket-provider`, `notification-provider`) into a configurable, phase-based pipeline that automates ticket → PR. It is webhook-driven, per-product configurable, and exposes a management HTTP API for status/logs/streaming/cancel/resume.

This is the TypeScript equivalent of auto-pilot's Python pipeline controller, using the adapters already built in this monorepo.

## 2. Non-goals (v1)

- Human review loop auto-resume (ReviewPhase stub blocks; a `/api/runs/:id/resume` endpoint exists but auto-triggering from PR comments is deferred).
- Multi-process / horizontal scaling (runs execute in-process; single-instance deployment).
- Per-token API authorization (single shared bearer token).
- Database-backed state / flow config / artifacts (interfaces in place; default impls are filesystem-based).
- Automated tests (deferred; correctness relies on code review + manual verification for v1).
- Parallel step groups, conditional steps, exponential backoff (interfaces accommodate future work).

## 3. Architecture

Two packages:

- **`@journeyman/pipeline`** — the runner. Owns orchestration: registries, state, trace, artifacts, flow config, resolver, phases, CLI. No HTTP.
- **`@journeyman/pipeline-server`** — the HTTP layer. Fastify boot, trigger sources (GitHub/GitLab/Jira/API), management REST+SSE endpoints. Depends on `@journeyman/pipeline`.

Everything crosscutting is an interface in `@journeyman/core`. Filesystem impls default; DB/queue/S3 impls drop in later without runner changes.

## 4. Package Layout

### `packages/pipeline/src/`

```
index.ts                              public exports
cli.ts                                journeyman run | validate-config | sweep
pipeline.ts                           Pipeline class (runner)
context.ts                            buildContext()
event-bus.ts                          EventBus (pub/sub + ring buffer)
adapter-unwrap.ts                     unwrap() / unwrapField() / AdapterError
registry/
  phase-registry.ts
  provider-registry.ts                per-product config via resolveForProduct()
state/
  file-state-store.ts
  file-trace-logger.ts
  file-artifact-store.ts
config/
  flow-schema.ts                      Zod for flow YAML
  pipeline-schema.ts                  Zod for pipeline.yaml
  yaml-flow-config-source.ts
  pipeline-config-loader.ts
  flow-resolver.ts
  flow-validator.ts                   reads/writes graph walk
phases/
  base-phase.ts                       reads/writes contracts + ok/blocked/failed/require helpers
  get-ticket-phase.ts
  clone-repos-phase.ts
  analyze-phase.ts                    persists reportPath via artifactStore
  plan-phase.ts                       same
  implement-phase.ts                  same
  commit-push-phase.ts
  create-pr-phase.ts                  listPRs() idempotency preflight
  cleanup-repos-phase.ts
  add-comment-phase.ts
  update-status-phase.ts              semantic → literal via productConfig.ticketWorkflow.statuses
  review-phase.ts                     stub: blocks on pr-comment
  require-field-phase.ts              reusable gate
lib/
  format-ticket-md.ts
  best-effort.ts
  any-signal.ts                       AbortSignal composition
```

### `packages/pipeline-server/src/`

```
index.ts                              public exports
http-server.ts                        buildServer()
shutdown.ts                           SIGTERM/SIGINT graceful shutdown
auth.ts                               bearer-token guard (management routes)
dispatch.ts                           trigger → flow resolution → pipeline.run
dedup.ts                              in-process ticket mutex + findActiveForTicket
concurrency.ts                        per-product semaphore
triggers/
  api-trigger.ts
  github-webhook-trigger.ts
  gitlab-webhook-trigger.ts
  jira-webhook-trigger.ts
api/
  health.ts                           GET  /api/health
  runs.ts                             GET  /api/runs, /api/runs/:id
  logs.ts                             GET  /api/runs/:id/logs
  stream.ts                           GET  /api/runs/:id/stream (SSE)
  cancel.ts                           POST /api/runs/:id/cancel
  resume.ts                           POST /api/runs/:id/resume
  artifacts.ts                        GET  /api/runs/:id/artifacts/:key
  flows.ts                            GET  /api/flows
  providers.ts                        GET  /api/providers
```

### Modifications to `@journeyman/core`

- Add `src/interfaces/pipeline.interface.ts` (all pipeline interfaces).
- Add `src/types/pipeline.types.ts` (all pipeline data shapes).
- Add `signal?: AbortSignal` to `AnalyzeOptions`, `PlanOptions`, `ImplementOptions`, `CloneReposOptions`, `CommitPushReposOptions`, `CleanupReposOptions`.
- Add `listPRs` to `IGitProvider`.

### Modifications to existing adapter packages

- Every provider class exposes `static meta: IProviderMeta`.
- `GitHubIssuesProvider.updateStatus` rewritten to label-based workflow (previously only open/closed).
- `GitHubProvider` implements `listPRs`.

## 5. Core Types

```ts
// @journeyman/core/src/types/pipeline.types.ts

export type IProviderMeta = {
  id: string;
  name: string;
  description: string;
  category: "coding-cli" | "git" | "ticket" | "notification";
};

export type PhaseResult =
  | { status: "ok"; artifacts: Record<string, unknown> }
  | { status: "blocked"; reason: string; waitFor?: "ticket-comment" | "pr-comment" | "manual" }
  | { status: "failed"; error: { message: string; code?: string; stack?: string } };

export type StepRecord = {
  id: string;                          // unique within flow (e.g. "mark-in-progress")
  phase: string;                       // registry key (e.g. "updateStatus")
  attempt: number;
  status: "pending" | "running" | "ok" | "blocked" | "failed" | "cancelled";
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: { message: string; code?: string; stack?: string };
  blockedReason?: string;
  waitFor?: "ticket-comment" | "pr-comment" | "manual";
};

export type ArtifactHandle = {
  kind: "artifact";
  sessionId: string;
  key: string;
  size: number;
  contentType?: string;
  uri: string;                          // "file://..." | "s3://..."
  sha256?: string;
};

export type PipelineRun = {
  sessionId: string;
  productId: string;
  ticketKey: string;                    // canonical id (e.g. "edgereg-org/edgereg-api#42")
  ticketShortKey: string;               // short id for display ("42")
  flowName: string;
  flowSnapshot: FlowDefinition;         // frozen copy; resume/recovery uses this
  status: "queued" | "running" | "blocked" | "completed" | "failed" | "cancelling" | "cancelled";
  currentStep: string | null;           // step id
  steps: StepRecord[];
  artifacts: Record<string, unknown>;   // may contain ArtifactHandle values
  createdAt: string;
  updatedAt: string;
};

export type FlowStepDefinition = {
  id: string;                           // unique within flow (defaults to phase if omitted)
  phase: string;                        // registry key
  config?: Record<string, unknown>;
  retry?: { attempts: number; backoffMs: number };
  timeoutMs?: number;
  onFailure?: "fail" | "skip" | "retry" | "block";  // default "fail"
};

export type FlowDefinition = {
  name: string;
  providers: { ticket: string; git: string; coding: string; notification: string };
  steps: FlowStepDefinition[];
};

export type ProductRepo = {
  providerId: "github" | "gitlab";
  owner: string;
  repo: string;
  url: string;
  defaultBranch: string;
};

export type TicketWorkflow = {
  trigger?: {
    matchLabels?: string[];
    matchStatus?: string[];
  };
  statuses: Record<string, string>;     // semantic name → literal value (e.g. "done" → "Done")
};

export type ProductConfig = {
  flow: string;
  workspace: string;
  repos: ProductRepo[];
  providerConfig?: {
    ticket?: Record<string, unknown>;
    git?: Record<string, unknown>;
    coding?: Record<string, unknown>;
    notification?: Record<string, unknown>;
  };
  ticketWorkflow?: TicketWorkflow;
  webhookSecrets?: Record<string, string>;  // env var name per webhook source
  concurrency?: number;                     // default: unlimited
};

export type PipelineConfig = {
  defaultFlow: string;
  products: Record<string, ProductConfig>;
  server: {
    port: number;
    bearerTokenEnv: string;
    webhooks: {
      github?: { secretEnv: string; path?: string };
      gitlab?: { secretEnv: string; path?: string };
      jira?:   { secretEnv: string; path?: string };
    };
  };
  workspaces?: {
    cleanupOn?: Array<PipelineRun["status"]>;
    retentionDays?: number;
    keepFailed?: boolean;
  };
};

export type PipelineTrigger = {
  sourceId: string;
  productId: string;                    // resolved by trigger source from URL path
  ticketKey: string;
  ticketShortKey: string;
  flowName?: string;
  rawPayload: unknown;
  receivedAt: string;
};

export type PipelineEvent =
  | { type: "runStarted";  sessionId: string; ticketKey: string; flowName: string; at: string }
  | { type: "stepStarted"; sessionId: string; stepId: string; phase: string; attempt: number; at: string }
  | { type: "stepEnded";   sessionId: string; stepId: string; phase: string; attempt: number; status: StepRecord["status"]; durationMs: number; at: string }
  | { type: "logLine";     sessionId: string; stepId: string; level: "info"|"warn"|"error"; line: string; at: string }
  | { type: "statusChanged"; sessionId: string; from: PipelineRun["status"]; to: PipelineRun["status"]; at: string }
  | { type: "runEnded";    sessionId: string; status: PipelineRun["status"]; at: string };

export type TraceLine = {
  ts: string;
  level: "info" | "warn" | "error";
  stepId: string;
  message: string;
  meta?: Record<string, unknown>;
};
```

## 6. Interfaces

```ts
// @journeyman/core/src/interfaces/pipeline.interface.ts

export interface PipelineContext {
  sessionId: string;
  productId: string;
  ticketKey: string;
  ticketShortKey: string;
  flowName: string;
  workspaceDir: string;                 // per-run: workspaces/<productId>/runs/<sessionId>
  signal: AbortSignal;
  productConfig: ProductConfig;
  providers: {
    ticket: ITicketProvider;
    git: IGitProvider;
    coding: ICodingCLI;
    notification: INotificationProvider;
  };
  artifacts: Record<string, unknown>;
  state: Readonly<PipelineRun>;
  trace: ITraceLogger;
  artifactStore: IArtifactStore;
  emit: (event: PipelineEvent) => void;
}

export interface IPhase {
  readonly name: string;                // registry key
  run(ctx: PipelineContext, stepConfig: unknown): Promise<PhaseResult>;
}

export interface IStateStore {
  load(sessionId: string): Promise<PipelineRun | null>;
  save(run: PipelineRun): Promise<void>;
  findByTicket(productId: string, ticketKey: string): Promise<PipelineRun[]>;
  findActiveForTicket(productId: string, ticketKey: string): Promise<PipelineRun | null>;
  find(query: { productId?: string; status?: PipelineRun["status"]; limit?: number }): Promise<PipelineRun[]>;
}

export interface ITraceLogger {
  log(sessionId: string, stepId: string, line: string, level?: TraceLine["level"], meta?: Record<string, unknown>): Promise<void>;
  read(sessionId: string, opts?: { stepId?: string; tail?: number }): AsyncIterable<TraceLine>;
}

export interface IArtifactStore {
  put(sessionId: string, key: string, data: Buffer | string, opts?: { contentType?: string; ext?: string }): Promise<ArtifactHandle>;
  putPath(sessionId: string, key: string, srcPath: string, opts?: { contentType?: string }): Promise<ArtifactHandle>;
  get(handle: ArtifactHandle): Promise<Buffer>;
  pathFor(handle: ArtifactHandle): string;
}

export interface IFlowConfigSource {
  getFlow(name: string): Promise<FlowDefinition>;
  listFlows(): Promise<string[]>;
}

export interface IFlowResolver {
  resolve(trigger: PipelineTrigger): Promise<{ flowName: string; productId: string }>;
}

export interface ITriggerSource {
  readonly id: string;
  mount(app: FastifyInstance, ctx: TriggerMountContext): void;
}

export type TriggerMountContext = {
  products: Record<string, ProductConfig>;
  webhookConfig: PipelineConfig["server"]["webhooks"];
  onTrigger: (trigger: PipelineTrigger) => void;
};

export interface IGitProviderListPRs {
  listPRs(opts: { owner: string; repo: string; head?: string; state?: "open" | "closed" | "all"; sessionId?: string }): Promise<{ prs: { id: string; url: string; number: number; head: string; state: string }[]; error?: string }>;
}

// IGitProvider gains: listPRs
```

## 7. Configuration

### 7.1 Directory layout

```
config/
├── pipeline.yaml                     # global
└── flows/
    ├── edgereg-default.yaml
    └── cidms-secure.yaml
```

### 7.2 `pipeline.yaml`

```yaml
defaultFlow: edgereg-default

products:
  edgereg:
    flow: edgereg-default
    workspace: ./workspaces/edgereg
    concurrency: 2
    repos:
      - providerId: github
        owner: edgereg-org
        repo: edgereg-api
        url: "git@github.com:edgereg-org/edgereg-api.git"
        defaultBranch: main
    providerConfig:
      git:          { tokenEnv: EDGEREG_GITHUB_TOKEN }
      ticket:       { tokenEnv: EDGEREG_GITHUB_TOKEN }
      coding:       { model: "claude-opus-4-7" }
      notification: { channel: "#edgereg-auto-pilot", botTokenEnv: EDGEREG_SLACK_TOKEN }
    ticketWorkflow:
      trigger:
        matchLabels: ["ready-for-dev"]
      statuses:
        development-started: "in-development"
        code-review:          "code-review"
        done:                 "done"
        blocked:              "blocked"
        failed:               "failed"
    webhookSecrets:
      github: EDGEREG_GH_WEBHOOK_SECRET   # optional per-product override

server:
  port: 3000
  bearerTokenEnv: JOURNEYMAN_API_TOKEN
  webhooks:
    github: { secretEnv: GITHUB_WEBHOOK_SECRET }
    gitlab: { secretEnv: GITLAB_WEBHOOK_SECRET }
    jira:   { secretEnv: JIRA_WEBHOOK_SECRET }

workspaces:
  cleanupOn: ["completed", "cancelled"]
  retentionDays: 14
  keepFailed: true
```

### 7.3 `flows/<name>.yaml`

```yaml
name: edgereg-default

providers:
  ticket:       github-issues
  git:          github
  coding:       claude
  notification: slack

steps:
  - { id: fetch-ticket,     phase: getTicket }
  - { id: clone,            phase: cloneRepos }
  - { id: analyze,          phase: analyze,         timeoutMs: 900000 }
  - { id: comment-analysis, phase: addComment,      config: { template: analysis-summary }, onFailure: skip }
  - { id: mark-in-progress, phase: updateStatus,    config: { status: development-started } }
  - { id: plan,             phase: plan,            timeoutMs: 900000 }
  - { id: implement,        phase: implement,       timeoutMs: 1800000 }
  - { id: commit-push,      phase: commitPushRepos, config: { pattern: "#{ticket} : {summary}", prSummaryStyle: detailed } }
  - { id: open-pr,          phase: createPR }
  - { id: mark-in-review,   phase: updateStatus,    config: { status: code-review }, onFailure: skip }
  - { id: cleanup,          phase: cleanupRepos,    onFailure: skip }
```

## 8. Flow Resolution

Order, highest priority first:

1. Explicit `flowName` on `PipelineTrigger` (from API body or webhook path override — none in v1).
2. `products[productId].flow`.
3. `defaultFlow`.

`productId` is always present on triggers — the URL path (`/webhooks/github/:productId`) or API body carries it.

## 9. Runner Semantics

### 9.1 `Pipeline.run({ trigger, flow })`

1. Generate `sessionId` (uuid v4).
2. Acquire per-product semaphore (blocks if at concurrency limit; queued runs saved with `status: "queued"`).
3. Dedup check: `state.findActiveForTicket(productId, ticketKey)`. If active run exists (`running | blocked | queued`), return its sessionId (no new run).
4. Create per-run workspace: `workspaces/<productId>/runs/<sessionId>/`.
5. Initialize `PipelineRun` with `flowSnapshot: flow` and `status: "running"`. Save.
6. Resolve providers via `ProviderRegistry.resolveForProduct(flow, productConfig.providerConfig)`.
7. Build `PipelineContext` including `workspaceDir`, `productConfig`, `signal` (from per-run `AbortController`).
8. For each step in `flow.steps`:
   - Check `signal.aborted` → mark `cancelled`, save, emit `runEnded`, return.
   - Resolve phase from `PhaseRegistry` by `step.phase`.
   - Per-step timeout: `anySignal([ctx.signal, AbortSignal.timeout(step.timeoutMs)])` (if set).
   - Attempt loop (1..`retry.attempts + 1`):
     - Append `StepRecord { id: step.id, phase: step.phase, status: "running", attempt, startedAt }`. Save. Emit `stepStarted`.
     - Call `phase.run(ctx, step.config)` inside try/catch.
     - Convert thrown exceptions to `PhaseResult.failed`.
     - Update `StepRecord` with outcome. Save. Emit `stepEnded`.
     - On `ok`: merge `artifacts` into `ctx.artifacts`. Break loop.
     - On `blocked`: break both loops; handled at step level.
     - On `failed`: if attempts remain, sleep `backoffMs`; else apply `onFailure`:
       - `fail` (default): abort run as `failed`.
       - `skip`: log warn, continue to next step.
       - `retry`: same as attempts exhausted-fail if already in retry loop.
       - `block`: abort run as `blocked` with reason.
9. All steps `ok` (or all `skip`-failed) → `status: "completed"`. Save. Emit `statusChanged`, `runEnded`.
10. On `completed` or `cancelled` (per `workspaces.cleanupOn`): delete `workspaces/<productId>/runs/<sessionId>/`. Preserves state, logs, artifacts dirs.
11. Release semaphore.

### 9.2 Cancel

- `POST /api/runs/:id/cancel` → `pipeline.cancel(sessionId)`.
- Sets `run.status = "cancelling"`. Calls `abortController.abort()` on the run's context.
- `signal` propagates through `ctx.signal` to every adapter call that accepts it.
- Runner re-checks `signal.aborted` between steps and after each adapter call.
- Current phase unwinds → current step marked `cancelled`, run marked `cancelled`, `runEnded` emitted.
- Idempotent (cancelling finished run is a no-op).

### 9.3 Resume

- `POST /api/runs/:id/resume` → `pipeline.resume(sessionId)`.
- Requires `status === "blocked"`; rejects otherwise.
- Reads `run.flowSnapshot` (NOT current `flows/` config); rebuilds context; continues from step after blocked one.

### 9.4 Crash recovery

- On server boot, `Pipeline.recover()` scans for runs with `status ∈ ["running", "cancelling"]`.
- Marks dangling step `failed` with `code: "process-crash"`, run `failed`.
- No auto-resume.

### 9.5 Graceful shutdown

- `SIGTERM` / `SIGINT` handler:
  - Fastify stops accepting new connections.
  - All in-flight run `sessionId`s are cancelled.
  - Wait up to 30s for cancellations to complete.
  - `process.exit(0)`.
- Runs that were cancelled this way show `status: "cancelled"` in state — not "failed" via crash-recovery.

## 10. Phases (Built-in Catalog)

Each phase declares `reads` / `writes` as static arrays. Boot validator walks each flow's step sequence confirming every phase's reads are available.

| Phase | reads | writes | notes |
|---|---|---|---|
| `getTicket` | — | `ticket`, `ticketMd` | Uses `ctx.ticketKey`. Blocks if ticket absent. |
| `cloneRepos` | — | `repoPaths`, `primaryRepoPath`, `repoRefs` | Driven by `productConfig.repos` only. |
| `analyze` | `primaryRepoPath`, `ticketMd` | `analysis` (with `reportHandle`) | Persists report via `artifactStore.putPath`. |
| `plan` | `analysis`, `ticketMd`, `primaryRepoPath` | `plan` (with `reportHandle`) | Same. |
| `implement` | `plan`, `primaryRepoPath`, `ticketMd` | `implementation` (with `reportHandle`) | Same. Branch not set here. |
| `commitPushRepos` | `primaryRepoPath` | `commit` | `CommitPushResult` stored intact under `commit`. Branch known here. |
| `createPR` | `commit`, `ctx.productConfig.repos` | `pr` | `listPRs` preflight: if PR already exists for branch, reuse it. |
| `cleanupRepos` | `repoPaths` | — | Soft-fail. |
| `addComment` | `ctx.ticketKey` + inputs per template | `commentIds.<stepId>` | Template-driven body. |
| `updateStatus` | `ctx.ticketKey`, `productConfig.ticketWorkflow.statuses` | `statusHistory` (append) | Semantic `status` → literal via product's map. Boot validator catches missing keys. |
| `review` | — | — | Unconditionally `blocked("awaiting human review", "pr-comment")`. |
| `requireField` | reads configured `artifact.field` | — | Generic gate. If missing/empty → `blocked`. |

Every phase uses `BasePhase`'s helpers:
- `this.require<T>(ctx, key)` — throws if artifact absent.
- `this.optional<T>(ctx, key)` — returns undefined if absent.
- `unwrap(result, "opName")` / `unwrapField(result, "field", "opName")` — converts `{...,error?}` envelopes.

File-producing phases call `ctx.artifactStore.putPath(sessionId, key, srcPath)` and store `reportHandle` alongside the structured result.

## 11. Artifact Management

`ctx.artifacts` grows step-by-step. Rules:

- **One-object-per-phase convention**: each phase writes a single top-level key named after what it produced (`analysis`, `plan`, `implementation`, `commit`, `pr`, `ticket`).
- Special cases:
  - `addComment`: writes `commentIds.<stepId>` (merged into a shared `commentIds` map).
  - `updateStatus`: writes `statusHistory` (appended).
- File outputs live under `workspaces/<productId>/artifacts/<sessionId>/<key>.<ext>` (via `FileArtifactStore.putPath`). Surviving `cleanup` phase.
- State file stores small metadata + `ArtifactHandle`s; blob content is always reachable via `GET /api/runs/:id/artifacts/:key`.

## 12. Ticket Workflow (Config-Driven)

`productConfig.ticketWorkflow`:

- `trigger` — gating: `matchLabels` (GitHub) or `matchStatus` (Jira/Linear). Trigger source inspects webhook payload; non-matching payloads return 200 `{ ignored: "label-mismatch" }` with no pipeline run.
- `statuses` — map from semantic name to literal value. Flow YAML references semantic names; `UpdateStatusPhase` resolves at runtime.

Boot validator cross-checks every `updateStatus` step's semantic name against the product's status map. Typo = server refuses to boot.

## 13. HTTP Server

### 13.1 Boot sequence

1. Load `pipeline.yaml` + `flows/*.yaml`.
2. Register providers in `ProviderRegistry` (auto-discover static `meta`).
3. Register built-in phases in `PhaseRegistry`.
4. `Pipeline.recover()`.
5. Run `FlowValidator` across every flow: phase presence, provider presence, reads/writes graph, status names.
6. Build Fastify app, register bearer auth hook.
7. Mount each enabled `ITriggerSource`.
8. Register all `/api/*` routes.
9. Install shutdown handler.
10. Listen.

### 13.2 Trigger dispatch

Shared callback receives a normalized `PipelineTrigger`:

```
onTrigger = async (trigger) => {
  const { flowName, productId } = await resolver.resolve(trigger);
  const flow = await flows.getFlow(flowName);
  await dispatch({ trigger, flow });    // dedup + semaphore + pipeline.run inside
};
```

Dispatcher:
- Per-ticket mutex: if already dispatching for this `productId + ticketKey`, return existing sessionId.
- Dedup: `state.findActiveForTicket`; if active run exists, return its sessionId.
- Acquire per-product semaphore; on block, save `status: "queued"` record and return sessionId.
- Call `pipeline.run({ trigger, flow })`. Do not await — returns `202 { sessionId }` immediately.

### 13.3 Auth

- `Authorization: Bearer <token>` required for all `/api/*` routes EXCEPT `/api/health`.
- Webhook paths use per-source signature scheme (HMAC, token).
- Per-product webhook secret override via `products.<id>.webhookSecrets`.

## 14. Triggers

### 14.1 `ApiTrigger` — `POST /api/trigger/:productId?`

Body (Zod):
```ts
{ ticketKey: string, ticketShortKey?: string, flowName?: string }
```

- `productId` from URL; if absent, `defaultFlow`'s implied product (unscoped manual trigger).
- Normalized to `PipelineTrigger`; returns `202 { sessionId }`.

### 14.2 `GitHubWebhookTrigger` — `POST /webhooks/github/:productId`

- HMAC verify via `X-Hub-Signature-256` with product's secret (fallback to server's).
- Extract `ticketKey` from event: issue/PR title/number → `"owner/repo#number"`.
- `ticketShortKey` = `"number"`.
- Evaluate `productConfig.ticketWorkflow.trigger.matchLabels` against `payload.issue.labels[]`.
- Redact payload (`sender.email`, installation token, signature echo).

### 14.3 `GitLabWebhookTrigger` — `POST /webhooks/gitlab/:productId`

- `X-Gitlab-Token` constant-time equality with product's secret.
- Extract ticket from `object_attributes.title` or `merge_request.title`.

### 14.4 `JiraWebhookTrigger` — `POST /webhooks/jira/:productId`

- Bearer token equality with product's secret.
- Extract `ticketKey` from `issue.key`; `ticketShortKey` same value.
- Evaluate `matchStatus` against `changelog.items[].toString` for `status` field.

## 15. Management API

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/health` | — | `{ status, registries: {...} }` |
| POST | `/api/trigger/:productId?` | `{ ticketKey, ticketShortKey?, flowName? }` | `202 { sessionId }` |
| GET | `/api/runs/:sessionId` | — | full `PipelineRun` |
| GET | `/api/runs?product=&ticket=&status=&limit=` | — | `{ runs: PipelineRun[] }` |
| GET | `/api/runs/:sessionId/logs?stepId=&tail=` | — | `{ lines: TraceLine[] }` |
| GET | `/api/runs/:sessionId/stream` | — | SSE |
| POST | `/api/runs/:sessionId/cancel` | — | current `PipelineRun` |
| POST | `/api/runs/:sessionId/resume` | — | current `PipelineRun` |
| GET | `/api/runs/:sessionId/artifacts/:key` | — | raw bytes of the artifact handle |
| GET | `/api/flows` | — | `[{ name, providers, steps: string[] }]` |
| GET | `/api/providers` | — | `{ "coding-cli": IProviderMeta[], ... }` |

SSE `stream`: replays per-session ring buffer on connect, then live events. `Last-Event-ID` reconnect supported.

## 16. Observability

- **State:** `workspaces/<productId>/state/<sessionId>.json`, atomic writes.
- **Trace:** `workspaces/<productId>/logs/<sessionId>/<stepId>.log`, JSON-per-line.
- **Artifacts:** `workspaces/<productId>/artifacts/<sessionId>/<key>.<ext>`.
- **Live:** `EventBus` in-process pub/sub with per-session ring buffer (500 events).
- **Metrics (future):** Prometheus endpoint not in v1.

## 17. Security

- Bearer token env var for management API.
- HMAC/token verification per webhook source.
- Per-product webhook secret overrides.
- Each `ITriggerSource` provides `redactPayload()` to strip secrets from stored `rawPayload`.
- Filesystem permissions: `chmod 700 workspaces/`; document in `docs/pipeline/security.md`.
- For high-sensitivity deployments: swap `FileArtifactStore` for encrypted S3; swap `FileStateStore` for Postgres.

## 18. Per-Product Isolation

- `workspaces/<productId>/{state,logs,artifacts,runs}/` — one dir per product.
- Per-product `ProviderConfig` — independent tokens, channels, models.
- Per-product concurrency semaphore.
- Per-product webhook path segments + optional per-product webhook secrets.
- `rm -rf workspaces/<productId>/` wipes everything for that product.

## 19. Limitations (v1)

- **Single-instance deployment.** Dedup + concurrency are in-process. Multi-replica deployments will duplicate runs and bypass concurrency limits. Swap `FileStateStore` for `PostgresStateStore` + add a distributed queue for HA.
- **No automated tests.** Correctness of runner (retry, cancel, block, resume, crash recovery) relies on code review + manual verification.
- **ReviewPhase is a stub.** Runs end in `blocked` after opening the PR. Human review is outside the pipeline for v1.
- **Auto-resume from PR comments is deferred.** Endpoint exists (`POST /api/runs/:id/resume`) and is callable by hand; webhook-driven resume is later work.
- **Jira/Linear/Monday `addComment` + `updateStatus` are still stubs in their providers.** Only GitHub Issues works end-to-end. Other ticket-provider implementations are prerequisites for those products.

## 20. Future Work

Interfaces accommodate the following without structural changes:

- Parallel step groups (`parallel: [a, b, c]`).
- Conditional steps (`when: "..."` expression).
- Exponential backoff (change `retry` shape to `{ attempts, backoffMs, backoffFactor }`).
- DB-backed state + queue-backed dispatcher for horizontal scaling.
- S3 artifact store with server-side encryption.
- Prometheus `/metrics`.
- OpenTelemetry distributed tracing.
- Per-token API authorization + rate limits.
- Multi-environment config overlays.

## 21. Dependencies

Added to `@journeyman/pipeline`:
- `@journeyman/core` (workspace)
- `@journeyman/coding-cli`, `@journeyman/git-provider`, `@journeyman/ticket-provider`, `@journeyman/notification-provider` (workspace)
- `js-yaml`, `zod`, `uuid`

Added to `@journeyman/pipeline-server`:
- `@journeyman/pipeline` (workspace)
- `fastify`, `@fastify/sensible`

## 22. Prerequisite Adapter Changes

These are *not* pipeline work but must land before the 11-step flow runs end-to-end:

1. `GitHubIssuesProvider.updateStatus` → label-based workflow (`status:*` labels).
2. `IGitProvider.listPRs` + `GitHubProvider` implementation.
3. `static meta: IProviderMeta` on every provider class.
4. `signal?: AbortSignal` added to: `AnalyzeOptions`, `PlanOptions`, `ImplementOptions`, `CloneReposOptions`, `CommitPushReposOptions`, `CleanupReposOptions`; wired through each adapter (esp. Claude SDK's `abortSignal`).

These are in-scope for the plan as Phase 0 parallel tasks.

## 23. Decisions Index

All 33 decisions finalized through design review:

1. Two packages (`pipeline` + `pipeline-server`).
2. `customer → product` throughout.
3. Path-routed webhooks `/webhooks/<source>/:productId`.
4. Per-product workspaces with `state/`, `logs/`, `runs/`, `artifacts/`.
5. Declarative phase contracts (`reads` / `writes` static arrays).
6. Boot-time flow validator (graph walk).
7. `IArtifactStore` — handle-based persistence; file default.
8. Step id (unique) vs phase name (registry key).
9. `onFailure: fail | skip | retry | block` per step.
10. One-object-per-phase artifact convention.
11. `unwrap()` / `unwrapField()` / `AdapterError` envelope pattern.
12. Chronological artifact contract (branch appears after commit-push).
13. `ProductRepo[]` structured in config; no URL parsing.
14. `ticketWorkflow` per product: `trigger` gating + `statuses` semantic map.
15. Label-based `updateStatus` for GitHub Issues.
16. `ArtifactStore.putPath` copies reports out of ephemeral clone pre-cleanup.
17. `ticketKey` (canonical) + `ticketShortKey` (display) on trigger/run/context.
18. Semaphore per product for concurrency.
19. In-process dedup via `findActiveForTicket`.
20. Redaction hook per trigger source.
21. `Pipeline.resume(sessionId)` + `POST /api/runs/:id/resume`.
22. Crash recovery marks dangling runs failed.
23. Per-product webhook secret overrides.
24. `formatTicketMd` helper for optional description.
25. `bestEffort` helper for soft-fail side effects.
26. Workspace retention sweeper + `cleanupOn` config.
27. `signal` threaded through all cancellable adapter calls.
28. Per-product `providerConfig` passed to provider constructors.
29. `flowSnapshot` on `PipelineRun` for version pinning.
30. `listPRs` preflight in `CreatePRPhase` for idempotency.
31. Single-instance v1 assumption documented.
32. `SIGTERM` graceful shutdown with 30s cancel grace.
33. `chmod 700 workspaces/` + security docs.
