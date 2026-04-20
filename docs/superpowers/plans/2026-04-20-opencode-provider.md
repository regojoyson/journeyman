# OpenCode Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `OpenCodeProvider` to `@journeyman/coding-cli` as a fully-implemented `ICodingCLI` provider backed by the OpenCode SDK, supporting managed (SDK-spawned daemon) and external (already-running daemon) modes with configurable model, MCP servers, and tool permissions.

**Architecture:** Mirror the exact file structure of `ClaudeProvider` — one file per operation under `operations/`, shared `client.ts` for daemon lifecycle, and a thin `index.ts` class. `cleanupRepos` and `createWorkspace` are pure Node.js (no AI SDK) and are identical to the Claude implementations. All other operations call `client.session.prompt()` with the same prompts used by Claude, replacing the `for await (query(...))` loop with a single `await` call.

**Tech Stack:** `@opencode-ai/sdk` (OpenCode HTTP client + daemon spawner), `@journeyman/core` (types, logger), TypeScript ESM, Node.js built-in `assert` for tests.

---

## File Map

| File | Action | Notes |
|------|--------|-------|
| `packages/coding-cli/package.json` | Modify | Add `@opencode-ai/sdk` dependency |
| `packages/coding-cli/src/providers/opencode/types.ts` | Create | `OpenCodeProviderConfig`, `OpenCodeMode` |
| `packages/coding-cli/src/providers/opencode/client.ts` | Create | `getClient()` factory: managed vs external |
| `packages/coding-cli/src/providers/opencode/client.test.ts` | Create | Unit test for client factory |
| `packages/coding-cli/src/providers/opencode/utils/sdk-logger.ts` | Create | `logSessionEvent()` |
| `packages/coding-cli/src/providers/opencode/operations/cleanup-repos.ts` | Create | Copy of Claude version (pure Node.js) |
| `packages/coding-cli/src/providers/opencode/operations/create-workspace.ts` | Create | Copy of Claude version (pure Node.js) |
| `packages/coding-cli/src/providers/opencode/operations/scan-repos.ts` | Create | OpenCode SDK + Bash |
| `packages/coding-cli/src/providers/opencode/operations/checkout-repo.ts` | Create | OpenCode SDK + Bash |
| `packages/coding-cli/src/providers/opencode/operations/commit-push-repos.ts` | Create | OpenCode SDK + Bash |
| `packages/coding-cli/src/providers/opencode/operations/analyze.ts` | Create | OpenCode SDK + multi-tool |
| `packages/coding-cli/src/providers/opencode/operations/plan.ts` | Create | OpenCode SDK + multi-tool |
| `packages/coding-cli/src/providers/opencode/operations/implement.ts` | Create | OpenCode SDK + multi-tool |
| `packages/coding-cli/src/providers/opencode/index.ts` | Create | `OpenCodeProvider` class |
| `packages/coding-cli/src/index.ts` | Modify | Add `OpenCodeProvider` export |
| `packages/pipeline/src/cli-commands/run-once.ts` | Modify | Register `OpenCodeProvider` |

**Not changed:** `@journeyman/core`, all pipeline phases, `sweep.ts`, git/ticket/notification providers.

---

## Task 1: Add SDK dependency

**Files:**
- Modify: `packages/coding-cli/package.json`

- [ ] **Step 1: Add `@opencode-ai/sdk` to dependencies**

Edit `packages/coding-cli/package.json`. Add to the `"dependencies"` block:

```json
{
  "name": "@journeyman/coding-cli",
  "version": "0.1.0",
  "description": "AI coding CLI providers — Claude, Gemini, Codex. Analyze, plan, implement, and run git operations.",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "files": ["src"],
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@journeyman/core": "*",
    "@opencode-ai/sdk": "latest"
  },
  "peerDependencies": {
    "@anthropic-ai/claude-agent-sdk": ">=0.2.0"
  },
  "devDependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.112",
    "@types/node": "^25.6.0",
    "typescript": "^6.0.3"
  }
}
```

- [ ] **Step 2: Install**

```bash
npm install
```

Expected: resolves `@opencode-ai/sdk` and creates/updates `package-lock.json`.

- [ ] **Step 3: Verify SDK types are importable**

```bash
node -e "import('@opencode-ai/sdk').then(m => console.log(Object.keys(m)))"
```

Expected: prints exported names including `createOpencode` and `createOpencodeClient`.

- [ ] **Step 4: Commit**

```bash
git add packages/coding-cli/package.json package-lock.json
git commit -m "chore(coding-cli): add @opencode-ai/sdk dependency"
```

---

## Task 2: Types file

**Files:**
- Create: `packages/coding-cli/src/providers/opencode/types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// packages/coding-cli/src/providers/opencode/types.ts

export type McpLocalConfig = {
  type: "local"
  command: Array<string>
  environment?: Record<string, string>
  enabled?: boolean
  timeout?: number
}

export type McpRemoteConfig = {
  type: "remote"
  url: string
  enabled?: boolean
  headers?: Record<string, string>
  timeout?: number
}

export type OpenCodePermission = {
  bash?: "ask" | "allow" | "deny"
  edit?: "ask" | "allow" | "deny"
  webfetch?: "ask" | "allow" | "deny"
}

export type OpenCodeMode =
  | { mode: "managed"; hostname?: string; port?: number; timeout?: number }
  | { mode: "external"; baseUrl?: string }

export type OpenCodeProviderConfig = OpenCodeMode & {
  model: { providerID: string; modelID: string }
  mcp?: Record<string, McpLocalConfig | McpRemoteConfig>
  tools?: Record<string, boolean>
  permission?: OpenCodePermission
}
```

> **Note on MCP types:** We define `McpLocalConfig`/`McpRemoteConfig` locally rather than importing from `@opencode-ai/sdk` to avoid a hard coupling to the SDK's internal type names. If the SDK exports these types directly, you may import them instead.

- [ ] **Step 2: Verify TypeScript is happy**

```bash
cd packages/coding-cli && npx tsc --noEmit
```

Expected: no errors on the new file.

- [ ] **Step 3: Commit**

```bash
git add packages/coding-cli/src/providers/opencode/types.ts
git commit -m "feat(opencode): add OpenCodeProviderConfig types"
```

---

## Task 3: Client factory

**Files:**
- Create: `packages/coding-cli/src/providers/opencode/client.ts`
- Create: `packages/coding-cli/src/providers/opencode/client.test.ts`

The client factory handles the two daemon modes. In `external` mode it calls `createOpencodeClient({ baseUrl })`. In `managed` mode it calls `createOpencode({ ... })` which spawns a child process.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/coding-cli/src/providers/opencode/client.test.ts
import assert from "node:assert/strict";
import { getClient } from "./client.ts";

// Test external mode — does not actually start a daemon, just creates HTTP client
{
  const client = await getClient({
    mode: "external",
    baseUrl: "http://localhost:4096",
    model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
  });
  assert.ok(client, "client should be returned for external mode");
  assert.ok(typeof client.session === "object", "client should have session namespace");
}

// Test external mode with default baseUrl
{
  const client = await getClient({
    mode: "external",
    model: { providerID: "openai", modelID: "gpt-4o" },
  });
  assert.ok(client, "client should be returned with default baseUrl");
}

console.log("getClient: all assertions passed");
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/coding-cli && npx tsx src/providers/opencode/client.test.ts
```

Expected: error — `client.ts` does not exist yet.

- [ ] **Step 3: Create the client factory**

```typescript
// packages/coding-cli/src/providers/opencode/client.ts
import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk";
import type { OpenCodeProviderConfig } from "./types.ts";

const DEFAULT_PERMISSION = { bash: "allow", edit: "allow", webfetch: "allow" } as const;

