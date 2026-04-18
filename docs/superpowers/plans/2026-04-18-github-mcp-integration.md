# GitHub MCP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `GitHubProvider.getRepo` and `GitHubProvider.createPR` by calling the official remote-hosted GitHub MCP server (`https://api.githubcopilot.com/mcp/`) via the MCP TypeScript SDK, authenticated with a Personal Access Token.

**Architecture:** MCP-as-RPC. `GitHubProvider` constructs a single `Client` connected over `StreamableHTTPClientTransport` to the GitHub MCP server, authenticated via PAT in the `Authorization` header. Operations are thin functions that invoke MCP tools (`get_repository`, `create_pull_request`) and map the JSON payloads to the `@journeyman/core` result types.

**Tech Stack:** TypeScript (ESM, Node), `@modelcontextprotocol/sdk` v1.x, `@journeyman/core` interfaces.

**Spec:** [docs/superpowers/specs/2026-04-18-github-mcp-integration-design.md](../specs/2026-04-18-github-mcp-integration-design.md)

---

## File Structure

**Create:**
- `packages/git-provider/src/providers/github/mcp-client.ts` — connect helper + `callTool` JSON-parsing wrapper.
- `packages/git-provider/src/providers/github/operations/get-repo.ts` — wraps MCP `get_repository`.
- `packages/git-provider/src/providers/github/operations/create-pr.ts` — wraps MCP `create_pull_request`.

**Modify:**
- `packages/git-provider/package.json` — add `@modelcontextprotocol/sdk` dependency.
- `packages/git-provider/src/providers/github/index.ts` — replace stub with real `GitHubProvider` class.

No test files: this repo has no provider test infrastructure (per CLAUDE.md and the spec). Verification is `npm run typecheck` plus a runnable `main()` block in each operation file.

---

## Task 1: Add `@modelcontextprotocol/sdk` Dependency

**Files:**
- Modify: `packages/git-provider/package.json`

- [ ] **Step 1: Add dependency to package.json**

Edit `packages/git-provider/package.json`, change the `dependencies` block from:

```json
"dependencies": {
  "@journeyman/core": "*"
}
```

to:

```json
"dependencies": {
  "@journeyman/core": "*",
  "@modelcontextprotocol/sdk": "^1.0.0"
}
```

If `npm view @modelcontextprotocol/sdk version` reports a newer major (e.g. `2.x`), pin to the latest `1.x` available — do not jump majors without re-validating the import paths in Task 3.

- [ ] **Step 2: Install**

Run from the repo root: `npm install`
Expected: installs `@modelcontextprotocol/sdk` into the workspace; no peer-dep warnings other than pre-existing ones.

- [ ] **Step 3: Verify install resolved correctly**

Run: `npm ls @modelcontextprotocol/sdk -w @journeyman/git-provider`
Expected: prints the resolved version under `@journeyman/git-provider`.

- [ ] **Step 4: Commit**

```bash
git add packages/git-provider/package.json package-lock.json
git commit -m "feat(git-provider): add @modelcontextprotocol/sdk dependency"
```

---

## Task 2: Create MCP Client Wrapper

**Files:**
- Create: `packages/git-provider/src/providers/github/mcp-client.ts`

- [ ] **Step 1: Write `mcp-client.ts`**

Create `packages/git-provider/src/providers/github/mcp-client.ts` with:

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/";

export async function connectGitHubMcp(token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(GITHUB_MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client(
    { name: "journeyman-git-provider", version: "0.0.1" },
    { capabilities: {} },
  );
  await client.connect(transport);
  return client;
}

export async function callTool<T>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) {
    throw new Error(`MCP tool '${name}' failed: ${JSON.stringify(res.content)}`);
  }
  const content = res.content as Array<{ type: string; text?: string }>;
  const text = content.find((c) => c.type === "text")?.text;
  if (!text) throw new Error(`MCP tool '${name}' returned no text content`);
  return JSON.parse(text) as T;
}
```

- [ ] **Step 2: Type-check**

Run from the repo root: `npm run typecheck`
Expected: PASSES. If the SDK's import paths differ in the installed version (e.g. `@modelcontextprotocol/sdk/client` instead of `.../client/index.js`), adjust the two `import` lines to whatever the installed SDK exports — confirm by reading `node_modules/@modelcontextprotocol/sdk/package.json` `exports` field.

- [ ] **Step 3: Commit**

```bash
git add packages/git-provider/src/providers/github/mcp-client.ts
git commit -m "feat(git-provider): add GitHub MCP client wrapper"
```

---

## Task 3: Implement `getRepo` Operation

**Files:**
- Create: `packages/git-provider/src/providers/github/operations/get-repo.ts`

- [ ] **Step 1: Write `get-repo.ts`**

Create `packages/git-provider/src/providers/github/operations/get-repo.ts` with:

```ts
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { GetRepoOptions, GetRepoResult } from "@journeyman/core";
import { callTool } from "../mcp-client.ts";

