# Phase Rename & Description Refresh — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [docs/superpowers/specs/2026-04-30-phase-rename-design.md](../specs/2026-04-30-phase-rename-design.md)

**Goal:** Rename every phase ID, label, category, JS export, file name, and orchestrator handler class to match the System+Action scheme; consolidate `description` into `.meta.ts` so the backend `/phases` API exposes it.

**Architecture:** Mechanical text-and-file rename across `packages/phases`, `packages/orchestrator`, and one type addition in `PhaseCatalogEntry`. No behavioral change.

**Tech Stack:** TypeScript / npm workspaces. Single typecheck at the end (`npm run typecheck`).

**Constraints (per user):**
- **No commits during implementation.** Do not run `git commit`, `git add`, or any commit-creating command.
- **Typecheck only once, at the very end.** Do not run `npm run typecheck` between tasks.
- **No unit tests.** Do not write tests; do not modify existing tests beyond keeping them compiling (string updates only if a test references an old phaseType).

---

## File rename reference table

Each phase rename below means **four** coordinated changes:

1. `packages/phases/src/<area>/<phase>.meta.ts` — file + constants
2. `packages/phases/src/<area>/<phase>.tsx` — file + JS export name
3. `packages/orchestrator/src/workers/phases/<phase>-phase-handler.ts` — file + class name + `phaseType` literal
4. `packages/phases/src/registry.ts` — import + array entry
5. `packages/orchestrator/src/cli-worker.ts` — import + `new ...PhaseHandler` call
6. `packages/phases/src/catalog.ts` — imports + catalog row + add `description`

| Old base name | New base name | Old JS export | New JS export | Old class | New class |
|---|---|---|---|---|---|
| `analyze` | `analyze-repo` | `analyzePhase` | `analyzeRepoPhase` | `AnalyzePhaseHandler` | `AnalyzeRepoPhaseHandler` |
| `plan` | `plan-implementation` | `planPhase` | `planImplementationPhase` | `PlanPhaseHandler` | `PlanImplementationPhaseHandler` |
| `implement` | `implement-changes` | `implementPhase` | `implementChangesPhase` | `ImplementPhaseHandler` | `ImplementChangesPhaseHandler` |
| `create-workspace` | *(unchanged)* | `createWorkspacePhase` | *(unchanged)* | `CreateWorkspacePhaseHandler` | *(unchanged)* |
| `scan-repos` | `list-workspace-files` | `scanReposPhase` | `listWorkspaceFilesPhase` | `ScanReposPhaseHandler` | `ListWorkspaceFilesPhaseHandler` |
| `checkout-repo` | `start-feature-branch` | `checkoutRepoPhase` | `startFeatureBranchPhase` | `CheckoutRepoPhaseHandler` | `StartFeatureBranchPhaseHandler` |
| `commit-push` | `commit-and-push` | `commitPushPhase` | `commitAndPushPhase` | `CommitPushPhaseHandler` | `CommitAndPushPhaseHandler` |
| `cleanup-repos` | `cleanup-workspace` | `cleanupReposPhase` | `cleanupWorkspacePhase` | `CleanupReposPhaseHandler` | `CleanupWorkspacePhaseHandler` |
| `get-repo` | `get-repository` | `getRepoPhase` | `getRepositoryPhase` | `GetRepoPhaseHandler` | `GetRepositoryPhaseHandler` |
| `clone-repos` | *(unchanged)* | `cloneReposPhase` | *(unchanged)* | `CloneReposPhaseHandler` | *(unchanged)* |
| `create-pr` | `open-pull-request` | `createPrPhase` | `openPullRequestPhase` | `CreatePrPhaseHandler` | `OpenPullRequestPhaseHandler` |
| `list-prs` | `list-pull-requests` | `listPrsPhase` | `listPullRequestsPhase` | `ListPrsPhaseHandler` | `ListPullRequestsPhaseHandler` |
| `add-pr-comment` | `comment-on-pull-request` | `addPrCommentPhase` | `commentOnPullRequestPhase` | `AddPrCommentPhaseHandler` | `CommentOnPullRequestPhaseHandler` |
| `fetch-pr-comments` | `list-pull-request-comments` | `fetchPrCommentsPhase` | `listPullRequestCommentsPhase` | `FetchPrCommentsPhaseHandler` | `ListPullRequestCommentsPhaseHandler` |
| `get-ticket` | *(unchanged)* | `getTicketPhase` | *(unchanged)* | `GetTicketPhaseHandler` | *(unchanged)* |
| `create-ticket` | *(unchanged)* | `createTicketPhase` | *(unchanged)* | `CreateTicketPhaseHandler` | *(unchanged)* |
| `update-ticket` | `update-ticket-fields` | `updateTicketPhase` | `updateTicketFieldsPhase` | `UpdateTicketPhaseHandler` | `UpdateTicketFieldsPhaseHandler` |
| `update-status` | `transition-ticket` | `updateStatusPhase` | `transitionTicketPhase` | `UpdateStatusPhaseHandler` | `TransitionTicketPhaseHandler` |
| `add-ticket-comment` | `comment-on-ticket` | `addTicketCommentPhase` | `commentOnTicketPhase` | `AddTicketCommentPhaseHandler` | `CommentOnTicketPhaseHandler` |
| `notify` | `send-message` | `notifyPhase` | `sendMessagePhase` | `NotifyPhaseHandler` | `SendMessagePhaseHandler` |

> Constant prefixes inside `*.meta.ts` use the SCREAMING_SNAKE form of the new base name. For example `update-status` → `update-ticket-fields` means `UPDATE_STATUS_PHASE_TYPE` → `UPDATE_TICKET_FIELDS_PHASE_TYPE` (and same for `_LABEL`, `_CATEGORY`, `_DESCRIPTION`, `_INPUT_FIELDS`, `_OUTPUT_SCHEMA` style identifiers).

> When a base name is **unchanged**, the meta-file constants and export names are unchanged too — but those phases STILL get a new `*_DESCRIPTION` constant added in Task `cat-1`, and their `.tsx` description is replaced with an import.

---

## Task 0 — Add `description` field to `PhaseCatalogEntry`

**Files:**
- Modify: `packages/phases/src/catalog.ts`

- [ ] **Step 1: Add `description: string` to the `PhaseCatalogEntry` interface**

In `packages/phases/src/catalog.ts`, change:

```ts
export interface PhaseCatalogEntry {
  phaseType: string;
  label: string;
  category: string;
  inputFields: InputFields;
  outputSchema: OutputSchema | null;
}
```

to:

```ts
export interface PhaseCatalogEntry {
  phaseType: string;
  label: string;
  category: string;
  description: string;
  inputFields: InputFields;
  outputSchema: OutputSchema | null;
}
```

> The catalog rows themselves are populated in Task `cat-1` after every `*_DESCRIPTION` constant is added.

---

## Coding Agent (3 phases)

### Task A1 — `analyze` → `analyze-repo`

**Files:**
- Rename: `packages/phases/src/ai/analyze.meta.ts` → `packages/phases/src/ai/analyze-repo.meta.ts`
- Rename: `packages/phases/src/ai/analyze.tsx` → `packages/phases/src/ai/analyze-repo.tsx`
- Rename: `packages/orchestrator/src/workers/phases/analyze-phase-handler.ts` → `packages/orchestrator/src/workers/phases/analyze-repo-phase-handler.ts`
- Modify: `packages/phases/src/registry.ts`
- Modify: `packages/phases/src/catalog.ts`
- Modify: `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 1: Rename the meta file and update its constants**

```bash
mv packages/phases/src/ai/analyze.meta.ts packages/phases/src/ai/analyze-repo.meta.ts
```

Replace the file contents with:

```ts
import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const ANALYZE_REPO_PHASE_TYPE = "analyze-repo";
export const ANALYZE_REPO_LABEL = "Analyze Repo";
export const ANALYZE_REPO_CATEGORY = "Coding Agent";
export const ANALYZE_REPO_DESCRIPTION =
  "Run a coding agent to analyze a repository against a ticket and report a summary, complexity, and likely-affected files.";

export const analyzeRepoOutputSchema: OutputSchema = {
  summary:       { type: "string", description: "Plain-language change summary" },
  complexity:    { type: "enum", values: ["low", "medium", "high"] },
  affectedFiles: { type: "string[]", description: "Files likely to change" },
};

export const analyzeRepoInputFields: InputFields = {
  dirPath:       { type: "string", label: "Repo path", required: true },
  ticketContent: { type: "string", label: "Ticket content", required: true },
};
```

- [ ] **Step 2: Rename the tsx file and update it**

```bash
mv packages/phases/src/ai/analyze.tsx packages/phases/src/ai/analyze-repo.tsx
```

Replace contents with:

```tsx
import { z } from "zod";
import type { PhaseDefinition } from "@journeyman/flow-editor";
import { summaryValue } from "@journeyman/flow-editor";
import {
  ANALYZE_REPO_PHASE_TYPE,
  ANALYZE_REPO_LABEL,
  ANALYZE_REPO_CATEGORY,
  ANALYZE_REPO_DESCRIPTION,
  analyzeRepoOutputSchema,
} from "./analyze-repo.meta.ts";

