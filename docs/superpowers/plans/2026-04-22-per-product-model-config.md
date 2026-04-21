# Per-Product Model Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow any coding-CLI provider to be instantiated with a per-phase model config so different products/flows can use different models.

**Architecture:** `CodingCLIProviderConfig` (with `defaultModel` + per-phase `models` map) is defined in `@journeyman/core` and accepted by each provider's constructor. Providers resolve the model via a `resolveModel(phase)` helper and forward it into `query()` options. No breaking changes — if model is undefined the SDK default is used.

**Tech Stack:** TypeScript, `@anthropic-ai/claude-agent-sdk` (`query()`), npm workspaces monorepo.

---

## Parallel Execution Groups

Run **Group 1** tasks in parallel (different files, no deps).
Run **Group 1b** (schema regen) after Group 1 completes — pipeline-schema.ts must be updated first.
Run **Group 2** tasks in parallel after Group 1 completes (all touch different files).
Run **Task 11** last (typecheck).

---

## Group 1 — Core Types + Pipeline Schema (run all in parallel)

### Task 1: Add CodingCLIPhase, CodingCLIProviderConfig, and model? to AI opts

**Files:**
- Modify: `packages/core/src/types/coding.types.ts`

- [ ] **Step 1: Add CodingCLIPhase and CodingCLIProviderConfig at the top of coding.types.ts (after the import line)**

Insert after line 1 (`import type { SessionOptions, SessionResult }...`):

```typescript
// ---------------------------------------------------------------------------
// Provider config — shared across all coding-CLI providers
// ---------------------------------------------------------------------------

export type CodingCLIPhase =
  | "scanRepos"
  | "checkoutRepo"
  | "commitPushRepos"
  | "cleanupRepos"
  | "createWorkspace"
  | "analyze"
  | "plan"
  | "implement";

export interface CodingCLIProviderConfig {
  /** Fallback model for any phase not listed in `models`. */
  defaultModel?: string;
  /** Per-phase model overrides. Takes precedence over defaultModel. */
  models?: Partial<Record<CodingCLIPhase, string>>;
}
```

- [ ] **Step 2: Add `model?: string` to AnalyzeOptions**

Change `AnalyzeOptions` (currently lines 3-10) from:

```typescript
export type AnalyzeOptions = SessionOptions & {
  dirPath: string;
  ticketContent?: string;
  focus?: string;
  /** Optional — reviewer feedback (markdown) to incorporate into analysis. */
  reviewComments?: string;
  signal?: AbortSignal;
};
```

To:

```typescript
export type AnalyzeOptions = SessionOptions & {
  dirPath: string;
  ticketContent?: string;
  focus?: string;
  /** Optional — reviewer feedback (markdown) to incorporate into analysis. */
  reviewComments?: string;
  signal?: AbortSignal;
  model?: string;
};
```

- [ ] **Step 3: Add `model?: string` to PlanOptions**

Change `PlanOptions` (currently lines 52-63) from:

```typescript
export type PlanOptions = SessionOptions & {
  dirPath: string;
  /** Optional — ticket / goal text. If omitted, the plan is derived purely from the analyze report. */
  ticketContent?: string;
  /** Optional — explicit path to a prior analyze report (markdown). If omitted, the latest report in docs/analyze is used. */
  analyzeReportPath?: string;
  /** Optional narrowing of scope. */
  focus?: string;
  /** Optional — reviewer feedback (markdown) to incorporate into the plan. */
  reviewComments?: string;
  signal?: AbortSignal;
};
```

To:

```typescript
export type PlanOptions = SessionOptions & {
  dirPath: string;
  /** Optional — ticket / goal text. If omitted, the plan is derived purely from the analyze report. */
  ticketContent?: string;
  /** Optional — explicit path to a prior analyze report (markdown). If omitted, the latest report in docs/analyze is used. */
  analyzeReportPath?: string;
  /** Optional narrowing of scope. */
  focus?: string;
  /** Optional — reviewer feedback (markdown) to incorporate into the plan. */
  reviewComments?: string;
  signal?: AbortSignal;
  model?: string;
};
```

- [ ] **Step 4: Add `model?: string` to ImplementOptions**

Change `ImplementOptions` (currently lines 104-119) from:

