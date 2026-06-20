# Journeyman — Claude Code Project Guide

## Project Overview

**Journeyman** is a configurable, step-based AI pipeline that automates ticket → code → PR workflows. It's an npm workspaces monorepo built around a provider-pattern: AI coding CLIs (Claude, OpenCode, Gemini, Codex), git hosts (GitHub, GitLab), ticket trackers (Jira, Linear, Monday, GitHub Issues/Projects), and notification channels (Slack, Console) are all swappable behind interfaces defined in `@journeyman/core`.

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
├── compose.deploy.yml       ← full stack: infra + apps + dind (`npm run compose:up`)
├── docs/                    ← architecture diagrams, quickstart, setup
│   └── constitution/        ← developer guidelines (ARCHITECTURE, DATABASE_ARCHITECTURE, CONSTITUTION, SECURITY, …)
├── examples/
├── infra/                   ← compose.dev.yml: dev deps only — Postgres, Redis, Conductor (`npm run infra:up`)
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
    ├── sandbox/             ← execution-environment registry + local/docker backends
    ├── identity/            ← JWT auth, bcrypt, user/org/role management
    ├── secrets/             ← user/org secret vault (AES encryption)
    ├── webhooks/            ← webhook auth, schema lint/validate, payload extract, presets
    ├── migrations/          ← SQL migrations (journeyman-migrate CLI)
    │
    ├── steps/              ← built-in step catalog
    ├── custom-steps/       ← user-defined AI steps with prompt templates
    │
    ├── agent-runtime/       ← stdin/stdout runner + coding providers (Claude/OpenCode/Gemini/Codex); the only package shipped into a sandbox container
    ├── coding-models/       ← AI model provider configuration
    ├── git-provider/        ← GitHub/GitLab REST API providers
    ├── github-api/          ← shared Octokit client (REST + GraphQL)
    ├── ticket-provider/     ← Jira/Linear/Monday/GitHub Issues/Projects
    ├── notification-provider/ ← Slack, Console
    │
    ├── mcp/                 ← MCP instance registry + Claude SDK adapter
    └── skills/              ← Skill package management + Claude SDK adapter
