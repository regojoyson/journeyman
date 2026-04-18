# Ticket Rich Fields & Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the `Ticket` type and `ITicketProvider` interface to support rich fields (comments, attachments, custom fields, priority, etc.) and add a `getTicketSchema` operation that returns field definitions for a ticket's project/issue type.

**Architecture:** All type changes land in `@journeyman/core` so every provider shares them. `JiraProvider` implements the rich get/update and the new `getTicketSchema` operation via the Atlassian MCP server. `LinearProvider` and `MondayProvider` get typed stubs that throw.

**Tech Stack:** TypeScript, `@anthropic-ai/claude-agent-sdk` (`query()`), Atlassian MCP over HTTP, npm workspaces.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `packages/core/src/types/ticket.types.ts` | Add `Comment`, `Attachment`, `TicketField`; extend `Ticket` + `UpdateTicketOptions`; add `GetTicketSchemaOptions`, `GetTicketSchemaResult` |
| Modify | `packages/core/src/interfaces/ticket.interface.ts` | Add `getTicketSchema` method + import new types |
| Modify | `packages/ticket-provider/src/providers/jira/operations/get-ticket.ts` | Expand prompt + output schema to full `Ticket` shape |
| Modify | `packages/ticket-provider/src/providers/jira/operations/update-ticket.ts` | Add `priority` + `customFields` to prompt |
| Create | `packages/ticket-provider/src/providers/jira/operations/get-ticket-schema.ts` | New operation — fetch field definitions for a ticket's project/issue type |
| Modify | `packages/ticket-provider/src/providers/jira/index.ts` | Import + wire `getTicketSchema` |
| Modify | `packages/ticket-provider/src/providers/linear/index.ts` | Add `getTicketSchema` stub |
| Modify | `packages/ticket-provider/src/providers/monday/index.ts` | Add `getTicketSchema` stub |

---

## Task 1: Extend core types

**Files:**
- Modify: `packages/core/src/types/ticket.types.ts`

- [ ] **Step 1: Replace the entire file with the extended types**

```typescript
export type TicketComment = {
  id: string;
  author?: string;
  body: string;
  createdAt?: string;
};

export type Attachment = {
  id: string;
  filename: string;
  url: string;
  mimeType?: string;
  size?: number;
};

export type TicketField = {
  id: string;
  name: string;
  type?: string;
  required?: boolean;
  allowedValues?: string[];
};

export type Ticket = {
  id: string;
  title: string;
  description?: string;
  status?: string;
  assignee?: string;
  labels?: string[];
  url?: string;
  priority?: string;
  issueType?: string;
  reporter?: string;
  createdAt?: string;
  updatedAt?: string;
  comments?: TicketComment[];
  attachments?: Attachment[];
  customFields?: Record<string, unknown>;
};

export type CreateTicketOptions = {
  title: string;
  description?: string;
  assignee?: string;
  labels?: string[];
  projectId?: string;
};

export type CreateTicketResult = {
  ticket?: Ticket;
  error?: string;
};

export type UpdateTicketOptions = {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  assignee?: string;
  labels?: string[];
  priority?: string;
  customFields?: Record<string, unknown>;
};

export type UpdateTicketResult = {
  ticket?: Ticket;
  error?: string;
};

export type GetTicketOptions = {
  id: string;
};

export type GetTicketResult = {
  ticket?: Ticket;
  error?: string;
};

export type ListTicketsOptions = {
  projectId?: string;
  status?: string;
  assignee?: string;
};

export type ListTicketsResult = {
  tickets: Ticket[];
  error?: string;
};

export type GetTicketSchemaOptions = {
  ticketId: string;
  projectId?: string;
};

export type GetTicketSchemaResult = {
  fields: TicketField[];
  error?: string;
};
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck
```

