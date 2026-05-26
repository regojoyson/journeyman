# Generic Step Ref Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop the platform-level `issueRef` namespacing concept. Rename `issueRef` → `ref` across step inputs, the `Issue` shape, ticket-provider operations, coding-CLI operations, and the New Run dialog. Delete `buildIssueRef`/`parseIssueRef`/`IssueRefProvider` helpers and the dialog's hardcoded Issue Ref widget.

**Architecture:** Pure rename + deletion. No new runtime behavior. The platform stops bundling the format `provider:rawId`; consumers pass raw identifiers (e.g. `"PROJ-123"`) and provider routing happens through the existing per-step `provider` config. Clean break — no migration.

**Tech Stack:** TypeScript across the npm workspaces monorepo. Spec: [docs/superpowers/specs/2026-05-26-generic-step-ref-design.md](docs/superpowers/specs/2026-05-26-generic-step-ref-design.md).

**User constraints:**
- No git commits — do not stage or commit at any point.
- No unit tests — skip TDD steps.
- Run `npm run check` (typecheck + import-boundaries) as the final verification.

---

## File map

| File | Action | Why |
|---|---|---|
| `packages/core/src/utils/issue-ref.ts` | **Delete** | Drops `buildIssueRef`, `parseIssueRef`, `IssueRefProvider`, `ParsedIssueRef` |
| `packages/core/src/index.ts` | Modify | Remove re-exports of deleted symbols |
| `packages/core/src/types/issue.types.ts` | Modify | `GetIssueSchemaOptions.issueRef` → `ref` |
| `packages/core/src/types/git.types.ts` | Modify | `CreateWorkspaceOptions.issueRef` → `ref` |
| `packages/core/src/types/shapes.ts` | Modify | `IssueShape.issueRef` → `ref`; drop `issueRefShort` |
| `packages/core/src/types/custom-steps.types.ts` | Modify | Drop `"issueRef"` from `CustomStepInputType` union |
| `packages/core/src/types/pipeline.types.ts` | Modify | Legacy types — `issueRef` → `ref`; drop `issueRefShort` |
| `packages/core/src/interfaces/pipeline.interface.ts` | Modify | `findByIssueRef`/`findActiveForIssueRef` → `findByRef`/`findActiveForRef`; `PipelineRun.issueRef` → `ref`; drop `issueRefShort` |
| `packages/steps/src/issues/{get-issue,transition-issue,update-issue-fields,comment-on-issue}.meta.ts` | Modify | `issueRef` input → `ref` |
| `packages/steps/src/repos/create-workspace.meta.ts` | Modify | `issueRef` input → `ref` |
| `packages/steps/src/issues/{get-issue,transition-issue,update-issue-fields,comment-on-issue}.tsx` | Modify | Step config TS type + UI label |
| `packages/steps/src/repos/create-workspace.tsx` | Modify | Step config TS type + UI label |
| `packages/orchestrator/src/workers/steps/{get-issue,transition-issue,update-issue-fields,comment-on-issue,create-workspace}-step-handler.ts` | Modify | Read `input.ref` only — drop `input.id ?? input.issueRef` aliasing |
| `packages/ticket-provider/src/providers/jira/operations/{get-issue,update-issue,transition-issue,create-issue,get-issue-schema}.ts` | Modify | Drop `parseIssueRef`; accept `ref` directly; return `Issue.ref` (raw key, no `jira:` prefix) |
| `packages/coding-cli/src/providers/{claude,opencode}/operations/{create-workspace,checkout-repo}.ts` | Modify | Rename option field + log key |
| `packages/custom-steps/src/shape-adapter.ts` | Modify | Drop the `"issueRef"` case |
| `packages/web/src/components/custom-steps/InputFieldsEditor.tsx` | Modify | Drop `"issueRef"` from the type select |
| `packages/flow-editor/src/properties-panel/ValuePicker.tsx` | Modify | Update placeholder example string to use `ref` |
| `packages/web/src/routes/RunsListPage.tsx` | Modify | Delete the Issue Ref widget; delete `buildIssueRef`/`IssueRefProvider` imports; drop the `name !== "issueRef"` filter |

---

## Task 1: Core types & utilities