```

## Package Responsibilities

### Shared

| Package | Scope |
|---|---|
| `@journeyman/core` | Interfaces (`ICodingCLI`, `IGitProvider`, `IIssueProvider`, `INotificationProvider`) and all shared option/result types. Never imports from other `@journeyman/*` packages. |

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
| `@journeyman/sandbox` | DB-backed execution-environment registry (user/org scope) with local + Docker backends, resolver, and CRUD routes. Provisions the workspace a step runs in. |
| `@journeyman/identity` | JWT auth, bcrypt passwords, user/org/role management. |
| `@journeyman/secrets` | User- and org-scoped secret vault with AES encryption. |
| `@journeyman/webhooks` | Webhook signature verification, JSON-schema lint/validate, payload field extraction, and a preset library. |
| `@journeyman/migrations` | SQL migrations (`journeyman-migrate` CLI). |

### Steps

| Package | Scope |
|---|---|
| `@journeyman/steps` | Built-in step catalog: deterministic provider operations (cloneRepos, startFeatureBranch, listWorkspaceFiles, getIssue/createIssue/commentOnIssue/transitionIssue/updateIssueFields, getRepository, openPullRequest/commentOnPullRequest/listPullRequests/listPullRequestComments, sendMessage) plus the AI-driven `custom-ai` step. |
| `@journeyman/custom-steps` | User-defined AI step registration with prompt templates, default tools/MCPs/skills. |

### Providers

| Package | Scope |
|---|---|
| `@journeyman/agent-runtime` | Box runtime shipped into the sandbox container: a stdin/stdout runner (`runRunnerCli` / `dispatchOperation`), provider-independent workspace ops (clone/scan/checkout), and the coding providers implementing `ICodingCLI` (`scanRepos`, `checkoutRepo`, `runCustomPrompt`). Providers: `ClaudeProvider`, `OpenCodeProvider`, `GeminiProvider`, `CodexProvider` (built via `createCodingProvider`). |
| `@journeyman/coding-models` | AI model provider configuration (Claude, OpenCode, Gemini, Codex). |
| `@journeyman/git-provider` | Remote REST ops (create PR/MR, list repos). Providers: `GitHubProvider`, `GitLabProvider`. |
| `@journeyman/github-api` | Shared Octokit client (`@octokit/rest` + `@octokit/graphql` with retry/throttling). `createGitHubClient({ token })` → `{ rest, graphql }`. |
| `@journeyman/ticket-provider` | Issue tracker CRUD (`IIssueProvider`). Providers: `JiraProvider`, `LinearProvider`, `MondayProvider`, `GitHubIssuesProvider`, `GitHubProjectsProvider`. |
| `@journeyman/notification-provider` | Notification delivery. Providers: `SlackProvider`, `ConsoleProvider`. |

### Integrations

| Package | Scope |
|---|---|
| `@journeyman/mcp` | DB-backed MCP instance registry (user/org scope), CRUD + visible-list + static catalog routes, resolver producing `ResolvedMcpInstance[]`, and pure subpath `@journeyman/mcp/sdk-adapter` consumed by `agent-runtime`. |
| `@journeyman/skills` | Skill package management and Claude Agent SDK adapter. |

## Key Design Rules

- **Interface-first**: every provider category has an interface in `@journeyman/core`. Implementations live in their respective package and must satisfy the interface.
- **`@journeyman/core` is the single type source**: import all option/result types from there, never duplicate them. `core` never imports from other `@journeyman/*` packages.
- **agent-runtime vs git-provider distinction**: `agent-runtime` runs git/workspace ops *locally via bash* inside the sandbox (clone, scan, checkout). `git-provider` calls *remote REST APIs* (PRs, MRs, webhooks). Don't mix them.
- **Stub pattern**: unimplemented methods throw `new Error("<ClassName>.<method> not implemented")` — never silent no-ops.
- **Import boundaries** enforced via `npm run check:boundaries` (see [scripts/check-import-boundaries.mjs](scripts/check-import-boundaries.mjs)).
- **Database**: PostgreSQL 16, direct SQL via `pg` (no ORM). All migrations are append-only in `packages/migrations/`. Before touching any DB table or adding a migration, read [docs/constitution/DATABASE_ARCHITECTURE.md](docs/constitution/DATABASE_ARCHITECTURE.md) for the full schema, ER diagrams, and patterns.

## agent-runtime Internal Layout

```
packages/agent-runtime/src/
├── index.ts                        ← exports providers, createCodingProvider, runner entrypoints
├── interface.ts                    ← re-exports ICodingCLI from @journeyman/core
├── runner/
│   ├── cli.ts                      ← journeyman-runner: reads RunnerRequest on stdin, writes RunnerResponse on stdout (ensures node on PATH, sets IS_SANDBOX=1)
│   ├── dispatch.ts                 ← dispatchOperation(): maps op → ICodingCLI method
│   ├── run-cli.ts                  ← runRunnerCli(): parse stdin → dispatch → JSON stdout
│   ├── operation-runner.ts         ← in-process operation runner
│   └── runner-types.ts             ← RunnerRequest / RunnerResponse
└── providers/
    ├── factory.ts                  ← createCodingProvider(key, opts)
    ├── tool-maps.ts                ← PROVIDER_TOOL_MAPS, unsupportedTools, ProviderId
    ├── claude/
    │   ├── index.ts                ← ClaudeProvider class
    │   ├── tool-mapping.ts         ← claudeNativeTools(): canonical → native Claude tool names
    │   ├── operations/             ← scan-repos, checkout-repo, run-custom-prompt
    │   └── utils/                  ← sdk-logger.ts (logSdkMessage), session.ts
    ├── opencode/index.ts           ← OpenCodeProvider
    ├── gemini/index.ts             ← GeminiProvider stub
    └── codex/index.ts              ← CodexProvider stub
```

`ICodingCLI` (in `@journeyman/core`) is intentionally small: `scanRepos`, `checkoutRepo`, `runCustomPrompt`. There is no longer a separate `analyze` / `plan` / `implement` — AI work runs through `runCustomPrompt` (driven by `custom-ai` steps).

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

### Tool Selection (canonical → native)

Steps store **canonical** tool names (`CANONICAL_TOOLS` in `packages/core/src/types/coding-tools.types.ts`): `bash`, `read-file`, `write-file`, `edit-file`, `search`, `web-fetch`, `web-search`. Each provider maps them to its own native tool names via its `tool-mapping.ts` — e.g. Claude: `bash → ["Bash"]`, `search → ["Grep", "Glob"]` (`claudeNativeTools()`). `run-custom-prompt.ts` builds the SDK's `{ tools, allowedTools }` from this mapping; an empty/undefined list means a pure-prompt step (no tools, both keys omitted).

Tool selection is a **custom-AI-step feature only** — the flow-editor Tools picker is gated behind `customStepId`. Built-in/"normal" steps are deterministic provider operations and expose no tools picker. Tools in `WORKSPACE_TOOLS` (`bash`, `read-file`, `write-file`, `edit-file`, `search`) trigger workspace provisioning (`toolsRequireWorkspace()`).

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

# Build runner/sandbox images + the deployable kit
npm run images:build      # ./scripts/build-images.sh
npm run build:kit         # node scripts/build-kit.mjs

# Full-stack via docker compose
npm run compose:up
npm run compose:down
npm run compose:reset     # destroys volumes

# Kubernetes (local overlay)
npm run k8s:up
npm run k8s:down
npm run k8s:reset
```

## Implementation Status

| Feature | Status |
|---|---|
| `ClaudeProvider.scanRepos` / `checkoutRepo` | Implemented |
| `ClaudeProvider.runCustomPrompt` | Implemented (Claude Agent SDK + json_schema structured output) |
| `OpenCodeProvider` | Implemented (`scanRepos`/`checkoutRepo`/`runCustomPrompt` via `@opencode-ai/sdk` managed server; MCP, native skills, canonical tools, json_schema structured output; local + Docker) |
| `GeminiProvider` / `CodexProvider` | Stub |
| `GitHubProvider` | Implemented (cloneRepos + getRepo/createPR/listPRs via `@journeyman/github-api`) |
| `GitHubIssuesProvider` | Implemented (REST via `@journeyman/github-api`) |
| `GitHubProjectsProvider` | Implemented (GraphQL ProjectV2 via `@journeyman/github-api`) |
| `GitLabProvider` / `JiraProvider` / `LinearProvider` / `MondayProvider` | Stub |
| `SlackProvider` (notifications) | Implemented (token → chat.postMessage; webhook → incoming webhook) |
| `ConsoleProvider` (notifications) | Implemented |
| `retryable` step flag (`FlowStepDefinition`; gates `POST /retry`) | Implemented |
| `@journeyman/mcp` — registry, CRUD (user + org routes), `resolveMcpInstances`, `toMcpServerConfigs` / `mergeSystemPrompts` subpath | Implemented |
| `runCustomPrompt` consumes `mcps?: ResolvedMcpInstance[]`, `skills?: ResolvedSkillPackage[]`, `tools?: CanonicalTool[]` | Implemented |
| Flow-editor MCP + tools picker (custom-AI only) + worker pre-resolution of `mcpInstanceIds` | Implemented |
| Canonical tool model (`CANONICAL_TOOLS`) + per-provider `tool-mapping.ts` | Implemented |
| `@journeyman/sandbox` — execution-environment registry (local + Docker backends), resolver, routes | Implemented |
| `StepDefinition.supportsMcp` flag | Removed (replaced by `tabs.mcp`) |

## Adding a New Provider

1. Add the interface method to `@journeyman/core` if it doesn't exist.
2. Add option/result types to the relevant `types/*.types.ts` file in `core`.
3. Create the provider class in the correct package under `src/providers/<name>/index.ts`.
4. Implement the interface — throw for unimplemented methods.
5. For a new **coding** provider (in `agent-runtime`), add a `tool-mapping.ts` translating `CanonicalTool` → native tool names, register it in `providers/tool-maps.ts`, and wire it into `createCodingProvider` (`providers/factory.ts`).
6. Export from the package's `src/index.ts`.
7. Run `npm run check` to verify types + import boundaries.
