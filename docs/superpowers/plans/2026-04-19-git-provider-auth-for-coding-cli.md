# Re-home Clone + Add Checkout in git-provider — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move deterministic `cloneRepos` from `@journeyman/coding-cli` into `@journeyman/git-provider` (implemented with `node:child_process`, not the Claude SDK); add a new `checkoutBranch` adapter in the same place; delete the old coding-cli clone path; leave `commitPushRepos` unchanged.

**Architecture:** `git-provider` owns auth + deterministic local git operations. `GitHubProvider.cloneRepos` embeds the PAT into the HTTPS clone URL (`https://x-access-token:<pat>@github.com/...`) and runs `git clone` via `execFile` — the token persists in `.git/config` so subsequent `git push` from `coding-cli.commitPushRepos` works without any extra auth plumbing. `checkoutBranch` is a local-only branch switch/create. Ephemeral workspaces + `cleanupRepos` bound the token's lifetime.

**Tech Stack:** TypeScript (NodeNext), `node:child_process.execFile`, `node:fs/promises`, `node:assert/strict`. Tests are single-file scripts run via `npx tsx path/to/foo.test.ts` (see existing [session.test.ts](packages/coding-cli/src/providers/claude/utils/session.test.ts) as pattern).

**Spec:** [2026-04-19-git-provider-auth-for-coding-cli-design.md](../specs/2026-04-19-git-provider-auth-for-coding-cli-design.md)

---

## File Map

**Create**
- `packages/git-provider/src/providers/github/operations/build-clone-url.ts` — pure URL rewriter helper
- `packages/git-provider/src/providers/github/operations/build-clone-url.test.ts` — unit tests for helper
- `packages/git-provider/src/providers/github/operations/clone-repos.ts` — `cloneRepos` implementation
- `packages/git-provider/src/providers/github/operations/checkout-branch.ts` — `checkoutBranch` implementation
- `packages/git-provider/src/providers/github/operations/checkout-branch.test.ts` — integration test using a real temp git repo

**Modify**
- `packages/core/src/types/git.types.ts` — drop `SessionOptions`/`SessionResult` from `CloneReposOptions`/`CloneReposResult`; add `CheckoutBranchOptions`/`CheckoutBranchResult`
- `packages/core/src/interfaces/git-provider.interface.ts` — add `cloneRepos` and `checkoutBranch`
- `packages/core/src/interfaces/coding-cli.interface.ts` — remove `cloneRepos`
- `packages/git-provider/src/providers/github/index.ts` — wire `cloneRepos` + `checkoutBranch`
- `packages/git-provider/src/providers/gitlab/index.ts` — add two stubs
- `packages/coding-cli/src/providers/claude/index.ts` — remove `cloneRepos` method and import
- `packages/coding-cli/src/providers/gemini/index.ts` — remove `cloneRepos` method and import
- `packages/coding-cli/src/providers/codex/index.ts` — remove `cloneRepos` method and import
- `packages/pipeline/src/phases/clone-repos-phase.ts` — switch `ctx.providers.coding.cloneRepos` → `ctx.providers.git.cloneRepos`; drop `sessionId` from args

**Delete**
- `packages/coding-cli/src/providers/claude/operations/clone-repos.ts`

---

## Task 1: Update `@journeyman/core` types

**Files:**
- Modify: `packages/core/src/types/git.types.ts:7-28`

- [ ] **Step 1: Replace the clone types and append checkout types**

Open [packages/core/src/types/git.types.ts](packages/core/src/types/git.types.ts). Replace lines 7-28 with:

```ts
export type RepoEntry = { url: string; branch: string };
export type ResetEntry = { dirPath: string; branch: string };

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

export type CheckoutBranchOptions = {
  dirPath: string;
  branch: string;
  fromBranch?: string;
  create?: boolean;
  signal?: AbortSignal;
};

export type CheckoutBranchResult = {
  dirPath: string;
  branch: string;
  previousBranch: string;
  created: boolean;
  error?: string;
};
```

Also remove the now-unused `SessionOptions, SessionResult` import at the top **only if** nothing else in the file references them. Search the file — other types (`ScanReposOptions`, `ResetReposOptions`, `GetRepoOptions`, etc.) still use them, so **leave the import alone**.

