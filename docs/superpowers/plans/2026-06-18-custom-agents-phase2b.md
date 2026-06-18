# Custom Agents — Phase 2b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make a git **Connection's** credential actually authenticate an agent's repository work at run time — for both local and sandboxed runs — and implement **GitLab cloning + merge-request creation** so GitLab connections are fully usable (not list-only).

**Architecture:** Phase 2 stored `connectionId` on `Agent.repoSelections` and can list a connection's repos, but the agent-run clone still uses the ambient env token (and the sandbox has no git auth at all — a known limitation). Phase 2b: the compiler passes the repo's `gitConnectionId` into the `agent-run` step; the handler resolves that connection's token (decrypt the sealed credential via the connections store + `open()`) and threads it to the git provider — embedded in authenticated clone URLs so it works **inside the sandbox container** too. GitLab gets real `cloneRepos` (token-in-URL) and `createPR` (REST MR).

**Tech Stack:** TypeScript (ESM, `.ts`), Postgres (`pg`), the existing `@journeyman/git-provider` + `@journeyman/connections` + `@journeyman/secrets` packages. Spec: `docs/superpowers/specs/2026-06-17-custom-agents-design.md` (§7.2, §15b).

**Key constraint (the hard part):** sandboxed runs clone via `SandboxInstanceGitProvider` (shells `git` *inside the container* through `ctx.exec`). The container does not inherit the worker's resolved env, so the token must travel **in the clone URL** (`https://x-access-token:<token>@github.com/owner/repo.git` for GitHub; `https://oauth2:<token>@<host>/group/repo.git` for GitLab), exactly as the local GitHub `build-clone-url` already does. Threading the token to `SandboxInstanceGitProvider` is therefore mandatory.

---

## Pre-flight: verify the clone-auth mechanism

- [ ] **Step 1: Read the sandbox clone path**

Read these and confirm how a clone authenticates today:
- `packages/orchestrator/src/sandbox/sandbox-instance-git-provider.ts` — how `cloneRepos` shells `git` via `ctx.exec`; does it accept a token / build a URL, or rely on container creds?
- `packages/git-provider/src/providers/github/operations/build-clone-url.ts` — the exact token-embedding format for GitHub.
- `packages/git-provider/src/providers/github/operations/clone-repos.ts` — how `cloneRepos(token, opts)` builds the URL + runs git + returns `CloneResult[]`.
- `packages/orchestrator/src/workers/steps/agent-run-step-handler.ts` — the clone block (`ctx.exec ? new SandboxInstanceGitProvider(ctx.exec) : this.deps.git(provider, ctx.env)`).

Confirm the decision: **token goes in the clone URL** (works in-container) rather than container env. If `SandboxInstanceGitProvider` currently takes no token, Tasks 3–4 add one.

---

## Task 1: Pass the repo connection id through the compiler

**Files:**
- Modify: `packages/agents/src/compile.ts`
- Test: `packages/agents/src/compile.test.ts`

- [ ] **Step 1: Add the failing assertion**

In `packages/agents/src/compile.test.ts`, extend the first test:

```typescript
    expect(stepNode.config!.gitConnectionId).toBe(undefined); // baseAgent repo has no connectionId
```

Then add a focused test:

```typescript
  it("passes the repo's connectionId as gitConnectionId", () => {
    const agent = { ...baseAgent, repoSelections: [{ repo: "acme/api", allowWrites: false, connectionId: "conn-1" }] };
    const { graph } = compileAgentToGraph(agent, { ticketKey: "X" });
    const step = graph.nodes.find((n) => n.stepType === "agent-run")!;
    expect(step.config!.gitConnectionId).toBe("conn-1");
  });
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `npm --workspace @journeyman/agents test -- compile.test.ts`
Expected: FAIL (gitConnectionId undefined / not set).

- [ ] **Step 3: Add gitConnectionId to the compiled config**

In `packages/agents/src/compile.ts`, inside the `agent-run-1` node `config`, add after `repoBranch`:

```typescript
          gitConnectionId: agent.repoSelections.find((r) => r.connectionId)?.connectionId,