Expected: passes (or only errors in files not yet updated — those come in later tasks).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types/ticket.types.ts
git commit -m "feat(core): extend Ticket type with rich fields and add schema types"
```

---

## Task 2: Extend the ITicketProvider interface

**Files:**
- Modify: `packages/core/src/interfaces/ticket.interface.ts`

- [ ] **Step 1: Replace the file with the updated interface**

```typescript
import type {
  CreateTicketOptions,
  CreateTicketResult,
  UpdateTicketOptions,
  UpdateTicketResult,
  GetTicketOptions,
  GetTicketResult,
  ListTicketsOptions,
  ListTicketsResult,
  GetTicketSchemaOptions,
  GetTicketSchemaResult,
} from "../types/ticket.types.ts";

/**
 * Interface for issue tracker operations.
 * Implement this to add support for Jira, Linear, Monday, GitHub Issues, etc.
 */
export interface ITicketProvider {
  createTicket(opts: CreateTicketOptions): Promise<CreateTicketResult>;
  updateTicket(opts: UpdateTicketOptions): Promise<UpdateTicketResult>;
  getTicket(opts: GetTicketOptions): Promise<GetTicketResult>;
  listTickets(opts: ListTicketsOptions): Promise<ListTicketsResult>;
  getTicketSchema(opts: GetTicketSchemaOptions): Promise<GetTicketSchemaResult>;
}
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck
```

Expected: errors only on the three provider classes that don't yet implement `getTicketSchema` — that's expected and will be fixed in Tasks 5–7.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/interfaces/ticket.interface.ts
git commit -m "feat(core): add getTicketSchema to ITicketProvider interface"
```

---

## Task 3: Update get-ticket operation (rich output)

**Files:**
- Modify: `packages/ticket-provider/src/providers/jira/operations/get-ticket.ts`

- [ ] **Step 1: Replace the file with the expanded output schema and prompt**

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
        id:          { type: "string" },
        title:       { type: "string" },
        description: { type: "string" },
        status:      { type: "string" },
        assignee:    { type: "string" },
        labels:      { type: "array", items: { type: "string" } },
        url:         { type: "string" },
        priority:    { type: "string" },
        issueType:   { type: "string" },
        reporter:    { type: "string" },
        createdAt:   { type: "string" },
        updatedAt:   { type: "string" },
        comments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id:        { type: "string" },
              author:    { type: "string" },
              body:      { type: "string" },
              createdAt: { type: "string" },
            },
            required: ["id", "body"],
          },
        },
        attachments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id:       { type: "string" },
              filename: { type: "string" },
              url:      { type: "string" },
              mimeType: { type: "string" },
              size:     { type: "number" },
            },
            required: ["id", "filename", "url"],
          },
        },
        customFields: {
          type: "object",
          additionalProperties: true,
        },
      },
      required: ["id", "title"],
    },
    error: { type: "string" },
  },
} as const;

function buildPrompt(opts: GetTicketOptions): string {
  return [
    `Fetch the Jira issue with key: ${opts.id}`,
    "Return ALL available fields: id, title, description, status, assignee, labels, url,",
    "priority, issueType, reporter, createdAt, updatedAt, comments (with id/author/body/createdAt),",
    "attachments (with id/filename/url/mimeType/size), and customFields (all custom fields as a",
    "key-value object where keys are the Jira field IDs, e.g. customfield_10016).",
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
      throw new Error(msg.errors?.[0] ?? msg.subtype);
    }
  }
  return { error: "No result received" };
}
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck
```

Expected: passes (no new interface violations here).

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/jira/operations/get-ticket.ts
git commit -m "feat(jira): expand getTicket to return rich fields including comments, attachments, customFields"
```

---

## Task 4: Update update-ticket operation (priority + customFields)

**Files:**
- Modify: `packages/ticket-provider/src/providers/jira/operations/update-ticket.ts`