```typescript
export type ImplementOptions = SessionOptions & {
  dirPath: string;
  /** Optional — ticket / goal text. */
  ticketContent?: string;
  /** Optional — explicit path to a prior analyze report (markdown). If omitted, the latest file in docs/analyze is used. */
  analyzeReportPath?: string;
  /** Optional — explicit path to a prior plan report (markdown). If omitted, the latest file in docs/plan is used. */
  planReportPath?: string;
  /** Optional — additional rules / constraints layered on top of the defaults. */
  extraRules?: string[];
  /** Optional narrowing of scope. */
  focus?: string;
  /** Optional — reviewer feedback (markdown) to incorporate during implementation. */
  reviewComments?: string;
  signal?: AbortSignal;
};
```

To:

```typescript
export type ImplementOptions = SessionOptions & {
  dirPath: string;
  /** Optional — ticket / goal text. */
  ticketContent?: string;
  /** Optional — explicit path to a prior analyze report (markdown). If omitted, the latest file in docs/analyze is used. */
  analyzeReportPath?: string;
  /** Optional — explicit path to a prior plan report (markdown). If omitted, the latest file in docs/plan is used. */
  planReportPath?: string;
  /** Optional — additional rules / constraints layered on top of the defaults. */
  extraRules?: string[];
  /** Optional narrowing of scope. */
  focus?: string;
  /** Optional — reviewer feedback (markdown) to incorporate during implementation. */
  reviewComments?: string;
  signal?: AbortSignal;
  model?: string;
};
```

---

### Task 2: Add model? to git opts types

**Files:**
- Modify: `packages/core/src/types/git.types.ts`

- [ ] **Step 1: Add `model?: string` to ScanReposOptions (line 30)**

Change:

```typescript
export type ScanReposOptions = SessionOptions & {
  parentDir: string;
  signal?: AbortSignal;
};
```

To:

```typescript
export type ScanReposOptions = SessionOptions & {
  parentDir: string;
  signal?: AbortSignal;
  model?: string;
};
```

- [ ] **Step 2: Add `model?: string` to CheckoutRepoOptions (line 48)**

Change:

```typescript
export type CheckoutRepoOptions = SessionOptions & {
  repos: string | string[] | CheckoutEntry | CheckoutEntry[];
  branch?: string;
  ticket?: { id: string; title: string };
  signal?: AbortSignal;
};
```

To:

```typescript
export type CheckoutRepoOptions = SessionOptions & {
  repos: string | string[] | CheckoutEntry | CheckoutEntry[];
  branch?: string;
  ticket?: { id: string; title: string };
  signal?: AbortSignal;
  model?: string;
};
```

- [ ] **Step 3: Add `model?: string` to CleanupReposOptions (line 74)**

Change:

```typescript
export type CleanupReposOptions = SessionOptions & {
  repos: string | string[] | CleanupEntry | CleanupEntry[];
  signal?: AbortSignal;
};
```

To:

```typescript
export type CleanupReposOptions = SessionOptions & {
  repos: string | string[] | CleanupEntry | CleanupEntry[];
  signal?: AbortSignal;
  model?: string;
};
```

- [ ] **Step 4: Add `model?: string` to CreateWorkspaceOptions (line 91)**

Change:

```typescript
export type CreateWorkspaceOptions = SessionOptions & {
  ticketId: string;
  parentDir: string;
  signal?: AbortSignal;
};
```

To:

```typescript
export type CreateWorkspaceOptions = SessionOptions & {
  ticketId: string;
  parentDir: string;
  signal?: AbortSignal;
  model?: string;
};
```

- [ ] **Step 5: Add `model?: string` to CommitPushReposOptions (line 166)**

Change:

```typescript
export type CommitPushReposOptions = SessionOptions & {
  repos: string | string[] | CommitPushEntry | CommitPushEntry[];
  ticket?: string;
  pattern?: string;
  prSummaryStyle?: "brief" | "detailed";
  signal?: AbortSignal;
};
```

To:

```typescript
export type CommitPushReposOptions = SessionOptions & {
  repos: string | string[] | CommitPushEntry | CommitPushEntry[];
  ticket?: string;
  pattern?: string;
  prSummaryStyle?: "brief" | "detailed";
  signal?: AbortSignal;
  model?: string;
};
```

