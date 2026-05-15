# CONSTITUTION.md — Non-Negotiable Rules

Linked from [AGENT.md](AGENT.md). These rules apply to **every AI agent** regardless of provider. They override defaults but never override an explicit user instruction.

## 1. Truth & verification

1. **Never claim work is complete without verification.** Run `npm run check` (typecheck + boundaries) and any relevant tests. Quote the output.
2. **Never fabricate.** No invented file paths, function names, package versions, API signatures, or command flags. If unsure, read the file or run `--help`.
3. **Cite file paths and line numbers** when referring to code (`path/to/file.ts:42`).

## 2. Scope discipline

1. Do **only** what was requested. No drive-by refactors, no opportunistic renames, no "while I'm here" cleanups.
2. No speculative abstractions, no feature flags, no compatibility shims for hypothetical futures.
3. Three similar lines is better than a premature abstraction.

## 3. Code hygiene

1. **No dead code.** If you remove a caller, remove the callee (verify with grep first).
2. **Default to zero comments.** Add a comment only when the *why* is non-obvious (hidden constraint, subtle invariant, known workaround).
3. **No comments that narrate the task** ("added for ticket X", "fixes the bug from the PR review"). That belongs in commit messages.
4. **No `console.log` debugging left behind.** Use the project logger or remove it.

## 4. Safety with destructive actions

Get explicit confirmation before:
- `git reset --hard`, `git push --force`, branch deletion, amending pushed commits.
- `rm -rf`, dropping DB tables, killing shared processes.
- Bypassing hooks (`--no-verify`), bypassing signing, bypassing checks.
- Modifying CI/CD pipelines or shared infrastructure.
- Pushing to remote, creating/closing PRs, posting to Slack/Jira.

A prior approval for action X does **not** authorize action Y, or action X in a new context.

## 5. Interface contracts

1. All cross-package types live in `@journeyman/core`. Never duplicate.
2. `@journeyman/core` imports from no other `@journeyman/*` package.
3. Unimplemented interface methods must `throw new Error("<Class>.<method> not implemented")` — never return `undefined`, never silently succeed.
4. The `coding-cli` ↔ `git-provider` split is sacred: local bash git ops in `coding-cli`, remote REST ops in `git-provider`.

## 6. Security defaults

See [SECURITY.md](SECURITY.md). At minimum:
- Never commit secrets, tokens, or `.env` files.
- Never log secrets, even at debug level.
- All user input crossing a trust boundary must be validated.

## 7. Communication

1. State results, not deliberation. The user reads diffs, not stream-of-consciousness.
2. End-of-turn summary: 1–2 sentences. What changed, what's next.
3. If you hit a blocker, surface it immediately with the exact error and what you tried.

## 8. When rules collide

Priority order:
1. Explicit user instruction in the current conversation.
2. Project files: `CLAUDE.md`, `AGENT.md`, `CONSTITUTION.md`.
3. Topic-specific instruction files linked from [AGENT.md](AGENT.md).
4. Provider defaults.
