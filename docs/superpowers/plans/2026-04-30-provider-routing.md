# Provider Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the per-node `provider` selection in the flow editor actually route to the right provider implementation at run time, across all four executor kinds.

**Architecture:** Introduce a `ProviderResolver<T>` interface in `@journeyman/core` and a `MapProviderResolver<T>` implementation in `@journeyman/orchestrator`. Refactor every phase handler to take a resolver instead of a single provider instance and call `resolver.resolve(input.provider)` on each run. Wire one resolver per executor kind in `cli-worker.ts`. Add a `PROVIDER_CATALOG` in `@journeyman/core` so the flow editor dropdown and the worker's resolver registrations are derived from one list.

**Tech Stack:** TypeScript, npm workspaces, no new runtime dependencies. Spec: [docs/superpowers/specs/2026-04-30-provider-routing-design.md](../specs/2026-04-30-provider-routing-design.md).

**Constraints from the user:**
- **No commits.** Leave changes uncommitted.
- **No unit tests.** Skip test files; verify by typecheck only.
- **Typecheck at the very end**, once all stages are done.
- **Use parallel tool calls** wherever steps are independent, to minimize tokens.

---

## File Structure

**New files:**
- `packages/core/src/interfaces/provider-resolver.interface.ts` — `ProviderResolver<T>` interface.
- `packages/core/src/registries/provider-catalog.ts` — `PROVIDER_CATALOG` array + `ProviderEntry` type.
- `packages/orchestrator/src/registry/map-provider-resolver.ts` — `MapProviderResolver<T>` implementation + `ProviderNotImplementedError`.

**Modified files:**
- `packages/core/src/index.ts` — export new interface, catalog, and types.
- All ticket phase handlers (5): `get-ticket`, `update-status`, `create-ticket`, `update-ticket`, `add-ticket-comment`.
- All coding-cli phase handlers (8): `analyze`, `plan`, `implement`, `create-workspace`, `checkout-repo`, `scan-repos`, `commit-push`, `cleanup-repos`.
- All git-provider phase handlers (5): `clone-repos`, `get-repo`, `create-pr`, `list-prs`, `fetch-pr-comments`.
- Notification phase handler (1): `notify`.
- `packages/orchestrator/src/cli-worker.ts` — build resolvers, pass them to handlers, assert against catalog at startup.
- `packages/orchestrator/src/index.ts` — export `MapProviderResolver`.
- `packages/flow-editor/src/executor-common-config.ts` — derive provider lists from `PROVIDER_CATALOG`, filter by `implemented`.

**No changes:** flow-json converter / `resolve-inputs.ts`. Inspection confirmed `PhaseInput` is `Record<string, unknown>`, so `provider` flows through automatically as a generic key — no contract change needed.

---

## Stage 1 — Ticket-provider vertical slice

### Task 1: Add `ProviderResolver<T>` interface to `@journeyman/core`

**Files:**
- Create: `packages/core/src/interfaces/provider-resolver.interface.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create the interface file**

```ts
// packages/core/src/interfaces/provider-resolver.interface.ts

/**
 * Resolves a provider instance from a string key (the value chosen in the
 * flow editor's provider dropdown, threaded through PhaseInput.provider).
 *
 * Used to route a phase to the right concrete provider at run time without
 * the handler needing to know which providers exist.
 */
export interface ProviderResolver<T> {
  /**
   * Returns the provider registered under `key`. If `key` is undefined,
   * returns the resolver's default. Throws if `key` is unknown.
   */
  resolve(key: string | undefined): T;

  /** All keys this resolver knows about (for diagnostics / startup checks). */
  keys(): string[];
}
```

- [ ] **Step 2: Re-export from core index**

In `packages/core/src/index.ts`, add this export near the other interface re-exports (after the `IFlowJsonConverter` line around line 63):

```ts
export type { ProviderResolver } from "./interfaces/provider-resolver.interface.ts";
```

---

### Task 2: Implement `MapProviderResolver<T>` in `@journeyman/orchestrator`

**Files:**
- Create: `packages/orchestrator/src/registry/map-provider-resolver.ts`
- Modify: `packages/orchestrator/src/index.ts`

- [ ] **Step 1: Create the resolver file**

```ts
// packages/orchestrator/src/registry/map-provider-resolver.ts
import type { ProviderResolver } from "@journeyman/core";