---

## Group 2 — Providers & Operations (run all in parallel after Group 1)

### Task 3: Update ClaudeProvider — constructor, resolveModel, wire all 8 methods

**Files:**
- Modify: `packages/coding-cli/src/providers/claude/index.ts`

- [ ] **Step 1: Replace the full file content**

Replace the entire file with:

```typescript
import type { ICodingCLI } from "../../interface.ts";
import type {
  ScanReposOptions, ScanReposResult,
  CheckoutRepoOptions, CheckoutRepoResult,
  CommitPushReposOptions, CommitPushReposResult,
  CleanupReposOptions, CleanupReposResult,
  CreateWorkspaceOptions, CreateWorkspaceResult,
  IProviderMeta,
  CodingCLIPhase,
  CodingCLIProviderConfig,
} from "@journeyman/core";
import type { AnalyzeOptions, AnalyzeResult, PlanOptions, PlanResult, ImplementOptions, ImplementResult } from "@journeyman/core";
import { scanRepos } from "./operations/scan-repos.ts";
import { checkoutRepo } from "./operations/checkout-repo.ts";
import { commitPushRepos } from "./operations/commit-push-repos.ts";
import { cleanupRepos } from "./operations/cleanup-repos.ts";
import { createWorkspace } from "./operations/create-workspace.ts";
import { analyze } from "./operations/analyze.ts";
import { plan } from "./operations/plan.ts";
import { implement } from "./operations/implement.ts";

export class ClaudeProvider implements ICodingCLI {
  static meta: IProviderMeta = {
    id: "claude",
    name: "Claude Code CLI",
    description: "AI coding via @anthropic-ai/claude-agent-sdk",
    category: "coding-cli",
  };

  constructor(private config: CodingCLIProviderConfig = {}) {}

  private resolveModel(phase: CodingCLIPhase): string | undefined {
    return this.config.models?.[phase] ?? this.config.defaultModel;
  }

  scanRepos(opts: ScanReposOptions): Promise<ScanReposResult> {
    return scanRepos({ ...opts, model: this.resolveModel("scanRepos") });
  }

  checkoutRepo(opts: CheckoutRepoOptions): Promise<CheckoutRepoResult> {
    return checkoutRepo({ ...opts, model: this.resolveModel("checkoutRepo") });
  }

  commitPushRepos(opts: CommitPushReposOptions): Promise<CommitPushReposResult> {
    return commitPushRepos({ ...opts, model: this.resolveModel("commitPushRepos") });
  }

  cleanupRepos(opts: CleanupReposOptions): Promise<CleanupReposResult> {
    return cleanupRepos({ ...opts, model: this.resolveModel("cleanupRepos") });
  }

  createWorkspace(opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> {
    return createWorkspace({ ...opts, model: this.resolveModel("createWorkspace") });
  }

  analyze(opts: AnalyzeOptions): Promise<AnalyzeResult> {
    return analyze({ ...opts, model: this.resolveModel("analyze") });
  }

  plan(opts: PlanOptions): Promise<PlanResult> {
    return plan({ ...opts, model: this.resolveModel("plan") });
  }

  implement(opts: ImplementOptions): Promise<ImplementResult> {
    return implement({ ...opts, model: this.resolveModel("implement") });
  }
}
```

---

### Task 4: Forward model in Claude AI operations (analyze, plan, implement)

**Files:**
- Modify: `packages/coding-cli/src/providers/claude/operations/analyze.ts`
- Modify: `packages/coding-cli/src/providers/claude/operations/plan.ts`
- Modify: `packages/coding-cli/src/providers/claude/operations/implement.ts`

- [ ] **Step 1: Add model forwarding to analyze.ts query() call**

In `analyze.ts`, find the `query({` block (around line 200). Change the options block from:

```typescript
    options: {
      tools: ["Bash", "Read", "Glob", "Grep", "Write"],
      allowedTools: ["Bash", "Read", "Glob", "Grep", "Write"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 40,
      settingSources: [],
      settings: { allowedMcpServers: [] },
      outputFormat: { type: "json_schema", schema: OUTPUT_SCHEMA },
      ...(controller !== undefined ? { abortController: controller } : {}),
      ...queryOption,
    },
```