```

(Phase 2b assumes one git connection per agent — take the first repo selection that names one.)

- [ ] **Step 4: Run it — expect PASS**

Run: `npm --workspace @journeyman/agents test -- compile.test.ts`
Expected: PASS.

---

## Task 2: GitLab cloneRepos (token-in-URL)

**Files:**
- Create: `packages/git-provider/src/providers/gitlab/operations/clone-repos.ts`
- Modify: `packages/git-provider/src/providers/gitlab/index.ts`

- [ ] **Step 1: Write the GitLab clone operation**

Mirror the GitHub `clone-repos.ts` structure (read it first for the exact `CloneReposOptions`/`CloneResult` handling, child-process invocation, and per-repo error capture). Create `packages/git-provider/src/providers/gitlab/operations/clone-repos.ts`:

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { parseRepoList } from "@journeyman/core";
import type { CloneReposOptions, CloneReposResult, CloneResult } from "@journeyman/core";

const run = promisify(execFile);

/** Build an authenticated GitLab https clone URL: https://oauth2:<token>@<host>/group/repo.git */
export function buildGitLabCloneUrl(repo: string, token: string, baseUrl: string): string {
  const host = baseUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  // repo may be "group/name", a full https URL, or "group/name.git"
  let path = repo;
  if (/^https?:\/\//.test(repo)) path = repo.replace(/^https?:\/\//, "").split("/").slice(1).join("/");
  path = path.replace(/\.git$/, "");
  return `https://oauth2:${encodeURIComponent(token)}@${host}/${path}.git`;
}

export async function cloneRepos(token: string, baseUrl: string, opts: CloneReposOptions): Promise<CloneReposResult> {
  const repos = parseRepoList(opts.repos as unknown as string | string[]);
  const results: CloneResult[] = [];
  for (const repo of repos) {
    const folderName = repo.replace(/\.git$/, "").split("/").pop() ?? repo;
    const repoDir = join(opts.workspaceDir, folderName);
    const url = buildGitLabCloneUrl(repo, token, baseUrl);
    try {
      const args = ["clone", "--depth", "1", ...(opts.branch ? ["--branch", opts.branch] : []), url, repoDir];
      await run("git", args, { signal: opts.signal });
      results.push({ folderName, repoDir, url: repo, branch: opts.branch ?? "" });
    } catch (err: any) {
      results.push({ folderName, repoDir, url: repo, branch: opts.branch ?? "", error: String(err?.message ?? err) });
    }
  }
  return { repos: results };
}
```

> Match the exact `CloneReposOptions`/`CloneResult` field names from `packages/core/src/types/git.types.ts` (repos, workspaceDir, branch, signal, onLog; folderName, repoDir, url, branch, error?). Adjust the child-process call to mirror the GitHub op's approach (e.g. it may redact the token from logs — replicate that).

- [ ] **Step 2: Wire it into GitLabProvider**

In `packages/git-provider/src/providers/gitlab/index.ts`, import the op and replace the `cloneRepos` stub:

```typescript
import { cloneRepos as gitlabCloneRepos } from "./operations/clone-repos.ts";
// ...
async cloneRepos(opts: CloneReposOptions): Promise<CloneReposResult> {
  if (!this.token) return { repos: [], error: "GitLabProvider: token is required" } as CloneReposResult;
  return gitlabCloneRepos(this.token, this.baseUrl, opts);
}
```

- [ ] **Step 3: Typecheck**

Run: `npm --workspace @journeyman/git-provider run typecheck`
Expected: PASS.

---

## Task 3: GitLab createPR (merge request via REST)

**Files:**
- Create: `packages/git-provider/src/providers/gitlab/operations/create-pr.ts`
- Modify: `packages/git-provider/src/providers/gitlab/index.ts`

- [ ] **Step 1: Read the GitHub createPR**

Read `packages/git-provider/src/providers/github/operations/create-pr.ts` and the `CreatePROptions`/`CreatePRResult` types (`owner, repo, title, head, base, body` → `url, number`).

- [ ] **Step 2: Write the GitLab MR operation**

Create `packages/git-provider/src/providers/gitlab/operations/create-pr.ts`:

```typescript
import type { CreatePROptions, CreatePRResult } from "@journeyman/core";

