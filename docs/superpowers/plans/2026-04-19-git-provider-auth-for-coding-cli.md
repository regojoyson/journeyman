# Re-home Clone to git-provider + Rename resetRepos to resetAndCheckout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move deterministic `cloneRepos` from `@journeyman/coding-cli` into `@journeyman/git-provider` (implemented with `node:child_process`, not the Claude SDK). Rename the existing `resetRepos` operation/phase to `resetAndCheckout` to better reflect what it does, and extend it to support creating a new branch from a base when the target branch doesn't yet exist. Delete `coding-cli.cloneRepos` and leave `commitPushRepos` unchanged.

**Architecture:** `git-provider` owns auth + deterministic local git. `GitHubProvider.cloneRepos` embeds the PAT in the HTTPS clone URL (`https://x-access-token:<pat>@github.com/...`) and runs `git clone` via `execFile`. The token persists in `.git/config`, so downstream `git fetch`/`git push` from `resetAndCheckout` and `commitPushRepos` Just Work with no extra auth plumbing. `resetAndCheckout` keeps its current SDK-driven multi-step behavior (`fetch` → `stash` → `checkout` → `reset --hard` → `clean`) and gains a branch-creation path (`checkout -b <branch> <fromBranch>`) when the target branch doesn't exist.

**Tech Stack:** TypeScript (NodeNext), `node:child_process.execFile`, `node:fs/promises`, `node:assert/strict`, `@anthropic-ai/claude-agent-sdk` (for `resetAndCheckout` only). Tests are single-file scripts run via `npx tsx path/to/foo.test.ts` (pattern: [session.test.ts](packages/coding-cli/src/providers/claude/utils/session.test.ts)).

**Spec:** [2026-04-19-git-provider-auth-for-coding-cli-design.md](../specs/2026-04-19-git-provider-auth-for-coding-cli-design.md)

---

## File Map

**Create**
- `packages/git-provider/src/providers/github/operations/build-clone-url.ts` — pure URL rewriter helper
- `packages/git-provider/src/providers/github/operations/build-clone-url.test.ts` — unit tests
- `packages/git-provider/src/providers/github/operations/clone-repos.ts` — `cloneRepos` implementation
- `packages/coding-cli/src/providers/claude/operations/reset-and-checkout.ts` — renamed + extended reset-repos
- `packages/pipeline/src/phases/reset-and-checkout-phase.ts` — renamed phase

**Modify**
- `packages/core/src/types/git.types.ts` — drop `SessionOptions`/`SessionResult` from `CloneReposOptions`/`Result`; rename `ResetReposOptions` → `ResetAndCheckoutOptions`, `ResetReposResult` → `ResetAndCheckoutResult`, `ResetEntry` → `ResetAndCheckoutEntry`; add `create?` / `fromBranch?` fields.
- `packages/core/src/interfaces/git-provider.interface.ts` — add `cloneRepos`.
- `packages/core/src/interfaces/coding-cli.interface.ts` — remove `cloneRepos`; rename `resetRepos` → `resetAndCheckout`.
- `packages/git-provider/src/providers/github/index.ts` — wire `cloneRepos`.
- `packages/git-provider/src/providers/gitlab/index.ts` — add `cloneRepos` stub.
- `packages/coding-cli/src/providers/claude/index.ts` — drop `cloneRepos` method/import; rename `resetRepos` → `resetAndCheckout`.
- `packages/coding-cli/src/providers/gemini/index.ts` — drop `cloneRepos`; rename `resetRepos` stub.
- `packages/coding-cli/src/providers/codex/index.ts` — drop `cloneRepos`; rename `resetRepos` stub.
- `packages/pipeline/src/index.ts` — drop `ResetReposPhase` export; add `ResetAndCheckoutPhase` export.
- `packages/pipeline/src/cli-commands/run-once.ts` — rename registration.
- `packages/pipeline/src/cli-commands/validate-config.ts` — rename registration.

**Delete**
- `packages/coding-cli/src/providers/claude/operations/clone-repos.ts`
- `packages/coding-cli/src/providers/claude/operations/reset-repos.ts` (replaced by `reset-and-checkout.ts`)
- `packages/pipeline/src/phases/reset-repos-phase.ts` (replaced by `reset-and-checkout-phase.ts`)

---

## Task 1: Update `@journeyman/core` types

**Files:**
- Modify: `packages/core/src/types/git.types.ts:7-28` and `:48-65`

- [ ] **Step 1: Rewrite the clone types (drop SessionOptions/SessionResult)**

In [packages/core/src/types/git.types.ts](packages/core/src/types/git.types.ts), replace lines 7-28 (the `RepoEntry`/`ResetEntry`/`CloneReposOptions`/`CloneResult`/`CloneReposResult` block — stopping just before `ScanReposOptions`) with:

```ts
export type RepoEntry = { url: string; branch: string };

export type CloneReposOptions = {
  repos: string | string[] | RepoEntry | RepoEntry[];
  branch?: string;
  targetDir?: string;
  signal?: AbortSignal;
};

export type CloneResult = {
  folderName: string;
  dirPath: string;
  url: string;       // always the ORIGINAL, non-tokenized URL
  branch: string;
  error?: string;
};

export type CloneReposResult = {
  repos: CloneResult[];
  error?: string;
};

export type ResetAndCheckoutEntry = {
  dirPath: string;
  branch: string;
  /** Optional override: base branch to fork from when `create` is true. */
  fromBranch?: string;
  /** When true, create the branch (from `fromBranch` or current HEAD) if it does not exist. */
  create?: boolean;
};
```

