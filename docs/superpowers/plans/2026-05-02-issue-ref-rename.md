# issueRef Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename `ticketKey` and `ticketId` to `issueRef` (canonical format `"provider:raw-id"`) across all packages, add a `buildIssueRef`/`parseIssueRef` utility, and add a DB migration.

**Architecture:** Start with `@journeyman/core` types — TypeScript compiler errors will surface every other callsite automatically. Fix packages in dependency order. Add the DB migration SQL last.

**Tech Stack:** TypeScript, PostgreSQL (JSONB migration), npm workspaces monorepo.

---

### Task 1: Add `issue-ref.ts` utility to `@journeyman/core`

**Files:**
- Create: `packages/core/src/utils/issue-ref.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create the utility file**

```typescript
// packages/core/src/utils/issue-ref.ts
export type IssueRefProvider = "jira" | "github" | "monday" | "linear";

export interface ParsedIssueRef {
  provider: IssueRefProvider;
  rawId: string;
}

export function buildIssueRef(provider: IssueRefProvider, rawId: string | number): string {
  return `${provider}:${rawId}`;
}

export function parseIssueRef(ref: string): ParsedIssueRef {
  const colon = ref.indexOf(":");
  if (colon === -1) throw new Error(`Invalid issueRef: "${ref}"`);
  return { provider: ref.slice(0, colon) as IssueRefProvider, rawId: ref.slice(colon + 1) };
}
```

- [ ] **Step 2: Export from `packages/core/src/index.ts`**

Add at the bottom of the file:

```typescript
export { buildIssueRef, parseIssueRef } from "./utils/issue-ref.ts";
export type { IssueRefProvider, ParsedIssueRef } from "./utils/issue-ref.ts";
```

---

### Task 2: Rename types in `@journeyman/core`

**Files:**
- Modify: `packages/core/src/types/pipeline.types.ts`
- Modify: `packages/core/src/types/ticket.types.ts`
- Modify: `packages/core/src/types/git.types.ts`
- Modify: `packages/core/src/interfaces/pipeline.interface.ts`

- [ ] **Step 1: Update `pipeline.types.ts`**

Find and replace the following three occurrences:

In `PipelineRun` (around line 95–96):
```typescript
// Before:
  ticketKey: string;                    // canonical id (e.g. "owner/repo#42")
  ticketShortKey: string;               // short id for display ("42")
// After:
  issueRef: string;                     // canonical id e.g. "jira:PROJ-123"
  issueRefShort: string;                // short id for display e.g. "PROJ-123"
```

In `PipelineTrigger` (around line 138–139):
```typescript
// Before:
  ticketKey: string;
  ticketShortKey: string;
// After:
  issueRef: string;
  issueRefShort: string;
```

In the event union type (around line 148):
```typescript
// Before:
  | { type: "runStarted";  sessionId: string; ticketKey: string; flowName: string; at: string }
// After:
  | { type: "runStarted";  sessionId: string; issueRef: string; flowName: string; at: string }
```

- [ ] **Step 2: Update `ticket.types.ts`**

Find the `GetTicketSchemaOptions` type (around line 96) and rename:
```typescript
// Before:
  ticketId: string;
// After:
  issueRef: string;
```

- [ ] **Step 3: Update `git.types.ts`**

Find the `CreateWorkspaceOptions` type (around line 95) and rename:
```typescript
// Before:
  ticketId: string;
// After:
  issueRef: string;
```

- [ ] **Step 4: Update `pipeline.interface.ts`**

```typescript
// Before:
  findByTicket(productId: string, ticketKey: string): Promise<PipelineRun[]>;
  findActiveForTicket(productId: string, ticketKey: string): Promise<PipelineRun | null>;
// After:
  findByIssueRef(productId: string, issueRef: string): Promise<PipelineRun[]>;
  findActiveForIssueRef(productId: string, issueRef: string): Promise<PipelineRun | null>;
```

---

### Task 3: Update ticket phases

**Files:**
- Modify: `packages/phases/src/tickets/get-ticket.tsx`
- Modify: `packages/phases/src/tickets/get-ticket.meta.ts`
- Modify: `packages/phases/src/tickets/comment-on-ticket.tsx`
- Modify: `packages/phases/src/tickets/comment-on-ticket.meta.ts`
- Modify: `packages/phases/src/tickets/transition-ticket.tsx`
- Modify: `packages/phases/src/tickets/transition-ticket.meta.ts`
- Modify: `packages/phases/src/tickets/update-ticket-fields.tsx`
- Modify: `packages/phases/src/tickets/update-ticket-fields.meta.ts`

- [ ] **Step 1: Update `get-ticket.tsx`**

```typescript
// Before:
interface GetTicketConfig {
  ticketKey: string;
}

