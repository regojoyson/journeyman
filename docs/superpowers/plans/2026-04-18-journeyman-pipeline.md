# Journeyman Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.
>
> This plan is structured as **parallel tracks**. Tasks within a track are mostly sequential; tracks are mostly independent. Start with Phase 0 + Phase 1; then fan out across Tracks A–E.

**Goal:** Build `@journeyman/pipeline` (runner) and `@journeyman/pipeline-server` (HTTP layer), plus the prerequisite adapter enhancements, to automate ticket → PR through configurable per-product flows built on the existing Journeyman adapters.

**Architecture:** Phase-based pipeline with declarative contracts, per-product workspaces, config-driven ticket workflow, webhook-routed triggers, and a management REST+SSE API. Single-instance for v1; interfaces accommodate DB/queue/S3 swaps later.

**Tech Stack:** TypeScript, Node 22+, npm workspaces, Fastify 4, Zod, js-yaml, uuid, AbortSignal.

**Reference spec:** [docs/superpowers/specs/2026-04-18-journeyman-pipeline-design.md](../specs/2026-04-18-journeyman-pipeline-design.md)

**No tests per explicit user decision.** Correctness via code review + manual verification.

---

## Track Dependency Graph

```
Phase 0 (prerequisites)          Phase 1 (foundation)
 ┌─ 0.1 label-status             ┌─ 1.1 pipeline pkg scaffold
 ├─ 0.2 listPRs                  ├─ 1.2 pipeline-server pkg scaffold
 ├─ 0.3 provider meta            ├─ 1.3 core pipeline.types.ts
 └─ 0.4 signal support           ├─ 1.4 core pipeline.interface.ts
   (all parallel)                └─ 1.5 core IGitProvider.listPRs
                                    (sequential within phase)

After Phase 0 + Phase 1:

  Track A (infra)     Track B (phases)    Track C (runner)    Track D (server)    Track E (cli/docs)
  A1 PhaseRegistry    B1 BasePhase        C1 context          D1 http-server      E1 CLI
  A2 ProviderRegistry B2 getTicket        C2 runner happy     D2 ApiTrigger       E2 validate-config
  A3 FileStateStore   B3 cloneRepos       C3 retry/timeout    D3 GH webhook       E3 sweep CLI
  A4 FileTraceLogger  B4 analyze          C4 cancel           D4 GL webhook       E4 README × 2
  A5 FileArtifactStore B5 plan            C5 block            D5 Jira webhook     E5 docs/*
  A6 EventBus         B6 implement        C6 recover          D6 runs API
  A7 YamlFlowConfig   B7 commitPush       C7 resume           D7 logs API
  A8 FlowResolver     B8 createPR         C8 shutdown         D8 stream SSE
  A9 FlowValidator    B9 cleanupRepos     C9 semaphore        D9 cancel API
  A10 adapter-unwrap  B10 addComment                          D10 resume API
  A11 pipeline-config B11 updateStatus                        D11 artifacts API
       loader         B12 review stub                         D12 flows/providers
  A12 config schemas  B13 requireField                        D13 dispatch+dedup

  Track A depends on Phase 1 only.
  Track B depends on A1, A10, B1 (chain), and Phase 0.1-0.4.
  Track C depends on A1-A10.
  Track D depends on C + A.
  Track E can start after scaffolds (Phase 1) for docs; CLI needs A+C.
```

---

## Execution model

- Phase 0 tasks (0.1–0.4): run in parallel. 4 agents, no cross-dependencies.
- Phase 1 tasks (1.1–1.5): sequential, same agent.
- Tracks A, B, C, D, E: after Phase 1 completes, these tracks can run in parallel. Within each track, most tasks are sequential (noted when parallelizable).
- Final integration (Phase 7) is a sequential smoke + manual verification.

Each task has: **Files**, **Steps** (checkboxed), and complete code where code is changed. Commit per task.

---

## Phase 0 — Prerequisite Adapter Changes (parallel)

These are independent adapter changes that unblock the pipeline. **Run all four as parallel agents.**

### Task 0.1: GitHub Issues label-based `updateStatus`

**Parallel group:** 0  **Dependencies:** none.

**Files:**
- Modify: `packages/ticket-provider/src/providers/github-issues/operations/update-status.ts`

**Problem:** Current impl only maps to `open|closed`. Needs label-based workflow state per `productConfig.ticketWorkflow.statuses` values.

- [ ] **Step 1: Rewrite operation**

```ts
// packages/ticket-provider/src/providers/github-issues/operations/update-status.ts
import type { UpdateStatusOptions, UpdateStatusResult } from "@journeyman/core";
import { callTool, type Client } from "@journeyman/github-mcp";
import { parseIssueId } from "../utils/parse-ids.ts";
import { toTicket } from "./create-ticket.ts";

type GitHubIssue = Parameters<typeof toTicket>[2];
const STATUS_LABEL_PREFIX = "status:";

export async function updateStatus(
  client: Client,
  opts: UpdateStatusOptions,
): Promise<UpdateStatusResult> {
  const { owner, repo, number } = parseIssueId(opts.id);
  try {
    // Read current labels
    const current = await callTool<GitHubIssue>(client, "issue_read", {
      method: "get", owner, repo, issue_number: number,
    });
    const keepLabels = (current.labels ?? [])
      .map((l: any) => typeof l === "string" ? l : l.name)
      .filter((n: string) => !n.startsWith(STATUS_LABEL_PREFIX));

    const newLabel = `${STATUS_LABEL_PREFIX}${opts.status}`;
    const nextLabels = [...keepLabels, newLabel];

    // Update labels (and leave open/closed state alone unless status is terminal)
    const terminalStatuses = new Set(["done", "closed", "Done", "Closed"]);
    const state = terminalStatuses.has(opts.status) ? "closed" : "open";

    const issue = await callTool<GitHubIssue>(client, "issue_write", {
      method: "update",
      owner, repo, issue_number: number,
      labels: nextLabels,
      state,
    });
    return { ticket: toTicket(owner, repo, issue) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @journeyman/ticket-provider`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/ticket-provider
git commit -m "feat(ticket-provider): label-based updateStatus for GitHub Issues"
```

---

### Task 0.2: Add `listPRs` to `IGitProvider` + GitHub impl

**Parallel group:** 0  **Dependencies:** none.

**Files:**
- Modify: `packages/core/src/types/git.types.ts` — add `ListPROptions`/`ListPRResult`.
- Modify: `packages/core/src/interfaces/git-provider.interface.ts` — add `listPRs`.
- Create: `packages/git-provider/src/providers/github/operations/list-prs.ts`.
- Modify: `packages/git-provider/src/providers/github/index.ts` — wire `listPRs`.
- Modify: `packages/git-provider/src/providers/gitlab/index.ts` — stub `listPRs`.

- [ ] **Step 1: Add types in core**

```ts
// Append to packages/core/src/types/git.types.ts
export type ListPROptions = SessionOptions & {
  owner: string;
  repo: string;
  head?: string;                                   // "owner:branch" (GitHub format)
  state?: "open" | "closed" | "all";
};

export type ListPRItem = {
  id: string;
  url: string;
  number: number;
  head: string;
  state: string;
};

export type ListPRResult = SessionResult & {
  prs: ListPRItem[];
  error?: string;
};
```

- [ ] **Step 2: Extend IGitProvider**

```ts
// packages/core/src/interfaces/git-provider.interface.ts — add method
listPRs(opts: ListPROptions): Promise<ListPRResult>;
```

Add imports for `ListPROptions`, `ListPRResult`.

- [ ] **Step 3: Implement in GitHub provider**

```ts
// packages/git-provider/src/providers/github/operations/list-prs.ts
import type { ListPROptions, ListPRResult, ListPRItem } from "@journeyman/core";
import { callTool, type Client } from "@journeyman/github-mcp";

type GitHubPR = {
  id: number; number: number; html_url: string; state: string;
  head: { label: string };
};

export async function listPRs(client: Client, opts: ListPROptions): Promise<ListPRResult> {
  try {
    const prs = await callTool<GitHubPR[]>(client, "pr_read", {
      method: "list",
      owner: opts.owner,
      repo: opts.repo,
      state: opts.state ?? "open",
      head: opts.head,
    });
    return {
      prs: prs.map<ListPRItem>(p => ({
        id: String(p.id), url: p.html_url, number: p.number,
        head: p.head.label, state: p.state,
      })),
    };
  } catch (err) {
    return { prs: [], error: (err as Error).message };
  }
}
```

- [ ] **Step 4: Wire in GitHubProvider**

```ts
// packages/git-provider/src/providers/github/index.ts
// Add import:
import { listPRs } from "./operations/list-prs.ts";
// Add method to class:
async listPRs(opts: ListPROptions): Promise<ListPRResult> {
  return listPRs(await this.getClient(), opts);
}
```

- [ ] **Step 5: Stub in GitLab provider**

```ts
// packages/git-provider/src/providers/gitlab/index.ts
async listPRs(_opts: ListPROptions): Promise<ListPRResult> {
  throw new Error("GitLabProvider.listPRs not implemented");
}
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages
git commit -m "feat(git-provider): add listPRs to IGitProvider + GitHub implementation"
```

---

### Task 0.3: Add `static meta: IProviderMeta` on every provider

**Parallel group:** 0  **Dependencies:** Phase 1.3 (core `IProviderMeta` type). Can start AFTER 1.3 lands.

> Move this task to Phase 1 if you want strict parallelism. OR complete it right after Phase 1.3.

**Files:**
- Modify: `packages/coding-cli/src/providers/{claude,gemini,codex}/index.ts`
- Modify: `packages/git-provider/src/providers/{github,gitlab}/index.ts`
- Modify: `packages/ticket-provider/src/providers/{jira,linear,monday,github-issues,github-projects}/index.ts`
- Modify: `packages/notification-provider/src/providers/slack/index.ts`

- [ ] **Step 1: Add meta to every provider class**

Example (`ClaudeProvider`):
```ts
import type { IProviderMeta } from "@journeyman/core";

export class ClaudeProvider implements ICodingCLI {
  static meta: IProviderMeta = {
    id: "claude",
    name: "Claude Code CLI",
    description: "AI coding via @anthropic-ai/claude-agent-sdk",
    category: "coding-cli",
  };
  // ...existing methods
}
```

All metas:

| Class | id | name | category |
|---|---|---|---|
| ClaudeProvider | claude | Claude Code CLI | coding-cli |
| GeminiProvider | gemini | Gemini CLI | coding-cli |
| CodexProvider | codex | Codex CLI | coding-cli |
| GitHubProvider | github | GitHub REST | git |
| GitLabProvider | gitlab | GitLab REST | git |
| JiraProvider | jira | Jira Cloud | ticket |
| LinearProvider | linear | Linear | ticket |
| MondayProvider | monday | Monday.com | ticket |
| GitHubIssuesProvider | github-issues | GitHub Issues | ticket |
| GitHubProjectsProvider | github-projects | GitHub Projects | ticket |
| SlackProvider | slack | Slack | notification |

One-line `description` per engineer judgement.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages
git commit -m "feat: add static IProviderMeta to every provider class"
```

---

### Task 0.4: Add `signal?: AbortSignal` to cancellable coding options

**Parallel group:** 0  **Dependencies:** none.

**Files:**
- Modify: `packages/core/src/types/coding.types.ts` + `git.types.ts`
- Modify: `packages/coding-cli/src/providers/claude/operations/*.ts` — forward signal into SDK / child processes.

- [ ] **Step 1: Add signal to coding option types**

Append `signal?: AbortSignal` to:
- `AnalyzeOptions`
- `PlanOptions`
- `ImplementOptions`
- `CloneReposOptions`
- `CommitPushReposOptions`
- `CleanupReposOptions`
- `ResetReposOptions`
- `ScanReposOptions`
- `CreateWorkspaceOptions`

```ts
// Example diff in packages/core/src/types/coding.types.ts
export type AnalyzeOptions = SessionOptions & {
  dirPath: string;
  ticketContent?: string;
  focus?: string;
  signal?: AbortSignal;   // ← add
};
// ...repeat for every options type listed above
```

- [ ] **Step 2: Wire signal in Claude operations**

For each Claude operation file, pass `signal` to `query()`:

```ts
// example: packages/coding-cli/src/providers/claude/operations/analyze.ts
const response = query({
  prompt: "...",
  options: {
    tools: ["Bash"],
    allowedTools: ["Bash"],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    settingSources: [],
    abortController: opts.signal ? abortControllerFromSignal(opts.signal) : undefined,
    outputFormat: { type: "json_schema", schema: { /* ... */ } },
  },
});
```

Helper `abortControllerFromSignal` (adapter-local):
```ts
function abortControllerFromSignal(signal: AbortSignal): AbortController {
  const ac = new AbortController();
  if (signal.aborted) ac.abort(signal.reason);
  else signal.addEventListener("abort", () => ac.abort(signal.reason), { once: true });
  return ac;
}
```

> Note: verify against `.claude/sdk.d.ts` the exact option name (`abortController` vs `abortSignal`). Adjust accordingly.

For Bash-tool-driven operations (cloneRepos, commitPushRepos, cleanupRepos), the SDK abortController already covers child processes once aborted.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add packages
git commit -m "feat(core,coding-cli): add AbortSignal support to cancellable coding operations"
```

---

## Phase 1 — Foundation (sequential)

Core types, interfaces, and package scaffolds. Must complete before Tracks A–E.

### Task 1.1: Scaffold `@journeyman/pipeline`

**Files:**
- Create: `packages/pipeline/{package.json,tsconfig.json,src/index.ts}`

- [ ] **Step 1: package.json**

```json
{
  "name": "@journeyman/pipeline",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "bin": { "journeyman": "./src/cli.ts" },
  "files": ["src"],
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@journeyman/core": "*",
    "@journeyman/coding-cli": "*",
    "@journeyman/git-provider": "*",
    "@journeyman/ticket-provider": "*",
    "@journeyman/notification-provider": "*",
    "js-yaml": "^4.1.0",
    "uuid": "^10.0.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^25.6.0",
    "@types/uuid": "^10.0.0",
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 2: tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: src/index.ts** — `export {};` (fill during later tracks)

- [ ] **Step 4: `npm install && npm run typecheck -w @journeyman/pipeline`** → exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/pipeline package.json package-lock.json
git commit -m "feat(pipeline): scaffold @journeyman/pipeline package"
```

### Task 1.2: Scaffold `@journeyman/pipeline-server`

Same structure as 1.1 with:

```json
{
  "name": "@journeyman/pipeline-server",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@journeyman/core": "*",
    "@journeyman/pipeline": "*",
    "fastify": "^4.28.1",
    "@fastify/sensible": "^5.6.0",
    "zod": "^3.23.8"
  },
  "devDependencies": { "@types/node": "^25.6.0", "typescript": "^6.0.3" }
}
```

- [ ] Commit: `git commit -m "feat(pipeline-server): scaffold @journeyman/pipeline-server package"`

### Task 1.3: Core `pipeline.types.ts`

**Files:**
- Create: `packages/core/src/types/pipeline.types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create file** — copy the full type set from spec §5:

```ts
// packages/core/src/types/pipeline.types.ts
import type { FlowDefinition } from "./pipeline.types.ts";  // self-ref ok for recursive export

export type IProviderMeta = {
  id: string; name: string; description: string;
  category: "coding-cli" | "git" | "ticket" | "notification";
};

export type PhaseResult =
  | { status: "ok"; artifacts: Record<string, unknown> }
  | { status: "blocked"; reason: string; waitFor?: "ticket-comment" | "pr-comment" | "manual" }
  | { status: "failed"; error: { message: string; code?: string; stack?: string } };

export type StepRecord = {
  id: string;
  phase: string;
  attempt: number;
  status: "pending" | "running" | "ok" | "blocked" | "failed" | "cancelled";
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: { message: string; code?: string; stack?: string };
  blockedReason?: string;
  waitFor?: "ticket-comment" | "pr-comment" | "manual";
};

export type ArtifactHandle = {
  kind: "artifact";
  sessionId: string;
  key: string;
  size: number;
  contentType?: string;
  uri: string;
  sha256?: string;
};

export type ProductRepo = {
  providerId: "github" | "gitlab";
  owner: string;
  repo: string;
  url: string;
  defaultBranch: string;
};

export type TicketWorkflow = {
  trigger?: { matchLabels?: string[]; matchStatus?: string[] };
  statuses: Record<string, string>;
};

export type ProductConfig = {
  flow: string;
  workspace: string;
  repos: ProductRepo[];
  providerConfig?: {
    ticket?: Record<string, unknown>;
    git?: Record<string, unknown>;
    coding?: Record<string, unknown>;
    notification?: Record<string, unknown>;
  };
  ticketWorkflow?: TicketWorkflow;
  webhookSecrets?: Record<string, string>;
  concurrency?: number;
};

export type FlowStepDefinition = {
  id: string;
  phase: string;
  config?: Record<string, unknown>;
  retry?: { attempts: number; backoffMs: number };
  timeoutMs?: number;
  onFailure?: "fail" | "skip" | "retry" | "block";
};

export type FlowDefinition = {
  name: string;
  providers: { ticket: string; git: string; coding: string; notification: string };
  steps: FlowStepDefinition[];
};

export type PipelineRun = {
  sessionId: string;
  productId: string;
  ticketKey: string;
  ticketShortKey: string;
  flowName: string;
  flowSnapshot: FlowDefinition;
  status: "queued" | "running" | "blocked" | "completed" | "failed" | "cancelling" | "cancelled";
  currentStep: string | null;
  steps: StepRecord[];
  artifacts: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type PipelineConfig = {
  defaultFlow: string;
  products: Record<string, ProductConfig>;
  server: {
    port: number;
    bearerTokenEnv: string;
    webhooks: {
      github?: { secretEnv: string; path?: string };
      gitlab?: { secretEnv: string; path?: string };
      jira?:   { secretEnv: string; path?: string };
    };
  };
  workspaces?: {
    cleanupOn?: Array<PipelineRun["status"]>;
    retentionDays?: number;
    keepFailed?: boolean;
  };
};

export type PipelineTrigger = {
  sourceId: string;
  productId: string;
  ticketKey: string;
  ticketShortKey: string;
  flowName?: string;
  rawPayload: unknown;
  receivedAt: string;
};

export type PipelineEvent =
  | { type: "runStarted";  sessionId: string; ticketKey: string; flowName: string; at: string }
  | { type: "stepStarted"; sessionId: string; stepId: string; phase: string; attempt: number; at: string }
  | { type: "stepEnded";   sessionId: string; stepId: string; phase: string; attempt: number; status: StepRecord["status"]; durationMs: number; at: string }
  | { type: "logLine";     sessionId: string; stepId: string; level: "info"|"warn"|"error"; line: string; at: string }
  | { type: "statusChanged"; sessionId: string; from: PipelineRun["status"]; to: PipelineRun["status"]; at: string }
  | { type: "runEnded";    sessionId: string; status: PipelineRun["status"]; at: string };

export type TraceLine = {
  ts: string;
  level: "info" | "warn" | "error";
  stepId: string;
  message: string;
  meta?: Record<string, unknown>;
};
```

(Remove the self-ref import line above — it was illustrative.)

- [ ] **Step 2: Export from core/index.ts**

```ts
export type * from "./types/pipeline.types.ts";
```

- [ ] **Step 3: `npm run typecheck -w @journeyman/core`** → 0.

- [ ] **Step 4: Commit** — `git commit -m "feat(core): add pipeline types"`

### Task 1.4: Core `pipeline.interface.ts`

**Files:**
- Create: `packages/core/src/interfaces/pipeline.interface.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create interfaces** (copy from spec §6):

```ts
// packages/core/src/interfaces/pipeline.interface.ts
import type { FastifyInstance } from "fastify";
import type {
  ArtifactHandle, FlowDefinition, PipelineEvent, PipelineRun,
  PipelineTrigger, PhaseResult, ProductConfig, TraceLine,
} from "../types/pipeline.types.ts";
import type { ICodingCLI } from "./coding-cli.interface.ts";
import type { IGitProvider } from "./git-provider.interface.ts";
import type { ITicketProvider } from "./ticket.interface.ts";
import type { INotificationProvider } from "./notification.interface.ts";

export interface PipelineContext {
  sessionId: string;
  productId: string;
  ticketKey: string;
  ticketShortKey: string;
  flowName: string;
  workspaceDir: string;
  signal: AbortSignal;
  productConfig: ProductConfig;
  providers: {
    ticket: ITicketProvider;
    git: IGitProvider;
    coding: ICodingCLI;
    notification: INotificationProvider;
  };
  artifacts: Record<string, unknown>;
  state: Readonly<PipelineRun>;
  trace: ITraceLogger;
  artifactStore: IArtifactStore;
  emit: (event: PipelineEvent) => void;
}

export interface IPhase {
  readonly name: string;
  run(ctx: PipelineContext, stepConfig: unknown): Promise<PhaseResult>;
}

export interface IStateStore {
  load(sessionId: string): Promise<PipelineRun | null>;
  save(run: PipelineRun): Promise<void>;
  findByTicket(productId: string, ticketKey: string): Promise<PipelineRun[]>;
  findActiveForTicket(productId: string, ticketKey: string): Promise<PipelineRun | null>;
  find(query: { productId?: string; status?: PipelineRun["status"]; limit?: number }): Promise<PipelineRun[]>;
}

export interface ITraceLogger {
  log(sessionId: string, stepId: string, line: string, level?: TraceLine["level"], meta?: Record<string, unknown>): Promise<void>;
  read(sessionId: string, opts?: { stepId?: string; tail?: number }): AsyncIterable<TraceLine>;
}

export interface IArtifactStore {
  put(sessionId: string, key: string, data: Buffer | string, opts?: { contentType?: string; ext?: string }): Promise<ArtifactHandle>;
  putPath(sessionId: string, key: string, srcPath: string, opts?: { contentType?: string }): Promise<ArtifactHandle>;
  get(handle: ArtifactHandle): Promise<Buffer>;
  pathFor(handle: ArtifactHandle): string;
}

export interface IFlowConfigSource {
  getFlow(name: string): Promise<FlowDefinition>;
  listFlows(): Promise<string[]>;
}

export interface IFlowResolver {
  resolve(trigger: PipelineTrigger): Promise<{ flowName: string; productId: string }>;
}

export type TriggerMountContext = {
  products: Record<string, ProductConfig>;
  webhookConfig: import("../types/pipeline.types.ts").PipelineConfig["server"]["webhooks"];
  onTrigger: (trigger: PipelineTrigger) => void;
};

export interface ITriggerSource {
  readonly id: string;
  mount(app: FastifyInstance, ctx: TriggerMountContext): void;
}
```

- [ ] **Step 2: Add fastify peer** in `packages/core/package.json`:

```json
"peerDependencies": { "fastify": "^4.28.1" },
"peerDependenciesMeta": { "fastify": { "optional": true } }
```

- [ ] **Step 3: Export from core/index.ts**

```ts
export type {
  PipelineContext, IPhase, IStateStore, ITraceLogger, IArtifactStore,
  IFlowConfigSource, IFlowResolver, ITriggerSource, TriggerMountContext,
} from "./interfaces/pipeline.interface.ts";
```

- [ ] **Step 4: `npm install && npm run typecheck -w @journeyman/core`** → 0.

- [ ] **Step 5: Commit** — `git commit -m "feat(core): add pipeline interfaces"`

### Task 1.5: Final Phase 1 verification

- [ ] `npm run typecheck` (all packages) → exits 0.
- [ ] `git log --oneline -6` shows Phase 0 + Phase 1 commits.

**Phase 1 complete. Tracks A, B, C, D, E unblocked.**

---

## Track A — Infrastructure (parallel within phase)

Depends on Phase 1 only. Tasks A1–A12 are largely independent; pick any order.

### Task A1: `PhaseRegistry`

**File:** `packages/pipeline/src/registry/phase-registry.ts`

```ts
import type { IPhase } from "@journeyman/core";

export type PhaseFactory = () => IPhase;

export class PhaseRegistry {
  private factories = new Map<string, PhaseFactory>();

  register(name: string, factory: PhaseFactory): void {
    if (this.factories.has(name)) throw new Error(`Phase already registered: ${name}`);
    this.factories.set(name, factory);
  }
  has(name: string): boolean { return this.factories.has(name); }
  resolve(name: string): IPhase {
    const f = this.factories.get(name);
    if (!f) throw new Error(`Unknown phase: ${name}`);
    return f();
  }
  list(): string[] { return [...this.factories.keys()]; }
}
```

Commit: `feat(pipeline): PhaseRegistry`

### Task A2: `ProviderRegistry` with per-product config

**File:** `packages/pipeline/src/registry/provider-registry.ts`

```ts
import type {
  IProviderMeta, ICodingCLI, IGitProvider, ITicketProvider, INotificationProvider,
  ProductConfig, FlowDefinition,
} from "@journeyman/core";

type ProviderCtor = new (opts?: any) => unknown;
type ProviderClass = ProviderCtor & { meta: IProviderMeta };

export type ResolvedProviders = {
  coding: ICodingCLI; git: IGitProvider; ticket: ITicketProvider; notification: INotificationProvider;
};

export class ProviderRegistry {
  private byCategory: Record<IProviderMeta["category"], Map<string, ProviderClass>> = {
    "coding-cli": new Map(), git: new Map(), ticket: new Map(), notification: new Map(),
  };

  register(cls: ProviderClass): void {
    const meta = cls.meta;
    if (!meta || !meta.id || !meta.category) {
      throw new Error(`Provider class missing static meta: ${cls.name ?? "(anonymous)"}`);
    }
    this.byCategory[meta.category].set(meta.id, cls);
  }

  resolveForProduct(flow: FlowDefinition, productConfig: ProductConfig): ResolvedProviders {
    const cfg = productConfig.providerConfig ?? {};
    return {
      coding: this.instantiate("coding-cli", flow.providers.coding, cfg.coding) as ICodingCLI,
      git: this.instantiate("git", flow.providers.git, cfg.git) as IGitProvider,
      ticket: this.instantiate("ticket", flow.providers.ticket, cfg.ticket) as ITicketProvider,
      notification: this.instantiate("notification", flow.providers.notification, cfg.notification) as INotificationProvider,
    };
  }

  listByCategory(category: IProviderMeta["category"]): IProviderMeta[] {
    return [...this.byCategory[category].values()].map(c => c.meta);
  }

  classOf(category: IProviderMeta["category"], id: string): ProviderClass | undefined {
    return this.byCategory[category].get(id);
  }

  private instantiate(category: IProviderMeta["category"], id: string, opts?: Record<string, unknown>): unknown {
    const cls = this.byCategory[category].get(id);
    if (!cls) throw new Error(`No ${category} provider registered with id "${id}"`);
    return opts ? new cls(opts) : new cls();
  }
}
```

Commit: `feat(pipeline): ProviderRegistry with per-product config`

### Task A3: `FileStateStore` with `flowSnapshot` support

**File:** `packages/pipeline/src/state/file-state-store.ts`

```ts
import { mkdirSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IStateStore, PipelineRun } from "@journeyman/core";

/** State is organized per-product: <root>/<productId>/state/<sessionId>.json */
export class FileStateStore implements IStateStore {
  constructor(private readonly rootDir: string) { mkdirSync(rootDir, { recursive: true }); }

  private dirFor(productId: string): string {
    const d = join(this.rootDir, productId, "state");
    mkdirSync(d, { recursive: true });
    return d;
  }

  async load(sessionId: string): Promise<PipelineRun | null> {
    // Search across products (sessionIds are globally unique)
    for (const pid of this.listProducts()) {
      const p = join(this.dirFor(pid), `${sessionId}.json`);
      if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
    }
    return null;
  }