- [ ] **Step 2: Verify typecheck for `@journeyman/core`**

Run: `cd packages/core && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types/git.types.ts
git commit -m "feat(core): drop session from CloneRepos types; add CheckoutBranch types"
```

---

## Task 2: Update interfaces in `@journeyman/core`

**Files:**
- Modify: `packages/core/src/interfaces/git-provider.interface.ts`
- Modify: `packages/core/src/interfaces/coding-cli.interface.ts:15-28`

- [ ] **Step 1: Extend `IGitProvider`**

Replace the contents of [packages/core/src/interfaces/git-provider.interface.ts](packages/core/src/interfaces/git-provider.interface.ts) with:

```ts
import type {
  CreatePROptions, CreatePRResult,
  GetRepoOptions, GetRepoResult,
  ListPROptions, ListPRResult,
  CloneReposOptions, CloneReposResult,
  CheckoutBranchOptions, CheckoutBranchResult,
} from "../types/git.types.ts";

/**
 * Contract for git hosting providers (GitHub, GitLab).
 * Covers platform API operations (repos, PRs/MRs) AND deterministic local git
 * operations (clone, checkout) that need host credentials.
 */
export interface IGitProvider {
  getRepo(opts: GetRepoOptions): Promise<GetRepoResult>;
  createPR(opts: CreatePROptions): Promise<CreatePRResult>;
  listPRs(opts: ListPROptions): Promise<ListPRResult>;
  cloneRepos(opts: CloneReposOptions): Promise<CloneReposResult>;
  checkoutBranch(opts: CheckoutBranchOptions): Promise<CheckoutBranchResult>;
}
```

- [ ] **Step 2: Remove `cloneRepos` from `ICodingCLI`**

In [packages/core/src/interfaces/coding-cli.interface.ts](packages/core/src/interfaces/coding-cli.interface.ts), delete the `CloneReposOptions, CloneReposResult,` import entries and the `cloneRepos(opts: CloneReposOptions): Promise<CloneReposResult>;` line. Result:

```ts
import type {
  ScanReposOptions, ScanReposResult,
  ResetReposOptions, ResetReposResult,
  CommitPushReposOptions, CommitPushReposResult,
  CleanupReposOptions, CleanupReposResult,
  CreateWorkspaceOptions, CreateWorkspaceResult,
} from "../types/git.types.ts";
import type { AnalyzeOptions, AnalyzeResult, PlanOptions, PlanResult, ImplementOptions, ImplementResult } from "../types/coding.types.ts";

/**
 * Contract for AI coding CLI providers (Claude, Gemini, Codex).
 * Covers git operations that benefit from AI (commit-push with message generation)
 * and AI-powered analyze/plan/implement.
 */
export interface ICodingCLI {
  // Git operations (executed via CLI bash, AI-assisted)
  scanRepos(opts: ScanReposOptions): Promise<ScanReposResult>;
  resetRepos(opts: ResetReposOptions): Promise<ResetReposResult>;
  commitPushRepos(opts: CommitPushReposOptions): Promise<CommitPushReposResult>;
  cleanupRepos(opts: CleanupReposOptions): Promise<CleanupReposResult>;
  createWorkspace(opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult>;

  // AI operations
  analyze(opts: AnalyzeOptions): Promise<AnalyzeResult>;
  plan(opts: PlanOptions): Promise<PlanResult>;
  implement(opts: ImplementOptions): Promise<ImplementResult>;
}
```

- [ ] **Step 3: Verify `@journeyman/core` still typechecks in isolation**

Run: `cd packages/core && npx tsc --noEmit`
Expected: no errors. (Downstream packages will fail; we fix them in subsequent tasks.)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/interfaces/git-provider.interface.ts packages/core/src/interfaces/coding-cli.interface.ts
git commit -m "feat(core): move cloneRepos to IGitProvider; add checkoutBranch"
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

// Rewrites plain https URL without .git suffix
{
  const out = buildCloneUrl("https://github.com/org/repo", "tok");
  assert.equal(out, "https://x-access-token:tok@github.com/org/repo.git");
}

