# Design: Unify `ticketKey` / `ticketId` → `issueRef`

**Date:** 2026-05-02  
**Status:** Approved

## Problem

The codebase uses two names for the same concept — the identifier of a ticket or issue that triggered a pipeline run:

| Name | Where used |
|---|---|
| `ticketKey` | `pipeline.types.ts`, all ticket phases, orchestrator phase handlers, flow editor |
| `ticketId` | `create-workspace` phase, `git.types.ts`, Jira provider operations, web UI filter |

Both are plain strings like `"PROJ-123"`. The split is accidental and confusing. There is also a related `ticketShortKey` field for display purposes.

Additionally, the system is multi-provider (Jira, GitHub Issues, Monday, Linear) and identifiers from different providers have different formats — a single raw string gives no indication of which provider it belongs to.

## Decision

Rename everything to `issueRef`, using a namespaced canonical format: `"<provider>:<raw-id>"`.

- `ticketKey` → `issueRef`
- `ticketId` → `issueRef`
- `ticketShortKey` → `issueRefShort`

## Canonical Format

`issueRef` is always a string in the form `"<provider>:<raw-id>"`.

| Provider | Raw webhook value | `issueRef` value |
|---|---|---|
| Jira | `"PROJ-123"` | `"jira:PROJ-123"` |
| GitHub Issues | `42` | `"github:owner/repo#42"` |
| Monday | `12345678` | `"monday:12345678"` |
| Linear | `"ENG-99"` | `"linear:ENG-99"` |

`issueRefShort` is a display-friendly string extracted from the ref (e.g. `"PROJ-123"`, `"#42"`).

The namespaced format is:
- **Self-describing** — readable in logs and audit trails without joining to another field
- **Collision-proof** — two providers can produce the same raw ID without ambiguity
- **Extensible** — new providers add a new prefix; no other code changes

## Utility: `issue-ref.ts`

A new file `packages/core/src/utils/issue-ref.ts` provides the only place where `issueRef` strings are built or parsed:

```typescript
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

**`buildIssueRef`** is called only at the webhook ingestion boundary when a `PipelineRun` is created.  
**`parseIssueRef`** is called inside provider operations (e.g. `JiraProvider.getTicket`) to extract the raw ID for the external API call.

Export from `packages/core/src/index.ts`.

## Code Changes

### 1. `@journeyman/core` (rename first — TypeScript errors surface all other callsites)

- `packages/core/src/types/pipeline.types.ts`
  - `PipelineRun.ticketKey` → `issueRef`
  - `PipelineRun.ticketShortKey` → `issueRefShort`
  - `PipelineTrigger.ticketKey` → `issueRef`
  - `PipelineTrigger.ticketShortKey` → `issueRefShort`
  - Event union type: `ticketKey` → `issueRef`
- `packages/core/src/types/ticket.types.ts` — `ticketId` → `issueRef`
- `packages/core/src/types/git.types.ts` — `ticketId` → `issueRef`
- `packages/core/src/interfaces/pipeline.interface.ts`
  - `IPipelineRunRepository.findByTicket(productId, ticketKey)` → `findByIssueRef(productId, issueRef)`
  - `IPipelineRunRepository.findActiveForTicket(productId, ticketKey)` → `findActiveForIssueRef(productId, issueRef)`
- Add `packages/core/src/utils/issue-ref.ts`
- Export new utility from `packages/core/src/index.ts`

### 2. `packages/phases/src/tickets/`

All four ticket phases (`get-ticket`, `comment-on-ticket`, `transition-ticket`, `update-ticket-fields`):
- Config type field: `ticketKey` → `issueRef`
- `defaultConfig`, `zod schema`, `fieldSchema`, `summary` functions
- `.meta.ts` files: field key and label

### 3. `packages/phases/src/repos/create-workspace`

- `create-workspace.tsx` and `create-workspace.meta.ts`: `ticketId` → `issueRef`

### 4. `packages/orchestrator/src/workers/phases/`

All five phase handlers:
- `get-ticket-phase-handler.ts` — `ticketKey`/`id` fallback → `issueRef`/`id`
- `comment-on-ticket-phase-handler.ts` — same
- `transition-ticket-phase-handler.ts` — same
- `update-ticket-fields-phase-handler.ts` — same
- `create-workspace-phase-handler.ts` — `ticketId` → `issueRef`

### 5. `packages/coding-cli/src/providers/`

Both claude and opencode providers:
- `create-workspace.ts` — `opts.ticketId` → `opts.issueRef`
- `checkout-repo.ts` — log field `ticketId` → `issueRef`

### 6. `packages/ticket-provider/src/providers/jira/operations/`

- `get-ticket-schema.ts`, `get-ticket.ts`, `create-ticket.ts`, `update-ticket.ts`
- Change log field names and call `parseIssueRef` to extract the raw Jira key before API calls

### 7. `packages/web/src/routes/RunsListPage.tsx`

- State variable `ticketId` → `issueRef`
- Input field binding and filter param key

### 8. `packages/flow-editor/src/properties-panel/`

- `RunInputsEditor.tsx` — placeholder `"e.g. ticketId"` → `"e.g. jira:PROJ-123"`
- `ValuePicker.tsx` — example `feature/${ticketKey}` → `feature/${issueRef}`

## Database Migration

New file: `packages/migrations/src/sql/007_issue_ref.sql`

```sql
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

Note: `ticketKey`/`ticketId` are stored inside the `inputs` JSONB column of `jm_runs` — there is no dedicated column to rename.

## UI Label Changes

| Location | Old text | New text |
|---|---|---|
| `RunInputsEditor.tsx:36` | `placeholder="e.g. ticketId"` | `placeholder="e.g. jira:PROJ-123"` |
| `ValuePicker.tsx:34` | `feature/${ticketKey}` | `feature/${issueRef}` |
| Phase field labels (`get-ticket`, `comment-on-ticket`, etc.) | `"Ticket key"` | `"Issue ref"` |
| `create-workspace` phase label | `"Ticket ID"` | `"Issue ref"` |

## Acceptance Criteria

1. `npm run typecheck` passes with zero errors across all packages.
2. No occurrence of `ticketKey` or `ticketId` remains in TypeScript source (except comments referencing old names for migration history).
3. DB migration runs without error on a database containing existing rows.
4. `buildIssueRef` / `parseIssueRef` are exported from `@journeyman/core`.
5. Jira provider extracts the raw key via `parseIssueRef` before calling the Jira API.
