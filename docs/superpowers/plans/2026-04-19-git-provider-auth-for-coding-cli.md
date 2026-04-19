# Re-home `cloneRepos` to `@journeyman/git-provider` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move deterministic `cloneRepos` out of `@journeyman/coding-cli` and into `@journeyman/git-provider`. In `git-provider`, implement it with `node:child_process.execFile` (no Claude SDK). The GitHub PAT already held by `GitHubProvider` is embedded into the HTTPS clone URL so the host needs only the `git` binary — no SSH keys, no credential helper. All checkout/reset concerns are deliberately out of scope; we'll handle those later.

**Architecture:** `git-provider` owns auth + deterministic local git operations. `GitHubProvider.cloneRepos` builds `https://x-access-token:<pat>@github.com/<owner>/<repo>.git` and runs `git clone` via `execFile`. The token persists in the cloned `.git/config`, so later `git push` from `commitPushRepos` (unchanged, stays in `coding-cli`) Just Works. `coding-cli.cloneRepos` is deleted.

**Tech Stack:** TypeScript (NodeNext), `node:child_process.execFile`, `node:fs/promises`, `node:assert/strict`. Tests are single-file scripts run via `npx tsx path/to/foo.test.ts` (pattern: [session.test.ts](packages/coding-cli/src/providers/claude/utils/session.test.ts)).

**Spec:** [2026-04-19-git-provider-auth-for-coding-cli-design.md](../specs/2026-04-19-git-provider-auth-for-coding-cli-design.md)

**Out of scope (follow-up):** renaming `resetRepos` → `resetAndCheckout`, adding branch-create support, any new checkout phase. `resetRepos` stays exactly as it is today.

---

## File Map

**Create**
- `packages/git-provider/src/providers/github/operations/build-clone-url.ts` — pure URL rewriter helper
- `packages/git-provider/src/providers/github/operations/build-clone-url.test.ts` — unit tests
- `packages/git-provider/src/providers/github/operations/clone-repos.ts` — `cloneRepos` implementation

**Modify**
- `packages/core/src/types/git.types.ts` — drop `SessionOptions`/`SessionResult` extension from `CloneReposOptions`/`CloneReposResult`
- `packages/core/src/interfaces/git-provider.interface.ts` — add `cloneRepos`
- `packages/core/src/interfaces/coding-cli.interface.ts` — remove `cloneRepos`
- `packages/git-provider/src/providers/github/index.ts` — wire `cloneRepos`
- `packages/git-provider/src/providers/gitlab/index.ts` — add `cloneRepos` stub
- `packages/coding-cli/src/providers/claude/index.ts` — remove `cloneRepos` method + import
- `packages/coding-cli/src/providers/gemini/index.ts` — remove `cloneRepos` stub + import
- `packages/coding-cli/src/providers/codex/index.ts` — remove `cloneRepos` stub + import
- `packages/pipeline/src/phases/clone-repos-phase.ts` — switch to `ctx.providers.git.cloneRepos`; drop `sessionId` arg

**Delete**
- `packages/coding-cli/src/providers/claude/operations/clone-repos.ts`

---

## Task 1: Update `@journeyman/core` types

**Files:**
- Modify: `packages/core/src/types/git.types.ts:7-28`

- [ ] **Step 1: Drop Session extension from clone types**

In [packages/core/src/types/git.types.ts](packages/core/src/types/git.types.ts), replace lines 7-28 (the block from `export type RepoEntry` through the end of `CloneReposResult`, **stopping just before `ScanReposOptions`**) with:

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
```

Leave the `SessionOptions`/`SessionResult` import at the top untouched — other types in this file still use it. Leave `ResetReposOptions`/`ResetReposResult`/`ResetEntry` untouched.

- [ ] **Step 2: Typecheck `@journeyman/core`**

Run: `cd packages/core && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types/git.types.ts
git commit -m "feat(core): drop session from CloneRepos types"
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

- [ ] **Step 2: Remove `cloneRepos` from `ICodingCLI`**

