# Workspace Confinement for Coding Steps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Per user instruction for this run:** DO NOT commit. There are no `git commit` steps in this plan. After all tasks, run `npm run typecheck` (root) as the final verification.

**Goal:** Confine AI coding steps (search/read/write/bash) to their sandbox workspace directory, via a shared path-guard module + per-provider enforcement + a workspace-root system prompt.

**Architecture:** A pure `workspace-guard` module in `agent-runtime` (path resolution, per-tool path extraction, bash escape detection, system-prompt builder) — no SDK imports. Claude SDK enforces hard via a `PreToolUse` hook; AI SDK enforces hard inside its `fs.ts`/`bash.ts` tools; OpenCode gets working-dir + system-prompt (best-effort). Bash is best-effort everywhere. Enforcement is always-on whenever a workspace `cwd` exists.

**Tech Stack:** TypeScript (Node 22, ESM, `.ts` import specifiers), `@anthropic-ai/claude-agent-sdk`, `ai` (Vercel AI SDK), `@opencode-ai/sdk`, vitest.

**Spec:** `docs/superpowers/specs/2026-06-10-workspace-confinement-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/agent-runtime/src/workspace-guard/resolve.ts` | `resolveWithinWorkspace(root, candidate)` — normalize + boundary check |
| `packages/agent-runtime/src/workspace-guard/extract-paths.ts` | `extractPaths(toolName, input)` + `findBashEscape(command, root)` |
| `packages/agent-runtime/src/workspace-guard/system-prompt.ts` | `confinementSystemPrompt(root)` |
| `packages/agent-runtime/src/workspace-guard/index.ts` | barrel exports |
| `packages/agent-runtime/src/workspace-guard/*.test.ts` | unit tests for the above |
| `packages/agent-runtime/src/providers/claude/utils/workspace-hook.ts` | `buildWorkspaceHook(root)` → SDK `hooks` object (imports workspace-guard) |
| `packages/agent-runtime/src/providers/claude/utils/workspace-hook.test.ts` | hook deny/allow tests |
| `packages/core/src/types/git.types.ts` | add `cwd?: string` to `ScanReposOptions` + `CheckoutRepoOptions` |
| `.../providers/claude/operations/{run-custom-prompt,scan-repos,checkout-repo}.ts` | wire hook + cwd + system prompt |
| `.../providers/aisdk/tools/{fs,bash}.ts` | hard path validation in tools |
| `.../providers/aisdk/operations/run-custom-prompt.ts` | prepend system prompt |
| `.../providers/opencode/operations/{run-custom-prompt,scan-repos,checkout-repo}.ts` | `directory` + system prompt (best-effort) |

---

## Task 1: `resolveWithinWorkspace` (core path guard)

**Files:**
- Create: `packages/agent-runtime/src/workspace-guard/resolve.ts`
- Test: `packages/agent-runtime/src/workspace-guard/resolve.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-runtime/src/workspace-guard/resolve.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWithinWorkspace } from "./resolve.ts";

let root: string;
let outside: string;

beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), "wsguard-"));
  root = join(base, "workspace");
  outside = join(base, "outside");
  mkdirSync(join(root, "sub"), { recursive: true });
  mkdirSync(outside, { recursive: true });
  // symlink inside root pointing outside → must be rejected
  symlinkSync(outside, join(root, "escape-link"));
});

afterAll(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* noop */ }
});

describe("resolveWithinWorkspace", () => {
  it("accepts a relative path inside root", () => {
    expect(resolveWithinWorkspace(root, "sub/file.ts").ok).toBe(true);
  });
  it("accepts an absolute path inside root", () => {
    expect(resolveWithinWorkspace(root, join(root, "sub/file.ts")).ok).toBe(true);
  });
  it("accepts root itself", () => {
    expect(resolveWithinWorkspace(root, root).ok).toBe(true);
  });
  it("accepts a not-yet-existing write path inside root", () => {
    expect(resolveWithinWorkspace(root, "sub/new/deep/file.ts").ok).toBe(true);
  });
  it("rejects a parent-traversal escape", () => {
    expect(resolveWithinWorkspace(root, "../outside/secret.txt").ok).toBe(false);
  });
  it("rejects an absolute path outside root", () => {
    expect(resolveWithinWorkspace(root, "/etc/passwd").ok).toBe(false);
  });
  it("rejects a sibling-prefix path", () => {
    expect(resolveWithinWorkspace(root, root + "-evil/x").ok).toBe(false);
  });
  it("rejects a symlink that escapes root", () => {
    expect(resolveWithinWorkspace(root, "escape-link/secret.txt").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-runtime && npx vitest run src/workspace-guard/resolve.test.ts`