**Files:**
- Delete: `packages/core/src/utils/issue-ref.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/types/issue.types.ts`
- Modify: `packages/core/src/types/git.types.ts`
- Modify: `packages/core/src/types/shapes.ts`
- Modify: `packages/core/src/types/custom-steps.types.ts`
- Modify: `packages/core/src/types/pipeline.types.ts`
- Modify: `packages/core/src/interfaces/pipeline.interface.ts`

- [ ] **Step 1: Delete the `issue-ref.ts` helper file**

```bash
rm packages/core/src/utils/issue-ref.ts
```

- [ ] **Step 2: Remove re-exports from `packages/core/src/index.ts`**

Find and delete these two lines:

```ts
export { buildIssueRef, parseIssueRef } from "./utils/issue-ref.ts";
```

```ts
export type { IssueRefProvider, ParsedIssueRef } from "./utils/issue-ref.ts";
```

- [ ] **Step 3: Rename in `packages/core/src/types/issue.types.ts`**

Replace `GetIssueSchemaOptions` (lines ~95-98):

```ts
export type GetIssueSchemaOptions = SessionOptions & {
  ref: string;
  projectId?: string;
};
```

- [ ] **Step 4: Rename in `packages/core/src/types/git.types.ts`**

Replace `CreateWorkspaceOptions` (lines ~103-108):

```ts
export type CreateWorkspaceOptions = SessionOptions & {
  ref: string;
  baseDir: string;
  signal?: AbortSignal;
  model?: string;
};
```

- [ ] **Step 5: Rename in `packages/core/src/types/shapes.ts`**

Replace `IssueShape` (lines ~3-22) — rename `issueRef` to `ref`, drop `issueRefShort`:

```ts
export const IssueShape: Shape = {
  type: "object",
  named: "Issue",
  fields: {
    ref:           { type: "string", description: "Provider-native identifier (e.g. PROJ-123)" },
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
```

- [ ] **Step 6: Drop `"issueRef"` from `CustomStepInputType` in `packages/core/src/types/custom-steps.types.ts`**

Find (around line 7-11):

```ts
export type CustomStepInputType =
  | "string" | "number" | "boolean" | "string[]"
  | "object" | "array"
  | "workspaceDir" | "repoRef" | "issueRef"
  | "template";
```

Replace with:

```ts
export type CustomStepInputType =
  | "string" | "number" | "boolean" | "string[]"
  | "object" | "array"
  | "workspaceDir" | "repoRef"
  | "template";
```

- [ ] **Step 7: Rename legacy pipeline types in `packages/core/src/types/pipeline.types.ts`**

For each location where `issueRef: string` appears, rename to `ref: string`. For each adjacent `issueRefShort: string`, delete the line. Also update the inline comment on the first occurrence:

At line ~99-100, replace:

```ts
  issueRef: string;                     // canonical id e.g. "jira:PROJ-123"
  issueRefShort: string;                // short id for display e.g. "PROJ-123"
```

With:

```ts
  ref: string;                          // provider-native identifier e.g. "PROJ-123"
```

At line ~142-143, replace:

```ts
  issueRef: string;
  issueRefShort: string;
```

With:

```ts
  ref: string;
```

At line ~152, replace:

```ts
  | { type: "runStarted";  sessionId: string; issueRef: string; flowName: string; at: string }
```

With:

```ts
  | { type: "runStarted";  sessionId: string; ref: string; flowName: string; at: string }
```

- [ ] **Step 8: Rename `IPipelineStore` methods in `packages/core/src/interfaces/pipeline.interface.ts`**

Update the two method signatures (lines ~44-45):

```ts
  findByRef(productId: string, ref: string): Promise<PipelineRun[]>;
  findActiveForRef(productId: string, ref: string): Promise<PipelineRun | null>;
```

The `PipelineRun.issueRef`/`issueRefShort` field declarations in this file (lines ~14-15) also rename — same rule as Step 7: `issueRef: string` → `ref: string`; delete `issueRefShort: string`.

---

## Task 2: Built-in step metas