export class ProviderNotImplementedError extends Error {
  constructor(kind: string, key: string, known: string[]) {
    super(
      `No ${kind} provider registered for key "${key}". ` +
      `Known keys: [${known.join(", ")}].`,
    );
    this.name = "ProviderNotImplementedError";
  }
}

export interface MapProviderResolverOptions<T> {
  /** Display name of the executor kind, used in error messages. */
  kind: string;
  /** Key used when the phase input does not specify a provider. */
  defaultKey: string;
  /** Map from provider key (dropdown `value`) to instance. */
  providers: Record<string, T>;
}

export class MapProviderResolver<T> implements ProviderResolver<T> {
  private readonly map: Map<string, T>;
  private readonly defaultKey: string;
  private readonly kind: string;

  constructor(opts: MapProviderResolverOptions<T>) {
    this.map = new Map(Object.entries(opts.providers));
    this.defaultKey = opts.defaultKey;
    this.kind = opts.kind;
    if (!this.map.has(this.defaultKey)) {
      throw new Error(
        `MapProviderResolver(${opts.kind}): defaultKey "${opts.defaultKey}" is not registered.`,
      );
    }
  }

  resolve(key: string | undefined): T {
    const k = key ?? this.defaultKey;
    const found = this.map.get(k);
    if (!found) throw new ProviderNotImplementedError(this.kind, k, this.keys());
    return found;
  }

  keys(): string[] {
    return [...this.map.keys()];
  }
}
```

- [ ] **Step 2: Export from orchestrator index**

In `packages/orchestrator/src/index.ts`, add after the `InMemoryPhaseRegistry` export (line 35):

```ts
export { MapProviderResolver, ProviderNotImplementedError } from "./registry/map-provider-resolver.ts";
```

---

### Task 3: Refactor the 5 ticket phase handlers to take a resolver

**Files:**
- Modify: `packages/orchestrator/src/workers/phases/get-ticket-phase-handler.ts`
- Modify: `packages/orchestrator/src/workers/phases/update-status-phase-handler.ts`
- Modify: `packages/orchestrator/src/workers/phases/create-ticket-phase-handler.ts`
- Modify: `packages/orchestrator/src/workers/phases/update-ticket-phase-handler.ts`
- Modify: `packages/orchestrator/src/workers/phases/add-ticket-comment-phase-handler.ts`

> **Parallel:** these five edits are independent — issue all five `Edit` calls in one tool-use batch.

The change in every file is the same pattern:

1. Add `ProviderResolver` to the `@journeyman/core` import.
2. Change the constructor parameter type from `ITicketProvider` to `ProviderResolver<ITicketProvider>`.
3. Inside `run`, resolve before any `this.deps.ticket.X(...)` call:
   ```ts
   const ticket = this.deps.ticket.resolve(
     typeof input.provider === "string" ? input.provider : undefined,
   );
   ```
4. Replace each `this.deps.ticket.X(...)` with `ticket.X(...)`.

- [ ] **Step 1: Update `update-status-phase-handler.ts`**

Replace the import block and class body with:

```ts
import { createLogger } from "@journeyman/core";
import type {
  ITicketProvider, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult,
  ProviderResolver,
} from "@journeyman/core";

const log = createLogger("worker:update-status");

/**
 * Wraps ITicketProvider.updateStatus.
 *
 * Inputs:
 *   - ticketKey | id — issue identifier (string, required)
 *   - status         — new status (string, required)
 *   - provider       — optional provider key (e.g. "jira", "github-issues")
 */
export class UpdateStatusPhaseHandler implements IPhaseHandler {
  readonly phaseType = "update-status";