interface AnalyzeRepoConfig {
  dirPath: string;
  ticketContent: string;
}

export const analyzeRepoPhase: PhaseDefinition<AnalyzeRepoConfig> = {
  phaseType: ANALYZE_REPO_PHASE_TYPE,
  label: ANALYZE_REPO_LABEL,
  category: ANALYZE_REPO_CATEGORY,
  description: ANALYZE_REPO_DESCRIPTION,
  color: "#00b894",
  icon: "🤖",
  defaultConfig: { dirPath: "", ticketContent: "" },
  configSchema: z.object({
    dirPath: z.string().min(1, "dirPath is required"),
    ticketContent: z.string().min(1, "ticketContent is required"),
  }),
  configFields: {
    dirPath:       { label: "Repo path",      widget: "text",     help: "Local path or workspace ref" },
    ticketContent: { label: "Ticket content", widget: "textarea", help: "Markdown body of the ticket" },
  },
  tabs: { io: "shown", credentials: "required", mcp: "shown", retry: "shown" },
  summary: (c, ctx) => summaryValue(c, ctx, "dirPath") || "(no repo)",
  executor: { kind: "coding-cli", method: "analyze" },
  outputSchema: analyzeRepoOutputSchema,
};
```

- [ ] **Step 3: Rename and update the orchestrator handler**

```bash
mv packages/orchestrator/src/workers/phases/analyze-phase-handler.ts \
   packages/orchestrator/src/workers/phases/analyze-repo-phase-handler.ts
```

In the renamed file, change:
- `export class AnalyzePhaseHandler` → `export class AnalyzeRepoPhaseHandler`
- `readonly phaseType = "analyze";` → `readonly phaseType = "analyze-repo";`

- [ ] **Step 4: Update `packages/phases/src/registry.ts`**

Replace:

```ts
import { analyzePhase } from "./ai/analyze.tsx";
```

with:

```ts
import { analyzeRepoPhase } from "./ai/analyze-repo.tsx";
```

In the `builtInPhases` array, replace `analyzePhase` with `analyzeRepoPhase`.

- [ ] **Step 5: Update `packages/phases/src/catalog.ts` imports for analyze-repo**

Replace the analyze import block:

```ts
import {
  ANALYZE_PHASE_TYPE, ANALYZE_LABEL, ANALYZE_CATEGORY, analyzeOutputSchema, analyzeInputFields,
} from "./ai/analyze.meta.ts";
```

with:

```ts
import {
  ANALYZE_REPO_PHASE_TYPE, ANALYZE_REPO_LABEL, ANALYZE_REPO_CATEGORY, ANALYZE_REPO_DESCRIPTION,
  analyzeRepoOutputSchema, analyzeRepoInputFields,
} from "./ai/analyze-repo.meta.ts";
```

> The catalog row itself is updated in Task `cat-1`. Leave the row untouched for now — it will fail typecheck only if run early, and we typecheck once at the end.

- [ ] **Step 6: Update `packages/orchestrator/src/cli-worker.ts`**

Replace:

```ts
import { AnalyzePhaseHandler } from "./workers/phases/analyze-phase-handler.ts";
```

with:

```ts
import { AnalyzeRepoPhaseHandler } from "./workers/phases/analyze-repo-phase-handler.ts";
```

Replace `registry.register(new AnalyzePhaseHandler({ coding }));` with `registry.register(new AnalyzeRepoPhaseHandler({ coding }));`.

### Task A2 — `plan` → `plan-implementation`

**Files:**
- Rename: `packages/phases/src/ai/plan.meta.ts` → `packages/phases/src/ai/plan-implementation.meta.ts`
- Rename: `packages/phases/src/ai/plan.tsx` → `packages/phases/src/ai/plan-implementation.tsx`
- Rename: `packages/orchestrator/src/workers/phases/plan-phase-handler.ts` → `packages/orchestrator/src/workers/phases/plan-implementation-phase-handler.ts`
- Modify: `packages/phases/src/registry.ts`, `packages/phases/src/catalog.ts`, `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 1: Rename meta file and write new contents**

```bash
mv packages/phases/src/ai/plan.meta.ts packages/phases/src/ai/plan-implementation.meta.ts
```

```ts
import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const PLAN_IMPLEMENTATION_PHASE_TYPE = "plan-implementation";
export const PLAN_IMPLEMENTATION_LABEL = "Plan Implementation";
export const PLAN_IMPLEMENTATION_CATEGORY = "Coding Agent";
export const PLAN_IMPLEMENTATION_DESCRIPTION =
  "Produce an ordered implementation plan from a ticket and (optionally) a prior analysis.";

export const planImplementationOutputSchema: OutputSchema = {
  steps:            { type: "json", description: "Ordered list of implementation steps" },
  estimatedMinutes: { type: "number" },
};

export const planImplementationInputFields: InputFields = {
  dirPath:            { type: "string", label: "Repo path", required: true },
  ticketContent:      { type: "string", label: "Ticket content" },
  analyzeReportPath:  { type: "string", label: "Analyze report path" },
  focus:              { type: "string", label: "Focus / scope narrowing" },
  reviewComments:     { type: "string", label: "Reviewer comments" },
};
```

- [ ] **Step 2: Rename tsx file and update**

```bash
mv packages/phases/src/ai/plan.tsx packages/phases/src/ai/plan-implementation.tsx
```

Open the renamed file and apply the analogous changes (identical pattern to Task A1 Step 2 — replace constant imports, rename `planPhase` export to `planImplementationPhase`, replace `description: "..."` literal with `PLAN_IMPLEMENTATION_DESCRIPTION` import, rename interface `PlanConfig` → `PlanImplementationConfig`, rename `planOutputSchema` to `planImplementationOutputSchema`).

- [ ] **Step 3: Rename and update orchestrator handler**

```bash
mv packages/orchestrator/src/workers/phases/plan-phase-handler.ts \
   packages/orchestrator/src/workers/phases/plan-implementation-phase-handler.ts
```

In the renamed file:
- `PlanPhaseHandler` → `PlanImplementationPhaseHandler`
- `readonly phaseType = "plan";` → `readonly phaseType = "plan-implementation";`

- [ ] **Step 4: Update `packages/phases/src/registry.ts`**

`import { planPhase } from "./ai/plan.tsx";` → `import { planImplementationPhase } from "./ai/plan-implementation.tsx";`

In `builtInPhases`, `planPhase` → `planImplementationPhase`.

- [ ] **Step 5: Update `packages/phases/src/catalog.ts` imports**

Replace the plan import block with:

```ts
import {
  PLAN_IMPLEMENTATION_PHASE_TYPE, PLAN_IMPLEMENTATION_LABEL, PLAN_IMPLEMENTATION_CATEGORY,
  PLAN_IMPLEMENTATION_DESCRIPTION,
  planImplementationOutputSchema, planImplementationInputFields,
} from "./ai/plan-implementation.meta.ts";
```

- [ ] **Step 6: Update `packages/orchestrator/src/cli-worker.ts`**

`PlanPhaseHandler` → `PlanImplementationPhaseHandler` (import path + class) and the `new PlanPhaseHandler(...)` registration call.

### Task A3 — `implement` → `implement-changes`

**Files:**
- Rename: `packages/phases/src/ai/implement.meta.ts` → `packages/phases/src/ai/implement-changes.meta.ts`
- Rename: `packages/phases/src/ai/implement.tsx` → `packages/phases/src/ai/implement-changes.tsx`
- Rename: `packages/orchestrator/src/workers/phases/implement-phase-handler.ts` → `packages/orchestrator/src/workers/phases/implement-changes-phase-handler.ts`
- Modify: `packages/phases/src/registry.ts`, `packages/phases/src/catalog.ts`, `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 1: Rename meta and rewrite**

```bash
mv packages/phases/src/ai/implement.meta.ts packages/phases/src/ai/implement-changes.meta.ts
```

```ts
import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const IMPLEMENT_CHANGES_PHASE_TYPE = "implement-changes";
export const IMPLEMENT_CHANGES_LABEL = "Implement Changes";
export const IMPLEMENT_CHANGES_CATEGORY = "Coding Agent";
export const IMPLEMENT_CHANGES_DESCRIPTION =
  "Execute an implementation plan against a repo using a coding agent; emits a diff summary and the list of changed files.";

export const implementChangesOutputSchema: OutputSchema = {
  filesChanged: { type: "string[]" },
  diffSummary:  { type: "string" },
};