Note: `ResetEntry` is replaced by `ResetAndCheckoutEntry`. Search the file for any other occurrence of `ResetEntry` (there should only be the declaration just removed); leave `SessionOptions`/`SessionResult` import alone — still used by other types.

- [ ] **Step 2: Rewrite the reset types as `ResetAndCheckout*`**

In the same file, find the block beginning `export type ResetReposOptions` (around line 48) through `ResetReposResult` (around line 65) and replace with:

```ts
export type ResetAndCheckoutOptions = SessionOptions & {
  repos: string | string[] | ResetAndCheckoutEntry | ResetAndCheckoutEntry[];
  branch?: string;
  /** Default for entries that omit it. When true, create missing branches from `fromBranch`. */
  create?: boolean;
  /** Default base for create. Ignored when the target branch already exists. */
  fromBranch?: string;
  signal?: AbortSignal;
};

export type ResetAndCheckoutRepoResult = {
  folderName: string;
  dirPath: string;
  branch: string;
  created: boolean;     // true if we created the branch; false if it already existed
  success: boolean;
  error?: string;
};

export type ResetAndCheckoutResult = SessionResult & {
  repos: ResetAndCheckoutRepoResult[];
  error?: string;
};
```

- [ ] **Step 3: Verify typecheck for `@journeyman/core`**

Run: `cd packages/core && npx tsc --noEmit`
Expected: no errors. (Downstream packages will fail; we fix them in subsequent tasks.)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/types/git.types.ts
git commit -m "feat(core): drop session from CloneRepos types; rename ResetRepos → ResetAndCheckout"
```

---

## Task 2: Update interfaces in `@journeyman/core`

**Files:**
- Modify: `packages/core/src/interfaces/git-provider.interface.ts`
- Modify: `packages/core/src/interfaces/coding-cli.interface.ts`

- [ ] **Step 1: Add `cloneRepos` to `IGitProvider`**

Replace the contents of [packages/core/src/interfaces/git-provider.interface.ts](packages/core/src/interfaces/git-provider.interface.ts) with:

```ts
import type {
  CreatePROptions, CreatePRResult,
  GetRepoOptions, GetRepoResult,
  ListPROptions, ListPRResult,
  CloneReposOptions, CloneReposResult,
} from "../types/git.types.ts";

/**
 * Contract for git hosting providers (GitHub, GitLab).
 * Covers platform REST API operations (repos, PRs/MRs) AND deterministic local
 * git operations that need host credentials (cloneRepos).
 */
export interface IGitProvider {
  getRepo(opts: GetRepoOptions): Promise<GetRepoResult>;
  createPR(opts: CreatePROptions): Promise<CreatePRResult>;
  listPRs(opts: ListPROptions): Promise<ListPRResult>;
  cloneRepos(opts: CloneReposOptions): Promise<CloneReposResult>;
}
```

- [ ] **Step 2: Update `ICodingCLI` — drop `cloneRepos`, rename `resetRepos`**

Replace the contents of [packages/core/src/interfaces/coding-cli.interface.ts](packages/core/src/interfaces/coding-cli.interface.ts) with:

```ts
import type {
  ScanReposOptions, ScanReposResult,
  ResetAndCheckoutOptions, ResetAndCheckoutResult,
  CommitPushReposOptions, CommitPushReposResult,
  CleanupReposOptions, CleanupReposResult,
  CreateWorkspaceOptions, CreateWorkspaceResult,
} from "../types/git.types.ts";
import type { AnalyzeOptions, AnalyzeResult, PlanOptions, PlanResult, ImplementOptions, ImplementResult } from "../types/coding.types.ts";

/**
 * Contract for AI coding CLI providers (Claude, Gemini, Codex).
 * Covers git operations that benefit from AI (commit-push, reset+checkout)
 * and AI-powered analyze/plan/implement.
 */
