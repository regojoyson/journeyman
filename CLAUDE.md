# Journeyman — Claude Code Project Guide

## Project Overview

**Journeyman** is a configurable, step-based AI pipeline that automates ticket → code → PR workflows. It's an npm workspaces monorepo built around a provider-pattern: AI coding CLIs (Claude, Gemini, Codex), git hosts (GitHub, GitLab), ticket trackers (Jira, Linear, Monday, GitHub Issues/Projects), and notification channels (Slack) are all swappable behind interfaces defined in `@journeyman/core`.

A visual canvas editor (n8n-style) lets users drag-and-drop step nodes, wire conditional branches, and configure retry/MCP/skills per node. Durable execution is backed by Conductor, with step retries and human-in-the-loop pause/resume.

## Architecture Layers

| Layer | Role |
|---|---|
| **Web UI** | Visual canvas editor, live run monitoring, runs history |
| **API Gateway** | Fastify REST + SSE; auth, validation, routing |
| **Orchestrator** | Conductor adapter, worker harness, durable execution |
| **Steps & Providers** | Per-node execution logic — AI coding, git, tickets, notifications |
| **Storage** | PostgreSQL (persistence) + Redis (job queue) |

## Monorepo Structure

```
journeyman/                  ← repo root
├── CLAUDE.md
├── README.md
├── package.json             ← workspaces: ["packages/*"]
├── docs/                    ← architecture diagrams, quickstart, setup
│   └── constitution/        ← developer guidelines (ARCHITECTURE, DATABASE_ARCHITECTURE, CONSTITUTION, SECURITY, …)
├── examples/
├── infra/                   ← docker-compose (Postgres, Redis, Conductor)
├── scripts/                 ← check-import-boundaries.mjs, etc.
├── .claude/
│   ├── sdk.d.ts             ← @anthropic-ai/claude-agent-sdk type declarations
│   └── memory/
└── packages/
    ├── core/                ← interfaces + shared types (source of truth)
    │
    ├── web/                 ← React web shell
    ├── flow-editor/         ← visual canvas editor (drag-drop, properties panel)
    ├── run-viewer/          ← read-only execution canvas with live status
    ├── runs-list/           ← sortable/filterable run history table
    ├── theme/               ← shared UI theme
    │
    ├── api-server/          ← Fastify HTTP gateway (REST + SSE)
    ├── orchestrator/        ← Conductor adapter + worker harness
    ├── identity/            ← JWT auth, bcrypt, user/org/role management
    ├── secrets/             ← user/org secret vault (AES encryption)
    ├── migrations/          ← SQL migrations (journeyman-migrate CLI)
    │
    ├── steps/              ← built-in step catalog
    ├── custom-steps/       ← user-defined AI steps with prompt templates
    │
    ├── coding-cli/          ← Claude/Gemini/Codex providers (analyze, plan, implement, git)
    ├── coding-models/       ← AI model provider configuration
    ├── git-provider/        ← GitHub/GitLab REST API providers
    ├── github-api/          ← shared Octokit client (REST + GraphQL)
    ├── ticket-provider/     ← Jira/Linear/Monday/GitHub Issues/Projects
    ├── notification-provider/ ← Slack
    │
    ├── mcp/                 ← MCP instance registry + Claude SDK adapter
    └── skills/              ← Skill package management + Claude SDK adapter
```

## Package Responsibilities

### Shared

| Package | Scope |
|---|---|
| `@journeyman/core` | Interfaces (`ICodingCLI`, `IGitProvider`, `ITicketProvider`, `INotificationProvider`) and all shared option/result types. Never imports from other `@journeyman/*` packages. |

### UI

| Package | Scope |
|---|---|
| `@journeyman/web` | React shell — flows list, flow editor page, run detail page. |
| `@journeyman/flow-editor` | Canvas editor component: drag-drop nodes, properties panel, MCP/skills config. |
| `@journeyman/run-viewer` | Read-only execution canvas with live per-node status. |
| `@journeyman/runs-list` | Sortable/filterable run history table. |
| `@journeyman/theme` | Shared UI theme primitives. |