export type OpenCodeClient = Awaited<ReturnType<typeof createOpencodeClient>>;

export async function getClient(config: OpenCodeProviderConfig): Promise<OpenCodeClient> {
  const permission = { ...DEFAULT_PERMISSION, ...config.permission };

  if (config.mode === "managed") {
    const { client } = await createOpencode({
      hostname: config.hostname,
      port: config.port,
      timeout: config.timeout,
      config: {
        permission,
        tools: config.tools,
        mcp: config.mcp,
      },
    });
    return client;
  }

  return createOpencodeClient({
    baseUrl: config.baseUrl ?? "http://localhost:4096",
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd packages/coding-cli && npx tsx src/providers/opencode/client.test.ts
```

Expected: `getClient: all assertions passed`

- [ ] **Step 5: Typecheck**

```bash
cd packages/coding-cli && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/coding-cli/src/providers/opencode/client.ts \
        packages/coding-cli/src/providers/opencode/client.test.ts
git commit -m "feat(opencode): add getClient factory (managed + external modes)"
```

---

## Task 4: Logger utility

**Files:**
- Create: `packages/coding-cli/src/providers/opencode/utils/sdk-logger.ts`

- [ ] **Step 1: Create the logger**

```typescript
// packages/coding-cli/src/providers/opencode/utils/sdk-logger.ts
import type { Logger } from "@journeyman/core";

export function logSessionEvent(
  log: Logger,
  sessionId: string,
  info: { error?: unknown; structured_output?: unknown; [k: string]: unknown },
): void {
  log.debug({
    sessionId,
    hasError: !!info.error,
    hasStructuredOutput: !!info.structured_output,
  }, "opencode session result");
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/coding-cli && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/coding-cli/src/providers/opencode/utils/sdk-logger.ts
git commit -m "feat(opencode): add logSessionEvent utility"
```

---

## Task 5: Pure Node.js operations (cleanupRepos + createWorkspace)

**Files:**
- Create: `packages/coding-cli/src/providers/opencode/operations/cleanup-repos.ts`
- Create: `packages/coding-cli/src/providers/opencode/operations/create-workspace.ts`

These two operations use no AI SDK — they are pure Node.js `rm`/`mkdir`. The implementations are identical to the Claude versions except for the logger namespace.

- [ ] **Step 1: Create cleanup-repos.ts**

```typescript
// packages/coding-cli/src/providers/opencode/operations/cleanup-repos.ts
import { rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { createLogger } from "@journeyman/core";
import type {
  CleanupEntry,
  CleanupReposOptions,
  CleanupReposResult,
  CleanupRepoResult,
} from "@journeyman/core";

const log = createLogger("opencode:cleanup-repos");

function normalizeEntries(opts: CleanupReposOptions): CleanupEntry[] {
  const raw = Array.isArray(opts.repos) ? opts.repos : [opts.repos];
  return raw.map((r) => (typeof r === "string" ? { dirPath: r } : r));
}

function unsafeReason(absPath: string): string | null {
  if (!absPath) return "empty path";
  if (absPath === "/") return "refusing to delete filesystem root";
  if (absPath === process.env.HOME) return "refusing to delete user home";
  if (absPath === process.cwd()) return "refusing to delete current working directory";
  return null;
}

async function cleanupOne(entry: CleanupEntry): Promise<CleanupRepoResult> {
  const absPath = resolve(entry.dirPath);
  const folderName = basename(absPath);
  const refusal = unsafeReason(absPath);
  if (refusal) {
    log.warn({ dirPath: absPath, reason: refusal }, "cleanup refused — unsafe path");
    return { folderName, dirPath: absPath, success: false, error: refusal };
  }
  try {
    await rm(absPath, { recursive: true, force: true });
    log.debug({ dirPath: absPath }, "cleanup removed");
    return { folderName, dirPath: absPath, success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ dirPath: absPath, err: message }, "cleanup failed");
    return { folderName, dirPath: absPath, success: false, error: message };
  }
}

export async function cleanupRepos(opts: CleanupReposOptions): Promise<CleanupReposResult> {
  const entries = normalizeEntries(opts);
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  log.info({ sessionId, repoCount: entries.length }, "cleanupRepos start");
  const repos = await Promise.all(entries.map(cleanupOne));
  log.info({
    sessionId,
    successCount: repos.filter((r) => r.success).length,
    failureCount: repos.filter((r) => !r.success).length,
  }, "cleanupRepos done");
  return { repos, sessionId };
}
```

- [ ] **Step 2: Create create-workspace.ts**

```typescript
// packages/coding-cli/src/providers/opencode/operations/create-workspace.ts
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { createLogger } from "@journeyman/core";
import type { CreateWorkspaceOptions, CreateWorkspaceResult } from "@journeyman/core";

const log = createLogger("opencode:create-workspace");

function buildTimestamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 19).replace(/:/g, "-") + "Z";
}

export async function createWorkspace(opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> {
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  log.info({ sessionId, ticketId: opts.ticketId, parentDir: opts.parentDir }, "createWorkspace start");

  if (!opts.ticketId) {
    log.error({ sessionId }, "createWorkspace missing ticketId");
    return { folderName: "", dirPath: "", error: "ticketId is required", sessionId };
  }
  if (!opts.parentDir) {
    log.error({ sessionId }, "createWorkspace missing parentDir");
    return { folderName: "", dirPath: "", error: "parentDir is required", sessionId };
  }

  const folderName = `${opts.ticketId}-${buildTimestamp()}`;
  const dirPath = resolve(opts.parentDir, folderName);

  try {
    await mkdir(dirPath, { recursive: true });
    log.info({ sessionId, dirPath }, "createWorkspace done");
    return { folderName, dirPath, sessionId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ sessionId, dirPath, err: message }, "createWorkspace failed");
    return { folderName, dirPath, error: message, sessionId };
  }
}
```

- [ ] **Step 3: Typecheck**

```bash
cd packages/coding-cli && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/coding-cli/src/providers/opencode/operations/cleanup-repos.ts \
        packages/coding-cli/src/providers/opencode/operations/create-workspace.ts
git commit -m "feat(opencode): add cleanupRepos and createWorkspace operations"
```

---

## Task 6: scan-repos operation

**Files:**
- Create: `packages/coding-cli/src/providers/opencode/operations/scan-repos.ts`

This calls the OpenCode daemon via `client.session.prompt()`. The prompt is identical to the Claude version.

- [ ] **Step 1: Create scan-repos.ts**

```typescript
// packages/coding-cli/src/providers/opencode/operations/scan-repos.ts
import { createLogger } from "@journeyman/core";
import { logSessionEvent } from "../utils/sdk-logger.ts";
import type { OpenCodeClient } from "../client.ts";
import type { OpenCodeProviderConfig } from "../types.ts";
import type { ScanReposOptions, ScanReposResult } from "@journeyman/core";

const log = createLogger("opencode:scan-repos");

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    repos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          folderName: { type: "string" },
          dirPath: { type: "string" },
          url: { type: "string" },
          branch: { type: "string" },
          isGitRepo: { type: "boolean" },
        },
        required: ["folderName", "dirPath", "isGitRepo"],
      },
    },
    error: { type: "string" },
  },
  required: ["repos"],
} as const;

function buildPrompt(parentDir: string): string {
  return [
    `List all immediate subdirectories of: ${parentDir}`,
    "For each subdirectory:",
    "  1. Check if it is a git repo (look for a .git folder inside it)",
    "  2. If it is, get its remote origin URL via: git -C <dirPath> remote get-url origin",
    "  3. If it is, get its current branch via: git -C <dirPath> branch --show-current",
    "Return JSON with a repos array containing folderName, dirPath, isGitRepo, and url and branch (only if it is a git repo).",
  ].join("\n");
}

