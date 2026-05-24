# @journeyman/orchestrator

Worker process + Conductor wiring + flow-graph-to-Conductor-JSON converter.

This package contains two things:

1. **The worker** — a long-running process that polls Conductor for queued tasks and executes the matching step handler. Started via `npm run start:worker` from the repo root.
2. **The orchestrator engine** — the `ConductorOrchestrator` class consumed by `@journeyman/api-server` to submit / cancel / retry runs against Conductor. Not a standalone process.

This README covers the worker. For the orchestrator engine + JSON converter, see the source under `src/engines/` and `src/flow-json/`.

---

## Why the worker exists

```
You ──HTTP──▶ api-server ──Conductor REST──▶ Conductor ──poll──▶ worker ──executes──▶ step handler
                                                  ▲                  │
                                                  └─ status update ──┘
```

- **api-server** receives editor traffic. When you click ▶ Run, it tells Conductor to start a workflow. It **does not** execute phases.
- **Conductor** queues tasks per step type and waits for a worker to claim them.
- **The worker** polls Conductor for tasks of registered step types, executes the corresponding handler, and reports the result back.

If the worker isn't running, runs will start in Conductor and stay queued forever — there's nobody to do the actual work. Editor save/validate/load all keep working without the worker; only run execution stops.

---

## Running the worker

From the repo root:

```bash
npm run start:worker
```

Equivalent to `tsx packages/orchestrator/src/cli-worker.ts`. Reads `.env` from the current working directory (don't forget `CONDUCTOR_BASE_URL`, `ANTHROPIC_API_KEY`, etc.).

### Required infra

The worker needs Conductor reachable at the configured URL. Bring up the local stack first:

```bash
npm run infra:up   # starts Postgres + Conductor + Redis via docker-compose
```

### Required env vars

| Var | Purpose | Default |
|---|---|---|
| `CONDUCTOR_BASE_URL` | Conductor API root | `http://localhost:8080/api` |
| `WORKER_ID` | Worker identifier sent to Conductor (visible in its UI) | `worker-<pid>` |
| `ANTHROPIC_API_KEY` | Required by `ClaudeProvider` for `analyze` / `plan` / `implement` steps | — |
| Per-product secrets (e.g. `SAM_PORTFOLIO_GITHUB_ACCESS_TOKEN`) | Resolved by `EnvCredentialStore` when a step declares `requiredSecrets` | — |

The worker poll interval is 500 ms; tune in [cli-worker.ts](src/cli-worker.ts) if needed.

---

## What the cli-worker.ts file does

55 lines, four jobs:

```ts
// 1. Load .env (idempotent — no-op if api-server already loaded one)
loadDotenv({ path: ".env", override: false });

// 2. Connect to Conductor
const client = new ConductorClient({ baseUrl: process.env.CONDUCTOR_BASE_URL });

// 3. Build a registry of step handlers we know how to execute
const registry = new InMemoryStepRegistry();
registry.register(new AnalyzeStepHandler({ coding: new ClaudeProvider() }));
// ↑ register more handlers here to expand worker coverage

// 4. Start the harness — polls Conductor for tasks of those step types
const harness = new WorkerHarness({ client, registry, /* … */ });
await harness.start(registry.list().map(h => h.stepType));
```

The harness handles: task polling, input resolution (Conductor `${...}` refs are already resolved by Conductor before the worker sees them), running the handler with a `StepContext`, retry/timeout per Conductor's task config, and reporting the result.

---

## Adding a new step to the worker

The editor and the worker register steps independently. Editor-side definitions live in `@journeyman/steps` (`packages/steps/src/<category>/<name>.tsx` + `.meta.ts`). Worker-side handlers live here:

```
packages/orchestrator/src/workers/steps/
└── analyze-step-handler.ts        ← currently the only one
```

To add `checkout-repo` execution support:

1. **Write the handler.** Create `src/workers/steps/checkout-repo-step-handler.ts`:

   ```ts
   import type { IStepHandler, StepContext, StepInput, StepOutput, StepFailure } from "@journeyman/core";
   import type { ICodingCLI } from "@journeyman/core";

   export class CheckoutRepoStepHandler implements IStepHandler {
     readonly stepType = "checkout-repo";
     constructor(private deps: { coding: ICodingCLI }) {}

     async run(input: StepInput, ctx: StepContext): Promise<{ kind: "success"; output: StepOutput } | { kind: "failure"; failure: StepFailure }> {
       try {
         const result = await this.deps.coding.checkoutRepo({
           repos: input.url ? [{ dirPath: `${input.workspaceDir}/${repoName(input.url as string)}`, branch: (input.branch as string) ?? "main" }] : [],
           branch: (input.branch as string) ?? "main",
         });
         return { kind: "success", output: { branch: result.newBranch, dirPath: result.repos[0]?.dirPath, commitSha: "" /* fill in */ } };
       } catch (e) {
         return { kind: "failure", failure: { errorClass: "CheckoutFailed", message: (e as Error).message, retryable: true } };
       }
     }
   }
   ```

2. **Register it in [cli-worker.ts](src/cli-worker.ts)**:

   ```ts
   registry.register(new CheckoutRepoStepHandler({ coding: new ClaudeProvider() }));
   ```

3. **Restart the worker.** Conductor task definitions are registered idempotently on startup, so just `Ctrl+C` and `npm run start:worker` again.

That's the whole loop. Editor metadata (label, color, configFields, outputSchema) is independent of this — it's already declared in `@journeyman/steps` and consumed by the editor + api-server.

---

## Current handler coverage

| Step type | Editor definition | Worker handler |
|---|---|---|
| `analyze` | ✅ | ✅ |
| `plan` | ✅ | ❌ |
| `implement` | ✅ | ❌ |
| `checkout-repo` | ✅ | ❌ |
| `scan-repos` | ✅ | ❌ |
| `cleanup-repos` | ✅ | ❌ |
| `commit-push` | ✅ | ❌ |
| `create-workspace` | ✅ | ❌ |
| `get-ticket` / `create-ticket` / `update-ticket` / `update-status` / `add-ticket-comment` | ✅ | ❌ |
| `clone-repos` / `get-repo` / `create-pr` / `list-prs` / `add-pr-comment` / `fetch-pr-comments` | ✅ | ❌ |
| `notify` | ✅ | ❌ |

A flow that uses any step without a worker handler will queue tasks that never get picked up. Conductor will eventually time them out per the per-task `timeoutSeconds` (default 600 s).

---

## Operational notes

- **Multiple workers** are safe — Conductor distributes tasks across all polling workers. Just give each a distinct `WORKER_ID`.
- **Crash recovery** — a worker that dies mid-task: Conductor reassigns the task after `responseTimeoutSeconds` elapses. Idempotency is your handler's responsibility.
- **Hot reload** — the worker has no `--watch` mode. Editing a handler requires a manual restart.
- **Logs** — uses `pino`. Set `LOG_LEVEL=debug` for verbose output.

---

## Related docs

- [Visual flow orchestration design](../../docs/superpowers/specs/2026-04-27-visual-flow-orchestration-design.md) — the canvas → Conductor architecture this worker fits into.
- [`@journeyman/api-server`](../api-server) — the HTTP gateway that submits runs to Conductor.
- [`@journeyman/steps`](../phases) — step definitions consumed by the editor (and `stepCatalog` consumed by the api-server).