To:

```typescript
    options: {
      tools: ["Bash", "Read", "Glob", "Grep", "Write"],
      allowedTools: ["Bash", "Read", "Glob", "Grep", "Write"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 40,
      settingSources: [],
      settings: { allowedMcpServers: [] },
      outputFormat: { type: "json_schema", schema: OUTPUT_SCHEMA },
      ...(opts.model ? { model: opts.model } : {}),
      ...(controller !== undefined ? { abortController: controller } : {}),
      ...queryOption,
    },
```

- [ ] **Step 2: Add model forwarding to plan.ts query() call**

In `plan.ts`, find the `query({` block (around line 200). Apply the same change — add `...(opts.model ? { model: opts.model } : {}),` before `...(controller !== undefined ...`:

```typescript
    options: {
      tools: ["Bash", "Read", "Glob", "Grep", "Write"],
      allowedTools: ["Bash", "Read", "Glob", "Grep", "Write"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 60,
      settingSources: [],
      settings: { allowedMcpServers: [] },
      outputFormat: { type: "json_schema", schema: OUTPUT_SCHEMA },
      ...(opts.model ? { model: opts.model } : {}),
      ...(controller !== undefined ? { abortController: controller } : {}),
      ...queryOption,
    },
```

- [ ] **Step 3: Add model forwarding to implement.ts query() call**

In `implement.ts`, find the `query({` block (around line 209). Apply the same change:

```typescript
    options: {
      tools: ["Bash", "Read", "Glob", "Grep", "Write", "Edit"],
      allowedTools: ["Bash", "Read", "Glob", "Grep", "Write", "Edit"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 120,
      settingSources: [],
      settings: { allowedMcpServers: [] },
      outputFormat: { type: "json_schema", schema: OUTPUT_SCHEMA },
      ...(opts.model ? { model: opts.model } : {}),
      ...(controller !== undefined ? { abortController: controller } : {}),
      ...queryOption,
    },
```

---

### Task 5: Forward model in Claude git operations that call query()

**Files:**
- Modify: `packages/coding-cli/src/providers/claude/operations/scan-repos.ts`
- Modify: `packages/coding-cli/src/providers/claude/operations/checkout-repo.ts`
- Modify: `packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts`

- [ ] **Step 1: Add model forwarding to scan-repos.ts query() call**

In `scan-repos.ts`, find the `query({` block (around line 71). Change the options block from:

```typescript
    options: {
      tools: ["Bash"],
      allowedTools: ["Bash"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 10,
      settingSources: [],
      settings: { allowedMcpServers: [] },
      outputFormat: { type: "json_schema", schema: OUTPUT_SCHEMA },
      ...(controller !== undefined ? { abortController: controller } : {}),
      ...queryOption,
    },
```

To:

```typescript
    options: {
      tools: ["Bash"],
      allowedTools: ["Bash"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 10,
      settingSources: [],
      settings: { allowedMcpServers: [] },
      outputFormat: { type: "json_schema", schema: OUTPUT_SCHEMA },
      ...(opts.model ? { model: opts.model } : {}),
      ...(controller !== undefined ? { abortController: controller } : {}),
      ...queryOption,
    },
```

- [ ] **Step 2: Add model forwarding to checkout-repo.ts query() call**

In `checkout-repo.ts`, find the `query({` block (around line 138). Add `...(opts.model ? { model: opts.model } : {}),` before the `abortController` spread:

```typescript
    options: {
      tools: ["Bash"],
      allowedTools: ["Bash"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 40,
      settingSources: [],
      settings: { allowedMcpServers: [] },
      outputFormat: { type: "json_schema", schema: OUTPUT_SCHEMA },
      ...(opts.model ? { model: opts.model } : {}),
      ...(controller !== undefined ? { abortController: controller } : {}),
      ...queryOption,
    },
```

- [ ] **Step 3: Add model forwarding to commit-push-repos.ts query() call**

In `commit-push-repos.ts`, find the `query({` block (around line 210). Add `...(opts.model ? { model: opts.model } : {}),` before the `abortController` spread:

```typescript
    options: {
      tools: ["Bash"],
      allowedTools: ["Bash"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 40,
      settingSources: [],
      settings: { allowedMcpServers: [] },
      outputFormat: { type: "json_schema", schema: OUTPUT_SCHEMA },
      ...(opts.model ? { model: opts.model } : {}),
      ...(controller !== undefined ? { abortController: controller } : {}),
      ...queryOption,
    },
```

---

### Task 6: Update GeminiProvider — add constructor and resolveModel

**Files:**
- Modify: `packages/coding-cli/src/providers/gemini/index.ts`

- [ ] **Step 1: Replace the full file content**

```typescript
import type { ICodingCLI } from "../../interface.ts";
import type {
  ScanReposOptions, ScanReposResult,
  CheckoutRepoOptions, CheckoutRepoResult,
  CommitPushReposOptions, CommitPushReposResult,
  CleanupReposOptions, CleanupReposResult,
  CreateWorkspaceOptions, CreateWorkspaceResult,
  AnalyzeOptions, AnalyzeResult,
  PlanOptions, PlanResult,
  ImplementOptions, ImplementResult,
  IProviderMeta,
  CodingCLIProviderConfig,
} from "@journeyman/core";

/** Gemini coding CLI provider. Not yet implemented. */
export class GeminiProvider implements ICodingCLI {
  static meta: IProviderMeta = {
    id: "gemini",
    name: "Gemini CLI",
    description: "Google Gemini coding CLI",
    category: "coding-cli",
  };

  constructor(private _config: CodingCLIProviderConfig = {}) {}

  scanRepos(_opts: ScanReposOptions): Promise<ScanReposResult> { throw new Error("GeminiProvider.scanRepos not implemented"); }
  checkoutRepo(_opts: CheckoutRepoOptions): Promise<CheckoutRepoResult> { throw new Error("GeminiProvider.checkoutRepo not implemented"); }
  commitPushRepos(_opts: CommitPushReposOptions): Promise<CommitPushReposResult> { throw new Error("GeminiProvider.commitPushRepos not implemented"); }
  cleanupRepos(_opts: CleanupReposOptions): Promise<CleanupReposResult> { throw new Error("GeminiProvider.cleanupRepos not implemented"); }
  createWorkspace(_opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> { throw new Error("GeminiProvider.createWorkspace not implemented"); }
  analyze(_opts: AnalyzeOptions): Promise<AnalyzeResult> { throw new Error("GeminiProvider.analyze not implemented"); }
  plan(_opts: PlanOptions): Promise<PlanResult> { throw new Error("GeminiProvider.plan not implemented"); }
  implement(_opts: ImplementOptions): Promise<ImplementResult> { throw new Error("GeminiProvider.implement not implemented"); }
}
```

---

### Task 7: Update CodexProvider — add constructor and resolveModel

**Files:**
- Modify: `packages/coding-cli/src/providers/codex/index.ts`

- [ ] **Step 1: Read the current file, then replace its full content**

Read the file first to get the current method list, then replace the full file with the same stub methods plus a constructor. The structure mirrors GeminiProvider exactly. Replace the full file with:

```typescript
import type { ICodingCLI } from "../../interface.ts";
import type {
  ScanReposOptions, ScanReposResult,
  CheckoutRepoOptions, CheckoutRepoResult,
  CommitPushReposOptions, CommitPushReposResult,
  CleanupReposOptions, CleanupReposResult,
  CreateWorkspaceOptions, CreateWorkspaceResult,
  AnalyzeOptions, AnalyzeResult,
  PlanOptions, PlanResult,
  ImplementOptions, ImplementResult,
  IProviderMeta,
  CodingCLIProviderConfig,
} from "@journeyman/core";

/** Codex coding CLI provider. Not yet implemented. */
export class CodexProvider implements ICodingCLI {
  static meta: IProviderMeta = {
    id: "codex",
    name: "Codex CLI",
    description: "OpenAI Codex coding CLI",
    category: "coding-cli",
  };

  constructor(private _config: CodingCLIProviderConfig = {}) {}

  scanRepos(_opts: ScanReposOptions): Promise<ScanReposResult> { throw new Error("CodexProvider.scanRepos not implemented"); }
  checkoutRepo(_opts: CheckoutRepoOptions): Promise<CheckoutRepoResult> { throw new Error("CodexProvider.checkoutRepo not implemented"); }
  commitPushRepos(_opts: CommitPushReposOptions): Promise<CommitPushReposResult> { throw new Error("CodexProvider.commitPushRepos not implemented"); }
  cleanupRepos(_opts: CleanupReposOptions): Promise<CleanupReposResult> { throw new Error("CodexProvider.cleanupRepos not implemented"); }
  createWorkspace(_opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> { throw new Error("CodexProvider.createWorkspace not implemented"); }
  analyze(_opts: AnalyzeOptions): Promise<AnalyzeResult> { throw new Error("CodexProvider.analyze not implemented"); }
  plan(_opts: PlanOptions): Promise<PlanResult> { throw new Error("CodexProvider.plan not implemented"); }
  implement(_opts: ImplementOptions): Promise<ImplementResult> { throw new Error("CodexProvider.implement not implemented"); }
}
```