export const implementChangesInputFields: InputFields = {
  dirPath:            { type: "string", label: "Repo path", required: true },
  planReportPath:     { type: "string", label: "Plan report path", required: true },
  ticketContent:      { type: "string", label: "Ticket content" },
  analyzeReportPath:  { type: "string", label: "Analyze report path" },
  focus:              { type: "string", label: "Focus / scope narrowing" },
  reviewComments:     { type: "string", label: "Reviewer comments" },
};
```

- [ ] **Step 2: Rename tsx and update**

```bash
mv packages/phases/src/ai/implement.tsx packages/phases/src/ai/implement-changes.tsx
```

Apply pattern: rename interface `ImplementConfig` → `ImplementChangesConfig`, rename export `implementPhase` → `implementChangesPhase`, replace constant imports with `IMPLEMENT_CHANGES_*`, set `description: IMPLEMENT_CHANGES_DESCRIPTION`.

- [ ] **Step 3: Rename and update handler**

```bash
mv packages/orchestrator/src/workers/phases/implement-phase-handler.ts \
   packages/orchestrator/src/workers/phases/implement-changes-phase-handler.ts
```

`ImplementPhaseHandler` → `ImplementChangesPhaseHandler`; `readonly phaseType = "implement";` → `"implement-changes"`.

- [ ] **Step 4: registry.ts**

`implementPhase` → `implementChangesPhase` (import + array).

- [ ] **Step 5: catalog.ts imports**

```ts
import {
  IMPLEMENT_CHANGES_PHASE_TYPE, IMPLEMENT_CHANGES_LABEL, IMPLEMENT_CHANGES_CATEGORY,
  IMPLEMENT_CHANGES_DESCRIPTION,
  implementChangesOutputSchema, implementChangesInputFields,
} from "./ai/implement-changes.meta.ts";
```

- [ ] **Step 6: cli-worker.ts**

`ImplementPhaseHandler` → `ImplementChangesPhaseHandler` (import + registration).

---

## Workspace (5 phases)

### Task W1 — `create-workspace` (ID unchanged; add description only)

**Files:**
- Modify: `packages/phases/src/repos/create-workspace.meta.ts`
- Modify: `packages/phases/src/repos/create-workspace.tsx`
- Modify: `packages/phases/src/catalog.ts`

- [ ] **Step 1: Add description constant + update category in `create-workspace.meta.ts`**

Change `CREATE_WORKSPACE_CATEGORY = "Repos"` to `CREATE_WORKSPACE_CATEGORY = "Workspace"`.

After the existing constants, add:

```ts
export const CREATE_WORKSPACE_DESCRIPTION =
  "Create a new local directory to hold repositories for this run.";
```

- [ ] **Step 2: Update `create-workspace.tsx`**

Add `CREATE_WORKSPACE_DESCRIPTION` to the import from `./create-workspace.meta.ts`. Replace the inline `description: "..."` literal with `description: CREATE_WORKSPACE_DESCRIPTION,`.

- [ ] **Step 3: Update `catalog.ts` imports for create-workspace**

Add `CREATE_WORKSPACE_DESCRIPTION` to the existing import block.

### Task W2 — `scan-repos` → `list-workspace-files`

**Files:**
- Rename: `packages/phases/src/repos/scan-repos.meta.ts` → `packages/phases/src/repos/list-workspace-files.meta.ts`
- Rename: `packages/phases/src/repos/scan-repos.tsx` → `packages/phases/src/repos/list-workspace-files.tsx`
- Rename: `packages/orchestrator/src/workers/phases/scan-repos-phase-handler.ts` → `packages/orchestrator/src/workers/phases/list-workspace-files-phase-handler.ts`
- Modify: `packages/phases/src/registry.ts`, `packages/phases/src/catalog.ts`, `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 1: Rename meta file and rewrite**

```bash
mv packages/phases/src/repos/scan-repos.meta.ts packages/phases/src/repos/list-workspace-files.meta.ts
```

```ts
import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const LIST_WORKSPACE_FILES_PHASE_TYPE = "list-workspace-files";
export const LIST_WORKSPACE_FILES_LABEL = "List Workspace Files";
export const LIST_WORKSPACE_FILES_CATEGORY = "Workspace";
export const LIST_WORKSPACE_FILES_DESCRIPTION =
  "List files in a workspace directory matching a glob pattern.";

export const listWorkspaceFilesOutputSchema: OutputSchema = {
  files: { type: "string[]" },
  fileCount: { type: "number" },
};

export const listWorkspaceFilesInputFields: InputFields = {
  pattern:      { type: "string", label: "Pattern" },
  workspaceDir: { type: "string", label: "Workspace dir", required: true, bindOnly: true },
};
```

- [ ] **Step 2: Rename tsx and update**

```bash
mv packages/phases/src/repos/scan-repos.tsx packages/phases/src/repos/list-workspace-files.tsx
```

Rename interface `ScanReposConfig` → `ListWorkspaceFilesConfig`, export `scanReposPhase` → `listWorkspaceFilesPhase`, switch all constant imports to `LIST_WORKSPACE_FILES_*` and `listWorkspaceFilesOutputSchema`, set `description: LIST_WORKSPACE_FILES_DESCRIPTION`.

- [ ] **Step 3: Rename and update orchestrator handler**

```bash
mv packages/orchestrator/src/workers/phases/scan-repos-phase-handler.ts \
   packages/orchestrator/src/workers/phases/list-workspace-files-phase-handler.ts
```

`ScanReposPhaseHandler` → `ListWorkspaceFilesPhaseHandler`; `readonly phaseType = "scan-repos";` → `"list-workspace-files"`.

- [ ] **Step 4: registry.ts** — `scanReposPhase` → `listWorkspaceFilesPhase`.

- [ ] **Step 5: catalog.ts imports** — replace block with new constant names from `./repos/list-workspace-files.meta.ts`.

- [ ] **Step 6: cli-worker.ts** — `ScanReposPhaseHandler` → `ListWorkspaceFilesPhaseHandler` (import + registration).

### Task W3 — `checkout-repo` → `start-feature-branch`

**Files:**
- Rename: `packages/phases/src/repos/checkout-repo.meta.ts` → `packages/phases/src/repos/start-feature-branch.meta.ts`
- Rename: `packages/phases/src/repos/checkout-repo.tsx` → `packages/phases/src/repos/start-feature-branch.tsx`
- Rename: `packages/orchestrator/src/workers/phases/checkout-repo-phase-handler.ts` → `packages/orchestrator/src/workers/phases/start-feature-branch-phase-handler.ts`
- Modify: `registry.ts`, `catalog.ts`, `cli-worker.ts`

- [ ] **Step 1: Rename meta and rewrite**

```bash
mv packages/phases/src/repos/checkout-repo.meta.ts packages/phases/src/repos/start-feature-branch.meta.ts
```

```ts
import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const START_FEATURE_BRANCH_PHASE_TYPE = "start-feature-branch";
export const START_FEATURE_BRANCH_LABEL = "Start Feature Branch";
export const START_FEATURE_BRANCH_CATEGORY = "Workspace";
export const START_FEATURE_BRANCH_DESCRIPTION =
  "Sync already-cloned repos to origin (hard-reset to the base branch), then create one shared feature branch across all of them. The branch name is generated from the ticket.";

export const startFeatureBranchOutputSchema: OutputSchema = {
  dirPath: { type: "string", description: "Local directory the repo was cloned into" },
  branch: { type: "string" },
  commitSha: { type: "string" },
};

export const startFeatureBranchInputFields: InputFields = {
  url:          { type: "string", label: "URL", required: true },
  branch:       { type: "string", label: "Branch" },
  workspaceDir: { type: "string", label: "Workspace dir", required: true, bindOnly: true },
};
```

- [ ] **Step 2: Rename tsx and update**

```bash
mv packages/phases/src/repos/checkout-repo.tsx packages/phases/src/repos/start-feature-branch.tsx
```

Rename: interface `CheckoutRepoConfig` → `StartFeatureBranchConfig`, export `checkoutRepoPhase` → `startFeatureBranchPhase`, schemas + imports → `START_FEATURE_BRANCH_*`, `startFeatureBranchOutputSchema`, `description: START_FEATURE_BRANCH_DESCRIPTION`.

- [ ] **Step 3: Rename and update handler**

```bash
mv packages/orchestrator/src/workers/phases/checkout-repo-phase-handler.ts \
   packages/orchestrator/src/workers/phases/start-feature-branch-phase-handler.ts
```

`CheckoutRepoPhaseHandler` → `StartFeatureBranchPhaseHandler`; `readonly phaseType = "checkout-repo";` → `"start-feature-branch"`.

> The handler still calls `coding.checkoutRepo()` — that's the **provider method name** (camelCase) and stays unchanged. Only the `phaseType` ID and the class name change.

- [ ] **Step 4: registry.ts** — `checkoutRepoPhase` → `startFeatureBranchPhase`.

- [ ] **Step 5: catalog.ts imports** — switch to `START_FEATURE_BRANCH_*` from `./repos/start-feature-branch.meta.ts`.

- [ ] **Step 6: cli-worker.ts** — `CheckoutRepoPhaseHandler` → `StartFeatureBranchPhaseHandler`.

### Task W4 — `commit-push` → `commit-and-push`

