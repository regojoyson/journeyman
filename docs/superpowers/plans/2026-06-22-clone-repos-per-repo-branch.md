# Clone-repos per-repo branch — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give both the workflow `clone-repos` step and agents a per-repo checkout branch, sourced from a connection-bound picker, cloned correctly across local/Docker/Windows backends.

**Architecture:** All clone paths converge on `cloneRepos(RepoEntry[])`. A new shared `toRepoEntries()` helper in `@journeyman/core` normalizes repo inputs to `{ url, branch }[]`; the two step handlers and the sandbox provider use it, so per-repo branch flows through one chokepoint. The clone-repos step config becomes `{ repos: {url,branch}[] }` (no standalone `branch`, no legacy back-compat); agents map `repoSelections` (with per-repo `branch`) into the same shape. Blank branch = clone the repo's default (omit `--branch`).

**Tech Stack:** TypeScript, npm workspaces, Zod, Vitest, React (flow-editor + web).

**Constraints (from requester):** No git commits at any step. Run typecheck only at the very end (Task 12). Work on `master` only — do not create a branch or worktree.

**Spec:** [docs/superpowers/specs/2026-06-22-clone-repos-branch-design.md](../specs/2026-06-22-clone-repos-branch-design.md)

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/core/src/to-repo-entries.ts` | Normalize any repos input → `RepoEntry[]` | Create |
| `packages/core/src/to-repo-entries.test.ts` | Unit test for the normalizer | Create |
| `packages/core/src/index.ts` | Export `toRepoEntries` | Modify |
| `packages/orchestrator/src/sandbox/sandbox-instance-git-provider.ts` | Honor per-entry branch in the sandbox clone op | Modify |
| `packages/orchestrator/src/sandbox/sandbox-instance-git-provider.test.ts` | Per-entry branch test | Modify |
| `packages/git-provider/src/providers/github/operations/clone-repos.ts` | Blank-branch fix (omit `--branch`) | Modify |
| `packages/git-provider/src/providers/github/operations/clone-repos.test.ts` | Blank-branch test | Modify |
| `packages/git-provider/src/providers/gitlab/operations/clone-repos.ts` | Blank-branch fix | Modify |
| `packages/steps/src/git/clone-repos.meta.ts` | Schema + input fields → object array, drop `branch` | Modify |
| `packages/steps/src/git/clone-repos.tsx` | Config interface/default/summary/configFields | Modify |
| `packages/orchestrator/src/workers/steps/clone-repos-step-handler.ts` | Use `toRepoEntries`; build sandbox auth from `ctx.connection` | Modify |
| `packages/orchestrator/src/workers/steps/clone-repos-step-handler.test.ts` | Object-array + auth + empty-fail tests | Modify |
| `packages/agents/src/compile.ts` | Emit `repos: {url,branch}[]`; drop `repoBranch` | Modify |
| `packages/agents/src/compile.test.ts` | Update repos assertion | Modify |
| `packages/orchestrator/src/workers/steps/agent-run-step-handler.ts` | Use `toRepoEntries`; drop `repoBranch`; log `r.url` | Modify |
| `packages/flow-editor/src/properties-panel/RepoPicker.tsx` | `{url,branch}[]` value + per-row branch input | Modify |
| `packages/flow-editor/src/properties-panel/ConfigTab.tsx` | Object passthrough for RepoPicker | Modify |
| `packages/web/src/components/agents/sections/WorkspaceSection.tsx` | Per-repo branch input on each row | Modify |

**Note on tests:** logic tasks use TDD (write test → run red → implement → run green). Per-task runs use Vitest on a single file — that is unit testing, not typechecking. The full `npm run typecheck` gate runs once, in Task 12. Pure-UI tasks (9–11) have no existing component-test harness; they are verified by the Task 12 typecheck and manual review.

---

## Task 1: `toRepoEntries` normalizer in core

**Files:**
- Create: `packages/core/src/to-repo-entries.ts`
- Create: `packages/core/src/to-repo-entries.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/to-repo-entries.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toRepoEntries } from "./to-repo-entries.ts";