  constructor(private deps: { ticket: ProviderResolver<ITicketProvider> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const id = typeof input.id === "string" ? input.id
      : typeof input.ticketKey === "string" ? input.ticketKey : undefined;
    const status = typeof input.status === "string" ? input.status : undefined;
    if (!id || !status) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "update-status requires `ticketKey`/`id` and `status`",
          retryable: false,
        },
      };
    }
    const ticket = this.deps.ticket.resolve(
      typeof input.provider === "string" ? input.provider : undefined,
    );
    ctx.log(`Updating ticket ${id} → ${status}`);
    const result = await ticket.updateStatus({ id, status, sessionId: ctx.runId });
    if (result?.error) {
      log.error({ result }, "update-status failed");
      return {
        kind: "failure",
        failure: { errorClass: "UpdateStatusFailed", message: String(result.error), retryable: true },
      };
    }
    return {
      kind: "success",
      output: {
        id: result.ticket?.id ?? id,
        status: result.ticket?.status ?? status,
      },
    };
  }
}
```

- [ ] **Step 2: Update `get-ticket-phase-handler.ts`**

```ts
import { createLogger } from "@journeyman/core";
import type {
  ITicketProvider, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult,
  ProviderResolver,
} from "@journeyman/core";

const log = createLogger("worker:get-ticket");

export class GetTicketPhaseHandler implements IPhaseHandler {
  readonly phaseType = "get-ticket";

