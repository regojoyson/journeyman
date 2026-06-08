# AGENTS.md — AI Agent Instructions (Journeyman)

This file is the **entry point for any AI coding agent** (Claude, Codex, Gemini, Cursor, Copilot, etc.) working on this repository. It is intentionally provider-neutral.

If your runtime has its own convention file (`CLAUDE.md`, `.cursorrules`, `GEMINI.md`), treat **this file and its links as the source of truth**. Provider-specific files should defer here. The existing [CLAUDE.md](CLAUDE.md) covers Claude Agent SDK specifics and is consistent with these docs.

## How to use this file

1. Read this file fully before taking any action.
2. Follow the linked documents for the topic relevant to your task.
3. When instructions conflict: **explicit user request > [CONSTITUTION.md](docs/constitution/CONSTITUTION.md) > topic-specific docs > defaults**.

## Project summary

Journeyman is a configurable, step-based AI pipeline that automates **ticket → code → PR** workflows. It is an **npm-workspaces monorepo** (`packages/*`, currently 23 packages, all at version `0.1.0`) using a provider pattern. Interfaces (`ICodingCLI`, `IGitProvider`, `IIssueProvider`, `INotificationProvider`) live in `@journeyman/core`; implementations live in their respective packages. Storage is **PostgreSQL 16** via direct SQL (no ORM) + Redis for the job queue.

## Instruction index

| Topic | Document | When to consult |
|---|---|---|
| Operating principles | [CONSTITUTION.md](docs/constitution/CONSTITUTION.md) | Always — non-negotiable rules. |
| System & package layout | [ARCHITECTURE.md](docs/constitution/ARCHITECTURE.md) | Before adding packages, providers, or cross-cutting changes. |
| Database schema & diagrams | [DATABASE_ARCHITECTURE.md](docs/constitution/DATABASE_ARCHITECTURE.md) | Before touching any DB table, writing a migration, or querying data. |
| Code review standards | [CODE_REVIEW.md](docs/constitution/CODE_REVIEW.md) | When reviewing or self-reviewing changes. |
| Tests & verification | [UNIT_TESTING.md](docs/constitution/UNIT_TESTING.md) | When adding/changing tests or before claiming done. |
| Infra, migrations, deploys | [DEPLOYMENT.md](docs/constitution/DEPLOYMENT.md) | When touching infra, migrations, or env config. |
| Security | [SECURITY.md](docs/constitution/SECURITY.md) | When handling auth, secrets, user input, or external calls. |
| Versioning & branches | [VERSION_MANAGEMENT.md](docs/constitution/VERSION_MANAGEMENT.md) | When bumping versions, branching, or tagging. |

## Verification commands (run before claiming done)

```bash
npm run check            # typecheck + import-boundary check (root)
npm run typecheck        # types only, all workspaces
npm run check:boundaries # scripts/check-import-boundaries.mjs
npm test                 # vitest run, per-workspace (only where configured)
```

Currently `test` is configured in `core`, `custom-steps`, `coding-models`, `notification-provider`, `agent-runtime`, `git-provider`, `sandbox`, `skills`, and `web`. Other packages have no test script yet — adding one is welcome.

## Running services locally

Two ways, via two compose files:

- **Dev (`infra/compose.dev.yml`)** — only the dependencies in Docker, apps on your host:

```bash
npm run infra:up         # infra/compose.dev.yml — Postgres (5433), Redis (6380), Conductor (8080/5001)
npm run migrate          # apply SQL migrations via @journeyman/migrations
npm run start:api-server
npm run start:worker     # tsx packages/orchestrator/src/cli-worker.ts
npm run dev:web
```

- **Full stack (`compose.deploy.yml`)** — everything containerized, incl. a built-in Docker
  engine for docker-workspace sandboxes, on a 6000-series port set:

```bash
npm run compose:up       # compose.deploy.yml — full stack; UI at http://localhost:6080
npm run compose:down     # stop (keep data)
```

See [DEPLOYMENT.md](docs/constitution/DEPLOYMENT.md) and [deploy-docker-compose.md](docs/deploy-docker-compose.md) for details and `.env` configuration.

## Core workflow expectations

- **Plan before you code** for any non-trivial change. State the files you will touch and why.
- **Read before you edit.** Open the file, understand context, then edit.
- **Verify before you claim done.** `npm run check` at minimum.
- **Respect interface boundaries.** All cross-package types come from `@journeyman/core`. Import-layer rules (UI / backend / shared) are enforced by `scripts/check-import-boundaries.mjs` — see [ARCHITECTURE.md](docs/constitution/ARCHITECTURE.md).
- **No silent no-ops.** Unimplemented methods throw `new Error("<Class>.<method> not implemented")`.

## Provider-neutral conventions

- Use **npm** (workspaces). Do not introduce `pnpm`, `yarn`, or `bun`.
- TypeScript everywhere except `scripts/*.mjs`.
- Prefer editing existing files over creating new ones.
- Do not create documentation files unless asked. (These instruction files are the explicit exception.)
- Do not add emojis to source or docs unless asked.
- There is currently **no ESLint, Prettier, Husky, or CI**. Do not introduce these without explicit user approval — they affect every contributor.

## When in doubt

Ask the user one focused question, or make the **smallest reasonable assumption**, state it, and proceed. Never invent file paths, APIs, or commands you have not verified.