**Files:**
- Rename: `packages/phases/src/repos/commit-push.meta.ts` → `packages/phases/src/repos/commit-and-push.meta.ts`
- Rename: `packages/phases/src/repos/commit-push.tsx` → `packages/phases/src/repos/commit-and-push.tsx`
- Rename: `packages/orchestrator/src/workers/phases/commit-push-phase-handler.ts` → `packages/orchestrator/src/workers/phases/commit-and-push-phase-handler.ts`
- Modify: `registry.ts`, `catalog.ts`, `cli-worker.ts`

- [ ] **Step 1: Rename meta and rewrite**

```bash
mv packages/phases/src/repos/commit-push.meta.ts packages/phases/src/repos/commit-and-push.meta.ts
```

```ts
import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const COMMIT_AND_PUSH_PHASE_TYPE = "commit-and-push";
export const COMMIT_AND_PUSH_LABEL = "Commit & Push";
export const COMMIT_AND_PUSH_CATEGORY = "Workspace";
export const COMMIT_AND_PUSH_DESCRIPTION =
  "Stage all changes, commit, and push to the remote branch.";

export const commitAndPushOutputSchema: OutputSchema = {
  commitSha: { type: "string" },
  pushed: { type: "boolean" },
};

export const commitAndPushInputFields: InputFields = {
  repoPath: { type: "string", label: "Repo path", required: true },
  message:  { type: "string", label: "Message", required: true },
  branch:   { type: "string", label: "Branch" },
};
```

- [ ] **Step 2: Rename tsx, rename interface/export, swap imports**

```bash
mv packages/phases/src/repos/commit-push.tsx packages/phases/src/repos/commit-and-push.tsx
```

`CommitPushConfig` → `CommitAndPushConfig`, `commitPushPhase` → `commitAndPushPhase`, all `COMMIT_PUSH_*` constants → `COMMIT_AND_PUSH_*`, `commitPushOutputSchema` → `commitAndPushOutputSchema`, `description: COMMIT_AND_PUSH_DESCRIPTION`.

- [ ] **Step 3: Rename handler**

```bash
mv packages/orchestrator/src/workers/phases/commit-push-phase-handler.ts \
   packages/orchestrator/src/workers/phases/commit-and-push-phase-handler.ts
```

`CommitPushPhaseHandler` → `CommitAndPushPhaseHandler`; `readonly phaseType = "commit-push";` → `"commit-and-push"`.

- [ ] **Step 4: registry.ts** — `commitPushPhase` → `commitAndPushPhase`.

- [ ] **Step 5: catalog.ts imports** — switch to `COMMIT_AND_PUSH_*` from `./repos/commit-and-push.meta.ts`.

- [ ] **Step 6: cli-worker.ts** — `CommitPushPhaseHandler` → `CommitAndPushPhaseHandler`.

### Task W5 — `cleanup-repos` → `cleanup-workspace`

**Files:**
- Rename: `packages/phases/src/repos/cleanup-repos.meta.ts` → `packages/phases/src/repos/cleanup-workspace.meta.ts`
- Rename: `packages/phases/src/repos/cleanup-repos.tsx` → `packages/phases/src/repos/cleanup-workspace.tsx`
- Rename: `packages/orchestrator/src/workers/phases/cleanup-repos-phase-handler.ts` → `packages/orchestrator/src/workers/phases/cleanup-workspace-phase-handler.ts`
- Modify: `registry.ts`, `catalog.ts`, `cli-worker.ts`

- [ ] **Step 1: Rename meta and rewrite**

```bash
mv packages/phases/src/repos/cleanup-repos.meta.ts packages/phases/src/repos/cleanup-workspace.meta.ts
```

```ts
import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const CLEANUP_WORKSPACE_PHASE_TYPE = "cleanup-workspace";
export const CLEANUP_WORKSPACE_LABEL = "Cleanup Workspace";
export const CLEANUP_WORKSPACE_CATEGORY = "Workspace";
export const CLEANUP_WORKSPACE_DESCRIPTION =
  "Reset and optionally delete repositories in a workspace.";

export const cleanupWorkspaceOutputSchema: OutputSchema = {
  removed: { type: "boolean" },
};

export const cleanupWorkspaceInputFields: InputFields = {
  mode:         { type: "string", label: "Mode" },
  workspaceDir: { type: "string", label: "Workspace dir", required: true, bindOnly: true },
};
```

- [ ] **Step 2: Rename tsx, rename interface/export**

```bash
mv packages/phases/src/repos/cleanup-repos.tsx packages/phases/src/repos/cleanup-workspace.tsx
```

`CleanupReposConfig` → `CleanupWorkspaceConfig`, `cleanupReposPhase` → `cleanupWorkspacePhase`, swap all `CLEANUP_REPOS_*` for `CLEANUP_WORKSPACE_*`, `cleanupReposOutputSchema` → `cleanupWorkspaceOutputSchema`, `description: CLEANUP_WORKSPACE_DESCRIPTION`.

- [ ] **Step 3: Rename handler**

```bash
mv packages/orchestrator/src/workers/phases/cleanup-repos-phase-handler.ts \
   packages/orchestrator/src/workers/phases/cleanup-workspace-phase-handler.ts
```

`CleanupReposPhaseHandler` → `CleanupWorkspacePhaseHandler`; `readonly phaseType = "cleanup-repos";` → `"cleanup-workspace"`.

- [ ] **Step 4: registry.ts** — `cleanupReposPhase` → `cleanupWorkspacePhase`.

- [ ] **Step 5: catalog.ts imports** — switch to `CLEANUP_WORKSPACE_*` from `./repos/cleanup-workspace.meta.ts`.

- [ ] **Step 6: cli-worker.ts** — `CleanupReposPhaseHandler` → `CleanupWorkspacePhaseHandler`.

---

## Code Host (6 phases)

### Task H1 — `get-repo` → `get-repository`

**Files:**
- Rename: `packages/phases/src/git/get-repo.meta.ts` → `packages/phases/src/git/get-repository.meta.ts`
- Rename: `packages/phases/src/git/get-repo.tsx` → `packages/phases/src/git/get-repository.tsx`
- Rename: `packages/orchestrator/src/workers/phases/get-repo-phase-handler.ts` → `packages/orchestrator/src/workers/phases/get-repository-phase-handler.ts`
- Modify: `registry.ts`, `catalog.ts`, `cli-worker.ts`

- [ ] **Step 1: Rename meta and rewrite**

```bash
mv packages/phases/src/git/get-repo.meta.ts packages/phases/src/git/get-repository.meta.ts
```

```ts
import type { InputFields } from "../shared-meta.ts";

export const GET_REPOSITORY_PHASE_TYPE = "get-repository";
export const GET_REPOSITORY_LABEL = "Get Repository";
export const GET_REPOSITORY_CATEGORY = "Code Host";
export const GET_REPOSITORY_DESCRIPTION =
  "Fetch metadata for a remote repository.";

export const getRepositoryInputFields: InputFields = {
  owner: { type: "string", label: "Owner / org", required: true },
  repo:  { type: "string", label: "Repository", required: true },
};
```

- [ ] **Step 2: Rename tsx and update**

```bash
mv packages/phases/src/git/get-repo.tsx packages/phases/src/git/get-repository.tsx
```

`GetRepoConfig` → `GetRepositoryConfig`, `getRepoPhase` → `getRepositoryPhase`, all `GET_REPO_*` → `GET_REPOSITORY_*`, `description: GET_REPOSITORY_DESCRIPTION`.

- [ ] **Step 3: Rename handler**

```bash
mv packages/orchestrator/src/workers/phases/get-repo-phase-handler.ts \
   packages/orchestrator/src/workers/phases/get-repository-phase-handler.ts
```

`GetRepoPhaseHandler` → `GetRepositoryPhaseHandler`; `readonly phaseType = "get-repo";` → `"get-repository"`.

- [ ] **Step 4: registry.ts** — `getRepoPhase` → `getRepositoryPhase`.

- [ ] **Step 5: catalog.ts imports** — switch to `GET_REPOSITORY_*`.

- [ ] **Step 6: cli-worker.ts** — `GetRepoPhaseHandler` → `GetRepositoryPhaseHandler`.

### Task H2 — `clone-repos` (ID + filenames unchanged; category + description only)

**Files:**
- Modify: `packages/phases/src/git/clone-repos.meta.ts`
- Modify: `packages/phases/src/git/clone-repos.tsx`
- Modify: `packages/phases/src/catalog.ts`

- [ ] **Step 1: Update meta — change category, add description**

In `clone-repos.meta.ts`, change `CLONE_REPOS_CATEGORY = "Git"` to `CLONE_REPOS_CATEGORY = "Code Host"`. Append:

```ts
export const CLONE_REPOS_DESCRIPTION =
  "Bulk-clone repositories from the code host into a target directory using host credentials.";
```

- [ ] **Step 2: Update tsx**

Add `CLONE_REPOS_DESCRIPTION` to imports. Replace the inline `description: "..."` with `description: CLONE_REPOS_DESCRIPTION,`.

- [ ] **Step 3: catalog.ts imports** — add `CLONE_REPOS_DESCRIPTION` to the existing clone-repos import block.

