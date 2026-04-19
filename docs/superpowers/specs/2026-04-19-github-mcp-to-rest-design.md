# GitHub MCP → REST/GraphQL Migration — Design

**Date:** 2026-04-19
**Status:** Draft
**Scope:** Replace the MCP-based `@journeyman/github-mcp` client with a direct Octokit-based client that talks to the GitHub REST v3 and GraphQL v4 APIs.

## Motivation

Today `@journeyman/github-mcp` wraps the hosted `api.githubcopilot.com/mcp/` endpoint via `@modelcontextprotocol/sdk`. Every consumer in `git-provider/github` and `ticket-provider/github-*` invokes GitHub operations as MCP tool calls.

This adds an MCP transport layer for what are, at the provider level, deterministic programmatic API calls — no LLM is in the loop. Dropping the MCP hop and calling GitHub directly means:

- Fewer moving parts (no Copilot-gated MCP endpoint, no JSON-text-to-object unpacking).
- Typed responses from Octokit's OpenAPI-generated types instead of `JSON.parse` casts.
- Standard rate-limit and retry behavior via Octokit plugins.
- One less runtime dependency shape to reason about.

## Non-goals

- No new GitHub operations are added.
- No changes to provider interfaces in `@journeyman/core`.
- No Octokit App auth or OAuth flows. Token-based auth only, same as today.
- `coding-cli` operations that use the Claude Agent SDK are not touched. They continue shelling to `gh` / bash.

## Current state

```
packages/github-mcp/           @modelcontextprotocol/sdk + StreamableHTTPClientTransport
  src/index.ts                 connectGitHubMcp(), callTool(), re-export Client
```

Consumers:

- `packages/git-provider/src/providers/github/` — `get_repository`, `create_pull_request`, `list_pull_requests`.
- `packages/ticket-provider/src/providers/github-issues/` — `issue_read`, `issue_write`, `list_issues`.
- `packages/ticket-provider/src/providers/github-projects/` — `projects_get`, `projects_write`, `projects_list`.

Each provider class calls `connectGitHubMcp({ token, clientName })` in `connect()` and stores a `Client`. Operation files call `callTool(client, name, args)` and cast the parsed JSON to a domain type.

## Design

### 1. Package rename and shape

Rename `packages/github-mcp` → `packages/github-api`. The package name `@journeyman/github-mcp` becomes `@journeyman/github-api`. All workspace references update in one commit.

Dependencies after migration:

- Added: `@octokit/rest`, `@octokit/graphql`, `@octokit/plugin-retry`, `@octokit/plugin-throttling`.
- Removed: `@modelcontextprotocol/sdk`.

Public API:

```ts
// packages/github-api/src/index.ts
import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";

export interface GitHubClient {
  rest: Octokit;
  graphql: typeof graphql;
}

export interface CreateGitHubClientOptions {
  token: string;
  userAgent?: string;
}

export function createGitHubClient(opts: CreateGitHubClientOptions): GitHubClient;
```

No per-endpoint wrappers are exported. Octokit is already typed and idiomatic; consumers call `client.rest.issues.get(...)` directly.

### 2. Octokit configuration

```ts
const RestWithPlugins = Octokit.plugin(retry, throttling);

const rest = new RestWithPlugins({
  auth: opts.token,
  userAgent: opts.userAgent ?? "journeyman/0.1.0",
  throttle: {
    onRateLimit: (retryAfter, options, _octokit, retryCount) =>
      retryCount < 3,
    onSecondaryRateLimit: (retryAfter, options) => true,
  },
  retry: { doNotRetry: ["400", "401", "403", "404", "422"] },
});

const gql = graphql.defaults({
  headers: { authorization: `token ${opts.token}` },
});

return { rest, graphql: gql };
```

Retry defaults skip 4xx client errors so we don't retry authorization or validation failures. Throttling allows up to three automatic retries on primary/secondary rate limits.

### 3. Operation rewrite map

| Current `callTool(name, args)` | Replacement |
|---|---|
| `get_repository` | `rest.repos.get({ owner, repo })` |
| `create_pull_request` | `rest.pulls.create({ owner, repo, title, head, base, body })` |
| `list_pull_requests` | `rest.pulls.list({ owner, repo, state, per_page })` |
| `issue_read` | `rest.issues.get({ owner, repo, issue_number })` |
| `issue_write` (create) | `rest.issues.create({ owner, repo, title, body, labels, assignees })` |
| `issue_write` (update) | `rest.issues.update({ owner, repo, issue_number, ... })` |
| `issue_write` (comment) | `rest.issues.createComment({ owner, repo, issue_number, body })` |
| `list_issues` | `rest.issues.listForRepo({ owner, repo, state, labels, per_page })` |
| `projects_get` (fields) | `graphql` query on `node(id) { ... on ProjectV2 { fields(first: 100) { nodes } } }` |
| `projects_get` (item) | `graphql` query on `ProjectV2Item` by id |
| `projects_list` | `graphql` query on `ProjectV2 { items(first: N) { nodes } }` |
| `projects_write` | `graphql` mutations: `addProjectV2ItemById`, `updateProjectV2ItemFieldValue`, `deleteProjectV2Item` |