**Files:**
- Modify: `packages/steps/src/repos/create-workspace.meta.ts`
- Modify: `packages/steps/src/issues/get-issue.meta.ts`
- Modify: `packages/steps/src/issues/transition-issue.meta.ts`
- Modify: `packages/steps/src/issues/update-issue-fields.meta.ts`
- Modify: `packages/steps/src/issues/comment-on-issue.meta.ts`

Each meta file declares the step's input contract twice: a Zod schema (used by the worker for validation) and a `inputFields` record (used by the editor for shape/required hints). Rename `issueRef` → `ref` in both places.

- [ ] **Step 1: Modify `packages/steps/src/repos/create-workspace.meta.ts`**

Find:

```ts
  issueRef: z.string().min(1),
```

Replace with:

```ts
  ref: z.string().min(1),
```

Find:

```ts
  issueRef: { shape: { type: "string" }, label: "Issue ref", required: true },
```

Replace with:

```ts
  ref: { shape: { type: "string" }, label: "Ref", required: true },
```

- [ ] **Step 2: Modify `packages/steps/src/issues/get-issue.meta.ts`**

Apply the same two edits as Step 1.

- [ ] **Step 3: Modify `packages/steps/src/issues/transition-issue.meta.ts`**

Apply the same two edits as Step 1.

- [ ] **Step 4: Modify `packages/steps/src/issues/update-issue-fields.meta.ts`**

Apply the same two edits as Step 1.

- [ ] **Step 5: Modify `packages/steps/src/issues/comment-on-issue.meta.ts`**

Apply the same two edits as Step 1.

---

## Task 3: Built-in step UI editors

**Files:**
- Modify: `packages/steps/src/repos/create-workspace.tsx`
- Modify: `packages/steps/src/issues/get-issue.tsx`
- Modify: `packages/steps/src/issues/transition-issue.tsx`
- Modify: `packages/steps/src/issues/update-issue-fields.tsx`
- Modify: `packages/steps/src/issues/comment-on-issue.tsx`

Each `.tsx` file declares a `Config` TS type, a `defaultConfig`, a `fieldMeta` (label + widget + help), an inline `<input>` bound to `config.issueRef`, and a `summary` function. Rename `issueRef` → `ref` in all locations.

- [ ] **Step 1: `packages/steps/src/repos/create-workspace.tsx`**

Apply these replacements (the file is small — read it first to confirm context):

- Type field: `issueRef: string;` → `ref: string;`
- `defaultConfig`: `{ issueRef: "" }` → `{ ref: "" }`
- `fieldMeta`: `issueRef: { label: "Issue ref", widget: "text" }` → `ref: { label: "Ref", widget: "text" }`
- `summary`: `c => c.issueRef` → `c => c.ref`
- Any inline JSX reading `config.issueRef` or `onChange={... issueRef: ... }` → `config.ref` / `ref:`

- [ ] **Step 2: `packages/steps/src/issues/get-issue.tsx`**

Same pattern. Read the file first; apply the same kinds of edits as Step 1. Watch for `summary: (c, ctx) => summaryValue(c, ctx, "issueRef")` — rename the string argument to `"ref"` as well.

- [ ] **Step 3: `packages/steps/src/issues/transition-issue.tsx`**

Same pattern. Note from earlier inspection:

```ts
issueRef: { label: "Issue ref", widget: "text", help: "Supports #{issue} placeholder" },
```

becomes

```ts
ref: { label: "Ref", widget: "text", help: "Supports #{issue} placeholder" },
```

Keep the `#{issue}` placeholder text — it's a template-substitution mechanism unrelated to this rename.

- [ ] **Step 4: `packages/steps/src/issues/update-issue-fields.tsx`**

Same pattern. From earlier inspection:

- Inline `<input>` (line ~37): `value={config.issueRef}` → `value={config.ref}`
- `onChange` (line ~39): `onChange={e => onChange({ ...config, issueRef: e.target.value })}` → `onChange={e => onChange({ ...config, ref: e.target.value })}`
- `summary`: `summaryValue(c, ctx, "issueRef")` → `summaryValue(c, ctx, "ref")`

- [ ] **Step 5: `packages/steps/src/issues/comment-on-issue.tsx`**

Same pattern.

---

## Task 4: Worker step handlers