type GitHubRepoPayload = {
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string;
};

export async function getRepo(
  client: Client,
  opts: GetRepoOptions,
): Promise<GetRepoResult> {
  try {
    const r = await callTool<GitHubRepoPayload>(client, "get_repository", {
      owner: opts.owner,
      repo: opts.repo,
    });
    return {
      name: r.name,
      fullName: r.full_name,
      url: r.html_url,
      defaultBranch: r.default_branch,
    };
  } catch (e) {
    return {
      name: "",
      fullName: "",
      url: "",
      defaultBranch: "",
      error: (e as Error).message,
    };
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`
Expected: PASSES.

- [ ] **Step 3: Commit**

```bash
git add packages/git-provider/src/providers/github/operations/get-repo.ts
git commit -m "feat(git-provider): add GitHub getRepo operation via MCP"
```

---

## Task 4: Implement `createPR` Operation

**Files:**
- Create: `packages/git-provider/src/providers/github/operations/create-pr.ts`

- [ ] **Step 1: Write `create-pr.ts`**

Create `packages/git-provider/src/providers/github/operations/create-pr.ts` with:

```ts
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CreatePROptions, CreatePRResult } from "@journeyman/core";
import { callTool } from "../mcp-client.ts";

type GitHubPRPayload = {
  id: number;
  number: number;
  html_url: string;
};

export async function createPR(
  client: Client,
  opts: CreatePROptions,
): Promise<CreatePRResult> {
  try {
    const r = await callTool<GitHubPRPayload>(client, "create_pull_request", {
      owner: opts.owner,
      repo: opts.repo,
      title: opts.title,
      body: opts.body,
      head: opts.sourceBranch,
      base: opts.targetBranch,
    });
    return { id: String(r.id), url: r.html_url, number: r.number };
  } catch (e) {
    return { id: "", url: "", number: 0, error: (e as Error).message };
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`
Expected: PASSES.

- [ ] **Step 3: Commit**

```bash
git add packages/git-provider/src/providers/github/operations/create-pr.ts
git commit -m "feat(git-provider): add GitHub createPR operation via MCP"
```

---

## Task 5: Replace `GitHubProvider` Stub

**Files:**
- Modify: `packages/git-provider/src/providers/github/index.ts`

- [ ] **Step 1: Replace the file contents**

Overwrite `packages/git-provider/src/providers/github/index.ts` with:

```ts
import type {
  IGitProvider,
  GetRepoOptions,
  GetRepoResult,
  CreatePROptions,
  CreatePRResult,
} from "@journeyman/core";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { connectGitHubMcp } from "./mcp-client.ts";
import { getRepo } from "./operations/get-repo.ts";
import { createPR } from "./operations/create-pr.ts";

export type GitHubProviderOptions = {
  /** Personal Access Token. Falls back to GITHUB_PERSONAL_ACCESS_TOKEN env var. */
  token?: string;
};

export class GitHubProvider implements IGitProvider {
  private readonly token: string;
  private client?: Client;

  constructor(opts: GitHubProviderOptions = {}) {
    const token = opts.token ?? process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    if (!token) {
      throw new Error(
        "GitHubProvider: PAT required. Pass opts.token or set GITHUB_PERSONAL_ACCESS_TOKEN.",
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

  private async getClient(): Promise<Client> {
    if (!this.client) this.client = await connectGitHubMcp(this.token);
    return this.client;
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npm run typecheck`
Expected: PASSES across all workspace packages.

- [ ] **Step 3: Commit**

```bash
git add packages/git-provider/src/providers/github/index.ts
git commit -m "feat(git-provider): wire GitHubProvider to MCP-backed operations"
```

---

## Task 6: Verify Tool Names & Argument Shapes Against Live MCP Server

This task confirms the assumed MCP tool names (`get_repository`, `create_pull_request`) and argument keys actually match what the GitHub MCP server exposes. Skip only if you have already done this in another task.

**Files:** none modified unless a name differs.

- [ ] **Step 1: Create a one-off list-tools probe**

Create `packages/git-provider/scripts/list-mcp-tools.ts`:

```ts
import { connectGitHubMcp } from "../src/providers/github/mcp-client.ts";

const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
if (!token) throw new Error("set GITHUB_PERSONAL_ACCESS_TOKEN");

const client = await connectGitHubMcp(token);
const tools = await client.listTools();
for (const t of tools.tools) {
  console.log(t.name, "—", t.description?.slice(0, 80) ?? "");
}
```

- [ ] **Step 2: Run the probe**

Run: `GITHUB_PERSONAL_ACCESS_TOKEN=<your-pat> npx tsx packages/git-provider/scripts/list-mcp-tools.ts`
Expected: prints a list of tool names. Confirm `get_repository` and `create_pull_request` are present.

- [ ] **Step 3: Adjust if names differ**

If the actual names differ (e.g. `get_repo`, `create_pr`), update the string passed to `callTool(...)` in `operations/get-repo.ts` and/or `operations/create-pr.ts`. If argument keys differ (e.g. `source_branch` instead of `head`), update the `arguments` object in the operation files. Re-run `npm run typecheck`.

- [ ] **Step 4: Delete the probe script**

```bash
rm packages/git-provider/scripts/list-mcp-tools.ts
rmdir packages/git-provider/scripts 2>/dev/null || true
```

- [ ] **Step 5: Commit any name/arg corrections**

If you made changes in Step 3:

```bash
git add packages/git-provider/src/providers/github/operations
git commit -m "fix(git-provider): align MCP tool names with live GitHub MCP server"
```

If you made no changes, skip the commit.

---

## Task 7: Manual Smoke Test — `getRepo`

**Files:** none created or modified.

- [ ] **Step 1: Run a one-line check**

Run from the repo root (replace `<your-pat>`):

```bash
GITHUB_PERSONAL_ACCESS_TOKEN=<your-pat> npx tsx -e "import('./packages/git-provider/src/providers/github/index.ts').then(async ({ GitHubProvider }) => { const p = new GitHubProvider(); console.log(await p.getRepo({ owner: 'octocat', repo: 'Hello-World' })); })"
```

Expected: prints an object like:

```
{
  name: 'Hello-World',
  fullName: 'octocat/Hello-World',
  url: 'https://github.com/octocat/Hello-World',
  defaultBranch: 'master'
}
```

If the result has an `error` field instead, debug:
- 401/403 → PAT scopes (needs at minimum `public_repo` for the smoke test target).
- Tool-not-found → re-run Task 6.
- Field name mismatch → adjust mapping in `operations/get-repo.ts`.

---

## Task 8: Manual Smoke Test — `createPR`

**Files:** none created or modified. Requires a scratch repo you control with a non-default branch ready to PR.

- [ ] **Step 1: Prepare a scratch branch**

In a repo you own (call it `<owner>/<repo>`), push a branch named `journeyman-mcp-test` with at least one commit ahead of `main` (or whatever the default branch is).

- [ ] **Step 2: Run a one-line check**

Replace `<your-pat>`, `<owner>`, `<repo>`, and `<base-branch>`:

```bash
GITHUB_PERSONAL_ACCESS_TOKEN=<your-pat> npx tsx -e "import('./packages/git-provider/src/providers/github/index.ts').then(async ({ GitHubProvider }) => { const p = new GitHubProvider(); console.log(await p.createPR({ owner: '<owner>', repo: '<repo>', title: 'journeyman MCP smoke test', body: 'created via @journeyman/git-provider', sourceBranch: 'journeyman-mcp-test', targetBranch: '<base-branch>' })); })"
```

Expected: prints `{ id: '<numeric-string>', url: 'https://github.com/.../pull/N', number: N }` and the PR appears on GitHub.

If `error` is set, debug:
- 422 "No commits between" → the source branch has no diff vs target.
- 401/403 → PAT needs `repo` scope on this repository.
- Tool/arg mismatch → re-run Task 6.

- [ ] **Step 3: Close the test PR on GitHub**

Manually close (don't merge) the PR created in Step 2 to keep the scratch repo tidy.

---

## Task 9: Final Verification

**Files:** none.

- [ ] **Step 1: Type-check the whole monorepo**

Run from the repo root: `npm run typecheck`
Expected: PASSES across `core`, `coding-cli`, `git-provider`, `ticket-provider`, `notification-provider`.

- [ ] **Step 2: Confirm git status is clean**

Run: `git status`
Expected: `nothing to commit, working tree clean`. All work from Tasks 1–6 is committed; Tasks 7–8 produced no files.

- [ ] **Step 3: Confirm the commit log**

Run: `git log --oneline master..HEAD`
Expected: 5–6 commits (one per Task 1–5, plus Task 6 only if names needed correction).
