# Plan D — Windows Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the cross-cutting Windows gaps the dry runs found: the workspace-confinement guard's POSIX-only blind spot (security, #2), an unsupported-provider trap (AISDK on Windows, #16), the long-build step-timeout (#13), and a shippable agent bundle (#15).

**Architecture:** Independent hardening changes — no shared state. The workspace guard gains Windows drive/UNC path detection; the provider factory fails fast for `aisdk` on win32; a converter test pins the per-step timeout propagation and the README documents the recommended value; a build script produces a Windows agent bundle.

**Tech Stack:** TypeScript (Node 22, ESM, `.ts` imports), Vitest, esbuild.

**Reference spec:** [2026-06-12-windows-sandbox-design.md](../specs/2026-06-12-windows-sandbox-design.md) §12 findings 2, 13, 15, 16. **Depends on:** Plans A–C (merged).

---

## File Structure

- `packages/agent-runtime/src/workspace-guard/extract-paths.ts` — add Windows path escape detection (#2).
- `packages/agent-runtime/src/workspace-guard/extract-paths.test.ts` — extend.
- `packages/agent-runtime/src/providers/factory.ts` — win32 `aisdk` gate (#16).
- `packages/agent-runtime/src/providers/factory.test.ts` — create/extend.
- `packages/orchestrator/src/flow-json/conductor-converter.test.ts` — pin timeout propagation (#13).
- `packages/windows-agent/README.md` — timeout guidance (#13).
- `scripts/build-windows-agent.mjs` (new) + `packages/windows-agent/package.json` (`bundle` script) — packaging (#15).

---

## Task 1: Workspace guard — detect Windows path escapes (#2, security)

**Files:**
- Modify: `packages/agent-runtime/src/workspace-guard/extract-paths.ts`
- Test: `packages/agent-runtime/src/workspace-guard/extract-paths.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/agent-runtime/src/workspace-guard/extract-paths.test.ts` (create the file if absent, importing `findBashEscape`):

```typescript
import { describe, it, expect } from "vitest";
import { findBashEscape } from "./extract-paths.ts";

describe("findBashEscape — Windows paths", () => {
  const root = "C:\\jm-runs\\r1";

  it("flags a drive-absolute path outside the workspace", () => {
    expect(findBashEscape("type C:\\Windows\\System32\\drivers\\etc\\hosts", root)).toBe("C:\\Windows\\System32\\drivers\\etc\\hosts");
  });

  it("flags a UNC path", () => {
    expect(findBashEscape("copy \\\\fileserver\\share\\secrets.txt .", root)).toBe("\\\\fileserver\\share\\secrets.txt");
  });

  it("allows a drive path under the workspace root (case-insensitive)", () => {
    expect(findBashEscape("type c:\\jm-runs\\r1\\src\\a.cs", root)).toBeNull();
  });

  it("flags a drive path that climbs out via ..", () => {
    expect(findBashEscape("type C:\\jm-runs\\r1\\..\\r2\\x", root)).toBe("C:\\jm-runs\\r1\\..\\r2\\x");
  });

  it("still allows a clean POSIX command (regression)", () => {
    expect(findBashEscape("cat ./src/a.txt", "/work")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `npm test -w @journeyman/agent-runtime -- extract-paths`
Expected: FAIL — Windows tokens aren't detected today.

- [ ] **Step 3: Implement**

In `packages/agent-runtime/src/workspace-guard/extract-paths.ts`, add the helper and the Windows-token scan to `findBashEscape`:

```typescript
/** True if a Windows drive/UNC token is not contained within `root` (case-insensitive). */
function isWindowsPathOutside(root: string, tok: string): boolean {
  const norm = (p: string) => p.replace(/\//g, "\\").toLowerCase().replace(/\\+$/, "");
  const t = norm(tok);
  if (t.includes("..")) return true;            // any climb-out is suspect
  const r = norm(root);
  return !(t === r || t.startsWith(r + "\\"));
}
```

In `findBashEscape`, after the existing POSIX `absTokens` loop and before `return null;`:

```typescript
  // Windows drive-absolute (C:\…) and UNC (\\server\share) tokens.
  const winTokens = command.match(/(?<!\w)(?:[A-Za-z]:\\|\\\\)[^\s'";|&)<>]*/g) ?? [];
  for (const tok of winTokens) {
    if (isWindowsPathOutside(root, tok)) return tok;
  }
```

Also widen the `cd` check so a Windows target is evaluated too — replace the `cd` block:

```typescript
  const cd = command.match(/\bcd\s+(['"]?)([^\s'";|&]+)\1/);
  if (cd) {
    const target = cd[2];
    const looksWindows = /^(?:[A-Za-z]:\\|\\\\)/.test(target);
    const escapes = looksWindows ? isWindowsPathOutside(root, target) : !resolveWithinWorkspace(root, target).ok;
    if (escapes) return target;
  }
```

- [ ] **Step 4: Run + commit**

Run: `npm test -w @journeyman/agent-runtime -- extract-paths`
Expected: PASS (incl. the POSIX regression).

```bash
git add packages/agent-runtime/src/workspace-guard/extract-paths.ts packages/agent-runtime/src/workspace-guard/extract-paths.test.ts
git commit -m "fix(agent-runtime): workspace guard detects Windows drive/UNC path escapes (security)"
```

---

## Task 2: Provider factory — fail fast for AISDK on Windows (#16)

**Files:**
- Modify: `packages/agent-runtime/src/providers/factory.ts`
- Test: `packages/agent-runtime/src/providers/factory.test.ts`

- [ ] **Step 1: Write the failing test**

Create/extend `packages/agent-runtime/src/providers/factory.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { createCodingProvider } from "./factory.ts";

const setPlatform = (p: NodeJS.Platform) =>
  Object.defineProperty(process, "platform", { value: p, configurable: true });
const realPlatform = process.platform;
afterEach(() => setPlatform(realPlatform));

describe("createCodingProvider — AISDK on Windows", () => {
  it("throws a ConfigurationError for aisdk on win32", () => {
    setPlatform("win32");
    expect(() => createCodingProvider("aisdk", { env: {} })).toThrow(/not supported on Windows/i);
  });

  it("allows aisdk on non-Windows", () => {
    setPlatform("linux");
    expect(() => createCodingProvider("aisdk", { env: {} })).not.toThrow();
  });

  it("allows claude on win32", () => {
    setPlatform("win32");
    expect(() => createCodingProvider("claude", { env: {} })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `npm test -w @journeyman/agent-runtime -- factory`
Expected: FAIL — aisdk on win32 does not throw today.

- [ ] **Step 3: Implement**

In `packages/agent-runtime/src/providers/factory.ts`, in the `case "aisdk":` block, gate before constructing:

```typescript
    case "aisdk":
      if (process.platform === "win32") {
        const err = new Error("the 'aisdk' coding provider is not supported on Windows (it requires bash + ripgrep); use 'claude' or 'opencode'") as Error & { name: string };
        err.name = "ConfigurationError";
        throw err;
      }
      // Model + per-vendor credential arrive per-operation via opts.model /
      // opts.modelConfig / opts.env; the provider loads the @ai-sdk package
      // selected by config.npm at run time.
      return new AiSdkProvider();
```

- [ ] **Step 4: Run + commit**

Run: `npm test -w @journeyman/agent-runtime -- factory`
Expected: PASS.

```bash
git add packages/agent-runtime/src/providers/factory.ts packages/agent-runtime/src/providers/factory.test.ts
git commit -m "feat(agent-runtime): fail fast for the aisdk provider on Windows (finding 16)"
```

---

## Task 3: Pin the per-step timeout propagation + document it (#13)

**Why:** confirm a node's `retry.timeoutSeconds` overrides the default 600s on both `timeoutSeconds` and `responseTimeoutSeconds`, so a long Windows build step can be given a larger limit.

**Files:**
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.test.ts` (create/extend)
- Modify: `packages/windows-agent/README.md`

- [ ] **Step 1: Inspect the converter shape**

Read `packages/orchestrator/src/flow-json/conductor-converter.ts` around the `timeoutSeconds: r.timeoutSeconds ?? 600` / `responseTimeoutSeconds: r.timeoutSeconds ?? 600` lines and the function that builds a Conductor task from a node (note its name + how `r` / `retry` is sourced — `resolvedNode.retry`).

- [ ] **Step 2: Write the test**

Add to `packages/orchestrator/src/flow-json/conductor-converter.test.ts` a case that converts a minimal flow with one node carrying `retry: { timeoutSeconds: 2700 }` and asserts the produced Conductor task has `timeoutSeconds === 2700` and `responseTimeoutSeconds === 2700`; and a second node with no retry asserts both default to `600`.

```typescript
// Shape the input to match the converter's existing tests in this file (reuse their
// flow/Conductor builder helpers). Core assertions:
//   expect(taskWithTimeout.timeoutSeconds).toBe(2700);
//   expect(taskWithTimeout.responseTimeoutSeconds).toBe(2700);
//   expect(taskDefault.timeoutSeconds).toBe(600);
```

> Match the existing converter-test harness in the file for constructing flows/nodes — don't invent a new one. If no test file exists, create one mirroring the converter's public entry (e.g. `flowToConductorWorkflow(flow)`), asserting the two timeout fields on the emitted task.

- [ ] **Step 3: Run it**

Run: `npm test -w @journeyman/orchestrator -- conductor-converter`
Expected: PASS (the converter already supports `r.timeoutSeconds ?? 600` — this pins it against regression). If it FAILS, the override is not wired end-to-end → fix the converter so the node `retry.timeoutSeconds` flows into both fields, then re-run.

- [ ] **Step 4: Document the recommended value**

In `packages/windows-agent/README.md`, add a short "Long builds" note: Windows build/QA steps often exceed the default 10-minute step timeout; set a higher **timeout** on the step's Retry tab (or the flow's Defaults → Retry) — e.g. 2700s for big .NET builds. The agent's gRPC keepalive keeps the connection alive during quiet stretches.

- [ ] **Step 5: Commit**

```bash
git add packages/orchestrator/src/flow-json/conductor-converter.test.ts packages/windows-agent/README.md
git commit -m "test(orchestrator): pin per-step timeout propagation; document Windows long-build timeout (finding 13)"
```

---

## Task 4: Package a shippable Windows agent bundle (#15)

**Why:** today the runtime only ships as Docker images; a non-Docker Windows box needs a plain artifact. This task produces the agent bundle; the operator also installs Node 22, Git for Windows, and the runner bundle (documented).

**Files:**
- Create: `scripts/build-windows-agent.mjs`
- Modify: `packages/windows-agent/package.json` (add a `bundle` script + esbuild devDep), `packages/windows-agent/README.md`

- [ ] **Step 1: Add the bundle script to the package**

In `packages/windows-agent/package.json`, add to `scripts`:

```json
    "bundle": "esbuild src/cli.ts --bundle --platform=node --format=esm --target=node22 --external:@grpc/grpc-js --external:@grpc/proto-loader --external:tar --outfile=dist/windows-agent.js"
```

and add `"esbuild": "^0.24.0"` to `devDependencies`. Run `npm install`.

> gRPC/proto-loader/tar stay external (installed via `npm ci --omit=dev` on the box). `@journeyman/agent-protocol`'s `.proto` is loaded at runtime via `PROTO_PATH` — the build copies it next to the bundle (next step).

- [ ] **Step 2: Write the packaging script**

Create `scripts/build-windows-agent.mjs`:

```javascript
import { execFileSync } from "node:child_process";
import { mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const agentDir = join(root, "packages", "windows-agent");
const dist = join(agentDir, "dist");
mkdirSync(dist, { recursive: true });

// 1. Bundle the agent entrypoint.
execFileSync("npm", ["run", "bundle", "-w", "@journeyman/windows-agent"], { cwd: root, stdio: "inherit" });

// 2. Copy the .proto next to the bundle (proto-loader reads it at runtime).
copyFileSync(
  join(root, "packages", "agent-protocol", "src", "journeyman-agent.proto"),
  join(dist, "journeyman-agent.proto"),
);

// 3. Emit a manifest the operator/installer reads.
writeFileSync(join(dist, "manifest.json"), JSON.stringify({
  artifact: "windows-agent",
  entry: "windows-agent.js",
  externals: ["@grpc/grpc-js", "@grpc/proto-loader", "tar"],
  requires: ["node>=22", "git-for-windows", "runner bundle (runner.js + node_modules)"],
}, null, 2) + "\n");

process.stdout.write(`windows-agent bundle written to ${dist}\n`);
```

> The `.proto` is copied as a sibling of `dist/windows-agent.js`, so `agent-protocol`'s `PROTO_PATH` (resolved from the bundled module's URL) finds it. If the bundler rewrites that path, add an explicit `JM_AGENT_PROTO_PATH` env override in `agent-protocol`'s loader as a follow-up.

- [ ] **Step 3: Smoke test the bundle loads + runs the readiness gate**

Run:
```bash
node scripts/build-windows-agent.mjs
JM_AGENT_WORKSPACE_ROOT="$(mktemp -d)" JM_AGENT_CERT_DIR="/nope" node packages/windows-agent/dist/windows-agent.js; echo "exit=$?"
```
Expected: the bundle loads and prints the **readiness scorecard**; it then exits non-zero either at the readiness gate (if a check fails) or at cert load (`/nope`) — both prove the bundle is runnable and self-checks before serving. (On Linux this stands in for the Windows box.)

- [ ] **Step 4: README packaging section**

In `packages/windows-agent/README.md`, add "Packaging & install": run `node scripts/build-windows-agent.mjs` → produces `dist/` (`windows-agent.js`, `journeyman-agent.proto`, `manifest.json`); copy `dist/` + the runner bundle + `node_modules` (prod) to the box; install Node 22 + Git for Windows; place certs in `JM_AGENT_CERT_DIR`; run `node windows-agent.js` (or register it as a service). Full installer/service wrapper is a later iteration.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-windows-agent.mjs packages/windows-agent/package.json packages/windows-agent/README.md package-lock.json
git commit -m "build(windows-agent): packaging script for a shippable Windows agent bundle (finding 15)"
```

---

## Task 5: Verification pass

- [ ] **Step 1: Typecheck all** — `npm run typecheck` → PASS.
- [ ] **Step 2: Boundaries** — `npm run check:boundaries` → PASS.
- [ ] **Step 3: Tests** — `bash packages/windows-agent/spike/make-certs.sh && npm test` → no new failures; new guard/factory/converter tests green.
- [ ] **Step 4: Re-confirm the security fix** — `grep -n "isWindowsPathOutside" packages/agent-runtime/src/workspace-guard/extract-paths.ts` shows the new guard is present.
- [ ] **Step 5: Commit any cleanup** — `git add -A && git commit -m "chore: Plan D verification pass" || echo "nothing to commit"`.

---

## Self-Review Notes

- **Spec coverage:** workspace-guard Windows paths (#2) — Task 1; AISDK win32 gate (#16) — Task 2; per-step timeout propagation + docs (#13) — Task 3; shippable agent bundle (#15) — Task 4.
- **Security:** Task 1 closes the dry run's HIGH-severity gap (Windows paths bypassing the workspace fence). It stays a *focus guardrail* (the function's existing caveat) — not a hard sandbox boundary — but no longer has a Windows-shaped hole.
- **Testability:** the guard test runs on Linux by passing Windows-style `root`/tokens as strings (string-prefix logic, not OS path resolution). The factory test toggles `process.platform`. The converter test reuses the file's existing flow-builder harness.
- **Out of scope (small follow-ups):** surfacing "which sandbox a step used" in the run view (#17); a full Windows installer/NSSM service wrapper + auto-bundling the Node binary and runner (Task 4 produces the agent bundle and documents the rest); the interactive-desktop `session` mode (reserved seam, not built).