- [ ] **Step 1: Replace the file with the extended prompt**

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
        id:          { type: "string" },
        title:       { type: "string" },
        description: { type: "string" },
        status:      { type: "string" },
        assignee:    { type: "string" },
        labels:      { type: "array", items: { type: "string" } },
        url:         { type: "string" },
        priority:    { type: "string" },
        issueType:   { type: "string" },
        reporter:    { type: "string" },
        createdAt:   { type: "string" },
        updatedAt:   { type: "string" },
        comments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id:        { type: "string" },
              author:    { type: "string" },
              body:      { type: "string" },
              createdAt: { type: "string" },
            },
            required: ["id", "body"],
          },
        },
        attachments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id:       { type: "string" },
              filename: { type: "string" },
              url:      { type: "string" },
              mimeType: { type: "string" },
              size:     { type: "number" },
            },
            required: ["id", "filename", "url"],
          },
        },
        customFields: {
          type: "object",
          additionalProperties: true,
        },
      },
      required: ["id", "title"],
    },
    error: { type: "string" },
  },
} as const;

function buildPrompt(opts: UpdateTicketOptions): string {
  const parts = [`Update Jira issue with key: ${opts.id}`];
  if (opts.title)            parts.push(`New title: ${opts.title}`);
  if (opts.description)      parts.push(`New description: ${opts.description}`);
  if (opts.status)           parts.push(`New status (transition to): ${opts.status}`);
  if (opts.assignee)         parts.push(`New assignee account ID or email: ${opts.assignee}`);
  if (opts.labels?.length)   parts.push(`New labels: ${opts.labels.join(", ")}`);
  if (opts.priority)         parts.push(`New priority: ${opts.priority}`);
  if (opts.customFields && Object.keys(opts.customFields).length > 0) {
    parts.push(
      `Custom field updates (keys are Jira field IDs, e.g. customfield_10016): ${JSON.stringify(opts.customFields)}`
    );
  }
  parts.push("Return the updated issue's full details: id, title, description, status, assignee, labels, url, priority, issueType, reporter, createdAt, updatedAt, comments, attachments, and customFields.");
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
      throw new Error(msg.errors?.[0] ?? msg.subtype);
    }
  }
  return { error: "No result received" };
}
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/jira/operations/update-ticket.ts
git commit -m "feat(jira): add priority and customFields support to updateTicket"
```

---

## Task 5: Create get-ticket-schema operation

**Files:**
- Create: `packages/ticket-provider/src/providers/jira/operations/get-ticket-schema.ts`

- [ ] **Step 1: Create the new file**

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { GetTicketSchemaOptions, GetTicketSchemaResult } from "@journeyman/core";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { buildMcpConfig } from "../utils/mcp-config.ts";

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id:            { type: "string" },
          name:          { type: "string" },
          type:          { type: "string" },
          required:      { type: "boolean" },
          allowedValues: { type: "array", items: { type: "string" } },
        },
        required: ["id", "name"],
      },
    },
    error: { type: "string" },
  },
  required: ["fields"],
} as const;

function buildPrompt(opts: GetTicketSchemaOptions): string {
  const parts = [
    `Fetch the Jira issue with key: ${opts.id ?? opts.ticketId}`,
  ];
  if (opts.projectId) {
    parts.push(`The project key is: ${opts.projectId}`);
  } else {
    parts.push("Determine the project key and issue type from the ticket.");
  }
  parts.push(
    "Then fetch the field metadata for that project and issue type using the Jira issue type metadata API.",
    "Return an array of fields, each with: id (Jira field key, e.g. customfield_10016), name (human-readable label),",
    "type (field type, e.g. string, number, option, array), required (boolean), and allowedValues (array of valid",
    "string values for option/array fields).",
    "If field metadata is unavailable due to permissions or configuration, return an empty fields array and set",
    "the error property to a short explanation."
  );
  return parts.join("\n");
}

export async function getTicketSchema(opts: GetTicketSchemaOptions): Promise<GetTicketSchemaResult> {
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
      if (msg.subtype === "success") return msg.structured_output as GetTicketSchemaResult;
      return { fields: [], error: msg.result_text };
    }
  }
  return { fields: [], error: "No result received" };
}
```