Expected: FAIL — `Failed to resolve import "./resolve.ts"` / `resolveWithinWorkspace is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/agent-runtime/src/workspace-guard/resolve.ts
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, resolve as resolvePath, sep } from "node:path";

export type ResolveResult = { ok: true; path: string } | { ok: false; reason: string };

/**
 * Realpath-normalize the deepest existing ancestor of `p`, re-appending the
 * non-existent tail. This collapses `..` and follows symlinks for the parts
 * that exist (defeating symlink escapes) while still supporting write paths
 * whose final segments don't exist yet.
 */
function normalizeExisting(p: string): string {
  let cur = resolvePath(p);
  const tail: string[] = [];
  for (;;) {
    try {
      const real = realpathSync(cur);
      return tail.length ? resolvePath(real, ...tail) : real;
    } catch {
      const parent = dirname(cur);
      if (parent === cur) return resolvePath(p); // nothing in the chain exists
      tail.unshift(basename(cur));
      cur = parent;
    }
  }
}

/**
 * Resolve `candidate` and assert it is the workspace `root` itself or a
 * descendant. Returns the safe absolute path, or a structured rejection.
 */
export function resolveWithinWorkspace(root: string, candidate: string): ResolveResult {
  const rootNorm = normalizeExisting(root);
  const absCandidate = isAbsolute(candidate) ? candidate : resolvePath(rootNorm, candidate);
  const target = normalizeExisting(absCandidate);
  if (target === rootNorm || target.startsWith(rootNorm + sep)) {
    return { ok: true, path: target };
  }
  return { ok: false, reason: `Path '${candidate}' is outside the workspace root '${root}'.` };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agent-runtime && npx vitest run src/workspace-guard/resolve.test.ts`
Expected: PASS (8 tests).

---

## Task 2: `extractPaths` + `findBashEscape`

**Files:**
- Create: `packages/agent-runtime/src/workspace-guard/extract-paths.ts`
- Test: `packages/agent-runtime/src/workspace-guard/extract-paths.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-runtime/src/workspace-guard/extract-paths.test.ts
import { describe, it, expect } from "vitest";
import { extractPaths, findBashEscape } from "./extract-paths.ts";

describe("extractPaths", () => {
  it("pulls file_path for Read/Write/Edit", () => {
    expect(extractPaths("Read", { file_path: "/w/a.ts" })).toEqual(["/w/a.ts"]);
    expect(extractPaths("Write", { file_path: "/w/b.ts", content: "x" })).toEqual(["/w/b.ts"]);
    expect(extractPaths("Edit", { file_path: "/w/c.ts" })).toEqual(["/w/c.ts"]);
  });
  it("pulls path for Grep/Glob", () => {
    expect(extractPaths("Grep", { pattern: "foo", path: "/w/src" })).toEqual(["/w/src"]);
    expect(extractPaths("Glob", { pattern: "**/*.ts", path: "/w" })).toEqual(["/w"]);
  });
  it("returns [] when no path arg present (defaults to cwd)", () => {
    expect(extractPaths("Grep", { pattern: "foo" })).toEqual([]);
    expect(extractPaths("Bash", { command: "ls" })).toEqual([]);
    expect(extractPaths("WebFetch", { url: "https://x" })).toEqual([]);
  });
  it("tolerates non-object input", () => {
    expect(extractPaths("Read", undefined)).toEqual([]);
  });
});

describe("findBashEscape", () => {
  const root = "/workspace";
  it("allows commands operating inside root", () => {
    expect(findBashEscape("git -C /workspace/api status", root)).toBeNull();
    expect(findBashEscape("grep -rn foo src/", root)).toBeNull();
    expect(findBashEscape("date +%s", root)).toBeNull();
  });
  it("flags absolute paths outside root", () => {
    expect(findBashEscape("cat /etc/passwd", root)).toBe("/etc/passwd");
  });
  it("flags cd to a relative path escaping root", () => {
    expect(findBashEscape("cd ../../ && ls", root)).toBe("../../");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-runtime && npx vitest run src/workspace-guard/extract-paths.test.ts`
