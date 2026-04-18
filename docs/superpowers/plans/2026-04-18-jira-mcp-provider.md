# Jira MCP Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all four `ITicketProvider` methods on `JiraProvider` using `query()` from the Claude Agent SDK with the Atlassian HTTP MCP server (`https://mcp.atlassian.com/v1/mcp`).

**Architecture:** Each method delegates to a dedicated operation file that calls `query()` configured with the Atlassian HTTP MCP server. Claude uses MCP tools to interact with Jira and returns structured JSON via `json_schema` output. Auth is read from `ATLASSIAN_API_TOKEN` at call time.

**Tech Stack:** TypeScript (ESM, NodeNext), `@anthropic-ai/claude-agent-sdk` `query()`, Atlassian HTTP MCP server, npm workspaces.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `packages/ticket-provider/package.json` | Add `@anthropic-ai/claude-agent-sdk` dependency |
| Create | `packages/ticket-provider/src/providers/jira/utils/sdk-logger.ts` | Log SDK messages to console |
| Create | `packages/ticket-provider/src/providers/jira/utils/mcp-config.ts` | Read `ATLASSIAN_API_TOKEN`, return `McpHttpServerConfig` |
| Create | `packages/ticket-provider/src/providers/jira/operations/create-ticket.ts` | `createTicket()` operation |
| Create | `packages/ticket-provider/src/providers/jira/operations/update-ticket.ts` | `updateTicket()` operation |
| Create | `packages/ticket-provider/src/providers/jira/operations/get-ticket.ts` | `getTicket()` operation |
| Create | `packages/ticket-provider/src/providers/jira/operations/list-tickets.ts` | `listTickets()` operation |
| Modify | `packages/ticket-provider/src/providers/jira/index.ts` | Wire `JiraProvider` to operation functions |

---

## Task 1: Add SDK dependency to ticket-provider

**Files:**
- Modify: `packages/ticket-provider/package.json`

- [ ] **Step 1: Add `@anthropic-ai/claude-agent-sdk` to dependencies**

Replace the `dependencies` block in `packages/ticket-provider/package.json`:

```json
{
  "name": "@journeyman/ticket-provider",
  "version": "0.1.0",
  "description": "Issue tracker providers — Jira, Linear, Monday",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "files": ["src"],
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "*",
    "@journeyman/core": "*"
  },
  "devDependencies": {
    "@types/node": "^25.6.0",
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 2: Install workspace dependencies**

```bash
npm install
```

Expected: no errors, `@anthropic-ai/claude-agent-sdk` resolved from root workspace.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/package.json package-lock.json
git commit -m "feat(ticket-provider): add claude-agent-sdk dependency"
```

---

## Task 2: Create `sdk-logger.ts` utility

**Files:**
- Create: `packages/ticket-provider/src/providers/jira/utils/sdk-logger.ts`

- [ ] **Step 1: Create the file**

```typescript
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export function logSdkMessage(msg: SDKMessage): void {
  if (msg.type === "assistant") {
    for (const block of msg.message?.content ?? []) {
      if ("text" in block && block.text) {
        console.log("[agent]", block.text);
      } else if ("name" in block) {
        console.log("[tool]", block.name, JSON.stringify((block as any).input ?? {}));
      }
    }
  } else if (msg.type === "user") {
    for (const block of (msg.message?.content as any[]) ?? []) {
      if (block.type === "tool_result") {
        const output = Array.isArray(block.content)
          ? block.content.map((c: any) => c.text).join("")
          : block.content ?? "";
        if (output) console.log("[tool result]", output.trim());
      }
    }
  } else if (msg.type === "result") {
    console.log("[done]", msg.subtype);
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck --workspace=packages/ticket-provider
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/jira/utils/sdk-logger.ts
git commit -m "feat(ticket-provider): add sdk-logger utility"
```

---

## Task 3: Create `mcp-config.ts` utility

**Files:**
- Create: `packages/ticket-provider/src/providers/jira/utils/mcp-config.ts`

- [ ] **Step 1: Create the file**

