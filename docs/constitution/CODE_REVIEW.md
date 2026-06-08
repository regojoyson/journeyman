# CODE_REVIEW.md — Review Standards

Linked from [AGENTS.md](../../AGENTS.md). Applies to both human review and AI-assisted review.

## Tooling baseline

The repo currently has **no ESLint, Prettier, or precommit hooks**, and **no CI**. Review is therefore the primary quality gate — reviewers must run checks locally and not assume an automated safety net.

- Required local commands before requesting review: `npm run check` and `npm test` for affected workspaces.
- If you propose adding ESLint/Prettier/Husky/CI, do it as a **standalone, user-approved PR** — not bundled into a feature change.

## Pre-review checklist (author)

Before requesting review, confirm:

- [ ] `npm run check` passes (typecheck + import boundaries).
- [ ] `npm test` passes for changed workspaces with a `test` script.
- [ ] No `console.log`, `TODO` without ticket, or commented-out code.
- [ ] No new dependencies without justification in the PR description.
- [ ] No secrets, tokens, or `.env` content in the diff.
- [ ] Cross-package types are added/changed in `@journeyman/core`, not duplicated elsewhere.
- [ ] If you added a new package, `scripts/check-import-boundaries.mjs` classifies it (UI / backend / shared).
- [ ] Stubs throw the standard `"<Class>.<method> not implemented"` error.
- [ ] If schema changed, a migration in `packages/migrations/` ships in the same PR.

## What reviewers look for

### 1. Correctness
- Does it do what the description claims?
- Edge cases: empty inputs, null, network failure, partial results, large inputs.
- Async flows: every promise is awaited; errors propagate, not swallowed.

### 2. Scope
- Diff is focused. Out-of-scope changes belong in a separate PR.
- Abstractions justified by **current** needs, not hypothetical futures.

### 3. Interface & boundary integrity
- New cross-package types live in `@journeyman/core`.
- No `@journeyman/core` → `@journeyman/*` imports.
- UI bucket ↛ backend bucket and vice versa (`scripts/check-import-boundaries.mjs`).
- `@journeyman/steps/catalog` is the only sanctioned steps subpath that backend may import.
- All GitHub access goes through `@journeyman/github-api`; no ad-hoc Octokit instantiation.
- The `agent-runtime` (local bash) vs `git-provider` (remote REST) split is preserved.

### 4. Readability
- Names describe intent; comments explain non-obvious *why*, never the *what*.
- Functions do one thing; nesting is reasonable.
- No unrelated formatting churn (since there is no auto-formatter, churn must be deliberate).

### 5. Tests
- New behavior has a test that would fail without the change (Vitest, see [UNIT_TESTING.md](UNIT_TESTING.md)).
- Bug fixes have a regression test.
- Mocks are at trust boundaries (HTTP / DB / child process), not at internal seams.

### 6. Security
- Inputs at trust boundaries are validated.
- No new logging of secrets or PII.
- Shell commands in `agent-runtime` use argv arrays, not interpolated strings.
- LLM prompts treat user-supplied content as untrusted. See [SECURITY.md](SECURITY.md).

### 7. Performance
- No accidental `O(n²)` over collections that grow with users or runs.
- No N+1 database calls in tight loops.
- Long-running ops are awaited correctly and don't block the event loop.

### 8. Migrations & infra
- Migrations are append-only; no destructive operations without explicit approval.
- No silent changes to `infra/compose.dev.yml` / `compose.deploy.yml` ports or service versions.
- No new env vars without an entry in `.env.example`.

## Review tone

- Be specific. "This may break X because Y" beats "looks risky".
- Prefer questions over commands when intent is unclear.
- Distinguish **must-fix** (correctness, security, contracts) from **nit** (style preference). Label them.

## Self-review for AI agents

Before sending a diff to the user:
1. Re-read every changed file end-to-end.
2. Walk the checklist above as a different reviewer would.
3. Run `npm run check` and the affected `npm test`. Quote outcomes — do not paraphrase.
4. Report what you verified, not what you intended. If you couldn't verify something (no test exists, no infra available), say so explicitly.