export interface ICodingCLI {
  // Git operations
  scanRepos(opts: ScanReposOptions): Promise<ScanReposResult>;
  resetAndCheckout(opts: ResetAndCheckoutOptions): Promise<ResetAndCheckoutResult>;
  commitPushRepos(opts: CommitPushReposOptions): Promise<CommitPushReposResult>;
  cleanupRepos(opts: CleanupReposOptions): Promise<CleanupReposResult>;
  createWorkspace(opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult>;

  // AI operations
  analyze(opts: AnalyzeOptions): Promise<AnalyzeResult>;
  plan(opts: PlanOptions): Promise<PlanResult>;
  implement(opts: ImplementOptions): Promise<ImplementResult>;
}
```

- [ ] **Step 3: Typecheck `@journeyman/core`**

Run: `cd packages/core && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/interfaces/git-provider.interface.ts packages/core/src/interfaces/coding-cli.interface.ts
git commit -m "feat(core): move cloneRepos to IGitProvider; rename resetRepos → resetAndCheckout"
```

---

## Task 3: `buildCloneUrl` helper — test first

**Files:**
- Test: `packages/git-provider/src/providers/github/operations/build-clone-url.test.ts`
- Create: `packages/git-provider/src/providers/github/operations/build-clone-url.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/git-provider/src/providers/github/operations/build-clone-url.test.ts`:

```ts
import assert from "node:assert/strict";
import { buildCloneUrl } from "./build-clone-url.ts";

{
  const out = buildCloneUrl("https://github.com/org/repo", "tok");
  assert.equal(out, "https://x-access-token:tok@github.com/org/repo.git");
}

{
  const out = buildCloneUrl("https://github.com/org/repo.git", "tok");
  assert.equal(out, "https://x-access-token:tok@github.com/org/repo.git");
}

assert.throws(
  () => buildCloneUrl("git@github.com:org/repo.git", "tok"),
  /only https:\/\/ URLs supported/,
);

assert.throws(
  () => buildCloneUrl("https://gitlab.com/org/repo", "tok"),
  /only github\.com host supported/,
);

assert.throws(
  () => buildCloneUrl("https://github.com/org/repo", ""),
  /token required/,
);

console.log("buildCloneUrl: all assertions passed");
```

- [ ] **Step 2: Run test — expect failure**

Run: `npx tsx packages/git-provider/src/providers/github/operations/build-clone-url.test.ts`
Expected: `ERR_MODULE_NOT_FOUND` for `./build-clone-url.ts`.

- [ ] **Step 3: Implement the helper**

Create `packages/git-provider/src/providers/github/operations/build-clone-url.ts`:

```ts
/**
 * Build a tokenized HTTPS clone URL for GitHub.
 *
 * Input:  https://github.com/<owner>/<repo> (with or without .git)
 * Output: https://x-access-token:<token>@github.com/<owner>/<repo>.git
 */
export function buildCloneUrl(repoUrl: string, token: string): string {
  if (!token) throw new Error("buildCloneUrl: token required");
  let parsed: URL;
  try {
    parsed = new URL(repoUrl);
  } catch {
    throw new Error(`buildCloneUrl: only https:// URLs supported, got ${repoUrl}`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`buildCloneUrl: only https:// URLs supported, got ${repoUrl}`);
  }
  if (parsed.host !== "github.com") {
    // TODO: GitHub Enterprise host support via GitHubProviderOptions.host
    throw new Error(`buildCloneUrl: only github.com host supported, got ${parsed.host}`);
  }
  const path = parsed.pathname.endsWith(".git") ? parsed.pathname : `${parsed.pathname}.git`;
  return `https://x-access-token:${token}@github.com${path}`;
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `npx tsx packages/git-provider/src/providers/github/operations/build-clone-url.test.ts`
Expected: `buildCloneUrl: all assertions passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/git-provider/src/providers/github/operations/build-clone-url.ts packages/git-provider/src/providers/github/operations/build-clone-url.test.ts
git commit -m "feat(git-provider): buildCloneUrl helper + tests"
```

---

## Task 4: `GitHubProvider.cloneRepos` implementation

**Files:**
- Create: `packages/git-provider/src/providers/github/operations/clone-repos.ts`
- Modify: `packages/git-provider/src/providers/github/index.ts`
- Modify: `packages/git-provider/src/providers/gitlab/index.ts`

- [ ] **Step 1: Implement `cloneRepos` operation**

Create `packages/git-provider/src/providers/github/operations/clone-repos.ts`:

```ts
import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { promisify } from "node:util";
import type {
  CloneReposOptions,
  CloneReposResult,
  CloneResult,
  RepoEntry,
} from "@journeyman/core";
import { buildCloneUrl } from "./build-clone-url.ts";

const execFileP = promisify(execFile);

function normalizeEntries(opts: CloneReposOptions): RepoEntry[] {
  const raw = Array.isArray(opts.repos) ? opts.repos : [opts.repos];
  const defaultBranch = opts.branch ?? "main";
  return raw.map((r) =>
    typeof r === "string" ? { url: r, branch: defaultBranch } : r,
  );
}

function repoFolder(url: string): string {
  return url.split("/").pop()?.replace(/\.git$/, "") ?? "repo";
}

function scrubToken(s: string): string {
  return s.replace(/x-access-token:[^@\s]+@/g, "x-access-token:***@");
}

export async function cloneRepos(
  token: string,
  opts: CloneReposOptions,
): Promise<CloneReposResult> {
  const entries = normalizeEntries(opts);
  const targetDir = opts.targetDir ?? process.cwd();
  try {
    await mkdir(targetDir, { recursive: true });
  } catch (err) {
    return { repos: [], error: `failed to create targetDir: ${(err as Error).message}` };
  }

  const results: CloneResult[] = [];
  for (const entry of entries) {
    const folderName = repoFolder(entry.url);
    const dirPath = `${targetDir}/${folderName}`;
    if (opts.signal?.aborted) {
      results.push({ folderName, dirPath, url: entry.url, branch: entry.branch, error: "aborted" });
      continue;
    }
    let cloneUrl: string;
    try {
      cloneUrl = buildCloneUrl(entry.url, token);
    } catch (err) {
      results.push({ folderName, dirPath, url: entry.url, branch: entry.branch, error: (err as Error).message });
      continue;
    }
    try {
      await execFileP(
        "git",
        ["clone", "--branch", entry.branch, "--single-branch", cloneUrl, dirPath],
        { signal: opts.signal },
      );
      results.push({ folderName, dirPath, url: entry.url, branch: entry.branch });
    } catch (err) {
      const e = err as { stderr?: string; message: string };
      results.push({
        folderName, dirPath, url: entry.url, branch: entry.branch,
        error: scrubToken(e.stderr?.trim() || e.message),
      });
    }
  }

  return { repos: results };
}
```

- [ ] **Step 2: Wire it into `GitHubProvider`**

Replace [packages/git-provider/src/providers/github/index.ts](packages/git-provider/src/providers/github/index.ts) with:

```ts
import type {
  IGitProvider,
  GetRepoOptions, GetRepoResult,
  CreatePROptions, CreatePRResult,
  ListPROptions, ListPRResult,
  CloneReposOptions, CloneReposResult,
  IProviderMeta,
} from "@journeyman/core";
import { connectGitHubMcp, type Client } from "@journeyman/github-mcp";
import { getRepo } from "./operations/get-repo.ts";
import { createPR } from "./operations/create-pr.ts";
import { listPRs } from "./operations/list-prs.ts";
import { cloneRepos } from "./operations/clone-repos.ts";

export type GitHubProviderOptions = {
  /** Personal Access Token. Falls back to GITHUB_ACCESS_TOKEN env var. */
  token?: string;
};

export class GitHubProvider implements IGitProvider {
  static meta: IProviderMeta = {
    id: "github",
    name: "GitHub REST",
    description: "GitHub REST API provider for repos and PRs",
    category: "git",
  };

  private readonly token: string;
  private client?: Client;

  constructor(opts: GitHubProviderOptions = {}) {
    const token = opts.token ?? process.env.GITHUB_ACCESS_TOKEN;
    if (!token) {
      throw new Error("GitHubProvider: PAT required. Pass opts.token or set GITHUB_ACCESS_TOKEN.");
    }
    this.token = token;
  }

  async getRepo(opts: GetRepoOptions): Promise<GetRepoResult> {
    return getRepo(await this.getClient(), opts);
  }

  async createPR(opts: CreatePROptions): Promise<CreatePRResult> {
    return createPR(await this.getClient(), opts);
  }

  async listPRs(opts: ListPROptions): Promise<ListPRResult> {
    return listPRs(await this.getClient(), opts);
  }

  async cloneRepos(opts: CloneReposOptions): Promise<CloneReposResult> {
    return cloneRepos(this.token, opts);
  }

  private async getClient(): Promise<Client> {
    if (!this.client)
      this.client = await connectGitHubMcp({
        token: this.token,
        clientName: "journeyman-git-provider",
        clientVersion: "0.0.1",
      });
    return this.client;
  }
}
```

- [ ] **Step 3: Add `cloneRepos` stub to `GitLabProvider`**

Replace [packages/git-provider/src/providers/gitlab/index.ts](packages/git-provider/src/providers/gitlab/index.ts) with:

```ts
import type { IGitProvider, IProviderMeta } from "@journeyman/core";
import type {
  GetRepoOptions, GetRepoResult,
  CreatePROptions, CreatePRResult,
  ListPROptions, ListPRResult,
  CloneReposOptions, CloneReposResult,
} from "@journeyman/core";

/** GitLab REST API provider. Not yet implemented. */
export class GitLabProvider implements IGitProvider {
  static meta: IProviderMeta = {
    id: "gitlab",
    name: "GitLab REST",
    description: "GitLab REST API provider for projects and MRs",
    category: "git",
  };

  getRepo(_opts: GetRepoOptions): Promise<GetRepoResult> { throw new Error("GitLabProvider.getRepo not implemented"); }
  createPR(_opts: CreatePROptions): Promise<CreatePRResult> { throw new Error("GitLabProvider.createPR not implemented"); }
  async listPRs(_opts: ListPROptions): Promise<ListPRResult> { throw new Error("GitLabProvider.listPRs not implemented"); }
  async cloneRepos(_opts: CloneReposOptions): Promise<CloneReposResult> { throw new Error("GitLabProvider.cloneRepos not implemented"); }
}
```

- [ ] **Step 4: Typecheck `@journeyman/git-provider`**

Run: `cd packages/git-provider && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/git-provider/src/providers/github/operations/clone-repos.ts packages/git-provider/src/providers/github/index.ts packages/git-provider/src/providers/gitlab/index.ts
git commit -m "feat(git-provider): GitHubProvider.cloneRepos via execFile; GitLab stub"
```

---

## Task 5: Create `reset-and-checkout.ts` (replaces `reset-repos.ts`)

**Files:**
- Create: `packages/coding-cli/src/providers/claude/operations/reset-and-checkout.ts`
- Delete: `packages/coding-cli/src/providers/claude/operations/reset-repos.ts`

- [ ] **Step 1: Create the new operation file**

Create `packages/coding-cli/src/providers/claude/operations/reset-and-checkout.ts`:

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { resolveSession } from "../utils/session.ts";
import type {
  ResetAndCheckoutEntry,
  ResetAndCheckoutOptions,
  ResetAndCheckoutResult,
} from "@journeyman/core";

export type { ResetAndCheckoutEntry, ResetAndCheckoutOptions, ResetAndCheckoutResult };

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
          created: { type: "boolean" },
          success: { type: "boolean" },
          error: { type: "string" },
        },
        required: ["folderName", "dirPath", "branch", "created", "success"],
      },
    },
    error: { type: "string" },
  },
  required: ["repos"],
} as const;

