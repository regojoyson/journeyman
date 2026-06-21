# ARCHITECTURE.md — System & Package Layout

Linked from [AGENTS.md](../../AGENTS.md). Provider-agnostic guide to where things live and why.

## 5-layer logical overview

| Layer | Role | Key packages |
|---|---|---|
| Web UI | Visual canvas editor, run monitoring, history | `web`, `flow-editor`, `run-viewer`, `runs-list`, `workspace-dashboard`, `theme` |
| API Gateway | Fastify REST + SSE; auth, validation, webhook ingest. `analytics` is a separate read-only stats service. | `api-server`, `analytics`, `identity`, `secrets`, `webhooks` |
| Orchestrator | Conductor adapter, worker harness, durable execution, sandbox provisioning | `orchestrator`, `sandbox`, `migrations` |
| Steps & Providers | Per-node logic — AI coding, git, tickets, notifications | `steps`, `custom-steps`, `agent-runtime`, `coding-models`, `git-provider`, `github-api`, `ticket-provider`, `notification-provider`, `mcp`, `skills` |
| Storage | Persistence + queue | PostgreSQL, Redis (`@journeyman/migrations` owns schema) |

## Import-boundary layers (enforced)

`scripts/check-import-boundaries.mjs` enforces a **3-bucket import layering** independent of the 5-layer logical view above:

| Bucket | Tracked members | May import from |
|---|---|---|
| **Shared** | `core`, `identity` | shared only |
| **UI** | `web`, `flow-editor`, `run-viewer`, `runs-list`, `steps` | UI + shared |
| **Backend** | `api-server`, `orchestrator`, `agent-runtime`, `sandbox`, `git-provider`, `github-api`, `ticket-provider`, `notification-provider`, `secrets`, `migrations`, `webhooks` | backend + shared |

**Not yet tracked by the boundary script** (logically backend): `coding-models`, `mcp`, `skills`, `custom-steps`, `analytics`. These are backend packages by design but the boundary check does not scan them. `theme` and `workspace-dashboard` are logically UI-only but also not tracked.

**Subpath override:** `@journeyman/steps/catalog` is treated as **shared** (pure-data `*.meta.ts`, no React), so backend packages may import it even though `steps` itself is UI-bucket.

Run `npm run check:boundaries` to validate. If you add a package, update `PKG_LAYER` in the script.

## Monorepo layout (25 active packages, all at `0.1.0`)

```
journeyman/
├── AGENTS.md              ← entry point for AI agents
├── CLAUDE.md              ← Claude Agent SDK deep dive (defers to AGENTS.md)
├── docs/constitution/     ← CONSTITUTION.md, ARCHITECTURE.md (this), CODE_REVIEW.md, …
├── .env.example
├── docs/ examples/ infra/ scripts/
└── packages/
    ├── core/                ← interfaces + shared types (source of truth)
    ├── identity/            ← JWT auth (shared bucket alongside core)
    │
    ├── web/                 ← React web shell                              [UI]
    ├── flow-editor/         ← visual canvas editor (drag-drop, properties) [UI]
    ├── run-viewer/          ← read-only execution canvas with live status   [UI]
    ├── runs-list/           ← sortable/filterable run history table         [UI]
    ├── workspace-dashboard/ ← workspace stats dashboard page                [UI, not boundary-tracked]
    ├── theme/               ← shared UI theme primitives                    [UI, not boundary-tracked]
    │
    ├── api-server/          ← Fastify HTTP gateway (REST + SSE)             [backend]
    ├── analytics/           ← standalone workspace stats service (read-only) [backend, not boundary-tracked]
    ├── orchestrator/        ← Conductor adapter + worker harness            [backend]
    ├── sandbox/             ← execution-environment registry + local/docker backends [backend]
    ├── secrets/             ← user/org secret vault (AES-256-GCM)          [backend]
    ├── migrations/          ← SQL migrations (journeyman-migrate CLI)       [backend]
    ├── webhooks/            ← webhook auth, schema, preset library          [backend]
    │
    ├── steps/               ← built-in step catalog                        [UI; /catalog subpath → shared]
    ├── custom-steps/        ← user-defined AI steps + prompt templates      [backend, not boundary-tracked]
    │
    ├── agent-runtime/       ← Claude/OpenCode/Gemini/Codex providers + stdin/stdout runner (AI + local git); shipped into the sandbox container [backend]
    ├── coding-models/       ← AI model catalog management                  [backend, not boundary-tracked]
    ├── git-provider/        ← GitHub/GitLab REST (PRs, webhooks)            [backend]
    ├── github-api/          ← shared Octokit client (REST + GraphQL)        [backend]
    ├── ticket-provider/     ← Jira/Linear/Monday/GitHub Issues & Projects   [backend]
    ├── notification-provider/ ← Slack, Console                             [backend]
    │
    ├── mcp/                 ← MCP instance registry + Claude SDK adapter    [backend, not boundary-tracked]
    └── skills/              ← skill package management + Claude SDK adapter [backend, not boundary-tracked]
```