> Note: verify the `static meta` id/name/description match what is currently in the file before replacing.

---

### Task 8: Update OpenCodeProvider — add CodingCLIProviderConfig support

**Files:**
- Modify: `packages/coding-cli/src/providers/opencode/index.ts`

OpenCodeProvider already has a constructor with its own required `OpenCodeProviderConfig`. Add `CodingCLIProviderConfig` as an optional second parameter so the provider can also accept generic model config.

- [ ] **Step 1: Add CodingCLIProviderConfig import**

In `packages/coding-cli/src/providers/opencode/index.ts`, add `CodingCLIProviderConfig` to the `@journeyman/core` import block:

```typescript
import type {
  ScanReposOptions, ScanReposResult,
  CheckoutRepoOptions, CheckoutRepoResult,
  CommitPushReposOptions, CommitPushReposResult,
  CleanupReposOptions, CleanupReposResult,
  CreateWorkspaceOptions, CreateWorkspaceResult,
  AnalyzeOptions, AnalyzeResult,
  PlanOptions, PlanResult,
  ImplementOptions, ImplementResult,
  ICodingCLI, IProviderMeta,
  CodingCLIPhase,
  CodingCLIProviderConfig,
} from "@journeyman/core";
```

- [ ] **Step 2: Update the constructor to accept CodingCLIProviderConfig as optional second param**

Change:

```typescript
  constructor(config: OpenCodeProviderConfig) {
```

To:

```typescript
  constructor(config: OpenCodeProviderConfig, private _providerConfig: CodingCLIProviderConfig = {}) {
```

- [ ] **Step 3: Add resolveModel helper after the constructor**

Add this private method inside `OpenCodeProvider` after the constructor:

```typescript
  private resolveModel(phase: CodingCLIPhase): string | undefined {
    return this._providerConfig.models?.[phase] ?? this._providerConfig.defaultModel;
  }
```

---

---

## Group 1 (continued) — Pipeline Schema

### Task 9: Update pipeline Zod schema to include model config fields

**Files:**
- Modify: `packages/pipeline/src/config/pipeline-schema.ts`