type Normalized = ResetAndCheckoutEntry;

function normalizeEntries(opts: ResetAndCheckoutOptions): Normalized[] {
  const raw = Array.isArray(opts.repos) ? opts.repos : [opts.repos];
  return raw.map((r) =>
    typeof r === "string"
      ? {
          dirPath: r,
          branch: opts.branch ?? "main",
          create: opts.create,
          fromBranch: opts.fromBranch,
        }
      : {
          dirPath: r.dirPath,
          branch: r.branch,
          create: r.create ?? opts.create,
          fromBranch: r.fromBranch ?? opts.fromBranch,
        },
  );
}

function buildPrompt(entries: Normalized[]): string {
  const entriesJson = JSON.stringify(entries, null, 2);

  return [
    "For each repo entry, bring the working tree to a clean state on the target branch.",
    "Keep going for all repos even if some fail — record errors per repo.",
    "",
    `Entries:\n${entriesJson}`,
    "",
    "Per repo, execute in order:",
    "1. `git -C <dirPath> fetch origin` — refresh remote refs.",
    "2. `git -C <dirPath> stash --include-untracked` — drop any local changes so checkout is not blocked.",
    "3. Detect branch existence:",
    "   - Local:  `git -C <dirPath> rev-parse --verify refs/heads/<branch>`",
    "   - Remote: `git -C <dirPath> rev-parse --verify refs/remotes/origin/<branch>`",
    "4. If the branch exists locally OR on origin:",
    "     a. `git -C <dirPath> checkout <branch>`",
    "     b. If it exists on origin: `git -C <dirPath> reset --hard origin/<branch>`",
    "     c. `git -C <dirPath> clean -fd` — remove leftover untracked files/dirs.",
    "     d. Set created: false.",
    "5. Else if entry.create is true:",
    "     a. If entry.fromBranch is set: `git -C <dirPath> checkout -b <branch> <fromBranch-ref>`",
    "        where <fromBranch-ref> is `origin/<fromBranch>` if that remote ref exists,",
    "        otherwise the local `<fromBranch>` name.",
    "     b. Else: `git -C <dirPath> checkout -b <branch>` (branches from current HEAD).",
    "     c. Do NOT run `reset --hard` (there is no remote tracking branch yet).",
    "     d. `git -C <dirPath> clean -fd` is optional here; skip it.",
    "     e. Set created: true.",
    "6. Else (does not exist and create is not true):",
    "     Record error: `branch <branch> does not exist and create=false`. created: false, success: false.",
    "",
    "folderName is the basename of dirPath.",
    "On success set success: true, error empty. On failure set success: false and error to the",
    "stderr (or node error message) of whichever git step failed.",
    "",
    "Return JSON matching the output schema: a repos array with one entry per input repo,",
    "plus an optional top-level error only if the whole operation failed before any repo was processed.",
  ].join("\n");
}