export const getTicketPhase: PhaseDefinition<GetTicketConfig> = {
  // ...
  defaultConfig: { ticketKey: "" },
  configSchema: z.object({
    ticketKey: z.string().min(1),
  }),
  configFields: {
    ticketKey: { label: "Ticket key", widget: "text", help: "e.g. PROJ-123 (supports #{ticket} placeholder)" },
  },
  // ...
  summary: (c, ctx) => summaryValue(c, ctx, "ticketKey") || "(no ticket)",

// After:
interface GetTicketConfig {
  issueRef: string;
}

export const getTicketPhase: PhaseDefinition<GetTicketConfig> = {
  // ...
  defaultConfig: { issueRef: "" },
  configSchema: z.object({
    issueRef: z.string().min(1),
  }),
  configFields: {
    issueRef: { label: "Issue ref", widget: "text", help: "e.g. jira:PROJ-123 (supports #{ticket} placeholder)" },
  },
  // ...
  summary: (c, ctx) => summaryValue(c, ctx, "issueRef") || "(no ticket)",
```

- [ ] **Step 2: Update `get-ticket.meta.ts`**

```typescript
// Before:
export const getTicketInputFields: InputFields = {
  ticketKey: { type: "string", label: "Ticket key", required: true },
};
// After:
export const getTicketInputFields: InputFields = {
  issueRef: { type: "string", label: "Issue ref", required: true },
};
```

- [ ] **Step 3: Update `comment-on-ticket.tsx`**

Replace all three occurrences of `ticketKey` in the config interface, `defaultConfig`, `configSchema`, `configFields`, and `summary`:

```typescript
// Before:
interface CommentOnTicketConfig {
  ticketKey: string;
  // ...
}
  defaultConfig: { ticketKey: "", template: "", body: "" },
  configSchema: z.object({
    ticketKey: z.string().min(1),
    // ...
  }),
  configFields: {
    ticketKey: { label: "Ticket key", widget: "text", help: "Supports #{ticket} placeholder" },
    // ...
  },
  summary: c => c.template || c.ticketKey || "(no target)",

// After:
interface CommentOnTicketConfig {
  issueRef: string;
  // ...
}
  defaultConfig: { issueRef: "", template: "", body: "" },
  configSchema: z.object({
    issueRef: z.string().min(1),
    // ...
  }),
  configFields: {
    issueRef: { label: "Issue ref", widget: "text", help: "Supports #{ticket} placeholder" },
    // ...
  },
  summary: c => c.template || c.issueRef || "(no target)",
```

- [ ] **Step 4: Update `comment-on-ticket.meta.ts`**

```typescript
// Before:
  ticketKey: { type: "string", label: "Ticket key", required: true },
// After:
  issueRef: { type: "string", label: "Issue ref", required: true },
```

- [ ] **Step 5: Update `transition-ticket.tsx`**

Replace all occurrences of `ticketKey` in the interface, `defaultConfig`, `configSchema`, `configFields`:

```typescript
// Before:
  ticketKey: string;
  defaultConfig: { ticketKey: "", status: "" },
  ticketKey: z.string().min(1),
  ticketKey: { label: "Ticket key", widget: "text", help: "Supports #{ticket} placeholder" },
// After:
  issueRef: string;
  defaultConfig: { issueRef: "", status: "" },
  issueRef: z.string().min(1),
  issueRef: { label: "Issue ref", widget: "text", help: "Supports #{ticket} placeholder" },
```

- [ ] **Step 6: Update `transition-ticket.meta.ts`**

```typescript
// Before:
  ticketKey: { type: "string", label: "Ticket key", required: true },
// After:
  issueRef: { type: "string", label: "Issue ref", required: true },
```

- [ ] **Step 7: Update `update-ticket-fields.tsx`**

This phase uses a custom `ConfigForm` JSX component (not `configFields`). Replace every occurrence of `ticketKey`:

```typescript
// Interface — Before:
interface UpdateTicketFieldsConfig {
  ticketKey: string;
// After:
interface UpdateTicketFieldsConfig {
  issueRef: string;

// ConfigForm label — Before:
        <label>Ticket key</label>
        <input
          type="text"
          value={config.ticketKey}
          disabled={readOnly}
          onChange={e => onChange({ ...config, ticketKey: e.target.value })}
// After:
        <label>Issue ref</label>
        <input
          type="text"
          value={config.issueRef}
          disabled={readOnly}
          onChange={e => onChange({ ...config, issueRef: e.target.value })}

// defaultConfig — Before:
  defaultConfig: { ticketKey: "", fields: {} },
// After:
  defaultConfig: { issueRef: "", fields: {} },

// configSchema — Before:
    ticketKey: z.string().min(1),
// After:
    issueRef: z.string().min(1),

// summary — Before:
  summary: (c, ctx) => summaryValue(c, ctx, "ticketKey") || "(no ticket)",
// After:
  summary: (c, ctx) => summaryValue(c, ctx, "issueRef") || "(no ticket)",
```

- [ ] **Step 8: Update `update-ticket-fields.meta.ts`**

```typescript
// Before:
  ticketKey: { type: "string", label: "Ticket key", required: true },
// After:
  issueRef: { type: "string", label: "Issue ref", required: true },
```

---

### Task 4: Update `create-workspace` phase

**Files:**
- Modify: `packages/phases/src/repos/create-workspace.tsx`
- Modify: `packages/phases/src/repos/create-workspace.meta.ts`

- [ ] **Step 1: Update `create-workspace.tsx`**

```typescript
// Before:
interface CreateWorkspaceConfig {
  ticketId: string;
}
  defaultConfig: { ticketId: "" },
  ticketId: z.string().min(1),
  ticketId: { label: "Ticket ID", widget: "text" },
  summary: c => c.ticketId,
// After:
interface CreateWorkspaceConfig {
  issueRef: string;
}
  defaultConfig: { issueRef: "" },
  issueRef: z.string().min(1),
  issueRef: { label: "Issue ref", widget: "text" },
  summary: c => c.issueRef,
```

- [ ] **Step 2: Update `create-workspace.meta.ts`**

```typescript
// Before:
  ticketId: { type: "string", label: "Ticket ID" },
// After:
  issueRef: { type: "string", label: "Issue ref" },
```

---

### Task 5: Update orchestrator phase handlers

**Files:**
- Modify: `packages/orchestrator/src/workers/phases/get-ticket-phase-handler.ts`
- Modify: `packages/orchestrator/src/workers/phases/comment-on-ticket-phase-handler.ts`
- Modify: `packages/orchestrator/src/workers/phases/transition-ticket-phase-handler.ts`
- Modify: `packages/orchestrator/src/workers/phases/update-ticket-fields-phase-handler.ts`
- Modify: `packages/orchestrator/src/workers/phases/create-workspace-phase-handler.ts`

- [ ] **Step 1: Update `get-ticket-phase-handler.ts`**

```typescript
// Before:
    const id = typeof input.id === "string" ? input.id
      : typeof input.ticketKey === "string" ? input.ticketKey : undefined;
    if (!id) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "get-ticket requires `ticketKey` or `id`", retryable: false } };
    }
// After:
    const id = typeof input.id === "string" ? input.id
      : typeof input.issueRef === "string" ? input.issueRef : undefined;
    if (!id) {
      return { kind: "failure", failure: { errorClass: "InvalidInput", message: "get-ticket requires `issueRef` or `id`", retryable: false } };
    }
```

Also update the JSDoc comment at the top:
```typescript
// Before:
 *   - ticketKey  — issue key (e.g. "PROJ-123")
// After:
 *   - issueRef   — canonical issue ref (e.g. "jira:PROJ-123")
```

- [ ] **Step 2: Update `comment-on-ticket-phase-handler.ts`**

```typescript
// Before:
      : typeof input.ticketKey === "string" ? input.ticketKey : undefined;
    // ...
    message: "add-ticket-comment requires `id`/`ticketKey` and `body`",
// After:
      : typeof input.issueRef === "string" ? input.issueRef : undefined;
    // ...
    message: "add-ticket-comment requires `id`/`issueRef` and `body`",
```

- [ ] **Step 3: Update `transition-ticket-phase-handler.ts`**

```typescript
// Before:
      : typeof input.ticketKey === "string" ? input.ticketKey : undefined;
    // ...
    message: "update-status requires `ticketKey`/`id` and `status`",
// After:
      : typeof input.issueRef === "string" ? input.issueRef : undefined;
    // ...
    message: "update-status requires `issueRef`/`id` and `status`",
```

Also update the JSDoc comment:
```typescript
// Before:
 *   - ticketKey | id — issue identifier (string, required)
// After:
 *   - issueRef | id — issue identifier (string, required)
```

- [ ] **Step 4: Update `update-ticket-fields-phase-handler.ts`**

```typescript
// Before:
      : typeof input.ticketKey === "string" ? input.ticketKey : undefined;
    // ...
    message: "update-ticket requires `id`/`ticketKey`",
// After:
      : typeof input.issueRef === "string" ? input.issueRef : undefined;
    // ...
    message: "update-ticket requires `id`/`issueRef`",
```

- [ ] **Step 5: Update `create-workspace-phase-handler.ts`**

```typescript
// Before:
 *   - ticketId — used as the workspace folder name prefix (string)
    const ticketId = typeof input.ticketId === "string" ? input.ticketId : undefined;
    if (!ticketId) {
      // ...
      message: "create-workspace requires `ticketId`",
    ctx.log(`Creating workspace ${ticketId} under ${this.deps.baseDir}`);
      ticketId,
// After:
 *   - issueRef — used as the workspace folder name prefix (string)
    const issueRef = typeof input.issueRef === "string" ? input.issueRef : undefined;
    if (!issueRef) {
      // ...
      message: "create-workspace requires `issueRef`",
    ctx.log(`Creating workspace ${issueRef} under ${this.deps.baseDir}`);
      issueRef,
```

---

### Task 6: Update coding-cli providers

**Files:**
- Modify: `packages/coding-cli/src/providers/claude/operations/create-workspace.ts`
- Modify: `packages/coding-cli/src/providers/claude/operations/checkout-repo.ts`
- Modify: `packages/coding-cli/src/providers/opencode/operations/create-workspace.ts`
- Modify: `packages/coding-cli/src/providers/opencode/operations/checkout-repo.ts`

- [ ] **Step 1: Update claude `create-workspace.ts`**

```typescript
// Before:
  log.info({ sessionId, ticketId: opts.ticketId, baseDir: opts.baseDir }, "createWorkspace start");
  if (!opts.ticketId) {
    log.error({ sessionId }, "createWorkspace missing ticketId");
    return { folderName: "", repoDir: "", error: "ticketId is required", sessionId };
  }
  const folderName = `${opts.ticketId}-${buildTimestamp()}`;
// After:
  log.info({ sessionId, issueRef: opts.issueRef, baseDir: opts.baseDir }, "createWorkspace start");
  if (!opts.issueRef) {
    log.error({ sessionId }, "createWorkspace missing issueRef");
    return { folderName: "", repoDir: "", error: "issueRef is required", sessionId };
  }
  const folderName = `${opts.issueRef}-${buildTimestamp()}`;
```

Also update the JSDoc comment and example:
```typescript
// Before: `<ticketId>-<ISO-timestamp>` (e.g. "PROJ-123-2026-04-18T14-30-22Z")
// After:  `<issueRef>-<ISO-timestamp>` (e.g. "jira:PROJ-123-2026-04-18T14-30-22Z")
```

- [ ] **Step 2: Update claude `checkout-repo.ts`**

```typescript
// Before:
    { sessionId, repoCount: entries.length, ticketId: opts.ticket?.id },
// After:
    { sessionId, repoCount: entries.length, issueRef: opts.ticket?.id },
```

- [ ] **Step 3: Update opencode `create-workspace.ts`**

Apply the same changes as Step 1 above to `packages/coding-cli/src/providers/opencode/operations/create-workspace.ts`.

- [ ] **Step 4: Update opencode `checkout-repo.ts`**

```typescript
// Before:
  log.info({ sessionId, repoCount: entries.length, ticketId: opts.ticket?.id }, "checkoutRepo start");
// After:
  log.info({ sessionId, repoCount: entries.length, issueRef: opts.ticket?.id }, "checkoutRepo start");
```

---

### Task 7: Update Jira provider operations

**Files:**
- Modify: `packages/ticket-provider/src/providers/jira/operations/get-ticket-schema.ts`
- Modify: `packages/ticket-provider/src/providers/jira/operations/get-ticket.ts`
- Modify: `packages/ticket-provider/src/providers/jira/operations/create-ticket.ts`
- Modify: `packages/ticket-provider/src/providers/jira/operations/update-ticket.ts`

- [ ] **Step 1: Update `get-ticket-schema.ts`**

The function uses `opts.ticketId` to build a prompt and in log fields. Update all references:

```typescript
// Before:
  const parts = [`Fetch the Jira issue with key: ${opts.ticketId}`];
  log.info({ ticketId: opts.ticketId, projectId: opts.projectId }, "getTicketSchema start");
  log.info({ ticketId: opts.ticketId, fieldCount: ... }, "getTicketSchema done");
  log.error({ ticketId: opts.ticketId, error }, "getTicketSchema failed");
  log.error({ ticketId: opts.ticketId }, "getTicketSchema: no result received");
// After (use parseIssueRef to extract raw key for the prompt):
  import { parseIssueRef } from "@journeyman/core";
  // At the top of buildPrompt:
  const { rawId } = parseIssueRef(opts.issueRef);
  const parts = [`Fetch the Jira issue with key: ${rawId}`];
  log.info({ issueRef: opts.issueRef, projectId: opts.projectId }, "getTicketSchema start");
  log.info({ issueRef: opts.issueRef, fieldCount: ... }, "getTicketSchema done");
  log.error({ issueRef: opts.issueRef, error }, "getTicketSchema failed");
  log.error({ issueRef: opts.issueRef }, "getTicketSchema: no result received");
```

- [ ] **Step 2: Update `get-ticket.ts`**

Log fields use `opts.id` (the raw key passed at call time) — rename the log field label only:

```typescript
// Before:
  log.info({ ticketId: opts.id }, "getTicket start");
  log.info({ ticketId: opts.id, found: ... }, "getTicket done");
  log.error({ ticketId: opts.id, error }, "getTicket failed");
  log.error({ ticketId: opts.id }, "getTicket: no result received");
// After:
  log.info({ issueRef: opts.id }, "getTicket start");
  log.info({ issueRef: opts.id, found: ... }, "getTicket done");
  log.error({ issueRef: opts.id, error }, "getTicket failed");
  log.error({ issueRef: opts.id }, "getTicket: no result received");
```

- [ ] **Step 3: Update `create-ticket.ts`**

```typescript
// Before:
  log.info({ ticketId: result.ticket?.id }, "createTicket done");
// After:
  log.info({ issueRef: result.ticket?.id }, "createTicket done");
```

- [ ] **Step 4: Update `update-ticket.ts`** (if it has ticketId log references)

Search for any `ticketId` log field and rename to `issueRef`.

---

### Task 8: Update web and flow-editor UI labels

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/RunInputsEditor.tsx`
- Modify: `packages/flow-editor/src/properties-panel/ValuePicker.tsx`
- Modify: `packages/web/src/routes/RunsListPage.tsx`

- [ ] **Step 1: Update `RunInputsEditor.tsx`**

```tsx
// Before:
  placeholder="e.g. ticketId"
// After:
  placeholder="e.g. jira:PROJ-123"
```

- [ ] **Step 2: Update `ValuePicker.tsx`**

```tsx
// Before:
  feature/${"${ticketKey}"}
// After:
  feature/${"${issueRef}"}
```

- [ ] **Step 3: Update `RunsListPage.tsx`**

```typescript
// Before:
  const [ticketId, setTicketId] = useState("");
  // ...
  if (ticketId.trim()) inputs.ticketId = ticketId.trim();
  // ...
  value={ticketId}
  onChange={...setTicketId...}
// After:
  const [issueRef, setIssueRef] = useState("");
  // ...
  if (issueRef.trim()) inputs.issueRef = issueRef.trim();
  // ...
  value={issueRef}
  onChange={...setIssueRef...}
```

---

### Task 9: Add DB migration

**Files:**
- Create: `packages/migrations/src/sql/007_issue_ref.sql`

- [ ] **Step 1: Create migration file**

```sql
-- 007_issue_ref.sql
-- Rename ticketKey → issueRef in jm_runs inputs JSONB
UPDATE jm_runs
SET inputs = inputs - 'ticketKey' || jsonb_build_object('issueRef', inputs->>'ticketKey')
WHERE inputs ? 'ticketKey';

-- Rename ticketId → issueRef (create-workspace runs)
UPDATE jm_runs
SET inputs = inputs - 'ticketId' || jsonb_build_object('issueRef', inputs->>'ticketId')
WHERE inputs ? 'ticketId';

-- Rename ticketShortKey → issueRefShort
UPDATE jm_runs
SET inputs = inputs - 'ticketShortKey' || jsonb_build_object('issueRefShort', inputs->>'ticketShortKey')
WHERE inputs ? 'ticketShortKey';
```

---

### Task 10: Typecheck

- [ ] **Step 1: Run typecheck across all packages**

```bash
npm run typecheck
```

Expected: zero errors. If errors remain, they point to callsites of `ticketKey`/`ticketId` not yet updated. Fix each one reported.

- [ ] **Step 2: Verify no remaining occurrences**

```bash
grep -rn "ticketKey\|ticketId" packages/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "\.sql" | grep -v "// "
```

Expected: no output.