export async function scanRepos(
  client: OpenCodeClient,
  config: OpenCodeProviderConfig,
  opts: ScanReposOptions,
): Promise<ScanReposResult> {
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  const EMPTY: ScanReposResult = { repos: [], sessionId };
  log.info({ sessionId, parentDir: opts.parentDir }, "scanRepos start");

  const session = await client.session.create({ body: { title: "scanRepos" } });
  const sid = session.data.id;

  const result = await client.session.prompt({
    path: { id: sid },
    body: {
      parts: [{ type: "text", text: buildPrompt(opts.parentDir) }],
      model: config.model,
      tools: config.tools,
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
  });

  const info = result.data.info;
  logSessionEvent(log, sessionId, info);

  if (info.error) {
    const error = typeof info.error === "string" ? info.error : JSON.stringify(info.error);
    log.error({ sessionId, error }, "scanRepos failed");
    return { ...EMPTY, error };
  }
  if (!info.structured_output) return EMPTY;

  const output = { ...(info.structured_output as ScanReposResult), sessionId };
  log.info({
    sessionId,
    repoCount: output.repos.length,
    gitRepoCount: output.repos.filter((r) => r.isGitRepo).length,
  }, "scanRepos done");
  return output;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/coding-cli && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/coding-cli/src/providers/opencode/operations/scan-repos.ts
git commit -m "feat(opencode): add scanRepos operation"
```

---

## Task 7: checkout-repo operation

**Files:**
- Create: `packages/coding-cli/src/providers/opencode/operations/checkout-repo.ts`

- [ ] **Step 1: Create checkout-repo.ts**

```typescript
// packages/coding-cli/src/providers/opencode/operations/checkout-repo.ts
import { createLogger } from "@journeyman/core";
import { logSessionEvent } from "../utils/sdk-logger.ts";
import type { OpenCodeClient } from "../client.ts";
import type { OpenCodeProviderConfig } from "../types.ts";
import type { CheckoutEntry, CheckoutRepoOptions, CheckoutRepoResult } from "@journeyman/core";

const log = createLogger("opencode:checkout-repo");

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    newBranch: { type: "string" },
    repos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          folderName: { type: "string" },
          dirPath: { type: "string" },
          baseBranch: { type: "string" },
          newBranch: { type: "string" },
          success: { type: "boolean" },
          error: { type: "string" },
        },
        required: ["folderName", "dirPath", "baseBranch", "newBranch", "success"],
      },
    },
    error: { type: "string" },
  },
  required: ["newBranch", "repos"],
} as const;

function normalizeEntries(opts: CheckoutRepoOptions): CheckoutEntry[] {
  const raw = Array.isArray(opts.repos) ? opts.repos : [opts.repos];
  return raw.map((r) =>
    typeof r === "string" ? { dirPath: r, branch: opts.branch ?? "main" } : r,
  );
}

function buildPrompt(entries: CheckoutEntry[], ticket: CheckoutRepoOptions["ticket"]): string {
  const steps = entries
    .map(({ dirPath, branch }) => `  - ${dirPath} → baseBranch: ${branch}`)
    .join("\n");

  const namingRule = ticket
    ? [
        "BRANCH NAMING (ticket provided):",
        `  Format: "{id-lowercased}/{2-4-word-slug}_{unix-seconds}"`,
        `  Ticket id: ${ticket.id}`,
        `  Ticket title: ${ticket.title}`,
        `  Slug: lowercase ASCII, hyphen-separated, 2-4 meaningful words from the title`,
        `         (strip stopwords like "the", "a", "an", "on", "for", "to", "of", "and").`,
        `  Example: id "EV-12345", title "Fix header alignment bug on checkout page"`,
        `           → "ev-12345/fix-header-alignment_1713542400"`,
      ].join("\n")
    : [
        "BRANCH NAMING (no ticket):",
        `  Format: "{animal-themed-slug}_{unix-seconds}"`,
        `  Slug: lowercase ASCII, hyphen-separated, 2-3 words containing one animal name`,
        `         (e.g. "curious-otter-sprint", "swift-falcon-work").`,
      ].join("\n");

  return [
    "You will sync local repos to origin, then create ONE new feature branch used across all repos.",
    "",
    namingRule,
    "",
    "  - Before touching any repo, run `date +%s` ONCE to get the current unix-seconds timestamp.",
    "  - Use that single timestamp value in the branch name for ALL repos. Do NOT re-run `date` inside the per-repo loop.",
    "  - The EXACT same branch name must be used for every repo.",
    "",
    "PER-REPO STEPS (run in order for each repo):",
    "  1. git -C <dirPath> fetch origin",
    "  2. git -C <dirPath> stash --include-untracked   (discard local changes)",
    "  3. git -C <dirPath> checkout <baseBranch>",
    "  4. git -C <dirPath> pull origin <baseBranch>",
    "  5. git -C <dirPath> reset --hard origin/<baseBranch>",
    "  6. git -C <dirPath> clean -fd",
    "  7. git -C <dirPath> checkout -b <newBranch>",
    "",
    "Repos:",
    steps,
    "",
    "Return JSON with:",
    "  - newBranch (top-level): the generated branch name used for all repos",
    "  - repos[]: { folderName, dirPath, baseBranch, newBranch, success, error? }",
    "  - error (top-level, optional): set only if everything failed before per-repo work started",
    "Capture per-repo errors in repos[].error and set success=false for that repo.",
  ].join("\n");
}

export async function checkoutRepo(
  client: OpenCodeClient,
  config: OpenCodeProviderConfig,
  opts: CheckoutRepoOptions,
): Promise<CheckoutRepoResult> {
  const entries = normalizeEntries(opts);
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  const EMPTY: CheckoutRepoResult = { repos: [], newBranch: "", sessionId };
  log.info({ sessionId, repoCount: entries.length, ticketId: opts.ticket?.id }, "checkoutRepo start");

  if (entries.length === 0) {
    log.warn({ sessionId }, "checkoutRepo called with no repos");
    return EMPTY;
  }

  const session = await client.session.create({ body: { title: "checkoutRepo" } });
  const sid = session.data.id;

  const result = await client.session.prompt({
    path: { id: sid },
    body: {
      parts: [{ type: "text", text: buildPrompt(entries, opts.ticket) }],
      model: config.model,
      tools: config.tools,
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
  });

  const info = result.data.info;
  logSessionEvent(log, sessionId, info);

  if (info.error) {
    const error = typeof info.error === "string" ? info.error : JSON.stringify(info.error);
    log.error({ sessionId, error }, "checkoutRepo failed");
    return { ...EMPTY, error };
  }
  if (!info.structured_output) return EMPTY;

  const output = { ...(info.structured_output as CheckoutRepoResult), sessionId };
  log.info({
    sessionId,
    newBranch: output.newBranch,
    successCount: output.repos.filter((r) => r.success).length,
    failureCount: output.repos.filter((r) => !r.success).length,
  }, "checkoutRepo done");
  return output;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/coding-cli && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/coding-cli/src/providers/opencode/operations/checkout-repo.ts
git commit -m "feat(opencode): add checkoutRepo operation"
```

---

## Task 8: commit-push-repos operation

**Files:**
- Create: `packages/coding-cli/src/providers/opencode/operations/commit-push-repos.ts`

- [ ] **Step 1: Create commit-push-repos.ts**

```typescript
// packages/coding-cli/src/providers/opencode/operations/commit-push-repos.ts
import { createLogger } from "@journeyman/core";
import { logSessionEvent } from "../utils/sdk-logger.ts";
import type { OpenCodeClient } from "../client.ts";
import type { OpenCodeProviderConfig } from "../types.ts";
import type { CommitPushEntry, CommitPushReposOptions, CommitPushReposResult } from "@journeyman/core";

const log = createLogger("opencode:commit-push-repos");

const DEFAULT_PATTERN = "{ticket} : {summary}";

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    repos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          folderName: { type: "string" },
          dirPath: { type: "string" },
          branch: { type: "string" },
          commitSha: { type: "string" },
          commitMessage: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          filesChanged: { type: "array", items: { type: "string" } },
          pushed: { type: "boolean" },
          remoteUrl: { type: "string" },
          error: { type: "string" },
        },
        required: ["folderName", "dirPath", "branch", "commitSha", "commitMessage", "title", "description", "filesChanged", "pushed"],
      },
    },
    error: { type: "string" },
  },
  required: ["repos"],
} as const;

