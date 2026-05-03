# Typed Phase I/O Bindings + `ticket` → `issue` Rename — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the implicit string-typed phase I/O contract with a real `Shape` type system, make the flow-editor `ValuePicker` shape-aware, validate refs at flow-save time, and complete the partial `ticket` → `issue` rename across the codebase.

**Architecture:** Two coordinated workstreams in one branch. Workstream 1 is a mechanical rename of files, types, interfaces, phase IDs, fields, and labels (`ticket` → `issue`). Workstream 2 introduces a `Shape` type, a named-shape registry (`Issue`, `Repo`, `PullRequest`, `Workspace`), migrates every phase meta to declare structured shapes, upgrades `useUpstreamSources`/`ValuePicker` to render a tree with type-aware highlighting, and adds shape-checking to `conductor-converter.ts` validation. No backwards-compat shims; stored flows referencing old phase IDs will not load.

**Tech Stack:** TypeScript, npm workspaces monorepo, React (flow-editor), Conductor task DSL (orchestrator). Spec: [`docs/superpowers/specs/2026-05-02-typed-bindings-and-issue-rename-design.md`](../specs/2026-05-02-typed-bindings-and-issue-rename-design.md).

**Execution policy (per user request):**
- **No git commits.** Do not run `git add` or `git commit`. The user will handle commits at the end.
- **No unit tests.** Do not write tests; do not run test suites.
- **Single typecheck at the end.** Run `npm run typecheck` only as the final task. Do not run it intermediately.

---

## File Structure

### Workstream 1 — files renamed/moved

| From | To |
|---|---|
| `packages/core/src/interfaces/ticket.interface.ts` | `packages/core/src/interfaces/issue.interface.ts` |
| `packages/core/src/types/ticket.types.ts` | `packages/core/src/types/issue.types.ts` |
| `packages/phases/src/tickets/get-ticket.meta.ts` | `packages/phases/src/issues/get-issue.meta.ts` |
| `packages/phases/src/tickets/get-ticket.tsx` | `packages/phases/src/issues/get-issue.tsx` |
| `packages/phases/src/tickets/create-ticket.meta.ts` | `packages/phases/src/issues/create-issue.meta.ts` |
| `packages/phases/src/tickets/create-ticket.tsx` | `packages/phases/src/issues/create-issue.tsx` |
| `packages/phases/src/tickets/comment-on-ticket.meta.ts` | `packages/phases/src/issues/comment-on-issue.meta.ts` |
| `packages/phases/src/tickets/comment-on-ticket.tsx` | `packages/phases/src/issues/comment-on-issue.tsx` |
| `packages/phases/src/tickets/transition-ticket.meta.ts` | `packages/phases/src/issues/transition-issue.meta.ts` |
| `packages/phases/src/tickets/transition-ticket.tsx` | `packages/phases/src/issues/transition-issue.tsx` |
| `packages/phases/src/tickets/update-ticket-fields.meta.ts` | `packages/phases/src/issues/update-issue-fields.meta.ts` |
| `packages/phases/src/tickets/update-ticket-fields.tsx` | `packages/phases/src/issues/update-issue-fields.tsx` |
| `packages/orchestrator/src/workers/phases/get-ticket-phase-handler.ts` | `get-issue-phase-handler.ts` |
| `packages/orchestrator/src/workers/phases/create-ticket-phase-handler.ts` | `create-issue-phase-handler.ts` |
| `packages/orchestrator/src/workers/phases/comment-on-ticket-phase-handler.ts` | `comment-on-issue-phase-handler.ts` |
| `packages/orchestrator/src/workers/phases/transition-ticket-phase-handler.ts` | `transition-issue-phase-handler.ts` |
| `packages/orchestrator/src/workers/phases/update-ticket-fields-phase-handler.ts` | `update-issue-fields-phase-handler.ts` |

### Workstream 2 — files created

| Path | Responsibility |
|---|---|
| `packages/core/src/types/shape.types.ts` | The `Shape` discriminated union and `InputField` / `OutputSchema` redefinitions. |
| `packages/core/src/types/shapes.ts` | Named-shape registry: `Issue`, `Repo`, `PullRequest`, `Workspace`, plus `NAMED_SHAPES`, `resolveShape`, `shapesEqual`. |
| `packages/orchestrator/src/flow-json/validate-ref-shape.ts` | Path-walking + shape-comparison helpers used by `conductor-converter.ts` validation. |
| `packages/flow-editor/src/properties-panel/ShapeTree.tsx` | Recursive React tree component used by the picker to render `Shape` nodes. |

### Workstream 2 — files modified

- `packages/core/src/types/phase-handler.types.ts` — replace old `OutputFieldSchema`/`OutputFieldType`/`OutputSchema` definitions with `Shape`-based `OutputSchema`.
- `packages/core/src/index.ts` — adjust re-exports (drop `OutputFieldSchema`, `OutputFieldType`; add `Shape`, named shapes).
- `packages/phases/src/shared-meta.ts` — replace `InputFieldMeta` with shape-aware `InputField`.
- `packages/phases/src/registry.ts` — update import paths for issue phases.
- `packages/phases/src/catalog.ts` — update import paths and identifiers for renamed phase metas.
- `packages/phases/src/index.ts` (if present) — update re-exports.
- All `*.meta.ts` files under `packages/phases/src/**/*.meta.ts` — migrate every `OutputSchema` and `InputFields` declaration to `Shape`.
- `packages/flow-editor/src/properties-panel/use-upstream-sources.ts` — emit `Shape`-typed fields.
- `packages/flow-editor/src/properties-panel/ValuePicker.tsx` — render shape tree, support bind-at-any-level, type-aware highlighting.
- `packages/flow-editor/src/properties-panel/ConfigTab.tsx` — pass consumer input `Shape` into `ValuePicker`.
- `packages/flow-editor/src/properties-panel/SchemaForm.tsx` — handle `Shape`-typed `InputField` (scalars only inline; objects/arrays render as bindOnly placeholder).
- `packages/orchestrator/src/flow-json/conductor-converter.ts` — call ref-shape validator inside `validate()`.
- `packages/core/src/registries/provider-catalog.ts` — `ticket-provider` → `issue-provider`; phase ID map updated.
- All ticket-provider concrete classes (`packages/ticket-provider/src/providers/**/index.ts`) — `implements ITicketProvider` → `implements IIssueProvider`.
- `packages/orchestrator/src/cli-worker.ts` — type imports + `ticket` symbol uses.
- `packages/api-server/src/routes/runs.ts`, `webhooks.ts`, `composition.ts`, `server.ts`, `schemas/update-flow.ts` — rename ticket-related identifiers.
- All coding-cli operations under `packages/coding-cli/src/providers/**/operations/*.ts` — rename `ticket` parameter → `issue`.
- All phase handler files in `packages/orchestrator/src/workers/phases/*.ts` — rename `input.ticket` → `input.issue`, `phaseType` strings.

---

## Phase A — `ticket` → `issue` rename (workstream 1)

This phase is mechanical. After Phase A, the tree must compile (although you will run typecheck only at the very end of the plan). Within Phase A, do not stop midway — the tree will be inconsistent until all sub-tasks finish.

### Task A1: Move and rename core interface and types

**Files:**
- Move: `packages/core/src/interfaces/ticket.interface.ts` → `packages/core/src/interfaces/issue.interface.ts`
- Move: `packages/core/src/types/ticket.types.ts` → `packages/core/src/types/issue.types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Move the files**

```bash
git mv packages/core/src/interfaces/ticket.interface.ts packages/core/src/interfaces/issue.interface.ts
git mv packages/core/src/types/ticket.types.ts packages/core/src/types/issue.types.ts
```

- [ ] **Step 2: Rewrite `issue.interface.ts`**

Replace the entire contents with:

```typescript
import type {
  CreateIssueOptions,
  CreateIssueResult,
  UpdateIssueOptions,
  UpdateIssueResult,
  GetIssueOptions,
  GetIssueResult,
  ListIssuesOptions,
  ListIssuesResult,
  GetIssueSchemaOptions,
  GetIssueSchemaResult,
  AddCommentOptions,
  AddCommentResult,
  UpdateStatusOptions,
  UpdateStatusResult,
} from "../types/issue.types.ts";

/**
 * Interface for issue tracker operations.
 * Implement this to add support for Jira, Linear, Monday, GitHub Issues, etc.
 */
export interface IIssueProvider {
  createIssue(opts: CreateIssueOptions): Promise<CreateIssueResult>;
  updateIssue(opts: UpdateIssueOptions): Promise<UpdateIssueResult>;
  getIssue(opts: GetIssueOptions): Promise<GetIssueResult>;
  listIssues(opts: ListIssuesOptions): Promise<ListIssuesResult>;
  getIssueSchema(opts: GetIssueSchemaOptions): Promise<GetIssueSchemaResult>;
  addComment(opts: AddCommentOptions): Promise<AddCommentResult>;
  updateStatus(opts: UpdateStatusOptions): Promise<UpdateStatusResult>;
}
```

- [ ] **Step 3: Rewrite `issue.types.ts`**

Replace the entire contents with the renamed type set. Substitutions used: `Ticket` → `Issue`, `ticket` (object property) → `issue`, `tickets` (array property) → `issues`, all `*Ticket*` option/result names → `*Issue*`. Keep `TicketComment` → `IssueComment`, `TicketField` → `IssueField`. Field `id` stays `id` (unrelated to `issueRef`).

```typescript
import type { SessionOptions, SessionResult } from "./session.types.ts";

