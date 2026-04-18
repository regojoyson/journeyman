# GitHub Ticket Providers + MCP Server — Design

**Date:** 2026-04-18
**Status:** Draft — awaiting user review
**Scope:** Add two `ITicketProvider` implementations for GitHub (repo-level Issues and Projects V2) plus a standalone MCP server package that exposes them as MCP tools. Rename the shared GitHub PAT env var.

---

## 1. Motivation

`@journeyman/ticket-provider` currently ships a Jira implementation (live) and Linear/Monday stubs. We want first-class GitHub ticket tracking so journeyman can create and track work in GitHub without going through Jira. Two shapes are needed:

- **Repo-level Issues** — the standard GitHub issue tracker on a repo, REST-based, fixed field set, broad adoption.
- **Projects V2** — GitHub's project-management boards, GraphQL-only, with **draft issues** and per-project **custom fields** (Status, Priority, Sprint, etc.). Richer workflow, narrower field API.

Both must implement `ITicketProvider` (from `@journeyman/core`) so they are drop-in replacements for `JiraProvider`.

In addition, we expose both providers over the **Model Context Protocol** via a new `@journeyman/mcp-server` workspace package so any MCP client (Claude Desktop, Claude Code, Cursor, etc.) can drive them as tools.

---

## 2. High-Level Architecture

Three pieces land in this design:

```
packages/ticket-provider/src/providers/
├── github-issues/         ← REST, repo-scoped, implements ITicketProvider
├── github-projects/       ← GraphQL, Projects V2, implements ITicketProvider
│
packages/mcp-server/       ← NEW workspace, stdio MCP server, 10 tools
```

All three read a single shared env var, `GITHUB_ACCESS_TOKEN` (renamed from the existing `GITHUB_PERSONAL_ACCESS_TOKEN`).

### Key design choices