/**
 * Resets each repo to a clean state on the target branch. If the branch does
 * not exist and `create` is true, creates it from `fromBranch` (or current HEAD).
 */
export async function resetAndCheckout(
  opts: ResetAndCheckoutOptions,
): Promise<ResetAndCheckoutResult> {
  const entries = normalizeEntries(opts);
  const { sessionId, queryOption } = resolveSession(opts.sessionId);
  const controller = opts.signal
    ? (() => {
        const ac = new AbortController();
        if (opts.signal!.aborted) ac.abort(opts.signal!.reason);
        else opts.signal!.addEventListener("abort", () => ac.abort(opts.signal!.reason), { once: true });
        return ac;
      })()
    : undefined;
  let output: ResetAndCheckoutResult = { repos: [], sessionId };

  for await (const msg of query({
    prompt: buildPrompt(entries),
    options: {
      tools: ["Bash"],
      allowedTools: ["Bash"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 20,
      settingSources: [],
      settings: { allowedMcpServers: [] },
      outputFormat: { type: "json_schema", schema: OUTPUT_SCHEMA },
      ...(controller !== undefined ? { abortController: controller } : {}),
      ...queryOption,
    },
  })) {
    logSdkMessage(msg);
    if (msg.type === "result") {
      if (msg.subtype !== "success") {
        return { repos: [], error: (msg as any).result ?? msg.subtype, sessionId };
      }
      output = { ...(msg.structured_output as ResetAndCheckoutResult), sessionId };
    }
  }

  return output;
}
```

- [ ] **Step 2: Delete the old file**

```bash
git rm packages/coding-cli/src/providers/claude/operations/reset-repos.ts
```

- [ ] **Step 3: Commit**

```bash
git add packages/coding-cli/src/providers/claude/operations/reset-and-checkout.ts
git commit -m "feat(coding-cli): rename resetRepos → resetAndCheckout with branch-create support"
```

---

## Task 6: Update coding-cli providers (remove `cloneRepos`, rename to `resetAndCheckout`)

**Files:**
- Modify: `packages/coding-cli/src/providers/claude/index.ts`
- Modify: `packages/coding-cli/src/providers/gemini/index.ts`
- Modify: `packages/coding-cli/src/providers/codex/index.ts`
- Delete: `packages/coding-cli/src/providers/claude/operations/clone-repos.ts`

- [ ] **Step 1: Delete old clone-repos operation**

```bash
git rm packages/coding-cli/src/providers/claude/operations/clone-repos.ts
```

- [ ] **Step 2: Rewrite `ClaudeProvider`**

Replace [packages/coding-cli/src/providers/claude/index.ts](packages/coding-cli/src/providers/claude/index.ts) with:

```ts
import type { ICodingCLI } from "../../interface.ts";
import type {
  ScanReposOptions, ScanReposResult,
  ResetAndCheckoutOptions, ResetAndCheckoutResult,
  CommitPushReposOptions, CommitPushReposResult,
  CleanupReposOptions, CleanupReposResult,
  CreateWorkspaceOptions, CreateWorkspaceResult,
  IProviderMeta,
} from "@journeyman/core";
import type { AnalyzeOptions, AnalyzeResult, PlanOptions, PlanResult, ImplementOptions, ImplementResult } from "@journeyman/core";
import { scanRepos } from "./operations/scan-repos.ts";
import { resetAndCheckout } from "./operations/reset-and-checkout.ts";
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

  scanRepos(opts: ScanReposOptions): Promise<ScanReposResult> { return scanRepos(opts); }
  resetAndCheckout(opts: ResetAndCheckoutOptions): Promise<ResetAndCheckoutResult> { return resetAndCheckout(opts); }
  commitPushRepos(opts: CommitPushReposOptions): Promise<CommitPushReposResult> { return commitPushRepos(opts); }
  cleanupRepos(opts: CleanupReposOptions): Promise<CleanupReposResult> { return cleanupRepos(opts); }
  createWorkspace(opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> { return createWorkspace(opts); }

  analyze(opts: AnalyzeOptions): Promise<AnalyzeResult> { return analyze(opts); }
  plan(opts: PlanOptions): Promise<PlanResult> { return plan(opts); }
  implement(opts: ImplementOptions): Promise<ImplementResult> { return implement(opts); }
}
```

- [ ] **Step 3: Rewrite `GeminiProvider`**

Replace [packages/coding-cli/src/providers/gemini/index.ts](packages/coding-cli/src/providers/gemini/index.ts) with:

```ts
import type { ICodingCLI } from "../../interface.ts";
import type {
  ScanReposOptions, ScanReposResult,
  ResetAndCheckoutOptions, ResetAndCheckoutResult,
  CommitPushReposOptions, CommitPushReposResult,
  CleanupReposOptions, CleanupReposResult,
  CreateWorkspaceOptions, CreateWorkspaceResult,
  AnalyzeOptions, AnalyzeResult,
  PlanOptions, PlanResult,
  ImplementOptions, ImplementResult,
  IProviderMeta,
} from "@journeyman/core";

/** Gemini coding CLI provider. Not yet implemented. */
export class GeminiProvider implements ICodingCLI {
  static meta: IProviderMeta = {
    id: "gemini",
    name: "Gemini CLI",
    description: "Google Gemini coding CLI",
    category: "coding-cli",
  };

  scanRepos(_opts: ScanReposOptions): Promise<ScanReposResult> { throw new Error("GeminiProvider.scanRepos not implemented"); }
  resetAndCheckout(_opts: ResetAndCheckoutOptions): Promise<ResetAndCheckoutResult> { throw new Error("GeminiProvider.resetAndCheckout not implemented"); }
  commitPushRepos(_opts: CommitPushReposOptions): Promise<CommitPushReposResult> { throw new Error("GeminiProvider.commitPushRepos not implemented"); }
  cleanupRepos(_opts: CleanupReposOptions): Promise<CleanupReposResult> { throw new Error("GeminiProvider.cleanupRepos not implemented"); }
  createWorkspace(_opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> { throw new Error("GeminiProvider.createWorkspace not implemented"); }
  analyze(_opts: AnalyzeOptions): Promise<AnalyzeResult> { throw new Error("GeminiProvider.analyze not implemented"); }
  plan(_opts: PlanOptions): Promise<PlanResult> { throw new Error("GeminiProvider.plan not implemented"); }
  implement(_opts: ImplementOptions): Promise<ImplementResult> { throw new Error("GeminiProvider.implement not implemented"); }
}
```

- [ ] **Step 4: Rewrite `CodexProvider`**

Replace [packages/coding-cli/src/providers/codex/index.ts](packages/coding-cli/src/providers/codex/index.ts) with:

```ts
import type { ICodingCLI } from "../../interface.ts";
import type {
  ScanReposOptions, ScanReposResult,
  ResetAndCheckoutOptions, ResetAndCheckoutResult,
  CommitPushReposOptions, CommitPushReposResult,
  CleanupReposOptions, CleanupReposResult,
  CreateWorkspaceOptions, CreateWorkspaceResult,
  AnalyzeOptions, AnalyzeResult,
  PlanOptions, PlanResult,
  ImplementOptions, ImplementResult,
  IProviderMeta,
} from "@journeyman/core";

/** Codex coding CLI provider. Not yet implemented. */
export class CodexProvider implements ICodingCLI {
  static meta: IProviderMeta = {
    id: "codex",
    name: "Codex CLI",
    description: "OpenAI Codex CLI",
    category: "coding-cli",
  };

  scanRepos(_opts: ScanReposOptions): Promise<ScanReposResult> { throw new Error("CodexProvider.scanRepos not implemented"); }
  resetAndCheckout(_opts: ResetAndCheckoutOptions): Promise<ResetAndCheckoutResult> { throw new Error("CodexProvider.resetAndCheckout not implemented"); }
  commitPushRepos(_opts: CommitPushReposOptions): Promise<CommitPushReposResult> { throw new Error("CodexProvider.commitPushRepos not implemented"); }
  cleanupRepos(_opts: CleanupReposOptions): Promise<CleanupReposResult> { throw new Error("CodexProvider.cleanupRepos not implemented"); }
  createWorkspace(_opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> { throw new Error("CodexProvider.createWorkspace not implemented"); }
  analyze(_opts: AnalyzeOptions): Promise<AnalyzeResult> { throw new Error("CodexProvider.analyze not implemented"); }
  plan(_opts: PlanOptions): Promise<PlanResult> { throw new Error("CodexProvider.plan not implemented"); }
  implement(_opts: ImplementOptions): Promise<ImplementResult> { throw new Error("CodexProvider.implement not implemented"); }
}
```

- [ ] **Step 5: Typecheck `@journeyman/coding-cli`**

Run: `cd packages/coding-cli && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/coding-cli
git commit -m "refactor(coding-cli): drop cloneRepos; rename resetRepos → resetAndCheckout"
```

---

## Task 7: Rename pipeline phase `ResetReposPhase` → `ResetAndCheckoutPhase`

**Files:**
- Create: `packages/pipeline/src/phases/reset-and-checkout-phase.ts`
- Delete: `packages/pipeline/src/phases/reset-repos-phase.ts`
- Modify: `packages/pipeline/src/index.ts`

- [ ] **Step 1: Create the renamed phase file**

Create `packages/pipeline/src/phases/reset-and-checkout-phase.ts`:

```ts
/**
 * @file reset-and-checkout-phase.ts
 * Brings each repo to a clean state on a target branch. Can also create a new
 * branch from a base when the target does not yet exist.
 *
 * Reads:  repoPaths        — list of local repo paths written by cloneRepos.
 * Writes: resetResults     — array of ResetAndCheckoutRepoResult, one per repo.
 *
 * Config:
 * - `branch`     — optional override. When omitted, uses productConfig.repos[i].defaultBranch.
 * - `create`     — when true, create the branch if it does not exist.
 * - `fromBranch` — base ref for creation (default: current HEAD).
 *
 * Side effects: performs `git fetch`, `git stash`, `git checkout`, `git reset --hard`,
 * `git clean -fd` and/or `git checkout -b` on local disk.
 */

import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

type Config = {
  branch?: string;
  create?: boolean;
  fromBranch?: string;
};

export class ResetAndCheckoutPhase extends BasePhase {
  readonly name = "resetAndCheckout";
  static reads = ["repoPaths"] as const;
  static writes = ["resetResults"] as const;

  async run(ctx: PipelineContext, config: Config = {}): Promise<PhaseResult> {
    const repoPaths = this.require<string[]>(ctx, "repoPaths");
    const repos = ctx.productConfig.repos;

    const entries = repoPaths.map((dirPath, i) => ({
      dirPath,
      branch: config.branch ?? repos[i]?.defaultBranch ?? "main",
      create: config.create,
      fromBranch: config.fromBranch,
    }));

    const res = unwrap(await ctx.providers.coding.resetAndCheckout({
      repos: entries,
      sessionId: ctx.sessionId,
      signal: ctx.signal,
    }), "resetAndCheckout");

    for (const r of res.repos) {
      if (r.error) return this.failed(`resetAndCheckout: ${r.error}`);
    }

    return this.ok({ resetResults: res.repos });
  }
}
```

- [ ] **Step 2: Delete the old phase file**

```bash
git rm packages/pipeline/src/phases/reset-repos-phase.ts
```

- [ ] **Step 3: Update pipeline index export**

In [packages/pipeline/src/index.ts](packages/pipeline/src/index.ts), replace line 39:

```ts
export { ResetReposPhase } from "./phases/reset-repos-phase.ts";
```

with:

```ts
export { ResetAndCheckoutPhase } from "./phases/reset-and-checkout-phase.ts";
```

- [ ] **Step 4: Commit**

```bash
git add packages/pipeline/src/phases/reset-and-checkout-phase.ts packages/pipeline/src/index.ts
git commit -m "refactor(pipeline): rename ResetReposPhase → ResetAndCheckoutPhase"
```

---

## Task 8: Update pipeline `CloneReposPhase` to use git provider

**Files:**
- Modify: `packages/pipeline/src/phases/clone-repos-phase.ts:25-47`

- [ ] **Step 1: Switch provider and drop sessionId**

In [packages/pipeline/src/phases/clone-repos-phase.ts](packages/pipeline/src/phases/clone-repos-phase.ts), replace the `run` method body (lines 25-47) with:

```ts
  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const repos = ctx.productConfig.repos;
    if (!repos.length) return this.blocked("product has no repos configured", "manual");

    const entries = repos.map(r => ({ url: r.url, branch: r.defaultBranch }));
    const res = unwrap(await ctx.providers.git.cloneRepos({
      repos: entries,
      targetDir: join(ctx.workspaceDir, "repos"),
      signal: ctx.signal,
    }), "cloneRepos");

    for (const c of res.repos) {
      if (c.error) return this.failed(`cloneRepos: ${c.error}`);
    }

    const repoPaths = res.repos.map(r => r.dirPath);
    return this.ok({
      repoPaths,
      primaryRepoPath: repoPaths[0],
      repoRefs: repos,
    });
  }
```

Key changes: `ctx.providers.coding.cloneRepos` → `ctx.providers.git.cloneRepos`; the `sessionId: ctx.sessionId` line is removed.

- [ ] **Step 2: Commit**

```bash
git add packages/pipeline/src/phases/clone-repos-phase.ts
git commit -m "refactor(pipeline): CloneReposPhase uses git provider instead of coding"
```

---

## Task 9: Update pipeline phase registrations

**Files:**
- Modify: `packages/pipeline/src/cli-commands/run-once.ts`
- Modify: `packages/pipeline/src/cli-commands/validate-config.ts`

- [ ] **Step 1: Update `run-once.ts`**

In [packages/pipeline/src/cli-commands/run-once.ts](packages/pipeline/src/cli-commands/run-once.ts):
- Replace `ResetReposPhase` with `ResetAndCheckoutPhase` in the import list (line 11).
- Replace the registration line `phases.register("resetRepos",      () => new ResetReposPhase());` with:
  ```ts
    phases.register("resetAndCheckout", () => new ResetAndCheckoutPhase());
  ```

- [ ] **Step 2: Update `validate-config.ts`**

In [packages/pipeline/src/cli-commands/validate-config.ts](packages/pipeline/src/cli-commands/validate-config.ts):
- Replace `ResetReposPhase` with `ResetAndCheckoutPhase` in the import list (line 8).
- Replace the registration line with:
  ```ts
      phases.register("resetAndCheckout", () => new ResetAndCheckoutPhase());
  ```

- [ ] **Step 3: Typecheck pipeline**

Run: `cd packages/pipeline && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/pipeline/src/cli-commands/run-once.ts packages/pipeline/src/cli-commands/validate-config.ts
git commit -m "refactor(pipeline): register resetAndCheckout instead of resetRepos"
```

---

## Task 10: Full workspace verification

- [ ] **Step 1: Typecheck every package**

Run: `npm run typecheck`
Expected: every workspace package reports no errors.

- [ ] **Step 2: Re-run the buildCloneUrl unit test**

Run: `npx tsx packages/git-provider/src/providers/github/operations/build-clone-url.test.ts`
Expected: `buildCloneUrl: all assertions passed`.

- [ ] **Step 3: Grep for stale references**

Run: `grep -rn "ResetReposPhase\|resetRepos\|coding\.cloneRepos\|ResetReposOptions\|ResetReposResult\|ResetEntry" packages --include="*.ts" | grep -v node_modules`
Expected output — allowed residuals only:
- Matches inside `docs/` (plan/spec) — ignore.
- Matches inside `packages/coding-cli/src/providers/claude/operations/analyze.ts`, `plan.ts`, `implement.ts` — these are **sample ticket text strings** (e.g. "JM-42: Add a `dry-run` flag to resetRepos..."). Leave those alone; they're fixture content, not code references.
- No other matches. If any real code references remain, fix them inline with a follow-up small commit.

- [ ] **Step 4: Final commit (only if Step 3 surfaced fixes)**

```bash
git status
# If there are changes, commit them with: "fix: cleanup stale resetRepos references"
```

---

## Manual Smoke Validation (post-merge)

On a host with **no global git credentials**:

1. `export GITHUB_ACCESS_TOKEN=<valid PAT with repo scope>`
2. In a throwaway script:
   ```ts
   import { GitHubProvider } from "@journeyman/git-provider";
   import { ClaudeProvider } from "@journeyman/coding-cli";
   const gh = new GitHubProvider();
   const cli = new ClaudeProvider();
   const r = await gh.cloneRepos({
     repos: ["https://github.com/<YOUR_ORG>/<PRIVATE_REPO>"],
     targetDir: "/tmp/jm-smoke",
   });
   console.log(r);
   const rc = await cli.resetAndCheckout({
     repos: [{ dirPath: r.repos[0].dirPath, branch: "feature/smoke-" + Date.now(), create: true, fromBranch: "main" }],
   });
   console.log(rc);
   ```
3. Verify clone succeeded, `.git/config` contains `x-access-token:` in the `[remote "origin"]` url, `r.repos[0].url` is the ORIGINAL URL, and `rc.repos[0].created === true` on the new feature branch.
4. Make a trivial file edit, then run `cli.commitPushRepos(...)` and verify `pushed: true` without configuring any additional auth.
