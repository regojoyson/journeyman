# Phase 7 — Legacy Retirement & Capability Cleanup

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. Per the user's standing preference: skip unit-test steps, no per-task commits, run typecheck only at the end of the phase, parallel writes wherever possible.
>
> **User directive for this phase:** *physically remove* the legacy packages (don't deprecate). Find and fix any remaining references in code, scripts, and configs.

**Goal:** Hard-delete the three legacy packages — `@journeyman/pipeline`, `@journeyman/pipeline-server`, `@journeyman/ui` — and every reference to them. The new stack (`orchestrator`, `api-server`, `flow-editor`, `run-viewer`, `runs-list`, `web`, `migrations`, plus `core`) becomes the only stack. As a side cleanup, formalize the capability extensions on `IOrchestratorEngine` that Phase 6 added behind structural casts (Pause / Resume / Retry-from-task), and tighten the per-user workspace contract.

**Architecture:** Pure removal pass + a small interface widening. No new packages introduced. The repo shrinks from 16 → 13 workspace packages. Engine capability interfaces in `@journeyman/core` (`IPauseableEngine`, `IRetryableEngine`) replace the inline structural casts in api-server's run routes.

**Tech Stack:** No new dependencies. No new infra.

---

## Spec Reference

Source spec: `docs/superpowers/specs/2026-04-27-visual-flow-orchestration-design.md`. Implements **Section 12 → "Phase 7 — Cutover & legacy retirement"** with one user-directed deviation: skip the deprecation cycle, remove now. Also closes the Phase 6 trade-off about pause/resume/retry being structurally cast in route handlers.

Out of scope (deliberate, all marked inline):
- Per-user *encrypted* credential vault (depends on the broader auth sub-project — user mentioned earlier: "user login + per-user credential storage"; that's its own brainstorm)
- Docker / k8s `IWorkspaceProvider` implementations (the interface and the directory-per-run impl are sufficient for v0)
- Parent-flow name in `RunDetailPage` (cosmetic; would need a small API join — flagged as polish)
- Marketplace MCP catalog (out of v0 scope altogether)

## What's Removed

| Path | Why |
|---|---|
| `packages/pipeline/` | Legacy phase-based pipeline engine. Replaced by `@journeyman/orchestrator` + Conductor. |
| `packages/pipeline-server/` | Legacy HTTP+webhook server. Replaced by `@journeyman/api-server`. |
| `packages/ui/` | Legacy runs viewer wired to `pipeline-server`. Replaced by `@journeyman/web` + `@journeyman/flow-editor` + `@journeyman/run-viewer` + `@journeyman/runs-list`. |
| `start`, `validate`, `run-once`, `sweep`, `generate:schemas` scripts in root `package.json` | All call into the deleted packages. |
| `@journeyman/pipeline` dependency entries (if any) in other packages | Resolved imports must come from new packages or `@journeyman/core` only. |

## What's Added

| Path | Purpose |
|---|---|
| `packages/core/src/interfaces/orchestrator-capabilities.interface.ts` | NEW — `IPauseableEngine`, `IRetryableEngine` capability interfaces. |
| `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts` | Now declares `implements IOrchestratorEngine, IPauseableEngine, IRetryableEngine`. |
| `packages/api-server/src/routes/runs.ts` | Replace inline structural casts with the new capability interfaces. |
| `packages/orchestrator/src/workspace/directory-workspace-provider.ts` | Tightened: accepts an optional `userId` so future Docker/k8s drivers can scope per-user. |

## File Structure (after Phase 7)

```
packages/
├── core/                      (unchanged + 1 new interface file)
├── coding-cli/                (unchanged)
├── git-provider/              (unchanged)
├── github-api/                (unchanged)
├── ticket-provider/           (unchanged)
├── notification-provider/     (unchanged)
├── migrations/                (unchanged)
├── orchestrator/              (extended: capability interfaces declared)
├── api-server/                (extended: structural casts removed)
├── flow-editor/               (unchanged)
├── run-viewer/                (unchanged)
├── runs-list/                 (unchanged)
└── web/                       (unchanged)

[REMOVED]
├── packages/pipeline/
├── packages/pipeline-server/
└── packages/ui/
```

---

## Task 1: Audit references to the three legacy packages

This is a discovery step — every match informs Tasks 2 onward.

**Files:** none modified.

- [ ] **Step 1.1: grep for legacy package imports across the repo**

```bash
# From the repo root:
grep -rn --include='*.ts' --include='*.tsx' --include='*.json' --include='*.yaml' --include='*.yml' \
  -E '@journeyman/(pipeline|pipeline-server|ui)\b' . \
  --exclude-dir=node_modules --exclude-dir=.superpowers
```

Expected current matches (as of writing):
- `packages/orchestrator/package.json` — has `"@journeyman/pipeline": "*"` in `dependencies` (added in Phase 1's plan, but never imported in current code; the analyze handler uses `@journeyman/coding-cli` not `pipeline`).
- `packages/pipeline-server/package.json` — internal to itself; will be deleted wholesale.
- `packages/pipeline/package.json` — internal to itself; will be deleted wholesale.
- Possibly stray imports inside legacy packages — irrelevant since those packages are about to be deleted.
- `package.json` (root) — `start`, `validate`, `run-once`, `sweep`, `generate:schemas` scripts.

- [ ] **Step 1.2: grep for `tsx packages/pipeline*` script references**

```bash
grep -rn --include='*.json' --include='*.md' --include='*.yaml' \
  -E 'packages/(pipeline|pipeline-server|ui)/' . \
  --exclude-dir=node_modules --exclude-dir=.superpowers
```

Expected: root `package.json` scripts and `infra/README.md` is fine (it doesn't reference legacy paths). Spec/plan docs reference the legacy packages historically — those stay (they're history, not live config).

- [ ] **Step 1.3: list things to fix from grep output**

Capture the list to a scratch buffer; the next tasks remove each. Anything inside the three soon-to-be-deleted directories can be ignored.

---

## Task 2: Remove the `@journeyman/pipeline` dependency entry from `@journeyman/orchestrator`

**Files:**
- Modify: `packages/orchestrator/package.json`

The Phase 1 plan added `"@journeyman/pipeline": "*"` to orchestrator's dependencies as a forward-looking placeholder. The actual phase-handler implementation that landed in Phase 1 (`AnalyzePhaseHandler`) imports `ICodingCLI` from `@journeyman/core` and constructs over `@journeyman/coding-cli`'s `ClaudeProvider` — never `@journeyman/pipeline`. So this entry is dead.

- [ ] **Step 2.1: remove the line**

In `packages/orchestrator/package.json`, locate the `"dependencies"` block and delete the line:

```json
"@journeyman/pipeline": "*",
```

Keep `@journeyman/core`, `@journeyman/coding-cli`, `json-logic-js`, and `pg`.

---

## Task 3: Remove legacy scripts from root `package.json`

**Files:**
- Modify: root `package.json`

- [ ] **Step 3.1: delete the legacy lines from `"scripts"`**

Remove these five lines (verbatim) from the `"scripts"` block:

```json
"start": "tsx packages/pipeline-server/src/cli-start.ts config/pipeline.yaml",
"validate": "tsx packages/pipeline/src/cli.ts validate-config --config config/pipeline.yaml",
"run-once": "tsx packages/pipeline/src/cli.ts run",
"sweep": "tsx packages/pipeline/src/cli.ts sweep --config config/pipeline.yaml",
"generate:schemas": "npm run generate:schemas -w packages/pipeline",
```

Keep all the others (`typecheck`, `test`, `infra:up`, `infra:down`, `infra:reset`, `migrate`, `start:api-server`, `start:worker`, `dev:web`, `build:web`).

---

## Task 4: Delete the three legacy package directories

**Files:**
- Delete (recursive): `packages/pipeline/`
- Delete (recursive): `packages/pipeline-server/`
- Delete (recursive): `packages/ui/`

- [ ] **Step 4.1: remove all three directories**

```bash
rm -rf packages/pipeline packages/pipeline-server packages/ui
```

(npm workspaces auto-discover via the root `"workspaces": ["packages/*"]` glob. Removing the directories is sufficient — no manual workspace-list edits needed.)

- [ ] **Step 4.2: clear the lockfile + reinstall**

```bash
rm -f package-lock.json
npm install
```

A fresh install regenerates `package-lock.json` without the deleted packages and their internal lockfile entries. (You can also `npm install` without removing the lockfile; npm will prune the deleted workspaces, but a clean regeneration is tidier for a release-cutting commit.)

---

## Task 5: Engine capability interfaces in `@journeyman/core`

This closes the Phase 6 trade-off where api-server's run routes used inline structural casts (`as { pause?: ... }`) to call ConductorOrchestrator-only methods.

**Files:**
- Create: `packages/core/src/interfaces/orchestrator-capabilities.interface.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 5.1: write the new interface file**

```typescript
// packages/core/src/interfaces/orchestrator-capabilities.interface.ts

/**
 * Optional capability interfaces that engines may implement on top of
 * IOrchestratorEngine. The api-server uses `instanceof`-style narrowing:
 *
 *   if (isPauseableEngine(c.orchestrator)) await c.orchestrator.pause(runId);
 *   else reply.code(501);
 */

import type { IOrchestratorEngine } from "./orchestrator-engine.interface.ts";

export interface IPauseableEngine extends IOrchestratorEngine {
  pause(runId: string): Promise<void>;
  resume(runId: string): Promise<void>;
}

export interface IRetryableEngine extends IOrchestratorEngine {
  /** Resume a failed/terminated run from a specific node, or from its last
   *  failed task when nodeId is undefined. */
  retryFromTask(runId: string, nodeId: string | undefined): Promise<void>;
}

export function isPauseableEngine(e: IOrchestratorEngine): e is IPauseableEngine {
  return typeof (e as Partial<IPauseableEngine>).pause === "function"
      && typeof (e as Partial<IPauseableEngine>).resume === "function";
}

export function isRetryableEngine(e: IOrchestratorEngine): e is IRetryableEngine {
  return typeof (e as Partial<IRetryableEngine>).retryFromTask === "function";
}
```

- [ ] **Step 5.2: re-export from `core/src/index.ts`**

In the `=== Phase 1 adapter surface ===` block, add (alongside `IOrchestratorEngine`):

```typescript
export type { IPauseableEngine, IRetryableEngine } from "./interfaces/orchestrator-capabilities.interface.ts";
export { isPauseableEngine, isRetryableEngine } from "./interfaces/orchestrator-capabilities.interface.ts";
```

---

## Task 6: ConductorOrchestrator declares the capability interfaces

**Files:**
- Modify: `packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts`

- [ ] **Step 6.1: update the class declaration**

Change the `class ConductorOrchestrator implements IOrchestratorEngine` line to:

```typescript
import type {
  IOrchestratorEngine, IPauseableEngine, IRetryableEngine,
  IRunStore, Run, RunStatus, SubmitRunArgs,
} from "@journeyman/core";

// …

export class ConductorOrchestrator implements IOrchestratorEngine, IPauseableEngine, IRetryableEngine {
```

(The methods themselves were added in Phase 6; this only changes the declaration so the type system enforces the contract.)

---

## Task 7: api-server uses the type guards instead of structural casts

**Files:**
- Modify: `packages/api-server/src/routes/runs.ts`

- [ ] **Step 7.1: replace the three handlers**

Add the import:

```typescript
import { isPauseableEngine, isRetryableEngine } from "@journeyman/core";
```

Then change the three handlers (`/pause`, `/resume`, `/retry-step`):

```typescript
app.post("/runs/:id/pause", async (req, reply) => {
  const { id } = req.params as { id: string };
  if (!isPauseableEngine(c.orchestrator)) {
    reply.code(501); return { error: "pause_not_supported_by_engine" };
  }
  await c.orchestrator.pause(id);
  return { ok: true };
});

app.post("/runs/:id/resume", async (req, reply) => {
  const { id } = req.params as { id: string };
  if (!isPauseableEngine(c.orchestrator)) {
    reply.code(501); return { error: "resume_not_supported_by_engine" };
  }
  await c.orchestrator.resume(id);
  return { ok: true };
});

app.post("/runs/:id/retry-step", async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body ?? {}) as { node_id?: string };
  if (!isRetryableEngine(c.orchestrator)) {
    reply.code(501); return { error: "retry_not_supported_by_engine" };
  }
  await c.orchestrator.retryFromTask(id, body.node_id);
  return { ok: true };
});
```

(Remove the `as { pause?: ... }` casts. They're no longer needed.)

---

## Task 8: Tighten `IWorkspaceProvider` with optional `userId`

The spec calls Phase 7 the home for the per-user workspace abstraction. The interface already exists; the implementation is `DirectoryWorkspaceProvider` and is per-run. Add an optional `userId` to the `create` call so future Docker/k8s implementations can scope properly (and the directory impl can use it as a sub-path).

**Files:**
- Modify: `packages/core/src/interfaces/workspace-provider.interface.ts`
- Modify: `packages/orchestrator/src/workspace/directory-workspace-provider.ts`
- Modify: `packages/orchestrator/src/workers/worker-harness.ts`

- [ ] **Step 8.1: extend the interface**

Replace the file with:

```typescript
export interface IWorkspace {
  /** Absolute path on whatever filesystem the worker can read/write. */
  readonly path: string;
  destroy(): Promise<void>;
}

export interface IWorkspaceProvider {
  create(opts: {
    runId: string;
    nodeId: string;
    /** Optional: lets the provider scope per-user (Docker user-id, k8s namespace, etc.). */
    userId?: string | null;
  }): Promise<IWorkspace>;
}
```

- [ ] **Step 8.2: update the directory impl**

Replace `DirectoryWorkspaceProvider.create` to use `userId` as a sub-path when present:

```typescript
async create(opts: { runId: string; nodeId: string; userId?: string | null }): Promise<IWorkspace> {
  const base = this.cfg.baseDir ?? join(tmpdir(), "journeyman-workspaces");
  const userSeg = opts.userId ?? "anonymous";
  const path = join(base, userSeg, opts.runId, opts.nodeId);
  await mkdir(path, { recursive: true });
  return {
    path,
    destroy: async () => { await rm(path, { recursive: true, force: true }); },
  };
}
```

- [ ] **Step 8.3: pass `userId` from the worker**

In `worker-harness.ts`, find the line:

```typescript
const ws = await this.deps.workspace.create({ runId, nodeId });
```

and change it to:

```typescript
const userId = ((task.inputData ?? {}) as { startedByUserId?: string | null }).startedByUserId ?? null;
const ws = await this.deps.workspace.create({ runId, nodeId, userId });
```

(The converter doesn't currently inject `startedByUserId` into `inputData` — that's a Phase 8 thread to pull when the auth sub-project lands. For now `userId` falls through as `null`, which the directory provider treats as `"anonymous"`. The shape change is forward-compatible.)

---

## Task 9: Repo-wide grep for stale references

**Files:** none modified.

A second pass after the deletions and the script edits, to catch anything missed.

- [ ] **Step 9.1: grep again**

```bash
grep -rn --include='*.ts' --include='*.tsx' --include='*.json' --include='*.yaml' --include='*.yml' \
  -E '@journeyman/(pipeline|pipeline-server|ui)\b' . \
  --exclude-dir=node_modules --exclude-dir=.superpowers --exclude-dir=docs
```

Expected: zero matches outside `docs/` (the historical specs/plans still reference the names; that's fine).

- [ ] **Step 9.2: grep for stale paths**

```bash
grep -rn --include='*.ts' --include='*.tsx' --include='*.json' --include='*.yaml' --include='*.yml' \
  -E 'packages/(pipeline|pipeline-server|ui)/' . \
  --exclude-dir=node_modules --exclude-dir=.superpowers --exclude-dir=docs
```

Expected: zero matches.

If either grep returns hits inside live code or config, fix them before moving on.

---

## Task 10: install + repo-wide typecheck + manual smoke

- [ ] **Step 10.1: clean install**

```bash
rm -f package-lock.json
npm install
```

Expected: 13 workspace packages registered (was 16).

- [ ] **Step 10.2: typecheck**

```bash
npm run typecheck
```

Expected: green across all 13 workspaces (`core`, `coding-cli`, `git-provider`, `github-api`, `ticket-provider`, `notification-provider`, `migrations`, `orchestrator`, `api-server`, `flow-editor`, `run-viewer`, `runs-list`, `web`).

- [ ] **Step 10.3: manual smoke**

1. `npm run infra:up && npm run migrate`
2. `npm run start:api-server &` — server still starts; legacy paths gone.
3. `npm run start:worker &` — worker still polls Conductor.
4. `npm run dev:web` — open `http://localhost:5173`. Build/run a flow end-to-end. Pause, retry-from-failed, fork & edit, export — all work.
5. **Negative check:** verify the legacy scripts now error with "missing script":
   ```bash
   npm run start          # should fail "Missing script: \"start\""
   npm run validate       # should fail "Missing script: \"validate\""
   npm run run-once       # should fail
   npm run sweep          # should fail
   npm run generate:schemas   # should fail
   ```
6. **Negative check:** verify the legacy directories are gone:
   ```bash
   ls packages/  # should NOT contain pipeline / pipeline-server / ui
   ```

---

## Self-Review Checklist

**Spec coverage (Phase 7 from §12):**
- [x] Per-user workspace abstraction (interface tightened to accept `userId`; directory impl uses it as a sub-path) — Task 8
- [x] Mark legacy `pipeline` and `pipeline-server` as deprecated → **user-directed deviation**: removed instead of deprecated — Tasks 4
- [x] Remove the legacy packages — Task 4
- [x] Remove references in code/config — Tasks 2, 3, 9

**Spec items deferred (now closing remaining gaps as separate, smaller pieces of work, not Phase 7):**
- Real per-user **encrypted** credential vault — depends on the auth sub-project (separate brainstorm)
- Docker / k8s `IWorkspaceProvider` impls — interface ready (Task 8); concrete impls when needed
- `RunDetailPage` parent-flow name — small API join, cosmetic
- Feature-parity audit vs. legacy — moot now that legacy is gone

**Phase 6 trade-offs closed by this phase:**
- Pause/Resume/Retry now type-checked via `IPauseableEngine` / `IRetryableEngine` capability interfaces and `isPauseableEngine` / `isRetryableEngine` type guards — no more inline structural casts in api-server route handlers.

**Type consistency:**
- `IPauseableEngine` and `IRetryableEngine` extend `IOrchestratorEngine` — so anywhere an `IOrchestratorEngine` is expected, a `ConductorOrchestrator` (which implements all three) still works.
- `IWorkspaceProvider.create` now takes an optional `userId`. Existing callers that omit it continue to compile (optional field). The directory impl handles `undefined`/`null` by bucketing under `"anonymous"`.

**Deletion safety:**
- Lockfile regeneration ensures npm doesn't try to resolve stale workspace symlinks.
- The grep checks in Task 1 and Task 9 bracket the deletion: the first finds what to update, the second confirms nothing was missed.
- All Phase 1–6 features keep working because no live code imports from the legacy packages — they were already standalone.