  constructor(private deps: { ticket: ProviderResolver<ITicketProvider> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const id = typeof input.id === "string" ? input.id
      : typeof input.ticketKey === "string" ? input.ticketKey : undefined;
    if (!id) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "get-ticket requires `ticketKey` or `id`",
          retryable: false,
        },
      };
    }
    const ticket = this.deps.ticket.resolve(
      typeof input.provider === "string" ? input.provider : undefined,
    );
    ctx.log(`Fetching ticket ${id}`);
    const result = await ticket.getTicket({ id, sessionId: ctx.runId });
    if (result?.error || !result?.ticket) {
      log.error({ result }, "get-ticket failed");
      return {
        kind: "failure",
        failure: { errorClass: "GetTicketFailed", message: String(result?.error ?? "no ticket returned"), retryable: true },
      };
    }
    const t = result.ticket;
    return {
      kind: "success",
      output: {
        id: t.id,
        title: t.title,
        description: t.description ?? "",
        status: t.status ?? "",
        labels: t.labels ?? [],
        url: t.url,
      },
    };
  }
}
```

- [ ] **Step 3: Update `create-ticket-phase-handler.ts`**

Apply the same three changes (import, constructor type, resolve-before-use). Read the existing file first, then in your one Edit call:

- Add `ProviderResolver` to the `@journeyman/core` type import.
- Change `constructor(private deps: { ticket: ITicketProvider })` to `constructor(private deps: { ticket: ProviderResolver<ITicketProvider> })`.
- Add immediately after the input-validation block (before the first `this.deps.ticket.*` call):
  ```ts
  const ticket = this.deps.ticket.resolve(
    typeof input.provider === "string" ? input.provider : undefined,
  );
  ```
- Replace every `this.deps.ticket.` with `ticket.` inside the `run` method.

- [ ] **Step 4: Update `update-ticket-phase-handler.ts`**

Apply the identical pattern from Step 3.

- [ ] **Step 5: Update `add-ticket-comment-phase-handler.ts`**

Apply the identical pattern from Step 3.

> **Implementation hint:** read all five files in one parallel batch, then issue all five `Edit` calls in a second parallel batch.

---

### Task 4: Wire ticket resolver in `cli-worker.ts`

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 1: Update imports**

Replace the line:
```ts
import { JiraProvider } from "@journeyman/ticket-provider";
```
with:
```ts
import { JiraProvider, GitHubIssuesProvider, GitHubProjectsProvider } from "@journeyman/ticket-provider";
import type { ITicketProvider } from "@journeyman/core";
import { MapProviderResolver } from "./registry/map-provider-resolver.ts";
```

- [ ] **Step 2: Replace ticket registration block**

Find the block:
```ts
// Ticket provider (Jira stubs throw at call time; registration is safe).
const ticket = new JiraProvider();
registry.register(new GetTicketPhaseHandler({ ticket }));
registry.register(new UpdateStatusPhaseHandler({ ticket }));
registry.register(new CreateTicketPhaseHandler({ ticket }));
registry.register(new UpdateTicketPhaseHandler({ ticket }));
registry.register(new AddTicketCommentPhaseHandler({ ticket }));
```

Replace with:
```ts
// Ticket providers — selected per-node via PhaseInput.provider, default "jira".
const ticket = new MapProviderResolver<ITicketProvider>({
  kind: "ticket-provider",
  defaultKey: "jira",
  providers: {
    "jira":            new JiraProvider(),
    "github-issues":   new GitHubIssuesProvider(),
    "github-projects": new GitHubProjectsProvider(),
  },
});
registry.register(new GetTicketPhaseHandler({ ticket }));
registry.register(new UpdateStatusPhaseHandler({ ticket }));
registry.register(new CreateTicketPhaseHandler({ ticket }));
registry.register(new UpdateTicketPhaseHandler({ ticket }));
registry.register(new AddTicketCommentPhaseHandler({ ticket }));
```

> **Note:** if `GitHubIssuesProvider` or `GitHubProjectsProvider` constructors require options (e.g. a token), check `packages/ticket-provider/src/providers/github-issues/index.ts` — both currently default to reading `GITHUB_ACCESS_TOKEN` from the environment when `opts` is omitted, so `new GitHubIssuesProvider()` is correct.

---

### Task 5: Add GitHub options to the ticket-provider dropdown

**Files:**
- Modify: `packages/flow-editor/src/executor-common-config.ts`

- [ ] **Step 1: Replace the `ticket-provider` block**

Replace:
```ts
"ticket-provider": {
  provider: [
    { value: "jira",   label: "Jira"   },
    { value: "linear", label: "Linear" },
    { value: "monday", label: "Monday" },
  ],
},
```

with:
```ts
"ticket-provider": {
  provider: [
    { value: "jira",            label: "Jira"            },
    { value: "github-issues",   label: "GitHub Issues"   },
    { value: "github-projects", label: "GitHub Projects" },
    { value: "linear",          label: "Linear"          },
    { value: "monday",          label: "Monday"          },
  ],
},
```

(Stage 3 will replace this whole file with a catalog-derived version. Keep this hardcoded entry until then to keep stages independently mergeable.)

---

## Stage 2 — Apply the resolver pattern to the other three executor kinds

### Task 6: Refactor coding-cli phase handlers (8 files)

**Files (all in `packages/orchestrator/src/workers/phases/`):**
- `analyze-phase-handler.ts`
- `plan-phase-handler.ts`
- `implement-phase-handler.ts`
- `create-workspace-phase-handler.ts`
- `checkout-repo-phase-handler.ts`
- `scan-repos-phase-handler.ts`
- `commit-push-phase-handler.ts`
- `cleanup-repos-phase-handler.ts`

> **Parallel:** read all eight in one batch, then edit all eight in one batch.

The transformation in every file is the same as Task 3, with three substitutions:
- Type `ITicketProvider` → `ICodingCLI`
- Property name `ticket` → `coding`
- Resolved local var `ticket` → `coding`

For each file:

- [ ] **Step 1: Update import**

Add `ProviderResolver` to the `@journeyman/core` type import.

- [ ] **Step 2: Update constructor signature**

Change `constructor(private deps: { coding: ICodingCLI })` → `constructor(private deps: { coding: ProviderResolver<ICodingCLI> })`.

- [ ] **Step 3: Resolve at the top of `run`**

After input validation, before the first `this.deps.coding.*` call, add:
```ts
const coding = this.deps.coding.resolve(
  typeof input.provider === "string" ? input.provider : undefined,
);
```

- [ ] **Step 4: Replace usages**

Replace every `this.deps.coding.` with `coding.` inside `run`.

---

### Task 7: Refactor git-provider phase handlers (5 files)

**Files (all in `packages/orchestrator/src/workers/phases/`):**
- `clone-repos-phase-handler.ts`
- `get-repo-phase-handler.ts`
- `create-pr-phase-handler.ts`
- `list-prs-phase-handler.ts`
- `fetch-pr-comments-phase-handler.ts`

> **Parallel:** read all five in one batch, edit all five in one batch.

Same transformation as Task 6, but:
- Type `IGitProvider`
- Property name `git`
- Local var `git`

- [ ] **Step 1: For each file, apply the four substeps from Task 6** (import, constructor, resolve, replace `this.deps.git.` with `git.`).

---

### Task 8: Refactor notify phase handler

**Files:**
- Modify: `packages/orchestrator/src/workers/phases/notify-phase-handler.ts`

- [ ] **Step 1: Apply the standard transformation**

Same pattern as Task 6, with:
- Type `INotificationProvider`
- Property name `notification`
- Local var `notification`

---

### Task 9: Wire all four resolvers in `cli-worker.ts`

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 1: Add type imports for the three other interfaces**

Extend the `@journeyman/core` import added in Task 4:
```ts
import type { ITicketProvider, ICodingCLI, IGitProvider, INotificationProvider } from "@journeyman/core";
```

- [ ] **Step 2: Replace coding-cli registration**

Find:
```ts
const coding = new ClaudeProvider();
registry.register(new AnalyzePhaseHandler({ coding }));
registry.register(new PlanPhaseHandler({ coding }));
registry.register(new ImplementPhaseHandler({ coding }));
registry.register(new CreateWorkspacePhaseHandler({ coding }));
registry.register(new CheckoutRepoPhaseHandler({ coding }));
registry.register(new ScanReposPhaseHandler({ coding }));
registry.register(new CommitPushPhaseHandler({ coding }));
registry.register(new CleanupReposPhaseHandler({ coding }));
```

Replace with:
```ts
const coding = new MapProviderResolver<ICodingCLI>({
  kind: "coding-cli",
  defaultKey: "claude",
  providers: { "claude": new ClaudeProvider() },
});
registry.register(new AnalyzePhaseHandler({ coding }));
registry.register(new PlanPhaseHandler({ coding }));
registry.register(new ImplementPhaseHandler({ coding }));
registry.register(new CreateWorkspacePhaseHandler({ coding }));
registry.register(new CheckoutRepoPhaseHandler({ coding }));
registry.register(new ScanReposPhaseHandler({ coding }));
registry.register(new CommitPushPhaseHandler({ coding }));
registry.register(new CleanupReposPhaseHandler({ coding }));
```

- [ ] **Step 3: Replace git-provider registration**

Find the `try { const git = new GitHubProvider(); ... } catch { ... }` block and replace with:
```ts
// Git provider — selected per-node via PhaseInput.provider, default "github".
try {
  const git = new MapProviderResolver<IGitProvider>({
    kind: "git-provider",
    defaultKey: "github",
    providers: { "github": new GitHubProvider() },
  });
  registry.register(new CloneReposPhaseHandler({ git }));
  registry.register(new GetRepoPhaseHandler({ git }));
  registry.register(new CreatePrPhaseHandler({ git }));
  registry.register(new ListPrsPhaseHandler({ git }));
  registry.register(new FetchPrCommentsPhaseHandler({ git }));
} catch (err) {
  log.warn({ err: (err as Error).message }, "skipping git-provider handlers — provider unavailable");
}
```

- [ ] **Step 4: Replace notification registration**

Find:
```ts
const notification = new ConsoleProvider();
registry.register(new NotifyPhaseHandler({ notification }));
```

Replace with:
```ts
const notification = new MapProviderResolver<INotificationProvider>({
  kind: "notification",
  defaultKey: "console",
  providers: { "console": new ConsoleProvider() },
});
registry.register(new NotifyPhaseHandler({ notification }));
```

---

### Task 10: Reconcile the editor dropdowns with what the worker actually registers

**Files:**
- Modify: `packages/flow-editor/src/executor-common-config.ts`

- [ ] **Step 1: Add `implemented` flag to `ProviderOption` and stage-2 entries**

Replace the file contents with:

```ts
// packages/flow-editor/src/executor-common-config.ts
import type { ExecutorKind } from "./phase-definition.ts";