type NormalizedEntry = { dirPath: string; ticket?: string; message?: string };

function normalizeEntries(opts: CommitPushReposOptions): NormalizedEntry[] {
  const raw = Array.isArray(opts.repos) ? opts.repos : [opts.repos];
  return raw.map((r) => {
    if (typeof r === "string") return { dirPath: r, ticket: opts.ticket };
    return { dirPath: r.dirPath, ticket: r.ticket ?? opts.ticket, message: r.message };
  });
}

function buildPrompt(entries: NormalizedEntry[], pattern: string, prSummaryStyle: "brief" | "detailed"): string {
  const entriesJson = JSON.stringify(entries, null, 2);
  return [
    "For each repo entry below, run these git steps using the Bash tool.",
    "Keep going for all repos even if some fail — record errors per repo.",
    "",
    `Entries:\n${entriesJson}`,
    "",
    `Commit message pattern: ${JSON.stringify(pattern)}`,
    "Tokens: {ticket} (from entry.ticket), {summary} (you generate it from the diff).",
    "If entry.ticket is absent and the pattern contains {ticket}, drop the ticket",
    'portion cleanly (no leading/trailing " : " or "{ticket}" literal).',
    "If entry.message is set, use it verbatim and skip {summary} generation.",
    "",
    `PR description style: ${prSummaryStyle}`,
    "",
    "Per repo, execute in order:",
    "1. `git -C <dirPath> status --porcelain`. If output is empty, record a",
    "   full result object with all required fields populated, using empty",
    "   strings/arrays for fields that would be derived from the missing changes:",
    '   { folderName: <basename(dirPath)>, dirPath: <dirPath>, branch: "",',
    '     commitSha: "", commitMessage: "", title: "", description: "",',
    '     filesChanged: [], pushed: false, error: "no changes" }',
    "   Then skip remaining steps for this repo.",
    "2. `git -C <dirPath> rev-parse --abbrev-ref HEAD` → branch.",
    "   If branch is 'HEAD' (detached HEAD state), stop processing this repo and",
    "   record the result with branch: 'HEAD', empty commit fields, pushed: false,",
    "   error: 'detached HEAD — refusing to commit'.",
    '   Also verify `git -C <dirPath> remote get-url origin`. If it fails, stop',
    "   and record pushed: false with error: 'no origin remote configured'.",
    "   Verify committer identity: `git -C <dirPath> config user.email` and",
    "   `git -C <dirPath> config user.name`. If either is empty, stop and record",
    "   pushed: false with error: 'git user.name/user.email not configured'.",
    "3. Collect changed files: git diff --name-only, git diff --cached --name-only, ls-files --others --exclude-standard. Union unique sorted.",
    "4. Gather change context for the summary: git diff HEAD covers modified/deleted tracked files. For untracked files, cat them. If entry.message is not set, produce a concise imperative summary (<= 72 chars, no trailing period).",
    "5. Build commitMessage from pattern substituting {ticket} and {summary}. If entry.message is set, use it verbatim.",
    "6. Build PR-ready fields: title (<ticket>: <summary> or just <summary>), description (markdown summary of changes).",
    "   If prSummaryStyle is 'brief', write one short paragraph. If 'detailed', write one-line intro then bulleted file-by-file changes.",
    "7. `git -C <dirPath> add -A`",
    "8. `git -C <dirPath> commit -m \"<commitMessage>\"`. On hook failure: record pushed: false with error. Never retry with --no-verify.",
    "9. `git -C <dirPath> rev-parse HEAD` → commitSha.",
    "10. Push: try `git push origin <branch>`. If no upstream, retry with `git push -u origin <branch>`. If non-fast-forward: record pushed: false with error 'remote has diverging commits — pull/rebase required'. If auth error: record pushed: false with error 'push denied: <stderr>'. On success: pushed: true.",
    "11. `git -C <dirPath> remote get-url origin` → remoteUrl.",
    "",
    "folderName is the basename of dirPath.",
    "",
    "Return JSON matching the output schema: a repos array with one entry per input repo, and an optional top-level error only if the whole operation failed before any repo was processed.",
  ].join("\n");
}

export async function commitPushRepos(
  client: OpenCodeClient,
  config: OpenCodeProviderConfig,
  opts: CommitPushReposOptions,
): Promise<CommitPushReposResult> {
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  const EMPTY: CommitPushReposResult = { repos: [], sessionId };

  if (opts?.repos == null) {
    log.error({ sessionId }, "commitPushRepos missing repos");
    return { ...EMPTY, error: "repos is required" };
  }

  const entries = normalizeEntries(opts);
  log.info({ sessionId, repoCount: entries.length, ticket: opts.ticket }, "commitPushRepos start");

  if (entries.length === 0) {
    log.warn({ sessionId }, "commitPushRepos called with no repos");
    return EMPTY;
  }

  const pattern = opts.pattern ?? DEFAULT_PATTERN;
  const prSummaryStyle = opts.prSummaryStyle ?? "detailed";

  const session = await client.session.create({ body: { title: "commitPushRepos" } });
  const sid = session.data.id;

  const result = await client.session.prompt({
    path: { id: sid },
    body: {
      parts: [{ type: "text", text: buildPrompt(entries, pattern, prSummaryStyle) }],
      model: config.model,
      tools: config.tools,
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
  });

  const info = result.data.info;
  logSessionEvent(log, sessionId, info);

  if (info.error) {
    const error = typeof info.error === "string" ? info.error : JSON.stringify(info.error);
    log.error({ sessionId, error }, "commitPushRepos failed");
    return { ...EMPTY, error };
  }
  if (!info.structured_output) return EMPTY;

  const output = { ...(info.structured_output as CommitPushReposResult), sessionId };
  log.info({
    sessionId,
    pushedCount: output.repos.filter((r) => r.pushed).length,
    failureCount: output.repos.filter((r) => !r.pushed).length,
  }, "commitPushRepos done");
  return output;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/coding-cli && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/coding-cli/src/providers/opencode/operations/commit-push-repos.ts
git commit -m "feat(opencode): add commitPushRepos operation"
```

---

## Task 9: analyze operation

**Files:**
- Create: `packages/coding-cli/src/providers/opencode/operations/analyze.ts`

- [ ] **Step 1: Create analyze.ts**

```typescript
// packages/coding-cli/src/providers/opencode/operations/analyze.ts
import { createLogger } from "@journeyman/core";
import { logSessionEvent } from "../utils/sdk-logger.ts";
import type { OpenCodeClient } from "../client.ts";
import type { OpenCodeProviderConfig } from "../types.ts";
import type { AnalyzeOptions, AnalyzeResult } from "@journeyman/core";

const log = createLogger("opencode:analyze");

const EMPTY_RESULT: Omit<AnalyzeResult, "sessionId"> = {
  ticketSummary: "",
  ticketType: "other",
  codebaseSummary: "",
  affectedAreas: [],
  findings: [],
  assumptions: [],
  risks: [],
  recommendations: [],
  complexity: "medium",
  readinessScore: 0,
  reportTitle: "",
  reportPath: "",
  summary: "",
};

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    ticketSummary: { type: "string" },
    ticketType: { type: "string", enum: ["bug", "feature", "enhancement", "task", "refactor", "other"] },
    codebaseSummary: { type: "string" },
    affectedAreas: { type: "array", items: { type: "string" } },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          category: { type: "string", enum: ["ambiguity", "inconsistency", "underspecified", "duplication", "risk", "terminology", "coverage-gap", "assumption"] },
          severity: { type: "string", enum: ["critical", "high", "medium", "low", "info"] },
          title: { type: "string" },
          description: { type: "string" },
          location: { type: "string" },
          recommendation: { type: "string" },
        },
        required: ["id", "category", "severity", "title", "description"],
      },
    },
    assumptions: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    recommendations: { type: "array", items: { type: "string" } },
    complexity: { type: "string", enum: ["trivial", "low", "medium", "high", "very-high"] },
    readinessScore: { type: "number", minimum: 0, maximum: 100 },
    reportTitle: { type: "string" },
    reportPath: { type: "string" },
    summary: { type: "string" },
    error: { type: "string" },
  },
  required: ["ticketSummary", "ticketType", "codebaseSummary", "affectedAreas", "findings", "assumptions", "risks", "recommendations", "complexity", "readinessScore", "reportTitle", "reportPath", "summary"],
} as const;