In [packages/core/src/interfaces/coding-cli.interface.ts](packages/core/src/interfaces/coding-cli.interface.ts):
- Remove `CloneReposOptions, CloneReposResult,` from the type import list (line 2).
- Delete the line `cloneRepos(opts: CloneReposOptions): Promise<CloneReposResult>;` (line 17).

Resulting file:

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
 * Covers git operations run via CLI and AI-powered analyze/plan/implement.
 */
export interface ICodingCLI {
  // Git operations (executed via CLI bash)
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

- [ ] **Step 3: Typecheck `@journeyman/core`**

Run: `cd packages/core && npx tsc --noEmit`
Expected: no errors. (Downstream packages will fail; we fix them in later tasks.)

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/interfaces/git-provider.interface.ts packages/core/src/interfaces/coding-cli.interface.ts
git commit -m "feat(core): move cloneRepos from ICodingCLI to IGitProvider"
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

- [ ] **Step 1: Implement the operation**

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

## Task 5: Remove `cloneRepos` from `@journeyman/coding-cli`

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

In [packages/coding-cli/src/providers/claude/index.ts](packages/coding-cli/src/providers/claude/index.ts):
- Remove `CloneReposOptions, CloneReposResult,` from the type import list.
- Remove the `import { cloneRepos } from "./operations/clone-repos.ts";` line.
- Delete the `cloneRepos(...) { return cloneRepos(opts); }` method.

- [ ] **Step 3: Update `GeminiProvider`**

In [packages/coding-cli/src/providers/gemini/index.ts](packages/coding-cli/src/providers/gemini/index.ts):
- Remove `CloneReposOptions, CloneReposResult,` from the type import list.
- Delete the `cloneRepos(...)` stub method.

- [ ] **Step 4: Update `CodexProvider`**

In [packages/coding-cli/src/providers/codex/index.ts](packages/coding-cli/src/providers/codex/index.ts):
- Remove `CloneReposOptions, CloneReposResult,` from the type import list.
- Delete the `cloneRepos(...)` stub method.

- [ ] **Step 5: Typecheck `@journeyman/coding-cli`**

Run: `cd packages/coding-cli && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/coding-cli
git commit -m "refactor(coding-cli): drop cloneRepos (now owned by git-provider)"
```

---

## Task 6: Update pipeline `CloneReposPhase` to use git provider

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

Key changes: `ctx.providers.coding.cloneRepos` → `ctx.providers.git.cloneRepos`; the `sessionId: ctx.sessionId` line is removed (`CloneReposOptions` no longer extends `SessionOptions`).

- [ ] **Step 2: Typecheck `@journeyman/pipeline`**

Run: `cd packages/pipeline && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/pipeline/src/phases/clone-repos-phase.ts
git commit -m "refactor(pipeline): CloneReposPhase uses git provider instead of coding"
```

---

## Task 7: Full workspace verification

- [ ] **Step 1: Typecheck every package**

Run: `npm run typecheck`
Expected: every workspace package reports no errors.

- [ ] **Step 2: Re-run the buildCloneUrl unit test**

Run: `npx tsx packages/git-provider/src/providers/github/operations/build-clone-url.test.ts`
Expected: `buildCloneUrl: all assertions passed`.

- [ ] **Step 3: Grep for stale references — sanity**

Run: `grep -rn "coding\.cloneRepos\|\.cloneRepos" packages --include="*.ts" | grep -v node_modules | grep -v "git-provider"`
Expected: no matches. Every remaining `cloneRepos` call should be on the `git` provider or in `git-provider` source.

- [ ] **Step 4: Final commit (only if Step 3 surfaced fixes)**

```bash
git status
# If there are changes, commit them with: "fix: cleanup stale cloneRepos references"
```

---

## Manual Smoke Validation (post-merge, not part of checklist)

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
   ```
3. Verify clone succeeded, `.git/config` of the clone contains `x-access-token:` in the `[remote "origin"]` url, and `r.repos[0].url` is the ORIGINAL (non-tokenized) URL.
4. Make a trivial file edit in the cloned dir, then run `codingCli.commitPushRepos({ repos: [{ dirPath: r.repos[0].dirPath }], ticket: "SMOKE-1" })` — expect `pushed: true` without any additional auth setup.
