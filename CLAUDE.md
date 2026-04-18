# Journeyman — Claude Code Project Guide

## Project Overview

**Journeyman** is an npm workspaces monorepo that provides a provider-pattern abstraction over AI coding CLIs (Claude, Gemini, Codex), git hosting APIs, ticket trackers, and notification services. All packages share types and interfaces via `@journeyman/core`.

## Monorepo Structure

```
claude-sdk-test/            ← repo root (name: journeyman)
├── CLAUDE.md
├── package.json            ← workspaces: ["packages/*"]
├── sdk.ts                  ← original SDK type dump (root copy)
├── .claude/
│   ├── sdk.d.ts            ← @anthropic-ai/claude-agent-sdk type declarations (reference only)
│   └── memory/             ← persistent memory files
└── packages/
    ├── core/               ← @journeyman/core   — interfaces + shared types (source of truth)
    ├── coding-cli/         ← @journeyman/coding-cli  — Claude/Gemini/Codex CLI providers
    ├── git-provider/       ← @journeyman/git-provider  — GitHub/GitLab REST API providers
    ├── ticket-provider/    ← @journeyman/ticket-provider  — Jira/Linear/Monday providers
    └── notification-provider/ ← @journeyman/notification-provider  — Slack provider
```

## Package Responsibilities

| Package | Scope |
|---|---|
| `@journeyman/core` | Interfaces (`ICodingCLI`, `IGitProvider`, `ITicketProvider`, `INotificationProvider`) and all shared option/result types. Never imports from other `@journeyman/*` packages. |
| `@journeyman/coding-cli` | AI-powered git operations (clone, scan, reset) via Claude Agent SDK + analyze/plan/implement stubs. Providers: `ClaudeProvider`, `GeminiProvider`, `CodexProvider`. |
| `@journeyman/git-provider` | REST API operations (get repo, create PR/MR). Providers: `GitHubProvider`, `GitLabProvider`. |
| `@journeyman/ticket-provider` | Issue tracker operations (CRUD tickets). Providers: `JiraProvider`, `LinearProvider`, `MondayProvider`. |
| `@journeyman/notification-provider` | Notification delivery. Providers: `SlackProvider`. |

## Key Design Rules

- **Interface-first**: every provider category has an interface in `@journeyman/core`. Implementations live in their respective package and must satisfy the interface.
- **`@journeyman/core` is the single type source**: import all option/result types from there, never duplicate them.
- **Coding-CLI vs Git-Provider distinction**: `coding-cli` runs git operations *locally via bash* (clone, scan, reset). `git-provider` calls *remote REST APIs* (PRs, webhooks). Don't mix them.
- **Stub pattern**: unimplemented methods throw `new Error("<ClassName>.<method> not implemented")` — never return silent no-ops.

## coding-cli Internal Layout

```
packages/coding-cli/src/
├── index.ts                        ← exports all providers + ICodingCLI
├── interface.ts                    ← re-exports ICodingCLI from @journeyman/core
└── providers/
    ├── claude/
    │   ├── index.ts                ← ClaudeProvider class
    │   ├── operations/
    │   │   ├── clone-repos.ts      ← cloneRepos() via Claude Agent SDK
    │   │   ├── scan-repos.ts       ← scanRepos() via Claude Agent SDK
    │   │   └── reset-repos.ts      ← resetRepos() via Claude Agent SDK
    │   └── utils/
    │       └── sdk-logger.ts       ← shared logSdkMessage() utility
    ├── gemini/index.ts             ← GeminiProvider stub
    └── codex/index.ts              ← CodexProvider stub
```

## Claude Agent SDK Usage

> **Type reference**: for all SDK types (`Options`, `Query`, `SDKMessage`, `PermissionMode`, `OutputFormat`, etc.) refer to [`.claude/sdk.d.ts`](.claude/sdk.d.ts). Read it before adding or changing any `query()` options.

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

- `settingSources: []` — disables all `.claude/` settings loading (minimal token config)
- `permissionMode: "bypassPermissions"` + `allowDangerouslySkipPermissions: true` — two separate permission layers, both required
- `outputFormat: json_schema` — structured JSON returned in `msg.structured_output` on the `result` message
- Use `sdk-logger.ts` (`logSdkMessage`) for all SDK message logging — never inline

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

Full type declarations: [.claude/sdk.d.ts](.claude/sdk.d.ts)

Key types: `Options`, `Query`, `SDKMessage`, `SDKResultMessage`, `JsonSchemaOutputFormat`, `PermissionMode`.

## Commands

```bash
# Install / link workspace packages
npm install

# Type-check all packages
npm run typecheck

# Run a specific operation (example)
npx tsx packages/coding-cli/src/providers/claude/operations/clone-repos.ts
```

## Implementation Status

| Feature | Status |
|---|---|
| `ClaudeProvider.cloneRepos` | Implemented |
| `ClaudeProvider.scanRepos` | Implemented |
| `ClaudeProvider.resetRepos` | Implemented |
| `ClaudeProvider.commitPushRepos` | Implemented |
| `ClaudeProvider.cleanupRepos` | Implemented |
| `ClaudeProvider.analyze` | Stub |
| `ClaudeProvider.plan` | Stub |
| `ClaudeProvider.implement` | Stub |
| `GeminiProvider` | Stub |
| `CodexProvider` | Stub |
| `GitHubProvider` | Stub |
| `GitLabProvider` | Stub |
| `JiraProvider` | Stub |
| `LinearProvider` | Stub |
| `MondayProvider` | Stub |
| `SlackProvider` | Stub |

## Adding a New Provider

1. Add the interface method to `@journeyman/core` if it doesn't exist.
2. Add option/result types to the relevant `types/*.types.ts` file in `core`.
3. Create the provider class in the correct package under `src/providers/<name>/index.ts`.
4. Implement the interface — throw for unimplemented methods.
5. Export from the package's `src/index.ts`.