export async function createPR(token: string, baseUrl: string, opts: CreatePROptions): Promise<CreatePRResult> {
  const host = baseUrl.replace(/\/+$/, "");
  const projectId = encodeURIComponent(`${opts.owner}/${opts.repo}`);
  const res = await fetch(`${host}/api/v4/projects/${projectId}/merge_requests`, {
    method: "POST",
    headers: { "PRIVATE-TOKEN": token, "Content-Type": "application/json" },
    body: JSON.stringify({
      source_branch: opts.head,
      target_branch: opts.base,
      title: opts.title,
      description: opts.body ?? "",
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { url: "", number: 0, error: `GitLab MR create failed: ${res.status} ${text}` } as CreatePRResult;
  }
  const mr = (await res.json()) as { web_url: string; iid: number };
  return { url: mr.web_url, number: mr.iid };
}
```

> Confirm `CreatePRResult` field names (`url`, `number`, optional `error`) against `git.types.ts` and adjust. If the result type has no `error` field, throw on failure instead.

- [ ] **Step 3: Wire into GitLabProvider**

```typescript
import { createPR as gitlabCreatePR } from "./operations/create-pr.ts";
// ...
async createPR(opts: CreatePROptions): Promise<CreatePRResult> {
  if (!this.token) throw new Error("GitLabProvider: token is required");
  return gitlabCreatePR(this.token, this.baseUrl, opts);
}
```

- [ ] **Step 4: Typecheck** — `npm --workspace @journeyman/git-provider run typecheck` → PASS.

---

## Task 4: Thread a token into SandboxInstanceGitProvider

**Files:**
- Modify: `packages/orchestrator/src/sandbox/sandbox-instance-git-provider.ts`

- [ ] **Step 1: Accept an optional token + baseUrl**

Read the file. Add a constructor parameter so it can build authenticated clone URLs in-container:

```typescript
constructor(private exec: ExecFn, private auth?: { provider: string; token: string; baseUrl?: string }) {}
```

- [ ] **Step 2: Use the token when cloning**

In its `cloneRepos`, when `this.auth` is present, build the authenticated URL (GitHub `x-access-token:<token>@github.com`; GitLab `oauth2:<token>@<host>`) for the `git clone` it shells via `this.exec`, instead of cloning the bare URL. Reuse the URL-building logic (export `buildGitLabCloneUrl` from Task 2 and the GitHub equivalent from `build-clone-url.ts`, or inline the two formats). Redact the token from any logged command.

- [ ] **Step 3: Typecheck** — `npm --workspace @journeyman/orchestrator run typecheck` → PASS.

> If `SandboxInstanceGitProvider` is constructed elsewhere without auth, the optional param keeps those call sites compiling.

---

## Task 5: Resolve the connection token in the agent-run handler

**Files:**
- Modify: `packages/orchestrator/src/workers/steps/agent-run-step-handler.ts`
- Modify: `packages/orchestrator/package.json` (add `@journeyman/connections` dep)

- [ ] **Step 1: Add the dependency**

In `packages/orchestrator/package.json` dependencies add `"@journeyman/connections": "*"` (it already depends on `@journeyman/secrets`). Run `npm install`.

- [ ] **Step 2: Resolve + thread the token in the clone block**

In `agent-run-step-handler.ts`, replace the clone block so that when `input.gitConnectionId` is present it resolves the connection's token and passes it to whichever provider clones:

```typescript
import { getConnection, getConnectionSealed } from "@journeyman/connections";
import { open } from "@journeyman/secrets";
// ...
const repos = parseRepoList(input.repos as string | string[] | undefined);
if (repos.length > 0) {
  const gitConnectionId = typeof input.gitConnectionId === "string" ? input.gitConnectionId : undefined;
  let auth: { provider: string; token: string; baseUrl?: string } | undefined;
  let providerKey = provider;
  let cloneEnv = ctx.env;
  if (gitConnectionId) {
    const conn = await getConnection(this.deps.pool, gitConnectionId);
    const sealed = await getConnectionSealed(this.deps.pool, gitConnectionId);
    if (conn && sealed) {
      const token = open(sealed);
      providerKey = conn.provider;
      auth = { provider: conn.provider, token, baseUrl: conn.baseUrl };
      // local path: GitHubProvider reads env.GITHUB_ACCESS_TOKEN; GitLabProvider takes token via factory (Task 6)
      cloneEnv = conn.provider === "gitlab"
        ? { ...ctx.env, GITLAB_TOKEN: token, GITLAB_BASE_URL: conn.baseUrl ?? "" }
        : { ...ctx.env, GITHUB_ACCESS_TOKEN: token };
    }
  }
  const git: Pick<IGitProvider, "cloneRepos"> = ctx.exec
    ? new SandboxInstanceGitProvider(ctx.exec, auth)
    : this.deps.git(providerKey, cloneEnv);
  const branch = typeof input.repoBranch === "string" ? input.repoBranch : undefined;
  for (const r of repos) ctx.log(`Cloning ${r}…`);
  const cloneRes = await git.cloneRepos({ repos, workspaceDir: ctx.workspaceDir, branch, signal: ctx.signal });
  if (cloneRes?.error) {
    return { kind: "failure", failure: { errorClass: "CloneReposFailed", message: String(cloneRes.error), retryable: true } };
  }
}
```

- [ ] **Step 3: Typecheck** — `npm --workspace @journeyman/orchestrator run typecheck` → PASS.

---

## Task 6: Extend the cli-worker git factory for GitLab

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 1: Handle the gitlab key**

In the `git` ProviderFactory `switch`, add a `gitlab` case (import `GitLabProvider` from `@journeyman/git-provider`):

```typescript
case "gitlab":
  return new GitLabProvider({ token: env.GITLAB_TOKEN, baseUrl: env.GITLAB_BASE_URL || undefined });
```

- [ ] **Step 2: Typecheck** — `npm --workspace @journeyman/orchestrator run typecheck` → PASS.

---

## Task 7: Update the agent-run unit test for connection auth

**Files:**
- Modify: `packages/orchestrator/src/workers/steps/agent-run-step-handler.test.ts`

- [ ] **Step 1: Add a test that a connection token is resolved**

Add a pool mock returning a connection + sealed credential, set `gitConnectionId` on the input, and assert the local git factory is called with an env containing the resolved token (or that `SandboxInstanceGitProvider` was constructed with `auth`). Mock `@journeyman/connections` (`getConnection`, `getConnectionSealed`) and `@journeyman/secrets` (`open`) with `vi.mock`:

```typescript
vi.mock("@journeyman/connections", () => ({
  getConnection: vi.fn().mockResolvedValue({ provider: "github", baseUrl: undefined }),
  getConnectionSealed: vi.fn().mockResolvedValue({ ciphertext: Buffer.from(""), iv: Buffer.from(""), authTag: Buffer.from("") }),
}));
vi.mock("@journeyman/secrets", () => ({ open: () => "tok_abc" }));
```

Then assert the `git` factory received an env with `GITHUB_ACCESS_TOKEN: "tok_abc"`.

- [ ] **Step 2: Run the handler tests** — `npm --workspace @journeyman/orchestrator test -- agent-run-step-handler` → PASS.

---

## Task 8: allowWrites push gating (carry the flag through)

**Files:**
- Modify: `packages/agents/src/compile.ts`

- [ ] **Step 1: Pass allowWrites into config**

Add to the `agent-run-1` config: `allowWrites: agent.repoSelections.some((r) => r.allowWrites),`. The agent's instructions + permission grid already constrain pushes; surfacing `allowWrites` lets the handler/runtime enforce `claude/*`-only branches when false (full push-policy enforcement can be a later refinement). Document that v2b only *carries* the flag; branch-policy enforcement in the agentic loop is a follow-up.

- [ ] **Step 2: Typecheck** — `npm --workspace @journeyman/agents run typecheck` → PASS.

---

## Final verification

- [ ] **Step 1: Whole-repo typecheck + boundaries**

Run: `npm run typecheck` (expect exit 0) and `npm run check:boundaries` (expect "clean").

- [ ] **Step 2: Targeted tests**

Run: `npm --workspace @journeyman/agents test` and `npm --workspace @journeyman/orchestrator test -- agent-run-step-handler` → PASS.

- [ ] **Step 3: Manual end-to-end (GitHub, sandboxed)**

With infra up + migrated: create a git Connection (GitHub PAT), create an agent, pick a **private** repo via the connection, enable, Run now on a Docker sandbox. Confirm the clone succeeds **inside the container** (this is the behaviour the old limitation blocked) and the run reaches the model.

- [ ] **Step 4: Commit** (per the working style: one commit at the end)

```bash
git add -A && git commit -m "feat(agents): Phase 2b — connection token clone-auth (incl. sandbox) + GitLab clone/MR"
```

---

## Notes / scope

- **Closes the known limitation** that the sandbox had no git auth (clone-only-public, push-fails). Token now travels in the clone URL, so private clones work in-container.
- **Push/MR auth** for GitLab uses the same connection token; GitHub push continues via the existing path.
- **Branch-policy enforcement** (`allowWrites=false` ⇒ only `claude/*` pushes) is *carried* in Phase 2b but full enforcement inside the agentic loop is a later refinement (the model is instructed to use `claude/*`; hard enforcement is follow-up).
- **Multiple connections per agent** (different repos, different connections) is out of scope — Phase 2b assumes one git connection per agent (first selection wins).