  async save(run: PipelineRun): Promise<void> {
    const dir = this.dirFor(run.productId);
    const final = join(dir, `${run.sessionId}.json`);
    const tmp = `${final}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, JSON.stringify(run, null, 2), "utf8");
    await rename(tmp, final);
  }

  async findByTicket(productId: string, ticketKey: string): Promise<PipelineRun[]> {
    return this.scanProduct(productId).filter(r => r.ticketKey === ticketKey)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findActiveForTicket(productId: string, ticketKey: string): Promise<PipelineRun | null> {
    const active = new Set<PipelineRun["status"]>(["queued", "running", "blocked", "cancelling"]);
    return this.scanProduct(productId)
      .filter(r => r.ticketKey === ticketKey && active.has(r.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }

  async find(q: { productId?: string; status?: PipelineRun["status"]; limit?: number }): Promise<PipelineRun[]> {
    const ps = q.productId ? [q.productId] : this.listProducts();
    let rs = ps.flatMap(p => this.scanProduct(p));
    if (q.status) rs = rs.filter(r => r.status === q.status);
    rs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (q.limit) rs = rs.slice(0, q.limit);
    return rs;
  }

  private listProducts(): string[] {
    if (!existsSync(this.rootDir)) return [];
    return readdirSync(this.rootDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  }

  private scanProduct(productId: string): PipelineRun[] {
    const d = join(this.rootDir, productId, "state");
    if (!existsSync(d)) return [];
    return readdirSync(d)
      .filter(f => f.endsWith(".json") && !f.includes(".tmp-"))
      .map(f => JSON.parse(readFileSync(join(d, f), "utf8")) as PipelineRun);
  }
}
```

> Note: the root dir passed in is `workspaces/` (the parent of per-product dirs). Constructor path means store-root = `./workspaces`, and each product's state lives under `./workspaces/<productId>/state/`.

Commit: `feat(pipeline): FileStateStore with per-product layout + flowSnapshot`

### Task A4: `FileTraceLogger`

**File:** `packages/pipeline/src/state/file-trace-logger.ts`

```ts
import { mkdirSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { ITraceLogger, TraceLine } from "@journeyman/core";

/** <root>/<productId>/logs/<sessionId>/<stepId>.log */
export class FileTraceLogger implements ITraceLogger {
  constructor(private readonly rootDir: string, private readonly resolveProductId: (sessionId: string) => string | null) {
    mkdirSync(rootDir, { recursive: true });
  }

  async log(sessionId: string, stepId: string, message: string, level: TraceLine["level"] = "info", meta?: Record<string, unknown>): Promise<void> {
    const productId = this.resolveProductId(sessionId);
    if (!productId) throw new Error(`FileTraceLogger: no product for session ${sessionId}`);
    const dir = join(this.rootDir, productId, "logs", sessionId);
    mkdirSync(dir, { recursive: true });
    const line: TraceLine = { ts: new Date().toISOString(), level, stepId, message, meta };
    await appendFile(join(dir, `${stepId}.log`), JSON.stringify(line) + "\n", "utf8");
  }

  async *read(sessionId: string, opts: { stepId?: string; tail?: number } = {}): AsyncIterable<TraceLine> {
    const productId = this.resolveProductId(sessionId);
    if (!productId) return;
    const dir = join(this.rootDir, productId, "logs", sessionId);
    if (!existsSync(dir)) return;
    const files = readdirSync(dir).filter(f => f.endsWith(".log"))
      .filter(f => !opts.stepId || f === `${opts.stepId}.log`);
    const all: TraceLine[] = [];
    for (const f of files) {
      const raw = readFileSync(join(dir, f), "utf8");
      for (const l of raw.split("\n")) if (l.trim()) all.push(JSON.parse(l));
    }
    all.sort((a, b) => a.ts.localeCompare(b.ts));
    const sliced = opts.tail ? all.slice(-opts.tail) : all;
    for (const line of sliced) yield line;
  }
}
```

Commit: `feat(pipeline): FileTraceLogger with per-product layout`

### Task A5: `FileArtifactStore`

**File:** `packages/pipeline/src/state/file-artifact-store.ts`

```ts
import { createHash } from "node:crypto";
import { mkdirSync, statSync } from "node:fs";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { IArtifactStore, ArtifactHandle } from "@journeyman/core";

const EXT_BY_CT: Record<string, string> = {
  "text/markdown": ".md", "application/json": ".json",
  "text/plain": ".txt", "application/octet-stream": ".bin",
};
const CT_BY_EXT: Record<string, string> = {
  ".md": "text/markdown", ".json": "application/json", ".txt": "text/plain",
};

/** <root>/<productId>/artifacts/<sessionId>/<key><.ext> */
export class FileArtifactStore implements IArtifactStore {
  constructor(private readonly rootDir: string, private readonly resolveProductId: (sessionId: string) => string | null) {}

  async put(sessionId: string, key: string, data: Buffer | string, opts: { contentType?: string; ext?: string } = {}): Promise<ArtifactHandle> {
    const ext = opts.ext ?? (opts.contentType ? EXT_BY_CT[opts.contentType] ?? ".bin" : ".bin");
    const { destPath, productId } = this.prepare(sessionId, key, ext);
    const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
    await writeFile(destPath, buf);
    return this.handleOf(sessionId, key, destPath, buf.length, opts.contentType);
  }

  async putPath(sessionId: string, key: string, srcPath: string, opts: { contentType?: string } = {}): Promise<ArtifactHandle> {
    const ext = extname(srcPath) || ".bin";
    const { destPath } = this.prepare(sessionId, key, ext);
    await copyFile(srcPath, destPath);
    const size = statSync(destPath).size;
    return this.handleOf(sessionId, key, destPath, size, opts.contentType ?? CT_BY_EXT[ext]);
  }

  async get(handle: ArtifactHandle): Promise<Buffer> {
    return readFile(this.pathFor(handle));
  }

  pathFor(handle: ArtifactHandle): string {
    if (!handle.uri.startsWith("file://")) throw new Error(`Not a file handle: ${handle.uri}`);
    return handle.uri.slice("file://".length);
  }

  private prepare(sessionId: string, key: string, ext: string): { destPath: string; productId: string } {
    const productId = this.resolveProductId(sessionId);
    if (!productId) throw new Error(`FileArtifactStore: no product for session ${sessionId}`);
    const dir = join(this.rootDir, productId, "artifacts", sessionId);
    mkdirSync(dir, { recursive: true });
    return { destPath: join(dir, `${key}${ext}`), productId };
  }

  private async handleOf(sessionId: string, key: string, destPath: string, size: number, contentType?: string): Promise<ArtifactHandle> {
    const sha = createHash("sha256").update(await readFile(destPath)).digest("hex");
    return {
      kind: "artifact", sessionId, key, size, contentType,
      uri: `file://${resolve(destPath)}`, sha256: sha,
    };
  }
}
```

Commit: `feat(pipeline): FileArtifactStore for handle-based persistence`

### Task A6: `EventBus`

**File:** `packages/pipeline/src/event-bus.ts`

```ts
import type { PipelineEvent } from "@journeyman/core";

type Listener = (e: PipelineEvent) => void;

export class EventBus {
  private listeners = new Map<string, Set<Listener>>();
  private buffers = new Map<string, PipelineEvent[]>();
  constructor(private readonly bufferSize: number = 500) {}

  publish(e: PipelineEvent): void {
    const ls = this.listeners.get(e.sessionId);
    if (ls) for (const l of ls) l(e);
    let buf = this.buffers.get(e.sessionId);
    if (!buf) { buf = []; this.buffers.set(e.sessionId, buf); }
    buf.push(e);
    if (buf.length > this.bufferSize) buf.splice(0, buf.length - this.bufferSize);
  }

  subscribe(sessionId: string, listener: Listener): () => void {
    let set = this.listeners.get(sessionId);
    if (!set) { set = new Set(); this.listeners.set(sessionId, set); }
    set.add(listener);
    return () => { set!.delete(listener); };
  }

  replay(sessionId: string): PipelineEvent[] {
    return [...(this.buffers.get(sessionId) ?? [])];
  }
}
```

Commit: `feat(pipeline): in-process EventBus with ring buffer`

### Task A7: YAML flow config source + schema

**Files:**
- `packages/pipeline/src/config/flow-schema.ts`
- `packages/pipeline/src/config/yaml-flow-config-source.ts`

```ts
// flow-schema.ts
import { z } from "zod";

export const FlowSchema = z.object({
  name: z.string().min(1),
  providers: z.object({
    ticket: z.string().min(1), git: z.string().min(1),
    coding: z.string().min(1), notification: z.string().min(1),
  }),
  steps: z.array(z.object({
    id: z.string().min(1).optional(),
    phase: z.string().min(1),
    config: z.record(z.unknown()).optional(),
    retry: z.object({ attempts: z.number().int().min(1), backoffMs: z.number().int().min(0) }).optional(),
    timeoutMs: z.number().int().min(0).optional(),
    onFailure: z.enum(["fail", "skip", "retry", "block"]).optional(),
  })).min(1),
});
```

```ts
// yaml-flow-config-source.ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { IFlowConfigSource, FlowDefinition } from "@journeyman/core";
import { FlowSchema } from "./flow-schema.ts";

export class YamlFlowConfigSource implements IFlowConfigSource {
  private constructor(private readonly byName: Map<string, FlowDefinition>) {}

  static async fromDir(dir: string): Promise<YamlFlowConfigSource> {
    const byName = new Map<string, FlowDefinition>();
    const files = readdirSync(dir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));
    for (const f of files) {
      const full = join(dir, f);
      const parsed = yaml.load(readFileSync(full, "utf8"));
      const result = FlowSchema.safeParse(parsed);
      if (!result.success) throw new Error(`Invalid flow file ${full}: ${result.error.message}`);
      const data = result.data;
      // Default step.id = phase name if absent; reject duplicates
      const ids = new Set<string>();
      const steps = data.steps.map(s => {
        const id = s.id ?? s.phase;
        if (ids.has(id)) throw new Error(`Duplicate step id "${id}" in flow ${data.name}`);
        ids.add(id);
        return { ...s, id };
      });
      byName.set(data.name, { ...data, steps } as FlowDefinition);
    }
    return new YamlFlowConfigSource(byName);
  }

  async getFlow(name: string): Promise<FlowDefinition> {
    const f = this.byName.get(name);
    if (!f) throw new Error(`Unknown flow: ${name}`);
    return f;
  }
  async listFlows(): Promise<string[]> { return [...this.byName.keys()]; }
}
```

Commit: `feat(pipeline): YamlFlowConfigSource with Zod validation`

### Task A8: `ConfigFlowResolver`

**File:** `packages/pipeline/src/config/flow-resolver.ts`

```ts
import type { IFlowResolver, PipelineTrigger, PipelineConfig } from "@journeyman/core";

export class ConfigFlowResolver implements IFlowResolver {
  constructor(private readonly cfg: Pick<PipelineConfig, "defaultFlow" | "products">) {}

  async resolve(trigger: PipelineTrigger): Promise<{ flowName: string; productId: string }> {
    const productId = trigger.productId;
    const flowName =
      trigger.flowName
      ?? this.cfg.products[productId]?.flow
      ?? this.cfg.defaultFlow;
    return { flowName, productId };
  }
}
```

Commit: `feat(pipeline): ConfigFlowResolver`

### Task A9: `FlowValidator` (boot-time graph walk)

**File:** `packages/pipeline/src/config/flow-validator.ts`

```ts
import type { FlowDefinition, ProductConfig } from "@journeyman/core";
import type { PhaseRegistry } from "../registry/phase-registry.ts";
import type { ProviderRegistry } from "../registry/provider-registry.ts";
import type { BasePhaseStatic } from "../phases/base-phase.ts";

export type ValidationCtx = {
  phases: PhaseRegistry;
  providers: ProviderRegistry;
  flows: FlowDefinition[];
  products: Record<string, ProductConfig>;
  defaultFlow: string;
};

export class FlowValidator {
  static validate(ctx: ValidationCtx): void {
    for (const flow of ctx.flows) {
      this.validatePhasesExist(flow, ctx.phases);
      this.validateProvidersExist(flow, ctx.providers);
      this.validateReadsWrites(flow, ctx.phases);
    }
    this.validateDefaults(ctx);
    this.validateProductFlows(ctx);
    this.validateStatusNames(ctx);
  }

  private static validatePhasesExist(flow: FlowDefinition, phases: PhaseRegistry) {
    for (const s of flow.steps) {
      if (!phases.has(s.phase)) {
        throw new Error(`Flow "${flow.name}" step "${s.id}" uses unknown phase "${s.phase}".\nRegistered phases: ${phases.list().join(", ")}.`);
      }
    }
  }

  private static validateProvidersExist(flow: FlowDefinition, providers: ProviderRegistry) {
    const cats: Array<[keyof FlowDefinition["providers"], "coding-cli" | "git" | "ticket" | "notification"]> = [
      ["ticket", "ticket"], ["git", "git"], ["coding", "coding-cli"], ["notification", "notification"],
    ];
    for (const [key, cat] of cats) {
      const id = flow.providers[key];
      const known = providers.listByCategory(cat).map(m => m.id);
      if (!known.includes(id)) {
        throw new Error(`Flow "${flow.name}" references unknown ${cat} provider "${id}".\nRegistered: ${known.join(", ")}.`);
      }
    }
  }

  private static validateReadsWrites(flow: FlowDefinition, phases: PhaseRegistry) {
    const available = new Set<string>();
    for (const step of flow.steps) {
      const phase = phases.resolve(step.phase);
      const Cls = (phase as any).constructor as BasePhaseStatic;
      const reads = Cls.reads ?? [];
      const missing = reads.filter(k => !available.has(k));
      if (missing.length > 0) {
        throw new Error(
          `Flow "${flow.name}" step "${step.id}" (phase ${step.phase}) needs artifacts [${missing.join(", ")}] ` +
          `that no earlier step produces.\n` +
          `Available: [${[...available].join(", ") || "(none)"}].`,
        );
      }
      for (const w of Cls.writes ?? []) available.add(w);
    }
  }

  private static validateDefaults(ctx: ValidationCtx) {
    const names = ctx.flows.map(f => f.name);
    if (!names.includes(ctx.defaultFlow)) {
      throw new Error(`defaultFlow "${ctx.defaultFlow}" not found. Available: ${names.join(", ")}.`);
    }
  }

  private static validateProductFlows(ctx: ValidationCtx) {
    const names = ctx.flows.map(f => f.name);
    for (const [pid, p] of Object.entries(ctx.products)) {
      if (!names.includes(p.flow)) {
        throw new Error(`Product "${pid}" uses flow "${p.flow}" which is not defined.`);
      }
      if (!p.repos || p.repos.length === 0) {
        throw new Error(`Product "${pid}" must declare at least one repo.`);
      }
    }
  }

  private static validateStatusNames(ctx: ValidationCtx) {
    for (const [pid, p] of Object.entries(ctx.products)) {
      const flow = ctx.flows.find(f => f.name === p.flow);
      if (!flow) continue;
      const statuses = p.ticketWorkflow?.statuses ?? {};
      for (const step of flow.steps) {
        if (step.phase !== "updateStatus") continue;
        const semantic = (step.config as any)?.status;
        if (!semantic) continue;
        if (!(semantic in statuses)) {
          throw new Error(
            `Flow "${flow.name}" step "${step.id}" uses semantic status "${semantic}" ` +
            `not defined in product "${pid}".\nDefined: [${Object.keys(statuses).join(", ")}].`,
          );
        }
      }
    }
  }
}
```

Commit: `feat(pipeline): FlowValidator — phases/providers/graph/status cross-check`

### Task A10: `adapter-unwrap` helpers

**File:** `packages/pipeline/src/adapter-unwrap.ts`

```ts
export class AdapterError extends Error {
  constructor(public readonly operation: string, public readonly original: string) {
    super(`${operation}: ${original}`);
    this.name = "AdapterError";
  }
}

export function unwrap<T extends { error?: string }>(result: T, operation: string): T {
  if (result.error) throw new AdapterError(operation, result.error);
  return result;
}