### Task H3 — `create-pr` → `open-pull-request`

**Files:**
- Rename: `packages/phases/src/git/create-pr.meta.ts` → `packages/phases/src/git/open-pull-request.meta.ts`
- Rename: `packages/phases/src/git/create-pr.tsx` → `packages/phases/src/git/open-pull-request.tsx`
- Rename: `packages/orchestrator/src/workers/phases/create-pr-phase-handler.ts` → `packages/orchestrator/src/workers/phases/open-pull-request-phase-handler.ts`
- Modify: `registry.ts`, `catalog.ts`, `cli-worker.ts`

- [ ] **Step 1: Rename meta and rewrite**

```bash
mv packages/phases/src/git/create-pr.meta.ts packages/phases/src/git/open-pull-request.meta.ts
```

```ts
import type { InputFields } from "../shared-meta.ts";

export const OPEN_PULL_REQUEST_PHASE_TYPE = "open-pull-request";
export const OPEN_PULL_REQUEST_LABEL = "Open Pull Request";
export const OPEN_PULL_REQUEST_CATEGORY = "Code Host";
export const OPEN_PULL_REQUEST_DESCRIPTION =
  "Open a pull/merge request on the remote.";

export const openPullRequestInputFields: InputFields = {
  owner: { type: "string", label: "Owner / org", required: true },
  repo:  { type: "string", label: "Repository", required: true },
  title: { type: "string", label: "Title", required: true },
  body:  { type: "string", label: "Body" },
  head:  { type: "string", label: "Head branch", required: true },
  base:  { type: "string", label: "Base branch", required: true },
};
```

- [ ] **Step 2: Rename tsx, swap names**

```bash
mv packages/phases/src/git/create-pr.tsx packages/phases/src/git/open-pull-request.tsx
```

`CreatePrConfig` → `OpenPullRequestConfig`, `createPrPhase` → `openPullRequestPhase`, `CREATE_PR_*` → `OPEN_PULL_REQUEST_*`, `createPrInputFields` → `openPullRequestInputFields`, `description: OPEN_PULL_REQUEST_DESCRIPTION`.

- [ ] **Step 3: Rename handler**

```bash
mv packages/orchestrator/src/workers/phases/create-pr-phase-handler.ts \
   packages/orchestrator/src/workers/phases/open-pull-request-phase-handler.ts
```

`CreatePrPhaseHandler` → `OpenPullRequestPhaseHandler`; `readonly phaseType = "create-pr";` → `"open-pull-request"`.

- [ ] **Step 4: registry.ts** — `createPrPhase` → `openPullRequestPhase`.

- [ ] **Step 5: catalog.ts imports** — switch to `OPEN_PULL_REQUEST_*` from `./git/open-pull-request.meta.ts`.

- [ ] **Step 6: cli-worker.ts** — `CreatePrPhaseHandler` → `OpenPullRequestPhaseHandler`.

### Task H4 — `list-prs` → `list-pull-requests`

**Files:**
- Rename: `packages/phases/src/git/list-prs.meta.ts` → `packages/phases/src/git/list-pull-requests.meta.ts`
- Rename: `packages/phases/src/git/list-prs.tsx` → `packages/phases/src/git/list-pull-requests.tsx`
- Rename: `packages/orchestrator/src/workers/phases/list-prs-phase-handler.ts` → `packages/orchestrator/src/workers/phases/list-pull-requests-phase-handler.ts`
- Modify: `registry.ts`, `catalog.ts`, `cli-worker.ts`

- [ ] **Step 1: Rename meta and rewrite**

```bash
mv packages/phases/src/git/list-prs.meta.ts packages/phases/src/git/list-pull-requests.meta.ts
```

```ts
import type { InputFields } from "../shared-meta.ts";

export const LIST_PULL_REQUESTS_PHASE_TYPE = "list-pull-requests";
export const LIST_PULL_REQUESTS_LABEL = "List Pull Requests";
export const LIST_PULL_REQUESTS_CATEGORY = "Code Host";
export const LIST_PULL_REQUESTS_DESCRIPTION =
  "List pull/merge requests on a repository, filtered by state.";

export const listPullRequestsInputFields: InputFields = {
  owner: { type: "string", label: "Owner / org", required: true },
  repo:  { type: "string", label: "Repository", required: true },
  state: { type: "string", label: "State" },
};
```

- [ ] **Step 2: Rename tsx, swap names**

```bash
mv packages/phases/src/git/list-prs.tsx packages/phases/src/git/list-pull-requests.tsx
```

`ListPrsConfig` → `ListPullRequestsConfig`, `listPrsPhase` → `listPullRequestsPhase`, `LIST_PRS_*` → `LIST_PULL_REQUESTS_*`, `listPrsInputFields` → `listPullRequestsInputFields`, `description: LIST_PULL_REQUESTS_DESCRIPTION`.

- [ ] **Step 3: Rename handler**

```bash
mv packages/orchestrator/src/workers/phases/list-prs-phase-handler.ts \
   packages/orchestrator/src/workers/phases/list-pull-requests-phase-handler.ts
```

`ListPrsPhaseHandler` → `ListPullRequestsPhaseHandler`; `readonly phaseType = "list-prs";` → `"list-pull-requests"`.

- [ ] **Step 4: registry.ts** — `listPrsPhase` → `listPullRequestsPhase`.

- [ ] **Step 5: catalog.ts imports** — switch to `LIST_PULL_REQUESTS_*`.

- [ ] **Step 6: cli-worker.ts** — `ListPrsPhaseHandler` → `ListPullRequestsPhaseHandler`.

### Task H5 — `add-pr-comment` → `comment-on-pull-request`

**Files:**
- Rename: `packages/phases/src/git/add-pr-comment.meta.ts` → `packages/phases/src/git/comment-on-pull-request.meta.ts`
- Rename: `packages/phases/src/git/add-pr-comment.tsx` → `packages/phases/src/git/comment-on-pull-request.tsx`
- Rename: `packages/orchestrator/src/workers/phases/add-pr-comment-phase-handler.ts` → `packages/orchestrator/src/workers/phases/comment-on-pull-request-phase-handler.ts`
- Modify: `registry.ts`, `catalog.ts`, `cli-worker.ts`

- [ ] **Step 1: Rename meta and rewrite**

```bash
mv packages/phases/src/git/add-pr-comment.meta.ts packages/phases/src/git/comment-on-pull-request.meta.ts
```

```ts
import type { InputFields } from "../shared-meta.ts";

export const COMMENT_ON_PULL_REQUEST_PHASE_TYPE = "comment-on-pull-request";
export const COMMENT_ON_PULL_REQUEST_LABEL = "Comment on Pull Request";
export const COMMENT_ON_PULL_REQUEST_CATEGORY = "Code Host";
export const COMMENT_ON_PULL_REQUEST_DESCRIPTION =
  "Post a comment on a pull/merge request, optionally rendered from a template.";

export const commentOnPullRequestInputFields: InputFields = {
  owner:    { type: "string", label: "Owner / org", required: true },
  repo:     { type: "string", label: "Repository", required: true },
  prNumber: { type: "number", label: "PR number" },
  template: { type: "string", label: "Template id" },
  body:     { type: "string", label: "Inline body (optional)" },
};
```

- [ ] **Step 2: Rename tsx, swap names**

```bash
mv packages/phases/src/git/add-pr-comment.tsx packages/phases/src/git/comment-on-pull-request.tsx
```

`AddPrCommentConfig` → `CommentOnPullRequestConfig`, `addPrCommentPhase` → `commentOnPullRequestPhase`, `ADD_PR_COMMENT_*` → `COMMENT_ON_PULL_REQUEST_*`, `addPrCommentInputFields` → `commentOnPullRequestInputFields`, `description: COMMENT_ON_PULL_REQUEST_DESCRIPTION`.

- [ ] **Step 3: Rename handler**

```bash
mv packages/orchestrator/src/workers/phases/add-pr-comment-phase-handler.ts \
   packages/orchestrator/src/workers/phases/comment-on-pull-request-phase-handler.ts
```

`AddPrCommentPhaseHandler` → `CommentOnPullRequestPhaseHandler`; `readonly phaseType = "add-pr-comment";` → `"comment-on-pull-request"`.

- [ ] **Step 4: registry.ts** — `addPrCommentPhase` → `commentOnPullRequestPhase`.

- [ ] **Step 5: catalog.ts imports** — switch to `COMMENT_ON_PULL_REQUEST_*`.

- [ ] **Step 6: cli-worker.ts** — `AddPrCommentPhaseHandler` → `CommentOnPullRequestPhaseHandler`.

### Task H6 — `fetch-pr-comments` → `list-pull-request-comments`