### Backend

| Package | Scope |
|---|---|
| `@journeyman/api-server` | Fastify HTTP gateway with REST and SSE endpoints. |
| `@journeyman/orchestrator` | Conductor adapter, worker harness, pluggable flow + run stores. |
| `@journeyman/identity` | JWT auth, bcrypt passwords, user/org/role management. |
| `@journeyman/secrets` | User- and org-scoped secret vault with AES encryption. |
| `@journeyman/migrations` | SQL migrations (`journeyman-migrate` CLI). |

### Steps

| Package | Scope |
|---|---|
| `@journeyman/steps` | Built-in step catalog (getTicket, analyze, plan, implement, createPR, …). |
| `@journeyman/custom-steps` | User-defined AI step registration with prompt templates. |

### Providers

| Package | Scope |
|---|---|
| `@journeyman/coding-cli` | AI coding ops via Claude Agent SDK (analyze, plan, implement) + local git ops (clone, scan, reset). Providers: `ClaudeProvider`, `GeminiProvider`, `CodexProvider`. |
| `@journeyman/coding-models` | AI model provider configuration (Claude, Gemini, Codex). |
| `@journeyman/git-provider` | Remote REST ops (create PR/MR, list repos). Providers: `GitHubProvider`, `GitLabProvider`. |
| `@journeyman/github-api` | Shared Octokit client (`@octokit/rest` + `@octokit/graphql` with retry/throttling). `createGitHubClient({ token })` → `{ rest, graphql }`. |
| `@journeyman/ticket-provider` | Issue tracker CRUD. Providers: `JiraProvider`, `LinearProvider`, `MondayProvider`, `GitHubIssuesProvider`, `GitHubProjectsProvider`. |
| `@journeyman/notification-provider` | Notification delivery. Providers: `SlackProvider`. |

### Integrations

| Package | Scope |
|---|---|
| `@journeyman/mcp` | DB-backed MCP instance registry (user/org scope), CRUD + visible-list + static catalog routes, resolver producing `ResolvedMcpInstance[]`, and pure subpath `@journeyman/mcp/sdk-adapter` consumed by `coding-cli`. |
| `@journeyman/skills` | Skill package management and Claude Agent SDK adapter. |

## Key Design Rules

- **Interface-first**: every provider category has an interface in `@journeyman/core`. Implementations live in their respective package and must satisfy the interface.
- **`@journeyman/core` is the single type source**: import all option/result types from there, never duplicate them. `core` never imports from other `@journeyman/*` packages.
- **Coding-CLI vs Git-Provider distinction**: `coding-cli` runs git ops *locally via bash* (clone, scan, reset). `git-provider` calls *remote REST APIs* (PRs, webhooks). Don't mix them.
- **Stub pattern**: unimplemented methods throw `new Error("<ClassName>.<method> not implemented")` — never silent no-ops.
- **Import boundaries** enforced via `npm run check:boundaries` (see [scripts/check-import-boundaries.mjs](scripts/check-import-boundaries.mjs)).
- **Database**: PostgreSQL 16, direct SQL via `pg` (no ORM). All migrations are append-only in `packages/migrations/`. Before touching any DB table or adding a migration, read [docs/constitution/DATABASE_ARCHITECTURE.md](docs/constitution/DATABASE_ARCHITECTURE.md) for the full schema, ER diagrams, and patterns.

## coding-cli Internal Layout

```
packages/coding-cli/src/
├── index.ts                        ← exports all providers + ICodingCLI
├── interface.ts                    ← re-exports ICodingCLI from @journeyman/core
└── providers/
    ├── claude/
    │   ├── index.ts                ← ClaudeProvider class
    │   ├── operations/             ← scan-repos, checkout-repo, analyze, plan, implement, …
    │   └── utils/
    │       └── sdk-logger.ts       ← shared logSdkMessage() utility
    ├── gemini/index.ts             ← GeminiProvider stub
    └── codex/index.ts              ← CodexProvider stub
```

## Claude Agent SDK Usage