> **Legacy empty directories** — `packages/phases/`, `packages/pipeline/`, `packages/pipeline-server/`, and `packages/ui/` contain no `package.json` and are unused remnants of earlier designs. They are safe to delete if they appear in your working tree.

## Hard rules

1. **`@journeyman/core` is the type source of truth.** All interfaces and option/result types. Core imports from no `@journeyman/*` package.
2. **`@journeyman/identity` is also in the shared bucket.** Both UI and backend may import it.
3. **`agent-runtime` (local bash) vs `git-provider` (remote REST).** `agent-runtime` runs `git clone`, `git checkout`, `git push` locally via bash inside the sandbox. `git-provider` calls remote REST APIs (create PR, list repos, webhooks). Do not mix.
4. **`webhooks` is a library, not a server.** `@journeyman/webhooks` provides webhook auth verification, HMAC signing, payload schema, and preset definitions. It has no server of its own — `api-server` consumes it for the ingest endpoint.
5. **Stub pattern.** Unimplemented provider methods `throw new Error("<Class>.<method> not implemented")`.
6. **Import boundaries.** Enforced by `scripts/check-import-boundaries.mjs`. UI ↛ backend, backend ↛ UI.
7. **One GitHub client.** All Octokit usage goes through `@journeyman/github-api` (`createGitHubClient({ token })` → `{ rest, graphql }`). Do not instantiate Octokit elsewhere.

## Packages with tests

`npm test` runs vitest across all workspaces that declare a `test` script. Currently configured:

| Package | Notes |
|---|---|
| `@journeyman/core` | Interface + type contract tests |
| `@journeyman/custom-steps` | Step registration and schema validation |
| `@journeyman/coding-models` | Model catalog logic |
| `@journeyman/notification-provider` | Slack/Console provider unit tests |
| `@journeyman/agent-runtime` | Provider factory, runner dispatch, tool mapping, custom-prompt wiring |
| `@journeyman/git-provider` | GitHub/GitLab provider tests |
| `@journeyman/sandbox` | Registry, DB, default-registry tests |
| `@journeyman/skills` | Skill package + adapter tests |
| `@journeyman/web` | Web shell tests |

All other packages have no `test` script yet — adding one is welcome.

## Adding a new provider

1. Add or update the interface in `@journeyman/core`.
2. Add option/result types under `packages/core/src/types/*.types.ts`.
3. Create `packages/<category>/src/providers/<name>/index.ts` exporting a class implementing the interface.
4. Throw for unimplemented methods.
5. Re-export from the package's `src/index.ts`.
6. Run `npm run check`.

## Adding a new package

1. Decide its layer (logical) and bucket (UI / backend / shared).
2. Check that an existing package doesn't already own the responsibility.
3. Add `packages/<name>/package.json` with name `@journeyman/<name>`, version `0.1.0` (matches the monorepo lock).
4. Workspaces glob is `packages/*` — no root edit needed.
5. **Update `PKG_LAYER` in `scripts/check-import-boundaries.mjs`** to place the new package in the right bucket. Without this it will not be boundary-checked.
6. Add a `typecheck` script in the package (and `test` if appropriate) so the root commands pick it up.

## Cross-cutting components

- **Webhooks.** `@journeyman/webhooks` is a pure library: HMAC auth verification, payload schema validation, and preset configs for GitHub, GitLab, Jira, Linear, Monday, etc. `api-server` uses it for the ingest endpoint; `orchestrator` uses preset definitions for webhook-wait correlation.
- **MCP integration.** `@journeyman/mcp` owns the DB-backed registry plus the pure subpath `@journeyman/mcp/sdk-adapter` consumed by `agent-runtime`. `runCustomPrompt` receives `mcps?: ResolvedMcpInstance[]` (alongside `skills?` and `tools?`).
- **Skills.** `@journeyman/skills` manages skill packages and exposes a Claude Agent SDK adapter. Provider-agnostic consumers should depend on the public adapter API, not Claude internals.
- **GitHub API.** `@journeyman/github-api` is the single Octokit client with retry/throttling tuned. Ticket, project, and git providers depend on it.
- **Claude Agent SDK.** `@anthropic-ai/claude-agent-sdk` is consumed only by `agent-runtime` (and indirectly via the `mcp` / `skills` adapters). See [CLAUDE.md](../../CLAUDE.md) and `.claude/sdk.d.ts` for type reference.

## Diagrams & deeper docs

- [DATABASE_ARCHITECTURE.md](DATABASE_ARCHITECTURE.md) — PostgreSQL schema, ER diagrams, sequence diagrams, storage patterns
- `docs/` — architecture diagrams and quickstart guide