function buildPrompt(opts: AnalyzeOptions): string {
  const ticket = opts.ticketContent?.trim() || "(no ticket content provided — infer intent from dirPath)";
  const focus = opts.focus?.trim();
  const docsDir = `${opts.dirPath.replace(/\/+$/, "")}/docs/analyze`;

  return [
    "You are a senior staff engineer performing a speckit-style analysis of a ticket against a codebase.",
    "",
    "=== AUTONOMY RULES (non-negotiable) ===",
    "  1. This run is FULLY AUTONOMOUS. There is no human on the other end. Nobody will answer you.",
    "  2. NEVER ask clarifying questions — not in text, not via tools. Questions will not be read.",
    "  3. When information is missing or ambiguous, DECIDE. Pick the most reasonable interpretation based on the ticket + codebase + industry standards, proceed, and record the decision in `assumptions`.",
    "  4. Prefer the BEST approach on the merits, not the 'safest' approach that defers the decision.",
    "  5. Do not stall, loop, or abandon the task. Always produce a complete report — even a partial analysis is better than no output.",
    "  6. Never output prose asking for confirmation, approval, or next steps. The only output is the final JSON report.",
    "",
    "=== TICKET ===",
    ticket,
    "",
    "=== CODEBASE ===",
    `Root path: ${opts.dirPath}`,
    focus ? `Focus area: ${focus}` : "Focus: whole codebase relevant to the ticket.",
    "",
    "=== INVESTIGATION STEPS (use Bash / Read / Grep / Glob) ===",
    `  1. ls ${opts.dirPath} and inspect top-level structure`,
    "  2. Read README / package.json / pyproject / go.mod etc. to understand the project",
    "  3. grep for keywords from the ticket (feature names, symbols, identifiers) to locate affected modules",
    "  4. Read the most relevant files (entrypoints, modules matching the ticket scope)",
    "  5. Cross-reference the ticket requirements against what the code currently does",
    "",
    "=== WRITE THE REPORT TO DISK ===",
    `  1. Ensure the docs directory exists: mkdir -p ${docsDir}`,
    "  2. Derive a slug from the ticket key/title (kebab-case, lowercase, alnum+dashes).",
    `  3. Write a markdown report to: ${docsDir}/<slug>-<YYYYMMDD-HHmm>.md`,
    "     Use a heredoc or the file tool. The markdown MUST contain sections:",
    "       # <Report Title>",
    "       ## Ticket Summary, ## Ticket Type, ## Codebase Summary,",
    "       ## Affected Areas, ## Findings (table: id | category | severity | title | location),",
    "       ## Assumptions, ## Risks, ## Recommendations,",
    "       ## Complexity, ## Readiness Score.",
    "  4. Verify the file exists with `ls -l` before returning.",
    "",
    "=== REPORT REQUIREMENTS (speckit-style) ===",
    "Return a structured JSON report with these fields:",
    "  - ticketSummary: 1-3 sentence plain-language summary of what the ticket asks for.",
    "  - ticketType: bug | feature | enhancement | task | refactor | other.",
    "  - codebaseSummary: what the relevant parts of the codebase currently do.",
    "  - affectedAreas: list of file paths / modules / components that would be touched.",
    "  - findings: array — each { id (F-001 style), category, severity, title, description, location?, recommendation? }.",
    "    categories: ambiguity | inconsistency | underspecified | duplication | risk | terminology | coverage-gap | assumption.",
    "    severity: critical | high | medium | low | info.",
    "  - assumptions: assumptions you had to make because the ticket was underspecified.",
    "  - risks: things that could go wrong during implementation.",
    "  - recommendations: concrete next steps, ordered by priority.",
    "  - complexity: trivial | low | medium | high | very-high.",
    "  - readinessScore: 0-100. 100 = crystal clear; 0 = unworkable without clarification.",
    "  - reportTitle: short human title for the report.",
    "  - reportPath: absolute path of the markdown file you just wrote.",
    "  - summary: a concise ticket-comment-ready summary (markdown, 4-8 short lines or bullets).",
    "",
    "Return ONLY the JSON matching the schema. No prose outside of it.",
  ].join("\n");
}

export async function analyze(
  client: OpenCodeClient,
  config: OpenCodeProviderConfig,
  opts: AnalyzeOptions,
): Promise<AnalyzeResult> {
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  log.info({ sessionId, dirPath: opts.dirPath, focus: opts.focus }, "analyze start");

  const session = await client.session.create({ body: { title: "analyze" } });
  const sid = session.data.id;

  const result = await client.session.prompt({
    path: { id: sid },
    body: {
      parts: [{ type: "text", text: buildPrompt(opts) }],
      model: config.model,
      tools: config.tools,
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
  });

  const info = result.data.info;
  logSessionEvent(log, sessionId, info);

  if (info.error) {
    const error = typeof info.error === "string" ? info.error : JSON.stringify(info.error);
    log.error({ sessionId, error }, "analyze failed");
    return { ...EMPTY_RESULT, sessionId, error };
  }
  if (!info.structured_output) return { ...EMPTY_RESULT, sessionId };

  const output = { ...(info.structured_output as AnalyzeResult), sessionId };
  log.info({
    sessionId,
    ticketType: output.ticketType,
    complexity: output.complexity,
    readinessScore: output.readinessScore,
    findingCount: output.findings.length,
    reportPath: output.reportPath,
  }, "analyze done");
  return output;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/coding-cli && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/coding-cli/src/providers/opencode/operations/analyze.ts
git commit -m "feat(opencode): add analyze operation"
```

---

## Task 10: plan operation

**Files:**
- Create: `packages/coding-cli/src/providers/opencode/operations/plan.ts`

- [ ] **Step 1: Create plan.ts**

```typescript
// packages/coding-cli/src/providers/opencode/operations/plan.ts
import { createLogger } from "@journeyman/core";
import { logSessionEvent } from "../utils/sdk-logger.ts";
import type { OpenCodeClient } from "../client.ts";
import type { OpenCodeProviderConfig } from "../types.ts";
import type { PlanOptions, PlanResult } from "@journeyman/core";

const log = createLogger("opencode:plan");

const EMPTY_RESULT: Omit<PlanResult, "sessionId"> = {
  planTitle: "",
  goal: "",
  approachSummary: "",
  affectedFiles: [],
  steps: [],
  testStrategy: [],
  rolloutNotes: [],
  risks: [],
  openQuestions: [],
  estimatedComplexity: "medium",
  reportTitle: "",
  reportPath: "",
  summary: "",
};

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    planTitle: { type: "string" },
    goal: { type: "string" },
    approachSummary: { type: "string" },
    affectedFiles: { type: "array", items: { type: "string" } },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          kind: { type: "string", enum: ["setup", "code-change", "refactor", "test", "config", "migration", "docs", "verification", "rollout"] },
          title: { type: "string" },
          description: { type: "string" },
          files: { type: "array", items: { type: "string" } },
          commands: { type: "array", items: { type: "string" } },
          acceptanceCriteria: { type: "array", items: { type: "string" } },
          dependsOn: { type: "array", items: { type: "string" } },
        },
        required: ["id", "kind", "title", "description"],
      },
    },
    testStrategy: { type: "array", items: { type: "string" } },
    rolloutNotes: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    openQuestions: { type: "array", items: { type: "string" } },
    estimatedComplexity: { type: "string", enum: ["trivial", "low", "medium", "high", "very-high"] },
    reportTitle: { type: "string" },
    reportPath: { type: "string" },
    summary: { type: "string" },
    error: { type: "string" },
  },
  required: ["planTitle", "goal", "approachSummary", "affectedFiles", "steps", "testStrategy", "rolloutNotes", "risks", "openQuestions", "estimatedComplexity", "reportTitle", "reportPath", "summary"],
} as const;

