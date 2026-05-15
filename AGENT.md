# AGENT.md — AI Agent Instructions (Journeyman)

This file is the **entry point for any AI coding agent** (Claude, Codex, Gemini, Cursor, Copilot, etc.) working on this repository. It is intentionally provider-neutral.

If your runtime has its own convention file (`CLAUDE.md`, `.cursorrules`, `GEMINI.md`, `AGENTS.md`), treat **this file and its links as the source of truth**. Provider-specific files should defer here. The existing [CLAUDE.md](CLAUDE.md) covers Claude Agent SDK specifics and is consistent with these docs.

## How to use this file

1. Read this file fully before taking any action.
2. Follow the linked documents for the topic relevant to your task.
3. When instructions conflict: **explicit user request > [CONSTITUTION.md](CONSTITUTION.md) > topic-specific docs > defaults**.

## Project summary

Journeyman is a configurable, phase-based AI pipeline that automates **ticket → code → PR** workflows. It is an **npm-workspaces monorepo** (`packages/*`, currently 21 packages, all at version `0.1.0`) using a provider pattern. Interfaces (`ICodingCLI`, `IGitProvider`, `ITicketProvider`, `INotificationProvider`) live in `@journeyman/core`; implementations live in their respective packages. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Instruction index

| Topic | Document | When to consult |
|---|---|---|
| Operating principles | [CONSTITUTION.md](CONSTITUTION.md) | Always — non-negotiable rules. |
| System & package layout | [ARCHITECTURE.md](ARCHITECTURE.md) | Before adding packages, providers, or cross-cutting changes. |
| Code review standards | [CODE_REVIEW.md](CODE_REVIEW.md) | When reviewing or self-reviewing changes. |
| Tests & verification | [UNIT_TESTING.md](UNIT_TESTING.md) | When adding/changing tests or before claiming done. |
| Infra, migrations, deploys | [DEPLOYMENT.md](DEPLOYMENT.md) | When touching infra, migrations, or env config. |
| Security | [SECURITY.md](SECURITY.md) | When handling auth, secrets, user input, or external calls. |
| Versioning & branches | [VERSION_MANAGEMENT.md](VERSION_MANAGEMENT.md) | When bumping versions, branching, or tagging. |

## Verification commands (run before claiming done)

```bash
npm run check            # typecheck + import-boundary check (root)
npm run typecheck        # types only, all workspaces
npm run check:boundaries # scripts/check-import-boundaries.mjs
npm test                 # vitest run, per-workspace (only where configured)
```

Currently `test` is configured in `core`, `custom-phases`, `coding-models`, and `notification-provider`. Other packages have no test script yet — adding one is welcome.

## Running services locally

```bash
npm run infra:up         # Postgres (5433), Redis (6380), Conductor (8080/5001)
npm run migrate          # apply SQL migrations via @journeyman/migrations
npm run start:api-server
npm run start:worker     # tsx packages/orchestrator/src/cli-worker.ts
npm run dev:web
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for details and `.env` configuration.

## Core workflow expectations

- **Plan before you code** for any non-trivial change. State the files you will touch and why.
- **Read before you edit.** Open the file, understand context, then edit.
- **Verify before you claim done.** `npm run check` at minimum.
- **Respect interface boundaries.** All cross-package types come from `@journeyman/core`. Import-layer rules (UI / backend / shared) are enforced by `scripts/check-import-boundaries.mjs` — see [ARCHITECTURE.md](ARCHITECTURE.md).
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