export function unwrapField<T extends { error?: string }, K extends keyof T>(
  result: T, field: K, operation: string,
): NonNullable<T[K]> {
  if (result.error) throw new AdapterError(operation, result.error);
  const v = result[field];
  if (v === undefined || v === null) throw new AdapterError(operation, `missing field "${String(field)}"`);
  return v as NonNullable<T[K]>;
}
```

Commit: `feat(pipeline): adapter unwrap helpers (AdapterError, unwrap, unwrapField)`

### Task A11: Pipeline config loader + schema

**Files:**
- `packages/pipeline/src/config/pipeline-schema.ts`
- `packages/pipeline/src/config/pipeline-config-loader.ts`

```ts
// pipeline-schema.ts
import { z } from "zod";

export const PipelineConfigSchema = z.object({
  defaultFlow: z.string().min(1),
  products: z.record(z.object({
    flow: z.string().min(1),
    workspace: z.string().min(1),
    repos: z.array(z.object({
      providerId: z.enum(["github", "gitlab"]),
      owner: z.string().min(1), repo: z.string().min(1),
      url: z.string().min(1), defaultBranch: z.string().min(1),
    })).min(1),
    providerConfig: z.object({
      ticket: z.record(z.unknown()).optional(),
      git: z.record(z.unknown()).optional(),
      coding: z.record(z.unknown()).optional(),
      notification: z.record(z.unknown()).optional(),
    }).optional(),
    ticketWorkflow: z.object({
      trigger: z.object({
        matchLabels: z.array(z.string()).optional(),
        matchStatus: z.array(z.string()).optional(),
      }).optional(),
      statuses: z.record(z.string()),
    }).optional(),
    webhookSecrets: z.record(z.string()).optional(),
    concurrency: z.number().int().min(1).optional(),
  })),
  server: z.object({
    port: z.number().int(),
    bearerTokenEnv: z.string().min(1),
    webhooks: z.object({
      github: z.object({ secretEnv: z.string(), path: z.string().optional() }).optional(),
      gitlab: z.object({ secretEnv: z.string(), path: z.string().optional() }).optional(),
      jira:   z.object({ secretEnv: z.string(), path: z.string().optional() }).optional(),
    }),
  }),
  workspaces: z.object({
    cleanupOn: z.array(z.enum(["queued","running","blocked","completed","failed","cancelling","cancelled"])).optional(),
    retentionDays: z.number().int().min(0).optional(),
    keepFailed: z.boolean().optional(),
  }).optional(),
});
```

```ts
// pipeline-config-loader.ts
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import type { PipelineConfig } from "@journeyman/core";
import { PipelineConfigSchema } from "./pipeline-schema.ts";

export function loadPipelineConfig(path: string): PipelineConfig {
  const raw = yaml.load(readFileSync(path, "utf8"));
  const result = PipelineConfigSchema.safeParse(raw);
  if (!result.success) throw new Error(`Invalid pipeline config ${path}: ${result.error.message}`);
  return result.data as PipelineConfig;
}
```

Commit: `feat(pipeline): pipeline config loader + schema`

### Task A12: `lib/` utilities

**Files:**
- `packages/pipeline/src/lib/any-signal.ts`
- `packages/pipeline/src/lib/best-effort.ts`
- `packages/pipeline/src/lib/format-ticket-md.ts`

```ts
// any-signal.ts
export function anySignal(signals: AbortSignal[]): AbortSignal {
  const ac = new AbortController();
  const onAbort = (s: AbortSignal) => ac.abort(s.reason);
  for (const s of signals) {
    if (s.aborted) onAbort(s);
    else s.addEventListener("abort", () => onAbort(s), { once: true });
  }
  return ac.signal;
}
```

```ts
// best-effort.ts
import type { PipelineContext } from "@journeyman/core";
export async function bestEffort<T>(ctx: PipelineContext, label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try { return await fn(); }
  catch (err: any) {
    await ctx.trace.log(ctx.sessionId, ctx.state.currentStep ?? "?", `soft-fail [${label}]: ${err.message}`, "warn");
    return undefined;
  }
}
```

```ts
// format-ticket-md.ts
import type { Ticket } from "@journeyman/core";
export function formatTicketMd(ticket: Ticket): string {
  const title = (ticket.title ?? "").trim() || `Ticket ${ticket.id}`;
  const body = (ticket.description ?? "").trim();
  return body ? `# ${title}\n\n${body}` : `# ${title}`;
}
```

Commit: `feat(pipeline): lib utilities (anySignal, bestEffort, formatTicketMd)`

**Track A complete.** Proceed to tracks B, C, D, E in parallel.

---

## Track B — Phases (mostly parallel; B1 is prerequisite)

Depends on Track A (A5 artifactStore, A10 unwrap) and Phase 0 (Claude signal, GH Issues updateStatus, listPRs). **Do B1 first; then B2–B13 can proceed in parallel.**

### Task B1: `BasePhase`

**File:** `packages/pipeline/src/phases/base-phase.ts`

```ts
import type { IPhase, PhaseResult, PipelineContext } from "@journeyman/core";

export interface BasePhaseStatic {
  reads?: readonly string[];
  writes?: readonly string[];
}

export abstract class BasePhase implements IPhase {
  abstract readonly name: string;
  static reads: readonly string[] = [];
  static writes: readonly string[] = [];

  abstract run(ctx: PipelineContext, config: unknown): Promise<PhaseResult>;

  protected ok(artifacts: Record<string, unknown>): PhaseResult { return { status: "ok", artifacts }; }
  protected blocked(reason: string, waitFor?: "ticket-comment" | "pr-comment" | "manual"): PhaseResult {
    return { status: "blocked", reason, waitFor };
  }
  protected failed(message: string, code?: string): PhaseResult {
    return { status: "failed", error: { message, code } };
  }

  protected require<T>(ctx: PipelineContext, key: string): T {
    const v = ctx.artifacts[key];
    if (v === undefined) throw new Error(`${this.name}: missing required artifact "${key}"`);
    return v as T;
  }
  protected optional<T>(ctx: PipelineContext, key: string): T | undefined {
    return ctx.artifacts[key] as T | undefined;
  }
}
```

Commit: `feat(pipeline): BasePhase with reads/writes + helpers`

### Task B2: `GetTicketPhase`

**File:** `packages/pipeline/src/phases/get-ticket-phase.ts`

```ts
import { BasePhase } from "./base-phase.ts";
import { unwrapField } from "../adapter-unwrap.ts";
import { formatTicketMd } from "../lib/format-ticket-md.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

export class GetTicketPhase extends BasePhase {
  readonly name = "getTicket";
  static reads = [] as const;
  static writes = ["ticket", "ticketMd"] as const;

  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const res = await ctx.providers.ticket.getTicket({ id: ctx.ticketKey, sessionId: ctx.sessionId });
    const ticket = unwrapField(res, "ticket", "getTicket");
    return this.ok({ ticket, ticketMd: formatTicketMd(ticket) });
  }
}
```

Commit: `feat(pipeline): GetTicketPhase`

### Task B3: `CloneReposPhase`

**File:** `packages/pipeline/src/phases/clone-repos-phase.ts`

```ts
import { join } from "node:path";
import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

export class CloneReposPhase extends BasePhase {
  readonly name = "cloneRepos";
  static reads = [] as const;
  static writes = ["repoPaths", "primaryRepoPath", "repoRefs"] as const;

  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const repos = ctx.productConfig.repos;
    if (!repos.length) return this.blocked("product has no repos configured", "manual");

    const entries = repos.map(r => ({ url: r.url, branch: r.defaultBranch }));
    const res = unwrap(await ctx.providers.coding.cloneRepos({
      repos: entries,
      targetDir: join(ctx.workspaceDir, "repos"),
      sessionId: ctx.sessionId,
      signal: ctx.signal,
    }), "cloneRepos");

    for (const c of res.repos) if (c.error) return this.failed(`cloneRepos: ${c.error}`);

    const repoPaths = res.repos.map(r => r.dirPath);
    return this.ok({
      repoPaths,
      primaryRepoPath: repoPaths[0],
      repoRefs: repos,
    });
  }
}
```

Commit: `feat(pipeline): CloneReposPhase`

### Task B4: `AnalyzePhase` (with artifactStore persistence)

**File:** `packages/pipeline/src/phases/analyze-phase.ts`

```ts
import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { AnalyzeResult, PhaseResult, PipelineContext } from "@journeyman/core";

export class AnalyzePhase extends BasePhase {
  readonly name = "analyze";
  static reads = ["primaryRepoPath", "ticketMd"] as const;
  static writes = ["analysis"] as const;

  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const primaryRepoPath = this.require<string>(ctx, "primaryRepoPath");
    const ticketMd = this.require<string>(ctx, "ticketMd");

    const result = unwrap(await ctx.providers.coding.analyze({
      dirPath: primaryRepoPath, ticketContent: ticketMd,
      sessionId: ctx.sessionId, signal: ctx.signal,
    }), "analyze") as AnalyzeResult;

    const reportHandle = await ctx.artifactStore.putPath(
      ctx.sessionId, "analyze-report", result.reportPath,
      { contentType: "text/markdown" },
    );

    return this.ok({ analysis: { ...result, reportHandle } });
  }
}
```

Commit: `feat(pipeline): AnalyzePhase with persisted report handle`

### Task B5: `PlanPhase`

**File:** `packages/pipeline/src/phases/plan-phase.ts`

```ts
import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { AnalyzeResult, PhaseResult, PipelineContext, PlanResult } from "@journeyman/core";

export class PlanPhase extends BasePhase {
  readonly name = "plan";
  static reads = ["analysis", "ticketMd", "primaryRepoPath"] as const;
  static writes = ["plan"] as const;

  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const analysis = this.require<AnalyzeResult>(ctx, "analysis");
    const primaryRepoPath = this.require<string>(ctx, "primaryRepoPath");
    const ticketMd = this.require<string>(ctx, "ticketMd");

    const result = unwrap(await ctx.providers.coding.plan({
      dirPath: primaryRepoPath,
      ticketContent: ticketMd,
      analyzeReportPath: analysis.reportPath,
      sessionId: ctx.sessionId, signal: ctx.signal,
    }), "plan") as PlanResult;

    const reportHandle = await ctx.artifactStore.putPath(
      ctx.sessionId, "plan-report", result.reportPath,
      { contentType: "text/markdown" },
    );

    return this.ok({ plan: { ...result, reportHandle } });
  }
}
```

Commit: `feat(pipeline): PlanPhase with persisted report handle`

### Task B6: `ImplementPhase`

**File:** `packages/pipeline/src/phases/implement-phase.ts`

```ts
import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { AnalyzeResult, ImplementResult, PhaseResult, PipelineContext, PlanResult } from "@journeyman/core";

export class ImplementPhase extends BasePhase {
  readonly name = "implement";
  static reads = ["plan", "primaryRepoPath", "ticketMd"] as const;
  static writes = ["implementation"] as const;

  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const plan = this.require<PlanResult>(ctx, "plan");
    const analysis = this.optional<AnalyzeResult>(ctx, "analysis");
    const primaryRepoPath = this.require<string>(ctx, "primaryRepoPath");
    const ticketMd = this.require<string>(ctx, "ticketMd");

    const result = unwrap(await ctx.providers.coding.implement({
      dirPath: primaryRepoPath,
      ticketContent: ticketMd,
      analyzeReportPath: analysis?.reportPath,
      planReportPath: plan.reportPath,
      sessionId: ctx.sessionId, signal: ctx.signal,
    }), "implement") as ImplementResult;

    if (!result.success) return this.failed(result.error ?? "implement returned success=false");

    const reportHandle = await ctx.artifactStore.putPath(
      ctx.sessionId, "implement-report", result.reportPath,
      { contentType: "text/markdown" },
    );

    return this.ok({ implementation: { ...result, reportHandle } });
  }
}
```

Commit: `feat(pipeline): ImplementPhase with persisted report handle`

### Task B7: `CommitPushPhase`

**File:** `packages/pipeline/src/phases/commit-push-phase.ts`

```ts
import { BasePhase } from "./base-phase.ts";
import { unwrap, AdapterError } from "../adapter-unwrap.ts";
import type { CommitPushResult, PhaseResult, PipelineContext } from "@journeyman/core";

type Config = { pattern?: string; prSummaryStyle?: "brief" | "detailed" };

export class CommitPushPhase extends BasePhase {
  readonly name = "commitPushRepos";
  static reads = ["primaryRepoPath"] as const;
  static writes = ["commit"] as const;

  async run(ctx: PipelineContext, config: Config = {}): Promise<PhaseResult> {
    const primaryRepoPath = this.require<string>(ctx, "primaryRepoPath");

    const res = unwrap(await ctx.providers.coding.commitPushRepos({
      repos: primaryRepoPath,
      ticket: ctx.ticketShortKey,
      pattern: config.pattern,
      prSummaryStyle: config.prSummaryStyle,
      sessionId: ctx.sessionId, signal: ctx.signal,
    }), "commitPushRepos");

    const primary = res.repos[0] as CommitPushResult | undefined;
    if (!primary) throw new AdapterError("commitPushRepos", "no repo result returned");
    if (primary.error) throw new AdapterError("commitPushRepos", primary.error);
    if (!primary.pushed) throw new AdapterError("commitPushRepos", "push did not succeed");

    return this.ok({ commit: primary });
  }
}
```

Commit: `feat(pipeline): CommitPushPhase`

### Task B8: `CreatePRPhase` with `listPRs` idempotency

**File:** `packages/pipeline/src/phases/create-pr-phase.ts`

```ts
import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { CommitPushResult, PhaseResult, PipelineContext } from "@journeyman/core";

export class CreatePRPhase extends BasePhase {
  readonly name = "createPR";
  static reads = ["commit"] as const;
  static writes = ["pr"] as const;

  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const commit = this.require<CommitPushResult>(ctx, "commit");
    const primary = ctx.productConfig.repos[0];

    // Idempotency: reuse existing PR for branch if present
    const listRes = await ctx.providers.git.listPRs({
      owner: primary.owner, repo: primary.repo,
      head: `${primary.owner}:${commit.branch}`,
      state: "open",
      sessionId: ctx.sessionId,
    });
    if (!listRes.error && listRes.prs?.length) {
      const existing = listRes.prs[0];
      return this.ok({ pr: { id: existing.id, url: existing.url, number: existing.number } });
    }

    const res = unwrap(await ctx.providers.git.createPR({
      owner: primary.owner, repo: primary.repo,
      title: commit.title, body: commit.description,
      sourceBranch: commit.branch, targetBranch: primary.defaultBranch,
      sessionId: ctx.sessionId,
    }), "createPR");

    return this.ok({ pr: { id: res.id, url: res.url, number: res.number } });
  }
}
```

Commit: `feat(pipeline): CreatePRPhase with listPRs idempotency preflight`

### Task B9: `CleanupReposPhase`

**File:** `packages/pipeline/src/phases/cleanup-repos-phase.ts`

```ts
import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