> **Type reference**: for all SDK types (`Options`, `Query`, `SDKMessage`, `PermissionMode`, `OutputFormat`, …) refer to [`.claude/sdk.d.ts`](.claude/sdk.d.ts). Read it before adding or changing any `query()` options.

All Claude operations use `query()` from `@anthropic-ai/claude-agent-sdk` with this minimal config:

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

const response = query({
  prompt: "...",
  options: {
    tools: ["Bash"],
    allowedTools: ["Bash"],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    settingSources: [],          // no filesystem settings loaded
    outputFormat: {
      type: "json_schema",
      schema: { /* ... */ },
    },
  },
});
```

- `settingSources: []` — disables all `.claude/` settings loading (minimal token config).
- `permissionMode: "bypassPermissions"` + `allowDangerouslySkipPermissions: true` — two separate permission layers, both required.
- `outputFormat: json_schema` — structured JSON returned in `msg.structured_output` on the `result` message.
- Use `sdk-logger.ts` (`logSdkMessage`) for all SDK message logging — never inline.

## Structured Output Pattern

```typescript
for await (const msg of response) {
  logSdkMessage(msg);
  if (msg.type === "result") {
    if (msg.subtype === "success") return msg.structured_output as MyResultType;
    throw new Error(msg.errors?.[0] ?? msg.subtype);
  }
}
```

## SDK Type Reference

Full type declarations: [.claude/sdk.d.ts](.claude/sdk.d.ts). Key types: `Options`, `Query`, `SDKMessage`, `SDKResultMessage`, `JsonSchemaOutputFormat`, `PermissionMode`.

## Commands

```bash
# Install / link workspace packages
npm install

# Type-check + import-boundary check (run both)
npm run check
npm run typecheck
npm run check:boundaries

# Tests (per-workspace, if present)
npm test

# Infrastructure (Postgres, Redis, Conductor)
npm run infra:up
npm run infra:down
npm run infra:reset       # destroys volumes

# DB migrations
npm run migrate

# Run services
npm run start:api-server
npm run start:worker      # tsx packages/orchestrator/src/cli-worker.ts
npm run dev:web
npm run build:web
```

## Implementation Status

| Feature | Status |
|---|---|
| `ClaudeProvider.scanRepos` / `checkoutRepo` / `commitPushRepos` / `cleanupRepos` / `createWorkspace` | Implemented |
| `ClaudeProvider.analyze` / `plan` / `implement` | Implemented (Claude Agent SDK + json_schema structured output) |
| `GeminiProvider` / `CodexProvider` | Stub |
| `GitHubProvider` | Implemented (cloneRepos + getRepo/createPR/listPRs via `@journeyman/github-api`) |
| `GitHubIssuesProvider` | Implemented (REST via `@journeyman/github-api`) |
| `GitHubProjectsProvider` | Implemented (GraphQL ProjectV2 via `@journeyman/github-api`) |
| `GitLabProvider` / `JiraProvider` / `LinearProvider` / `MondayProvider` / `SlackProvider` | Stub |
| `retryable` step flag (`FlowStepDefinition`; gates `POST /retry`) | Implemented |
| `@journeyman/mcp` — registry, CRUD (user + org routes), `resolveMcpInstances`, `toMcpServerConfigs` / `mergeSystemPrompts` subpath | Implemented |
| `analyze` / `plan` / `implement` consume `mcps?: ResolvedMcpInstance[]` | Implemented |
| Flow-editor MCP picker UI + worker pre-resolution of `mcpInstanceIds` | Implemented |
| Legacy `config.mcp` / `config.allowedTools` migration (load-time strip) | Implemented |
| `StepDefinition.supportsMcp` flag | Removed (replaced by `tabs.mcp`) |

## Adding a New Provider

1. Add the interface method to `@journeyman/core` if it doesn't exist.
2. Add option/result types to the relevant `types/*.types.ts` file in `core`.
3. Create the provider class in the correct package under `src/providers/<name>/index.ts`.
4. Implement the interface — throw for unimplemented methods.
5. Export from the package's `src/index.ts`.
6. Run `npm run check` to verify types + import boundaries.