function buildPrompt(opts: PlanOptions): string {
  const root = opts.dirPath.replace(/\/+$/, "");
  const ticket = opts.ticketContent?.trim() || "(no ticket content provided — derive goal from analyze report)";
  const focus = opts.focus?.trim();
  const analyzeDir = `${root}/docs/analyze`;
  const planDir = `${root}/docs/plan`;
  const explicitReport = opts.analyzeReportPath?.trim();

  return [
    "You are a senior staff engineer producing an autonomous, speckit-style IMPLEMENTATION PLAN.",
    "",
    "=== AUTONOMY RULES (non-negotiable) ===",
    "  1. This run is FULLY AUTONOMOUS. There is no human on the other end. Nobody will answer you.",
    "  2. NEVER ask clarifying questions — not in text, not via tools. Questions will not be read.",
    "  3. When information is missing or ambiguous, DECIDE. Record the decision in `openQuestions`.",
    "  4. Prefer the BEST approach on the merits. Choose a concrete design — do not emit a plan full of 'TBD'.",
    "  5. Do not stall, loop, or abandon the task. Always produce a complete plan.",
    "  6. Never output prose asking for confirmation. The only output is the final JSON plan.",
    "",
    "=== TICKET / GOAL ===",
    ticket,
    "",
    "=== CODEBASE ===",
    `Root path: ${root}`,
    focus ? `Focus area: ${focus}` : "Focus: whole codebase relevant to the goal.",
    "",
    "=== STEP 1: LOAD THE PRIOR ANALYZE REPORT ===",
    explicitReport
      ? `  - An analyze report path was provided: ${explicitReport}. Read it in full.`
      : [
          `  - Check if ${analyzeDir} exists (ls -la).`,
          `  - If it exists, pick the MOST RECENT markdown report and read it in full.`,
          `  - If the directory is missing or empty, proceed using only the ticket + codebase (note this in openQuestions).`,
        ].join("\n"),
    "  - Extract: affected areas, findings, assumptions, risks, recommendations, readiness score.",
    "  - Your plan must directly address the findings and recommendations from the analyze report.",
    "",
    "=== STEP 2: INVESTIGATE THE CODE (Bash / Read / Grep / Glob) ===",
    `  1. ls ${root} and read the key files mentioned in the analyze report.`,
    "  2. For each affected area, read the actual current code so the plan references real functions, paths, and line numbers.",
    "  3. Check for existing tests covering the affected areas.",
    "",
    "=== STEP 3: WRITE THE PLAN REPORT TO DISK ===",
    `  1. mkdir -p ${planDir}`,
    "  2. Derive a slug from the ticket key/title (kebab-case, lowercase).",
    `  3. Write markdown to: ${planDir}/<slug>-<YYYYMMDD-HHmm>.md`,
    "     Required sections: # Plan Title, ## Goal, ## Approach Summary, ## Affected Files, ## Steps, ## Test Strategy, ## Rollout Notes, ## Risks, ## Open Questions, ## Estimated Complexity, ## Linked Analyze Report.",
    "  4. Verify the file exists with `ls -l` before returning.",
    "",
    "=== REPORT REQUIREMENTS (speckit-style) ===",
    "Return a structured JSON plan with: planTitle, goal, approachSummary, affectedFiles, steps (each: id S-001.., kind, title, description, files?, commands?, acceptanceCriteria?, dependsOn?), testStrategy, rolloutNotes, risks, openQuestions, estimatedComplexity, reportTitle, reportPath, summary.",
    "",
    "Return ONLY the JSON matching the schema. No prose outside of it.",
  ].join("\n");
}

export async function plan(
  client: OpenCodeClient,
  config: OpenCodeProviderConfig,
  opts: PlanOptions,
): Promise<PlanResult> {
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  log.info({ sessionId, dirPath: opts.dirPath, focus: opts.focus }, "plan start");

  const session = await client.session.create({ body: { title: "plan" } });
  const sid = session.data.id;

  const result = await client.session.prompt({
    path: { id: sid },
    body: {
      parts: [{ type: "text", text: buildPrompt(opts) }],
      model: config.model,
      tools: config.tools,
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
  });

  const info = result.data.info;
  logSessionEvent(log, sessionId, info);

  if (info.error) {
    const error = typeof info.error === "string" ? info.error : JSON.stringify(info.error);
    log.error({ sessionId, error }, "plan failed");
    return { ...EMPTY_RESULT, sessionId, error };
  }
  if (!info.structured_output) return { ...EMPTY_RESULT, sessionId };

  const output = { ...(info.structured_output as PlanResult), sessionId };
  log.info({
    sessionId,
    stepCount: output.steps.length,
    complexity: output.estimatedComplexity,
    reportPath: output.reportPath,
  }, "plan done");
  return output;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/coding-cli && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/coding-cli/src/providers/opencode/operations/plan.ts
git commit -m "feat(opencode): add plan operation"
```

---

## Task 11: implement operation

**Files:**
- Create: `packages/coding-cli/src/providers/opencode/operations/implement.ts`

- [ ] **Step 1: Create implement.ts**

```typescript
// packages/coding-cli/src/providers/opencode/operations/implement.ts
import { createLogger } from "@journeyman/core";
import { logSessionEvent } from "../utils/sdk-logger.ts";
import type { OpenCodeClient } from "../client.ts";
import type { OpenCodeProviderConfig } from "../types.ts";
import type { ImplementOptions, ImplementResult } from "@journeyman/core";

const log = createLogger("opencode:implement");

const EMPTY_RESULT: Omit<ImplementResult, "sessionId"> = {
  success: false,
  implementationTitle: "",
  approachSummary: "",
  filesChanged: [],
  steps: [],
  testsRun: [],
  testsPassed: false,
  followUps: [],
  reportTitle: "",
  reportPath: "",
  summary: "",
};

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    success: { type: "boolean" },
    implementationTitle: { type: "string" },
    approachSummary: { type: "string" },
    filesChanged: {
      type: "array",
      items: {
        type: "object",
        properties: {
          path: { type: "string" },
          kind: { type: "string", enum: ["created", "modified", "deleted"] },
          summary: { type: "string" },
        },
        required: ["path", "kind", "summary"],
      },
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          status: { type: "string", enum: ["done", "skipped", "partial", "failed"] },
          notes: { type: "string" },
        },
        required: ["id", "title", "status"],
      },
    },
    testsRun: { type: "array", items: { type: "string" } },
    testsPassed: { type: "boolean" },
    followUps: { type: "array", items: { type: "string" } },
    reportTitle: { type: "string" },
    reportPath: { type: "string" },
    summary: { type: "string" },
    error: { type: "string" },
  },
  required: ["success", "implementationTitle", "approachSummary", "filesChanged", "steps", "testsRun", "testsPassed", "followUps", "reportTitle", "reportPath", "summary"],
} as const;