export interface ProviderOption {
  value: string;
  label: string;
  /**
   * False = registered in the catalog as a known option but not yet runnable
   * by the worker. UI hides these so the dropdown only offers options that
   * actually execute.
   */
  implemented: boolean;
}

export interface ExecutorKindCommonConfig {
  provider?: ProviderOption[];
}

export const executorCommonConfig: Record<ExecutorKind, ExecutorKindCommonConfig> = {
  "coding-cli": {
    provider: [
      { value: "claude", label: "Claude", implemented: true  },
      { value: "gemini", label: "Gemini", implemented: false },
      { value: "codex",  label: "Codex",  implemented: false },
    ],
  },
  "git-provider": {
    provider: [
      { value: "github", label: "GitHub", implemented: true  },
      { value: "gitlab", label: "GitLab", implemented: false },
    ],
  },
  "ticket-provider": {
    provider: [
      { value: "jira",            label: "Jira",            implemented: true  },
      { value: "github-issues",   label: "GitHub Issues",   implemented: true  },
      { value: "github-projects", label: "GitHub Projects", implemented: true  },
      { value: "linear",          label: "Linear",          implemented: false },
      { value: "monday",          label: "Monday",          implemented: false },
    ],
  },
  "notification": {
    provider: [
      { value: "console", label: "Console", implemented: true  },
      { value: "slack",   label: "Slack",   implemented: false },
    ],
  },
  "control": {},
};