export type IssueComment = {
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

export type IssueField = {
  id: string;
  name: string;
  type?: string;
  required?: boolean;
  allowedValues?: string[];
};

export type Issue = {
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
  comments?: IssueComment[];
  attachments?: Attachment[];
  customFields?: Record<string, unknown>;
};

export type CreateIssueOptions = SessionOptions & {
  title: string;
  description?: string;
  assignee?: string;
  labels?: string[];
  projectId?: string;
  status?: string;
  customFields?: Record<string, unknown>;
};

export type CreateIssueResult = SessionResult & {
  issue?: Issue;
  error?: string;
};

export type UpdateIssueOptions = SessionOptions & {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  assignee?: string;
  labels?: string[];
  priority?: string;
  customFields?: Record<string, unknown>;
};

export type UpdateIssueResult = SessionResult & {
  issue?: Issue;
  error?: string;
};

export type GetIssueOptions = SessionOptions & {
  id: string;
};

export type GetIssueResult = SessionResult & {
  issue?: Issue;
  error?: string;
};

export type ListIssuesOptions = SessionOptions & {
  projectId?: string;
  status?: string;
  assignee?: string;
};

export type ListIssuesResult = SessionResult & {
  issues: Issue[];
  error?: string;
};

export type GetIssueSchemaOptions = SessionOptions & {
  issueRef: string;
  projectId?: string;
};

export type GetIssueSchemaResult = SessionResult & {
  fields: IssueField[];
  error?: string;
};

export type AddCommentOptions = SessionOptions & {
  id: string;
  body: string;
};

export type AddCommentResult = SessionResult & {
  comment?: IssueComment;
  error?: string;
};

export type UpdateStatusOptions = SessionOptions & {
  id: string;
  status: string;
};

export type UpdateStatusResult = SessionResult & {
  issue?: Issue;
  error?: string;
};
```

- [ ] **Step 4: Update `packages/core/src/index.ts`**

Find the lines:

```typescript
export type { ITicketProvider } from "./interfaces/ticket.interface.ts";
```
and
```typescript
export type * from "./types/ticket.types.ts";
```

Replace with:

```typescript
export type { IIssueProvider } from "./interfaces/issue.interface.ts";
```
and
```typescript
export type * from "./types/issue.types.ts";
```

### Task A2: Update `pipeline.interface.ts`

**Files:**
- Modify: `packages/core/src/interfaces/pipeline.interface.ts`

- [ ] **Step 1: Replace the import**

Find:
```typescript
import type { ITicketProvider } from "./ticket.interface.ts";
```
Replace with:
```typescript
import type { IIssueProvider } from "./issue.interface.ts";
```

- [ ] **Step 2: Replace the field**

Find the providers map field (around line 21):
```typescript
    ticket: ITicketProvider;
```
Replace with:
```typescript
    issue: IIssueProvider;
```

### Task A3: Rename ticket-provider implementations

**Files:**
- Modify: `packages/ticket-provider/src/providers/jira/index.ts`
- Modify: `packages/ticket-provider/src/providers/github-issues/index.ts`
- Modify: `packages/ticket-provider/src/providers/github-projects/index.ts`
- Modify: `packages/ticket-provider/src/providers/linear/index.ts`
- Modify: `packages/ticket-provider/src/providers/monday/index.ts`
- Modify: `packages/ticket-provider/src/index.ts`

- [ ] **Step 1: In each provider `index.ts`, update the import**

Find:
```typescript
import type { ITicketProvider, IProviderMeta } from "@journeyman/core";
```
Replace with:
```typescript
import type { IIssueProvider, IProviderMeta } from "@journeyman/core";
```

- [ ] **Step 2: In each provider `index.ts`, update the `implements` clause**

Find:
```typescript
implements ITicketProvider
```
Replace with:
```typescript
implements IIssueProvider
```

- [ ] **Step 3: Rename method names on each implementation**

Find and replace inside the class bodies (one occurrence each):

| Old method name | New method name |
|---|---|
| `createTicket` | `createIssue` |
| `updateTicket` | `updateIssue` |
| `getTicket` | `getIssue` |
| `listTickets` | `listIssues` |
| `getTicketSchema` | `getIssueSchema` |

(Method names that are not on the interface — e.g. helpers — stay as-is unless they leak `Ticket` in the name.)

- [ ] **Step 4: Rewrite `packages/ticket-provider/src/index.ts`**

Find:
```typescript
export type { ITicketProvider } from "@journeyman/core";
```
Replace with:
```typescript
export type { IIssueProvider } from "@journeyman/core";
```

### Task A4: Move and rename phase metas in `packages/phases/src/tickets/`

**Files:**
- Move: `packages/phases/src/tickets/` → `packages/phases/src/issues/`
- Modify: every file inside (rename + content updates)

- [ ] **Step 1: Move the directory and rename files**

```bash
git mv packages/phases/src/tickets packages/phases/src/issues
cd packages/phases/src/issues
git mv get-ticket.meta.ts get-issue.meta.ts
git mv get-ticket.tsx get-issue.tsx
git mv create-ticket.meta.ts create-issue.meta.ts
git mv create-ticket.tsx create-issue.tsx
git mv comment-on-ticket.meta.ts comment-on-issue.meta.ts
git mv comment-on-ticket.tsx comment-on-issue.tsx
git mv transition-ticket.meta.ts transition-issue.meta.ts
git mv transition-ticket.tsx transition-issue.tsx
git mv update-ticket-fields.meta.ts update-issue-fields.meta.ts
git mv update-ticket-fields.tsx update-issue-fields.tsx
cd -
```

- [ ] **Step 2: In every renamed `*.meta.ts`, apply the rename to identifiers and string constants**

Apply these substitutions inside each file:

| Old | New |
|---|---|
| `GET_TICKET_PHASE_TYPE` | `GET_ISSUE_PHASE_TYPE` |
| `GET_TICKET_LABEL` | `GET_ISSUE_LABEL` |
| `GET_TICKET_CATEGORY` | `GET_ISSUE_CATEGORY` |
| `GET_TICKET_DESCRIPTION` | `GET_ISSUE_DESCRIPTION` |
| `getTicketOutputSchema` | `getIssueOutputSchema` |
| `getTicketInputFields` | `getIssueInputFields` |
| `"get-ticket"` | `"get-issue"` |
| `"Get Ticket"` | `"Get Issue"` |

…and the equivalent for `CREATE`, `UPDATE_TICKET_FIELDS`, `TRANSITION`, `COMMENT_ON_TICKET`. Specifically the new phase-type strings are:

| Phase | New `_PHASE_TYPE` value |
|---|---|
| Get | `"get-issue"` |
| Create | `"create-issue"` |
| Update fields | `"update-issue-fields"` |
| Transition | `"transition-issue"` |
| Comment | `"comment-on-issue"` |

For `*_LABEL`: `"Get Issue"`, `"Create Issue"`, `"Update Issue Fields"`, `"Transition Issue"`, `"Comment on Issue"`.

In `get-issue.meta.ts` specifically: the output field `id` → `issue` (the entire issue object), with shape changes deferred to Phase B. **For now in Phase A, change the output schema to match the renamed types but keep using the legacy `OutputFieldSchema` form.** Update `getIssueOutputSchema` to:

```typescript
export const getIssueOutputSchema: OutputSchema = {
  issue: { type: "json", description: "The fetched Issue object" },
};
```

(`json` is an existing `OutputFieldType`; this is a temporary shape until Phase B.)

- [ ] **Step 3: In every renamed `*.tsx`, update the imports and identifiers**

Each `*.tsx` imports its sibling `*.meta.ts`. Update:

```typescript
// example for get-issue.tsx
import {
  GET_ISSUE_PHASE_TYPE,
  GET_ISSUE_LABEL,
  GET_ISSUE_CATEGORY,
  GET_ISSUE_DESCRIPTION,
  getIssueOutputSchema,
  getIssueInputFields,
} from "./get-issue.meta.ts";
```

Rename the exported `PhaseDefinition` constant: `getTicketPhase` → `getIssuePhase`, `createTicketPhase` → `createIssuePhase`, `updateTicketFieldsPhase` → `updateIssueFieldsPhase`, `transitionTicketPhase` → `transitionIssuePhase`, `commentOnTicketPhase` → `commentOnIssuePhase`. Update `phaseType` literal field to the new value.

### Task A5: Update `packages/phases/src/registry.ts`

**Files:**
- Modify: `packages/phases/src/registry.ts`

- [ ] **Step 1: Replace imports and registry entries**

Find:
```typescript
import { getTicketPhase } from "./tickets/get-ticket.tsx";
import { createTicketPhase } from "./tickets/create-ticket.tsx";
import { updateTicketFieldsPhase } from "./tickets/update-ticket-fields.tsx";
import { transitionTicketPhase } from "./tickets/transition-ticket.tsx";
import { commentOnTicketPhase } from "./tickets/comment-on-ticket.tsx";
```

Replace with:
```typescript
import { getIssuePhase } from "./issues/get-issue.tsx";
import { createIssuePhase } from "./issues/create-issue.tsx";
import { updateIssueFieldsPhase } from "./issues/update-issue-fields.tsx";
import { transitionIssuePhase } from "./issues/transition-issue.tsx";
import { commentOnIssuePhase } from "./issues/comment-on-issue.tsx";
```

Find:
```typescript
  // Issue Tracker
  getTicketPhase, createTicketPhase, updateTicketFieldsPhase, transitionTicketPhase, commentOnTicketPhase,
```

Replace with:
```typescript
  // Issue Tracker
  getIssuePhase, createIssuePhase, updateIssueFieldsPhase, transitionIssuePhase, commentOnIssuePhase,
```

### Task A6: Update `packages/phases/src/catalog.ts`

**Files:**
- Modify: `packages/phases/src/catalog.ts`

- [ ] **Step 1: Replace the five `import { ... } from "./tickets/*.meta.ts"` blocks**

Replace each import block to reference the new paths and renamed identifiers. The five replacement blocks:

```typescript
import {
  GET_ISSUE_PHASE_TYPE, GET_ISSUE_LABEL, GET_ISSUE_CATEGORY, GET_ISSUE_DESCRIPTION,
  getIssueOutputSchema, getIssueInputFields,
} from "./issues/get-issue.meta.ts";
import {
  CREATE_ISSUE_PHASE_TYPE, CREATE_ISSUE_LABEL, CREATE_ISSUE_CATEGORY, CREATE_ISSUE_DESCRIPTION,
  createIssueOutputSchema, createIssueInputFields,
} from "./issues/create-issue.meta.ts";
import {
  UPDATE_ISSUE_FIELDS_PHASE_TYPE, UPDATE_ISSUE_FIELDS_LABEL, UPDATE_ISSUE_FIELDS_CATEGORY,
  UPDATE_ISSUE_FIELDS_DESCRIPTION,
  updateIssueFieldsOutputSchema, updateIssueFieldsInputFields,
} from "./issues/update-issue-fields.meta.ts";
import {
  TRANSITION_ISSUE_PHASE_TYPE, TRANSITION_ISSUE_LABEL, TRANSITION_ISSUE_CATEGORY,
  TRANSITION_ISSUE_DESCRIPTION,
  transitionIssueOutputSchema, transitionIssueInputFields,
} from "./issues/transition-issue.meta.ts";
import {
  COMMENT_ON_ISSUE_PHASE_TYPE, COMMENT_ON_ISSUE_LABEL, COMMENT_ON_ISSUE_CATEGORY,
  COMMENT_ON_ISSUE_DESCRIPTION,
  commentOnIssueOutputSchema, commentOnIssueInputFields,
} from "./issues/comment-on-issue.meta.ts";
```

- [ ] **Step 2: Replace the five "Issue Tracker" entries in `phaseCatalog`**

Find the block:
```typescript
  // Issue Tracker
  { phaseType: GET_TICKET_PHASE_TYPE,           label: GET_TICKET_LABEL,           ...
  // ... 5 lines
```

Replace with:
```typescript
  // Issue Tracker
  { phaseType: GET_ISSUE_PHASE_TYPE,           label: GET_ISSUE_LABEL,           category: GET_ISSUE_CATEGORY,           description: GET_ISSUE_DESCRIPTION,           inputFields: getIssueInputFields,           outputSchema: getIssueOutputSchema },
  { phaseType: CREATE_ISSUE_PHASE_TYPE,        label: CREATE_ISSUE_LABEL,        category: CREATE_ISSUE_CATEGORY,        description: CREATE_ISSUE_DESCRIPTION,        inputFields: createIssueInputFields,        outputSchema: createIssueOutputSchema },
  { phaseType: UPDATE_ISSUE_FIELDS_PHASE_TYPE, label: UPDATE_ISSUE_FIELDS_LABEL, category: UPDATE_ISSUE_FIELDS_CATEGORY, description: UPDATE_ISSUE_FIELDS_DESCRIPTION, inputFields: updateIssueFieldsInputFields, outputSchema: updateIssueFieldsOutputSchema },
  { phaseType: TRANSITION_ISSUE_PHASE_TYPE,    label: TRANSITION_ISSUE_LABEL,    category: TRANSITION_ISSUE_CATEGORY,    description: TRANSITION_ISSUE_DESCRIPTION,    inputFields: transitionIssueInputFields,    outputSchema: transitionIssueOutputSchema },
  { phaseType: COMMENT_ON_ISSUE_PHASE_TYPE,    label: COMMENT_ON_ISSUE_LABEL,    category: COMMENT_ON_ISSUE_CATEGORY,    description: COMMENT_ON_ISSUE_DESCRIPTION,    inputFields: commentOnIssueInputFields,    outputSchema: commentOnIssueOutputSchema },
```

### Task A7: Update `provider-catalog.ts`

**Files:**
- Modify: `packages/core/src/registries/provider-catalog.ts`

- [ ] **Step 1: Update the `kind` union**

Find the literal `"ticket-provider"` in the kind union at the top of the file (around line 6) and replace with `"issue-provider"`.

- [ ] **Step 2: Update each `{ kind: "ticket-provider", ... }` entry**

Replace `kind: "ticket-provider"` with `kind: "issue-provider"` in all five entries (jira, github-issues, github-projects, linear, monday).

- [ ] **Step 3: Update phase-to-provider map**

Find the block:
```typescript
  // ticket-provider
  "comment-on-ticket":   "ticket-provider",
  "create-ticket":       "ticket-provider",
  "get-ticket":          "ticket-provider",
  "transition-ticket":   "ticket-provider",
  "update-ticket-fields":"ticket-provider",
```

Replace with:
```typescript
  // issue-provider
  "comment-on-issue":     "issue-provider",
  "create-issue":         "issue-provider",
  "get-issue":            "issue-provider",
  "transition-issue":     "issue-provider",
  "update-issue-fields":  "issue-provider",
```

### Task A8: Move and rename orchestrator phase handlers

**Files:**
- Move and modify: 5 files in `packages/orchestrator/src/workers/phases/`

- [ ] **Step 1: Rename the files**

```bash
cd packages/orchestrator/src/workers/phases
git mv get-ticket-phase-handler.ts get-issue-phase-handler.ts
git mv create-ticket-phase-handler.ts create-issue-phase-handler.ts
git mv comment-on-ticket-phase-handler.ts comment-on-issue-phase-handler.ts
git mv transition-ticket-phase-handler.ts transition-issue-phase-handler.ts
git mv update-ticket-fields-phase-handler.ts update-issue-fields-phase-handler.ts
cd -
```

- [ ] **Step 2: In each renamed handler, apply substitutions**

For each file, apply:

| Old | New |
|---|---|
| `ITicketProvider` | `IIssueProvider` |
| `ProviderFactory<ITicketProvider>` | `ProviderFactory<IIssueProvider>` |
| `{ ticket: ProviderFactory<...> }` | `{ issue: ProviderFactory<...> }` |
| `this.deps.ticket(` | `this.deps.issue(` |
| `phaseType = "get-ticket"` | `phaseType = "get-issue"` |
| `phaseType = "create-ticket"` | `phaseType = "create-issue"` |
| `phaseType = "comment-on-ticket"` | `phaseType = "comment-on-issue"` |
| `phaseType = "transition-ticket"` | `phaseType = "transition-issue"` |
| `phaseType = "update-ticket-fields"` | `phaseType = "update-issue-fields"` |
| `.getTicket(` | `.getIssue(` |
| `.createTicket(` | `.createIssue(` |
| `.updateTicket(` | `.updateIssue(` |
| `.listTickets(` | `.listIssues(` |
| `.getTicketSchema(` | `.getIssueSchema(` |
| Class names `GetTicketPhaseHandler`, etc. | `GetIssuePhaseHandler`, etc. |

- [ ] **Step 3: Update the export points that import these handlers**

Search the orchestrator package for any `import` of the old handler class names or paths:

Run: `grep -rn "TicketPhaseHandler\|ticket-phase-handler" packages/orchestrator/src --include="*.ts"`

Update each match to the new identifiers and paths.

### Task A9: Update orchestrator composition (`cli-worker.ts`)

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 1: Update the import**

Find the named import line including `ITicketProvider` and replace with `IIssueProvider`.

- [ ] **Step 2: Rename the provider variable**

Find:
```typescript
const ticket: ProviderFactory<ITicketProvider> = (key, env) => {
```

Replace with:
```typescript
const issue: ProviderFactory<IIssueProvider> = (key, env) => {
```

- [ ] **Step 3: Update every downstream reference**

Run: `grep -n "ticket" packages/orchestrator/src/cli-worker.ts`

For each remaining occurrence that refers to the provider factory (not the unrelated word "ticket" in comments about external systems), rename `ticket` → `issue`. Update any object-literal field passing `ticket: ticket` to phase handler constructors → `issue: issue`. Update the handler-name imports updated in A8 if they're referenced here.

### Task A10: Update api-server composition and routes

**Files:**
- Modify: `packages/api-server/src/composition.ts`
- Modify: `packages/api-server/src/routes/runs.ts`
- Modify: `packages/api-server/src/server.ts`
- Modify: `packages/api-server/src/schemas/update-flow.ts`
- Modify: `packages/api-server/src/routes/webhooks.ts` (only where `ticket` refers to provider/object — `issueRef` parsing stays)

- [ ] **Step 1: Search for ticket references in api-server**

Run: `grep -rn "ticket\|Ticket" packages/api-server/src --include="*.ts"`

- [ ] **Step 2: For each match, decide and apply**

Apply these substitutions:

- `ITicketProvider` → `IIssueProvider`
- `TicketProvider` (factory variable) → `IssueProvider` or `issue` (match the surrounding code style)
- `tickets:` (object key when binding the issue provider in composition) → `issue:`
- Phase-type literal strings `"get-ticket"`, etc. → `"get-issue"`, etc.
- Validation lists in `update-flow.ts` referencing old phase types → new ones
- Identifier `ticketProviderKey` (if present) → `issueProviderKey`

Leave alone:
- `issueRef` parsing in `webhooks.ts` (already correct)
- Variable `issueRef` (already correct)
- Any external SaaS naming where the SaaS literally calls something a "ticket" in its own API (unlikely to appear in this code)

### Task A11: Update coding-cli operations to use `issue` instead of `ticket`

**Files:**
- Modify (Claude provider): `packages/coding-cli/src/providers/claude/operations/checkout-repo.ts`, `analyze.ts`, `cleanup-repos.ts`, `plan.ts`, `commit-push-repos.ts`, `implement.ts`, `create-workspace.ts`
- Modify (OpenCode provider): `packages/coding-cli/src/providers/opencode/operations/checkout-repo.ts`, `analyze.ts`, `plan.ts`, `implement.ts`, `commit-push-repos.ts`
- Modify: `packages/core/src/types/coding.types.ts` (operation option types)
- Modify: `packages/core/src/interfaces/coding-cli.interface.ts` (if present and references `ticket`)
- Modify: `packages/core/src/types/git.types.ts` (if it has `ticket` field)

- [ ] **Step 1: Search for `ticket` and `Ticket` in coding-cli and related core types**

Run:
```bash
grep -rn "ticket\|Ticket" packages/coding-cli/src packages/core/src/types/coding.types.ts packages/core/src/types/git.types.ts packages/core/src/interfaces/coding-cli.interface.ts --include="*.ts"
```

- [ ] **Step 2: Apply substitutions in operation option/return types**

In `coding.types.ts` and similar:

- `ticket?:` (object property) → `issue?:`
- `ticket: { id; title }` → `issue: { id; title }` (kept with same fields for now; full `Issue` shape adoption is Phase B)

- [ ] **Step 3: Apply substitutions in operation implementations**

For each operation file, replace `opts.ticket` → `opts.issue` and any local variable named `ticket` (when it refers to the issue object) → `issue`. Log lines that include `issueRef: opts.ticket?.id` → `issueRef: opts.issue?.id`.

### Task A12: Update non-issue phase handlers that use `input.ticket`

**Files:**
- Modify: `packages/orchestrator/src/workers/phases/start-feature-branch-phase-handler.ts`
- Modify: `packages/orchestrator/src/workers/phases/create-workspace-phase-handler.ts` (if applicable)
- Modify: any other handler that reads `input.ticket`

- [ ] **Step 1: Find all `input.ticket` reads outside the issue handlers**

Run:
```bash
grep -rn "input\.ticket\|input as.*ticket" packages/orchestrator/src/workers/phases --include="*.ts" | grep -v -E "(get-issue|create-issue|comment-on-issue|transition-issue|update-issue-fields)"
```

- [ ] **Step 2: For each match, rename `input.ticket` → `input.issue`**

Inside `start-feature-branch-phase-handler.ts`, change all reads of `(input as ...).ticket` and `input.ticket` to use `issue`. Update the destructured object name from `ticketRaw` → `issueRaw`, `ticket` (local variable) → `issue`. The call to `coding.checkoutRepo` then passes `issue` (matching the new option type from A11).

### Task A13: Update flow-editor `start-feature-branch.meta.ts` input field name

**Files:**
- Modify: `packages/phases/src/repos/start-feature-branch.meta.ts`

- [ ] **Step 1: Rename the input key**

Find:
```typescript
  ticket: { type: "string", label: "Ticket", bindOnly: true },
```
Replace with:
```typescript
  issue: { type: "string", label: "Issue", bindOnly: true },
```

(Type and bindOnly stay; full shape adoption happens in Phase B.)

- [ ] **Step 2: Search for any other phase meta with `ticket:` input**

Run: `grep -rn '"ticket"\|^\s*ticket:' packages/phases/src --include="*.ts" --include="*.tsx"`

For each match where the field carries the issue object (not the `issueRef` string), apply the same rename.

### Task A14: Update flow-editor UI strings, default labels, and copy

**Files:**
- Modify: `packages/flow-editor/src/**` (all files containing `ticket`/`Ticket` referring to the issue object or Issue Tracker phases)

- [ ] **Step 1: Search**

Run: `grep -rn "ticket\|Ticket" packages/flow-editor/src --include="*.ts" --include="*.tsx"`

- [ ] **Step 2: Apply**

Substitutions applied case-by-case (the word "ticket" appears in places like `RunInputsEditor`, `DefaultsExecutorSection`, `executor-common-config`):

- `ticket-provider` → `issue-provider`
- `"ticket"` (provider kind in code) → `"issue"`
- `"Ticket"` (label/title strings) → `"Issue"`
- Phase ID strings — same map as Task A8

Leave alone any references inside files that are themselves slated for further changes in Phase B (re-edit them then). Currently nothing in flow-editor references the catalog's old phase-type strings except the picker and config tab, which Phase B will rewrite.

### Task A15: Update phase descriptions and human-readable strings

**Files:**
- Modify: every renamed `*.meta.ts` under `packages/phases/src/issues/` (descriptions)
- Modify: any `*_DESCRIPTION` constants exported from non-issues phases that use the word "ticket"

- [ ] **Step 1: Search descriptions**

Run: `grep -rn "ticket" packages/phases/src --include="*.ts" --include="*.tsx"`

- [ ] **Step 2: For each match in a `*_DESCRIPTION` literal, replace "ticket" with "issue"**

Apply textual substitution. Example: `"Fetch a ticket from the configured tracker."` → `"Fetch an issue from the configured tracker."`

### Task A16: Update remaining stragglers across the monorepo

**Files:**
- Any file still containing `ticket` after the prior tasks

- [ ] **Step 1: Final sweep**

Run:
```bash
grep -rn "ticket\|Ticket" packages --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v node_modules
```

- [ ] **Step 2: Apply renames or document exceptions**

For each remaining match, apply the rename if it refers to the issue concept. Acceptable to leave:
- comments referencing prior commits or external links
- the `2026-05-02-issue-ref-rename-design.md` and existing plan/spec docs (those describe historical state)

If a match clearly belongs to issue/issue-provider semantics, rename it.

---

## Phase B — Typed binding system (workstream 2)

Phase B introduces the new `Shape` type system, migrates every phase meta, upgrades the picker, and adds shape-checking validation.

### Task B1: Create `Shape` type definitions

**Files:**
- Create: `packages/core/src/types/shape.types.ts`

- [ ] **Step 1: Write the file**

```typescript
/**
 * Shape — the runtime-resolved type of a value flowing through the pipeline.
 * Phase outputs and inputs declare shapes; the flow editor uses them to render
 * the value picker and validate ref bindings at flow-save time.
 *
 * Discriminated union; resolveShape() flattens "ref" entries against the
 * named-shape registry in shapes.ts.
 */
export type Shape =
  | { type: "string";  description?: string }
  | { type: "number";  description?: string }
  | { type: "boolean"; description?: string }
  | { type: "object";  fields: Record<string, Shape>; named?: string; description?: string }
  | { type: "array";   items: Shape; description?: string }
  | { type: "ref";     name: string; description?: string };

/**
 * Replacement for the legacy InputFieldMeta. Each input now declares a Shape
 * rather than a primitive type string.
 */
export interface InputField {
  shape: Shape;
  label?: string;
  required?: boolean;
  /** No typed UI; must be bound from upstream. */
  bindOnly?: boolean;
}
export type InputFields = Record<string, InputField>;

/**
 * Replacement for the legacy OutputSchema. Each output field declares a Shape.
 */
export type OutputSchema = Record<string, Shape>;
```

### Task B2: Create the named-shape registry

**Files:**
- Create: `packages/core/src/types/shapes.ts`

- [ ] **Step 1: Write the file**

```typescript
import type { Shape } from "./shape.types.ts";

export const Issue: Shape = {
  type: "object",
  named: "Issue",
  fields: {
    issueRef:      { type: "string", description: "Canonical namespaced identifier (e.g. jira:PROJ-123)" },
    issueRefShort: { type: "string", description: "Short display ref (e.g. PROJ-123)" },
    id:            { type: "string", description: "Provider-native id" },
    title:         { type: "string" },
    description:   { type: "string" },
    status:        { type: "string" },
    assignee:      { type: "string" },
    labels:        { type: "array", items: { type: "string" } },
    url:           { type: "string" },
    priority:      { type: "string" },
    issueType:     { type: "string" },
    reporter:      { type: "string" },
    createdAt:     { type: "string" },
    updatedAt:     { type: "string" },
  },
};

export const Repo: Shape = {
  type: "object",
  named: "Repo",
  fields: {
    repoDir:   { type: "string", description: "Local checkout directory" },
    branch:    { type: "string", description: "Current branch in this repo" },
    newBranch: { type: "string", description: "The feature branch created on this repo (if any)" },
  },
};

export const PullRequest: Shape = {
  type: "object",
  named: "PullRequest",
  fields: {
    id:     { type: "string" },
    number: { type: "number" },
    url:    { type: "string" },
    title:  { type: "string" },
    state:  { type: "string" },
    head:   { type: "string" },
    base:   { type: "string" },
  },
};

export const Workspace: Shape = {
  type: "object",
  named: "Workspace",
  fields: {
    folderName: { type: "string" },
    repoDir:    { type: "string" },
  },
};

export const NAMED_SHAPES: Record<string, Shape> = {
  Issue,
  Repo,
  PullRequest,
  Workspace,
};

/**
 * Recursively resolve "ref" shapes against the registry. Throws on unknown
 * names. Idempotent on already-resolved shapes.
 */
export function resolveShape(s: Shape): Shape {
  if (s.type === "ref") {
    const target = NAMED_SHAPES[s.name];
    if (!target) throw new Error(`Unknown named shape: ${s.name}`);
    return resolveShape(target);
  }
  if (s.type === "object") {
    const fields: Record<string, Shape> = {};
    for (const [k, v] of Object.entries(s.fields)) fields[k] = resolveShape(v);
    return { ...s, fields };
  }
  if (s.type === "array") {
    return { ...s, items: resolveShape(s.items) };
  }
  return s;
}

/**
 * Structural equality after resolution. Used by ref-shape validator to compare
 * the producer's leaf shape to the consumer's declared input shape.
 */
export function shapesEqual(a: Shape, b: Shape): boolean {
  const ra = resolveShape(a);
  const rb = resolveShape(b);
  if (ra.type !== rb.type) return false;
  if (ra.type === "object" && rb.type === "object") {
    const ak = Object.keys(ra.fields).sort();
    const bk = Object.keys(rb.fields).sort();
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i++) {
      if (ak[i] !== bk[i]) return false;
      if (!shapesEqual(ra.fields[ak[i]], rb.fields[bk[i]])) return false;
    }
    return true;
  }
  if (ra.type === "array" && rb.type === "array") {
    return shapesEqual(ra.items, rb.items);
  }
  return true; // scalars of equal `type`
}

/**
 * Walk a dotted path against a shape, resolving "ref" along the way.
 * Returns null if any segment doesn't resolve. Empty path returns the input.
 */
export function shapeAtPath(root: Shape, path: string[]): Shape | null {
  let cur: Shape = resolveShape(root);
  for (const seg of path) {
    if (cur.type === "object") {
      const next = cur.fields[seg];
      if (!next) return null;
      cur = resolveShape(next);
    } else if (cur.type === "array") {
      // Convention: array path uses "[item]" or numeric index; both resolve to items.
      cur = resolveShape(cur.items);
    } else {
      return null;
    }
  }
  return cur;
}
```

### Task B3: Replace `OutputSchema` and `InputFieldMeta` definitions

**Files:**
- Modify: `packages/core/src/types/phase-handler.types.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/phases/src/shared-meta.ts`

- [ ] **Step 1: Update `phase-handler.types.ts`**

Replace the bottom block (from `export type OutputFieldType` to end-of-file):

```typescript
export type OutputFieldType = "string" | "number" | "boolean" | "string[]" | "json" | "enum";

export interface OutputFieldSchema {
  type: OutputFieldType;
  description?: string;
  values?: readonly string[];
}

export type OutputSchema = Record<string, OutputFieldSchema>;
```

with:

```typescript
export type { OutputSchema } from "./shape.types.ts";
```

- [ ] **Step 2: Update `packages/core/src/index.ts`**

Find the line:
```typescript
export type {
  ... OutputSchema, OutputFieldSchema, OutputFieldType, ...
```

Remove `OutputFieldSchema` and `OutputFieldType` from that re-export. Keep `OutputSchema` (it now flows from `shape.types.ts`).

Add a new export block:

```typescript
export type { Shape, InputField, InputFields } from "./types/shape.types.ts";
export { Issue, Repo, PullRequest, Workspace, NAMED_SHAPES, resolveShape, shapesEqual, shapeAtPath } from "./types/shapes.ts";
```

- [ ] **Step 3: Update `packages/phases/src/shared-meta.ts`**

Replace its entire contents with:

```typescript
// packages/phases/src/shared-meta.ts
export type { InputField, InputFields } from "@journeyman/core";
```

(All in-tree consumers that imported `InputFieldMeta` from this file will get the new `InputField` instead via the type re-export. Identifier rename in B4.)

### Task B4: Migrate every phase meta to the new `Shape` system

**Files:**
- Modify: every `*.meta.ts` under `packages/phases/src/`

- [ ] **Step 1: Find all meta files**

Run: `find packages/phases/src -name '*.meta.ts'`

- [ ] **Step 2: For each meta file, rewrite `*OutputSchema` and `*InputFields`**

The mechanical mapping:

- `{ type: "string" }` → `{ type: "string" }` (unchanged but description preserved)
- `{ type: "number" }` → `{ type: "number" }`
- `{ type: "boolean" }` → `{ type: "boolean" }`
- `{ type: "string[]" }` → `{ type: "array", items: { type: "string" } }`
- `{ type: "json", description: "Array of { foo, bar } per row" }` (where description hints at array-of-object) → use the proper `Shape`. Inspect the corresponding handler to confirm the actual emitted shape, then either reference a named shape (`{ type: "ref", name: "Repo" }` for an array-of-Repo, etc.) or declare an inline object/array shape.
- `{ type: "enum", values: [...] }` → `{ type: "string", description: "One of: a|b|c" }` (no enum primitive in `Shape`; encode as documented string. If you want strict enum semantics, leave a TODO comment in the meta — but per spec we are not adding enum support.)

For inputs:

- Wrap each input value in `{ shape: <Shape>, label, required, bindOnly }`. Convert old `type: "string"` field to `{ shape: { type: "string" } }`, etc.
- Replace any `type: "json"` input (which previously meant "any JSON") with the actual expected shape — almost always a named shape (`Issue`, `Repo[]`, `Workspace`, …). Inspect the handler to determine.

Phase-specific guidance:

| Meta file | OutputSchema → | InputFields → |
|---|---|---|
| `issues/get-issue.meta.ts` | `{ issue: { type: "ref", name: "Issue" } }` | `{ issueRef: { shape: { type: "string" }, label: "Issue ref", required: true } }` |
| `issues/create-issue.meta.ts` | `{ issue: { type: "ref", name: "Issue" } }` | inputs match `CreateIssueOptions` minus session — typically scalars |
| `issues/update-issue-fields.meta.ts` | `{ issue: { type: "ref", name: "Issue" } }` | scalars + `issueRef` |
| `issues/transition-issue.meta.ts` | `{ issue: { type: "ref", name: "Issue" } }` | scalars |
| `issues/comment-on-issue.meta.ts` | `{ comment: { type: "object", fields: { id: { type: "string" }, body: { type: "string" }, author: { type: "string" }, createdAt: { type: "string" } } } }` | scalars + `issueRef` + `body` |
| `repos/clone-repos.meta.ts` (if has output) | `{ repos: { type: "array", items: { type: "ref", name: "Repo" } } }` | match existing inputs |
| `repos/start-feature-branch.meta.ts` | `{ newBranch: { type: "string" }, repos: { type: "array", items: { type: "ref", name: "Repo" } } }` | `{ repos: { shape: { type: "array", items: { type: "ref", name: "Repo" } }, label: "Repos", required: true, bindOnly: true }, issue: { shape: { type: "ref", name: "Issue" }, label: "Issue", bindOnly: true } }` |
| `repos/create-workspace.meta.ts` | `{ folderName: { type: "string" }, repoDir: { type: "string" } }` | match existing |
| `repos/commit-and-push.meta.ts` | inspect handler; arrays of structured objects → `Repo[]` or new shape | inputs include `Repo[]` |
| `repos/cleanup-workspace.meta.ts` | scalars | inputs include `Repo[]` if applicable |
| `repos/list-workspace-files.meta.ts` | `{ files: { type: "array", items: { type: "string" } } }` (or per actual handler) | scalar(s) |
| `git/get-repository.meta.ts` | `{ repository: { type: "object", fields: { … as the handler emits } } }` (no `outputSchema: null` anymore — declare shape) | scalars |
| `git/clone-repos.meta.ts` | `{ repos: { type: "array", items: { type: "ref", name: "Repo" } } }` | scalars |
| `git/open-pull-request.meta.ts` | `{ pullRequest: { type: "ref", name: "PullRequest" } }` | scalars + repo |
| `git/list-pull-requests.meta.ts` | `{ pullRequests: { type: "array", items: { type: "ref", name: "PullRequest" } } }` | scalars |
| `git/comment-on-pull-request.meta.ts` | `{ comment: { type: "object", fields: { id: { type: "string" }, body: { type: "string" } } } }` | scalars |
| `git/list-pull-request-comments.meta.ts` | `{ comments: { type: "array", items: { type: "object", fields: { id: { type: "string" }, body: { type: "string" }, author: { type: "string" } } } } }` | scalars |
| `ai/analyze-repo.meta.ts` | inspect handler — likely `{ analysis: { type: "string" } }` or similar | scalars |
| `ai/plan-implementation.meta.ts` | inspect handler | scalars |
| `ai/implement-changes.meta.ts` | inspect handler | scalars |
| `notifications/send-message.meta.ts` | inspect handler | scalars |

When a meta currently has `outputSchema` set to `null` in `catalog.ts` (the "no outputSchema yet" entries from the Code Host group), now declare a real shape and update `catalog.ts` to drop the `null`.

- [ ] **Step 3: Update `catalog.ts` to import the new output schemas**

For each of the previously-`null` Code Host entries, add the `outputSchema` import and field. Example:

```typescript
import {
  CLONE_REPOS_PHASE_TYPE, ...
  cloneReposInputFields, cloneReposOutputSchema,
} from "./git/clone-repos.meta.ts";
```

Then in the `phaseCatalog` array, replace `outputSchema: null` with `outputSchema: cloneReposOutputSchema` and similarly for the others.

If after inspection a phase genuinely produces no output, leave `outputSchema: null` (the type allows it).

### Task B5: Update `useUpstreamSources` to emit `Shape`-typed fields

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/use-upstream-sources.ts`

- [ ] **Step 1: Update the field type**

Replace the `UpstreamField` interface:

```typescript
export interface UpstreamField {
  name: string;
  description?: string;
  scope: "input" | "output" | "run-input";
  shape: Shape;
}
```

Add the import:
```typescript
import type { Shape } from "@journeyman/core";
```

- [ ] **Step 2: Pull `shape` from catalog metas**

Where the function currently does:
```typescript
fields: inputEntries.map(([name, meta]) => ({ name, description: meta.label, scope: "input" })),
```

Replace with:
```typescript
fields: inputEntries.map(([name, meta]) => ({
  name,
  description: meta.label,
  scope: "input",
  shape: meta.shape,
})),
```

And for outputs:
```typescript
fields: outputEntries.map(([name, s]) => ({
  name,
  description: (s as { description?: string }).description,
  scope: "output",
  shape: s,
})),
```

- [ ] **Step 3: Run-inputs**

For run-inputs the `runInputs` array currently has `{ name, description? }`. Add `shape` to the run-input declaration on the start node:

```typescript
const runInputs = ((startNode?.config as {
  runInputs?: { name: string; description?: string; shape?: Shape }[]
} | undefined)?.runInputs ?? []);
```

Where it builds the `UpstreamSource`, default `shape` to `{ type: "string" }` if undefined (run-inputs without explicit shapes are scalars).

```typescript
fields: runInputs.map(r => ({
  name: r.name,
  description: r.description,
  scope: "run-input" as const,
  shape: r.shape ?? { type: "string" } as Shape,
})),
```

### Task B6: Create the `ShapeTree` component

**Files:**
- Create: `packages/flow-editor/src/properties-panel/ShapeTree.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from "react";
import type { Shape } from "@journeyman/core";
import { resolveShape, shapesEqual } from "@journeyman/core";

interface Props {
  /** Root shape for this node's output (or input/run-input). */
  shape: Shape;
  /** Path so far (used to compute the ref). */
  path: string[];
  /** Called when the user clicks a node to bind. */
  onBind: (path: string[]) => void;
  /** Optional alternate action — clicking the small "+" inserts ${ref} into existing text. */
  onInsert?: (path: string[]) => void;
  /** Consumer's expected shape; used to highlight compatible matches. */
  expected?: Shape;
}

export function ShapeTree({ shape, path, onBind, onInsert, expected }: Props) {
  const [open, setOpen] = useState(true);
  const resolved = resolveShape(shape);
  const compatible = expected ? shapesEqual(resolved, expected) : false;

  const label = labelFor(path, resolved);

  return (
    <div className={`vp-shape-node${compatible ? " vp-shape-node--compatible" : ""}`}>
      <div className="vp-shape-row">
        <button
          type="button"
          className="vp-shape-bind"
          onClick={() => onBind(path)}
          title={compatible ? "Bind (compatible)" : "Bind"}
        >
          {label}
        </button>
        {onInsert && (
          <button
            type="button"
            className="vp-shape-insert"
            onClick={() => onInsert(path)}
            title="insert ${...} into existing text"
          >+</button>
        )}
        {(resolved.type === "object" || resolved.type === "array") && (
          <button
            type="button"
            className="vp-shape-toggle"
            onClick={() => setOpen(o => !o)}
          >{open ? "▾" : "▸"}</button>
        )}
      </div>
      {open && resolved.type === "object" && (
        <ul className="vp-shape-children">
          {Object.entries(resolved.fields).map(([k, child]) => (
            <li key={k}>
              <ShapeTree
                shape={child}
                path={[...path, k]}
                onBind={onBind}
                onInsert={onInsert}
                expected={expected}
              />
            </li>
          ))}
        </ul>
      )}
      {open && resolved.type === "array" && (
        <ul className="vp-shape-children">
          <li>
            <ShapeTree
              shape={resolved.items}
              path={[...path, "[item]"]}
              onBind={onBind}
              onInsert={onInsert}
              expected={expected}
            />
          </li>
        </ul>
      )}
    </div>
  );
}

function labelFor(path: string[], s: Shape): string {
  const last = path.length === 0 ? "(root)" : path[path.length - 1];
  const tag = shapeTag(s);
  return `${last} : ${tag}`;
}

function shapeTag(s: Shape): string {
  switch (s.type) {
    case "string":
    case "number":
    case "boolean": return s.type;
    case "ref":     return s.name;
    case "object":  return s.named ?? "object";
    case "array":   return `${shapeTag(s.items)}[]`;
  }
}
```

### Task B7: Rewrite `ValuePicker.tsx` to use `ShapeTree`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/ValuePicker.tsx`

- [ ] **Step 1: Update props**

Add `expected?: Shape` to `Props`:

```tsx
import type { Shape } from "@journeyman/core";

interface Props {
  sources: UpstreamSource[];
  expected?: Shape;
  onPick: (ref: string) => void;
  onInsert?: (ref: string) => void;
  onClose: () => void;
}
```

- [ ] **Step 2: Replace the field-rendering block**

Replace the `cur?.groups.map(g => ...)` block with `ShapeTree` per group. Since each group now exposes `UpstreamField[]` where each field has its own `shape`, render one `ShapeTree` per field, rooted at that field's shape, with `path` starting at `[fieldName]`.

```tsx
{cur?.groups.map(g => (
  <div key={g.title} className="vp-group">
    <div className="vp-group-title">{g.title}</div>
    <ul className="vp-fields">
      {g.fields.map(f => (
        <li key={f.name}>
          <ShapeTree
            shape={f.shape}
            path={[f.name]}
            expected={expected}
            onBind={p => onPick(refForPath(cur!, g.scope, p))}
            onInsert={onInsert ? p => onInsert(refForPath(cur!, g.scope, p)) : undefined}
          />
        </li>
      ))}
      {/* ... existing custom-field affordance stays ... */}
    </ul>
  </div>
))}
```

- [ ] **Step 3: Replace `refFor` with path-aware `refForPath`**

```tsx
function refForPath(source: UpstreamSource, scope: UpstreamField["scope"], path: string[]): string {
  const tail = path.join(".");
  if (scope === "run-input") return `workflow.input.${tail}`;
  if (scope === "input")     return `${source.id}.input.${tail}`;
  /* output */               return `${source.id}.output.${tail}`;
}
```

Remove the old single-segment `refFor` now that paths can be deeper.

- [ ] **Step 4: Add minimal styling hooks**

If a CSS file accompanies the picker, add classes for `vp-shape-node`, `vp-shape-node--compatible`, `vp-shape-row`, `vp-shape-bind`, `vp-shape-insert`, `vp-shape-toggle`, `vp-shape-children`. (Visual polish out of scope; just give them sensible margins/indents so the tree is legible.)

### Task B8: Pass `expected` shape through `ConfigTab.tsx`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/ConfigTab.tsx`

- [ ] **Step 1: Compute and pass `expected`**

When opening the picker, look up the consumer field's declared shape from the catalog entry. The picker is opened from two places:

- The `renderFieldBindControl` button on a `bindOnly` field — `expected = catalogEntry.inputFields[key].shape`.
- The `renderFieldBindControl` button on a `configFields` field — these are scalar; `expected = { type: "string" }` (or pull from `configFields[key].type`-based mapping).

```tsx
const expectedFor = (key: string): Shape | undefined => {
  const meta = catalogEntry?.inputFields?.[key];
  if (meta?.shape) return meta.shape;
  return undefined;
};
```

Pass to `ValuePicker`:

```tsx
{pickerFor && (
  <div className="je-props__picker-popover">
    <ValuePicker
      sources={sources}
      expected={expectedFor(pickerFor)}
      onPick={ref => handlePick(pickerFor, ref)}
      onInsert={ref => handleInsert(pickerFor, ref)}
      onClose={() => setPickerFor(null)}
    />
  </div>
)}
```

### Task B9: Update `SchemaForm.tsx` for `Shape`-typed inputs

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/SchemaForm.tsx`

- [ ] **Step 1: Read the file**

Run: `cat packages/flow-editor/src/properties-panel/SchemaForm.tsx | head -60`

- [ ] **Step 2: Adapt rendering to `InputField.shape`**

Wherever the form picks a renderer based on the old `type: "string"|"number"|"boolean"|"json"` literal, switch on `field.shape.type`:

- `string`/`number`/`boolean` → existing scalar inputs
- `object` / `array` / `ref` → render the bindOnly placeholder + bind button (no inline editor). If the field is *not* bindOnly, show a notice: "Object/array values must be bound from upstream."

The `configFields` system (where phases declare scalar config knobs distinct from inputs) is unaffected; it predates this rework and continues to use its own type system.

### Task B10: Add ref-shape validation helper

**Files:**
- Create: `packages/orchestrator/src/flow-json/validate-ref-shape.ts`

- [ ] **Step 1: Write the helper**

```typescript
import type { FlowGraph, FlowNode, Shape } from "@journeyman/core";
import { resolveShape, shapeAtPath, shapesEqual } from "@journeyman/core";
import { phaseCatalog } from "@journeyman/phases/catalog";
import { parseRef } from "./resolve-inputs.ts";

const catalogByType = new Map(phaseCatalog.map(e => [e.phaseType, e]));

interface RefShapeResult {
  ok: boolean;
  /** Parsed, resolved shape at the ref's path; undefined when the ref didn't resolve. */
  shape?: Shape;
  /** Human-readable error if !ok. */
  error?: string;
}

/**
 * Resolve a ref string like "node.output.foo.bar" against the flow's nodes
 * and the phase catalog. Returns the leaf Shape, or an error.
 */
export function resolveRefShape(
  flow: FlowGraph,
  ref: string,
): RefShapeResult {
  const parsed = parseRef(ref);
  if (!parsed) return { ok: false, error: `Unparseable ref '${ref}'` };

  const path = parsed.field.split(".");

  if (parsed.scope === "workflow.input") {
    const startNode = flow.nodes.find(n => n.type === "start");
    const runInputs = ((startNode?.config as { runInputs?: { name: string; shape?: Shape }[] } | undefined)?.runInputs) ?? [];
    const decl = runInputs.find(r => r.name === path[0]);
    if (!decl) return { ok: false, error: `workflow.input.${path[0]} not declared` };
    const root = decl.shape ?? ({ type: "string" } as Shape);
    const leaf = shapeAtPath(root, path.slice(1));
    return leaf ? { ok: true, shape: leaf } : { ok: false, error: `Path not found: ${ref}` };
  }

  const node = flow.nodes.find(n => n.id === parsed.source);
  if (!node) return { ok: false, error: `Node '${parsed.source}' not found` };
  if (node.type !== "phase" || !node.phaseType) return { ok: false, error: `Node '${parsed.source}' is not a phase` };
  const entry = catalogByType.get(node.phaseType);
  if (!entry) return { ok: false, error: `Unknown phase type '${node.phaseType}'` };

  const root: Shape | undefined =
    parsed.scope === "output"
      ? entry.outputSchema?.[path[0]]
      : entry.inputFields?.[path[0]]?.shape;
  if (!root) return { ok: false, error: `Field '${parsed.scope}.${path[0]}' not declared on '${parsed.source}'` };

  const leaf = shapeAtPath(root, path.slice(1));
  return leaf ? { ok: true, shape: leaf } : { ok: false, error: `Path not found: ${ref}` };
}

/**
 * Validate a single binding: does the ref's leaf shape match the consumer's expected shape?
 */
export function validateRefShapeAgainst(
  flow: FlowGraph,
  ref: string,
  expected: Shape,
): { ok: boolean; error?: string } {
  const r = resolveRefShape(flow, ref);
  if (!r.ok || !r.shape) return { ok: false, error: r.error };
  if (!shapesEqual(r.shape, expected)) {
    return {
      ok: false,
      error: `Ref '${ref}' resolves to shape ${describeShape(r.shape)} but expected ${describeShape(expected)}`,
    };
  }
  return { ok: true };
}

function describeShape(s: Shape): string {
  const r = resolveShape(s);
  switch (r.type) {
    case "object": return r.named ?? "object";
    case "array":  return `${describeShape(r.items)}[]`;
    case "ref":    return r.name;
    default:       return r.type;
  }
}

export function isPhaseNode(n: FlowNode): n is FlowNode & { type: "phase"; phaseType: string } {
  return n.type === "phase" && !!n.phaseType;
}
```

### Task B11: Wire shape validation into `conductor-converter.ts`

**Files:**
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts`

- [ ] **Step 1: Import the new validator and the catalog**

Add imports at the top:

```typescript
import { validateRefShapeAgainst } from "./validate-ref-shape.ts";
import { phaseCatalog } from "@journeyman/phases/catalog";
```

- [ ] **Step 2: Extend `validate()`**

Locate the `for (const node of this.flow.nodes)` loop in `validate()` (around line 93). Inside the inner `for (const [field, val] of Object.entries(node.inputs ?? {}))` loop, after the existing dominator check (line 114), add:

```typescript
        // Shape compatibility (additive — only checked for phase nodes with declared shapes).
        if (node.type === "phase" && node.phaseType) {
          const entry = phaseCatalog.find(e => e.phaseType === node.phaseType);
          const expected = entry?.inputFields?.[field]?.shape;
          if (expected) {
            const result = validateRefShapeAgainst(this.flow, val.ref, expected);
            if (!result.ok) {
              throw new FlowValidationError(
                `Node '${node.id}' input '${field}': ${result.error}`,
              );
            }
          }
        }
```

### Task B12: Update remaining consumers of the old `OutputFieldType`

**Files:**
- Any file referencing `OutputFieldType`, `OutputFieldSchema`

- [ ] **Step 1: Search**

Run: `grep -rn "OutputFieldType\|OutputFieldSchema" packages --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v node_modules`

- [ ] **Step 2: Adapt each match**

For each remaining usage, switch to `Shape`. Common patterns:

- A switch over `OutputFieldType` to render docs: replace with a switch over `Shape['type']`.
- An explicit type annotation `OutputFieldSchema`: replace with `Shape`.

If nothing else references these old names after Task B3, this task may be empty — that's fine.

### Task B13: Update flow-editor validation surface

**Files:**
- Modify: `packages/flow-editor/src/state/validation.ts`

- [ ] **Step 1: Read the file**

Run: `cat packages/flow-editor/src/state/validation.ts | head -80`

- [ ] **Step 2: Apply shape checking in the editor**

If the file already does any binding validation, mirror the converter's `validateRefShapeAgainst` call so users see errors before flow-save. Use the catalog (already imported there) to find expected shapes and call `resolveRefShape` from the orchestrator? — *no*, the orchestrator package is server-side. Instead, duplicate the small `resolveRefShape`/`validateRefShapeAgainst` helpers into a flow-editor-local module by importing the pure helpers (`shapeAtPath`, `shapesEqual`, `resolveShape`) from `@journeyman/core` (which is browser-safe) and walking the catalog locally.

Concretely: create the helper in flow-editor too:

**Files:**
- Create: `packages/flow-editor/src/state/validate-ref-shape.ts`

```typescript
import type { FlowGraph, Shape } from "@journeyman/core";
import { resolveShape, shapeAtPath, shapesEqual } from "@journeyman/core";
import type { PhaseCatalogEntry } from "../catalogs/use-phase-catalog.ts";

export function validateRefShape(
  flow: FlowGraph,
  ref: string,
  expected: Shape,
  catalog: Record<string, PhaseCatalogEntry>,
): { ok: boolean; error?: string } {
  const m = /^([^.]+)\.(input|output)\.(.+)$/.exec(ref) || /^(workflow)\.(input)\.(.+)$/.exec(ref);
  if (!m) return { ok: false, error: `Unparseable ref '${ref}'` };
  const [, source, scope, fieldPath] = m;
  const path = fieldPath.split(".");

  let root: Shape | undefined;
  if (source === "workflow") {
    const startNode = flow.nodes.find(n => n.type === "start");
    const decls = ((startNode?.config as { runInputs?: { name: string; shape?: Shape }[] } | undefined)?.runInputs) ?? [];
    root = decls.find(r => r.name === path[0])?.shape ?? { type: "string" } as Shape;
    if (!root) return { ok: false, error: `workflow.input.${path[0]} not declared` };
    const leaf = shapeAtPath(root, path.slice(1));
    return leaf && shapesEqual(leaf, expected) ? { ok: true } : { ok: false, error: `Shape mismatch on '${ref}'` };
  }

  const node = flow.nodes.find(n => n.id === source);
  if (!node || node.type !== "phase" || !node.phaseType) return { ok: false, error: `Bad node '${source}'` };
  const entry = catalog[node.phaseType];
  root = scope === "output" ? entry?.outputSchema?.[path[0]] : entry?.inputFields?.[path[0]]?.shape;
  if (!root) return { ok: false, error: `Field '${scope}.${path[0]}' not on '${source}'` };

  const leaf = shapeAtPath(root, path.slice(1));
  if (!leaf) return { ok: false, error: `Path '${ref}' not found` };
  if (!shapesEqual(resolveShape(leaf), expected)) return { ok: false, error: `Shape mismatch on '${ref}'` };
  return { ok: true };
}
```

- [ ] **Step 3: Call it from `validation.ts` where node inputs are validated**

Where the editor already validates node inputs (around the existing checks for missing required bindings), add calls to `validateRefShape` for each `kind: "ref"` input and surface the error string into the existing error array. Do not block save in the editor — emit warnings consistent with how validation.ts surfaces other issues.

### Task B14: Update `RunInputsEditor` to declare shapes on run-inputs

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/RunInputsEditor.tsx`

- [ ] **Step 1: Read the file**

Run: `cat packages/flow-editor/src/properties-panel/RunInputsEditor.tsx | head -60`

- [ ] **Step 2: Add a shape selector for new run-inputs**

Add a small dropdown to each row letting the user pick:

- "string" → `{ type: "string" }`
- "number" → `{ type: "number" }`
- "boolean" → `{ type: "boolean" }`
- "Issue" → `{ type: "ref", name: "Issue" }`
- "Repo[]" → `{ type: "array", items: { type: "ref", name: "Repo" } }`

(Other named shapes can be added later. Keep options short.)

Persist the selection on the run-input record's `shape` field. Default for newly added rows: `string`.

### Task B15: Phase-handler input-key updates for shape changes

**Files:**
- Modify handlers whose declared input shape changed (most importantly `start-feature-branch-phase-handler.ts`)

- [ ] **Step 1: Update `start-feature-branch-phase-handler.ts`**

After Task A12, the handler already reads `input.issue`. With the `Issue` shape now richer than `{id, title}`, ensure the handler reads what it actually needs — likely `issue?.id`, `issue?.title` (no change required). Verify with:

Run: `cat packages/orchestrator/src/workers/phases/start-feature-branch-phase-handler.ts`

- [ ] **Step 2: Update other handlers that consume objects/arrays**

For each handler that previously read JSON-typed inputs, audit field reads against the new shapes. The reads should already be type-loose (`as unknown` casts), so the runtime behavior does not change; this is just a sanity scan.

Run: `grep -rn 'as Record<string, unknown>\|as unknown' packages/orchestrator/src/workers/phases --include="*.ts"`

For any handler whose input contract changed shape (rare; primarily phases that previously consumed `repos`-typed JSON or ticket-typed JSON), add an inline comment naming the expected shape so the reader knows. Example:

```typescript
// input.repos: Repo[]
const repos = (input.repos as Array<{ repoDir: string; branch?: string }> | undefined) ?? [];
```

### Task B16: Final sweep — remove dead types and lingering legacy form

**Files:**
- All modified files

- [ ] **Step 1: Confirm `OutputFieldType` and `OutputFieldSchema` are gone**

Run: `grep -rn "OutputFieldType\|OutputFieldSchema" packages --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v node_modules`

Expected output: empty.

- [ ] **Step 2: Confirm no meta still uses old `type: "string[]"` literal output type**

Run: `grep -rn 'type: "string\[\]"' packages/phases/src --include="*.ts"`

Expected output: empty (all converted to `{ type: "array", items: ... }`).

- [ ] **Step 3: Confirm no `{ type: "json" }` remains as an output declaration**

Run: `grep -rn 'type: "json"' packages/phases/src --include="*.ts"`

Expected output: empty.

- [ ] **Step 4: Confirm zero `ITicketProvider` references**

Run: `grep -rn "ITicketProvider" packages --include="*.ts" 2>/dev/null | grep -v node_modules`

Expected output: empty.

- [ ] **Step 5: Confirm zero `getTicket\b/createTicket\b/...` method names**

Run: `grep -rnE "\b(getTicket|createTicket|updateTicket|listTickets|getTicketSchema)\b" packages --include="*.ts" 2>/dev/null | grep -v node_modules`

Expected output: empty.

- [ ] **Step 6: Confirm zero old phase IDs**

Run: `grep -rnE '"(get-ticket|create-ticket|comment-on-ticket|transition-ticket|update-ticket-fields)"' packages --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v node_modules`

Expected output: empty.

If any of the sweeps return matches, fix them in place before moving on.

---

## Phase C — Final verification

### Task C1: Run typecheck

**Files:**
- All

- [ ] **Step 1: Run the workspace typecheck**

Run: `npm run typecheck`

Expected: no errors.

If errors appear, fix them in the offending file. Common patterns to expect:

- A meta file you missed during B4 — its `OutputSchema`/`InputFields` still uses the old shape. Convert it.
- A consumer reading `inputFields[k].type` (string) — change to `inputFields[k].shape.type` or branch on the shape.
- A consumer reading `outputSchema[k].type` for a primitive check — same fix.
- Renamed identifier still referenced somewhere (run the relevant grep from Task B16).

Iterate until typecheck is clean.

- [ ] **Step 2: Stop**

Per execution policy, do not commit. Report typecheck status and list of files changed (summary only — the user will review and commit).

---

## Self-review

**Spec coverage check:**

| Spec section | Covered by |
|---|---|
| Workstream 1 file/folder renames | A1, A4, A8 |
| `ITicketProvider` → `IIssueProvider` (interfaces + classes) | A1, A2, A3, A8, A9, A10 |
| Phase ID string renames | A4 (metas), A8 (handlers), A7 (provider-catalog), A14 (flow-editor strings) |
| Field name `ticket` → `issue` (object) | A11 (coding-cli), A12 (handlers), A13 (start-feature-branch meta) |
| Provider category `"ticket"` → `"issue"` | A7 |
| User-facing labels | A4 (LABEL constants), A14, A15 |
| Workstream 2 `Shape` types | B1 |
| Named-shape registry | B2 |
| `OutputSchema` / `InputFields` redefinition | B3 |
| Phase declarations migration | B4 |
| Shape-aware picker tree | B5, B6, B7 |
| Bind at any level | B6 (path-aware `onBind`), B7 (`refForPath`) |
| Type-aware highlighting | B6 (`compatible` flag), B8 (passing `expected`) |
| Form rendering for non-bound fields | B9 |
| Converter shape validation | B10, B11 |
| Editor shape validation | B13 |
| Run-inputs shapes | B14 |

**Placeholder scan:** No `TBD`/`TODO`/`fill in later`/`add error handling` placeholders in step bodies. Per-meta shape decisions in Task B4 give a concrete table of what to write for each phase. Phase descriptions for `ai/*` and `notifications/send-message` instruct the engineer to read the handler — acceptable since the handlers exist and are short.

**Type consistency:** The names introduced in B1/B2 (`Shape`, `InputField`, `InputFields`, `OutputSchema`, `Issue`, `Repo`, `PullRequest`, `Workspace`, `NAMED_SHAPES`, `resolveShape`, `shapesEqual`, `shapeAtPath`) are used consistently in B3-B14. Picker prop `expected` is named consistently across `ValuePicker.tsx` (B7), `ConfigTab.tsx` (B8), `ShapeTree.tsx` (B6).

---

## Execution handoff

Plan saved to [`docs/superpowers/plans/2026-05-02-typed-bindings-and-issue-rename.md`](2026-05-02-typed-bindings-and-issue-rename.md).

Execution-policy reminders for whoever picks this up:

- **No commits** at any point.
- **No tests** — do not write or run unit tests.
- **One typecheck** — only at Task C1.
