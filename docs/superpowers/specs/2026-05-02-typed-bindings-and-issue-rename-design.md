# Design: Typed Phase I/O Bindings + `ticket` → `issue` Rename

**Date:** 2026-05-02
**Status:** Draft

## Problem

The flow editor's `ValuePicker` only emits scalar refs like `${getTicket.output.id}`, but several phases declare inputs that are **objects or arrays of objects** — e.g. `start-feature-branch.ticket: { id, title }` ([handler:51-57](../../packages/orchestrator/src/workers/phases/start-feature-branch-phase-handler.ts#L51)) and `start-feature-branch.repos: { repoDir, branch }[]` ([meta.ts:11-13](../../packages/phases/src/repos/start-feature-branch.meta.ts#L11)). Users have no way to wire structured data through the picker, even though Conductor's `${node.output.x}` runtime resolution already supports object/array values.

The system is **half-typed**:

| Layer | State |
|---|---|
| Runtime (Conductor `${...}`) | Already resolves objects and arrays |
| Schema declarations (`OutputSchema`, `InputFields`) | All fields lie as `type: "string"` — even when actually arrays/objects (see `start-feature-branch.repos` description: *"Array of { repoDir, branch, newBranch } per repo"* — describing the shape in prose because the type system can't) |
| Picker (`ValuePicker.tsx`) | Only renders the pretend scalars; can't see structured data |
| Validation (`conductor-converter.ts`) | Validates ref source/dominator only; type mismatches surface at runtime |

Flattening structured inputs into scalar fields (e.g. replacing `ticket` with `ticketId` + `ticketTitle`) doubles down on the lie and breaks the moment any field is a list — `repos` already requires array semantics.

Separately, the codebase is mid-migration from the term `ticket` to `issue`. The `2026-05-02-issue-ref-rename-design.md` spec migrated identifier fields (`ticketKey`/`ticketId` → `issueRef`) but stopped there. Interfaces, types, file paths, phase IDs, provider categories, UI labels, and the *issue object itself* are still named `ticket`. Introducing a typed shape system without finishing the rename would create a new `Ticket` named shape that immediately needs renaming.

## Decision

Two coordinated workstreams in one spec, both aimed at the same end state — structured, named, type-checked data flow between phases — and both shipped before any UI work depends on either:

1. **Complete the `ticket` → `issue` rename** across interfaces, types, files, phase IDs, provider categories, and labels.
2. **Introduce a real `Shape` type system** for phase I/O, named-shape registry, shape-aware picker UX, and converter-level type validation.

No backwards-compatibility shims. Stored flow JSON that references old phase IDs (`get-ticket`, etc.) or scalar field names will not load — the user has explicitly accepted this.

---

## Workstream 1 — `ticket` → `issue` rename

### File and folder renames

| From | To |
|---|---|
| `packages/core/src/interfaces/ticket.interface.ts` | `issue.interface.ts` |
| `packages/core/src/types/ticket.types.ts` | `issue.types.ts` |
| `packages/phases/src/tickets/` | `packages/phases/src/issues/` |
| `packages/phases/src/issues/get-ticket.{meta.ts,tsx}` | `get-issue.{meta.ts,tsx}` |
| `packages/phases/src/issues/create-ticket.{meta.ts,tsx}` | `create-issue.{meta.ts,tsx}` |
| `packages/phases/src/issues/comment-on-ticket.{meta.ts,tsx}` | `comment-on-issue.{meta.ts,tsx}` |
| `packages/phases/src/issues/transition-ticket.{meta.ts,tsx}` | `transition-issue.{meta.ts,tsx}` |
| `packages/phases/src/issues/update-ticket-fields.{meta.ts,tsx}` | `update-issue-fields.{meta.ts,tsx}` |
| `packages/orchestrator/src/workers/phases/*-ticket*.ts` | `*-issue*.ts` (matching renames) |

### Interface and class renames

| From | To |
|---|---|
| `ITicketProvider` | `IIssueProvider` |
| `TicketsContext` (if present) | `IssuesContext` |
| `ticket.interface.ts` re-export name | `issue.interface.ts` |

Concrete provider classes (`JiraProvider`, `LinearProvider`, `MondayProvider`, `GitHubIssuesProvider`) keep their names but `implements IIssueProvider`.

### Phase type ID strings

These are the constants serialized into stored flow JSON:

| From | To |
|---|---|
| `"get-ticket"` | `"get-issue"` |
| `"create-ticket"` | `"create-issue"` |
| `"comment-on-ticket"` | `"comment-on-issue"` |
| `"transition-ticket"` | `"transition-issue"` |
| `"update-ticket-fields"` | `"update-issue-fields"` |

`*_PHASE_TYPE` exported constants and corresponding `phaseType` strings in handlers update to match.

### Field name renames (the object itself)

Where a field currently holds the *issue object* (id + title + …), it is renamed `ticket` → `issue`:

- `start-feature-branch.meta.ts` — `ticket` input → `issue`
- `coding-cli` operation options that accept `ticket: { id, title }` — parameter renamed to `issue` (e.g. `checkout-repo.ts`, all provider implementations)
- Phase handler input reads (`input.ticket` → `input.issue`)
- All operation log fields and prose comments

The already-migrated `issueRef` (string identifier) is unaffected — that rename completed in the prior spec.

### Provider category and labels

- `provider-catalog.ts` category `"ticket"` → `"issue"`
- `*_LABEL` constants: `"Get Ticket"` → `"Get Issue"`, etc.
- `*_CATEGORY` constants: `"Issue Tracker"` (already correct) — leave as-is
- `*_DESCRIPTION` strings — replace `"ticket"` with `"issue"` where it refers to the entity (not provider names like "Jira ticket" if those exist; check case by case)

### UI strings

- Catalog labels in `flow-editor` rendering
- Properties-panel section titles
- Dialog copy in `RunInputsEditor`, etc.

### Out of scope (intentional)

- The `issueRef` string identifier remains `issueRef` — already finished.
- Class-name preservation for concrete providers (`JiraProvider` stays `JiraProvider`).
- External provider terminology in user-visible help text where the *external system* uses "ticket" (e.g. Jira's own UI calls them "issues" anyway, so this is mostly a non-issue).

---

## Workstream 2 — Typed binding system

### Type model

Defined in `packages/core/src/types/shape.types.ts` (new):

```typescript
export type Shape =
  | { type: "string";  description?: string }
  | { type: "number";  description?: string }
  | { type: "boolean"; description?: string }
  | { type: "object";  fields: Record<string, Shape>; named?: string; description?: string }
  | { type: "array";   items: Shape; description?: string }
  | { type: "ref";     name: string;  description?: string };
```

- `type: "ref"` resolves against the **named-shape registry** (below). Allows phases to declare `{ type: "ref", name: "Issue" }` without redeclaring the Issue shape inline.
- `type: "object"` with optional `named` — used when a phase locally defines an object shape that should *also* be registerable by name (rare; most named shapes go through the registry directly).
- `description` is purely for picker tooltips and docs.

### Named-shape registry

`packages/core/src/types/shapes.ts` (new) — central registry; the only place named shapes are defined:

```typescript
export const Issue: Shape = {
  type: "object",
  named: "Issue",
  fields: {
    issueRef:    { type: "string", description: "Canonical namespaced identifier, e.g. jira:PROJ-123" },
    issueRefShort: { type: "string", description: "Display-friendly short ref, e.g. PROJ-123" },
    id:          { type: "string", description: "Provider-native id" },
    title:       { type: "string" },
    description: { type: "string" },
    labels:      { type: "array", items: { type: "string" } },
    status:      { type: "string" },
  },
};

export const Repo: Shape = {
  type: "object",
  named: "Repo",
  fields: {
    repoDir: { type: "string" },
    branch:  { type: "string" },
  },
};

export const PullRequest: Shape = { /* ... */ };
export const Workspace:   Shape = { /* ... */ };

export const NAMED_SHAPES: Record<string, Shape> = { Issue, Repo, PullRequest, Workspace };

export function resolveShape(s: Shape): Shape { /* recursively resolves "ref" → object */ }
```

### Updated `OutputSchema` and `InputFields`

`OutputSchema` becomes `Record<string, Shape>` (replacing the old `{ type: "string" }` shape). `InputField` gains a `shape: Shape` field replacing `type: string`:

```typescript
export interface OutputSchema { [field: string]: Shape }

export interface InputField {
  shape: Shape;
  label?: string;
  required?: boolean;
  bindOnly?: boolean;
}
export type InputFields = Record<string, InputField>;
```

### Phase declarations after migration

```typescript
// get-issue.meta.ts
export const getIssueOutputSchema: OutputSchema = {
  issue: { type: "ref", name: "Issue" },
};

export const getIssueInputFields: InputFields = {
  issueRef: { shape: { type: "string" }, label: "Issue ref", required: true },
};

// clone-repos.meta.ts
export const cloneReposOutputSchema: OutputSchema = {
  repos: { type: "array", items: { type: "ref", name: "Repo" } },
};

// start-feature-branch.meta.ts
export const startFeatureBranchOutputSchema: OutputSchema = {
  newBranch: { type: "string" },
  repos:     { type: "array", items: { type: "ref", name: "Repo" } },
};
export const startFeatureBranchInputFields: InputFields = {
  repos: { shape: { type: "array", items: { type: "ref", name: "Repo" } }, label: "Repos", required: true, bindOnly: true },
  issue: { shape: { type: "ref", name: "Issue" },                          label: "Issue", bindOnly: true },
};
```

Every phase in the catalog migrates in this spec — no opt-in, no per-phase rollout.

### Shape-aware picker

`ValuePicker.tsx` and `useUpstreamSources.ts` change as follows:

**Tree expansion.** Instead of flat scalar fields, each upstream source's outputs and inputs render as an expandable tree. Click an `object` field to expand its fields. Click an `array` field to reveal a single `[item]` node beneath it (representing the per-item shape). Drill arbitrarily deep.

**Bind at any level.** The leaf you click *is* the ref. Clicking `getIssue` (the source) emits `${getIssue.output}`; clicking `getIssue.output.issue` emits `${getIssue.output.issue}`; clicking `…issue.id` emits the scalar. The same UI handles all three because the ref is just a path.

**Type filtering against the consumer input shape.**

When the picker is opened for an input declaring `shape: { type: "ref", name: "Issue" }`:

- Refs whose resolved shape exactly matches `Issue` (or `ref→Issue`) are rendered with a **primary "Bind" button** and highlighted.
- Refs whose resolved shape *contains* a matching descendant render normally — user expands them to find the match. (No filtering; the path stays visible.)
- Refs whose resolved shape is structurally incompatible at every level are **dimmed**, but still visible (so the user can see what's there). The picker shows a small "incompatible — expects `Issue`" hint on hover.
- For arrays: an input expecting `Repo[]` matches array refs whose item resolves to `Repo`. Clicking the array node binds the array; clicking `[item]` binds a single repo (rare but possible in loop contexts).

This gives users a useful default (the right things light up) without hiding alternatives or requiring perfect structural matches.

**Custom-path text input.** Existing `+ custom <scope> field…` escape hatch stays. Useful for nested paths the picker doesn't yet enumerate (e.g. dynamic keys), or for refs against pre-typed-system stored data during transition.

**`useUpstreamSources` shape changes.** Today `UpstreamField` has flat `name`/`scope`. New shape:

```typescript
export interface UpstreamField {
  name: string;
  scope: "input" | "output" | "run-input";
  shape: Shape;
  description?: string;
}
```

The picker recurses into `shape` to render the tree; it does not pre-flatten.

### Validation in `conductor-converter.ts`

`FlowConductor.validate()` already checks ref source existence and dominator reachability ([conductor-converter.ts:82-117](../../packages/orchestrator/src/flow-json/conductor-converter.ts#L82)). Add a third check:

1. Parse the ref's path (e.g. `getIssue.output.issue.id`) against the upstream node's `OutputSchema` (or `InputFields` for `.input.` refs, or run-input declarations for `workflow.input.`). Reject if any segment doesn't resolve.
2. Compute the resolved leaf `Shape`.
3. Compare against the consumer field's declared `Shape`. Reject on mismatch with a clear message: `Node 'startFeatureBranch' input 'issue' expects shape Issue, but ref '${getIssue.output.id}' resolves to string`.

Compatibility rule: shapes match when their resolved (ref-flattened) structures are equal. Future enhancement could add structural subtyping; out of scope here.

Errors surface at flow-save time (and on import), not at run time.

### Form rendering for non-bound fields

`SchemaForm` and related components currently render scalar inputs only. They need to handle the `Shape`-typed `InputField`:

- Scalar shapes — same as today (text/number/checkbox).
- `object` and `array` shapes for non-`bindOnly` inputs are out of scope for inline editing. They render as **bindOnly in practice**: the form shows a "Must be bound from upstream" placeholder with the bind button. (Future work could allow JSON literal entry; not needed now.)
- `bindOnly: true` fields render exactly as the existing "Required bindings" section in `ConfigTab`, but the picker is shape-aware as described above.

---

## Order of execution

The plan (next phase) will sequence work to keep the tree compiling at each step:

1. **Workstream 1 — rename.** Mechanical, large diff, low logical risk. Land first so workstream 2 declares the new shapes with the final names.
2. **Add `Shape` types and named-shape registry** to `@journeyman/core`. Additive; no consumers yet.
3. **Migrate phase metas** to `Shape`-typed `OutputSchema` / `InputFields`. One package at a time (`tickets/issues` → `repos` → `workspaces` → `code` → …). Type-check after each.
4. **Update `useUpstreamSources` and `ValuePicker`** to consume `Shape` and render trees with type-aware highlighting.
5. **Update `conductor-converter.ts`** validation to type-check refs.
6. **Remove the legacy `OutputSchema: { [k]: { type: "string" } }` form** and any compatibility plumbing.

## Out of scope

- Stored-flow migration. Old flows referencing `get-ticket` etc. won't load. User accepted this.
- Object literal editing in the form (typing JSON in a textarea for a non-bound `object` input).
- Structural subtyping in shape compatibility (e.g. allowing a wider object to bind to a narrower one). Add later if a real need surfaces.
- Generic / parameterized shapes.
- Shape evolution / versioning of named shapes.

## Risks

- **Picker tree depth blow-up.** A deeply nested object output could create overwhelming trees. Mitigation: collapsed by default; only the consumer's matching shape is expanded automatically.
- **Mass file rename + import churn.** Workstream 1 touches ~80 files. Mitigation: do it as one coordinated diff; rely on TypeScript to flag every missed reference; one PR per workstream so review stays tractable.
- **Named-shape drift.** If `Issue` gains a field, every consumer sees it automatically — but if a phase's *handler* doesn't actually emit that field at runtime, the shape lies. Mitigation: handlers and metas live in different packages, so this requires discipline; consider a runtime assert in dev builds (out of scope for this spec).
