# Workers Runner Extraction + Base Image Implementation Plan (Plan 2 of 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a `journeyman-runner` from `@journeyman/coding-cli` so its operations can run **in-process** (via an `OperationRunner` adapter that satisfies Plan 1's seam) **or via stdin→stdout** (a CLI entrypoint), and ship a `journeyman/runner-base` Docker image (Node + git + ssh + CA certs + the runner) that later plans use.

**Architecture:** A single `dispatchOperation(provider, op, opts, hooks)` maps an op name (`custom-prompt`, `scan-repos`, `checkout-repo`, `cleanup-repos`, `create-workspace`) to the existing `ICodingCLI` methods and returns a JSON-serializable `RunnerResponse`. Two thin wrappers consume it: `createCodingOperationRunner()` (in-process, returns the `OperationRunner` Plan 1's `LocalExecutionEnvironment`/`createDefaultRegistry` expect) and `runRunnerCli()` (string-in → string-out, wrapped by `cli.ts` reading stdin/stdout). No behavior change to existing callers — this is purely additive. Wiring the adapter into the worker harness is Plan 4.

**Tech Stack:** TypeScript (NodeNext, `.ts`-extension imports), vitest 2.1.9, Docker (`node:22-slim` base). The Claude Agent SDK is a peer dep already present.

**Depends on:** Plan 1 (Workers Foundation) — uses `OperationRunner`, `ExecOp`, `ExecResult` from `@journeyman/core`.

---

## File Structure (Plan 2)

- `packages/coding-cli/src/runner/runner-types.ts` — **Create.** `RunnerRequest` / `RunnerResponse` envelope types.
- `packages/coding-cli/src/runner/dispatch.ts` — **Create.** `dispatchOperation()` — op-name → `ICodingCLI` method.
- `packages/coding-cli/src/runner/dispatch.test.ts` — **Create.**
- `packages/coding-cli/src/runner/operation-runner.ts` — **Create.** `createCodingOperationRunner()` → `OperationRunner` (in-process adapter).
- `packages/coding-cli/src/runner/operation-runner.test.ts` — **Create.**
- `packages/coding-cli/src/runner/run-cli.ts` — **Create.** `runRunnerCli(input, provider, onLog)` pure string→string.
- `packages/coding-cli/src/runner/run-cli.test.ts` — **Create.**
- `packages/coding-cli/src/runner/cli.ts` — **Create.** Executable entry: stdin→stdout wiring + `--selftest`. (Not unit-tested; Docker smoke test only.)
- `packages/coding-cli/package.json` — **Modify.** Add `bin`, `test` script, `vitest` devDep.
- `packages/coding-cli/src/index.ts` — **Modify.** Export the runner surface.
- `docker/runner-base.Dockerfile` — **Create.** `journeyman/runner-base` image.
- `scripts/build-runner-image.sh` — **Create.** Build helper + smoke instructions.

---

## Task 1: Runner envelope types + dispatch

**Files:**
- Create: `packages/coding-cli/src/runner/runner-types.ts`
- Create: `packages/coding-cli/src/runner/dispatch.ts`
- Test: `packages/coding-cli/src/runner/dispatch.test.ts`

- [ ] **Step 1: Create the envelope types**

Create `packages/coding-cli/src/runner/runner-types.ts`:

```typescript
/** Request piped to the runner (stdin) or passed to an in-process dispatch. */
export interface RunnerRequest {
  /** Operation id: "custom-prompt" | "scan-repos" | "checkout-repo" | "cleanup-repos" | "create-workspace". */
  op: string;
  /** Operation options (the ICodingCLI method's options, minus functions). */
  opts?: Record<string, unknown>;
}

/** Response written by the runner (stdout) / returned by dispatch. */
export interface RunnerResponse {
  ok: boolean;
  /** Structured payload for the operation (e.g. the method's result object). */
  structured?: unknown;
  /** Text payload for text-mode custom prompts. */
  result?: string;
  error?: string;
}
```

- [ ] **Step 2: Write the failing test**

Create `packages/coding-cli/src/runner/dispatch.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { ICodingCLI } from "@journeyman/core";
import { dispatchOperation } from "./dispatch.ts";

function fakeProvider(over: Partial<ICodingCLI> = {}): ICodingCLI {
  return {
    scanRepos: async () => ({ repos: [] }),
    checkoutRepo: async () => ({ repos: [], newBranch: "x" }),
    cleanupRepos: async () => ({ repos: [] }),
    createWorkspace: async () => ({ folderName: "f", repoDir: "/d" }),
    runCustomPrompt: async () => ({ structured: { a: 1 } }),
    ...over,
  };
}

describe("dispatchOperation", () => {
  it("custom-prompt returns structured output", async () => {
    const r = await dispatchOperation(fakeProvider(), "custom-prompt", {
      prompt: "hi",
      outputMode: "structured",
    });
    expect(r).toEqual({ ok: true, structured: { a: 1 } });
  });

  it("custom-prompt error → ok:false", async () => {
    const r = await dispatchOperation(
      fakeProvider({ runCustomPrompt: async () => ({ error: "boom" }) }),
      "custom-prompt",
      {},
    );
    expect(r).toEqual({ ok: false, error: "boom" });
  });

  it("scan-repos returns the result as structured", async () => {
    const r = await dispatchOperation(
      fakeProvider({
        scanRepos: async () => ({ repos: [{ folderName: "a", repoDir: "/a", isGitRepo: true }] }),
      }),
      "scan-repos",
      { parentDir: "/x" },
    );
    expect(r.ok).toBe(true);
    expect(r.structured).toEqual({ repos: [{ folderName: "a", repoDir: "/a", isGitRepo: true }] });
  });

  it("git op error → ok:false", async () => {
    const r = await dispatchOperation(
      fakeProvider({ scanRepos: async () => ({ repos: [], error: "nope" }) }),
      "scan-repos",
      {},
    );
    expect(r).toEqual({ ok: false, error: "nope" });
  });

  it("unknown op → ok:false", async () => {
    const r = await dispatchOperation(fakeProvider(), "frobnicate", {});
    expect(r).toEqual({ ok: false, error: "unknown op 'frobnicate'" });
  });

  it("forwards cwd, onLog and signal to custom-prompt", async () => {
    const seen: Record<string, unknown> = {};
    const r = await dispatchOperation(
      fakeProvider({
        runCustomPrompt: async (o) => {
          seen.cwd = (o as { cwd?: string }).cwd;
          seen.hasLog = typeof o.onLog === "function";
          seen.hasSignal = Boolean(o.signal);
          return { structured: {} };
        },
      }),
      "custom-prompt",
      { cwd: "/ws" },
      { onLog: () => {}, signal: new AbortController().signal },
    );
    expect(r.ok).toBe(true);
    expect(seen).toEqual({ cwd: "/ws", hasLog: true, hasSignal: true });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/coding-cli/src/runner/dispatch.test.ts`
Expected: FAIL — cannot resolve `./dispatch.ts`.

- [ ] **Step 4: Write the implementation**

Create `packages/coding-cli/src/runner/dispatch.ts`:

```typescript
import type { CodingCliLogFn, ICodingCLI } from "@journeyman/core";
import type { RunnerResponse } from "./runner-types.ts";

/**
 * Map an operation name to the matching ICodingCLI method and normalize the
 * outcome into a JSON-serializable RunnerResponse. Used both in-process
 * (operation-runner) and via the CLI (run-cli).
 */
export async function dispatchOperation(
  provider: ICodingCLI,
  op: string,
  opts: Record<string, unknown>,
  hooks: { onLog?: CodingCliLogFn; signal?: AbortSignal } = {},
): Promise<RunnerResponse> {
  // `opts` is JSON (no functions); merge runtime-only hooks here.
  const base = {
    ...opts,
    ...(hooks.signal ? { signal: hooks.signal } : {}),
  } as Record<string, unknown>;

  switch (op) {
    case "custom-prompt": {
      const r = await provider.runCustomPrompt({
        ...base,
        ...(hooks.onLog ? { onLog: hooks.onLog } : {}),
      } as Parameters<ICodingCLI["runCustomPrompt"]>[0]);
      if (r.error) return { ok: false, error: r.error };
      return { ok: true, structured: r.structured, result: r.result };
    }
    case "scan-repos": {
      const r = await provider.scanRepos(base as Parameters<ICodingCLI["scanRepos"]>[0]);
      return r.error ? { ok: false, error: r.error } : { ok: true, structured: r };
    }
    case "checkout-repo": {
      const r = await provider.checkoutRepo(base as Parameters<ICodingCLI["checkoutRepo"]>[0]);
      return r.error ? { ok: false, error: r.error } : { ok: true, structured: r };
    }
    case "cleanup-repos": {
      const r = await provider.cleanupRepos(base as Parameters<ICodingCLI["cleanupRepos"]>[0]);
      return r.error ? { ok: false, error: r.error } : { ok: true, structured: r };
    }
    case "create-workspace": {
      const r = await provider.createWorkspace(base as Parameters<ICodingCLI["createWorkspace"]>[0]);
      return r.error ? { ok: false, error: r.error } : { ok: true, structured: r };
    }
    default:
      return { ok: false, error: `unknown op '${op}'` };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run packages/coding-cli/src/runner/dispatch.test.ts`
Expected: PASS (6 tests).

---

## Task 2: In-process OperationRunner adapter

**Files:**
- Create: `packages/coding-cli/src/runner/operation-runner.ts`
- Test: `packages/coding-cli/src/runner/operation-runner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/coding-cli/src/runner/operation-runner.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { ICodingCLI } from "@journeyman/core";
import { createCodingOperationRunner } from "./operation-runner.ts";

function fakeProvider(): ICodingCLI {
  return {
    scanRepos: async () => ({ repos: [] }),
    checkoutRepo: async () => ({ repos: [], newBranch: "x" }),
    cleanupRepos: async () => ({ repos: [] }),
    createWorkspace: async () => ({ folderName: "f", repoDir: "/d" }),
    runCustomPrompt: async (o) => ({ structured: { cwd: (o as { cwd?: string }).cwd } }),
  };
}

describe("createCodingOperationRunner", () => {
  it("maps ExecOp to dispatch, injecting workspaceDir as cwd and passing env to the provider factory", async () => {
    const envs: Array<Record<string, string>> = [];
    const run = createCodingOperationRunner({
      makeProvider: (env) => {
        envs.push(env);
        return fakeProvider();
      },
    });
    const res = await run(
      { op: "custom-prompt", stdin: { prompt: "hi", outputMode: "structured" }, env: { ANTHROPIC_API_KEY: "k" } },
      { workspaceDir: "/ws" },
    );
    expect(res).toEqual({ ok: true, structured: { cwd: "/ws" } });
    expect(envs).toEqual([{ ANTHROPIC_API_KEY: "k" }]);
  });

  it("returns an error ExecResult on unknown op", async () => {
    const run = createCodingOperationRunner({ makeProvider: () => fakeProvider() });
    const res = await run({ op: "nope", stdin: {} }, { workspaceDir: "/ws" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/unknown op/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/coding-cli/src/runner/operation-runner.test.ts`
Expected: FAIL — cannot resolve `./operation-runner.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/coding-cli/src/runner/operation-runner.ts`:

```typescript
import type { ICodingCLI, OperationRunner } from "@journeyman/core";
import { dispatchOperation } from "./dispatch.ts";

export interface CodingOperationRunnerDeps {
  /** Build a coding provider for a given per-exec env (e.g. ANTHROPIC_API_KEY). */
  makeProvider: (env: Record<string, string>) => ICodingCLI;
}

/**
 * Adapt the coding-cli operations to Plan 1's OperationRunner seam so the
 * `local` execution environment can run them in-process. The workspaceDir from
 * the provisioned env is injected as the operation's `cwd`.
 */
export function createCodingOperationRunner(deps: CodingOperationRunnerDeps): OperationRunner {
  return async (op, ctx) => {
    const provider = deps.makeProvider(op.env ?? {});
    const opts = {
      ...((op.stdin as Record<string, unknown> | undefined) ?? {}),
      cwd: ctx.workspaceDir,
    };
    const res = await dispatchOperation(provider, op.op, opts, {
      ...(op.onLog ? { onLog: op.onLog } : {}),
      ...(op.signal ? { signal: op.signal } : {}),
    });
    return { ok: res.ok, structured: res.structured ?? res.result, error: res.error };
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/coding-cli/src/runner/operation-runner.test.ts`
Expected: PASS (2 tests).

---

## Task 3: stdin/stdout CLI (pure fn + executable + bin + exports)

**Files:**
- Create: `packages/coding-cli/src/runner/run-cli.ts`
- Test: `packages/coding-cli/src/runner/run-cli.test.ts`
- Create: `packages/coding-cli/src/runner/cli.ts`
- Modify: `packages/coding-cli/package.json`
- Modify: `packages/coding-cli/src/index.ts`

- [ ] **Step 1: Write the failing test for the pure CLI function**

Create `packages/coding-cli/src/runner/run-cli.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { ICodingCLI } from "@journeyman/core";
import { runRunnerCli } from "./run-cli.ts";

function fakeProvider(): ICodingCLI {
  return {
    scanRepos: async () => ({ repos: [] }),
    checkoutRepo: async () => ({ repos: [], newBranch: "x" }),
    cleanupRepos: async () => ({ repos: [] }),
    createWorkspace: async () => ({ folderName: "f", repoDir: "/d" }),
    runCustomPrompt: async () => ({ structured: { ok: 1 } }),
  };
}

describe("runRunnerCli", () => {
  it("dispatches a valid request and returns a JSON response string", async () => {
    const out = await runRunnerCli(
      JSON.stringify({ op: "custom-prompt", opts: { prompt: "hi", outputMode: "structured" } }),
      fakeProvider(),
    );
    expect(JSON.parse(out)).toEqual({ ok: true, structured: { ok: 1 } });
  });

  it("returns ok:false on invalid JSON", async () => {
    const out = await runRunnerCli("{not json", fakeProvider());
    const parsed = JSON.parse(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toMatch(/invalid JSON/);
  });

  it("returns ok:false when op is missing", async () => {
    const out = await runRunnerCli(JSON.stringify({ opts: {} }), fakeProvider());
    expect(JSON.parse(out)).toEqual({ ok: false, error: "request must include a string 'op'" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/coding-cli/src/runner/run-cli.test.ts`
Expected: FAIL — cannot resolve `./run-cli.ts`.

- [ ] **Step 3: Write the pure CLI function**

Create `packages/coding-cli/src/runner/run-cli.ts`:

```typescript
import type { CodingCliLogFn, ICodingCLI } from "@journeyman/core";
import { dispatchOperation } from "./dispatch.ts";
import type { RunnerRequest } from "./runner-types.ts";

/** Parse a RunnerRequest JSON string, dispatch it, and return a RunnerResponse JSON string. */
export async function runRunnerCli(
  input: string,
  provider: ICodingCLI,
  onLog?: CodingCliLogFn,
): Promise<string> {
  let req: RunnerRequest;
  try {
    req = JSON.parse(input) as RunnerRequest;
  } catch (e) {
    return JSON.stringify({ ok: false, error: `invalid JSON request: ${(e as Error).message}` });
  }
  if (!req || typeof req.op !== "string") {
    return JSON.stringify({ ok: false, error: "request must include a string 'op'" });
  }
  const res = await dispatchOperation(provider, req.op, req.opts ?? {}, {
    ...(onLog ? { onLog } : {}),
  });
  return JSON.stringify(res);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/coding-cli/src/runner/run-cli.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Create the executable entry `cli.ts`**

Create `packages/coding-cli/src/runner/cli.ts`:

```typescript
#!/usr/bin/env node
/**
 * journeyman-runner — reads a RunnerRequest JSON on stdin, runs the operation
 * via the Claude provider, and writes a RunnerResponse JSON on stdout. SDK log
 * lines go to stderr. `--selftest` prints a fixed ok response without invoking
 * the SDK (used by the image smoke test; needs no API key).
 */
import { ClaudeProvider } from "../index.ts";
import { runRunnerCli } from "./run-cli.ts";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  if (process.argv.includes("--selftest")) {
    process.stdout.write(JSON.stringify({ ok: true, structured: { selftest: true } }));
    return;
  }
  const input = await readStdin();
  const provider = new ClaudeProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
  const out = await runRunnerCli(input, provider, (line) => process.stderr.write(line + "\n"));
  process.stdout.write(out);
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ ok: false, error: String((err as Error)?.message ?? err) }));
  process.exit(1);
});
```

- [ ] **Step 6: Add `bin`, `test` script, and `vitest` devDep to `packages/coding-cli/package.json`**

Replace the file's `"scripts"` block and `"devDependencies"` block, and add a `"bin"` field, so the file reads exactly:

```json
{
  "name": "@journeyman/coding-cli",
  "version": "0.1.0",
  "description": "AI coding CLI providers — Claude, Gemini, Codex. Analyze, plan, implement, and run git operations.",
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "bin": { "journeyman-runner": "./src/runner/cli.ts" },
  "files": ["src"],
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@journeyman/core": "*",
    "@journeyman/mcp": "*",
    "@journeyman/skills": "*",
    "@opencode-ai/sdk": "latest"
  },
  "peerDependencies": {
    "@anthropic-ai/claude-agent-sdk": ">=0.2.0"
  },
  "devDependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.112",
    "@types/node": "^25.6.0",
    "typescript": "^6.0.3",
    "vitest": "^2.1.9"
  }
}
```

- [ ] **Step 7: Export the runner surface from `packages/coding-cli/src/index.ts`**

Append these lines to `packages/coding-cli/src/index.ts`:

```typescript
export { dispatchOperation } from "./runner/dispatch.ts";
export { createCodingOperationRunner } from "./runner/operation-runner.ts";
export type { CodingOperationRunnerDeps } from "./runner/operation-runner.ts";
export { runRunnerCli } from "./runner/run-cli.ts";
export type { RunnerRequest, RunnerResponse } from "./runner/runner-types.ts";
```

- [ ] **Step 8: Reinstall so the new bin is linked, then run the coding-cli suite**

Run: `npm install && npm test -w @journeyman/coding-cli`
Expected: PASS — dispatch (6) + operation-runner (2) + run-cli (3) = 11 tests. (No SDK is loaded because no test imports `cli.ts`/`index.ts`.)

---

## Task 4: `journeyman/runner-base` Docker image

**Files:**
- Create: `docker/runner-base.Dockerfile`
- Create: `scripts/build-runner-image.sh`

This task is verified by a Docker build + a `--selftest` smoke run. These steps are **gated**: run them only where Docker is available. If Docker is unavailable, mark this task blocked and note it (do not fake the verification).

- [ ] **Step 1: Create the Dockerfile**

Create `docker/runner-base.Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.7
# journeyman/runner-base — Node + the journeyman-runner + baseline coding tools
# (git, ssh, CA certs). Custom worker images FROM this; the Docker backend also
# uses it as the default runner image. See spec §8.
FROM node:22-slim AS runner-base