/** Provider list filtered to only implemented entries — what the dropdown should show. */
export function visibleProvidersFor(kind: ExecutorKind): ProviderOption[] {
  return (executorCommonConfig[kind].provider ?? []).filter(p => p.implemented);
}

export function defaultProviderFor(kind: ExecutorKind): string | undefined {
  return visibleProvidersFor(kind)[0]?.value;
}
```

- [ ] **Step 2: Find dropdown consumers and switch them to `visibleProvidersFor`**

Search the flow-editor for callers of `executorCommonConfig[...].provider` (the dropdown-rendering call sites). Each one should be updated to call `visibleProvidersFor(kind)` instead, so stub providers stop appearing in the UI.

```bash
grep -rn "executorCommonConfig" packages/flow-editor/src
```

For each match outside `executor-common-config.ts` itself, replace `executorCommonConfig[kind].provider` (or equivalent destructuring) with `visibleProvidersFor(kind)`. Preserve the `defaultProviderFor` callers — that helper is unchanged in spirit (now derives from visible list).

> **Note:** If a caller already uses `defaultProviderFor`, leave it alone. Only the dropdown-rendering sites that iterate over the option list need to switch to `visibleProvidersFor`.

---

## Stage 3 — Single source of truth: `PROVIDER_CATALOG` in `@journeyman/core`

### Task 11: Create the provider catalog

**Files:**
- Create: `packages/core/src/registries/provider-catalog.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Create the catalog file**

```ts
// packages/core/src/registries/provider-catalog.ts

export type ExecutorKind =
  | "coding-cli"
  | "git-provider"
  | "ticket-provider"
  | "notification";

export interface ProviderEntry {
  kind: ExecutorKind;
  /** Stable id used in flow JSON (`PhaseInput.provider`). */
  value: string;
  /** Human-readable label for the editor dropdown. */
  label: string;
  /** False = known but not yet runnable; hidden from dropdown, throws if invoked. */
  implemented: boolean;
  /** Marks the resolver default for its kind. Exactly one per kind should set this. */
  isDefault?: boolean;
}

export const PROVIDER_CATALOG: ReadonlyArray<ProviderEntry> = [
  // coding-cli
  { kind: "coding-cli", value: "claude", label: "Claude", implemented: true, isDefault: true },
  { kind: "coding-cli", value: "gemini", label: "Gemini", implemented: false },
  { kind: "coding-cli", value: "codex",  label: "Codex",  implemented: false },

  // git-provider
  { kind: "git-provider", value: "github", label: "GitHub", implemented: true, isDefault: true },
  { kind: "git-provider", value: "gitlab", label: "GitLab", implemented: false },

  // ticket-provider
  { kind: "ticket-provider", value: "jira",            label: "Jira",            implemented: true, isDefault: true },
  { kind: "ticket-provider", value: "github-issues",   label: "GitHub Issues",   implemented: true },
  { kind: "ticket-provider", value: "github-projects", label: "GitHub Projects", implemented: true },
  { kind: "ticket-provider", value: "linear",          label: "Linear",          implemented: false },
  { kind: "ticket-provider", value: "monday",          label: "Monday",          implemented: false },

  // notification
  { kind: "notification", value: "console", label: "Console", implemented: true, isDefault: true },
  { kind: "notification", value: "slack",   label: "Slack",   implemented: false },
];

export function providersForKind(kind: ExecutorKind): ProviderEntry[] {
  return PROVIDER_CATALOG.filter(p => p.kind === kind);
}

export function implementedProvidersForKind(kind: ExecutorKind): ProviderEntry[] {
  return providersForKind(kind).filter(p => p.implemented);
}

export function defaultProviderForKind(kind: ExecutorKind): ProviderEntry | undefined {
  return providersForKind(kind).find(p => p.isDefault);
}
```

