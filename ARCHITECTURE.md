# ARCHITECTURE.md — System & Package Layout

Linked from [AGENT.md](AGENT.md). Provider-agnostic guide to where things live and why.

## 5-layer logical overview

| Layer | Role | Key packages |
|---|---|---|
| Web UI | Visual canvas editor, run monitoring, history | `web`, `flow-editor`, `run-viewer`, `runs-list`, `theme` |
| API Gateway | Fastify REST + SSE; auth, validation | `api-server`, `identity`, `secrets` |
| Orchestrator | Conductor adapter, worker harness, durable execution | `orchestrator`, `migrations` |
| Steps & Providers | Per-node logic — AI coding, git, tickets, notifications | `steps`, `custom-steps`, `coding-cli`, `coding-models`, `git-provider`, `github-api`, `ticket-provider`, `notification-provider`, `mcp`, `skills` |
| Storage | Persistence + queue | PostgreSQL, Redis (`@journeyman/migrations` owns schema) |

## Import-boundary layers (enforced)

`scripts/check-import-boundaries.mjs` enforces a **3-bucket import layering** independent of the 5-layer logical view above:

| Bucket | Members | May import from |
|---|---|---|
| **Shared** | `core`, `identity` | shared only |
| **UI** | `web`, `flow-editor`, `run-viewer`, `runs-list`, `steps`, `theme` | UI + shared |
| **Backend** | `api-server`, `orchestrator`, `coding-cli`, `coding-models`, `git-provider`, `github-api`, `ticket-provider`, `notification-provider`, `secrets`, `migrations`, `mcp`, `skills`, `custom-steps` | backend + shared |

**Subpath override:** `@journeyman/steps/catalog` is treated as **shared** (pure-data `*.meta.ts`), so backend packages may import it even though `steps` itself is UI-bucket.

Run `npm run check:boundaries` to validate. If you add a package, update the script.

## Monorepo layout (21 packages, all at `0.1.0`)

```
journeyman/
├── AGENT.md ← entry point for AI agents
├── CONSTITUTION.md / ARCHITECTURE.md (this) / CODE_REVIEW.md
├── UNIT_TESTING.md / DEPLOYMENT.md / SECURITY.md / VERSION_MANAGEMENT.md
├── CLAUDE.md ← Claude Agent SDK deep dive (defers to AGENT.md)
├── .env.example
├── docs/ examples/ infra/ scripts/
└── packages/
    ├── core/                ← interfaces + shared types (source of truth)
    ├── identity/            ← JWT auth (shared bucket alongside core)
    │
    ├── web/ flow-editor/ run-viewer/ runs-list/ theme/   ← UI
    │
    ├── api-server/ orchestrator/ secrets/ migrations/    ← Backend
    ├── steps/ custom-steps/
    ├── coding-cli/ coding-models/
    ├── git-provider/ github-api/
    ├── ticket-provider/ notification-provider/
    └── mcp/ skills/
```

## Hard rules

1. **`@journeyman/core` is the type source of truth.** All interfaces and option/result types. Core imports from no `@journeyman/*` package.
2. **`@journeyman/identity` is also in the shared bucket.** Both UI and backend may import it.
3. **`coding-cli` (local bash) vs `git-provider` (remote REST).** `coding-cli` runs `git clone`, `git checkout`, `git push` locally via bash. `git-provider` calls remote REST APIs (create PR, list repos, webhooks). Do not mix.
4. **Stub pattern.** Unimplemented provider methods `throw new Error("<Class>.<method> not implemented")`.
5. **Import boundaries.** Enforced by `scripts/check-import-boundaries.mjs`. UI ↛ backend, backend ↛ UI.
6. **One GitHub client.** All Octokit usage goes through `@journeyman/github-api` (`createGitHubClient({ token })` → `{ rest, graphql }`). Do not instantiate Octokit elsewhere.

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
5. **Update `scripts/check-import-boundaries.mjs`** to place the new package in the right bucket. Without this it will be unclassified.
6. Add a `typecheck` script in the package (and `test` if appropriate) so the root commands pick it up.

## Cross-cutting components

- **MCP integration.** `@journeyman/mcp` owns the DB-backed registry plus the pure subpath `@journeyman/mcp/sdk-adapter` consumed by `coding-cli`. `analyze` / `plan` / `implement` receive `mcps?: ResolvedMcpInstance[]`.
- **Skills.** `@journeyman/skills` manages skill packages and exposes a Claude Agent SDK adapter. Provider-agnostic consumers should depend on the public adapter API, not Claude internals.
- **GitHub API.** `@journeyman/github-api` is the single Octokit client with retry/throttling tuned. Ticket, project, and git providers depend on it.
- **Claude Agent SDK.** `@anthropic-ai/claude-agent-sdk` is consumed only by `coding-cli` (and indirectly via the `mcp` / `skills` adapters). See [CLAUDE.md](CLAUDE.md) and `.claude/sdk.d.ts` for type reference.

## Diagrams & deeper docs

See `docs/` for architecture diagrams and the quickstart guide.