**Files:**
- Modify: `packages/orchestrator/src/workers/steps/get-issue-step-handler.ts`
- Modify: `packages/orchestrator/src/workers/steps/transition-issue-step-handler.ts`
- Modify: `packages/orchestrator/src/workers/steps/update-issue-fields-step-handler.ts`
- Modify: `packages/orchestrator/src/workers/steps/comment-on-issue-step-handler.ts`
- Modify: `packages/orchestrator/src/workers/steps/create-workspace-step-handler.ts`

Each handler currently reads `input.id ?? input.issueRef`. Replace with `input.ref`. Update the JSDoc accordingly.

- [ ] **Step 1: `packages/orchestrator/src/workers/steps/get-issue-step-handler.ts`**

Replace this block:

```ts
/**
 * Wraps IIssueProvider.getIssue.
 *
 * Inputs (any of):
 *   - issueRef   — canonical issue ref (e.g. "jira:PROJ-123")
 *   - id         — provider id (string)
 *
 * Returns the Issue object as output.issue.
 */
export class GetIssueStepHandler implements IStepHandler {
  readonly stepType = "get-issue";

  constructor(private deps: { issue: ProviderFactory<IIssueProvider> }) {}

  async run(input: StepInput, ctx: StepContext): Promise<StepRunResult> {
    const id = typeof input.id === "string" ? input.id
      : typeof input.issueRef === "string" ? input.issueRef : undefined;
    if (!id) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "get-issue requires `issueRef` or `id`",
          retryable: false,
        },
      };
    }
    const issueProvider = this.deps.issue(
      typeof input.provider === "string" ? input.provider : undefined,
      ctx.env,
    );
    ctx.log(`Fetching issue ${id}`);
    const result = await issueProvider.getIssue({ id, sessionId: ctx.workflowInstanceId });
```

With:

```ts
/**
 * Wraps IIssueProvider.getIssue.
 *
 * Input:
 *   - ref — provider-native identifier (e.g. "PROJ-123")
 *
 * Returns the Issue object as output.issue.
 */
export class GetIssueStepHandler implements IStepHandler {
  readonly stepType = "get-issue";

  constructor(private deps: { issue: ProviderFactory<IIssueProvider> }) {}

  async run(input: StepInput, ctx: StepContext): Promise<StepRunResult> {
    const ref = typeof input.ref === "string" ? input.ref : undefined;
    if (!ref) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "get-issue requires `ref`",
          retryable: false,
        },
      };
    }
    const issueProvider = this.deps.issue(
      typeof input.provider === "string" ? input.provider : undefined,
      ctx.env,
    );
    ctx.log(`Fetching issue ${ref}`);
    const result = await issueProvider.getIssue({ id: ref, sessionId: ctx.workflowInstanceId });
```

Note: `IIssueProvider.getIssue` still takes `{ id }` — that's the provider-level interface, unchanged. Only the step's *input field* renames.

- [ ] **Step 2: `packages/orchestrator/src/workers/steps/transition-issue-step-handler.ts`**

Apply the same pattern. Read the file (the structure mirrors `get-issue-step-handler.ts`) and:
- Drop the `input.id ?? input.issueRef` fallback; read `input.ref` only.
- Update the JSDoc comment.
- Update the error message in the InvalidInput failure.

- [ ] **Step 3: `packages/orchestrator/src/workers/steps/update-issue-fields-step-handler.ts`**

Same pattern as Step 2.

- [ ] **Step 4: `packages/orchestrator/src/workers/steps/comment-on-issue-step-handler.ts`**

Same pattern as Step 2.

- [ ] **Step 5: `packages/orchestrator/src/workers/steps/create-workspace-step-handler.ts`**

Same pattern as Step 2. This handler calls `coding-cli`'s `createWorkspace({ issueRef: … })` — that option type also renames (covered in Task 6), so pass `ref:` here.

Example shape after edit:

```ts
const ref = typeof input.ref === "string" ? input.ref : undefined;
if (!ref) {
  return { kind: "failure", failure: { errorClass: "InvalidInput", message: "create-workspace requires `ref`", retryable: false } };
}
// ...
const result = await codingCli.createWorkspace({ ref, baseDir, sessionId: ctx.workflowInstanceId });
```

---