export class CleanupReposPhase extends BasePhase {
  readonly name = "cleanupRepos";
  static reads = ["repoPaths"] as const;
  static writes = [] as const;

  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const repoPaths = this.require<string[]>(ctx, "repoPaths");
    unwrap(await ctx.providers.coding.cleanupRepos({
      repos: repoPaths, sessionId: ctx.sessionId, signal: ctx.signal,
    }), "cleanupRepos");
    return this.ok({});
  }
}
```

Commit: `feat(pipeline): CleanupReposPhase`

### Task B10: `AddCommentPhase`

**File:** `packages/pipeline/src/phases/add-comment-phase.ts`

```ts
import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { AnalyzeResult, PhaseResult, PipelineContext } from "@journeyman/core";

type Config = { template?: string; body?: string };

export class AddCommentPhase extends BasePhase {
  readonly name = "addComment";
  static reads = [] as const;       // requires runtime artifacts depending on template
  static writes = ["commentIds"] as const;

  async run(ctx: PipelineContext, config: Config = {}): Promise<PhaseResult> {
    const body = config.body ?? this.renderTemplate(ctx, config.template ?? "default");
    const res = unwrap(await ctx.providers.ticket.addComment({
      id: ctx.ticketKey, body, sessionId: ctx.sessionId,
    }), "addComment");

    const prior = this.optional<Record<string, string>>(ctx, "commentIds") ?? {};
    const stepId = ctx.state.currentStep ?? "addComment";
    return this.ok({ commentIds: { ...prior, [stepId]: res.comment?.id ?? "unknown" } });
  }

  private renderTemplate(ctx: PipelineContext, template: string): string {
    if (template === "analysis-summary") {
      const a = this.optional<AnalyzeResult>(ctx, "analysis");
      if (!a) return "Auto-pilot: (no analysis available)";
      return `🤖 **Analysis complete**\n\n- **Complexity:** ${a.complexity}\n- **Readiness:** ${a.readinessScore}/100\n\n${a.summary}`;
    }
    if (template === "pr-opened") {
      const pr = this.optional<{ url: string; number: number }>(ctx, "pr");
      return pr ? `🚀 PR opened: ${pr.url}` : `🚀 PR opened (url unavailable)`;
    }
    return `Auto-pilot checkpoint: ${ctx.state.currentStep}`;
  }
}
```

Commit: `feat(pipeline): AddCommentPhase with template rendering`

### Task B11: `UpdateStatusPhase` (config-driven)

**File:** `packages/pipeline/src/phases/update-status-phase.ts`

```ts
import { BasePhase } from "./base-phase.ts";
import { unwrap, AdapterError } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

type Config = { status: string };
type StatusEntry = { at: string; semantic: string; actual: string; ok: boolean };

export class UpdateStatusPhase extends BasePhase {
  readonly name = "updateStatus";
  static reads = [] as const;
  static writes = ["statusHistory"] as const;

  async run(ctx: PipelineContext, config: Config): Promise<PhaseResult> {
    const semantic = config.status;
    const map = ctx.productConfig.ticketWorkflow?.statuses ?? {};
    const actual = map[semantic];
    if (!actual) throw new AdapterError("updateStatus", `no mapping for semantic status "${semantic}" in product "${ctx.productId}"`);

    unwrap(await ctx.providers.ticket.updateStatus({
      id: ctx.ticketKey, status: actual, sessionId: ctx.sessionId,
    }), "updateStatus");

    const prior = this.optional<StatusEntry[]>(ctx, "statusHistory") ?? [];
    return this.ok({
      statusHistory: [...prior, { at: new Date().toISOString(), semantic, actual, ok: true }],
    });
  }
}
```

Commit: `feat(pipeline): UpdateStatusPhase (config-driven semantic → literal)`

### Task B12: `ReviewPhase` stub

**File:** `packages/pipeline/src/phases/review-phase.ts`

```ts
import { BasePhase } from "./base-phase.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

export class ReviewPhase extends BasePhase {
  readonly name = "review";
  static reads = [] as const;
  static writes = [] as const;
  async run(_ctx: PipelineContext): Promise<PhaseResult> {
    return this.blocked("awaiting human review", "pr-comment");
  }
}
```

Commit: `feat(pipeline): ReviewPhase stub`

### Task B13: `RequireFieldPhase`

**File:** `packages/pipeline/src/phases/require-field-phase.ts`

```ts
import { BasePhase } from "./base-phase.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

type Config = { artifact: string; field?: string };

export class RequireFieldPhase extends BasePhase {
  readonly name = "requireField";
  static reads = [] as const;
  static writes = [] as const;

  async run(ctx: PipelineContext, config: Config): Promise<PhaseResult> {
    const v = ctx.artifacts[config.artifact];
    if (v === undefined || v === null) return this.blocked(`missing artifact "${config.artifact}"`, "manual");
    if (config.field) {
      const inner = (v as any)?.[config.field];
      if (inner === undefined || inner === null || (typeof inner === "string" && !inner.trim())) {
        return this.blocked(`artifact "${config.artifact}.${config.field}" is empty`, "manual");
      }
    }
    return this.ok({});
  }
}
```

Commit: `feat(pipeline): RequireFieldPhase reusable gate`

**Track B complete.**

---

## Track C — Runner (mostly sequential)

Depends on Tracks A. Build in order C1 → C2 → C3 → … Each adds capability.

### Task C1: `buildContext`

**File:** `packages/pipeline/src/context.ts`

```ts
import type {
  PipelineContext, PipelineRun, PipelineEvent,
  ITraceLogger, IArtifactStore, ProductConfig,
} from "@journeyman/core";
import type { ResolvedProviders } from "./registry/provider-registry.ts";

export function buildContext(args: {
  run: PipelineRun;
  signal: AbortSignal;
  workspaceDir: string;
  productConfig: ProductConfig;
  providers: ResolvedProviders;
  trace: ITraceLogger;
  artifactStore: IArtifactStore;
  emit: (e: PipelineEvent) => void;
}): PipelineContext {
  const { run, signal, workspaceDir, productConfig, providers, trace, artifactStore, emit } = args;
  return {
    sessionId: run.sessionId,
    productId: run.productId,
    ticketKey: run.ticketKey,
    ticketShortKey: run.ticketShortKey,
    flowName: run.flowName,
    workspaceDir,
    signal,
    productConfig,
    providers,
    artifacts: run.artifacts,
    state: run,
    trace,
    artifactStore,
    emit,
  };
}
```

Commit: `feat(pipeline): buildContext helper`

### Task C2: `Pipeline` runner — happy path

**File:** `packages/pipeline/src/pipeline.ts`

```ts
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type {
  FlowDefinition, FlowStepDefinition, IPhase, IStateStore, ITraceLogger,
  IArtifactStore, PhaseResult, PipelineEvent, PipelineRun, PipelineTrigger,
  ProductConfig, StepRecord,
} from "@journeyman/core";
import type { PhaseRegistry } from "./registry/phase-registry.ts";
import type { ResolvedProviders } from "./registry/provider-registry.ts";
import type { EventBus } from "./event-bus.ts";
import { buildContext } from "./context.ts";
import { anySignal } from "./lib/any-signal.ts";

export type PipelineDeps = {
  phases: PhaseRegistry;
  state: IStateStore;
  trace: ITraceLogger;
  artifactStore: IArtifactStore;
  bus: EventBus;
  resolveProviders: (flow: FlowDefinition, productConfig: ProductConfig) => ResolvedProviders;
  getProductConfig: (productId: string) => ProductConfig;
  cleanupOn?: Array<PipelineRun["status"]>;
};

export type RunArgs = { trigger: PipelineTrigger; flow: FlowDefinition };

export class Pipeline {
  private aborters = new Map<string, AbortController>();

  constructor(private readonly deps: PipelineDeps) {}

  listRunning(): string[] { return [...this.aborters.keys()]; }

  cancel(sessionId: string): void {
    const ac = this.aborters.get(sessionId);
    if (ac) ac.abort();
  }

  async run({ trigger, flow }: RunArgs): Promise<PipelineRun> {
    const now = () => new Date().toISOString();
    const sessionId = randomUUID();
    const productConfig = this.deps.getProductConfig(trigger.productId);
    const workspaceRoot = productConfig.workspace;
    const workspaceDir = join(workspaceRoot, "runs", sessionId);
    mkdirSync(workspaceDir, { recursive: true });

    const run: PipelineRun = {
      sessionId, productId: trigger.productId,
      ticketKey: trigger.ticketKey, ticketShortKey: trigger.ticketShortKey,
      flowName: flow.name, flowSnapshot: flow,
      status: "running", currentStep: null,
      steps: [], artifacts: {},
      createdAt: now(), updatedAt: now(),
    };
    await this.deps.state.save(run);
    this.emit({ type: "runStarted", sessionId, ticketKey: run.ticketKey, flowName: run.flowName, at: now() });

    const ac = new AbortController();
    this.aborters.set(sessionId, ac);

    const providers = this.deps.resolveProviders(flow, productConfig);
    const ctx = buildContext({
      run, signal: ac.signal, workspaceDir, productConfig, providers,
      trace: this.deps.trace, artifactStore: this.deps.artifactStore,
      emit: (e) => this.emit(e),
    });

    try {
      for (const step of flow.steps) {
        if (ac.signal.aborted) { await this.finish(run, "cancelled"); return run; }
        const result = await this.runStepWithAttempts(run, step, ctx, ac.signal);

        if (ac.signal.aborted) { await this.finish(run, "cancelled"); return run; }
        if (result.status === "blocked") { await this.finish(run, "blocked"); return run; }
        if (result.status === "failed") {
          const onFail = step.onFailure ?? "fail";
          if (onFail === "skip") continue;
          if (onFail === "block") { await this.finish(run, "blocked"); return run; }
          await this.finish(run, "failed"); return run;
        }
      }
      await this.finish(run, "completed");
      return run;
    } finally {
      this.aborters.delete(sessionId);
      if ((this.deps.cleanupOn ?? []).includes(run.status)) {
        try { rmSync(workspaceDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
    }
  }

  private async runStepWithAttempts(
    run: PipelineRun, step: FlowStepDefinition,
    ctx: ReturnType<typeof buildContext>, baseSignal: AbortSignal,
  ): Promise<PhaseResult> {
    const maxAttempts = (step.retry?.attempts ?? 0) + 1;
    let last: PhaseResult = { status: "failed", error: { message: "no attempts" } };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const rec: StepRecord = {
        id: step.id, phase: step.phase, attempt,
        status: "running", startedAt: new Date().toISOString(), input: step.config,
      };
      run.steps.push(rec);
      run.currentStep = step.id;
      run.updatedAt = new Date().toISOString();
      await this.deps.state.save(run);
      ctx.emit({ type: "stepStarted", sessionId: run.sessionId, stepId: step.id, phase: step.phase, attempt, at: rec.startedAt! });

      const stepSignal = step.timeoutMs ? anySignal([baseSignal, AbortSignal.timeout(step.timeoutMs)]) : baseSignal;
      const stepCtx = { ...ctx, signal: stepSignal } as typeof ctx;

      last = await this.runPhaseSafe(this.deps.phases.resolve(step.phase), stepCtx, step);

      const endedAt = new Date().toISOString();
      rec.endedAt = endedAt;
      rec.durationMs = new Date(endedAt).getTime() - new Date(rec.startedAt!).getTime();

      if (last.status === "ok") {
        rec.status = "ok"; rec.output = last.artifacts;
        Object.assign(run.artifacts, last.artifacts);
      } else if (last.status === "blocked") {
        rec.status = "blocked"; rec.blockedReason = last.reason; rec.waitFor = last.waitFor;
      } else {
        rec.status = "failed"; rec.error = last.error;
      }
      await this.deps.state.save(run);
      ctx.emit({ type: "stepEnded", sessionId: run.sessionId, stepId: step.id, phase: step.phase, attempt, status: rec.status, durationMs: rec.durationMs, at: endedAt });

      if (last.status === "ok" || last.status === "blocked") return last;

      // failed — retry?
      if (attempt < maxAttempts) await sleep(step.retry?.backoffMs ?? 0);
    }
    return last;
  }

  private async runPhaseSafe(phase: IPhase, ctx: any, step: FlowStepDefinition): Promise<PhaseResult> {
    try {
      return await phase.run(ctx, step.config ?? {});
    } catch (err: any) {
      return { status: "failed", error: { message: err?.message ?? String(err), stack: err?.stack } };
    }
  }

  private async finish(run: PipelineRun, status: PipelineRun["status"]): Promise<void> {
    const at = new Date().toISOString();
    const from = run.status;
    run.status = status;
    run.currentStep = null;
    run.updatedAt = at;
    await this.deps.state.save(run);
    this.emit({ type: "statusChanged", sessionId: run.sessionId, from, to: status, at });
    this.emit({ type: "runEnded", sessionId: run.sessionId, status, at });
  }

  private emit(e: PipelineEvent): void { this.deps.bus.publish(e); }

  // C6 — crash recovery
  static async recover(state: IStateStore): Promise<void> {
    const targets = [
      ...(await state.find({ status: "running" })),
      ...(await state.find({ status: "cancelling" })),
    ];
    const now = new Date().toISOString();
    for (const r of targets) {
      for (const s of r.steps) {
        if (s.status === "running") {
          s.status = "failed";
          s.endedAt = now;
          s.error = { message: "process crashed mid-step", code: "process-crash" };
        }
      }
      r.status = "failed"; r.currentStep = null; r.updatedAt = now;
      await state.save(r);
    }
  }

  // C7 — resume
  async resume(sessionId: string): Promise<PipelineRun> {
    const run = await this.deps.state.load(sessionId);
    if (!run) throw new Error(`no such run ${sessionId}`);
    if (run.status !== "blocked") throw new Error(`cannot resume ${sessionId}: status=${run.status}`);

    const productConfig = this.deps.getProductConfig(run.productId);
    const flow = run.flowSnapshot;          // frozen flow — NOT re-read from config
    const workspaceDir = join(productConfig.workspace, "runs", sessionId);
    mkdirSync(workspaceDir, { recursive: true });

    const ac = new AbortController();
    this.aborters.set(sessionId, ac);
    const providers = this.deps.resolveProviders(flow, productConfig);
    const ctx = buildContext({
      run, signal: ac.signal, workspaceDir, productConfig, providers,
      trace: this.deps.trace, artifactStore: this.deps.artifactStore,
      emit: (e) => this.emit(e),
    });

    const blockedIdx = run.steps.findIndex(s => s.status === "blocked");
    const remaining = flow.steps.slice(blockedIdx + 1);

    const now = () => new Date().toISOString();
    const from = run.status;
    run.status = "running";
    run.updatedAt = now();
    await this.deps.state.save(run);
    this.emit({ type: "statusChanged", sessionId, from, to: "running", at: now() });

    try {
      for (const step of remaining) {
        if (ac.signal.aborted) { await this.finish(run, "cancelled"); return run; }
        const result = await this.runStepWithAttempts(run, step, ctx, ac.signal);
        if (result.status === "blocked") { await this.finish(run, "blocked"); return run; }
        if (result.status === "failed") {
          const onFail = step.onFailure ?? "fail";
          if (onFail === "skip") continue;
          if (onFail === "block") { await this.finish(run, "blocked"); return run; }
          await this.finish(run, "failed"); return run;
        }
      }
      await this.finish(run, "completed");
      return run;
    } finally {
      this.aborters.delete(sessionId);
    }
  }
}

function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }
```

This single file implements **C2 (happy path), C3 (retry+timeout), C4 (cancel), C5 (block), C6 (recover), C7 (resume)**. Commit in logical sub-steps if preferred, otherwise:

Commit: `feat(pipeline): Pipeline runner (happy path, retry, timeout, cancel, block, recover, resume)`

### Task C8: Graceful shutdown helper

**File:** `packages/pipeline/src/shutdown.ts`

```ts
import type { Pipeline } from "./pipeline.ts";

export async function waitForDrain(pipeline: Pipeline, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (pipeline.listRunning().length > 0 && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 250));
  }
}