Note: `buildPrompt` uses `opts.ticketId` (the primary key on `GetTicketSchemaOptions`). The `opts.id ?? opts.ticketId` fallback is a safety measure — `ticketId` is the correct field name per the types defined in Task 1.

- [ ] **Step 2: Fix the prompt function** — `GetTicketSchemaOptions` only has `ticketId`, not `id`. Update `buildPrompt` to use `opts.ticketId` directly:

```typescript
function buildPrompt(opts: GetTicketSchemaOptions): string {
  const parts = [
    `Fetch the Jira issue with key: ${opts.ticketId}`,
  ];
  if (opts.projectId) {
    parts.push(`The project key is: ${opts.projectId}`);
  } else {
    parts.push("Determine the project key and issue type from the ticket.");
  }
  parts.push(
    "Then fetch the field metadata for that project and issue type using the Jira issue type metadata API.",
    "Return an array of fields, each with: id (Jira field key, e.g. customfield_10016), name (human-readable label),",
    "type (field type, e.g. string, number, option, array), required (boolean), and allowedValues (array of valid",
    "string values for option/array fields).",
    "If field metadata is unavailable due to permissions or configuration, return an empty fields array and set",
    "the error property to a short explanation."
  );
  return parts.join("\n");
}
```

The full corrected file (replace Step 1's content with this):

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { GetTicketSchemaOptions, GetTicketSchemaResult } from "@journeyman/core";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { buildMcpConfig } from "../utils/mcp-config.ts";

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id:            { type: "string" },
          name:          { type: "string" },
          type:          { type: "string" },
          required:      { type: "boolean" },
          allowedValues: { type: "array", items: { type: "string" } },
        },
        required: ["id", "name"],
      },
    },
    error: { type: "string" },
  },
  required: ["fields"],
} as const;

function buildPrompt(opts: GetTicketSchemaOptions): string {
  const parts = [`Fetch the Jira issue with key: ${opts.ticketId}`];
  if (opts.projectId) {
    parts.push(`The project key is: ${opts.projectId}`);
  } else {
    parts.push("Determine the project key and issue type from the ticket.");
  }
  parts.push(
    "Then fetch the field metadata for that project and issue type using the Jira issue type metadata API.",
    "Return an array of fields, each with: id (Jira field key, e.g. customfield_10016), name (human-readable label),",
    "type (field type, e.g. string, number, option, array), required (boolean), and allowedValues (array of valid",
    "string values for option/array fields).",
    "If field metadata is unavailable due to permissions or configuration, return an empty fields array and set",
    "the error property to a short explanation."
  );
  return parts.join("\n");
}