**Files:**
- Rename: `packages/phases/src/git/fetch-pr-comments.meta.ts` → `packages/phases/src/git/list-pull-request-comments.meta.ts`
- Rename: `packages/phases/src/git/fetch-pr-comments.tsx` → `packages/phases/src/git/list-pull-request-comments.tsx`
- Rename: `packages/orchestrator/src/workers/phases/fetch-pr-comments-phase-handler.ts` → `packages/orchestrator/src/workers/phases/list-pull-request-comments-phase-handler.ts`
- Modify: `registry.ts`, `catalog.ts`, `cli-worker.ts`

- [ ] **Step 1: Rename meta and rewrite**

```bash
mv packages/phases/src/git/fetch-pr-comments.meta.ts packages/phases/src/git/list-pull-request-comments.meta.ts
```

```ts
import type { InputFields } from "../shared-meta.ts";

export const LIST_PULL_REQUEST_COMMENTS_PHASE_TYPE = "list-pull-request-comments";
export const LIST_PULL_REQUEST_COMMENTS_LABEL = "List Pull Request Comments";
export const LIST_PULL_REQUEST_COMMENTS_CATEGORY = "Code Host";
export const LIST_PULL_REQUEST_COMMENTS_DESCRIPTION =
  "Read all comments from a pull/merge request.";

export const listPullRequestCommentsInputFields: InputFields = {
  owner:    { type: "string", label: "Owner / org", required: true },
  repo:     { type: "string", label: "Repository", required: true },
  prNumber: { type: "number", label: "PR number" },
};
```

- [ ] **Step 2: Rename tsx, swap names**

```bash
mv packages/phases/src/git/fetch-pr-comments.tsx packages/phases/src/git/list-pull-request-comments.tsx
```

`FetchPrCommentsConfig` → `ListPullRequestCommentsConfig`, `fetchPrCommentsPhase` → `listPullRequestCommentsPhase`, `FETCH_PR_COMMENTS_*` → `LIST_PULL_REQUEST_COMMENTS_*`, `fetchPrCommentsInputFields` → `listPullRequestCommentsInputFields`, `description: LIST_PULL_REQUEST_COMMENTS_DESCRIPTION`.

- [ ] **Step 3: Rename handler**

```bash
mv packages/orchestrator/src/workers/phases/fetch-pr-comments-phase-handler.ts \
   packages/orchestrator/src/workers/phases/list-pull-request-comments-phase-handler.ts
```

`FetchPrCommentsPhaseHandler` → `ListPullRequestCommentsPhaseHandler`; `readonly phaseType = "fetch-pr-comments";` → `"list-pull-request-comments"`.

- [ ] **Step 4: registry.ts** — `fetchPrCommentsPhase` → `listPullRequestCommentsPhase`.

- [ ] **Step 5: catalog.ts imports** — switch to `LIST_PULL_REQUEST_COMMENTS_*`.

- [ ] **Step 6: cli-worker.ts** — `FetchPrCommentsPhaseHandler` → `ListPullRequestCommentsPhaseHandler`.

---

## Issue Tracker (5 phases)

### Task T1 — `get-ticket` (ID unchanged; category + description only)

**Files:**
- Modify: `packages/phases/src/tickets/get-ticket.meta.ts`
- Modify: `packages/phases/src/tickets/get-ticket.tsx`
- Modify: `packages/phases/src/catalog.ts`

- [ ] **Step 1: meta** — change `GET_TICKET_CATEGORY = "Tickets"` to `"Issue Tracker"`. Append:

```ts
export const GET_TICKET_DESCRIPTION = "Fetch a ticket from the configured tracker.";
```

- [ ] **Step 2: tsx** — add `GET_TICKET_DESCRIPTION` to imports; replace inline description literal with `description: GET_TICKET_DESCRIPTION,`.

- [ ] **Step 3: catalog.ts imports** — add `GET_TICKET_DESCRIPTION` to the existing get-ticket import block.

### Task T2 — `create-ticket` (ID unchanged; category + description only)

Same shape as T1.

- [ ] **Step 1: meta** — `CREATE_TICKET_CATEGORY` → `"Issue Tracker"`. Append:

```ts
export const CREATE_TICKET_DESCRIPTION = "Create a ticket on the configured tracker.";
```

- [ ] **Step 2: tsx** — `description: CREATE_TICKET_DESCRIPTION`.

- [ ] **Step 3: catalog.ts imports** — add `CREATE_TICKET_DESCRIPTION`.

### Task T3 — `update-ticket` → `update-ticket-fields`

**Files:**
- Rename: `packages/phases/src/tickets/update-ticket.meta.ts` → `packages/phases/src/tickets/update-ticket-fields.meta.ts`
- Rename: `packages/phases/src/tickets/update-ticket.tsx` → `packages/phases/src/tickets/update-ticket-fields.tsx`
- Rename: `packages/orchestrator/src/workers/phases/update-ticket-phase-handler.ts` → `packages/orchestrator/src/workers/phases/update-ticket-fields-phase-handler.ts`
- Modify: `registry.ts`, `catalog.ts`, `cli-worker.ts`

- [ ] **Step 1: Rename meta and rewrite**

```bash
mv packages/phases/src/tickets/update-ticket.meta.ts packages/phases/src/tickets/update-ticket-fields.meta.ts
```

```ts
import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const UPDATE_TICKET_FIELDS_PHASE_TYPE = "update-ticket-fields";
export const UPDATE_TICKET_FIELDS_LABEL = "Update Ticket Fields";
export const UPDATE_TICKET_FIELDS_CATEGORY = "Issue Tracker";
export const UPDATE_TICKET_FIELDS_DESCRIPTION =
  "Update arbitrary fields on an existing ticket.";

export const updateTicketFieldsOutputSchema: OutputSchema = {
  updated: { type: "boolean" },
};

export const updateTicketFieldsInputFields: InputFields = {
  ticketKey: { type: "string", label: "Ticket key", required: true },
  fields:    { type: "json",   label: "Fields" },
};
```

- [ ] **Step 2: Rename tsx, swap names**

```bash
mv packages/phases/src/tickets/update-ticket.tsx packages/phases/src/tickets/update-ticket-fields.tsx
```

`UpdateTicketConfig` → `UpdateTicketFieldsConfig`, `updateTicketPhase` → `updateTicketFieldsPhase`, `UPDATE_TICKET_*` → `UPDATE_TICKET_FIELDS_*`, `updateTicketOutputSchema` → `updateTicketFieldsOutputSchema`, `description: UPDATE_TICKET_FIELDS_DESCRIPTION`.

- [ ] **Step 3: Rename handler**

```bash
mv packages/orchestrator/src/workers/phases/update-ticket-phase-handler.ts \
   packages/orchestrator/src/workers/phases/update-ticket-fields-phase-handler.ts
```

`UpdateTicketPhaseHandler` → `UpdateTicketFieldsPhaseHandler`; `readonly phaseType = "update-ticket";` → `"update-ticket-fields"`.

- [ ] **Step 4: registry.ts** — `updateTicketPhase` → `updateTicketFieldsPhase`.

- [ ] **Step 5: catalog.ts imports** — switch to `UPDATE_TICKET_FIELDS_*`.

- [ ] **Step 6: cli-worker.ts** — `UpdateTicketPhaseHandler` → `UpdateTicketFieldsPhaseHandler`.

### Task T4 — `update-status` → `transition-ticket`

**Files:**
- Rename: `packages/phases/src/tickets/update-status.meta.ts` → `packages/phases/src/tickets/transition-ticket.meta.ts`
- Rename: `packages/phases/src/tickets/update-status.tsx` → `packages/phases/src/tickets/transition-ticket.tsx`
- Rename: `packages/orchestrator/src/workers/phases/update-status-phase-handler.ts` → `packages/orchestrator/src/workers/phases/transition-ticket-phase-handler.ts`
- Modify: `registry.ts`, `catalog.ts`, `cli-worker.ts`

- [ ] **Step 1: Rename meta and rewrite**

```bash
mv packages/phases/src/tickets/update-status.meta.ts packages/phases/src/tickets/transition-ticket.meta.ts
```

```ts
import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const TRANSITION_TICKET_PHASE_TYPE = "transition-ticket";
export const TRANSITION_TICKET_LABEL = "Transition Ticket";
export const TRANSITION_TICKET_CATEGORY = "Issue Tracker";
export const TRANSITION_TICKET_DESCRIPTION =
  "Move a ticket to a new workflow status.";

export const transitionTicketOutputSchema: OutputSchema = {
  status: { type: "string" },
};

export const transitionTicketInputFields: InputFields = {
  ticketKey: { type: "string", label: "Ticket key", required: true },
  status:    { type: "string", label: "Status", required: true },
};
```

- [ ] **Step 2: Rename tsx, swap names**

```bash
mv packages/phases/src/tickets/update-status.tsx packages/phases/src/tickets/transition-ticket.tsx
```

`UpdateStatusConfig` → `TransitionTicketConfig`, `updateStatusPhase` → `transitionTicketPhase`, `UPDATE_STATUS_*` → `TRANSITION_TICKET_*`, `updateStatusOutputSchema` → `transitionTicketOutputSchema`, `description: TRANSITION_TICKET_DESCRIPTION`.

- [ ] **Step 3: Rename handler**