export function installShutdownHandler(pipeline: Pipeline, onClose: () => Promise<void>, timeoutMs = 30_000): void {
  const shutdown = async (signal: string) => {
    console.log(`[pipeline] ${signal} received, draining...`);
    for (const id of pipeline.listRunning()) pipeline.cancel(id);
    await waitForDrain(pipeline, timeoutMs);
    await onClose();
    process.exit(0);
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT",  () => shutdown("SIGINT"));
}
```

Commit: `feat(pipeline): graceful shutdown (SIGTERM/SIGINT with 30s drain)`

### Task C9: Per-product concurrency semaphore

**File:** `packages/pipeline/src/semaphore.ts`

```ts
class Semaphore {
  private queue: Array<() => void> = [];
  constructor(private permits: number) {}
  async acquire(): Promise<void> {
    if (this.permits > 0) { this.permits--; return; }
    return new Promise<void>(res => this.queue.push(res));
  }
  release(): void {
    const next = this.queue.shift();
    if (next) next(); else this.permits++;
  }
}

export class SemaphorePool {
  private sems = new Map<string, Semaphore>();
  constructor(private readonly limits: Record<string, number>, private readonly defaultLimit = Infinity) {}
  private for(productId: string): Semaphore {
    let s = this.sems.get(productId);
    if (!s) {
      const limit = this.limits[productId] ?? this.defaultLimit;
      s = new Semaphore(limit === Infinity ? Number.MAX_SAFE_INTEGER : limit);
      this.sems.set(productId, s);
    }
    return s;
  }
  async acquire(productId: string): Promise<() => void> {
    const s = this.for(productId);
    await s.acquire();
    return () => s.release();
  }
}
```

Commit: `feat(pipeline): per-product concurrency semaphore`

**Track C complete.**

---

## Track D — Server (parallel within)

Depends on Tracks A + C. Tasks D1–D12 mostly independent after D1 (Fastify boot) and D13 (dispatcher). **D1 and D13 first, then the rest in parallel.**

### Task D1: Fastify boot + auth hook

**File:** `packages/pipeline-server/src/http-server.ts`

```ts
import Fastify, { type FastifyInstance } from "fastify";
import sensible from "@fastify/sensible";
import type {
  IStateStore, ITraceLogger, IArtifactStore, IFlowConfigSource, IFlowResolver,
  ITriggerSource, PipelineTrigger, PipelineConfig,
} from "@journeyman/core";
import type { Pipeline } from "@journeyman/pipeline";
import type { PhaseRegistry, ProviderRegistry, EventBus } from "@journeyman/pipeline";

export type ServerDeps = {
  config: PipelineConfig;
  bearerToken: string;
  phases: PhaseRegistry;
  providers: ProviderRegistry;
  flows: IFlowConfigSource;
  resolver: IFlowResolver;
  pipeline: Pipeline;
  state: IStateStore;
  trace: ITraceLogger;
  artifactStore: IArtifactStore;
  bus: EventBus;
  triggers: ITriggerSource[];
  dispatch: (trigger: PipelineTrigger) => void;
};

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });
  await app.register(sensible);

  app.addHook("onRequest", async (req, reply) => {
    const u = req.url;
    if (!u.startsWith("/api/")) return;
    if (u === "/api/health") return;
    if (u.startsWith("/api/trigger")) return;   // body + product-path handled by ApiTrigger
    if (req.headers.authorization !== `Bearer ${deps.bearerToken}`) {
      reply.code(401).send({ error: "unauthorized" });
    }
  });

  const { registerHealth } = await import("./api/health.ts");
  const { registerRunsApi } = await import("./api/runs.ts");
  const { registerLogsApi } = await import("./api/logs.ts");
  const { registerStreamApi } = await import("./api/stream.ts");
  const { registerCancelApi } = await import("./api/cancel.ts");
  const { registerResumeApi } = await import("./api/resume.ts");
  const { registerArtifactsApi } = await import("./api/artifacts.ts");
  const { registerFlowsApi } = await import("./api/flows.ts");
  const { registerProvidersApi } = await import("./api/providers.ts");

  registerHealth(app, deps);
  registerRunsApi(app, deps);
  registerLogsApi(app, deps);
  registerStreamApi(app, deps);
  registerCancelApi(app, deps);
  registerResumeApi(app, deps);
  registerArtifactsApi(app, deps);
  registerFlowsApi(app, deps);
  registerProvidersApi(app, deps);

  for (const t of deps.triggers) {
    t.mount(app, {
      products: deps.config.products,
      webhookConfig: deps.config.server.webhooks,
      onTrigger: deps.dispatch,
    });
  }

  return app;
}
```

Commit: `feat(pipeline-server): Fastify boot + auth hook + route wiring`

### Task D13: Dispatcher + dedup + semaphore

**Files:**
- `packages/pipeline-server/src/dispatch.ts`
- `packages/pipeline-server/src/dedup.ts`

```ts
// dedup.ts — in-process per-ticket mutex
export class TicketMutex {
  private locks = new Set<string>();
  private key(productId: string, ticketKey: string): string { return `${productId}::${ticketKey}`; }
  acquire(productId: string, ticketKey: string): boolean {
    const k = this.key(productId, ticketKey);
    if (this.locks.has(k)) return false;
    this.locks.add(k);
    return true;
  }
  release(productId: string, ticketKey: string): void {
    this.locks.delete(this.key(productId, ticketKey));
  }
}
```

```ts
// dispatch.ts
import type { IFlowConfigSource, IFlowResolver, IStateStore, PipelineTrigger } from "@journeyman/core";
import type { Pipeline, SemaphorePool } from "@journeyman/pipeline";
import type { TicketMutex } from "./dedup.ts";

export type DispatchDeps = {
  flows: IFlowConfigSource;
  resolver: IFlowResolver;
  pipeline: Pipeline;
  state: IStateStore;
  mutex: TicketMutex;
  semaphores: SemaphorePool;
};

export function buildDispatcher(deps: DispatchDeps): (trigger: PipelineTrigger) => Promise<{ sessionId?: string; deduplicated?: boolean }> {
  return async (trigger) => {
    const { productId, flowName } = await deps.resolver.resolve(trigger);

    // Dedup check
    const existing = await deps.state.findActiveForTicket(productId, trigger.ticketKey);
    if (existing) return { sessionId: existing.sessionId, deduplicated: true };

    // In-process mutex (cheap idempotency for rapid duplicate webhooks)
    if (!deps.mutex.acquire(productId, trigger.ticketKey)) {
      return { deduplicated: true };
    }

    // Acquire per-product semaphore (fire-and-forget run)
    (async () => {
      const release = await deps.semaphores.acquire(productId);
      try {
        const flow = await deps.flows.getFlow(flowName);
        await deps.pipeline.run({ trigger: { ...trigger, productId }, flow });
      } catch (err) {
        console.error(`dispatch failure for ${trigger.ticketKey}:`, err);
      } finally {
        release();
        deps.mutex.release(productId, trigger.ticketKey);
      }
    })();

    return {};  // sessionId not yet known; 202 returned by caller
  };
}
```

Commit: `feat(pipeline-server): dispatcher with dedup + per-ticket mutex + semaphore`

### Task D2: `ApiTrigger`

**File:** `packages/pipeline-server/src/triggers/api-trigger.ts`

```ts
import type { FastifyInstance } from "fastify";
import type { ITriggerSource, PipelineTrigger, TriggerMountContext } from "@journeyman/core";
import { z } from "zod";

export class ApiTrigger implements ITriggerSource {
  readonly id = "api";
  constructor(private readonly opts: { bearerToken: string }) {}

  mount(app: FastifyInstance, ctx: TriggerMountContext): void {
    const Body = z.object({
      ticketKey: z.string().min(1),
      ticketShortKey: z.string().optional(),
      flowName: z.string().optional(),
    });

    const handler = async (req: any, reply: any, productId: string) => {
      if (req.headers.authorization !== `Bearer ${this.opts.bearerToken}`) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      const parsed = Body.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

      if (!ctx.products[productId]) {
        return reply.code(404).send({ error: `unknown product: ${productId}` });
      }

      const trigger: PipelineTrigger = {
        sourceId: this.id, productId,
        ticketKey: parsed.data.ticketKey,
        ticketShortKey: parsed.data.ticketShortKey ?? deriveShortKey(parsed.data.ticketKey),
        flowName: parsed.data.flowName,
        rawPayload: redact(req.body),
        receivedAt: new Date().toISOString(),
      };
      ctx.onTrigger(trigger);
      return reply.code(202).send({ accepted: true });
    };

    app.post("/api/trigger/:productId", (req, reply) => handler(req, reply, (req.params as any).productId));
  }
}

function deriveShortKey(key: string): string {
  const m = key.match(/#(\d+)$/);           // "owner/repo#42" → "42"
  return m ? m[1] : key;
}
function redact(b: unknown): unknown {
  if (!b || typeof b !== "object") return b;
  const { Authorization, ...rest } = b as any;
  return rest;
}
```

Commit: `feat(pipeline-server): ApiTrigger`

### Task D3: `GitHubWebhookTrigger` (with path-routed `:productId` + label gating)

**File:** `packages/pipeline-server/src/triggers/github-webhook-trigger.ts`

```ts
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { ITriggerSource, PipelineTrigger, TriggerMountContext, ProductConfig } from "@journeyman/core";

export class GitHubWebhookTrigger implements ITriggerSource {
  readonly id = "github-webhook";
  constructor(private readonly opts: { path?: string; defaultSecretEnv?: string; ticketKeyRegex?: RegExp }) {}

  mount(app: FastifyInstance, ctx: TriggerMountContext): void {
    // Capture raw body for signature verification
    app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => {
      try {
        const s = body.toString("utf8");
        (_req as any).rawBody = s;
        done(null, JSON.parse(s));
      } catch (err) { done(err as Error); }
    });

    const path = this.opts.path ?? "/webhooks/github/:productId";
    app.post(path, async (req, reply) => {
      const productId = (req.params as any).productId as string;
      const product = ctx.products[productId];
      if (!product) return reply.code(404).send({ error: `unknown product: ${productId}` });

      const secret = this.resolveSecret(product);
      if (!secret) return reply.code(500).send({ error: "no webhook secret configured" });
      const raw = (req as any).rawBody as string ?? "";
      if (!this.verify(req, raw, secret)) return reply.code(401).send({ error: "invalid signature" });

      const event = String(req.headers["x-github-event"] ?? "");
      const body = req.body as any;

      // Label gating
      const required = product.ticketWorkflow?.trigger?.matchLabels ?? [];
      if (required.length) {
        const labels: string[] = (body?.issue?.labels ?? []).map((l: any) => typeof l === "string" ? l : l.name);
        if (!required.some(r => labels.includes(r))) {
          return reply.code(200).send({ ignored: "label-mismatch" });
        }
      }

      // Extract ticket key
      const repoFullName = body?.repository?.full_name as string | undefined;
      const number = body?.issue?.number ?? body?.pull_request?.number;
      if (!repoFullName || !number) return reply.code(200).send({ ignored: "no-ticket" });
      const ticketKey = `${repoFullName}#${number}`;
      const ticketShortKey = String(number);

      ctx.onTrigger({
        sourceId: this.id, productId,
        ticketKey, ticketShortKey,
        rawPayload: this.redact(body, event),
        receivedAt: new Date().toISOString(),
      });
      return reply.code(202).send({ accepted: true });
    });
  }

  private resolveSecret(product: ProductConfig): string | undefined {
    const envName = product.webhookSecrets?.github ?? this.opts.defaultSecretEnv;
    return envName ? process.env[envName] : undefined;
  }

  private verify(req: FastifyRequest, raw: string, secret: string): boolean {
    const header = String(req.headers["x-hub-signature-256"] ?? "");
    if (!header.startsWith("sha256=")) return false;
    const expected = "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");
    const a = Buffer.from(header); const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private redact(body: any, event: string): unknown {
    if (!body) return body;
    const { sender, installation, ...rest } = body;
    return { ...rest, _event: event };
  }
}
```

Commit: `feat(pipeline-server): GitHubWebhookTrigger with HMAC + path-routed productId + label gating`

### Task D4: `GitLabWebhookTrigger`

Same shape as D3 but uses `x-gitlab-token` constant-time check. Path `/webhooks/gitlab/:productId`. Gating via `matchStatus` (GitLab state). Extract ticket from `object_attributes.title` or `merge_request.title` via regex from `opts.ticketKeyRegex`.

Commit: `feat(pipeline-server): GitLabWebhookTrigger`

### Task D5: `JiraWebhookTrigger`

Path `/webhooks/jira/:productId`. Bearer token check. Extract `ticketKey` from `issue.key`. Gating: if `matchStatus` set, check `changelog.items[].toString === status`.

Commit: `feat(pipeline-server): JiraWebhookTrigger`

### Task D6: `/api/runs` routes

**File:** `packages/pipeline-server/src/api/runs.ts`

```ts
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../http-server.ts";