Expected: FAIL — module/exports not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/agent-runtime/src/workspace-guard/extract-paths.ts
import { resolveWithinWorkspace } from "./resolve.ts";

/** Path argument(s) a given tool call would touch, for boundary validation. */
export function extractPaths(toolName: string, input: unknown): string[] {
  const o = (input ?? {}) as Record<string, unknown>;
  switch (toolName) {
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
      return typeof o.file_path === "string" ? [o.file_path] : [];
    case "Grep":
    case "Glob":
      return typeof o.path === "string" ? [o.path] : [];
    default:
      return [];
  }
}

/**
 * Best-effort scan of a shell command for a path that escapes `root`. Catches
 * literal absolute paths and `cd <target>` outside the workspace. Does NOT
 * catch obfuscation (env vars, subshells, command substitution) — this is a
 * focus guardrail, not a security boundary. Returns the first offending token
 * or null.
 */
export function findBashEscape(command: string, root: string): string | null {
  const cd = command.match(/\bcd\s+(['"]?)([^\s'";|&]+)\1/);
  if (cd) {
    const target = cd[2];
    if (!resolveWithinWorkspace(root, target).ok) return target;
  }
  const absTokens = command.match(/(?<![\w/=])\/[^\s'";|&)<>]+/g) ?? [];
  for (const tok of absTokens) {
    if (!resolveWithinWorkspace(root, tok).ok) return tok;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agent-runtime && npx vitest run src/workspace-guard/extract-paths.test.ts`
Expected: PASS.

---

## Task 3: `confinementSystemPrompt` + barrel export

**Files:**
- Create: `packages/agent-runtime/src/workspace-guard/system-prompt.ts`
- Create: `packages/agent-runtime/src/workspace-guard/index.ts`
- Test: `packages/agent-runtime/src/workspace-guard/system-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-runtime/src/workspace-guard/system-prompt.test.ts
import { describe, it, expect } from "vitest";
import { confinementSystemPrompt } from "./index.ts";

describe("confinementSystemPrompt", () => {
  it("names the root and states the boundary", () => {
    const p = confinementSystemPrompt("/workspace");
    expect(p).toContain("/workspace");
    expect(p.toLowerCase()).toContain("workspace");
    expect(p).toContain("refuse");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-runtime && npx vitest run src/workspace-guard/system-prompt.test.ts`
Expected: FAIL — `./index.ts` has no `confinementSystemPrompt`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/agent-runtime/src/workspace-guard/system-prompt.ts
/** System-prompt snippet that tells the agent its workspace boundary. */
export function confinementSystemPrompt(root: string): string {
  return [
    `WORKSPACE BOUNDARY: Your workspace is rooted at ${root}.`,
    "All files you read, write, search, or operate on live under this directory.",
    "Do not access paths outside it — file and search tools will refuse out-of-workspace paths.",
    `Use relative paths or absolute paths under ${root}.`,
  ].join(" ");
}
```

```ts
// packages/agent-runtime/src/workspace-guard/index.ts
export { resolveWithinWorkspace } from "./resolve.ts";
export type { ResolveResult } from "./resolve.ts";
export { extractPaths, findBashEscape } from "./extract-paths.ts";
export { confinementSystemPrompt } from "./system-prompt.ts";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agent-runtime && npx vitest run src/workspace-guard/`
Expected: PASS (all three test files green).

---

## Task 4: Claude `PreToolUse` workspace hook

**Files:**
- Create: `packages/agent-runtime/src/providers/claude/utils/workspace-hook.ts`
- Test: `packages/agent-runtime/src/providers/claude/utils/workspace-hook.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-runtime/src/providers/claude/utils/workspace-hook.test.ts
import { describe, it, expect } from "vitest";
import { buildWorkspaceHook } from "./workspace-hook.ts";

const root = "/workspace";

async function run(toolName: string, toolInput: unknown) {
  const hooks = buildWorkspaceHook(root);
  const cb = hooks.PreToolUse[0].hooks[0];
  return cb(
    { hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput, tool_use_id: "t1", cwd: root } as any,
    "t1",
    { signal: new AbortController().signal },
  );
}

describe("buildWorkspaceHook", () => {
  it("allows an in-workspace Read", async () => {
    const out: any = await run("Read", { file_path: "/workspace/a.ts" });
    expect(out.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });
  it("denies an out-of-workspace Read", async () => {
    const out: any = await run("Read", { file_path: "/etc/passwd" });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toContain("/etc/passwd");
  });
  it("denies a Grep whose path escapes the workspace", async () => {
    const out: any = await run("Grep", { pattern: "x", path: "/var/log" });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  });
  it("denies a Bash command reading outside the workspace", async () => {
    const out: any = await run("Bash", { command: "cat /etc/shadow" });
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
  });
  it("allows a Bash command inside the workspace", async () => {
    const out: any = await run("Bash", { command: "git -C /workspace/api status" });
    expect(out.hookSpecificOutput?.permissionDecision).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-runtime && npx vitest run src/providers/claude/utils/workspace-hook.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/agent-runtime/src/providers/claude/utils/workspace-hook.ts
import { extractPaths, findBashEscape, resolveWithinWorkspace } from "../../../workspace-guard/index.ts";

type PreToolUseInput = { tool_name: string; tool_input: unknown };

function deny(reason: string) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse" as const,
      permissionDecision: "deny" as const,
      permissionDecisionReason: `${reason} Operate only within the workspace.`,
    },
  };
}

/**
 * Build a Claude Agent SDK `hooks` object whose PreToolUse callback denies any
 * file/search tool path — or best-effort Bash command — that escapes `root`.
 * Returned under the `hooks` query option; works under `bypassPermissions`.
 */
export function buildWorkspaceHook(root: string) {
  const callback = async (input: PreToolUseInput) => {
    if (input.tool_name === "Bash") {
      const command = (input.tool_input as { command?: string })?.command ?? "";
      const bad = findBashEscape(command, root);
      return bad
        ? deny(`Command references '${bad}', outside the workspace root '${root}'.`)
        : {};
    }
    for (const p of extractPaths(input.tool_name, input.tool_input)) {
      const r = resolveWithinWorkspace(root, p);
      if (!r.ok) return deny(r.reason);
    }
    return {};
  };
  return { PreToolUse: [{ hooks: [callback] }] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agent-runtime && npx vitest run src/providers/claude/utils/workspace-hook.test.ts`
Expected: PASS (5 tests).

---

## Task 5: Add `cwd` to scan/checkout option types (core)

**Files:**
- Modify: `packages/core/src/types/git.types.ts`

The runner already injects `cwd: ctx.workspaceDir` into every operation's opts (`operation-runner.ts:19`), but `ScanReposOptions`/`CheckoutRepoOptions` don't declare it, so the Claude ops can't read it type-safely. Add it.

- [ ] **Step 1: Add `cwd?: string` to both types**

In `ScanReposOptions` (currently):
```ts
export type ScanReposOptions = SessionOptions & {
  parentDir: string;
  signal?: AbortSignal;
  model?: string;
  modelConfig?: CodingModelConfig;
};
```
Change to add the field (place after `parentDir`):
```ts
export type ScanReposOptions = SessionOptions & {
  parentDir: string;
  /** Workspace root for confinement; injected by the operation runner. */
  cwd?: string;
  signal?: AbortSignal;
  model?: string;
  modelConfig?: CodingModelConfig;
};
```

In `CheckoutRepoOptions`, add the same field after the `issue?` line:
```ts
  /** Workspace root for confinement; injected by the operation runner. */
  cwd?: string;
```

- [ ] **Step 2: Verify core typechecks**

Run: `cd packages/core && npx tsc --noEmit`
Expected: no errors.

---

## Task 6: Wire confinement into Claude `runCustomPrompt`

**Files:**
- Modify: `packages/agent-runtime/src/providers/claude/operations/run-custom-prompt.ts`

- [ ] **Step 1: Add imports**

After line 10 (`import { claudeNativeTools } ...`):
```ts
import { confinementSystemPrompt } from "../../../workspace-guard/index.ts";
import { buildWorkspaceHook } from "../utils/workspace-hook.ts";
```

- [ ] **Step 2: Prepend the system prompt when a workspace cwd is set**

Replace the `fullPrompt` line (currently line 83):
```ts
const fullPrompt = [opts.prompt, mcpPromptSuffix, skillPromptSuffix].filter(Boolean).join("\n\n");
```
with:
```ts
const confinement = opts.cwd ? confinementSystemPrompt(opts.cwd) : "";
const fullPrompt = [confinement, opts.prompt, mcpPromptSuffix, skillPromptSuffix].filter(Boolean).join("\n\n");
```

- [ ] **Step 3: Add the hook + additionalDirectories to query options**

In the `queryOptions` object, replace the cwd line (currently line 110):
```ts
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
```
with:
```ts
    ...(opts.cwd ? { cwd: opts.cwd, additionalDirectories: [], hooks: buildWorkspaceHook(opts.cwd) } : {}),
```

- [ ] **Step 4: Typecheck**

Run: `cd packages/agent-runtime && npx tsc --noEmit`
Expected: no errors. (If `hooks`/`additionalDirectories` type-conflict under the `Record<string, unknown>` literal, they won't — `queryOptions` is typed `Record<string, unknown>` and cast `as any` at the `query()` call site on line 134.)

---

## Task 7: Wire confinement into Claude `scanRepos`

**Files:**
- Modify: `packages/agent-runtime/src/providers/claude/operations/scan-repos.ts`

- [ ] **Step 1: Add imports** (after line 4, `import { resolveSession } ...`):
```ts
import { confinementSystemPrompt } from "../../../workspace-guard/index.ts";
import { buildWorkspaceHook } from "../utils/workspace-hook.ts";
```

- [ ] **Step 2: Compute the confinement root and prompt**

Inside `scanRepos`, after the `controller` block (after line 68), add:
```ts
  const root = opts.cwd ?? opts.parentDir;
  const prompt = [confinementSystemPrompt(root), buildPrompt(opts.parentDir)].join("\n\n");
```

- [ ] **Step 3: Use the prompt and add the hook**

In the `query({ ... })` call, change `prompt: buildPrompt(opts.parentDir),` (line 72) to:
```ts
    prompt,
```
and inside `options`, after the `outputFormat` line (line 81), add:
```ts
      additionalDirectories: [],
      hooks: buildWorkspaceHook(root),
```

- [ ] **Step 4: Typecheck**

Run: `cd packages/agent-runtime && npx tsc --noEmit`
Expected: no errors.

---

## Task 8: Wire confinement into Claude `checkoutRepo`

**Files:**
- Modify: `packages/agent-runtime/src/providers/claude/operations/checkout-repo.ts`

- [ ] **Step 1: Add imports** (after line 4):
```ts
import { confinementSystemPrompt } from "../../../workspace-guard/index.ts";
import { buildWorkspaceHook } from "../utils/workspace-hook.ts";
```

- [ ] **Step 2: Build the confinement-prefixed prompt + root**

Inside `checkoutRepo`, after the `controller` block (after line 135), add:
```ts
  const root = opts.cwd ?? entries[0]?.repoDir ?? process.cwd();
  const prompt = [confinementSystemPrompt(root), buildPrompt(entries, opts.issue)].join("\n\n");
```

- [ ] **Step 3: Use the prompt and add the hook**

Change `prompt: buildPrompt(entries, opts.issue),` (line 139) to:
```ts
    prompt,
```
and inside `options`, after the `outputFormat` line (line 148), add:
```ts
      additionalDirectories: [],
      hooks: buildWorkspaceHook(root),
```

> Note: checkout uses `git -C <repoDir>` where each `repoDir` is under the workspace root, so legitimate commands pass `findBashEscape`. `date +%s` and `git ...` flags contain no out-of-root absolute paths.

- [ ] **Step 4: Typecheck**

Run: `cd packages/agent-runtime && npx tsc --noEmit`
Expected: no errors.

---

## Task 9: Hard-enforce AI SDK file tools (`fs.ts`)

**Files:**
- Modify: `packages/agent-runtime/src/providers/aisdk/tools/fs.ts`
- Test: `packages/agent-runtime/src/providers/aisdk/tools/fs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-runtime/src/providers/aisdk/tools/fs.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileImpl, writeFileImpl } from "./fs.ts";

let root: string;
beforeAll(() => {
  root = join(mkdtempSync(join(tmpdir(), "aisdk-fs-")), "workspace");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "in.txt"), "hello");
});

describe("aisdk fs tools confinement", () => {
  it("reads a file inside the workspace", async () => {
    const r = await readFileImpl({ path: "in.txt" }, { cwd: root });
    expect(r.content).toBe("hello");
  });
  it("refuses to read an absolute path outside the workspace", async () => {
    await expect(readFileImpl({ path: "/etc/passwd" }, { cwd: root })).rejects.toThrow(/outside the workspace/);
  });
  it("refuses to write outside the workspace via traversal", async () => {
    await expect(writeFileImpl({ path: "../escape.txt", content: "x" }, { cwd: root })).rejects.toThrow(/outside the workspace/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-runtime && npx vitest run src/providers/aisdk/tools/fs.test.ts`
Expected: FAIL — `/etc/passwd` is read instead of throwing (current `resolve()` allows absolute paths).

- [ ] **Step 3: Replace the `resolve` helper with workspace validation**

In `fs.ts`, change the imports on lines 1-2 to drop the now-unused `isAbsolute`/`join` if they become unused (keep `dirname`), and add the guard import:
```ts
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { tool, jsonSchema } from "ai";
import { resolveWithinWorkspace } from "../../../workspace-guard/index.ts";
import type { ToolCtx } from "./bash.ts";
```
Replace the `resolve` helper (line 7):
```ts
const resolve = (ctx: ToolCtx, p: string): string => {
  const root = ctx.cwd ?? process.cwd();
  const r = resolveWithinWorkspace(root, p);
  if (!r.ok) throw new Error(`${r.reason} Operate only within the workspace.`);
  return r.path;
};
```
(`readFileImpl`, `writeFileImpl`, `editFileImpl` already call `resolve(ctx, …)` — no further change. `searchImpl` runs `rg` with `cwd: ctx.cwd` and no path arg, so it is already confined to the workspace.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agent-runtime && npx vitest run src/providers/aisdk/tools/fs.test.ts`
Expected: PASS (3 tests).

---

## Task 10: Best-effort enforce AI SDK `bash.ts`

**Files:**
- Modify: `packages/agent-runtime/src/providers/aisdk/tools/bash.ts`
- Test: `packages/agent-runtime/src/providers/aisdk/tools/bash.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/agent-runtime/src/providers/aisdk/tools/bash.test.ts
import { describe, it, expect } from "vitest";
import { runBash } from "./bash.ts";

describe("aisdk runBash confinement", () => {
  it("blocks a command referencing a path outside the workspace", async () => {
    const r = await runBash("cat /etc/passwd", { cwd: "/workspace" });
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toMatch(/outside the workspace/);
  });
  it("runs a command that stays inside the workspace", async () => {
    const r = await runBash("echo hello", { cwd: process.cwd() });
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("hello");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agent-runtime && npx vitest run src/providers/aisdk/tools/bash.test.ts`
Expected: FAIL — `cat /etc/passwd` is spawned (exit 0/1 from cat, not the guard message).

- [ ] **Step 3: Add the pre-spawn guard**

In `bash.ts`, add the import after line 2:
```ts
import { findBashEscape } from "../../../workspace-guard/index.ts";
```
At the top of `runBash`, before `return new Promise(...)` (before line 19):
```ts
  if (ctx.cwd) {
    const bad = findBashEscape(command, ctx.cwd);
    if (bad) {
      return Promise.resolve({
        stdout: "",
        stderr: `blocked: '${bad}' is outside the workspace root '${ctx.cwd}'. Operate only within the workspace.`,
        exitCode: 1,
      });
    }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agent-runtime && npx vitest run src/providers/aisdk/tools/bash.test.ts`
Expected: PASS (2 tests).

---

## Task 11: Prepend system prompt in AI SDK `runCustomPrompt`

**Files:**
- Modify: `packages/agent-runtime/src/providers/aisdk/operations/run-custom-prompt.ts`

- [ ] **Step 1: Add import** (after line 10, the `makeStepLogger` import):
```ts
import { confinementSystemPrompt } from "../../../workspace-guard/index.ts";
```

- [ ] **Step 2: Prepend confinement to the prompt**

Replace the prompt line (currently line 64):
```ts
const prompt = [opts.prompt, buildSkillMenu(skills)].filter(Boolean).join("\n\n");
```
with:
```ts
const confinement = opts.cwd ? confinementSystemPrompt(opts.cwd) : "";
const prompt = [confinement, opts.prompt, buildSkillMenu(skills)].filter(Boolean).join("\n\n");
```

- [ ] **Step 3: Typecheck**

Run: `cd packages/agent-runtime && npx tsc --noEmit`
Expected: no errors.

---

## Task 12: OpenCode best-effort confinement

**Files:**
- Modify: `packages/agent-runtime/src/providers/opencode/operations/run-custom-prompt.ts`
- Modify: `packages/agent-runtime/src/providers/opencode/operations/scan-repos.ts`
- Modify: `packages/agent-runtime/src/providers/opencode/operations/checkout-repo.ts`

OpenCode runs its own tool loop, so there is no per-tool hook. Confinement here = set the working `directory` + prepend the system prompt. Documented best-effort.

- [ ] **Step 1: run-custom-prompt — prepend confinement to the prompt text**

Add import at the top (after the existing imports):
```ts
import { confinementSystemPrompt } from "../../../workspace-guard/index.ts";
```
The prompt is sent as `parts: [{ type: "text", text: opts.prompt }]`. Replace that single occurrence with a confinement-prefixed text. Just before the `client.session.prompt({` call, add:
```ts
  const promptText = [opts.cwd ? confinementSystemPrompt(opts.cwd) : "", opts.prompt].filter(Boolean).join("\n\n");
```
and change `parts: [{ type: "text", text: opts.prompt }],` to:
```ts
    parts: [{ type: "text", text: promptText }],
```
(`directory: opts.cwd` is already passed.)

- [ ] **Step 2: scan-repos — pass directory + prepend confinement**

Add the same import. Build a prefixed prompt and pass `directory`. Replace the `parts: [{ type: "text", text: buildPrompt(opts.parentDir) }],` line with:
```ts
    parts: [{ type: "text", text: [confinementSystemPrompt(opts.cwd ?? opts.parentDir), buildPrompt(opts.parentDir)].join("\n\n") }],
```
and add to the same `client.session.prompt({ ... })` object:
```ts
    ...(opts.cwd ? { directory: opts.cwd } : {}),
```

- [ ] **Step 3: checkout-repo — pass directory + prepend confinement**

Add the import. Replace `parts: [{ type: "text", text: buildPrompt(entries, opts.issue) }],` with:
```ts
    parts: [{ type: "text", text: [confinementSystemPrompt(opts.cwd ?? entries[0]?.repoDir ?? ""), buildPrompt(entries, opts.issue)].filter(Boolean).join("\n\n") }],
```
and add to the same prompt object:
```ts
    ...(opts.cwd ? { directory: opts.cwd } : {}),
```

- [ ] **Step 4: Typecheck + existing opencode test still green**

Run: `cd packages/agent-runtime && npx tsc --noEmit && npx vitest run src/providers/opencode/operations/run-custom-prompt.test.ts`
Expected: typecheck clean; existing test passes (it asserts `directory: "/workspace"` and does not assert the exact prompt text, so the prefix is non-breaking — confirm by reading the test's assertions).

---

## Task 13: Final verification (no commit)

**Files:** none

- [ ] **Step 1: Run the full agent-runtime test suite**

Run: `cd packages/agent-runtime && npx vitest run`
Expected: all workspace-guard, claude hook, aisdk fs/bash, and existing opencode tests pass; no new failures versus baseline.

- [ ] **Step 2: Typecheck the whole repo (the required final check)**

Run (from repo root): `npm run typecheck`
Expected: all workspaces typecheck with no errors.

- [ ] **Step 3: Import-boundary check**

Run (from repo root): `npm run check:boundaries`
Expected: no boundary violations (workspace-guard lives inside agent-runtime and imports nothing cross-package; core change adds only a field).

> Per user instruction: **do not commit.** Stop after verification and report status.

---

## Self-Review Notes

- **Spec coverage:** workspace-guard module (Tasks 1-3) ✓; Claude hard enforcement via PreToolUse (Tasks 4,6-8) ✓; AI SDK hard enforcement in fs.ts + bash.ts (Tasks 9-10) ✓; system prompt all providers (Tasks 6,7,8,11,12) ✓; OpenCode best-effort directory+prompt (Task 12) ✓; cwd threaded into scan/checkout (Tasks 5,7,8) ✓; always-on, no opt-out (no toggle introduced) ✓; tests for resolver/extractors/hook/bash (Tasks 1-4,9,10) ✓; logging of denials — Claude denials surface through the SDK message stream already logged by `logSdkMessage`; AI SDK tool errors surface in the step result — no extra logging task needed.
- **Type consistency:** `resolveWithinWorkspace`, `extractPaths`, `findBashEscape`, `confinementSystemPrompt`, `buildWorkspaceHook` names are identical across all tasks. `ResolveResult` discriminated on `ok`.
- **Placeholder scan:** no TBD/TODO; every code step shows full code.