```bash
mv packages/orchestrator/src/workers/phases/update-status-phase-handler.ts \
   packages/orchestrator/src/workers/phases/transition-ticket-phase-handler.ts
```

`UpdateStatusPhaseHandler` → `TransitionTicketPhaseHandler`; `readonly phaseType = "update-status";` → `"transition-ticket"`.

> The handler still calls `ticket.updateStatus(...)` — that's the **provider method name** and stays.

- [ ] **Step 4: registry.ts** — `updateStatusPhase` → `transitionTicketPhase`.

- [ ] **Step 5: catalog.ts imports** — switch to `TRANSITION_TICKET_*`.

- [ ] **Step 6: cli-worker.ts** — `UpdateStatusPhaseHandler` → `TransitionTicketPhaseHandler`.

### Task T5 — `add-ticket-comment` → `comment-on-ticket`

**Files:**
- Rename: `packages/phases/src/tickets/add-ticket-comment.meta.ts` → `packages/phases/src/tickets/comment-on-ticket.meta.ts`
- Rename: `packages/phases/src/tickets/add-ticket-comment.tsx` → `packages/phases/src/tickets/comment-on-ticket.tsx`
- Rename: `packages/orchestrator/src/workers/phases/add-ticket-comment-phase-handler.ts` → `packages/orchestrator/src/workers/phases/comment-on-ticket-phase-handler.ts`
- Modify: `registry.ts`, `catalog.ts`, `cli-worker.ts`

- [ ] **Step 1: Rename meta and rewrite**

```bash
mv packages/phases/src/tickets/add-ticket-comment.meta.ts packages/phases/src/tickets/comment-on-ticket.meta.ts
```

```ts
import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const COMMENT_ON_TICKET_PHASE_TYPE = "comment-on-ticket";
export const COMMENT_ON_TICKET_LABEL = "Comment on Ticket";
export const COMMENT_ON_TICKET_CATEGORY = "Issue Tracker";
export const COMMENT_ON_TICKET_DESCRIPTION =
  "Post a comment on a ticket, optionally rendered from a template.";

export const commentOnTicketOutputSchema: OutputSchema = {
  commentId: { type: "string" },
};

export const commentOnTicketInputFields: InputFields = {
  ticketKey: { type: "string", label: "Ticket key", required: true },
  template:  { type: "string", label: "Template" },
  body:      { type: "string", label: "Body" },
};
```

- [ ] **Step 2: Rename tsx, swap names**

```bash
mv packages/phases/src/tickets/add-ticket-comment.tsx packages/phases/src/tickets/comment-on-ticket.tsx
```

`AddTicketCommentConfig` → `CommentOnTicketConfig`, `addTicketCommentPhase` → `commentOnTicketPhase`, `ADD_TICKET_COMMENT_*` → `COMMENT_ON_TICKET_*`, `addTicketCommentOutputSchema` → `commentOnTicketOutputSchema`, `description: COMMENT_ON_TICKET_DESCRIPTION`.

- [ ] **Step 3: Rename handler**

```bash
mv packages/orchestrator/src/workers/phases/add-ticket-comment-phase-handler.ts \
   packages/orchestrator/src/workers/phases/comment-on-ticket-phase-handler.ts
```

`AddTicketCommentPhaseHandler` → `CommentOnTicketPhaseHandler`; `readonly phaseType = "add-ticket-comment";` → `"comment-on-ticket"`.

- [ ] **Step 4: registry.ts** — `addTicketCommentPhase` → `commentOnTicketPhase`.

- [ ] **Step 5: catalog.ts imports** — switch to `COMMENT_ON_TICKET_*`.

- [ ] **Step 6: cli-worker.ts** — `AddTicketCommentPhaseHandler` → `CommentOnTicketPhaseHandler`.

---

## Messaging (1 phase)

### Task M1 — `notify` → `send-message`

**Files:**
- Rename: `packages/phases/src/notifications/notify.meta.ts` → `packages/phases/src/notifications/send-message.meta.ts`
- Rename: `packages/phases/src/notifications/notify.tsx` → `packages/phases/src/notifications/send-message.tsx`
- Rename: `packages/orchestrator/src/workers/phases/notify-phase-handler.ts` → `packages/orchestrator/src/workers/phases/send-message-phase-handler.ts`
- Modify: `registry.ts`, `catalog.ts`, `cli-worker.ts`

- [ ] **Step 1: Rename meta and rewrite**

```bash
mv packages/phases/src/notifications/notify.meta.ts packages/phases/src/notifications/send-message.meta.ts
```

```ts
import type { OutputSchema } from "@journeyman/core";
import type { InputFields } from "../shared-meta.ts";

export const SEND_MESSAGE_PHASE_TYPE = "send-message";
export const SEND_MESSAGE_LABEL = "Send Message";
export const SEND_MESSAGE_CATEGORY = "Messaging";
export const SEND_MESSAGE_DESCRIPTION =
  "Send a message via the configured messaging provider (Slack, etc.).";

export const sendMessageOutputSchema: OutputSchema = {
  delivered: { type: "boolean" },
  channelId: { type: "string" },
};

export const sendMessageInputFields: InputFields = {
  channel: { type: "string", label: "Channel / target", required: true },
  message: { type: "string", label: "Message", required: true },
  blocks:  { type: "json",   label: "Rich blocks (optional)" },
};
```

- [ ] **Step 2: Rename tsx, swap names**

```bash
mv packages/phases/src/notifications/notify.tsx packages/phases/src/notifications/send-message.tsx
```

`NotifyConfig` → `SendMessageConfig`, `notifyPhase` → `sendMessagePhase`, `NOTIFY_*` → `SEND_MESSAGE_*`, `notifyOutputSchema` → `sendMessageOutputSchema`, `description: SEND_MESSAGE_DESCRIPTION`.

- [ ] **Step 3: Rename handler**

```bash
mv packages/orchestrator/src/workers/phases/notify-phase-handler.ts \
   packages/orchestrator/src/workers/phases/send-message-phase-handler.ts
```

`NotifyPhaseHandler` → `SendMessagePhaseHandler`; `readonly phaseType = "notify";` → `"send-message"`.

> The handler still calls `notification.notify(...)` — provider method name unchanged.

- [ ] **Step 4: registry.ts** — `notifyPhase` → `sendMessagePhase`.

- [ ] **Step 5: catalog.ts imports** — switch to `SEND_MESSAGE_*` from `./notifications/send-message.meta.ts`.

- [ ] **Step 6: cli-worker.ts** — `NotifyPhaseHandler` → `SendMessagePhaseHandler`.

---

## Task cat-1 — Populate `description` in every catalog row

By this point, every `*.meta.ts` exports a `*_DESCRIPTION` constant and `catalog.ts` already imports them. Now wire them into the rows.

**Files:**
- Modify: `packages/phases/src/catalog.ts`

- [ ] **Step 1: Update each row in `phaseCatalog` to include `description`**

Replace the entire `phaseCatalog` array with the version below.

