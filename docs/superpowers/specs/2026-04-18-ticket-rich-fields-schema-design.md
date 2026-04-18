# Ticket Rich Fields & Schema Design

**Date:** 2026-04-18
**Scope:** `@journeyman/core` + `@journeyman/ticket-provider` (JiraProvider, LinearProvider, MondayProvider stubs)

---

## Problem

The current `Ticket` type and `ITicketProvider` interface only model a minimal set of fields (id, title, description, status, assignee, labels, url). This is insufficient for real-world use:

- Jira tickets carry comments, attachments, custom fields (e.g. acceptance criteria, story points, sprint), priority, reporter, timestamps.
- Callers passing context to the Agent SDK need to know what fields are available for a given project/issue type before performing create or update operations.

---

## Goals

1. Extend `Ticket` and `UpdateTicketOptions` in `@journeyman/core` to carry rich, optional fields — applying to all providers.
2. Add a `getTicketSchema` method to `ITicketProvider` that returns field definitions for a ticket's project/issue type — best-effort, gracefully handles unavailability.
3. Implement all changes in `JiraProvider`; stub in `LinearProvider` and `MondayProvider`.

---

## Core Type Changes (`packages/core/src/types/ticket.types.ts`)

### New shared types

```ts
type Comment = {
  id: string;
  author?: string;
  body: string;
  createdAt?: string;
};

type Attachment = {
  id: string;
  filename: string;
  url: string;
  mimeType?: string;
  size?: number;           // bytes
};

type TicketField = {
  id: string;             // Jira field key, e.g. "customfield_10016"
  name: string;           // human-readable, e.g. "Story Points"
  type?: string;          // e.g. "string", "number", "option", "array"
  required?: boolean;
  allowedValues?: string[];
};
```

### Extended `Ticket`

All new fields are optional — providers return only what they support.

```ts
type Ticket = {
  id: string;
  title: string;
  description?: string;
  status?: string;
  assignee?: string;
  labels?: string[];
  url?: string;
  // extended
  priority?: string;
  issueType?: string;
  reporter?: string;
  createdAt?: string;
  updatedAt?: string;
  comments?: Comment[];
  attachments?: Attachment[];
  customFields?: Record<string, unknown>;  // provider-specific, e.g. Jira custom fields
};
```

### Extended `UpdateTicketOptions`

```ts
type UpdateTicketOptions = {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  assignee?: string;
  labels?: string[];
  // extended
  priority?: string;
  customFields?: Record<string, unknown>;  // arbitrary field updates by field key
};
```

### New schema option/result types

```ts
type GetTicketSchemaOptions = {
  ticketId: string;
  projectId?: string;   // optional hint; inferred from ticket if omitted
};

type GetTicketSchemaResult = {
  fields: TicketField[];
  error?: string;       // non-fatal — populated when admin has restricted metadata access
};
```

---

## Interface Change (`packages/core/src/interfaces/ticket.interface.ts`)

Add one method:

```ts
getTicketSchema(opts: GetTicketSchemaOptions): Promise<GetTicketSchemaResult>;
```

---

## Jira Implementation

### `get-ticket.ts`

- Prompt expanded: request all fields including comments, attachments, and custom fields.
- Output schema expanded to match the full `Ticket` shape (all new fields optional in the schema).

### `update-ticket.ts`

- Prompt extended: serializes `priority` and `customFields` (as a JSON block) alongside existing fields.
- Agent maps `customFields` keys to Jira field IDs as needed.

### `get-ticket-schema.ts` (new file)

**Location:** `packages/ticket-provider/src/providers/jira/operations/get-ticket-schema.ts`

**Behavior:**
1. Fetch the ticket by `ticketId` to determine project key and issue type.
2. If `projectId` is provided, use it as a hint; otherwise derive from ticket.
3. Call Jira's issue type metadata API for that project + issue type.
4. Return `TicketField[]` — if the API call fails or returns no data (admin restriction), return `{ fields: [], error: "<reason>" }`. Never throw.

**Output schema:**
```ts
{
  fields: [{ id, name, type?, required?, allowedValues? }],
  error?: string
}
```

### `jira/index.ts`

- Import and delegate to `getTicketSchema` operation.
- Method satisfies updated `ITicketProvider`.

---

## Linear & Monday Stubs

Both providers add:

```ts
getTicketSchema(_opts: GetTicketSchemaOptions): Promise<GetTicketSchemaResult> {
  throw new Error("LinearProvider.getTicketSchema not implemented");
}
```

(Same pattern as all other unimplemented methods.)

---

## Error Handling

| Scenario | Behavior |
|---|---|
| Jira admin restricts field metadata | `{ fields: [], error: "Field metadata unavailable: <reason>" }` |
| Ticket not found during schema fetch | `{ fields: [], error: "Ticket <id> not found" }` |
| Agent SDK returns no result | `{ fields: [], error: "No result received" }` |
| Update with unknown `customFields` key | Agent SDK best-effort; Jira API error surfaced in `UpdateTicketResult.error` |

---

## Files Changed

| File | Change |
|---|---|
| `packages/core/src/types/ticket.types.ts` | Add `Comment`, `Attachment`, `TicketField`; extend `Ticket` + `UpdateTicketOptions`; add `GetTicketSchemaOptions`, `GetTicketSchemaResult` |
| `packages/core/src/interfaces/ticket.interface.ts` | Add `getTicketSchema` method; import new option/result types |
| `packages/ticket-provider/src/providers/jira/operations/get-ticket.ts` | Expand prompt + output schema |
| `packages/ticket-provider/src/providers/jira/operations/update-ticket.ts` | Add `priority`, `customFields` to prompt |
| `packages/ticket-provider/src/providers/jira/operations/get-ticket-schema.ts` | New file |
| `packages/ticket-provider/src/providers/jira/index.ts` | Wire `getTicketSchema` |
| `packages/ticket-provider/src/providers/linear/index.ts` | Add stub |
| `packages/ticket-provider/src/providers/monday/index.ts` | Add stub |

---

## Out of Scope

- `createTicket` — no new fields; Jira issue type is already hardcoded to "Task" and that is a separate concern.
- `listTickets` — returns `Ticket[]`; the richer fields are available on `getTicket` only (list results stay lightweight by default).
- Type-safe `customFields` generics — deferred; `Record<string, unknown>` is sufficient for current use cases.