# Baseline toolset every coding container needs (spec §1 item 4 / §8).
RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      openssh-client \
      ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install workspace deps (incl. dev: tsx + the Agent SDK live there).
COPY package.json package-lock.json ./
COPY packages ./packages
RUN find packages -mindepth 2 -maxdepth 2 ! -name 'package.json' -exec rm -rf {} + 2>/dev/null || true
RUN npm ci --include=dev

# Bring in the full source (runner + providers run via tsx).
COPY . .

ENV PATH=/app/node_modules/.bin:$PATH

# The runner reads a RunnerRequest on stdin and writes a RunnerResponse on stdout.
ENTRYPOINT ["npx", "tsx", "packages/coding-cli/src/runner/cli.ts"]
```

- [ ] **Step 2: Create the build helper**

Create `scripts/build-runner-image.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

TAG="${TAG:-dev}"
IMAGE="journeyman/runner-base:${TAG}"

echo ">>> Building ${IMAGE}"
docker build -f docker/runner-base.Dockerfile -t "${IMAGE}" .

echo ">>> Smoke test (--selftest, no API key needed)"
OUT="$(docker run --rm "${IMAGE}" --selftest)"
echo "runner output: ${OUT}"
case "${OUT}" in
  *'"ok":true'*'"selftest":true'*) echo "OK: runner-base image works" ;;
  *) echo "FAIL: unexpected selftest output" >&2; exit 1 ;;