## Task 5: Ticket-provider Jira operations

**Files:**
- Modify: `packages/ticket-provider/src/providers/jira/operations/get-issue.ts`
- Modify: `packages/ticket-provider/src/providers/jira/operations/update-issue.ts`
- Modify: `packages/ticket-provider/src/providers/jira/operations/transition-issue.ts`
- Modify: `packages/ticket-provider/src/providers/jira/operations/create-issue.ts`
- Modify: `packages/ticket-provider/src/providers/jira/operations/get-issue-schema.ts`

- [ ] **Step 1: `packages/ticket-provider/src/providers/jira/operations/get-issue-schema.ts`**

Currently uses `parseIssueRef(opts.issueRef).rawId`. Drop the import + the parse, and read `opts.ref` directly.

Replace the imports line (line ~2):

```ts
import { createLogger, parseIssueRef } from "@journeyman/core";
```

With:

```ts
import { createLogger } from "@journeyman/core";
```

Find the call site (around line ~32):

```ts
const rawId = parseIssueRef(opts.issueRef).rawId;
```

Replace with:

```ts
const rawId = opts.ref;
```

(Keep the local variable name `rawId` to minimise diff; the right-hand side is now the provided ref directly.)

- [ ] **Step 2: `packages/ticket-provider/src/providers/jira/operations/get-issue.ts`**

Read the file. Wherever `issueRef` appears in option types or destructuring, rename to `ref`. Wherever the returned `Issue` object sets `issueRef: …`, replace with `ref: …` and drop any `issueRefShort: …` assignment. The value assigned should be the raw Jira key (e.g. `PROJ-123`) — drop any `buildIssueRef("jira", …)` wrapping.

Concretely: if the file does

```ts
issueRef: buildIssueRef("jira", key),
issueRefShort: key,
```

it becomes

```ts
ref: key,
```

If `buildIssueRef` was the only thing imported from `@journeyman/core`, also remove that import. Otherwise drop just the `buildIssueRef` symbol from the destructured import.

- [ ] **Step 3: `packages/ticket-provider/src/providers/jira/operations/update-issue.ts`**

Same pattern as Step 2.

- [ ] **Step 4: `packages/ticket-provider/src/providers/jira/operations/transition-issue.ts`**

Same pattern as Step 2.

- [ ] **Step 5: `packages/ticket-provider/src/providers/jira/operations/create-issue.ts`**

Same pattern as Step 2. The returned `Issue` from a new-issue creation should carry `ref: <newly-created-key>`.

---

## Task 6: Coding-CLI operations

**Files:**
- Modify: `packages/coding-cli/src/providers/claude/operations/create-workspace.ts`
- Modify: `packages/coding-cli/src/providers/opencode/operations/create-workspace.ts`
- Modify: `packages/coding-cli/src/providers/claude/operations/checkout-repo.ts`
- Modify: `packages/coding-cli/src/providers/opencode/operations/checkout-repo.ts`

- [ ] **Step 1: `packages/coding-cli/src/providers/claude/operations/create-workspace.ts`**

Replace all four `opts.issueRef` reads and the validation error string. Specifically:

- JSDoc references (lines ~21, ~33): rewrite the example/illustration to use `ref` and `"PROJ-123"`.
- Line ~43: `log.info({ sessionId, issueRef: opts.issueRef, baseDir: opts.baseDir }, "createWorkspace start");` → `log.info({ sessionId, ref: opts.ref, baseDir: opts.baseDir }, "createWorkspace start");`
- Line ~45: `if (!opts.issueRef) {` → `if (!opts.ref) {`
- Line ~46: `log.error({ sessionId }, "createWorkspace missing issueRef");` → `log.error({ sessionId }, "createWorkspace missing ref");`
- Line ~47: `return { folderName: "", repoDir: "", error: "issueRef is required", sessionId };` → `return { folderName: "", repoDir: "", error: "ref is required", sessionId };`
- Line ~54: `const folderName = \`${opts.issueRef}-${buildTimestamp()}\`;` → `const folderName = \`${opts.ref}-${buildTimestamp()}\`;`

The option type `CreateWorkspaceOptions` is renamed in Task 1 Step 4, so this file just needs to read the new field.