```ts
export const phaseCatalog: PhaseCatalogEntry[] = [
  // Coding Agent
  { phaseType: ANALYZE_REPO_PHASE_TYPE,        label: ANALYZE_REPO_LABEL,        category: ANALYZE_REPO_CATEGORY,        description: ANALYZE_REPO_DESCRIPTION,        inputFields: analyzeRepoInputFields,        outputSchema: analyzeRepoOutputSchema },
  { phaseType: PLAN_IMPLEMENTATION_PHASE_TYPE, label: PLAN_IMPLEMENTATION_LABEL, category: PLAN_IMPLEMENTATION_CATEGORY, description: PLAN_IMPLEMENTATION_DESCRIPTION, inputFields: planImplementationInputFields, outputSchema: planImplementationOutputSchema },
  { phaseType: IMPLEMENT_CHANGES_PHASE_TYPE,   label: IMPLEMENT_CHANGES_LABEL,   category: IMPLEMENT_CHANGES_CATEGORY,   description: IMPLEMENT_CHANGES_DESCRIPTION,   inputFields: implementChangesInputFields,   outputSchema: implementChangesOutputSchema },

  // Workspace
  { phaseType: LIST_WORKSPACE_FILES_PHASE_TYPE, label: LIST_WORKSPACE_FILES_LABEL, category: LIST_WORKSPACE_FILES_CATEGORY, description: LIST_WORKSPACE_FILES_DESCRIPTION, inputFields: listWorkspaceFilesInputFields, outputSchema: listWorkspaceFilesOutputSchema },
  { phaseType: START_FEATURE_BRANCH_PHASE_TYPE, label: START_FEATURE_BRANCH_LABEL, category: START_FEATURE_BRANCH_CATEGORY, description: START_FEATURE_BRANCH_DESCRIPTION, inputFields: startFeatureBranchInputFields, outputSchema: startFeatureBranchOutputSchema },
  { phaseType: COMMIT_AND_PUSH_PHASE_TYPE,      label: COMMIT_AND_PUSH_LABEL,      category: COMMIT_AND_PUSH_CATEGORY,      description: COMMIT_AND_PUSH_DESCRIPTION,      inputFields: commitAndPushInputFields,      outputSchema: commitAndPushOutputSchema },
  { phaseType: CLEANUP_WORKSPACE_PHASE_TYPE,    label: CLEANUP_WORKSPACE_LABEL,    category: CLEANUP_WORKSPACE_CATEGORY,    description: CLEANUP_WORKSPACE_DESCRIPTION,    inputFields: cleanupWorkspaceInputFields,    outputSchema: cleanupWorkspaceOutputSchema },
  { phaseType: CREATE_WORKSPACE_PHASE_TYPE,     label: CREATE_WORKSPACE_LABEL,     category: CREATE_WORKSPACE_CATEGORY,     description: CREATE_WORKSPACE_DESCRIPTION,     inputFields: createWorkspaceInputFields,     outputSchema: createWorkspaceOutputSchema },

  // Code Host
  { phaseType: GET_REPOSITORY_PHASE_TYPE,             label: GET_REPOSITORY_LABEL,             category: GET_REPOSITORY_CATEGORY,             description: GET_REPOSITORY_DESCRIPTION,             inputFields: getRepositoryInputFields,             outputSchema: null },
  { phaseType: CLONE_REPOS_PHASE_TYPE,                label: CLONE_REPOS_LABEL,                category: CLONE_REPOS_CATEGORY,                description: CLONE_REPOS_DESCRIPTION,                inputFields: cloneReposInputFields,                outputSchema: null },
  { phaseType: OPEN_PULL_REQUEST_PHASE_TYPE,          label: OPEN_PULL_REQUEST_LABEL,          category: OPEN_PULL_REQUEST_CATEGORY,          description: OPEN_PULL_REQUEST_DESCRIPTION,          inputFields: openPullRequestInputFields,          outputSchema: null },
  { phaseType: LIST_PULL_REQUESTS_PHASE_TYPE,         label: LIST_PULL_REQUESTS_LABEL,         category: LIST_PULL_REQUESTS_CATEGORY,         description: LIST_PULL_REQUESTS_DESCRIPTION,         inputFields: listPullRequestsInputFields,         outputSchema: null },
  { phaseType: COMMENT_ON_PULL_REQUEST_PHASE_TYPE,    label: COMMENT_ON_PULL_REQUEST_LABEL,    category: COMMENT_ON_PULL_REQUEST_CATEGORY,    description: COMMENT_ON_PULL_REQUEST_DESCRIPTION,    inputFields: commentOnPullRequestInputFields,    outputSchema: null },
  { phaseType: LIST_PULL_REQUEST_COMMENTS_PHASE_TYPE, label: LIST_PULL_REQUEST_COMMENTS_LABEL, category: LIST_PULL_REQUEST_COMMENTS_CATEGORY, description: LIST_PULL_REQUEST_COMMENTS_DESCRIPTION, inputFields: listPullRequestCommentsInputFields, outputSchema: null },

  // Issue Tracker
  { phaseType: GET_TICKET_PHASE_TYPE,           label: GET_TICKET_LABEL,           category: GET_TICKET_CATEGORY,           description: GET_TICKET_DESCRIPTION,           inputFields: getTicketInputFields,           outputSchema: getTicketOutputSchema },
  { phaseType: CREATE_TICKET_PHASE_TYPE,        label: CREATE_TICKET_LABEL,        category: CREATE_TICKET_CATEGORY,        description: CREATE_TICKET_DESCRIPTION,        inputFields: createTicketInputFields,        outputSchema: createTicketOutputSchema },
  { phaseType: UPDATE_TICKET_FIELDS_PHASE_TYPE, label: UPDATE_TICKET_FIELDS_LABEL, category: UPDATE_TICKET_FIELDS_CATEGORY, description: UPDATE_TICKET_FIELDS_DESCRIPTION, inputFields: updateTicketFieldsInputFields, outputSchema: updateTicketFieldsOutputSchema },
  { phaseType: TRANSITION_TICKET_PHASE_TYPE,    label: TRANSITION_TICKET_LABEL,    category: TRANSITION_TICKET_CATEGORY,    description: TRANSITION_TICKET_DESCRIPTION,    inputFields: transitionTicketInputFields,    outputSchema: transitionTicketOutputSchema },
  { phaseType: COMMENT_ON_TICKET_PHASE_TYPE,    label: COMMENT_ON_TICKET_LABEL,    category: COMMENT_ON_TICKET_CATEGORY,    description: COMMENT_ON_TICKET_DESCRIPTION,    inputFields: commentOnTicketInputFields,    outputSchema: commentOnTicketOutputSchema },

  // Messaging
  { phaseType: SEND_MESSAGE_PHASE_TYPE, label: SEND_MESSAGE_LABEL, category: SEND_MESSAGE_CATEGORY, description: SEND_MESSAGE_DESCRIPTION, inputFields: sendMessageInputFields, outputSchema: sendMessageOutputSchema },
];
```

- [ ] **Step 2: Verify the section comment block at top of `catalog.ts` matches new categories**

The comment block above `phaseCatalog` should reflect: Coding Agent / Workspace / Code Host / Issue Tracker / Messaging — purely cosmetic, but keep it current.

---

## Task stragglers — Final sweep for hardcoded old IDs

The earlier file-by-file tasks updated the obvious sites. This task is a safety net for anything missed.

**Files:**
- Modify: any test or fixture file that references old phaseType strings
- Modify: any web/UI file referencing old phaseType strings

- [ ] **Step 1: Search for old `phaseType` strings as literals**

Run:

```bash
grep -rn '"analyze"\|"plan"\|"implement"\|"scan-repos"\|"checkout-repo"\|"commit-push"\|"cleanup-repos"\|"get-repo"\|"create-pr"\|"list-prs"\|"add-pr-comment"\|"fetch-pr-comments"\|"update-ticket"\|"update-status"\|"add-ticket-comment"\|"notify"' \
  packages/ --include="*.ts" --include="*.tsx" \
  | grep -v node_modules \
  | grep -v "phases/src" \
  | grep -v "orchestrator/src/workers/phases" \
  | grep -v "coding-cli/src" \
  | grep -v "ticket-provider/src" \
  | grep -v "git-provider/src" \
  | grep -v "notification-provider/src"
```

Expected: should return only doc-comment hits (e.g. JSDoc examples). Anything that is a real `phaseType` literal — i.e. used as a key in a map, condition, or test fixture — must be updated to the new ID.

> Skipped paths above are deliberate: `coding-cli/src` uses camelCase **method names** like `"analyze"` (CodingCLIPhase), not phase IDs; `ticket-provider/src` and friends contain provider implementations whose method names (`updateStatus`, `notify`, `addPrComment` etc.) are unrelated to phase IDs. Only update strings that are used as **phase type identifiers**.

- [ ] **Step 2: For each real hit, replace with the new ID using the table at the top of this plan.**

- [ ] **Step 3: Update `packages/core/src/types/flow.types.ts:40` doc comment**

Change the example list `"analyze", "clone-repos", …` to `"analyze-repo", "clone-repos", …` (cosmetic, but keeps docs honest).

---

## Task final-1 — Typecheck

**Files:** none

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: clean — no errors across all workspaces.

- [ ] **Step 2: If errors appear, resolve them in place**

The most likely failure modes:

| Error | Cause | Fix |
|---|---|---|
| `Cannot find module './ai/analyze.meta.ts'` | Catalog or registry still imports old file path | Update import to new file path |
| `Cannot find name 'analyzePhase'` | registry.ts still references old export | Rename to `analyzeRepoPhase` |
| `Cannot find name 'AnalyzePhaseHandler'` | cli-worker.ts still references old class | Rename to `AnalyzeRepoPhaseHandler` |
| `Property 'description' is missing in type` on a catalog row | A row in `phaseCatalog` was not updated in `cat-1` | Add the `description: *_DESCRIPTION` field to that row |
| `Cannot find name 'SCAN_REPOS_PHASE_TYPE'` | A consumer still imports an old constant name | Update import to new name |

Re-run `npm run typecheck` until clean.

> Per user constraint: do **not** commit. Stop here once typecheck is green.

---

## Self-Review Notes

- **Spec coverage:** Every phase from the spec has a task (A1–A3, W1–W5, H1–H6, T1–T5, M1). `description` field on `PhaseCatalogEntry` covered by Task 0; population covered by `cat-1`. Frontend `description` import covered per-phase. Orchestrator handler renames covered per-phase.
- **Out-of-scope guard:** Plan does not change executor methods, output shapes, icons, or colors — only renames + description plumbing.
- **Type consistency:** All new constant prefixes derived mechanically from the new base name (e.g. `start-feature-branch` → `START_FEATURE_BRANCH_*`). All JS exports follow `<camelCaseBase>Phase` and `<PascalCaseBase>PhaseHandler`. Catalog row in `cat-1` cross-references those exact constants.
- **Constraint adherence:** Zero commits. Zero tests written. Single typecheck at `final-1`.