describe("toRepoEntries", () => {
  it("maps {url,branch}[] preserving per-repo branch", () => {
    expect(toRepoEntries([{ url: "acme/api", branch: "develop" }, { url: "acme/web", branch: "" }]))
      .toEqual([{ url: "acme/api", branch: "develop" }, { url: "acme/web", branch: "" }]);
  });

  it("defaults a missing/blank branch to empty string", () => {
    expect(toRepoEntries([{ url: "acme/api" }])).toEqual([{ url: "acme/api", branch: "" }]);
  });

  it("drops entries with empty url and trims", () => {
    expect(toRepoEntries([{ url: "  acme/api  ", branch: " main " }, { url: "" }]))
      .toEqual([{ url: "acme/api", branch: "main" }]);
  });

  it("accepts a newline/comma string list with a fallback branch", () => {
    expect(toRepoEntries("acme/api\nacme/web", "qa"))
      .toEqual([{ url: "acme/api", branch: "qa" }, { url: "acme/web", branch: "qa" }]);
  });

  it("accepts string[]", () => {
    expect(toRepoEntries(["acme/api", "acme/web"])).toEqual([
      { url: "acme/api", branch: "" }, { url: "acme/web", branch: "" },
    ]);
  });

  it("returns [] for null/undefined/garbage", () => {
    expect(toRepoEntries(undefined)).toEqual([]);
    expect(toRepoEntries(null)).toEqual([]);
    expect(toRepoEntries(42 as unknown)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/core -- to-repo-entries`
Expected: FAIL — `Cannot find module './to-repo-entries.ts'`.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/to-repo-entries.ts`:

```ts
import type { RepoEntry } from "./types/git.types.ts";

/**
 * Normalize any repos input into RepoEntry[] ({ url, branch }).
 * Accepts: a string (newline/comma list), string[], a RepoEntry, or RepoEntry[].
 * - Per-repo branch is preserved; a missing/blank branch falls back to `fallbackBranch`
 *   (default ""), which means "clone the repo's default branch".
 * - URLs are trimmed; empty-url entries are dropped.
 */
export function toRepoEntries(repos: unknown, fallbackBranch = ""): RepoEntry[] {
  const fb = (fallbackBranch ?? "").trim();
  const arr = Array.isArray(repos) ? repos : repos == null ? [] : [repos];
  const out: RepoEntry[] = [];
  for (const r of arr) {
    if (typeof r === "string") {
      for (const url of r.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)) {
        out.push({ url, branch: fb });
      }
    } else if (r && typeof r === "object") {
      const url = String((r as { url?: unknown }).url ?? "").trim();
      if (url) out.push({ url, branch: String((r as { branch?: unknown }).branch ?? fb).trim() });
    }
  }
  return out;
}
```

- [ ] **Step 4: Export it from core**

In `packages/core/src/index.ts`, immediately after the existing line `export { parseRepoList } from "./parse-repo-list.ts";` add:

```ts
export { toRepoEntries } from "./to-repo-entries.ts";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w @journeyman/core -- to-repo-entries`
Expected: PASS (6 tests).

---

## Task 2: Sandbox provider honors per-entry branch

**Files:**
- Modify: `packages/orchestrator/src/sandbox/sandbox-instance-git-provider.ts`
- Test: `packages/orchestrator/src/sandbox/sandbox-instance-git-provider.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/orchestrator/src/sandbox/sandbox-instance-git-provider.test.ts` (inside the existing top-level `describe`):

```ts
it("sends each repo's own branch in the clone op stdin", async () => {
  const calls: any[] = [];
  const exec = async (op: any) => { calls.push(op); return { ok: true }; };
  const provider = new SandboxInstanceGitProvider(exec);
  await provider.cloneRepos({
    repos: [{ url: "acme/api", branch: "develop" }, { url: "acme/web", branch: "" }],
    workspaceDir: "/workspace",
  });
  expect(calls).toHaveLength(2);
  expect(calls[0].stdin).toMatchObject({ dir: "api", branch: "develop" });
  expect(calls[1].stdin.branch).toBeUndefined();   // blank branch ⇒ no --branch
  expect(calls[1].stdin.dir).toBe("web");
});
```

(If the test file does not already import the class, add `import { SandboxInstanceGitProvider } from "./sandbox-instance-git-provider.ts";` at the top.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/orchestrator -- sandbox-instance-git-provider`
Expected: FAIL — the second call currently carries `branch: ""`/the shared `opts.branch`, and per-entry branch is not read.

- [ ] **Step 3: Implement**

In `packages/orchestrator/src/sandbox/sandbox-instance-git-provider.ts`:

Replace the import line 1:
```ts
import { parseRepoList } from "@journeyman/core";
```
with:
```ts
import { toRepoEntries } from "@journeyman/core";
```

Delete the entire `toUrls` function (lines 8–20).

Replace the `cloneRepos` body (lines 67–90) with:
```ts
  async cloneRepos(opts: CloneReposOptions): Promise<CloneReposResult> {
    const entries = toRepoEntries(opts.repos, opts.branch);
    const workspaceDir = opts.workspaceDir ?? "/workspace";
    const results: CloneResult[] = [];
    for (const entry of entries) {
      const dir = folderName(entry.url);
      const cloneUrl = this.auth ? buildAuthCloneUrl(entry.url, this.auth) : entry.url;
      const r = await this.exec({
        op: "clone",
        stdin: { repoUrl: cloneUrl, dir, ...(entry.branch ? { branch: entry.branch } : {}) },
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.onLog ? { onLog: opts.onLog } : {}),
      });
      results.push({
        folderName: dir,
        repoDir: `${workspaceDir}/${dir}`,
        url: entry.url,
        branch: entry.branch ?? "",
        ...(r.ok ? {} : { error: r.error }),
      });
    }
    const firstError = results.find((x) => x.error)?.error;
    return { repos: results, ...(firstError ? { error: firstError } : {}) };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/orchestrator -- sandbox-instance-git-provider`
Expected: PASS (including the existing tests, which pass `{repos:"..."}`/`{repos:["..."]}` strings — `toRepoEntries` still handles those).

---

## Task 3: GitHub local provider blank-branch fix

**Files:**
- Modify: `packages/git-provider/src/providers/github/operations/clone-repos.ts`
- Test: `packages/git-provider/src/providers/github/operations/clone-repos.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/git-provider/src/providers/github/operations/clone-repos.test.ts`. This asserts the git args, so it requires observing the spawned command. If the existing tests mock `node:child_process` `execFile`, follow that pattern; otherwise add this mock at the top of the file:

```ts
import { vi, describe, it, expect, beforeEach } from "vitest";
const execFileMock = vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: (e: unknown) => void) => cb(null));
vi.mock("node:child_process", () => ({ execFile: (...a: unknown[]) => (execFileMock as any)(...a) }));
import { cloneRepos } from "./clone-repos.ts";

beforeEach(() => execFileMock.mockClear());

describe("github cloneRepos branch args", () => {
  it("omits --branch when branch is blank (clones default)", async () => {
    await cloneRepos("tok", { repos: [{ url: "https://github.com/acme/api.git", branch: "" }], workspaceDir: "/tmp/x" });
    const args = execFileMock.mock.calls[0][1] as string[];
    expect(args).not.toContain("--branch");
  });

  it("passes --branch <b> --single-branch when branch is set", async () => {
    await cloneRepos("tok", { repos: [{ url: "https://github.com/acme/api.git", branch: "develop" }], workspaceDir: "/tmp/x" });
    const args = execFileMock.mock.calls[0][1] as string[];
    expect(args).toContain("--branch");
    expect(args).toContain("develop");
    expect(args).toContain("--single-branch");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/git-provider -- github/operations/clone-repos`
Expected: FAIL — blank branch currently emits `--branch ""` (and `normalizeEntries` forces `"main"`).

- [ ] **Step 3: Implement**

In `packages/git-provider/src/providers/github/operations/clone-repos.ts`:

Change `normalizeEntries` line 17 from:
```ts
  const defaultBranch = opts.branch ?? "main";
```
to:
```ts
  const defaultBranch = opts.branch ?? "";
```

Replace the clone `execFileP` call (lines 79–83) with:
```ts
      await rm(repoDir, { recursive: true, force: true });
      await execFileP(
        "git",
        ["clone", ...(entry.branch ? ["--branch", entry.branch, "--single-branch"] : []), cloneUrl, repoDir],
        { signal: opts.signal },
      );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/git-provider -- github/operations/clone-repos`
Expected: PASS.

---

## Task 4: GitLab local provider blank-branch fix

**Files:**
- Modify: `packages/git-provider/src/providers/gitlab/operations/clone-repos.ts`

GitLab's clone args are already conditional (`...(entry.branch ? ["--branch", entry.branch] : [])`), so only the forced default needs fixing.

- [ ] **Step 1: Implement**

In `packages/git-provider/src/providers/gitlab/operations/clone-repos.ts`, change line 11 from:
```ts
  const defaultBranch = opts.branch ?? "main";
```
to:
```ts
  const defaultBranch = opts.branch ?? "";
```

- [ ] **Step 2: Run the gitlab clone tests if present**

Run: `npm test -w @journeyman/git-provider -- gitlab/operations/clone-repos`
Expected: PASS (or "no test files" — no test exists today; the Task 12 typecheck covers it). No behavior change when a branch is supplied; blank now clones the default.

---

## Task 5: Clone-repos step config reshape

**Files:**
- Modify: `packages/steps/src/git/clone-repos.meta.ts`
- Modify: `packages/steps/src/git/clone-repos.tsx`

- [ ] **Step 1: Update the schema + input fields**

Replace `packages/steps/src/git/clone-repos.meta.ts` lines 4–7:
```ts
export const cloneReposConfigSchema = z.object({
  repos: z.string().min(1),
  branch: z.string().optional(),
});
```
with:
```ts
export const cloneReposConfigSchema = z.object({
  repos: z
    .array(z.object({ url: z.string().min(1), branch: z.string().optional() }))
    .optional(),
});
```

Replace `cloneReposInputFields` (lines 19–22) with:
```ts
export const cloneReposInputFields: InputFields = {
  repos: {
    shape: {
      type: "array",
      items: { type: "object", fields: { url: { type: "string" }, branch: { type: "string" } } },
    },
    label: "Repos",
  },
};
```

- [ ] **Step 2: Update the step definition**

In `packages/steps/src/git/clone-repos.tsx`:

Replace the interface (lines 11–14):
```ts
interface CloneReposConfig {
  repos: string;
  branch?: string;
}
```
with:
```ts
interface CloneReposConfig {
  repos: { url: string; branch?: string }[];
}
```

Replace `defaultConfig` (line 23):
```ts
  defaultConfig: { repos: "", branch: "" },
```
with:
```ts
  defaultConfig: { repos: [] },
```

Replace `configFields` (lines 25–28):
```ts
  configFields: {
    repos:  { label: "Repos",  widget: "string-list", help: "One owner/repo or URL per row" },
    branch: { label: "Branch", widget: "text",        help: "Optional — defaults to main" },
  },
```
with:
```ts
  // Repos (and their per-repo branch) are edited by the connection-bound RepoPicker
  // in the flow-editor, not by generic widgets. An empty configFields also disables
  // the ConfigTab stale-key sweep for this step, so config.repos is never wiped.
  configFields: {},
```

Replace `summary` (lines 30–33):
```ts
  summary: c => {
    const lines = (c.repos ?? "").split("\n").filter(s => s.trim());
    return lines.length ? `${lines.length} repo${lines.length === 1 ? "" : "s"}` : "(no repos)";
  },
```
with:
```ts
  summary: c => {
    const n = Array.isArray(c.repos) ? c.repos.length : 0;
    return n ? `${n} repo${n === 1 ? "" : "s"}` : "(no repos)";
  },
```

- [ ] **Step 2 (verify): typecheck deferred**

No unit test for the definition. Correctness is enforced by the Task 12 typecheck and Task 10 (UI wiring). Move on.

---

## Task 6: Clone-repos step handler — `toRepoEntries` + sandbox auth

**Files:**
- Modify: `packages/orchestrator/src/workers/steps/clone-repos-step-handler.ts`
- Test: `packages/orchestrator/src/workers/steps/clone-repos-step-handler.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/orchestrator/src/workers/steps/clone-repos-step-handler.test.ts`:

```ts
it("clones object-array repos with per-repo branch", async () => {
  const calls: any[] = [];
  const handler = new CloneReposStepHandler({
    git: () => ({ cloneRepos: async (o: any) => { calls.push(o); return { repos: [] }; } }) as any,
  });
  const ctx: any = { workspaceDir: "/ws", env: {}, log: () => {}, signal: undefined, connection: undefined };
  const res = await handler.run(
    { repos: [{ url: "acme/api", branch: "develop" }, { url: "acme/web", branch: "" }] } as any,
    ctx,
  );
  expect(res.kind).toBe("success");
  expect(calls[0].repos).toEqual([
    { url: "acme/api", branch: "develop" },
    { url: "acme/web", branch: "" },
  ]);
});

it("fails non-retryably when repos is empty", async () => {
  const handler = new CloneReposStepHandler({ git: () => ({ cloneRepos: async () => ({ repos: [] }) }) as any });
  const ctx: any = { workspaceDir: "/ws", env: {}, log: () => {} };
  const res = await handler.run({ repos: [] } as any, ctx);
  expect(res.kind).toBe("failure");
  expect((res as any).failure.retryable).toBe(false);
});
```

(If `CloneReposStepHandler` is not imported in the test file, add `import { CloneReposStepHandler } from "./clone-repos-step-handler.ts";`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/orchestrator -- clone-repos-step-handler`
Expected: FAIL — object-array repos currently parse to `[]` via `parseRepoList`, so the first test hits the empty-repos failure path instead of success.

- [ ] **Step 3: Implement**

In `packages/orchestrator/src/workers/steps/clone-repos-step-handler.ts`:

Change the import line 1:
```ts
import { createLogger, parseRepoList } from "@journeyman/core";
```
to:
```ts
import { createLogger, toRepoEntries } from "@journeyman/core";
```

Add `SandboxGitAuth` to the existing import from the sandbox provider (line 5):
```ts
import { SandboxInstanceGitProvider, type SandboxGitAuth } from "../../sandbox/sandbox-instance-git-provider.ts";
```

Replace the `run` body from line 32 down to the `git.cloneRepos` call. Specifically replace lines 32–59 with:
```ts
    const workspaceDir = ctx.workspaceDir;
    const entries = toRepoEntries(input.repos);

    if (entries.length === 0) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "clone-repos requires at least one repo URL",
          retryable: false,
        },
      };
    }

    const auth: SandboxGitAuth | undefined = ctx.connection
      ? { provider: ctx.connection.provider, token: ctx.connection.credential, baseUrl: ctx.connection.baseUrl }
      : undefined;

    const git: Pick<IGitProvider, "cloneRepos"> = ctx.exec
      ? new SandboxInstanceGitProvider(ctx.exec, auth)
      : this.deps.git(ctx.connection?.provider, ctx.env, ctx.connection);

    const agentLogLevel = typeof input.agentLogLevel === "string" ? input.agentLogLevel : "light";
    const verbose = agentLogLevel === "medium" || agentLogLevel === "all";
    for (const r of entries) ctx.log(`Cloning ${r.url}…`);

    const result = await git.cloneRepos({
      repos: entries, workspaceDir, signal: ctx.signal,
      ...(verbose ? { onLog: ctx.log } : {}),
    });
```

Leave the rest of the method (the `result?.error` check and the success return on lines 60–68) unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/orchestrator -- clone-repos-step-handler`
Expected: PASS.

---

## Task 7: Agent compile emits per-repo branch

**Files:**
- Modify: `packages/agents/src/compile.ts`
- Test: `packages/agents/src/compile.test.ts`

- [ ] **Step 1: Update the test (red)**

In `packages/agents/src/compile.test.ts`, replace line 39:
```ts
    expect(stepNode.config!.repos).toEqual(["acme/api"]);
```
with:
```ts
    expect(stepNode.config!.repos).toEqual([{ url: "acme/api", branch: "main" }]);
    expect(stepNode.config!.repoBranch).toBeUndefined();
```

Add a new test after the `gitConnectionId` test (after line 60):
```ts
  it("carries each repo's own branch (not just the first)", () => {
    const agent = {
      ...baseAgent,
      repoSelections: [
        { repo: "acme/api", branch: "develop", allowWrites: false },
        { repo: "acme/web", allowWrites: false },
      ],
    };
    const { graph } = compileAgentToGraph(agent, { ticketKey: "X" });
    const step = graph.nodes.find((n) => n.stepType === "agent-run")!;
    expect(step.config!.repos).toEqual([
      { url: "acme/api", branch: "develop" },
      { url: "acme/web", branch: "" },
    ]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @journeyman/agents -- compile`
Expected: FAIL — `repos` is currently `["acme/api"]` and `repoBranch` is set.

- [ ] **Step 3: Implement**

In `packages/agents/src/compile.ts`, replace lines 60–61:
```ts
          repos: agent.repoSelections.map((r) => r.repo),
          repoBranch: agent.repoSelections[0]?.branch,
```
with:
```ts
          repos: agent.repoSelections.map((r) => ({ url: r.repo, branch: r.branch ?? "" })),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @journeyman/agents -- compile`
Expected: PASS.

---

## Task 8: Agent-run handler — `toRepoEntries`, drop `repoBranch`

**Files:**
- Modify: `packages/orchestrator/src/workers/steps/agent-run-step-handler.ts`

This handler resolves auth from a separate `input.gitConnectionId` (unchanged). Only the repos parsing, the per-repo branch, and the log line change. (No new unit test — covered by the existing handler test plus Task 12 typecheck; the zero-repo behavior is preserved because `toRepoEntries([]) === []`.)

- [ ] **Step 1: Switch the import**

In the multi-line `@journeyman/core` import (the value import block; `parseRepoList,` is on line 5), replace:
```ts
  parseRepoList,
```
with:
```ts
  toRepoEntries,
```
`parseRepoList` is used only on lines 56 and 78 (both replaced below), so no other reference remains.

- [ ] **Step 2: Update `needsWorkspaceFor`**

Replace line 56:
```ts
    const hasRepos = parseRepoList(input.repos as string | string[] | undefined).length > 0;
```
with:
```ts
    const hasRepos = toRepoEntries(input.repos).length > 0;
```

- [ ] **Step 3: Update the clone block**

Replace line 78:
```ts
    const repos = parseRepoList(input.repos as string | string[] | undefined);
    if (repos.length > 0) {
```
with:
```ts
    const repoEntries = toRepoEntries(input.repos);
    if (repoEntries.length > 0) {
```

Replace lines 100–102:
```ts
      const branch = typeof input.repoBranch === "string" ? input.repoBranch : undefined;
      for (const r of repos) ctx.log(`Cloning ${r}…`);
      const cloneRes = await git.cloneRepos({ repos, workspaceDir: ctx.workspaceDir, branch, signal: ctx.signal });
```
with:
```ts
      for (const r of repoEntries) ctx.log(`Cloning ${r.url}…`);
      const cloneRes = await git.cloneRepos({ repos: repoEntries, workspaceDir: ctx.workspaceDir, signal: ctx.signal });
```

- [ ] **Step 4: Run the existing handler test**

Run: `npm test -w @journeyman/orchestrator -- agent-run-step-handler`
Expected: PASS — existing tests pass `repos: ["acme/api"]` (string[]) which `toRepoEntries` still handles, and the no-repos test still yields no workspace.

---

## Task 9: RepoPicker — object value + per-row branch input

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/RepoPicker.tsx`

No component test harness exists for this file; verified by Task 12 typecheck + manual review.

- [ ] **Step 1: Replace the component**

Replace the entire body of `packages/flow-editor/src/properties-panel/RepoPicker.tsx` with:

```tsx
// packages/flow-editor/src/properties-panel/RepoPicker.tsx
import { useEffect, useState, useCallback } from "react";
import { fetchConnectionRepos, type RepoSummary } from "../api/connections.ts";
import { useWsId } from "../state/org-context.tsx";

export interface RepoSelection {
  url: string;
  branch?: string;
}

interface Props {
  connectionId: string;
  /** Currently selected repos with their per-repo checkout branch */
  value: RepoSelection[];
  onChange: (repos: RepoSelection[]) => void;
  readOnly?: boolean;
}

export function RepoPicker({ connectionId, value, onChange, readOnly }: Props) {
  const wsId = useWsId();
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    (q: string) => {
      if (!wsId) return;
      setLoading(true);
      fetchConnectionRepos(wsId, connectionId, q || undefined)
        .then(setRepos)
        .catch(() => setRepos([]))
        .finally(() => setLoading(false));
    },
    [wsId, connectionId],
  );

  useEffect(() => { load(""); }, [load]);

  useEffect(() => {
    const id = window.setTimeout(() => load(search), 300);
    return () => window.clearTimeout(id);
  }, [search, load]);

  const isSelected = (url: string) => value.some(r => r.url === url);

  const toggle = (url: string) => {
    if (readOnly) return;
    onChange(isSelected(url) ? value.filter(r => r.url !== url) : [...value, { url }]);
  };

  const setBranch = (url: string, branch: string) => {
    if (readOnly) return;
    onChange(value.map(r => (r.url === url ? { ...r, branch: branch || undefined } : r)));
  };

  return (
    <div className="je-props__field">
      <label>Repositories</label>

      {value.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 6 }}>
          {value.map(r => {
            const name = r.url.split("/").slice(-2).join("/").replace(/\.git$/, "");
            return (
              <div key={r.url} style={{
                display: "flex", alignItems: "center", gap: 6,
                fontSize: 11, padding: "3px 7px",
                background: "rgb(var(--color-surface) / 1)",
                border: "1px solid rgb(var(--color-border) / 1)",
                borderRadius: 4,
              }}>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
                <input
                  type="text"
                  placeholder="default branch"
                  value={r.branch ?? ""}
                  onChange={e => setBranch(r.url, e.target.value)}
                  disabled={readOnly}
                  style={{ width: 130, fontSize: 11, padding: "1px 5px", boxSizing: "border-box" }}
                />
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => toggle(r.url)}
                    aria-label={`Remove ${name}`}
                    style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 12, color: "rgb(var(--color-text-muted) / 1)" }}
                  >×</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <input
        type="search"
        placeholder="Search repos…"
        value={search}
        onChange={e => setSearch(e.target.value)}
        disabled={readOnly}
        style={{ width: "100%", marginBottom: 4, boxSizing: "border-box" }}
      />

      <div style={{
        maxHeight: 150, overflowY: "auto",
        border: "1px solid rgb(var(--color-border) / 1)", borderRadius: 4,
      }}>
        {loading && (
          <div style={{ padding: "6px 8px", fontSize: 11, color: "rgb(var(--color-text-muted) / 1)" }}>
            Loading…
          </div>
        )}
        {!loading && repos.length === 0 && (
          <div style={{ padding: "6px 8px", fontSize: 11, color: "rgb(var(--color-text-muted) / 1)" }}>
            No repos found.
          </div>
        )}
        {repos.map(r => {
          const selected = isSelected(r.url);
          return (
            <div
              key={r.url}
              onClick={() => toggle(r.url)}
              style={{
                padding: "5px 8px", fontSize: 12, cursor: readOnly ? "default" : "pointer",
                display: "flex", justifyContent: "space-between", alignItems: "center",
                background: selected ? "rgb(var(--color-info) / 0.1)" : undefined,
              }}
            >
              <span>{r.fullName}</span>
              {selected && <span style={{ fontSize: 11, color: "rgb(var(--color-info) / 1)" }}>✓</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

Note: the browse list toggles by `r.url` (from `RepoSummary.url`), so newly-added repos store the full clone URL — consistent with prior behavior.

---

## Task 10: ConfigTab — object passthrough for the RepoPicker

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/ConfigTab.tsx`

- [ ] **Step 1: Replace the RepoPicker wiring**

In `packages/flow-editor/src/properties-panel/ConfigTab.tsx`, replace the clone-repos block:
```tsx
          {node.stepType === "clone-repos" && node.connectionId && (
            <RepoPicker
              connectionId={node.connectionId}
              value={((config.repos as string | undefined) ?? "").split("\n").filter(Boolean)}
              onChange={urls => onChange({ ...node, config: { ...config, repos: urls.join("\n") } })}
              readOnly={readOnly}
            />
          )}
```
with:
```tsx
          {node.stepType === "clone-repos" && node.connectionId && (
            <RepoPicker
              connectionId={node.connectionId}
              value={Array.isArray(config.repos) ? (config.repos as { url: string; branch?: string }[]) : []}
              onChange={repos => onChange({ ...node, config: { ...config, repos } })}
              readOnly={readOnly}
            />
          )}
```

The `Array.isArray(...) ? ... : []` guard coerces any old string-shaped `config.repos` to an empty list (no rows) so a legacy node simply prompts a re-pick rather than crashing.

No other ConfigTab change is needed: clone-repos now has `configFields: {}` (Task 5), so SchemaForm renders no generic fields for it and the stale-key sweep is disabled for it (`knownConfigKeys` is null when `configFields` is empty), protecting `config.repos`.

---

## Task 11: Agent WorkspaceSection — per-repo branch input

**Files:**
- Modify: `packages/web/src/components/agents/sections/WorkspaceSection.tsx`

No component test harness; verified by Task 12 typecheck + manual review.

- [ ] **Step 1: Add a `setRepoBranch` helper**

In `packages/web/src/components/agents/sections/WorkspaceSection.tsx`, after `removeRepo` (line 62) add:
```tsx
  const setRepoBranch = (fullName: string, branch: string) => {
    patch({
      repoSelections: a.repoSelections.map((r) =>
        r.repo === fullName ? { ...r, branch: branch || undefined } : r,
      ),
    });
  };
```

- [ ] **Step 2: Replace the selected-repos render with rows**

Replace the selected-repos block (lines 192–212, the `<div className="flex flex-wrap gap-2">` … `</div>`) with:
```tsx
          <div className="flex flex-col gap-2">
            {a.repoSelections.map((r) => (
              <div
                key={r.repo}
                className="flex items-center gap-2 rounded-md border bg-muted px-3 py-1.5 text-sm"
              >
                <span className="flex-1 truncate">{r.repo}</span>
                <input
                  type="text"
                  className={inputCls}
                  style={{ width: 160 }}
                  placeholder="default branch"
                  value={r.branch ?? ""}
                  disabled={locked}
                  onChange={(e) => setRepoBranch(r.repo, e.target.value)}
                />
                {!locked && (
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${r.repo}`}
                    onClick={() => removeRepo(r.repo)}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
```

(`inputCls` is already imported at the top of the file.)

---

## Task 12: Final typecheck + import boundaries (the only verification gate)

**Files:** none.

- [ ] **Step 1: Typecheck the whole workspace**

Run: `npm run typecheck`
Expected: PASS for all workspaces (`tsc --noEmit`). Fix any type errors surfaced — common suspects: a leftover `parseRepoList`/`repoBranch` reference, the `RepoSelection`/config shape in flow-editor, or the `CloneReposConfig` interface.

- [ ] **Step 2: Import-boundary check**

Run: `npm run check:boundaries`
Expected: PASS. (`toRepoEntries` lives in `@journeyman/core`, which everything may import — no boundary violation.)

- [ ] **Step 3: Run the touched packages' tests once more together**

Run: `npm test -w @journeyman/core -w @journeyman/agents -w @journeyman/git-provider -w @journeyman/orchestrator`
Expected: PASS (no regressions). Note: pre-existing unrelated failures may exist in the suite — compare against the known baseline; only the clone/branch-related tests must be green.

- [ ] **Step 4: Do NOT commit**

Per the requester's constraint, leave all changes uncommitted in the working tree on `master`. Report completion with `git status` showing the modified/created files.
```
