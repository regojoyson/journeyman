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
| `WORKER_POLL_INTERVAL_MS` | Interval (ms) each step-type loop waits between Conductor polls | `2000` |
| `ANTHROPIC_API_KEY` | Required by `ClaudeProvider` for `custom-ai` steps (omit if `claude login` is used in local dev) | — |
| Per-product secrets (e.g. `SAM_PORTFOLIO_GITHUB_ACCESS_TOKEN`) | Resolved by `EnvCredentialStore` when a step declares `requiredSecrets` | — |

The worker poll interval defaults to 2000 ms; override per environment with `WORKER_POLL_INTERVAL_MS` (lower = faster step pickup but more requests/logs).

---

## What the cli-worker.ts file does

The standalone worker process. Its jobs:

```ts
// 1. Load .env (idempotent) and connect to Postgres + Conductor
loadDotenv({ path: ".env", override: false });
const client = new ConductorClient({ baseUrl: process.env.CONDUCTOR_BASE_URL });

// 2. Build provider factories (ProviderFactory<T>) keyed by provider id
const coding: ProviderFactory<ICodingCLI> = (key, env) => createCodingProvider(key, { env });
const git: ProviderFactory<IGitProvider> = (key, env) => /* GitHubProvider … */;
const issue: ProviderFactory<IIssueProvider> = (key, env) => /* Jira / GitHubIssues / GitHubProjects … */;
const notification: ProviderFactory<INotificationProvider> = (key) => /* ConsoleProvider … */;

// 3. Register a handler per step type into the registry
const registry = new InMemoryStepRegistry();
registry.register(new CustomAiStepHandler({ coding, pool, bindingResolver }));
registry.register(new CloneReposStepHandler({ git }));
registry.register(new GetIssueStepHandler({ issue }));
// … ~15 handlers total (see the file)

// 4. Start the harness — polls Conductor for tasks of those step types
const harness = new WorkerHarness({ client, registry, events, mcpResolver, skillsResolver, modelResolver, ensureWorkspace /* … */ });
await harness.start(registry.list().map(h => h.stepType));
```

Handlers take **provider factories**, not concrete providers — the harness picks the provider per step via `executorConfig.provider` and resolves secrets/MCPs/skills/model before calling `run()`. The worker also owns **workspace provisioning** (`ensureWorkspace`, local + Docker via `@journeyman/sandbox`) and an ahead-of-time managed-image **build loop**.

The harness handles: task polling, input resolution (Conductor `${...}` refs are already resolved before the worker sees them), provider/secret/MCP/skill resolution, running the handler with a `StepContext`, retry/timeout per Conductor's task config, and reporting the result.

---

## Adding a new step to the worker

The editor and the worker register steps independently. Editor-side definitions live in `@journeyman/steps` (`packages/steps/src/<category>/<name>.tsx` + `.meta.ts`). Worker-side handlers live here:

```
packages/orchestrator/src/workers/steps/
├── custom-ai-step-handler.ts          ← AI step (runCustomPrompt)
├── clone-repos-step-handler.ts
├── start-feature-branch-step-handler.ts
├── get-issue / create-issue / comment-on-issue / transition-issue / update-issue-fields-step-handler.ts
├── get-repository / open-pull-request / list-pull-requests / list-pull-request-comments-step-handler.ts
├── list-workspace-files-step-handler.ts
├── send-message-step-handler.ts
└── join-finalize-step-handler.ts
```

To add a new step's execution support:

1. **Write the handler.** Create `src/workers/steps/<name>-step-handler.ts` implementing `IStepHandler`. Take a **provider factory** (`ProviderFactory<T>`) as a dep rather than a concrete provider, so the harness can select the provider per step:

   ```ts
   import type { IStepHandler, StepContext, StepInput, StepRunResult, ProviderFactory, IGitProvider } from "@journeyman/core";

   export class GetRepositoryStepHandler implements IStepHandler {
     readonly stepType = "get-repository";
     constructor(private deps: { git: ProviderFactory<IGitProvider> }) {}

     async run(input: StepInput, ctx: StepContext): Promise<StepRunResult> {
       const git = this.deps.git(input.provider as string | undefined, ctx.env);
       // … call git.getRepo(...) and return { kind: "success", output } / { kind: "failure", failure }
     }
   }
   ```

2. **Register it in [cli-worker.ts](src/cli-worker.ts)**: `registry.register(new GetRepositoryStepHandler({ git }));`

3. **Restart the worker.** Conductor task definitions are registered idempotently on startup, so just `Ctrl+C` and `npm run start:worker` again.

Editor metadata (label, category, configSchema, outputSchema) is independent — it's declared in `@journeyman/steps` and consumed by the editor + api-server.

---

## Current handler coverage

Registered worker handlers (matching the `@journeyman/steps` catalog):

| Step type | Worker handler |
|---|---|
| `custom-ai` | ✅ |
| `clone-repos`, `start-feature-branch`, `list-workspace-files` | ✅ |
| `get-issue`, `create-issue`, `comment-on-issue`, `transition-issue`, `update-issue-fields` | ✅ |
| `get-repository`, `open-pull-request`, `list-pull-requests`, `list-pull-request-comments` | ✅ |
| `send-message` | ✅ |
| `join-finalize` (internal fork/join) | ✅ |
| `comment-on-pull-request` | ❌ (catalog only — no worker handler yet) |

A flow that uses a step without a worker handler will queue tasks that never get picked up. Conductor will eventually time them out per the per-task `timeoutSeconds` (default 600 s).

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
- [`@journeyman/steps`](../steps) — step definitions consumed by the editor (and `stepCatalog` consumed by the api-server).
