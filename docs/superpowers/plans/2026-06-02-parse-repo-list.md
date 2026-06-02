# Robust Repos-List Parsing (`parseRepoList`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one shared `parseRepoList` parser in `@journeyman/core` (split on newlines/commas, trim, drop empties) and use it at the three duplicated comma-only call sites so multi-line repos input no longer leaves trailing `\n` on URLs.

**Architecture:** Pure util in core; the clone-repos step handler and `SandboxGitProvider` parse string/string[] input through it; `git-provider/normalizeEntries` trims each url as belt-and-suspenders. No URL rewriting, no UI changes.

**Tech Stack:** TypeScript (npm workspaces), vitest. Type/boundary gate: `npm run check`.

**Spec:** [docs/superpowers/specs/2026-06-02-parse-repo-list-design.md](../specs/2026-06-02-parse-repo-list-design.md)

**Execution constraints:** already on branch `feat/dynamic-coding-provider`; **do NOT commit**; run `npm run check` at the end. (Per-task commit steps intentionally omitted.)

---

## Task 1: `parseRepoList` util + tests

**Files:**
- Create: `packages/core/src/parse-repo-list.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/src/parse-repo-list.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/parse-repo-list.test.ts
import { describe, it, expect } from "vitest";
import { parseRepoList } from "./parse-repo-list.ts";

describe("parseRepoList", () => {
  it("strips a trailing newline", () => {
    expect(parseRepoList("https://github.com/x/HireIQ.git\n")).toEqual(["https://github.com/x/HireIQ.git"]);
  });
  it("splits multi-line input", () => {
    expect(parseRepoList("a\nb\nc")).toEqual(["a", "b", "c"]);
  });
  it("splits comma-separated input", () => {
    expect(parseRepoList("a, b ,c")).toEqual(["a", "b", "c"]);
  });
  it("handles mixed newlines and commas + blank lines + spaces", () => {
    expect(parseRepoList("  a , b \n\n c \n")).toEqual(["a", "b", "c"]);
  });
  it("handles a string[] whose elements may contain newlines", () => {
    expect(parseRepoList(["a\nb", " c "])).toEqual(["a", "b", "c"]);
  });
  it("returns [] for empty/undefined", () => {
    expect(parseRepoList("")).toEqual([]);
    expect(parseRepoList(undefined)).toEqual([]);
    expect(parseRepoList("  \n , \n ")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/core && npx vitest run src/parse-repo-list.test.ts`
Expected: FAIL — module `./parse-repo-list.ts` not found.

- [ ] **Step 3: Implement the util**

```ts
// packages/core/src/parse-repo-list.ts

/**
 * Parse a repos-list input (multi-line textarea and/or comma-separated) into a
 * clean array of trimmed, non-empty URL strings. Splits on newlines and commas;
 * does NOT rewrite URLs (no .git stripping). Arrays are flattened element-wise.
 */
export function parseRepoList(input: string | string[] | undefined): string[] {
  if (input == null) return [];
  const items = Array.isArray(input) ? input : [input];
  return items
    .flatMap((s) => (typeof s === "string" ? s.split(/[\n,]+/) : []))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
```

- [ ] **Step 4: Export from core**

In `packages/core/src/index.ts` add (near other util exports):

```ts
export { parseRepoList } from "./parse-repo-list.ts";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/core && npx vitest run src/parse-repo-list.test.ts`
Expected: PASS (6 tests).

---

## Task 2: Use `parseRepoList` in the clone-repos step handler

**Files:**
- Modify: `packages/orchestrator/src/workers/steps/clone-repos-step-handler.ts`

- [ ] **Step 1: Replace the comma-only parse with `parseRepoList`**

At the top, add to the `@journeyman/core` import: `parseRepoList`.

Replace:
```ts
    const reposRaw = input.repos;
    // ...
    let repos: string | string[] | undefined;
    if (typeof reposRaw === "string") repos = reposRaw.includes(",") ? reposRaw.split(",").map(s => s.trim()).filter(Boolean) : reposRaw;
    else if (Array.isArray(reposRaw) && reposRaw.every((r) => typeof r === "string")) repos = reposRaw as string[];

    if (!repos || !workspaceDir) {
```
with:
```ts
    const repos = parseRepoList(input.repos as string | string[] | undefined);
    // ...
    if (repos.length === 0) {
```
Update the failure message to: `"clone-repos requires at least one repo URL"`. (Keep the `workspaceDir = ctx.workspaceDir` line and any branch handling as-is from the prior change; remove only the dead `!workspaceDir` clause if still present.)