```typescript
import type { McpHttpServerConfig } from "@anthropic-ai/claude-agent-sdk";

export function buildMcpConfig(): McpHttpServerConfig {
  const token = process.env.ATLASSIAN_API_TOKEN;
  if (!token) throw new Error("ATLASSIAN_API_TOKEN env var is required");
  return {
    type: "http",
    url: "https://mcp.atlassian.com/v1/mcp",
    headers: { Authorization: `Bearer ${token}` },
  };
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck --workspace=packages/ticket-provider
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/jira/utils/mcp-config.ts
git commit -m "feat(ticket-provider): add mcp-config utility for Atlassian HTTP MCP"
```

---

## Task 4: Implement `createTicket`

**Files:**
- Create: `packages/ticket-provider/src/providers/jira/operations/create-ticket.ts`

- [ ] **Step 1: Create the operation file**

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { CreateTicketOptions, CreateTicketResult } from "@journeyman/core";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { buildMcpConfig } from "../utils/mcp-config.ts";

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    ticket: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        status: { type: "string" },
        assignee: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        url: { type: "string" },
      },
      required: ["id", "title"],
    },
    error: { type: "string" },
  },
} as const;

function buildPrompt(opts: CreateTicketOptions): string {
  const parts = [
    "Create a Jira issue with the following details:",
    `Title: ${opts.title}`,
    "Issue type: Task",
  ];
  if (opts.description) parts.push(`Description: ${opts.description}`);
  if (opts.projectId) parts.push(`Project ID or key: ${opts.projectId}`);
  if (opts.assignee) parts.push(`Assignee account ID or email: ${opts.assignee}`);
  if (opts.labels?.length) parts.push(`Labels: ${opts.labels.join(", ")}`);
  parts.push("Return the created issue's id, title, description, status, assignee, labels, and url.");
  return parts.join("\n");
}

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

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck --workspace=packages/ticket-provider
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/jira/operations/create-ticket.ts
git commit -m "feat(ticket-provider): implement JiraProvider.createTicket via MCP"
```

---

## Task 5: Implement `updateTicket`

**Files:**
- Create: `packages/ticket-provider/src/providers/jira/operations/update-ticket.ts`

- [ ] **Step 1: Create the operation file**

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { UpdateTicketOptions, UpdateTicketResult } from "@journeyman/core";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { buildMcpConfig } from "../utils/mcp-config.ts";

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    ticket: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        status: { type: "string" },
        assignee: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        url: { type: "string" },
      },
      required: ["id", "title"],
    },
    error: { type: "string" },
  },
} as const;

function buildPrompt(opts: UpdateTicketOptions): string {
  const parts = [`Update Jira issue with key: ${opts.id}`];
  if (opts.title) parts.push(`New title: ${opts.title}`);
  if (opts.description) parts.push(`New description: ${opts.description}`);
  if (opts.status) parts.push(`New status (transition to): ${opts.status}`);
  if (opts.assignee) parts.push(`New assignee account ID or email: ${opts.assignee}`);
  if (opts.labels?.length) parts.push(`New labels: ${opts.labels.join(", ")}`);
  parts.push("Return the updated issue's id, title, description, status, assignee, labels, and url.");
  return parts.join("\n");
}

export async function updateTicket(opts: UpdateTicketOptions): Promise<UpdateTicketResult> {
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
      if (msg.subtype === "success") return msg.structured_output as UpdateTicketResult;
      throw new Error(msg.result_text);
    }
  }
  return { error: "No result received" };
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck --workspace=packages/ticket-provider
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/jira/operations/update-ticket.ts
git commit -m "feat(ticket-provider): implement JiraProvider.updateTicket via MCP"
```

---

## Task 6: Implement `getTicket`

**Files:**
- Create: `packages/ticket-provider/src/providers/jira/operations/get-ticket.ts`

- [ ] **Step 1: Create the operation file**

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { GetTicketOptions, GetTicketResult } from "@journeyman/core";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { buildMcpConfig } from "../utils/mcp-config.ts";

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    ticket: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        status: { type: "string" },
        assignee: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        url: { type: "string" },
      },
      required: ["id", "title"],
    },
    error: { type: "string" },
  },
} as const;