1. **No Claude Agent SDK in either GitHub adapter.** Both talk directly to GitHub over `fetch` (REST for Issues, GraphQL for Projects). Deterministic, zero token cost, no LLM in the loop. This is a deliberate divergence from `JiraProvider` (which uses `query()` + Atlassian's hosted MCP server). Justification: GitHub's ticket APIs are small, well-shaped CRUD surfaces — an LLM layer adds cost and non-determinism for no benefit. The Jira approach remains correct for Jira because Atlassian's API is sprawling and an MCP server already exists.

2. **Provider heterogeneity is acceptable.** The `ITicketProvider` interface is satisfied identically; implementation strategy can differ per vendor. Both Jira and GitHub providers present the same external contract.

3. **Single shared PAT env var.** `GITHUB_ACCESS_TOKEN` is read by `GitHubProvider` (git-provider), `GitHubIssuesProvider`, and `GitHubProjectsProvider`. The PAT must have `repo` + `project` + `read:project` scopes to cover all three providers; each provider documents its own minimum scope requirement in JSDoc.

4. **MCP server is a separate workspace package.** It is an executable (has a `bin`), carries its own dependency on `@modelcontextprotocol/sdk`, and is scoped to grow beyond ticket providers later (git-provider, coding-cli, notification) without touching `ticket-provider`. See §6 for full rationale.

---

## 3. Shared Env Var Rename

Rename `GITHUB_PERSONAL_ACCESS_TOKEN` → `GITHUB_ACCESS_TOKEN`.

**Files touched:**
- `packages/git-provider/src/providers/github/index.ts` (2 occurrences — env read + error message)
- `docs/superpowers/plans/2026-04-18-github-mcp-integration.md` (reference updates, historical doc — update to match so future readers use the right var)
- `docs/superpowers/specs/2026-04-18-github-mcp-integration-design.md` (ditto)

No compatibility shim. If a caller has the old var set, they get a clear "PAT required" error and update the name — one-line fix.

---

## 4. `@journeyman/core` Type Additions

Two **non-breaking** additions to `packages/core/src/types/ticket.types.ts` are required so the GitHub Projects adapter can set fields at create time:

```typescript
export type CreateTicketOptions = SessionOptions & {
  title: string;
  description?: string;
  assignee?: string;
  labels?: string[];
  projectId?: string;
  status?: string;                       // NEW — optional
  customFields?: Record<string, unknown>; // NEW — optional, matches UpdateTicketOptions
};
```

Both fields are optional; existing providers (Jira/Linear/Monday) ignore them until they choose to support them. This keeps `CreateTicketOptions` and `UpdateTicketOptions` symmetric on custom-field support.

---

## 5. GitHub Issues Adapter (REST)

**Path:** `packages/ticket-provider/src/providers/github-issues/`

### 5.1 Layout

```
github-issues/
├── index.ts                   ← GitHubIssuesProvider class
├── operations/
│   ├── create-ticket.ts       ← POST /repos/{owner}/{repo}/issues
│   ├── update-ticket.ts       ← PATCH /repos/{owner}/{repo}/issues/{number}
│   ├── get-ticket.ts          ← GET /repos/{owner}/{repo}/issues/{number}
│   ├── list-tickets.ts        ← GET /repos/{owner}/{repo}/issues?per_page=100&state=all
│   └── get-ticket-schema.ts   ← returns a static schema (no HTTP call)
└── utils/
    └── github-rest.ts         ← fetch wrapper: auth, base URL, error mapping
```

### 5.2 Identity conventions

- **`opts.projectId`** (for `createTicket`, `listTickets`): `"owner/repo"` string (e.g. `"anthropics/journeyman"`). Parsed inside the op; malformed → throw `GitHubIssuesProvider: projectId must be "owner/repo"`.
- **`opts.id`** (for `getTicket`, `updateTicket`): composite `"owner/repo#123"`. Parsed inside the op; malformed → throw `GitHubIssuesProvider: id must be "owner/repo#<number>"`.
- Documented in `GitHubIssuesProvider`'s class-level JSDoc.

### 5.3 Field mapping (`ITicketProvider` → GitHub REST)

| `ITicketProvider` field | GitHub REST field | Notes |
|---|---|---|
| `title` | `title` | |
| `description` | `body` | |
| `assignee` | `assignees: [x]` | Single-assignee mapping; Issues supports multiple assignees natively but our interface exposes one |
| `labels` | `labels` | |
| `status` | `state: "open" \| "closed"` | Lossy: `"closed"` or `"done"` (case-insensitive) → `closed`; anything else → `open`. Documented. |
| `priority`, `issueType`, `customFields` | — | Not supported (repo issues have no such concept). Silently ignored with a `console.warn` the first time seen per process. |

### 5.4 Operation details

- **`createTicket`**: `POST /repos/{o}/{r}/issues` with `{title, body, assignees, labels}`. Returns `{ticket: Ticket}` on 201, maps GitHub's response to the `Ticket` shape.
- **`updateTicket`**: `PATCH /repos/{o}/{r}/issues/{n}` with only the fields the caller provided (no overwriting with `undefined`).
- **`getTicket`**: `GET /repos/{o}/{r}/issues/{n}`. 404 → `{ error: "not found: owner/repo#n" }` (not thrown — matches Jira's soft-fail pattern).
- **`listTickets`**: `GET /repos/{o}/{r}/issues?per_page=100&state=${status ?? "all"}`. **PRs are filtered client-side** (`item.pull_request == null`) — GitHub's issues API returns PRs too, and callers of a ticket provider expect tickets only. **v1 returns one page of up to 100**; pagination is an explicit YAGNI deferral (add a `cursor` to `ListTicketsOptions` when first needed).
- **`getTicketSchema`**: returns a static hardcoded `TicketField[]` describing the fixed GitHub issue fields (`title`, `body`, `assignees`, `labels`, `state`, `milestone`). No HTTP call. Identical schema regardless of `projectId`.

### 5.5 `github-rest.ts` helper

Tiny (~30 LOC). Responsibilities:
- Read `GITHUB_ACCESS_TOKEN` once at module load, fail-fast if missing.
- Attach `Authorization: Bearer …`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: journeyman`.
- `request(method, path, body?)` returns parsed JSON or throws `GitHubRestError(status, message)` with GitHub's error body included.
- `x-ratelimit-remaining` surfaced on error messages for diagnostics; no retry logic (caller decides).

---

## 6. GitHub Projects Adapter (GraphQL, Projects V2)

**Path:** `packages/ticket-provider/src/providers/github-projects/`

### 6.1 Layout

```
github-projects/
├── index.ts                   ← GitHubProjectsProvider class
├── operations/
│   ├── create-ticket.ts       ← addProjectV2DraftIssue + optional field updates
│   ├── update-ticket.ts       ← updateProjectV2DraftIssue + updateProjectV2ItemFieldValue
│   ├── get-ticket.ts          ← node(id) query
│   ├── list-tickets.ts        ← projectV2.items query
│   └── get-ticket-schema.ts   ← introspects project's fields live
└── utils/
    ├── github-graphql.ts      ← fetch wrapper: POST api.github.com/graphql
    ├── field-resolver.ts      ← name→fieldID + option-name→optionID resolver, cached per projectId
    └── user-resolver.ts       ← login→userNodeID resolver, cached per login
```

### 6.2 Identity conventions

- **`opts.projectId`**: the project's GraphQL node ID (e.g. `PVT_kwDOA…`). Caller looks this up once (out of scope). Rationale: resolving from `(orgLogin, projectNumber)` requires extra state and queries; the node ID is the canonical reference.
- **`opts.id`** (for `getTicket`, `updateTicket`): the **project item's** GraphQL node ID (e.g. `PVTI_…`) — the item wrapper around the draft issue. This is what `listTickets` returns as `ticket.id`.
- `ticket.url` is `null` for draft issues (they have no permalink).

### 6.3 Custom fields — the core feature

`CreateTicketOptions.customFields` and `UpdateTicketOptions.customFields` accept a `Record<string, unknown>` keyed by **field name** (human-readable, e.g. `{ Status: "In Progress", Priority: "P1", "Target Date": "2026-05-01", Sprint: "Sprint 42" }`). The adapter resolves names → IDs internally via `field-resolver.ts`:

1. **Introspection query** (fired lazily on first use of a given `projectId`):
   ```graphql
   query($id: ID!) {
     node(id: $id) {
       ... on ProjectV2 {
         fields(first: 50) {
           nodes {
             __typename
             ... on ProjectV2Field { id name dataType }
             ... on ProjectV2SingleSelectField {
               id name dataType options { id name }
             }
             ... on ProjectV2IterationField {
               id name dataType configuration {
                 iterations { id title startDate }
                 completedIterations { id title startDate }
               }
             }
           }
         }
       }
     }
   }
   ```
2. **Cached** on the `GitHubProjectsProvider` instance keyed by `projectId` for the lifetime of the instance. Cache is not invalidated automatically — field definitions rarely change, and the trade-off favors fewer queries. Callers who need fresh metadata instantiate a new provider.
3. **Value shape selection** per field `dataType` when calling `updateProjectV2ItemFieldValue`:
   | `dataType` | Value shape | Caller provides |
   |---|---|---|
   | `TEXT` | `{ text: string }` | string |
   | `NUMBER` | `{ number: number }` | number |
   | `DATE` | `{ date: "YYYY-MM-DD" }` | Date or ISO string (normalized) |
   | `SINGLE_SELECT` | `{ singleSelectOptionId: string }` | option name → looked up against cached options |
   | `ITERATION` | `{ iterationId: string }` | iteration title → looked up |
4. **Error behavior:**
   - Unknown field name → `Error("GitHubProjectsProvider: field 'Foo' not found on project. Known fields: Status, Priority, …")`.
   - Unknown option on a single-select → `Error("GitHubProjectsProvider: option 'Urgent' not found on field 'Priority'. Options: P0, P1, P2, P3")`.
   - Type mismatch (e.g. string given for a NUMBER field) → `Error("GitHubProjectsProvider: field 'X' expects NUMBER, got string")`.

### 6.4 `status` and `labels` sugar

Because `ITicketProvider` already has top-level `status` and `labels`, the adapter treats them as sugar for `customFields`:

- `opts.status` → merged into `customFields` as `{ Status: opts.status }` **before** the field resolver runs. If the project has no "Status" field, throws the standard "field not found" error with a clear message. (Projects always create one by default, but users can delete it.)
- `opts.labels` → merged into `customFields` as `{ Labels: opts.labels }` **if and only if** the project has a field named "Labels" (case-insensitive). Otherwise silently dropped with a `console.warn` the first time. Rationale: Projects V2 has no native label concept on draft issues, but teams commonly create a custom "Labels" multi-select field.

Explicit `customFields` takes precedence over sugar if both are passed (e.g. `{ status: "Done", customFields: { Status: "In Review" } }` → "In Review" wins). Documented in JSDoc.

### 6.5 Assignees — login → node ID resolution

`addProjectV2DraftIssue` takes `assigneeIds: [ID!]` (user **node IDs**). The caller passes `opts.assignee` as a GitHub **login** (e.g. `"octocat"`). The adapter resolves via `user-resolver.ts`:

```graphql
query($login: String!) { user(login: $login) { id } }
```

Cached per-login on the provider instance. Unknown login → throw with the login name echoed.

### 6.6 Operation details

- **`createTicket`**:
  1. `addProjectV2DraftIssue(projectId, title, body, assigneeIds)` → returns `projectItem { id, content { ... on DraftIssue { id } } }`.
  2. For each entry in merged `customFields`: one `updateProjectV2ItemFieldValue` mutation. Sequential (not parallel) — order is preserved and GitHub rate limits on GraphQL are per-request-cost, not connection-count. Sequential is simpler and adequate for the ticket-creation use case.
  3. Final `node(itemId)` query to return the fully-hydrated `Ticket` (consistent with Jira's behavior).

- **`updateTicket`**:
  1. If any of `title`/`description` provided: `updateProjectV2DraftIssue(draftIssueId, …)`. (The draft issue ID is resolved from the item ID by a `node(itemId){ content{...on DraftIssue{id}} }` query — cached per item ID on the provider instance.)
  2. For each entry in merged `customFields`: one `updateProjectV2ItemFieldValue` mutation.
  3. Final `node(itemId)` query for the response.

- **`getTicket`**: single `node(itemId)` query returning title, body, assignees (as logins), and `fieldValues(first: 50)` which we flatten into `ticket.customFields: Record<string, unknown>`. Special single-select / iteration / date / number / text handling reverses §6.3's mapping.

- **`listTickets`**: `node(projectId) { ... on ProjectV2 { items(first: 100) { nodes { … } pageInfo { hasNextPage endCursor } } } }`. v1 returns one page of up to 100; pagination deferred to `ListTicketsOptions.cursor` on first real need. `opts.status` / `opts.assignee` filters applied **client-side** (GraphQL has no native filter for project items). Documented as O(n) in page size.

- **`getTicketSchema`**: returns the live field list as `TicketField[]` — this is the whole reason `getTicketSchema` exists on the interface. Each field contributes a `TicketField` with `id` (GraphQL field ID), `name`, `type` (mapped from `dataType`), and `allowedValues` populated for single-select fields.

### 6.7 `github-graphql.ts` helper

Tiny (~25 LOC). Responsibilities:
- Read `GITHUB_ACCESS_TOKEN`, fail-fast if missing.
- `gql<T>(query: string, variables: Record<string, unknown>): Promise<T>` — POSTs to `https://api.github.com/graphql`, returns `data`, throws on HTTP error OR on non-empty `errors` array (with first error's `message` + `path`).
- Same `User-Agent: journeyman` header.

---

## 7. `@journeyman/mcp-server` (New Workspace Package)

**Path:** `packages/mcp-server/`

### 7.1 Rationale for separate package

1. **Different artifact type** — MCP server is an executable (`bin`), not a library.
2. **Different dependencies** — `@modelcontextprotocol/sdk` shouldn't bleed into `ticket-provider` consumers.
3. **Different concern** — "how to CRUD a ticket" vs. "how to expose capabilities over MCP."
4. **Independent versioning** — MCP protocol evolution shouldn't force ticket-provider releases.
5. **Growth room** — α scope today (GitHub ticket providers only); β (all ticket providers) and γ (git-provider + coding-cli + notification) possible later without touching `ticket-provider`.

### 7.2 Scope (v1 = α)

Wraps only `GitHubIssuesProvider` and `GitHubProjectsProvider`. **10 tools** total, one per `ITicketProvider` method per adapter.

| Tool name | Wraps |
|---|---|
| `gh_issues_create_ticket` | `GitHubIssuesProvider.createTicket` |
| `gh_issues_update_ticket` | `.updateTicket` |
| `gh_issues_get_ticket` | `.getTicket` |
| `gh_issues_list_tickets` | `.listTickets` |
| `gh_issues_get_schema` | `.getTicketSchema` |
| `gh_projects_create_ticket` | `GitHubProjectsProvider.createTicket` |
| `gh_projects_update_ticket` | `.updateTicket` |
| `gh_projects_get_ticket` | `.getTicket` |
| `gh_projects_list_tickets` | `.listTickets` |
| `gh_projects_get_schema` | `.getTicketSchema` |

### 7.3 Layout

```
packages/mcp-server/
├── package.json                ← "bin": { "journeyman-mcp": "./dist/cli.js" }, type: "module"
├── tsconfig.json
├── README.md                   ← install/config instructions
└── src/
    ├── cli.ts                  ← stdio entrypoint
    ├── server.ts               ← buildServer(providers) — injectable providers
    └── tools/
        ├── github-issues.ts    ← 5 tool registrations
        └── github-projects.ts  ← 5 tool registrations
```

### 7.4 Transport

**Stdio only.** Matches what Claude Desktop / Claude Code / Cursor launch natively. HTTP transport is an explicit YAGNI deferral.

### 7.5 Tool schemas

Each tool's input schema is a hand-written zod schema mirroring the corresponding option type from `@journeyman/core`. Not code-generated — option types are small and stable, code-gen is disproportionate.

Tool handler shape (same for all 10):
```typescript
async handler(input) {
  const parsed = schema.parse(input);
  try {
    const result = await provider.someMethod(parsed);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return { isError: true, content: [{ type: "text", text: (err as Error).message }] };
  }
}
```

### 7.6 CLI entrypoint

`src/cli.ts` is ~15 LOC:
1. Verifies `GITHUB_ACCESS_TOKEN` is set (fail-fast with a clear message before the MCP handshake).
2. Instantiates both providers.
3. Calls `buildServer({ issues, projects })` from `server.ts`.
4. Connects a `StdioServerTransport`.

### 7.7 Client install (documented in package README)

```jsonc
{
  "mcpServers": {
    "journeyman": {
      "command": "npx",
      "args": ["-y", "@journeyman/mcp-server"],
      "env": { "GITHUB_ACCESS_TOKEN": "ghp_..." }
    }
  }
}
```

### 7.8 Non-goals (v1)

- No HTTP transport.
- No tools for git-provider / coding-cli / notification-provider.
- No OAuth or per-request token override.
- No client-side permission UX (delegated to the MCP client).

---

## 8. Error Handling & Observability

- Both adapters: errors thrown with `GitHubIssuesProvider:` / `GitHubProjectsProvider:` prefixes for easy filtering.
- "Soft" errors (404s on `getTicket`, malformed IDs on read paths) returned as `{ error: string }` on the result — matches `JiraProvider`'s soft-fail pattern.
- "Hard" errors (malformed `projectId`, auth failure, unknown custom field) thrown — matches stub pattern from CLAUDE.md.
- No logging framework added. `console.warn` for the handful of "silently dropped field" cases (each warns once per process, tracked via a `Set<string>`).
- No retries. Rate-limit info surfaced in error messages via `x-ratelimit-remaining`.

---

## 9. Testing Strategy

### 9.1 Adapter smoke tests (manual, per existing repo style)

Each operation file exports a runnable `main()` block (matching the `clone-repos.ts` and Jira operation pattern) invokable via `npx tsx`:

```
GITHUB_ACCESS_TOKEN=<pat> npx tsx packages/ticket-provider/src/providers/github-issues/operations/create-ticket.ts
```

Hardcoded test inputs inside `main()` point at a dedicated test repo / test project (documented in the package README — caller substitutes their own).

### 9.2 MCP server tests

- **Unit:** inject mock providers into `buildServer()`, assert: (a) all 10 tools register, (b) each tool's handler forwards parsed input to the right provider method, (c) errors surface as `isError: true`.
- **Smoke:** feed a `{"jsonrpc":"2.0","method":"tools/list"}` + one `tools/call` request to `cli.ts` over stdio; assert the response envelope.

### 9.3 Out of scope for v1

- No CI wiring (the monorepo doesn't have a test runner configured per current state).
- No contract test enforcing parity with `JiraProvider` — could be added later as a shared test suite in `@journeyman/core`.

---

## 10. Implementation Status After This Design Lands

| Feature | Status after this work |
|---|---|
| `GitHubIssuesProvider.createTicket` | Implemented |
| `GitHubIssuesProvider.updateTicket` | Implemented |
| `GitHubIssuesProvider.getTicket` | Implemented |
| `GitHubIssuesProvider.listTickets` | Implemented (single page) |
| `GitHubIssuesProvider.getTicketSchema` | Implemented (static) |
| `GitHubProjectsProvider.createTicket` | Implemented (draft issues, full custom fields) |
| `GitHubProjectsProvider.updateTicket` | Implemented |
| `GitHubProjectsProvider.getTicket` | Implemented |
| `GitHubProjectsProvider.listTickets` | Implemented (single page, client-side filter) |
| `GitHubProjectsProvider.getTicketSchema` | Implemented (live introspection) |
| `@journeyman/mcp-server` (α scope, stdio) | Implemented |

---

## 11. Explicit YAGNI / Deferred Items

- Pagination beyond 100 items in `listTickets` (both adapters).
- Real-issue-in-project mode for `github-projects` (currently draft-only).
- HTTP transport for the MCP server.
- MCP tools for git-provider, coding-cli, notification-provider (β/γ expansion).
- OAuth / per-request tokens.
- Auto-retry / back-off on GitHub rate limits.
- Cross-provider contract test suite.
- Backwards-compat shim for the old `GITHUB_PERSONAL_ACCESS_TOKEN` env var name.

Each deferral is a simple additive change when it matters — none require redesign.