const DEFAULT_RULES = [
  "Follow the existing code style, naming conventions, and project structure — match what's already in the repo.",
  "Do NOT introduce new dependencies unless the plan explicitly requires one. Prefer existing utilities.",
  "Keep the change MINIMAL and SCOPED to the plan. Do not refactor unrelated code or bundle drive-by cleanups.",
  "Preserve backwards compatibility for public APIs unless the plan explicitly calls for a breaking change.",
  "Do not delete or modify unrelated tests. Keep unrelated files untouched.",
  "Do not commit, push, or create branches. Only edit the working tree.",
  "Do not leak secrets, tokens, or absolute machine-specific paths into code or reports.",
  "Never use destructive git commands (reset --hard, clean -fd, push --force, branch -D).",
  "Prefer small, well-named functions over clever one-liners. Readability > cleverness.",
  "Do not add comments that merely restate the code. Only comment non-obvious WHY.",
  "If a plan step is ambiguous, make a reasonable assumption, implement it, and record the assumption in followUps.",
  "If an edit is impossible (e.g. target file missing), mark that step status 'failed' with a clear note and continue.",
  "After implementation, run the project's typecheck / tests if available and report the exact commands in testsRun.",
];

function buildPrompt(opts: ImplementOptions): string {
  const root = opts.dirPath.replace(/\/+$/, "");
  const ticket = opts.ticketContent?.trim() || "(no ticket content provided — derive from plan / analyze reports)";
  const focus = opts.focus?.trim();
  const analyzeDir = `${root}/docs/analyze`;
  const planDir = `${root}/docs/plan`;
  const implDir = `${root}/docs/implement`;
  const explicitAnalyze = opts.analyzeReportPath?.trim();
  const explicitPlan = opts.planReportPath?.trim();
  const rules = [...DEFAULT_RULES, ...(opts.extraRules ?? [])]
    .map((r, i) => `  ${i + 1}. ${r}`)
    .join("\n");

  return [
    "You are a senior staff engineer IMPLEMENTING a ticket autonomously.",
    "",
    "=== AUTONOMY RULES (non-negotiable) ===",
    "  1. This run is FULLY AUTONOMOUS. There is no human on the other end. Nobody will answer you.",
    "  2. NEVER ask clarifying questions. Questions will not be read.",
    "  3. When information is missing or ambiguous, DECIDE. Record the decision in `followUps`.",
    "  4. Ship working code — do not leave TODO stubs where a real implementation is expected.",
    "  5. If a step is blocked, mark it 'failed' with a clear note and move on.",
    "  6. Never output prose asking for confirmation. The only output is the final JSON report.",
    "",
    "=== TICKET / GOAL ===",
    ticket,
    "",
    "=== CODEBASE ===",
    `Root path: ${root}`,
    focus ? `Focus area: ${focus}` : "Focus: whatever the plan + analyze reports indicate.",
    "",
    "=== IMPLEMENTATION RULES (non-negotiable) ===",
    rules,
    "",
    "=== STEP 1: LOAD PRIOR REPORTS ===",
    explicitAnalyze
      ? `  - Analyze report provided: ${explicitAnalyze}. Read it in full.`
      : `  - Check ${analyzeDir}. If present, read the MOST RECENT markdown report in full. If absent, note in followUps.`,
    explicitPlan
      ? `  - Plan report provided: ${explicitPlan}. Read it in full.`
      : `  - Check ${planDir}. If present, read the MOST RECENT markdown plan in full. The plan's Steps section drives this work.`,
    "  - If the plan is missing, derive a minimal ordered step list from the ticket + analyze report yourself before coding.",
    "",
    "=== STEP 2: IMPLEMENT ===",
    "  - Work through the plan's steps in order. For each step:",
    "      a. Read the target files (never edit blind).",
    "      b. Apply the edit with Edit/Write.",
    "      c. Record the change in filesChanged and the step outcome in steps[].",
    "  - Respect all rules above. Stay within the scope of the plan.",
    "",
    "=== STEP 3: VERIFY ===",
    `  - Detect the project's verification command(s) by inspecting package.json / Makefile / pyproject / go.mod at ${root}.`,
    "  - Preferred order: typecheck → lint → unit tests. Run whatever exists. Capture exact commands in testsRun.",
    "  - Set testsPassed=true only if every command you ran exited 0.",
    "",
    "=== STEP 4: WRITE THE IMPLEMENTATION REPORT TO DISK ===",
    `  1. mkdir -p ${implDir}`,
    "  2. Derive a slug from the ticket key / plan title (kebab-case, lowercase).",
    `  3. Write markdown to: ${implDir}/<slug>-<YYYYMMDD-HHmm>.md`,
    "     Required sections: # Implementation Title, ## Approach Summary, ## Files Changed, ## Steps Executed, ## Tests Run, ## Follow-ups, ## Linked Analyze Report, ## Linked Plan Report.",
    "  4. Verify the file exists with `ls -l` before returning.",
    "",
    "=== RETURN JSON ===",
    "  success: true only if all plan steps are done AND testsPassed is true.",
    "  implementationTitle, approachSummary, filesChanged, steps, testsRun, testsPassed, followUps, reportTitle, reportPath, summary.",
    "",
    "Return ONLY the JSON matching the schema. No prose outside of it.",
  ].join("\n");
}