export async function getTicketSchema(opts: GetTicketSchemaOptions): Promise<GetTicketSchemaResult> {
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
      if (msg.subtype === "success") return msg.structured_output as GetTicketSchemaResult;
      return { fields: [], error: msg.result_text };
    }
  }
  return { fields: [], error: "No result received" };
}
```

- [ ] **Step 3: Type-check**

```bash
npm run typecheck
```

Expected: passes (no interface violations yet — `JiraProvider` still missing the method until Task 6).

- [ ] **Step 4: Commit**

```bash
git add packages/ticket-provider/src/providers/jira/operations/get-ticket-schema.ts
git commit -m "feat(jira): add getTicketSchema operation"
```

---

## Task 6: Wire getTicketSchema into JiraProvider

**Files:**
- Modify: `packages/ticket-provider/src/providers/jira/index.ts`

- [ ] **Step 1: Replace the file**

```typescript
import type { ITicketProvider } from "@journeyman/core";
import type {
  CreateTicketOptions, CreateTicketResult,
  UpdateTicketOptions, UpdateTicketResult,
  GetTicketOptions, GetTicketResult,
  ListTicketsOptions, ListTicketsResult,
  GetTicketSchemaOptions, GetTicketSchemaResult,
} from "@journeyman/core";
import { createTicket } from "./operations/create-ticket.ts";
import { updateTicket } from "./operations/update-ticket.ts";
import { getTicket } from "./operations/get-ticket.ts";
import { listTickets } from "./operations/list-tickets.ts";
import { getTicketSchema } from "./operations/get-ticket-schema.ts";

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
  getTicketSchema(opts: GetTicketSchemaOptions): Promise<GetTicketSchemaResult> {
    return getTicketSchema(opts);
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck
```

Expected: `JiraProvider` now satisfies `ITicketProvider` — one of the two remaining errors clears. Linear and Monday still error.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider/src/providers/jira/index.ts
git commit -m "feat(jira): wire getTicketSchema into JiraProvider"
```

---

## Task 7: Add getTicketSchema stubs to Linear and Monday

**Files:**
- Modify: `packages/ticket-provider/src/providers/linear/index.ts`
- Modify: `packages/ticket-provider/src/providers/monday/index.ts`

- [ ] **Step 1: Replace linear/index.ts**

```typescript
import type { ITicketProvider } from "@journeyman/core";
import type {
  CreateTicketOptions, CreateTicketResult,
  UpdateTicketOptions, UpdateTicketResult,
  GetTicketOptions, GetTicketResult,
  ListTicketsOptions, ListTicketsResult,
  GetTicketSchemaOptions, GetTicketSchemaResult,
} from "@journeyman/core";

/** Linear ticket provider. Not yet implemented. */
export class LinearProvider implements ITicketProvider {
  createTicket(_opts: CreateTicketOptions): Promise<CreateTicketResult> { throw new Error("LinearProvider.createTicket not implemented"); }
  updateTicket(_opts: UpdateTicketOptions): Promise<UpdateTicketResult> { throw new Error("LinearProvider.updateTicket not implemented"); }
  getTicket(_opts: GetTicketOptions): Promise<GetTicketResult> { throw new Error("LinearProvider.getTicket not implemented"); }
  listTickets(_opts: ListTicketsOptions): Promise<ListTicketsResult> { throw new Error("LinearProvider.listTickets not implemented"); }
  getTicketSchema(_opts: GetTicketSchemaOptions): Promise<GetTicketSchemaResult> { throw new Error("LinearProvider.getTicketSchema not implemented"); }
}
```

- [ ] **Step 2: Replace monday/index.ts**

```typescript
import type { ITicketProvider } from "@journeyman/core";
import type {
  CreateTicketOptions, CreateTicketResult,
  UpdateTicketOptions, UpdateTicketResult,
  GetTicketOptions, GetTicketResult,
  ListTicketsOptions, ListTicketsResult,
  GetTicketSchemaOptions, GetTicketSchemaResult,
} from "@journeyman/core";

/** Monday.com ticket provider. Not yet implemented. */
export class MondayProvider implements ITicketProvider {
  createTicket(_opts: CreateTicketOptions): Promise<CreateTicketResult> { throw new Error("MondayProvider.createTicket not implemented"); }
  updateTicket(_opts: UpdateTicketOptions): Promise<UpdateTicketResult> { throw new Error("MondayProvider.updateTicket not implemented"); }
  getTicket(_opts: GetTicketOptions): Promise<GetTicketResult> { throw new Error("MondayProvider.getTicket not implemented"); }
  listTickets(_opts: ListTicketsOptions): Promise<ListTicketsResult> { throw new Error("MondayProvider.listTickets not implemented"); }
  getTicketSchema(_opts: GetTicketSchemaOptions): Promise<GetTicketSchemaResult> { throw new Error("MondayProvider.getTicketSchema not implemented"); }
}
```

- [ ] **Step 3: Type-check — full clean pass**

```bash
npm run typecheck
```

Expected: zero errors across all packages.

- [ ] **Step 4: Commit**

```bash
git add packages/ticket-provider/src/providers/linear/index.ts packages/ticket-provider/src/providers/monday/index.ts
git commit -m "feat(ticket-provider): add getTicketSchema stubs to LinearProvider and MondayProvider"
```
