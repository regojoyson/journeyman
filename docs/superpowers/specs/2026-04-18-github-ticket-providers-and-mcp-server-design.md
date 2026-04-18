# GitHub Ticket Providers — Design (revised)

**Date:** 2026-04-18 (revised same day)
**Status:** Approved
**Scope:** Add two `ITicketProvider` implementations for GitHub — repo-level Issues and Projects V2 — both backed by GitHub's **hosted MCP server** (`https://api.githubcopilot.com/mcp/`), matching the existing pattern used by `@journeyman/git-provider`.

## Revision note

The original draft specified (a) direct REST/GraphQL implementations and (b) a new `@journeyman/mcp-server` workspace package wrapping them. That was scrapped:

- **GitHub already ships an official MCP server** ([github/github-mcp-server](https://github.com/github/github-mcp-server)) covering issues, projects, PRs, and more. Building our own wrapper is redundant.
- **`@journeyman/git-provider` already uses this hosted MCP server** via the MCP SDK's `Client.callTool()` — no LLM in the loop, deterministic, token-free. The ticket adapters should do the same.

Phase 1 changes (env-var rename to `GITHUB_ACCESS_TOKEN`, `status` + `customFields` additions to `CreateTicketOptions`) are kept — they remain correct and useful.

## 1. Motivation

`@journeyman/ticket-provider` needs first-class GitHub support in two shapes:

- **Repo-level Issues** — the standard issue tracker on a repo.
- **Projects V2** — GitHub's project-management boards (draft issues + custom fields).

Both must implement `ITicketProvider` from `@journeyman/core`, drop-in with `JiraProvider`.

## 2. Architecture

```
packages/ticket-provider/src/providers/
├── _shared/
│   └── github-mcp-client.ts   ← NEW — shared MCP client (copy of git-provider's mcp-client.ts)
├── github-issues/             ← NEW — uses issue_read / issue_write / list_issues tools
└── github-projects/           ← NEW — uses projects_get / projects_list / projects_write tools
```

### 2.1 Transport

Both adapters connect to `https://api.githubcopilot.com/mcp/` via `StreamableHTTPClientTransport` with `Authorization: Bearer ${GITHUB_ACCESS_TOKEN}`. They call tools via `client.callTool()` — **no `query()`, no Claude Agent SDK, no LLM** — deterministic calls with JSON payloads.

### 2.2 Why a copy (not an import) of `mcp-client.ts`?

`@journeyman/ticket-provider` cannot depend on `@journeyman/git-provider` without creating a cross-layer coupling. The helper is ~30 LOC. Copying is the pragmatic monorepo hygiene choice — matches how `jira/` / `linear/` / `monday/` each maintain their own transport utilities.

### 2.3 Env var

Both adapters read `GITHUB_ACCESS_TOKEN` (renamed in Phase 1). PAT needs `repo`, `project`, `read:project` scopes to cover the full tool surface. `GitHubProvider` in `git-provider` reads the same var.

## 3. GitHub Issues Adapter

**Tools used:** `issue_read`, `issue_write`, `list_issues`.

**`projectId`** = `"owner/repo"` (parsed to `{ owner, repo }`).
**`id`** = `"owner/repo#<number>"` (parsed to `{ owner, repo, issue_number }`).

| `ITicketProvider` method | MCP tool | Args |
|---|---|---|
| `createTicket` | `issue_write` | `method: "create"`, `owner`, `repo`, `title`, `body`, `assignees`, `labels` |
| `updateTicket` | `issue_write` | `method: "update"`, `owner`, `repo`, `issue_number`, optional `title` / `body` / `assignees` / `labels` / `state` |
| `getTicket` | `issue_read` | `method: "get"`, `owner`, `repo`, `issue_number` |
| `listTickets` | `list_issues` | `owner`, `repo`, optional `state` / `labels` |
| `getTicketSchema` | — | Static — GitHub repo issues have a fixed field set. Hardcoded `TicketField[]` constant. |

**Status mapping:** `ITicketProvider.status` is open/closed only — values `"closed"` or `"done"` (case-insensitive) map to `state: "closed"`, anything else to `state: "open"`.

**Silently ignored:** `priority`, `issueType`, `customFields` (no equivalent in repo issues — documented in provider JSDoc).

**PRs filtered:** `list_issues` may return PRs (GitHub's API conflates them); results are filtered client-side (`item.pull_request == null`).

## 4. GitHub Projects Adapter

**Tools used:** `projects_get`, `projects_list`, `projects_write`.

**`projectId`** = `"owner/project_number"` (e.g. `"anthropics/42"`). GitHub's MCP tools take `owner` + `project_number` — much nicer than node IDs. Parsed to `{ owner, project_number }`.

**`id`** = the project item's ID as returned by `projects_list` / `projects_write` (typically a numeric string). Passed back to `projects_get` / `projects_write` via `item_id`.

| `ITicketProvider` method | MCP tool | Notes |
|---|---|---|
| `createTicket` | `projects_write` with `method: "create_item"` (or equivalent create-draft sub-method) | Creates a draft item. Body, status, start_date, target_date supported directly. |
| `updateTicket` | `projects_write` with a sub-method covering field updates | Title/body + status/start_date/target_date as direct params. Arbitrary custom fields via `updated_field`. |
| `getTicket` | `projects_get` with a `get_item` sub-method | Returns item details incl. custom-field values. |
| `listTickets` | `projects_list` with an items sub-method | Client-side filter for `status` / `assignee`. Single page (`per_page=100`). |
| `getTicketSchema` | `projects_get` with a `list_fields` (or similar) sub-method | Returns live custom-field metadata. |

**Sub-method discovery:** The tool surface for `projects_*` is umbrella-style — a single tool with a `method` discriminator. Exact sub-method names and field shapes are not fully documented in github-mcp-server's README and should be **verified at implementation time** via `client.listTools()` introspection and/or calling with a probable method to read the server's error response. Implementation plan Task instructions call this out explicitly.

**Custom fields:** `projects_write`'s `updated_field` parameter handles generic field updates. Passed through from `opts.customFields` as a pass-through. `opts.status` is sugar for setting the Status field via the same mechanism.

**Labels:** Projects V2 has no native label concept on drafts. `opts.labels` is silently dropped with a warning (documented).

## 5. `@journeyman/core` Type Additions (Phase 1 — already shipped)

Non-breaking additions to `CreateTicketOptions`:
- `status?: string`
- `customFields?: Record<string, unknown>`

Existing providers ignore them unless they choose to support them.

## 6. Error Handling

- Hard-throw on misconfig (missing PAT, malformed `projectId`, unknown method).
- Soft-fail on read-path not-found (`{ error: "not found: ..." }`).
- MCP errors surfaced with tool name and original message.
- `callTool` already unwraps `{ isError: true }` responses into thrown `Error` — mirrors `git-provider` behavior.

## 7. Testing

- Typecheck is the automated gate (no test runner in the monorepo).
- Manual smoke via `npx tsx -e "..."` one-liners for each provider, using a real PAT + scratch repo/project.
- No contract test suite in this scope.

## 8. MCP Usage for End Users

Users who want to drive GitHub from Claude Desktop / Claude Code / Cursor install the **official** `github/github-mcp-server` directly — **we do not ship our own wrapper**. Example Claude client config:

```jsonc
{
  "mcpServers": {
    "github": {
      "url": "https://api.githubcopilot.com/mcp/",
      "headers": { "Authorization": "Bearer ${GITHUB_ACCESS_TOKEN}" }
    }
  }
}
```

The ticket-provider package is for **programmatic journeyman usage** (from scripts, the coding-cli, etc.), not for exposing tools to a chat client.

## 9. Explicit YAGNI / Deferred

- Pagination beyond 100 items.
- In-house MCP server package (dropped — github-mcp-server covers it).
- OAuth / per-request tokens.
- Auto-retry / back-off.
- Real-repo-issues-added-to-project mode (draft items only for v1; list surfaces all item types on read).
- Back-compat shim for old env var name.

## 10. Implementation Status After This Work

| Feature | After |
|---|---|
| `GitHubIssuesProvider` (all 5 methods) | Implemented via github-mcp-server tools |
| `GitHubProjectsProvider` (all 5 methods) | Implemented via github-mcp-server tools |
| `@journeyman/mcp-server` | **Not built** — use github/github-mcp-server directly |