- [ ] **Step 2: Re-export from core index**

Add to `packages/core/src/index.ts` (anywhere after the interface re-exports):

```ts
export {
  PROVIDER_CATALOG,
  providersForKind,
  implementedProvidersForKind,
  defaultProviderForKind,
} from "./registries/provider-catalog.ts";
export type { ProviderEntry } from "./registries/provider-catalog.ts";
// Note: ExecutorKind is also exported from flow-editor; import from core for orchestrator-side code.
export type { ExecutorKind as CoreExecutorKind } from "./registries/provider-catalog.ts";
```

> Aliasing avoids colliding with `flow-editor/src/phase-definition.ts`'s own `ExecutorKind` (which includes `"control"`). The catalog version intentionally excludes `"control"` because control flow has no provider.

---

### Task 12: Derive `executor-common-config.ts` from the catalog

**Files:**
- Modify: `packages/flow-editor/src/executor-common-config.ts`

- [ ] **Step 1: Replace the file with a catalog-derived implementation**

```ts
// packages/flow-editor/src/executor-common-config.ts
import {
  PROVIDER_CATALOG,
  implementedProvidersForKind,
  defaultProviderForKind,
} from "@journeyman/core";
import type { ExecutorKind } from "./phase-definition.ts";

export interface ProviderOption {
  value: string;
  label: string;
  implemented: boolean;
}

export interface ExecutorKindCommonConfig {
  provider?: ProviderOption[];
}

const EDITOR_KINDS = ["coding-cli", "git-provider", "ticket-provider", "notification"] as const;

function buildCommonConfig(): Record<ExecutorKind, ExecutorKindCommonConfig> {
  const out: Record<ExecutorKind, ExecutorKindCommonConfig> = {
    "coding-cli": {},
    "git-provider": {},
    "ticket-provider": {},
    "notification": {},
    "control": {},
  };
  for (const kind of EDITOR_KINDS) {
    out[kind] = {
      provider: PROVIDER_CATALOG
        .filter(p => p.kind === kind)
        .map(p => ({ value: p.value, label: p.label, implemented: p.implemented })),
    };
  }
  return out;
}

export const executorCommonConfig: Record<ExecutorKind, ExecutorKindCommonConfig> = buildCommonConfig();

export function visibleProvidersFor(kind: ExecutorKind): ProviderOption[] {
  if (kind === "control") return [];
  return implementedProvidersForKind(kind).map(p => ({
    value: p.value,
    label: p.label,
    implemented: p.implemented,
  }));
}

export function defaultProviderFor(kind: ExecutorKind): string | undefined {
  if (kind === "control") return undefined;
  return defaultProviderForKind(kind)?.value;
}
```

---

### Task 13: Add startup catalog assertion in `cli-worker.ts`

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 1: Add the assertion helper**

Add this helper near the top of the file (below imports, above `const baseUrl = ...`):