function buildPrompt(opts: GetTicketOptions): string {
  return [
    `Fetch the Jira issue with key: ${opts.id}`,
    "Return the issue's id, title, description, status, assignee, labels, and url.",
  ].join("\n");
}

export async function getTicket(opts: GetTicketOptions): Promise<GetTicketResult> {
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
      if (msg.subtype === "success") return msg.structured_output as GetTicketResult;
      throw new Error(msg.result_text);
    }
  }
  return { error: "No result received" };
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck --workspace=packages/ticket-provider
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/jira/operations/get-ticket.ts
git commit -m "feat(ticket-provider): implement JiraProvider.getTicket via MCP"
```

---

## Task 7: Implement `listTickets`

**Files:**
- Create: `packages/ticket-provider/src/providers/jira/operations/list-tickets.ts`

- [ ] **Step 1: Create the operation file**

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ListTicketsOptions, ListTicketsResult } from "@journeyman/core";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { buildMcpConfig } from "../utils/mcp-config.ts";

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    tickets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          status: { type: "string" },
          assignee: { type: "string" },
          labels: { type: "array", items: { type: "string" } },
          url: { type: "string" },
        },
        required: ["id", "title"],
      },
    },
    error: { type: "string" },
  },
  required: ["tickets"],
} as const;

function buildJql(opts: ListTicketsOptions): string {
  const clauses: string[] = [];
  if (opts.projectId) clauses.push(`project = "${opts.projectId}"`);
  if (opts.status) clauses.push(`status = "${opts.status}"`);
  if (opts.assignee) clauses.push(`assignee = "${opts.assignee}"`);
  return clauses.length ? clauses.join(" AND ") : "order by created DESC";
}

function buildPrompt(opts: ListTicketsOptions): string {
  return [
    `Search Jira issues using this JQL query: ${buildJql(opts)}`,
    "Return an array of issues, each with id, title, description, status, assignee, labels, and url.",
  ].join("\n");
}

export async function listTickets(opts: ListTicketsOptions): Promise<ListTicketsResult> {
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
      if (msg.subtype === "success") return msg.structured_output as ListTicketsResult;
      throw new Error(msg.result_text);
    }
  }
  return { tickets: [], error: "No result received" };
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck --workspace=packages/ticket-provider
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/jira/operations/list-tickets.ts
git commit -m "feat(ticket-provider): implement JiraProvider.listTickets via MCP"
```

---

## Task 8: Wire `JiraProvider` class

**Files:**
- Modify: `packages/ticket-provider/src/providers/jira/index.ts`

- [ ] **Step 1: Replace stub with wired implementation**

Replace the entire contents of `packages/ticket-provider/src/providers/jira/index.ts`:

```typescript
import type { ITicketProvider } from "@journeyman/core";
import type {
  CreateTicketOptions, CreateTicketResult,
  UpdateTicketOptions, UpdateTicketResult,
  GetTicketOptions, GetTicketResult,
  ListTicketsOptions, ListTicketsResult,
} from "@journeyman/core";
import { createTicket } from "./operations/create-ticket.ts";
import { updateTicket } from "./operations/update-ticket.ts";
import { getTicket } from "./operations/get-ticket.ts";
import { listTickets } from "./operations/list-tickets.ts";

export class JiraProvider implements ITicketProvider {
  createTicket(opts: CreateTicketOptions): Promise<CreateTicketResult> {
    return createTicket(opts);
  }
  updateTicket(opts: UpdateTicketOptions): Promise<UpdateTicketResult> {
    return updateTicket(opts);
  }
  getTicket(opts: GetTicketOptions): Promise<GetTicketResult> {
    return getTicket(opts);
  }
  listTickets(opts: ListTicketsOptions): Promise<ListTicketsResult> {
    return listTickets(opts);
  }
}
```

- [ ] **Step 2: Full typecheck across all packages**

```bash
npm run typecheck
```

Expected: no errors across all workspaces.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/jira/index.ts
git commit -m "feat(ticket-provider): wire JiraProvider to MCP-backed operations"
```