Each operation file under `git-provider/src/providers/github/operations/` and `ticket-provider/src/providers/github-*/operations/` is rewritten. Function signatures and return types stay the same — the changes are isolated to the body of each operation.

### 4. Provider class changes

`GitHubProvider.connect()`, `GitHubIssuesProvider.connect()`, and `GitHubProjectsProvider.connect()` currently await `connectGitHubMcp({ token, clientName })`. After migration they call the synchronous `createGitHubClient({ token, userAgent })`. `connect()` remains `async` (interface compatibility) but performs no network I/O — it just constructs the client and stores it.

No changes to `@journeyman/core` interfaces.

### 5. Response mapping

Current code: `JSON.parse(text)` → cast to `GitHubRepoPayload` / `GitHubPR` / `GitHubIssue` / `ProjectItem` / `ProjectFieldPayload`.

New code: `response.data` is typed by Octokit. Each operation file maps Octokit's response shape into the existing domain type so callers don't change. Field names match in most cases; differences are handled inline per operation.

### 6. GraphQL queries for Projects v2

New module `packages/github-api/src/graphql/projects.ts` holds named query/mutation strings so operation files stay clean:

```ts
export const GET_PROJECT_FIELDS = /* graphql */ `query($id: ID!) { ... }`;
export const GET_PROJECT_ITEM = /* graphql */ `query($id: ID!) { ... }`;
export const LIST_PROJECT_ITEMS = /* graphql */ `query($id: ID!, $first: Int!) { ... }`;
export const ADD_PROJECT_ITEM = /* graphql */ `mutation(...) { ... }`;
export const UPDATE_PROJECT_FIELD = /* graphql */ `mutation(...) { ... }`;
export const DELETE_PROJECT_ITEM = /* graphql */ `mutation(...) { ... }`;
```

### 7. Error handling

Octokit throws `RequestError` with `status` and `response.data`. Each operation catches and rethrows as:

```ts
throw new Error(`GitHub ${endpoint} failed: ${err.status} ${err.message}`);
```

This preserves the current error-shape contract (`Error` with a descriptive message) so provider callers don't change.

### 8. Migration strategy

Single PR. The `@journeyman/github-mcp` package is deleted in the same change — not kept as a shim — since all consumers are inside the monorepo and get updated atomically. `package-lock.json` regenerated.

Order of work inside the PR:

1. Create `packages/github-api` with `createGitHubClient` + `graphql/projects.ts`.
2. Rewrite `git-provider/github` operations and provider class.
3. Rewrite `ticket-provider/github-issues` operations and provider class.
4. Rewrite `ticket-provider/github-projects` operations and provider class.
5. Delete `packages/github-mcp`.
6. `npm run typecheck` across the workspace.

### 9. Testing

No existing unit-test infrastructure in the repo for these packages, so verification is typecheck + manual run-once against a real GitHub token for one op per provider:

- `get_repository` on a known repo.
- `create_pull_request` → `list_pull_requests` round-trip on a scratch branch.
- `issue_read` on a known issue.
- `projects_list` on a known Project v2.

If existing integration harnesses surface during implementation, wire the new client in.

## Risks and open questions

- **Projects v2 field-value shapes.** GraphQL returns a union of value types (text, number, date, single-select, iteration). The current MCP response may have already flattened these. Mapping needs to be verified against the existing `ProjectItem` type during implementation.
- **Pagination defaults.** Octokit's `list*` methods default to 30 per page. The current MCP tools may return more or fewer. We default to `per_page: 100` for list operations to match likely existing behavior; revisit if call sites depend on a specific cap.
- **`userAgent` value.** GitHub requires a user agent on all requests. We default to `"journeyman/0.1.0"`; no secrets leak.

## Out of scope for this change

- Octokit App authentication.
- OAuth device-flow token acquisition.
- Webhook handling.
- Caching / ETag revalidation.
- Pagination helpers beyond Octokit's built-in `paginate` (not used in current operations).
