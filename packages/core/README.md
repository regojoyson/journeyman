# @journeyman/core

Shared interfaces and types for all Journeyman packages. This is the single source of truth for provider contracts, pipeline types, and shared option/result shapes.

No logic lives here — only TypeScript interfaces and types. Every other `@journeyman/*` package imports from here; it never imports from them.

## Exports

### Provider interfaces

| Interface | Description |
|---|---|
| `ICodingCLI` | AI coding CLI operations (clone, analyze, plan, implement, commit/push, cleanup) |
| `IGitProvider` | Git hosting API operations (get repo, create PR, list PRs) |
| `ITicketProvider` | Issue tracker operations (get, create, update, list tickets; add comments; update status) |
| `INotificationProvider` | Notification delivery (send messages to channels) |

### Pipeline interfaces

| Interface | Description |
|---|---|
| `IPhase` | Phase contract — `run(ctx, config)` + static `reads`/`writes` arrays |
| `IStateStore` | Run state persistence |
| `ITraceLogger` | Per-step trace log writer |
| `IArtifactStore` | Artifact read/write |
| `IFlowConfigSource` | Flow YAML loader |
| `IFlowResolver` | Flow selection by product/trigger |
| `ITriggerSource` | Webhook/API trigger handler |
| `PipelineContext` | Runtime context passed to every phase |

### Type modules

| Module | Description |
|---|---|
| `git.types` | `RepoConfig`, `CloneResult`, `PRResult`, `PROptions`, etc. |
| `coding.types` | `AnalyzeOptions`, `PlanOptions`, `ImplementOptions`, `CommitPushResult`, etc. |
| `ticket.types` | `Ticket`, `TicketStatus`, `CreateTicketOptions`, `TicketSchema`, etc. |
| `notification.types` | `NotifyOptions`, `NotifyResult` |
| `session.types` | `SessionId`, `RunStatus`, `RunRecord`, `StepRecord`, etc. |
| `pipeline.types` | `FlowDefinition`, `FlowStepDefinition`, `PipelineConfig`, `ProductConfig`, etc. |

### Utilities

| Export | Description |
|---|---|
| `createLogger` | Pino logger factory used across all packages |
| `Logger` | Logger type alias |

## Design rule

> `@journeyman/core` never imports from other `@journeyman/*` packages. Every other package may import from `core`. This keeps the dependency graph acyclic and the type contracts stable.
