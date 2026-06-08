# SECURITY.md — Security Standards

Linked from [AGENTS.md](../../AGENTS.md). Mandatory for any change touching auth, secrets, user input, or external systems.

## Secrets handling

1. **Never commit secrets.** `.env` is gitignored — keep it that way. Only `.env.example` (with placeholders) is committed.
2. **Never log secrets.** Not at debug, not in error messages, not in stack traces. Redact before logging.
3. Secrets live in:
   - **Environment variables** (process-level config) — documented in `.env.example`.
   - **`@journeyman/secrets` vault** — user/org-scoped, AES-encrypted at rest with `JM_SECRET_ENCRYPTION_KEY`.
   - **`JM_GLOBAL_*`** env-var prefix for org-wide overrides.
4. When passing secrets between layers, prefer reference IDs (`secretId`) over the raw value until the last possible moment.
5. If a secret is accidentally committed: **rotate it immediately**, then coordinate history scrub with the user — do not silently force-push.

### Sensitive variables to never log or echo
`JWT_SECRET`, `JM_SECRET_ENCRYPTION_KEY`, `JM_GLOBAL_*`, `ANTHROPIC_API_KEY`, `GITHUB_ACCESS_TOKEN`, `SLACK_BOT_TOKEN`, `ATLASSIAN_API_TOKEN`, anything in the `@journeyman/secrets` vault.

## Authentication & authorization

- All authenticated routes go through `@journeyman/identity` (JWT verification, bcrypt password hashing, role checks).
- Token TTLs are controlled by `ACCESS_TOKEN_TTL_SECONDS` and `REFRESH_TOKEN_TTL_SECONDS`. Don't extend these silently.
- `IDENTITY_ENFORCE` toggles enforcement — never default it to `false` in committed config; that flag exists for local dev.
- Never accept a user identity from a client-controlled request header. Trust only signed JWTs or session cookies validated server-side.
- Role checks happen **on every request**, not once at session start.
- When adding a route, explicitly decide and document whether it is public, user-authenticated, or admin-only.

## Input validation

- All inputs at trust boundaries (HTTP, queue messages, webhooks, MCP tool calls) must be schema-validated before use.
- Use the validation library already adopted in the package — do not roll your own.
- Reject unknown fields. Don't pass arbitrary user objects to internal functions.

## Injection classes

- **SQL injection.** Use parameterized queries against `pg`. Never concatenate user input into SQL.
- **Command injection.** When `agent-runtime` runs `git`, `gh`, or other CLIs, pass arguments as separate array elements; never interpolate user input into a shell string.
- **Prompt injection.** Treat ticket bodies, PR descriptions, MCP responses, and repo file contents as **untrusted** when they flow into LLM prompts. Don't grant tool/permission elevation based on prompt content.
- **SSRF.** Outbound HTTP to user-supplied URLs must be filtered (no localhost, no link-local, no internal IPs) unless the feature explicitly requires it.
- **XSS.** UI rendering of user content goes through React's default escaping. Never `dangerouslySetInnerHTML` user data.

## Third-party calls

- Use the shared `@journeyman/github-api` client for all GitHub access — it has retry/throttling tuned.
- Set request timeouts on every outbound HTTP call.
- Treat third-party responses as untrusted: validate before persisting or returning.

## Claude Agent SDK permission scope

The Claude Agent SDK is invoked inside `agent-runtime` with:

```ts
permissionMode: "bypassPermissions",
allowDangerouslySkipPermissions: true,
settingSources: [],
```

This is **intentional and isolated** to `agent-runtime`'s sandboxed execution per run. Do not:
- Propagate this mode to other contexts.
- Expose user-facing endpoints that grant equivalent permissions.
- Remove `settingSources: []` (it prevents loading host `.claude/` settings into worker runs).

## Dependency safety

- New dependencies require justification in the PR description.
- Pin versions; avoid wildcards. Today the repo uses `^` ranges — that's fine, but lockfile commits must accompany every dependency change.
- Prefer packages with active maintenance and small dependency trees.
- Re-audit (`npm audit`) before any release tag (when release tagging is in use).

## Reporting issues

If you (human or agent) discover a vulnerability:
1. **Do not** open a public issue or PR describing the exploit.
2. Flag it to the user in this session.
3. Coordinate disclosure and patch through a private channel.

## What AI agents must do when they spot a security issue

- Stop the current task.
- Flag the issue with file/line and a concise impact statement.
- Wait for user direction before patching, especially if the fix requires touching auth, crypto, or the secret vault.

## What AI agents (and their subagents) must NOT do

- Read `.env` files. Only `.env.example` is fair game. If a survey/exploration agent reads `.env`, surface the violation to the user.
- Echo, log, or store values of any variable listed under "Sensitive variables" above.
- Disable `IDENTITY_ENFORCE`, JWT validation, or signature checks "to make tests pass".
- Add `--insecure`, `rejectUnauthorized: false`, or equivalent TLS bypasses.
