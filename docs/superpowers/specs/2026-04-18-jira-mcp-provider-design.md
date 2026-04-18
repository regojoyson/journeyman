# Jira MCP Provider Design

**Date:** 2026-04-18
**Package:** `@journeyman/ticket-provider`
**Scope:** Implement `JiraProvider` using the Claude Agent SDK `query()` with the Atlassian HTTP MCP server.

---

## Overview

`JiraProvider` implements the existing `ITicketProvider` interface from `@journeyman/core` by delegating all four methods to Claude Agent SDK `query()` calls. Each call configures the Atlassian HTTP MCP server (`https://mcp.atlassian.com/v1/mcp`) so the underlying Claude agent can call Jira MCP tools (`createJiraIssue`, `getJiraIssue`, `editJiraIssue`, `searchJiraIssuesUsingJql`, etc.) on behalf of the caller. Results are returned as structured JSON via `json_schema` output format.

No Jira REST API calls are made directly — all Jira interaction goes through the MCP server.

---

## File Structure

```
packages/ticket-provider/src/providers/jira/
├── index.ts                  ← JiraProvider class — delegates to operation functions
├── operations/
│   ├── create-ticket.ts      ← createTicket() implementation
│   ├── update-ticket.ts      ← updateTicket() implementation
│   ├── get-ticket.ts         ← getTicket() implementation
│   └── list-tickets.ts       ← listTickets() implementation
└── utils/
    └── mcp-config.ts         ← buildMcpConfig() — reads env var, returns McpHttpServerConfig
```

Mirrors the `coding-cli` layout (`ClaudeProvider` + `operations/` + `utils/`).

---

## Auth & Environment

Single required env var:

```
ATLASSIAN_API_TOKEN=<bearer-token>
```

`buildMcpConfig()` in `utils/mcp-config.ts` reads this at call time and returns:

```typescript
{
  type: 'http',
  url: 'https://mcp.atlassian.com/v1/mcp',
  headers: { Authorization: `Bearer ${process.env.ATLASSIAN_API_TOKEN}` },
}
```

Throws `Error("ATLASSIAN_API_TOKEN env var is required")` if the variable is missing. No credentials are stored on the class instance.

---

## JiraProvider Class

`index.ts` is a thin coordinator — no logic, only delegation:

```typescript
export class JiraProvider implements ITicketProvider {
  createTicket(opts) { return createTicket(opts); }
  updateTicket(opts) { return updateTicket(opts); }
  getTicket(opts)    { return getTicket(opts); }
  listTickets(opts)  { return listTickets(opts); }
}
```

---

## Per-Operation Pattern

Every operation file follows this structure (shown for `createTicket`):

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { buildMcpConfig } from "../utils/mcp-config.ts";
import type { CreateTicketOptions, CreateTicketResult } from "@journeyman/core";

const OUTPUT_SCHEMA = { /* matches CreateTicketResult */ };

function buildPrompt(opts: CreateTicketOptions): string { /* ... */ }

export async function createTicket(opts: CreateTicketOptions): Promise<CreateTicketResult> {
  for await (const msg of query({
    prompt: buildPrompt(opts),
    options: {
      tools: [],
      allowedTools: [],
      mcpServers: { atlassian: buildMcpConfig() },
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: [],
      outputFormat: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
  })) {
    logSdkMessage(msg);
    if (msg.type === "result") {
      if (msg.subtype === "success") return msg.structured_output as CreateTicketResult;
      throw new Error(msg.result_text);
    }
  }
  return { error: "No result received" };
}
```

Key options:
- `tools: [], allowedTools: []` — no Bash; the MCP server provides all tools
- `settingSources: []` — no filesystem settings loaded (minimal, consistent)
- `outputFormat: json_schema` — structured output parsed from `msg.structured_output`
- `permissionMode: "bypassPermissions"` + `allowDangerouslySkipPermissions: true` — both required layers

---

## Operations Detail

### `createTicket`

Prompt tells Claude to call the Jira MCP create-issue tool with `title`, optional `description`, `assignee`, `labels`, `projectId`. Defaults `issueType` to `"Task"` internally.

Output schema: `{ ticket?: Ticket, error?: string }` matching `CreateTicketResult`.

### `updateTicket`

Prompt tells Claude to call the Jira MCP edit-issue tool using `id` as the issue key. Updates any combination of `title`, `description`, `status`, `assignee`, `labels`.

Output schema: `{ ticket?: Ticket, error?: string }` matching `UpdateTicketResult`.

### `getTicket`

Prompt tells Claude to fetch a single Jira issue by `id` (issue key).

Output schema: `{ ticket?: Ticket, error?: string }` matching `GetTicketResult`.

### `listTickets`

Prompt tells Claude to search Jira issues using JQL built from `projectId`, `status`, `assignee` filter options.

Output schema: `{ tickets: Ticket[], error?: string }` matching `ListTicketsResult`.

---

## Error Handling

- Missing `ATLASSIAN_API_TOKEN` → throws synchronously in `buildMcpConfig()`
- Agent SDK `result` with `subtype !== "success"` → throws `new Error(msg.result_text)`
- No SDK `result` message received → returns `{ error: "No result received" }` (or `{ tickets: [], error: "..." }`)

---

## Logging

Each operation imports `logSdkMessage` from `packages/ticket-provider/src/providers/jira/utils/sdk-logger.ts`. This is a copy of the same utility in `coding-cli/src/providers/claude/utils/sdk-logger.ts` — the two packages are independent workspaces and must not cross-import.

---

## Out of Scope

- Jira-specific fields beyond the `ITicketProvider` interface (`issueType`, `priority`, `sprint`) — default `issueType` to `"Task"`, others ignored
- `GeminiProvider`, `LinearProvider`, `MondayProvider` — remain stubs
- Retry logic, rate limiting, pagination beyond what the MCP server handles