// Rewrites https URL that already has .git
{
  const out = buildCloneUrl("https://github.com/org/repo.git", "tok");
  assert.equal(out, "https://x-access-token:tok@github.com/org/repo.git");
}

// Rejects non-https scheme
{
  assert.throws(
    () => buildCloneUrl("git@github.com:org/repo.git", "tok"),
    /only https:\/\/ URLs supported/,
  );
}

// Rejects non-github.com host
{
  assert.throws(
    () => buildCloneUrl("https://gitlab.com/org/repo", "tok"),
    /only github\.com host supported/,
  );
}

// Rejects empty token
{
  assert.throws(
    () => buildCloneUrl("https://github.com/org/repo", ""),
    /token required/,
  );
}

console.log("buildCloneUrl: all assertions passed");
```

- [ ] **Step 2: Run test — expect failure (module missing)**

Run: `npx tsx packages/git-provider/src/providers/github/operations/build-clone-url.test.ts`
Expected: `Error [ERR_MODULE_NOT_FOUND]` for `./build-clone-url.ts`.

- [ ] **Step 3: Implement the helper**

Create `packages/git-provider/src/providers/github/operations/build-clone-url.ts`:

```ts
/**
 * Build a tokenized HTTPS clone URL for GitHub.
 *
 * Input:  https://github.com/<owner>/<repo> (with or without .git)
 * Output: https://x-access-token:<token>@github.com/<owner>/<repo>.git
 *
 * The returned URL is suitable to pass directly to `git clone`. The token
 * will be persisted in the cloned `.git/config` ("T1-keep" model); callers
 * are responsible for ephemeral workspace cleanup.
 */