export async function implement(
  client: OpenCodeClient,
  config: OpenCodeProviderConfig,
  opts: ImplementOptions,
): Promise<ImplementResult> {
  const sessionId = opts.sessionId ?? crypto.randomUUID();
  log.info({ sessionId, dirPath: opts.dirPath, focus: opts.focus }, "implement start");

  const session = await client.session.create({ body: { title: "implement" } });
  const sid = session.data.id;

  const result = await client.session.prompt({
    path: { id: sid },
    body: {
      parts: [{ type: "text", text: buildPrompt(opts) }],
      model: config.model,
      tools: config.tools,
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
  });

  const info = result.data.info;
  logSessionEvent(log, sessionId, info);

  if (info.error) {
    const error = typeof info.error === "string" ? info.error : JSON.stringify(info.error);
    log.error({ sessionId, error }, "implement failed");
    return { ...EMPTY_RESULT, sessionId, error };
  }
  if (!info.structured_output) return { ...EMPTY_RESULT, sessionId };

  const output = { ...(info.structured_output as ImplementResult), sessionId };
  log.info({
    sessionId,
    success: output.success,
    filesChanged: output.filesChanged.length,
    stepCount: output.steps.length,
    testsPassed: output.testsPassed,
    reportPath: output.reportPath,
  }, "implement done");
  return output;
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/coding-cli && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/coding-cli/src/providers/opencode/operations/implement.ts
git commit -m "feat(opencode): add implement operation"
```

---

## Task 12: Provider class + export

**Files:**
- Create: `packages/coding-cli/src/providers/opencode/index.ts`
- Modify: `packages/coding-cli/src/index.ts`

- [ ] **Step 1: Create the provider class**

```typescript
// packages/coding-cli/src/providers/opencode/index.ts
import type { ICodingCLI, IProviderMeta } from "@journeyman/core";
import type {
  ScanReposOptions, ScanReposResult,
  CheckoutRepoOptions, CheckoutRepoResult,
  CommitPushReposOptions, CommitPushReposResult,
  CleanupReposOptions, CleanupReposResult,
  CreateWorkspaceOptions, CreateWorkspaceResult,
  AnalyzeOptions, AnalyzeResult,
  PlanOptions, PlanResult,
  ImplementOptions, ImplementResult,
} from "@journeyman/core";
import { getClient } from "./client.ts";
import type { OpenCodeClient } from "./client.ts";
import type { OpenCodeProviderConfig } from "./types.ts";
import { scanRepos } from "./operations/scan-repos.ts";
import { checkoutRepo } from "./operations/checkout-repo.ts";
import { commitPushRepos } from "./operations/commit-push-repos.ts";
import { cleanupRepos } from "./operations/cleanup-repos.ts";
import { createWorkspace } from "./operations/create-workspace.ts";
import { analyze } from "./operations/analyze.ts";
import { plan } from "./operations/plan.ts";
import { implement } from "./operations/implement.ts";

export type { OpenCodeProviderConfig } from "./types.ts";

export class OpenCodeProvider implements ICodingCLI {
  static meta: IProviderMeta = {
    id: "opencode",
    name: "OpenCode CLI",
    description: "AI coding via OpenCode SDK (model-agnostic: Anthropic, OpenAI, Gemini…)",
    category: "coding-cli",
  };

  readonly #config: OpenCodeProviderConfig;
  #client: OpenCodeClient | null = null;

  constructor(config: OpenCodeProviderConfig) {
    if (!config.mode) throw new Error("OpenCodeProvider: config.mode is required ('managed' | 'external')");
    if (!config.model?.providerID) throw new Error("OpenCodeProvider: config.model.providerID is required");
    if (!config.model?.modelID) throw new Error("OpenCodeProvider: config.model.modelID is required");
    this.#config = config;
  }

  private async client(): Promise<OpenCodeClient> {
    if (!this.#client) this.#client = await getClient(this.#config);
    return this.#client;
  }

  async scanRepos(opts: ScanReposOptions): Promise<ScanReposResult> {
    return scanRepos(await this.client(), this.#config, opts);
  }
  async checkoutRepo(opts: CheckoutRepoOptions): Promise<CheckoutRepoResult> {
    return checkoutRepo(await this.client(), this.#config, opts);
  }
  async commitPushRepos(opts: CommitPushReposOptions): Promise<CommitPushReposResult> {
    return commitPushRepos(await this.client(), this.#config, opts);
  }
  async cleanupRepos(opts: CleanupReposOptions): Promise<CleanupReposResult> {
    return cleanupRepos(opts);
  }
  async createWorkspace(opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> {
    return createWorkspace(opts);
  }
  async analyze(opts: AnalyzeOptions): Promise<AnalyzeResult> {
    return analyze(await this.client(), this.#config, opts);
  }
  async plan(opts: PlanOptions): Promise<PlanResult> {
    return plan(await this.client(), this.#config, opts);
  }
  async implement(opts: ImplementOptions): Promise<ImplementResult> {
    return implement(await this.client(), this.#config, opts);
  }
}
```

- [ ] **Step 2: Add export to `src/index.ts`**

Edit `packages/coding-cli/src/index.ts` to add the new export:

```typescript
export { ClaudeProvider } from "./providers/claude/index.ts";
export { GeminiProvider } from "./providers/gemini/index.ts";
export { CodexProvider } from "./providers/codex/index.ts";
export { OpenCodeProvider } from "./providers/opencode/index.ts";
export type { OpenCodeProviderConfig } from "./providers/opencode/index.ts";
export type { ICodingCLI } from "./interface.ts";
```

- [ ] **Step 3: Typecheck**

```bash
cd packages/coding-cli && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/coding-cli/src/providers/opencode/index.ts \
        packages/coding-cli/src/index.ts
git commit -m "feat(opencode): add OpenCodeProvider class and export"
```

---

## Task 13: Register in pipeline

**Files:**
- Modify: `packages/pipeline/src/cli-commands/run-once.ts`

- [ ] **Step 1: Add import and registration**

In `packages/pipeline/src/cli-commands/run-once.ts`, update line 15 to add `OpenCodeProvider`:

```typescript
import { ClaudeProvider, GeminiProvider, CodexProvider, OpenCodeProvider } from "@journeyman/coding-cli";
```

And update the providers registration block (around line 78-84) to include `OpenCodeProvider`:

```typescript
const providers = new ProviderRegistry();
for (const c of [
  ClaudeProvider, GeminiProvider, CodexProvider, OpenCodeProvider,
  GitHubProvider, GitLabProvider,
  JiraProvider, LinearProvider, MondayProvider,
  GitHubIssuesProvider, GitHubProjectsProvider,
  SlackProvider,
]) providers.register(c as any);
```

- [ ] **Step 2: Typecheck the pipeline package**

```bash
cd packages/pipeline && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/pipeline/src/cli-commands/run-once.ts
git commit -m "feat(pipeline): register OpenCodeProvider"
```

---

## Task 14: Full typecheck + final verification

- [ ] **Step 1: Typecheck all packages from the root**

```bash
npm run typecheck
```

Expected: zero errors across all packages.

- [ ] **Step 2: Run the existing session utility test**

```bash
npx tsx packages/coding-cli/src/providers/claude/utils/session.test.ts
```

Expected: `resolveSession: all assertions passed`

- [ ] **Step 3: Run the new client factory test**

```bash
npx tsx packages/coding-cli/src/providers/opencode/client.test.ts
```

Expected: `getClient: all assertions passed`

- [ ] **Step 4: Verify OpenCodeProvider is exported from the package**

```bash
node -e "import('@journeyman/coding-cli').then(m => console.log('OpenCodeProvider:', typeof m.OpenCodeProvider))"
```

Expected: `OpenCodeProvider: function`

- [ ] **Step 5: Verify provider registration works**

```bash
node -e "
import('@journeyman/coding-cli').then(({ OpenCodeProvider }) => {
  try {
    new OpenCodeProvider({ mode: 'external', model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-6' } });
    console.log('constructor: ok');
  } catch(e) { console.error('constructor failed:', e.message); }
  try {
    new OpenCodeProvider({ mode: 'external', model: { providerID: 'anthropic' } });
    console.error('should have thrown');
  } catch(e) { console.log('missing modelID caught:', e.message); }
})
"
```

Expected:
```
constructor: ok
missing modelID caught: OpenCodeProvider: config.model.modelID is required
```

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(opencode): complete OpenCodeProvider implementation"
```

---

## SDK Type Notes for Implementer

After running `npm install`, verify the exact shape of `@opencode-ai/sdk` exports:

```bash
node -e "import('@opencode-ai/sdk').then(m => console.log(Object.keys(m)))"
```

Key things to confirm:
1. The return type of `createOpencodeClient()` — used to type `OpenCodeClient` in `client.ts`
2. The exact path to structured output: `result.data.info.structured_output` (confirm this after `session.prompt()`)
3. The shape of `info.error` — may be a string, object, or null. The operations handle both string and object via `JSON.stringify` fallback.

If the SDK exports its own `McpLocalConfig`/`McpRemoteConfig` types, you may import them in `types.ts` rather than redeclaring locally.