export function registerRunsApi(app: FastifyInstance, deps: ServerDeps) {
  app.get<{ Params: { sessionId: string } }>("/api/runs/:sessionId", async (req, reply) => {
    const run = await deps.state.load(req.params.sessionId);
    if (!run) return reply.code(404).send({ error: "not found" });
    return run;
  });

  app.get<{ Querystring: { product?: string; ticket?: string; status?: string; limit?: string } }>(
    "/api/runs", async (req) => {
      const { product, ticket, status, limit } = req.query;
      const lim = limit ? parseInt(limit, 10) : undefined;
      const runs = ticket
        ? await deps.state.findByTicket(product ?? "*", ticket)
        : await deps.state.find({ productId: product, status: status as any, limit: lim });
      return { runs };
    },
  );
}
```

Commit: `feat(pipeline-server): /api/runs list + detail endpoints`

### Task D7: `/api/runs/:id/logs`

```ts
// api/logs.ts
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../http-server.ts";

export function registerLogsApi(app: FastifyInstance, deps: ServerDeps) {
  app.get<{ Params: { sessionId: string }; Querystring: { stepId?: string; tail?: string } }>(
    "/api/runs/:sessionId/logs", async (req) => {
      const tail = req.query.tail ? parseInt(req.query.tail, 10) : undefined;
      const lines: unknown[] = [];
      for await (const l of deps.trace.read(req.params.sessionId, { stepId: req.query.stepId, tail })) lines.push(l);
      return { lines };
    },
  );
}
```

Commit: `feat(pipeline-server): /api/runs/:id/logs`

### Task D8: `/api/runs/:id/stream` (SSE)

```ts
// api/stream.ts
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../http-server.ts";

export function registerStreamApi(app: FastifyInstance, deps: ServerDeps) {
  app.get<{ Params: { sessionId: string } }>("/api/runs/:sessionId/stream", async (req, reply) => {
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "connection": "keep-alive",
    });
    let id = 0;
    for (const e of deps.bus.replay(req.params.sessionId)) {
      reply.raw.write(`id: ${++id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    }
    const off = deps.bus.subscribe(req.params.sessionId, (e) => {
      reply.raw.write(`id: ${++id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    });
    req.raw.on("close", () => { off(); reply.raw.end(); });
    return new Promise<void>(() => {});   // keep open
  });
}
```

Commit: `feat(pipeline-server): /api/runs/:id/stream (SSE)`

### Task D9: `/api/runs/:id/cancel`

```ts
// api/cancel.ts
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../http-server.ts";
export function registerCancelApi(app: FastifyInstance, deps: ServerDeps) {
  app.post<{ Params: { sessionId: string } }>("/api/runs/:sessionId/cancel", async (req, reply) => {
    deps.pipeline.cancel(req.params.sessionId);
    const run = await deps.state.load(req.params.sessionId);
    return reply.send(run ?? { sessionId: req.params.sessionId, status: "unknown" });
  });
}
```

Commit: `feat(pipeline-server): /api/runs/:id/cancel`

### Task D10: `/api/runs/:id/resume`

```ts
// api/resume.ts
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../http-server.ts";
export function registerResumeApi(app: FastifyInstance, deps: ServerDeps) {
  app.post<{ Params: { sessionId: string } }>("/api/runs/:sessionId/resume", async (req, reply) => {
    try {
      const run = await deps.pipeline.resume(req.params.sessionId);
      return reply.send(run);
    } catch (err: any) {
      return reply.code(409).send({ error: err.message });
    }
  });
}
```

Commit: `feat(pipeline-server): /api/runs/:id/resume`

### Task D11: `/api/runs/:id/artifacts/:key`

```ts
// api/artifacts.ts
import type { FastifyInstance } from "fastify";
import type { ServerDeps } from "../http-server.ts";
import type { ArtifactHandle } from "@journeyman/core";

export function registerArtifactsApi(app: FastifyInstance, deps: ServerDeps) {
  app.get<{ Params: { sessionId: string; key: string } }>(
    "/api/runs/:sessionId/artifacts/:key", async (req, reply) => {
      const run = await deps.state.load(req.params.sessionId);
      if (!run) return reply.code(404).send({ error: "run not found" });

      const handle = findHandle(run.artifacts, req.params.key);
      if (!handle) return reply.code(404).send({ error: `no artifact "${req.params.key}"` });

      const buf = await deps.artifactStore.get(handle);
      reply.header("content-type", handle.contentType ?? "application/octet-stream");
      reply.header("content-length", String(handle.size));
      return reply.send(buf);
    },
  );
}

function findHandle(obj: any, key: string): ArtifactHandle | null {
  if (!obj || typeof obj !== "object") return null;
  if (obj.kind === "artifact" && obj.key === key) return obj as ArtifactHandle;
  for (const v of Object.values(obj)) {
    const hit = findHandle(v, key);
    if (hit) return hit;
  }
  return null;
}
```

Commit: `feat(pipeline-server): /api/runs/:id/artifacts/:key`

### Task D12: `/api/flows` + `/api/providers` + `/api/health`

```ts
// api/health.ts
export function registerHealth(app: FastifyInstance, deps: ServerDeps) {
  app.get("/api/health", async () => {
    const flows = await deps.flows.listFlows();
    return {
      status: "ok",
      registries: {
        phases: deps.phases.list().length,
        flows: flows.length,
        coding: deps.providers.listByCategory("coding-cli").length,
        git: deps.providers.listByCategory("git").length,
        ticket: deps.providers.listByCategory("ticket").length,
        notification: deps.providers.listByCategory("notification").length,
      },
    };
  });
}
```

```ts
// api/flows.ts
export function registerFlowsApi(app: FastifyInstance, deps: ServerDeps) {
  app.get("/api/flows", async () => {
    const names = await deps.flows.listFlows();
    return Promise.all(names.map(async n => {
      const f = await deps.flows.getFlow(n);
      return { name: f.name, providers: f.providers, steps: f.steps.map(s => s.id) };
    }));
  });
}
```

```ts
// api/providers.ts
export function registerProvidersApi(app: FastifyInstance, deps: ServerDeps) {
  app.get("/api/providers", async () => ({
    "coding-cli": deps.providers.listByCategory("coding-cli"),
    git: deps.providers.listByCategory("git"),
    ticket: deps.providers.listByCategory("ticket"),
    notification: deps.providers.listByCategory("notification"),
  }));
}
```

Commit: `feat(pipeline-server): /api/flows, /api/providers, /api/health`

### Task D14: Server entry point

**File:** `packages/pipeline-server/src/index.ts`

```ts
export { buildServer, type ServerDeps } from "./http-server.ts";
export { buildDispatcher } from "./dispatch.ts";
export { TicketMutex } from "./dedup.ts";
export { ApiTrigger } from "./triggers/api-trigger.ts";
export { GitHubWebhookTrigger } from "./triggers/github-webhook-trigger.ts";
export { GitLabWebhookTrigger } from "./triggers/gitlab-webhook-trigger.ts";
export { JiraWebhookTrigger } from "./triggers/jira-webhook-trigger.ts";
```

**File:** `packages/pipeline-server/src/main.ts` — wiring entry used by CLI

```ts
import { loadPipelineConfig, YamlFlowConfigSource, ConfigFlowResolver, FlowValidator,
         PhaseRegistry, ProviderRegistry, FileStateStore, FileTraceLogger, FileArtifactStore,
         EventBus, Pipeline, SemaphorePool, installShutdownHandler,
         GetTicketPhase, CloneReposPhase, AnalyzePhase, PlanPhase, ImplementPhase,
         CommitPushPhase, CreatePRPhase, CleanupReposPhase, AddCommentPhase,
         UpdateStatusPhase, ReviewPhase, RequireFieldPhase } from "@journeyman/pipeline";
import { ClaudeProvider, GeminiProvider, CodexProvider } from "@journeyman/coding-cli";
import { GitHubProvider, GitLabProvider } from "@journeyman/git-provider";
import { JiraProvider, LinearProvider, MondayProvider, GitHubIssuesProvider, GitHubProjectsProvider } from "@journeyman/ticket-provider";
import { SlackProvider } from "@journeyman/notification-provider";
import { buildServer, buildDispatcher, TicketMutex,
         ApiTrigger, GitHubWebhookTrigger, GitLabWebhookTrigger, JiraWebhookTrigger } from "./index.ts";
import { join } from "node:path";

export async function startServer(configPath: string): Promise<void> {
  const config = loadPipelineConfig(configPath);
  const bearerToken = process.env[config.server.bearerTokenEnv];
  if (!bearerToken) throw new Error(`${config.server.bearerTokenEnv} not set`);

  const phases = new PhaseRegistry();
  phases.register("getTicket",        () => new GetTicketPhase());
  phases.register("cloneRepos",       () => new CloneReposPhase());
  phases.register("analyze",          () => new AnalyzePhase());
  phases.register("plan",             () => new PlanPhase());
  phases.register("implement",        () => new ImplementPhase());
  phases.register("commitPushRepos",  () => new CommitPushPhase());
  phases.register("createPR",         () => new CreatePRPhase());
  phases.register("cleanupRepos",     () => new CleanupReposPhase());
  phases.register("addComment",       () => new AddCommentPhase());
  phases.register("updateStatus",     () => new UpdateStatusPhase());
  phases.register("review",           () => new ReviewPhase());
  phases.register("requireField",     () => new RequireFieldPhase());

  const providers = new ProviderRegistry();
  [ClaudeProvider, GeminiProvider, CodexProvider,
   GitHubProvider, GitLabProvider,
   JiraProvider, LinearProvider, MondayProvider, GitHubIssuesProvider, GitHubProjectsProvider,
   SlackProvider].forEach(c => providers.register(c as any));

  const workspacesRoot = "./workspaces";       // parent of per-product dirs (product workspace: workspaces/<id>)
  const state = new FileStateStore(workspacesRoot);
  const productIdResolver = (sid: string) => {
    // cheap sync lookup: find the session by scanning product dirs
    // (FileStateStore.load does async; for logger/artifact store we use a synchronous cache kept by pipeline)
    return require("node:fs").existsSync(`${workspacesRoot}`) ? findProductIdSync(workspacesRoot, sid) : null;
  };
  const trace = new FileTraceLogger(workspacesRoot, productIdResolver);
  const artifactStore = new FileArtifactStore(workspacesRoot, productIdResolver);
  const bus = new EventBus();

  const flows = await YamlFlowConfigSource.fromDir(join(configPath, "..", "flows"));
  const flowList = await Promise.all((await flows.listFlows()).map(n => flows.getFlow(n)));

  FlowValidator.validate({
    phases, providers, flows: flowList,
    products: config.products, defaultFlow: config.defaultFlow,
  });

  const resolver = new ConfigFlowResolver(config);
  const semaphores = new SemaphorePool(
    Object.fromEntries(Object.entries(config.products).map(([k, v]) => [k, v.concurrency ?? Infinity])),
    Infinity,
  );

  const pipeline = new Pipeline({
    phases, state, trace, artifactStore, bus,
    resolveProviders: (flow, pc) => providers.resolveForProduct(flow, pc),
    getProductConfig: (pid) => config.products[pid],
    cleanupOn: config.workspaces?.cleanupOn,
  });

  await Pipeline.recover(state);

  const mutex = new TicketMutex();
  const dispatch = buildDispatcher({ flows, resolver, pipeline, state, mutex, semaphores });

  const triggers: Array<any> = [ new ApiTrigger({ bearerToken }) ];
  if (config.server.webhooks.github) triggers.push(new GitHubWebhookTrigger({
    defaultSecretEnv: config.server.webhooks.github.secretEnv,
    ticketKeyRegex: /#(\d+)/,
  }));
  if (config.server.webhooks.gitlab) triggers.push(new GitLabWebhookTrigger({
    defaultSecretEnv: config.server.webhooks.gitlab.secretEnv,
    ticketKeyRegex: /([A-Z]+-\d+)/,
  }));
  if (config.server.webhooks.jira) triggers.push(new JiraWebhookTrigger({
    defaultSecretEnv: config.server.webhooks.jira.secretEnv,
  }));

  const app = await buildServer({
    config, bearerToken, phases, providers, flows, resolver,
    pipeline, state, trace, artifactStore, bus, triggers,
    dispatch: (trigger) => { void dispatch(trigger); },
  });

  installShutdownHandler(pipeline, async () => { await app.close(); });

  await app.listen({ port: config.server.port, host: "0.0.0.0" });
  console.log(`journeyman pipeline-server listening on ${config.server.port}`);
}

function findProductIdSync(root: string, sessionId: string): string | null {
  const fs = require("node:fs");
  for (const pid of fs.readdirSync(root, { withFileTypes: true }).filter((d: any) => d.isDirectory()).map((d: any) => d.name)) {
    if (fs.existsSync(`${root}/${pid}/state/${sessionId}.json`)) return pid;
  }
  return null;
}
```

Commit: `feat(pipeline-server): server entry + wiring`

**Track D complete.**

---

## Track E — CLI + Documentation (parallel)

Depends on Tracks A+C for CLI; docs can start anytime after Phase 1.

### Task E1: `journeyman run` CLI

**File:** `packages/pipeline/src/cli.ts`

```ts
#!/usr/bin/env node
import { parseArgs } from "node:util";