- [ ] **Step 2: Pass `repos` (now `string[]`) into `cloneRepos`** — unchanged call, but `repos` is now always a clean `string[]`.

- [ ] **Step 3: Run the handler tests**

Run: `cd packages/orchestrator && npx vitest run src/workers/steps/clone-repos-step-handler.test.ts` (if present) or `npx vitest run src/workers/steps`
Expected: PASS. If a test fed a multi-line/`\n` input expecting the old behavior, update it to expect clean URLs.

---

## Task 3: Use `parseRepoList` in `SandboxGitProvider.toUrls`

**Files:**
- Modify: `packages/orchestrator/src/sandbox/sandbox-git-provider.ts`

- [ ] **Step 1: Replace `toUrls`**

Add `parseRepoList` to the `@journeyman/core` import. Replace the `toUrls` function body:
```ts
function toUrls(repos: unknown): string[] {
  if (typeof repos === "string") {
    return repos.includes(",") ? repos.split(",").map((s) => s.trim()).filter(Boolean) : [repos];
  }
  if (Array.isArray(repos)) {
    return repos
      .map((r) => (typeof r === "string" ? r : (r as { url?: string })?.url))
      .filter((u): u is string => typeof u === "string");
  }
  return [];
}
```
with:
```ts
function toUrls(repos: unknown): string[] {
  if (typeof repos === "string" || (Array.isArray(repos) && repos.every((r) => typeof r === "string"))) {
    return parseRepoList(repos as string | string[]);
  }
  if (Array.isArray(repos)) {
    return repos
      .map((r) => (typeof r === "string" ? r : (r as { url?: string })?.url))
      .filter((u): u is string => typeof u === "string")
      .map((u) => u.trim())
      .filter((u) => u.length > 0);
  }
  return [];
}
```

- [ ] **Step 2: Add a multi-line test case**

In `packages/orchestrator/src/sandbox/sandbox-git-provider.test.ts` (create if absent following the repo's vitest style), assert that a multi-line input like `"https://github.com/x/HireIQ.git\n"` produces a single clean op with `dir === "HireIQ"` and no `\n` in the URL. Use a fake `exec` capturing the op.

- [ ] **Step 3: Run the test**

Run: `cd packages/orchestrator && npx vitest run src/sandbox/sandbox-git-provider.test.ts`
Expected: PASS.

---

## Task 4: Defensive trim in `git-provider` `normalizeEntries`

**Files:**
- Modify: `packages/git-provider/src/providers/github/operations/clone-repos.ts`

- [ ] **Step 1: Trim each url**

Replace:
```ts
  return raw.map((r) =>
    typeof r === "string" ? { url: r, branch: defaultBranch } : r,
  );
```
with:
```ts
  return raw.map((r) =>
    typeof r === "string"
      ? { url: r.trim(), branch: defaultBranch }
      : { ...r, url: (r.url ?? "").trim() },
  );
```

- [ ] **Step 2: Run the git-provider tests**

Run: `cd packages/git-provider && npx vitest run`
Expected: PASS (existing clone-repos tests unaffected; folder/url no longer carry whitespace).

---

## Task 5: Verify (typecheck + boundaries; do NOT commit)

- [ ] **Step 1: Touched-package tests**

Run:
```bash
( cd packages/core && npx vitest run src/parse-repo-list.test.ts )
( cd packages/orchestrator && npx vitest run src/workers/steps src/sandbox )
( cd packages/git-provider && npx vitest run )
```
Expected: PASS (pre-existing non-vitest "no test suite found" files are not regressions).

- [ ] **Step 2: Full check**

Run: `npm run check`
Expected: PASS (typecheck + `✓ Layer boundaries clean`).

- [ ] **Step 3: Leave uncommitted**

Run: `git status --short` — changes present, nothing committed. Stop.
