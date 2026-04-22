# @journeyman/ticket-provider

Issue tracker providers for Journeyman. Implements `ITicketProvider` from `@journeyman/core` with clients for Jira, GitHub Issues, GitHub Projects, Linear, and Monday.

## Providers

| Provider | ID | Status | Notes |
|---|---|---|---|
| `GitHubIssuesProvider` | `github-issues` | Implemented | REST via `@journeyman/github-api` |
| `GitHubProjectsProvider` | `github-projects` | Implemented | GraphQL ProjectV2 via `@journeyman/github-api` |
| `JiraProvider` | `jira` | Partial | `getTicket`, `listTickets`, `createTicket`, `updateTicket`, `getTicketSchema` via Atlassian MCP |
| `LinearProvider` | `linear` | Stub | Throws `not implemented` |
| `MondayProvider` | `monday` | Stub | Throws `not implemented` |

## GitHubIssuesProvider

Treats GitHub repository issues as tickets. Uses `@journeyman/github-api` for all calls.

**Operations:** `getTicket`, `createTicket`, `updateTicket`, `listTickets`, `addComment`, `updateStatus`, `getTicketSchema`

**Ticket ID format:** `"owner/repo#<issue_number>"` (e.g. `"acme/api#42"`)

**Project ID format:** `"owner/repo"` (e.g. `"acme/api"`)

**Auth:** `token` → `tokenEnv` env var → `GITHUB_ACCESS_TOKEN`

## GitHubProjectsProvider

Treats GitHub Projects V2 items as tickets. Uses GraphQL for all calls.

**Ticket ID format:** `"owner/<project_number>#<item_node_id>"` (e.g. `"acme/42#PVTI_..."`)

**Project ID format:** `"owner/<project_number>"` (e.g. `"acme/42"`)

**Required PAT scopes:** `project`, `read:project`

## JiraProvider

Uses the Claude Agent SDK with the [Atlassian MCP server](https://mcp.atlassian.com). No direct Jira REST calls.

**Environment variables:**

| Variable | Purpose |
|---|---|
| `ATLASSIAN_API_TOKEN` | Atlassian Cloud API token |
| `ANTHROPIC_API_KEY` | Required for the Claude Agent SDK loop |

## Exports

```typescript
import {
  GitHubIssuesProvider,
  GitHubProjectsProvider,
  JiraProvider,
  LinearProvider,
  MondayProvider,
} from "@journeyman/ticket-provider";
import type { ITicketProvider } from "@journeyman/core";
```

## Documentation

- [Providers reference](../../docs/providers.md#ticket-providers) — full config + env var details for all ticket providers