export function buildCloneUrl(repoUrl: string, token: string): string {
  if (!token) {
    throw new Error("buildCloneUrl: token required");
  }
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

/** Remove an embedded PAT from a stderr string before surfacing it. */
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
    if (opts.signal?.aborted) {
      results.push({
        folderName: repoFolder(entry.url),
        dirPath: `${targetDir}/${repoFolder(entry.url)}`,
        url: entry.url,
        branch: entry.branch,
        error: "aborted",
      });
      continue;
    }
    const folderName = repoFolder(entry.url);
    const dirPath = `${targetDir}/${folderName}`;
    let cloneUrl: string;
    try {
      cloneUrl = buildCloneUrl(entry.url, token);
    } catch (err) {
      results.push({
        folderName, dirPath, url: entry.url, branch: entry.branch,
        error: (err as Error).message,
      });
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
  GetRepoOptions,
  GetRepoResult,
  CreatePROptions,
  CreatePRResult,
  ListPROptions,
  ListPRResult,
  CloneReposOptions,
  CloneReposResult,
  CheckoutBranchOptions,
  CheckoutBranchResult,
  IProviderMeta,
} from "@journeyman/core";
import { connectGitHubMcp, type Client } from "@journeyman/github-mcp";
import { getRepo } from "./operations/get-repo.ts";
import { createPR } from "./operations/create-pr.ts";
import { listPRs } from "./operations/list-prs.ts";
import { cloneRepos } from "./operations/clone-repos.ts";
import { checkoutBranch } from "./operations/checkout-branch.ts";

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
      throw new Error(
        "GitHubProvider: PAT required. Pass opts.token or set GITHUB_ACCESS_TOKEN.",
      );
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

  async checkoutBranch(opts: CheckoutBranchOptions): Promise<CheckoutBranchResult> {
    return checkoutBranch(opts);
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

Note: `checkoutBranch` operation is introduced in Task 5 — this file will not compile standalone until then. Do not typecheck yet.

- [ ] **Step 3: Commit**

```bash
git add packages/git-provider/src/providers/github/operations/clone-repos.ts packages/git-provider/src/providers/github/index.ts
git commit -m "feat(git-provider): GitHubProvider.cloneRepos via child_process"
```

---

## Task 5: `GitHubProvider.checkoutBranch` — test first

**Files:**
- Test: `packages/git-provider/src/providers/github/operations/checkout-branch.test.ts`
- Create: `packages/git-provider/src/providers/github/operations/checkout-branch.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/git-provider/src/providers/github/operations/checkout-branch.test.ts`:

```ts
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { checkoutBranch } from "./checkout-branch.ts";

const run = promisify(execFile);

async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "jm-checkout-"));
  await run("git", ["-C", dir, "init", "-b", "main"]);
  await run("git", ["-C", dir, "config", "user.email", "t@t.t"]);
  await run("git", ["-C", dir, "config", "user.name", "t"]);
  await writeFile(join(dir, "a.txt"), "a\n");
  await run("git", ["-C", dir, "add", "."]);
  await run("git", ["-C", dir, "commit", "-m", "init"]);
  return dir;
}

// Case 1: create new branch from HEAD
{
  const dir = await makeRepo();
  try {
    const r = await checkoutBranch({ dirPath: dir, branch: "feature/x" });
    assert.equal(r.created, true);
    assert.equal(r.branch, "feature/x");
    assert.equal(r.previousBranch, "main");
    assert.equal(r.error, undefined);
    const { stdout } = await run("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]);
    assert.equal(stdout.trim(), "feature/x");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Case 2: switch to existing branch (no create)
{
  const dir = await makeRepo();
  try {
    await run("git", ["-C", dir, "branch", "feature/y"]);
    const r = await checkoutBranch({ dirPath: dir, branch: "feature/y" });
    assert.equal(r.created, false);
    assert.equal(r.branch, "feature/y");
    assert.equal(r.previousBranch, "main");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Case 3: create: false on non-existent branch → error
{
  const dir = await makeRepo();
  try {
    const r = await checkoutBranch({ dirPath: dir, branch: "nope", create: false });
    assert.ok(r.error && /does not exist/.test(r.error));
    assert.equal(r.created, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

console.log("checkoutBranch: all assertions passed");
```

- [ ] **Step 2: Run test — expect failure (module missing)**

Run: `npx tsx packages/git-provider/src/providers/github/operations/checkout-branch.test.ts`
Expected: `ERR_MODULE_NOT_FOUND` for `./checkout-branch.ts`.

- [ ] **Step 3: Implement `checkoutBranch`**

Create `packages/git-provider/src/providers/github/operations/checkout-branch.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  CheckoutBranchOptions,
  CheckoutBranchResult,
} from "@journeyman/core";

const execFileP = promisify(execFile);

async function currentBranch(dirPath: string): Promise<string> {
  const { stdout } = await execFileP("git", ["-C", dirPath, "rev-parse", "--abbrev-ref", "HEAD"]);
  return stdout.trim();
}

async function branchExists(dirPath: string, branch: string): Promise<boolean> {
  try {
    await execFileP("git", ["-C", dirPath, "rev-parse", "--verify", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

export async function checkoutBranch(
  opts: CheckoutBranchOptions,
): Promise<CheckoutBranchResult> {
  const { dirPath, branch } = opts;
  const create = opts.create ?? true;
  let previousBranch = "";
  try {
    previousBranch = await currentBranch(dirPath);
  } catch (err) {
    return {
      dirPath, branch, previousBranch: "", created: false,
      error: `failed to read current branch: ${(err as Error).message}`,
    };
  }

  const exists = await branchExists(dirPath, branch);

  if (!exists && !create) {
    return {
      dirPath, branch, previousBranch, created: false,
      error: `branch ${branch} does not exist and create=false`,
    };
  }

  try {
    if (exists) {
      await execFileP("git", ["-C", dirPath, "checkout", branch], { signal: opts.signal });
      return { dirPath, branch, previousBranch, created: false };
    }
    const args = ["-C", dirPath, "checkout", "-b", branch];
    if (opts.fromBranch) args.push(opts.fromBranch);
    await execFileP("git", args, { signal: opts.signal });
    return { dirPath, branch, previousBranch, created: true };
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    return {
      dirPath, branch, previousBranch, created: false,
      error: (e.stderr?.trim() || e.message),
    };
  }
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `npx tsx packages/git-provider/src/providers/github/operations/checkout-branch.test.ts`
Expected: `checkoutBranch: all assertions passed`.

- [ ] **Step 5: Typecheck `@journeyman/git-provider`**

Run: `cd packages/git-provider && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/git-provider/src/providers/github/operations/checkout-branch.ts packages/git-provider/src/providers/github/operations/checkout-branch.test.ts
git commit -m "feat(git-provider): GitHubProvider.checkoutBranch + tests"
```

---

## Task 6: `GitLabProvider` stubs

**Files:**
- Modify: `packages/git-provider/src/providers/gitlab/index.ts`

- [ ] **Step 1: Add stub methods**

Replace [packages/git-provider/src/providers/gitlab/index.ts](packages/git-provider/src/providers/gitlab/index.ts) with:

```ts
import type { IGitProvider, IProviderMeta } from "@journeyman/core";
import type {
  GetRepoOptions, GetRepoResult,
  CreatePROptions, CreatePRResult,
  ListPROptions, ListPRResult,
  CloneReposOptions, CloneReposResult,
  CheckoutBranchOptions, CheckoutBranchResult,
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
  async checkoutBranch(_opts: CheckoutBranchOptions): Promise<CheckoutBranchResult> { throw new Error("GitLabProvider.checkoutBranch not implemented"); }
}
```

- [ ] **Step 2: Typecheck `@journeyman/git-provider`**

Run: `cd packages/git-provider && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/git-provider/src/providers/gitlab/index.ts
git commit -m "feat(git-provider): GitLabProvider cloneRepos/checkoutBranch stubs"
```

---

## Task 7: Remove `cloneRepos` from `@journeyman/coding-cli`

**Files:**
- Delete: `packages/coding-cli/src/providers/claude/operations/clone-repos.ts`
- Modify: `packages/coding-cli/src/providers/claude/index.ts`
- Modify: `packages/coding-cli/src/providers/gemini/index.ts`
- Modify: `packages/coding-cli/src/providers/codex/index.ts`

- [ ] **Step 1: Delete the operation file**

```bash
git rm packages/coding-cli/src/providers/claude/operations/clone-repos.ts
```

- [ ] **Step 2: Update `ClaudeProvider`**

Replace [packages/coding-cli/src/providers/claude/index.ts](packages/coding-cli/src/providers/claude/index.ts) with:

```ts
import type { ICodingCLI } from "../../interface.ts";
import type {
  ScanReposOptions, ScanReposResult,
  ResetReposOptions, ResetReposResult,
  CommitPushReposOptions, CommitPushReposResult,
  CleanupReposOptions, CleanupReposResult,
  CreateWorkspaceOptions, CreateWorkspaceResult,
  IProviderMeta,
} from "@journeyman/core";
import type { AnalyzeOptions, AnalyzeResult, PlanOptions, PlanResult, ImplementOptions, ImplementResult } from "@journeyman/core";
import { scanRepos } from "./operations/scan-repos.ts";
import { resetRepos } from "./operations/reset-repos.ts";
import { commitPushRepos } from "./operations/commit-push-repos.ts";
import { cleanupRepos } from "./operations/cleanup-repos.ts";
import { createWorkspace } from "./operations/create-workspace.ts";
import { analyze } from "./operations/analyze.ts";
import { plan } from "./operations/plan.ts";
import { implement } from "./operations/implement.ts";

/**
 * Claude coding CLI provider.
 * Implements ICodingCLI using the Claude Agent SDK internally.
 */
export class ClaudeProvider implements ICodingCLI {
  static meta: IProviderMeta = {
    id: "claude",
    name: "Claude Code CLI",
    description: "AI coding via @anthropic-ai/claude-agent-sdk",
    category: "coding-cli",
  };

  scanRepos(opts: ScanReposOptions): Promise<ScanReposResult> { return scanRepos(opts); }
  resetRepos(opts: ResetReposOptions): Promise<ResetReposResult> { return resetRepos(opts); }
  commitPushRepos(opts: CommitPushReposOptions): Promise<CommitPushReposResult> { return commitPushRepos(opts); }
  cleanupRepos(opts: CleanupReposOptions): Promise<CleanupReposResult> { return cleanupRepos(opts); }
  createWorkspace(opts: CreateWorkspaceOptions): Promise<CreateWorkspaceResult> { return createWorkspace(opts); }

  analyze(opts: AnalyzeOptions): Promise<AnalyzeResult> { return analyze(opts); }
  plan(opts: PlanOptions): Promise<PlanResult> { return plan(opts); }
  implement(opts: ImplementOptions): Promise<ImplementResult> { return implement(opts); }
}
```

- [ ] **Step 3: Update `GeminiProvider`**

In [packages/coding-cli/src/providers/gemini/index.ts](packages/coding-cli/src/providers/gemini/index.ts):
- Remove `CloneReposOptions, CloneReposResult,` from the import list.
- Delete the `cloneRepos(...) { throw new Error("GeminiProvider.cloneRepos not implemented"); }` line.

- [ ] **Step 4: Update `CodexProvider`**

In [packages/coding-cli/src/providers/codex/index.ts](packages/coding-cli/src/providers/codex/index.ts):
- Remove `CloneReposOptions, CloneReposResult,` from the import list.
- Delete the `cloneRepos(...) { throw new Error("CodexProvider.cloneRepos not implemented"); }` line.

- [ ] **Step 5: Typecheck `@journeyman/coding-cli`**

Run: `cd packages/coding-cli && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/coding-cli
git commit -m "refactor(coding-cli): remove cloneRepos; handled by git-provider now"
```

---

## Task 8: Update pipeline `CloneReposPhase`

**Files:**
- Modify: `packages/pipeline/src/phases/clone-repos-phase.ts:29-35`

- [ ] **Step 1: Switch provider and drop sessionId**

In [packages/pipeline/src/phases/clone-repos-phase.ts](packages/pipeline/src/phases/clone-repos-phase.ts), replace the body of `run` (lines 25-47) with:

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

Key changes: `ctx.providers.coding.cloneRepos` → `ctx.providers.git.cloneRepos`, and the `sessionId: ctx.sessionId` line is removed (`CloneReposOptions` no longer has `sessionId`).

- [ ] **Step 2: Typecheck `@journeyman/pipeline`**

Run: `cd packages/pipeline && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/pipeline/src/phases/clone-repos-phase.ts
git commit -m "refactor(pipeline): CloneReposPhase uses git provider instead of coding"
```

---

## Task 9: Full workspace verification

- [ ] **Step 1: Typecheck every package**

Run: `npm run typecheck`
Expected: every workspace package reports no errors.

- [ ] **Step 2: Re-run unit tests added in this plan**

Run:
```bash
npx tsx packages/git-provider/src/providers/github/operations/build-clone-url.test.ts
npx tsx packages/git-provider/src/providers/github/operations/checkout-branch.test.ts
```
Expected: both print `all assertions passed`.

- [ ] **Step 3: Grep for stale references — sanity**

Run: `grep -rn "coding.cloneRepos\|\.cloneRepos" packages --include="*.ts" | grep -v "\.test\.ts" | grep -v "git-provider" | grep -v "node_modules"`
Expected: no matches (every remaining `cloneRepos` call should now be on the `git` provider or in `git-provider` source).

- [ ] **Step 4: Commit if any last cleanup was needed (otherwise skip)**

```bash
git status
# only commit if Steps 1–3 surfaced fixes
```

---

## Manual Smoke Validation (post-merge, not part of task checklist)

On a host with **no global git credentials** (no SSH key loaded, no `~/.netrc`, no credential helper):

1. `export GITHUB_ACCESS_TOKEN=<valid PAT with repo scope>`
2. In a throwaway script:
   ```ts
   import { GitHubProvider } from "@journeyman/git-provider";
   const gh = new GitHubProvider();
   const r = await gh.cloneRepos({
     repos: ["https://github.com/<YOUR_ORG>/<PRIVATE_REPO>"],
     targetDir: "/tmp/jm-smoke",
   });
   console.log(r);
   const c = await gh.checkoutBranch({
     dirPath: r.repos[0].dirPath,
     branch: "feature/smoke-" + Date.now(),
   });
   console.log(c);
   ```
3. Verify clone succeeded, `.git/config` of the clone contains `x-access-token:` in the `[remote "origin"]` url, and `r.repos[0].url` is the ORIGINAL (non-tokenized) URL.
4. Make a trivial file edit in the cloned dir.
5. Run `codingCli.commitPushRepos({ repos: [{ dirPath: r.repos[0].dirPath }], ticket: "SMOKE-1" })` and verify `pushed: true` without configuring any additional git auth.