- [ ] **Step 2: `packages/coding-cli/src/providers/opencode/operations/create-workspace.ts`**

Same edits as Step 1 (lines ~15, ~17, ~18, ~19, ~26).

- [ ] **Step 3: `packages/coding-cli/src/providers/claude/operations/checkout-repo.ts`**

Find the log line (around line 121):

```ts
{ sessionId, repoCount: entries.length, issueRef: opts.issue?.id },
```

Replace with:

```ts
{ sessionId, ref: opts.issue?.id, repoCount: entries.length },
```

(This is a log-context field name only — `opts.issue?.id` continues to be the value passed; the key name in the structured log just changes.)

- [ ] **Step 4: `packages/coding-cli/src/providers/opencode/operations/checkout-repo.ts`**

Same as Step 3 — the file has a single line referring to `issueRef:` in a log call (around line 103). Rename the key.

---

## Task 7: Custom-step adapters & UI

**Files:**
- Modify: `packages/custom-steps/src/shape-adapter.ts`
- Modify: `packages/web/src/components/custom-steps/InputFieldsEditor.tsx`
- Modify: `packages/flow-editor/src/properties-panel/ValuePicker.tsx`

- [ ] **Step 1: `packages/custom-steps/src/shape-adapter.ts`**

Find the `"issueRef"` case (line ~21):

```ts
    case "issueRef":      return { type: "ref", name: "IssueRef" };
```

Delete this line. Because `"issueRef"` is removed from `CustomStepInputType` in Task 1 Step 6, TypeScript would have flagged the missing case otherwise; with the union member gone, the case is unreachable.

- [ ] **Step 2: `packages/web/src/components/custom-steps/InputFieldsEditor.tsx`**

Find line ~7:

```ts
  "workspaceDir", "repoRef", "issueRef",
```

Replace with:

```ts
  "workspaceDir", "repoRef",
```

- [ ] **Step 3: `packages/flow-editor/src/properties-panel/ValuePicker.tsx`**

Find line ~38:

```tsx
        Click a tree node to <b>replace</b>. Click <b>+</b> to <b>insert into the existing text</b> (e.g. <code>feature/${"${issueRef}"}</code>).
```

Replace with:

```tsx
        Click a tree node to <b>replace</b>. Click <b>+</b> to <b>insert into the existing text</b> (e.g. <code>feature/${"${ref}"}</code>).
```

(Only the example placeholder string changes — no behavior change.)

---

## Task 8: New Run dialog cleanup

**Files:**
- Modify: `packages/web/src/routes/RunsListPage.tsx`

The dialog has a hardcoded "Issue Ref" section (provider dropdown + raw id) that builds `issueRef = buildIssueRef(provider, rawId)` and stuffs it into `inputs.issueRef` at submit. Remove the entire mechanism.

- [ ] **Step 1: Drop imports**

Find (around lines 5-6):

```ts
import type { Workflow, WorkflowInstance, WorkflowInputDef, WorkflowInstanceListScope, IssueRefProvider } from "@journeyman/core";
import { buildIssueRef, getStartWorkflowInputs } from "@journeyman/core";
```

Replace with:

```ts
import type { Workflow, WorkflowInstance, WorkflowInputDef, WorkflowInstanceListScope } from "@journeyman/core";
import { getStartWorkflowInputs } from "@journeyman/core";
```

- [ ] **Step 2: Drop state and derived value**

Find inside `NewRunDialog` (around lines 28-30):

```ts
  const [provider, setProvider] = useState<IssueRefProvider>("jira");
  const [rawId, setRawId] = useState("");
  const issueRef = rawId.trim() ? buildIssueRef(provider, rawId.trim()) : "";
```

Delete these three lines.

- [ ] **Step 3: Drop the `dynamicDefs` filter**

Find (around lines 52-56):

```ts
  // The dedicated Issue Ref block above already collects `issueRef` via the
  // provider+id pair. Skip it in the dynamic loop to avoid a duplicate field
  // and to keep the provider-built value from being overwritten by an empty
  // string on submit.
  const dynamicDefs = inputDefs.filter(d => d.name.trim() !== "" && d.name !== "issueRef");
```

Replace with:

```ts
  const dynamicDefs = inputDefs.filter(d => d.name.trim() !== "");
```

- [ ] **Step 4: Drop the `inputs.issueRef` injection on submit**

Find inside the `submitM = useMutation({ mutationFn: () => {` body (around line 61):

```ts
      if (issueRef.trim()) inputs.issueRef = issueRef.trim();
```

Delete this line. The `for (const def of dynamicDefs)` loop is the sole source of inputs going forward.

- [ ] **Step 5: Delete the Issue Ref `<label>` JSX block**

The block runs from the `{/* Issue Ref */}` comment through the closing `</label>` (approximately lines 137-169 in the file at the start of this task — line numbers may have shifted from Steps 1-4 edits). Delete the entire block:

```tsx
        {/* Issue Ref */}
        <label style={{ display: "block", marginBottom: 14 }}>
          <span style={{ fontSize: 12, color: "#aaa", display: "block", marginBottom: 5 }}>Issue Ref</span>
          <div style={{ display: "flex", gap: 8 }}>
            <select
              value={provider}
              onChange={e => setProvider(e.target.value as IssueRefProvider)}
              style={{ background: "#0f0f1e", border: "1px solid #2a2a3e", color: "#fff", padding: "8px 10px", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }}
            >
              <option value="jira">Jira</option>
              <option value="github">GitHub</option>
              <option value="monday">Monday</option>
              <option value="linear">Linear</option>
            </select>
            <input
              type="text"
              value={rawId}
              onChange={e => setRawId(e.target.value)}
              placeholder={
                provider === "jira"   ? "PROJ-123" :
                provider === "github" ? "owner/repo#42" :
                provider === "monday" ? "12345678" :
                "ENG-99"
              }
              style={{ flex: 1, background: "#0f0f1e", border: "1px solid #2a2a3e", color: "#fff", padding: "8px 10px", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }}
            />
          </div>
          {issueRef && (
            <span style={{ fontSize: 11, color: "#6c5ce7", display: "block", marginTop: 4 }}>
              → {issueRef}
            </span>
          )}
        </label>
```

After this removal, the dialog renders the workflow selector followed directly by the `dynamicDefs.map(...)` loop.

---

## Task 9: Final verification

**Files:** none

- [ ] **Step 1: Run typecheck + import-boundary check**

```bash
npm run check
```

Expected: exits 0, prints `✓ Layer boundaries clean across all packages.`

Common errors to expect and how to handle them:

- *"Property 'issueRef' does not exist on type 'X'"* — a `.tsx` or handler still reads the old field name. Rename it. (Most likely in the step `.tsx` editors covered by Task 3 — re-check the file for any leftover `config.issueRef` reads in JSX.)
- *"Cannot find module ... issue-ref.ts"* — a file still imports `buildIssueRef`/`parseIssueRef`/`IssueRefProvider` after the file deletion in Task 1. Grep for the symbol name and fix the lingering import.
- *"Type '\"issueRef\"' is not assignable to..."* — a custom-step file still references the dropped union member. Grep for `"issueRef"` (with quotes) and remove the occurrence.

Rerun until clean.

- [ ] **Step 2: Do NOT commit**

Per user constraint — leave changes staged-or-unstaged in the working tree.

---

## Self-review notes

- **Spec coverage:**
  - Layer (a) helpers — Task 1 Steps 1-2 ✓
  - Layer (b) dialog widget — Task 8 ✓
  - Layer (c) step input rename — Tasks 2, 3, 4, 5, 6 ✓
  - `Issue` shape rename + drop `issueRefShort` — Task 1 Step 5 ✓
  - `CustomStepInputType` drop `"issueRef"` — Task 1 Step 6, Task 7 ✓
  - Pipeline legacy types — Task 1 Steps 7-8 ✓
  - No migration — implicit (no migration tasks present) ✓
- **Placeholders:** None. Every step contains the exact text to find/replace.
- **Type consistency:** `ref: string` used uniformly everywhere across tasks. `IIssueProvider.getIssue` still takes `{ id }` — confirmed unchanged.
- **No commits:** Task 9 Step 2 explicitly states no commit.
- **No tests:** No test-writing steps in any task; verification is the typecheck alone.