```ts
import { PROVIDER_CATALOG, type CoreExecutorKind } from "@journeyman/core";
import type { ProviderResolver } from "@journeyman/core";

function assertResolverMatchesCatalog(kind: CoreExecutorKind, resolver: ProviderResolver<unknown>): void {
  const expected = PROVIDER_CATALOG
    .filter(p => p.kind === kind && p.implemented)
    .map(p => p.value)
    .sort();
  const actual = [...resolver.keys()].sort();
  const missing = expected.filter(k => !actual.includes(k));
  const extra   = actual.filter(k => !expected.includes(k));
  if (missing.length || extra.length) {
    throw new Error(
      `Provider catalog mismatch for "${kind}". ` +
      `Catalog says implemented=[${expected.join(", ")}], ` +
      `worker registered=[${actual.join(", ")}]. ` +
      `Missing in worker: [${missing.join(", ")}]. Extra in worker: [${extra.join(", ")}]. ` +
      `Update PROVIDER_CATALOG or the resolver registration.`,
    );
  }
}
```

- [ ] **Step 2: Call the assertion after each resolver is built**

After the four resolver registrations (right before the `// Register matching task definitions` comment), add:

```ts
assertResolverMatchesCatalog("coding-cli",      coding);
assertResolverMatchesCatalog("git-provider",    git);   // only if git block succeeded; see below
assertResolverMatchesCatalog("ticket-provider", ticket);
assertResolverMatchesCatalog("notification",    notification);
```

> **Caveat for the `git` resolver:** it lives inside a `try { ... } catch { ... }` because `GitHubProvider` may throw at construction. To keep the assertion paired with the construction, move the assertion call inside the `try` block immediately after the five `registry.register(...)` calls — not into the global block above. So delete the `git` line from that global call and instead append it inside the existing try-block:

```ts
try {
  const git = new MapProviderResolver<IGitProvider>({ /* ... */ });
  registry.register(new CloneReposPhaseHandler({ git }));
  // ... other registrations ...
  registry.register(new FetchPrCommentsPhaseHandler({ git }));
  assertResolverMatchesCatalog("git-provider", git);
} catch (err) {
  log.warn({ err: (err as Error).message }, "skipping git-provider handlers — provider unavailable");
}
```

---

## Final verification

### Task 14: Typecheck everything

**Files:** none (verification only)

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```

Expected: exits 0 with no errors across all workspace packages.

If errors appear, the most likely causes are:
- A handler refactor that missed a `this.deps.X.` → `X.` substitution.
- An import path typo on `provider-resolver.interface.ts` or `map-provider-resolver.ts`.
- A constructor call site that still passes a raw provider instance instead of a resolver.

Fix in place; re-run until clean.

- [ ] **Step 2: Stop**

Per user instruction: **do not commit**. Leave all changes uncommitted in the working tree. Report completion to the user with a one-line summary of which files were touched.

---

## Self-Review

**Spec coverage:**
- ✅ Stage 1.1 `ProviderResolver<T>` → Task 1.
- ✅ Stage 1.2 ticket-handler refactor → Task 3.
- ✅ Stage 1.3 worker wiring → Task 4.
- ✅ Stage 1.4 dropdown entries → Task 5.
- ✅ Stage 1.5 `provider` passthrough — confirmed in pre-plan inspection that `PhaseInput` is `Record<string, unknown>`; no contract change needed. Documented in File Structure section.
- ✅ Stage 2.1–2.3 other-kind ports → Tasks 6, 7, 8, 9.
- ✅ Stage 2.4 `implemented` flag → Task 10.
- ✅ Stage 3.1 catalog → Task 11.
- ✅ Stage 3.2 editor derives from catalog → Task 12.
- ✅ Stage 3.3 worker assertion → Task 13.
- ✅ Spec testing-section unit tests → intentionally skipped per user instruction; replaced by typecheck-only verification (Task 14).

**Placeholder scan:** None — every code-bearing step contains the literal code; the only non-code step is Task 10 Step 2, which uses a `grep` plus a clear substitution rule because the call sites depend on what's already in the file.

**Type consistency:** `ProviderResolver<T>` signature is identical at definition (Task 1), implementation (Task 2), and every consumer (Tasks 3, 6, 7, 8). `kind` strings (`"ticket-provider"`, etc.) match between resolver constructors and catalog assertions. `defaultKey` values match the `isDefault: true` entries in `PROVIDER_CATALOG`.