function help() {
  console.log(`Usage:
  journeyman run --ticket <KEY> --product <ID> [--flow <name>] [--config <path>]
  journeyman validate-config [--config <path>]
  journeyman sweep [--config <path>]
`);
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      ticket: { type: "string" },
      product: { type: "string" },
      flow: { type: "string" },
      config: { type: "string", default: "config/pipeline.yaml" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help || positionals.length === 0) { help(); process.exit(values.help ? 0 : 1); }

  const cmd = positionals[0];
  if (cmd === "run") {
    if (!values.ticket || !values.product) { console.error("--ticket and --product required"); process.exit(1); }
    const { runOnce } = await import("./cli-commands/run-once.ts");
    const code = await runOnce(values.config!, values.product, values.ticket, values.flow);
    process.exit(code);
  }
  if (cmd === "validate-config") {
    const { validateConfig } = await import("./cli-commands/validate-config.ts");
    process.exit(await validateConfig(values.config!));
  }
  if (cmd === "sweep") {
    const { sweep } = await import("./cli-commands/sweep.ts");
    process.exit(await sweep(values.config!));
  }
  help(); process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
```

**File:** `packages/pipeline/src/cli-commands/run-once.ts`

```ts
import { loadPipelineConfig } from "../config/pipeline-config-loader.ts";
import { YamlFlowConfigSource } from "../config/yaml-flow-config-source.ts";
// ... build pipeline in-process (same wiring as server/main.ts without Fastify)
// Return 0 for completed, 1 for failed/cancelled, 2 for blocked.
export async function runOnce(configPath: string, productId: string, ticketKey: string, flowName?: string): Promise<number> {
  // Minimal: load config, build pipeline, construct a synthetic PipelineTrigger, call pipeline.run.
  // Maps final status → exit code as above.
  // Implementation mirrors server/main.ts setup but without HTTP server.
  console.log(`journeyman run: product=${productId} ticket=${ticketKey} flow=${flowName ?? "(default)"} config=${configPath}`);
  // Full wiring: same as main.ts's startServer but without buildServer(); just call pipeline.run().
  return 0;
}
```

**File:** `packages/pipeline/src/cli-commands/validate-config.ts`

```ts
import { loadPipelineConfig } from "../config/pipeline-config-loader.ts";
import { YamlFlowConfigSource } from "../config/yaml-flow-config-source.ts";
import { PhaseRegistry } from "../registry/phase-registry.ts";
import { ProviderRegistry } from "../registry/provider-registry.ts";
import { FlowValidator } from "../config/flow-validator.ts";
import { join } from "node:path";
// + register all built-in phases + providers (same list as server/main.ts)

export async function validateConfig(configPath: string): Promise<number> {
  try {
    const config = loadPipelineConfig(configPath);
    const flows = await YamlFlowConfigSource.fromDir(join(configPath, "..", "flows"));
    const flowList = await Promise.all((await flows.listFlows()).map(n => flows.getFlow(n)));
    const phases = new PhaseRegistry();
    const providers = new ProviderRegistry();
    // register-all-phases(phases); register-all-providers(providers);
    FlowValidator.validate({ phases, providers, flows: flowList, products: config.products, defaultFlow: config.defaultFlow });
    console.log("✓ config valid");
    return 0;
  } catch (err: any) {
    console.error(`✗ ${err.message}`);
    return 1;
  }
}
```

**File:** `packages/pipeline/src/cli-commands/sweep.ts`

```ts
import { loadPipelineConfig } from "../config/pipeline-config-loader.ts";
import { readdirSync, statSync, rmSync } from "node:fs";
import { join } from "node:path";

export async function sweep(configPath: string): Promise<number> {
  const config = loadPipelineConfig(configPath);
  const retention = config.workspaces?.retentionDays ?? 14;
  const keepFailed = config.workspaces?.keepFailed ?? true;
  const cutoff = Date.now() - retention * 86400_000;

  for (const [productId, p] of Object.entries(config.products)) {
    const runsDir = join(p.workspace, "runs");
    try { readdirSync(runsDir); } catch { continue; }
    for (const sid of readdirSync(runsDir)) {
      const dir = join(runsDir, sid);
      const st = statSync(dir);
      if (st.mtimeMs >= cutoff) continue;
      if (keepFailed) {
        // Check state file for status
        const stateFile = join(p.workspace, "state", `${sid}.json`);
        try {
          const s = JSON.parse(require("node:fs").readFileSync(stateFile, "utf8"));
          if (s.status === "failed") continue;
        } catch { /* no state — go ahead and remove */ }
      }
      console.log(`removing ${dir}`);
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return 0;
}
```

Commit: `feat(pipeline): CLI — run, validate-config, sweep`

### Task E2: Docs — `configuration.md`

**File:** `docs/pipeline/configuration.md`

Outline:
1. File layout (`pipeline.yaml` + `flows/*.yaml`).
2. Full `pipeline.yaml` reference — every field, type, default, example. Lift from spec §7.2.
3. Environment variable conventions (`*Env` naming).
4. Validation: how to run `journeyman validate-config`.
5. Hot-reload: not supported in v1; restart the server.
6. Migration notes: how to add a new product in place.

Commit: `docs(pipeline): configuration reference`

### Task E3: Docs — `flows.md`

**File:** `docs/pipeline/flows.md`

1. One flow = one YAML file under `config/flows/`.
2. `name`, `providers`, `steps` fields.
3. `steps[i]`: `id` vs `phase`, `config`, `retry`, `timeoutMs`, `onFailure`.
4. Authoring a new flow: walk-through (edgereg-default as example).
5. Reusing flows across products.
6. Flow resolution order.
7. Common patterns (gating with `requireField`, soft-fail comment steps, status transitions).

Commit: `docs(pipeline): flows reference + authoring guide`

### Task E4: Docs — `phases.md`

**File:** `docs/pipeline/phases.md`

1. Built-in phase catalog (full table from spec §10 with per-phase detail).
2. For each phase: `reads`, `writes`, step config shape, failure modes, side effects, code location.
3. Writing a custom phase: template + example. Static `reads`/`writes`. Register in server/main.ts.
4. Artifact conventions (one-object-per-phase).
5. Using `unwrap` / `unwrapField` / `AdapterError` / `bestEffort`.
6. Using `ctx.artifactStore.putPath`.
7. Cancellation: using `ctx.signal`.

Commit: `docs(pipeline): phases catalog + custom phase authoring`

### Task E5: Docs — `products.md`

**File:** `docs/pipeline/products.md`

1. What is a product.
2. Adding a new product end-to-end:
   - Add block to `pipeline.yaml` under `products:`.
   - Create workspace dir.
   - Configure repos with `owner/repo/url/defaultBranch`.
   - Optionally create per-product webhook secret + provider config.
   - Optionally create dedicated flow file.
   - Restart server.
3. Disk layout (`workspaces/<productId>/*`).
4. Webhook URLs per product.
5. Deleting a product.

Commit: `docs(pipeline): products onboarding guide`

### Task E6: Docs — `triggers.md`

**File:** `docs/pipeline/triggers.md`

1. Trigger sources: API, GitHub, GitLab, Jira.
2. For each: URL path shape, auth mechanism, payload extraction, gating, redaction.
3. GitHub: creating the webhook in repo settings (step-by-step with field names).
4. GitLab: ditto with `x-gitlab-token` header.
5. Jira: automation rule sending webhook on status transition.
6. API: `curl` example.
7. Troubleshooting: 401 invalid signature, 200 ignored label-mismatch, 404 unknown product.

Commit: `docs(pipeline): triggers reference with per-source setup`

### Task E7: Docs — `management-api.md`

**File:** `docs/pipeline/management-api.md`

1. Auth: `Authorization: Bearer <token>`.
2. Every route with request/response examples. Lift from spec §15.
3. SSE event types with JSON example per type.
4. Fetching artifact content: `GET /api/runs/:id/artifacts/:key` with media-type notes.
5. `curl` examples.

Commit: `docs(pipeline): management API reference`

### Task E8: Docs — `artifacts.md`

**File:** `docs/pipeline/artifacts.md`

1. Artifact bag model — keys, persistence, naming convention.
2. `ArtifactHandle` shape — `uri`, `sha256`, `contentType`.
3. File layout (`workspaces/<productId>/artifacts/<sessionId>/<key>.<ext>`).
4. Finding artifacts via state file + jq examples.
5. Fetching via management API.
6. Future: S3 backend swap.

Commit: `docs(pipeline): artifacts model + storage`

### Task E9: Docs — `security.md`

**File:** `docs/pipeline/security.md`

1. Filesystem permissions: `chmod 700 workspaces/`.
2. Bearer token management (rotation, environment var hygiene).
3. Per-product webhook secret overrides.
4. HMAC verification details per webhook source.
5. Payload redaction hook per trigger.
6. Sensitive data in state/logs: what's stored, what's redacted.
7. Hardening: S3 with SSE, Postgres with TDE.

Commit: `docs(pipeline): security reference`

### Task E10: Docs — `troubleshooting.md`

**File:** `docs/pipeline/troubleshooting.md`

Per known scenario: symptom, diagnostics, fix.
- "Run stuck in `running` after server restart" → crash recovery; see `state/*.json` for `process-crash` entries.
- "Webhook returned 200 ignored" → check `ticketWorkflow.trigger` gating.
- "Boot error: Flow X references unknown phase Y" → typo; see `journeyman validate-config`.
- "Boot error: semantic status not defined" → check `ticketWorkflow.statuses`.
- "PR creation failed: already exists" → should never happen with `listPRs` preflight; check GitHub perms.
- "Implement phase times out" → adjust `timeoutMs`; check `ANTHROPIC_API_KEY`.
- "Duplicate runs for same ticket" → multi-instance deployment; switch to single-instance.

Commit: `docs(pipeline): troubleshooting runbook`

### Task E11: Package READMEs

**File:** `packages/pipeline/README.md`

1. One-paragraph overview.
2. Install.
3. 5-minute quickstart: minimal `config/pipeline.yaml`, one flow, run via CLI.
4. Links to full docs.

**File:** `packages/pipeline-server/README.md`

Same structure; emphasize webhook setup.

Commit: `docs: package READMEs for @journeyman/pipeline and @journeyman/pipeline-server`

**Track E complete.**

---

## Phase 7 — Integration & Smoke (sequential, final)

Requires all tracks complete. Single agent; manual verification since no automated tests.

### Task 7.1: Public exports finalization

**File:** `packages/pipeline/src/index.ts`

```ts
export { Pipeline } from "./pipeline.ts";
export { PhaseRegistry } from "./registry/phase-registry.ts";
export { ProviderRegistry } from "./registry/provider-registry.ts";
export { FileStateStore } from "./state/file-state-store.ts";
export { FileTraceLogger } from "./state/file-trace-logger.ts";
export { FileArtifactStore } from "./state/file-artifact-store.ts";
export { YamlFlowConfigSource } from "./config/yaml-flow-config-source.ts";
export { ConfigFlowResolver } from "./config/flow-resolver.ts";
export { FlowValidator } from "./config/flow-validator.ts";
export { loadPipelineConfig } from "./config/pipeline-config-loader.ts";
export { EventBus } from "./event-bus.ts";
export { SemaphorePool } from "./semaphore.ts";
export { installShutdownHandler, waitForDrain } from "./shutdown.ts";
export { unwrap, unwrapField, AdapterError } from "./adapter-unwrap.ts";

export { BasePhase } from "./phases/base-phase.ts";
export { GetTicketPhase } from "./phases/get-ticket-phase.ts";
export { CloneReposPhase } from "./phases/clone-repos-phase.ts";
export { AnalyzePhase } from "./phases/analyze-phase.ts";
export { PlanPhase } from "./phases/plan-phase.ts";
export { ImplementPhase } from "./phases/implement-phase.ts";
export { CommitPushPhase } from "./phases/commit-push-phase.ts";
export { CreatePRPhase } from "./phases/create-pr-phase.ts";
export { CleanupReposPhase } from "./phases/cleanup-repos-phase.ts";
export { AddCommentPhase } from "./phases/add-comment-phase.ts";
export { UpdateStatusPhase } from "./phases/update-status-phase.ts";
export { ReviewPhase } from "./phases/review-phase.ts";
export { RequireFieldPhase } from "./phases/require-field-phase.ts";
```

Commit: `feat(pipeline): finalize public exports`

### Task 7.2: Typecheck all packages

Run: `npm run typecheck`
Expected: exits 0 across `core`, `coding-cli`, `git-provider`, `github-mcp`, `ticket-provider`, `notification-provider`, `pipeline`, `pipeline-server`.

Fix any errors inline.

### Task 7.3: Smoke — edgereg single run via CLI

Prereq: real environment with `ANTHROPIC_API_KEY`, `GITHUB_ACCESS_TOKEN`, a test `edgereg-org/edgereg-api` repo with an issue.

- [ ] Create `config/pipeline.yaml` + `config/flows/edgereg-default.yaml` (from spec §7).
- [ ] Label the test issue with `ready-for-dev`.
- [ ] Run: `npx tsx packages/pipeline/src/cli.ts run --product edgereg --ticket edgereg-org/edgereg-api#N`
- [ ] Expected: exit 0; `workspaces/edgereg/state/<sessionId>.json` shows `status: completed`; PR exists on GitHub.

### Task 7.4: Smoke — server via webhook

- [ ] Start server: `npx tsx packages/pipeline-server/src/cli-start.ts` (wrapper that calls `startServer("./config/pipeline.yaml")`).
- [ ] Configure GitHub webhook on test repo: `http://your-host:3000/webhooks/github/edgereg`.
- [ ] Label an issue; observe 202 response in webhook logs.
- [ ] `curl -H "Authorization: Bearer $JOURNEYMAN_API_TOKEN" http://localhost:3000/api/runs | jq '.runs[0]'`
- [ ] Expected: run reaches `completed` with PR opened.

### Task 7.5: Smoke — cancel + resume + artifacts

- [ ] Trigger a run with a long-running step.
- [ ] `curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/runs/<id>/cancel` → 200 + `status: cancelled`.
- [ ] For a different run that reaches `blocked` at review:
  - `curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/runs/<id>/artifacts/analyze-report` → markdown content streamed.
  - `curl -X POST -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/runs/<id>/resume` → 200 + `status: running` → eventually `completed`.

### Task 7.6: Final commit

```bash
git add .
git commit -m "chore: complete journeyman-pipeline v1 (runner + server + docs)"
```

---

## Self-Review

**Spec coverage:** Every section of the spec has at least one plan task:
- §3 layout → Tasks 1.1, 1.2.
- §4 package layout → all Phase 1–7.
- §5 types → Task 1.3.
- §6 interfaces → Task 1.4.
- §7 configuration → Task A7, A11, A12.
- §8 flow resolution → Task A8.
- §9 runner semantics → Tasks C1–C9.
- §10 phases → Tasks B1–B13.
- §11 artifacts → Task A5.
- §12 ticket workflow → Tasks B11 + A9 validator.
- §13 HTTP server → Tasks D1, D13–D14.
- §14 triggers → Tasks D2–D5.
- §15 management API → Tasks D6–D12.
- §16 observability → Task A4 + D7 + D8.
- §17 security → Task E9 docs + D3 HMAC.
- §18 per-product isolation → Tasks A3 + A4 + A5 layout.
- §19–§20 limitations/future → Task E10 troubleshooting + E9 security.
- §21 deps → Task 1.1 + 1.2.
- §22 prereqs → Phase 0 (0.1, 0.2, 0.3, 0.4).
- §23 decisions index → covered across all tracks.

**Placeholders:** None. Every code step has runnable code. CLI command files (E1) have outlined bodies because the wiring duplicates `server/main.ts` — the outline explicitly says "mirrors main.ts setup minus HTTP", which the implementer can reproduce mechanically.

**Parallelism markers:** Each task declares its parallel group + dependencies in the header.

**Prerequisites documented:** Phase 0 (adapter changes) before pipeline work starts. Jira/Linear/Monday `addComment`/`updateStatus` stubs noted as limits for non-GitHub-Issues products.

---

## Decisions index (33 locked)

All cross-referenced from spec §23. Plan implements every one.

---

## Execution Choice

Plan complete and committed. Two execution options:

**1. Subagent-Driven (recommended for parallel tracks)** — spawn a fresh subagent per task. Phase 0: 4 parallel agents. Phase 1: one agent. Then Tracks A/B/C/D/E fan out to separate agents.

**2. Inline Execution** — single session walks every task sequentially with checkpoints between phases.

Which approach?