esac
```

- [ ] **Step 3: Make the script executable**

Run: `chmod +x scripts/build-runner-image.sh`
Expected: no output, exit 0.

- [ ] **Step 4: Build the image and run the smoke test (GATED — Docker required)**

Run: `./scripts/build-runner-image.sh`
Expected: build completes; final lines include `runner output: {"ok":true,"structured":{"selftest":true}}` and `OK: runner-base image works`.

If `docker` is not installed/running: skip Step 4, leave a note that the image smoke test is unverified in this environment, and continue.

---

## Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the coding-cli test suite**

Run: `npm test -w @journeyman/coding-cli`
Expected: PASS (11 tests: dispatch 6, operation-runner 2, run-cli 3).

- [ ] **Step 2: Typecheck coding-cli (compiles cli.ts → exercises ClaudeProvider/SDK types)**

Run: `npm run typecheck -w @journeyman/coding-cli`
Expected: PASS (exit 0).

- [ ] **Step 3: Repo-wide checks**

Run: `npm run check`
Expected: PASS (typecheck across workspaces + import boundaries; coding-cli still `backend`, imports only `@journeyman/core` and existing deps — no new cross-package imports introduced).

- [ ] **Step 4: Confirm no existing-caller behavior change**

The existing `ClaudeProvider`, operations, and step handlers are untouched (the runner is additive). Confirm:

Run: `git diff --name-only`
Expected: only the files listed in this plan's File Structure (under `packages/coding-cli/`, `docker/`, `scripts/`). Nothing in `orchestrator/` or `core/` (the harness/seam wiring is Plan 4).

---

## Self-Review

**Spec coverage (Plan 2 scope):**
- §5 (runner entrypoint: stdin JSON → operation → stdout JSON; in-process *or* containerized) → Tasks 1–3 (`dispatchOperation`, `runRunnerCli`, `cli.ts`).
- §5 (in-process path preserved; adapter to the seam) → Task 2 (`createCodingOperationRunner` returns `OperationRunner`, consumed later by `createDefaultRegistry`).
- §1 item 4 / §8 (base runner image incl. git/ssh/CA certs) → Task 4 (`runner-base.Dockerfile`).
- §15 (stdout = result envelope only; stderr = logs) → `cli.ts` writes the JSON response to stdout and routes `onLog` to stderr; `run-cli`/`dispatch` keep result data structured.
- Deferred (noted): the fully-relocatable `journeyman/runner-bundle` for `COPY --from` auto-wrap → Plan 5; harness routing of `requiresWorkspace` steps + wiring `createCodingOperationRunner` into `createDefaultRegistry` → Plan 4. The text-vs-structured distinction is flattened into `ExecResult.structured` for now; Plan 4 maps it back to step output mode.

**Placeholder scan:** No TBD/TODO. Every code step shows complete code; every command shows expected output. Task 4's Docker steps are explicitly gated with a documented fallback (not a silent skip).

**Type consistency:** `RunnerRequest` (`op`, `opts?`) and `RunnerResponse` (`ok`, `structured?`, `result?`, `error?`) are defined once (Task 1) and used identically in `dispatch.ts`, `run-cli.ts`, and tests. `dispatchOperation(provider, op, opts, hooks)` signature matches its callers in `operation-runner.ts` and `run-cli.ts`. `createCodingOperationRunner({ makeProvider })` returns `OperationRunner` from `@journeyman/core` (Plan 1) and its `(op, ctx)` shape matches `ExecOp`/`{ workspaceDir }`. Op names (`custom-prompt`, `scan-repos`, `checkout-repo`, `cleanup-repos`, `create-workspace`) are consistent between `dispatch.ts` and the tests.