The `providerConfig.coding` field is currently `z.record(z.unknown()).optional()`. Tighten it to include `defaultModel` and `models` alongside a passthrough for other provider-specific fields (like OpenCode's `mode`, `model`, `mcp`).

- [ ] **Step 1: Replace the `coding` field inside `providerConfig` in pipeline-schema.ts**

Find this block (around line 34):

```typescript
      coding: z.record(z.unknown()).optional(),
```

Replace with:

```typescript
      coding: z.object({
        defaultModel: z.string().optional(),
        models: z.object({
          scanRepos: z.string().optional(),
          checkoutRepo: z.string().optional(),
          commitPushRepos: z.string().optional(),
          cleanupRepos: z.string().optional(),
          createWorkspace: z.string().optional(),
          analyze: z.string().optional(),
          plan: z.string().optional(),
          implement: z.string().optional(),
        }).optional(),
      }).catchall(z.unknown()).optional(),
```

> `.catchall(z.unknown())` preserves passthrough for OpenCode-specific fields (`mode`, `model`, `mcp`, `permission`, etc.) that live alongside the generic model config.

---

## Group 1b — JSON Schema Regen (after Task 9 completes)

### Task 10: Regenerate JSON schemas

**Files:**
- Regenerate: `config/schemas/pipeline.schema.json`
- Regenerate: `config/schemas/flow.schema.json`

- [ ] **Step 1: Run the schema generation command**

```bash
npm run generate:schemas
```

Expected: `config/schemas/pipeline.schema.json` is updated to include `defaultModel` and `models` fields under `providerConfig.coding`. No errors.

---

## Group 2 (continued) — Documentation

### Task 11 (parallel with Tasks 3-8): Update docs/providers.md

**Files:**
- Modify: `docs/providers.md`

- [ ] **Step 1: Update the `claude` provider section**

Find the `### \`claude\` — ClaudeProvider` section. Replace:

```markdown
Runs Claude as an in-process agent via `@anthropic-ai/claude-agent-sdk`. No `providerConfig` fields are required — the SDK reads credentials from the environment.

```yaml
providers:
  coding: claude

providerConfig:
  coding: {}   # no options needed
```

**Environment variables:**

| Variable | Purpose | Required |
|----------|---------|----------|
| `ANTHROPIC_API_KEY` | Anthropic API key | Only in server/Docker/CI environments where `claude login` has not been run |

**Notes:**
- In local development, `claude login` stores credentials — no env var needed.
- In CI/Docker/server, set `ANTHROPIC_API_KEY`.
- Model is fixed to whichever Claude model the SDK targets by default.
```

With:

```markdown
Runs Claude as an in-process agent via `@anthropic-ai/claude-agent-sdk`. No credentials config is required — the SDK reads them from the environment. Optionally configure which model to use per phase.

```yaml
providers:
  coding: claude

providerConfig:
  coding:
    defaultModel: claude-sonnet-4-6     # fallback for all phases
    models:
      analyze: claude-opus-4-7          # override for a specific phase
      implement: claude-haiku-4-5       # override for a specific phase
      # plan, scanRepos, etc. → use defaultModel
```

All `models` fields are optional. If omitted, the Claude Agent SDK uses its own default model.

**Environment variables:**

| Variable | Purpose | Required |
|----------|---------|----------|
| `ANTHROPIC_API_KEY` | Anthropic API key | Only in server/Docker/CI environments where `claude login` has not been run |

**Notes:**
- In local development, `claude login` stores credentials — no env var needed.
- In CI/Docker/server, set `ANTHROPIC_API_KEY`.
- `defaultModel` applies to any phase not listed in `models`.
- Both fields are optional — omitting them uses the SDK default model.
```

---

### Task 12 (parallel with Tasks 3-8): Update docs/configuration.md

**Files:**
- Modify: `docs/configuration.md`

- [ ] **Step 1: Find the `providerConfig` section in configuration.md and add a model config example**

Locate the `providerConfig` block documentation. Add a new subsection after the existing coding provider config examples:

```markdown
### Per-Phase Model Configuration (coding providers)

All coding providers (`claude`, `opencode`, `gemini`, `codex`) accept optional `defaultModel` and `models` fields. These let different products use different models for each phase of the AI pipeline.

```yaml
providerConfig:
  coding:
    defaultModel: claude-sonnet-4-6   # used for any phase not listed below
    models:
      analyze: claude-opus-4-7        # high-quality analysis
      plan: claude-sonnet-4-6         # balanced planning
      implement: claude-haiku-4-5     # fast implementation
      # git phases (scanRepos, checkoutRepo, etc.) → defaultModel
```

**Resolution order:** `models.<phase>` → `defaultModel` → SDK default.

Different products can use different configs by instantiating separate provider instances:

```yaml
# pipeline.yaml
products:
  product-a:
    providerConfig:
      coding:
        defaultModel: claude-opus-4-7   # quality-first product
  product-b:
    providerConfig:
      coding:
        defaultModel: claude-haiku-4-5  # speed-first product
        models:
          analyze: claude-sonnet-4-6    # but still use sonnet for analysis
```
```

---

## Task 13: Typecheck (after all Group 2 tasks complete)

**Files:** None modified — verification only.

- [ ] **Step 1: Run typecheck across all packages**

```bash
npm run typecheck
```

Expected: zero errors. If errors appear, fix them in the relevant files and re-run before proceeding.
