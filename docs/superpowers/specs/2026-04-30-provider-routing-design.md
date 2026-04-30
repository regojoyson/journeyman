# Provider Routing — Design

**Date:** 2026-04-30
**Status:** Draft
**Branch:** feat-01

## Problem

The flow editor's executor dropdowns (`coding-cli`, `git-provider`, `ticket-provider`, `notification`) let the user pick a provider per phase node, but the orchestrator worker ignores the selection. Every phase handler is constructed with a single hardcoded provider instance at startup. Concrete symptoms today:

1. **Dropdown lies — selection has no effect.** A node configured with `provider: "linear"` is executed by `JiraProvider` because `cli-worker.ts` does `new JiraProvider()` once and registers it for every ticket phase.
2. **Implemented providers are invisible.** `GitHubIssuesProvider` and `GitHubProjectsProvider` are fully implemented and exported from `@journeyman/ticket-provider`, but the ticket-provider dropdown only lists `jira | linear | monday`.
3. **Dropdown ↔ runtime mismatch in both directions.** The notification dropdown advertises only `slack` (a stub), but the worker registers `ConsoleProvider` — which isn't in the dropdown at all.
4. **Five new phase handlers just landed** (clone-repos, commit-push, cleanup-repos, etc.). Without a fix, each new handler entrenches the broken pattern further.

The shape is uniform across the four executor kinds, so the fix can be uniform.

## Goals

- The `provider` value chosen in the editor is the provider that runs at execution time.
- Adding a new provider requires changes in **one** place per layer (provider package, dropdown registry, worker resolver) — no scattered hardcoding.
- Implemented-but-hidden providers (`github-issues`, `github-projects`, `console`) become selectable.
- No change to the public flow-JSON contract — `provider` is already part of the phase input shape.

## Non-Goals

- Implementing stub providers (Linear, Monday, GitLab, Slack, Gemini, Codex). They stay stubs; this spec only routes correctly to them.
- Per-tenant provider configuration / secret scoping. Out of scope.
- Changing how credentials are resolved (`EnvCredentialStore` stays as is).

## Approach: staged rollout

### Stage 1 — Fix the lie for `ticket-provider` (end-to-end vertical slice)

Goal: prove the pattern on one executor kind, unblock GitHub Issues today.

**1.1 Introduce `ProviderResolver<T>` in `@journeyman/core`**

```ts
// packages/core/src/interfaces/provider-resolver.interface.ts
export interface ProviderResolver<T> {
  /** Returns the provider instance registered under `key`, or the default if `key` is undefined. */
  resolve(key: string | undefined): T;
  /** All keys this resolver knows about (for diagnostics / validation). */
  keys(): string[];
}
```

Plus a tiny default implementation `MapProviderResolver<T>` (in `@journeyman/orchestrator`) backed by a `Map<string, T>` and a default key.

**1.2 Refactor ticket phase handlers to take a resolver**

Every ticket phase handler currently has `constructor(private deps: { ticket: ITicketProvider })`. Change to:

```ts
constructor(private deps: { ticket: ProviderResolver<ITicketProvider> }) {}

async run(input, ctx) {
  const ticket = this.deps.ticket.resolve(typeof input.provider === "string" ? input.provider : undefined);
  // ... use ticket as before
}
```

Affected handlers: `GetTicketPhaseHandler`, `UpdateStatusPhaseHandler`, `CreateTicketPhaseHandler`, `UpdateTicketPhaseHandler`, `AddTicketCommentPhaseHandler`.

**1.3 Wire the resolver in `cli-worker.ts`**

```ts
const ticketResolver = new MapProviderResolver<ITicketProvider>({
  default: "jira",
  providers: {
    "jira":             new JiraProvider(),
    "github-issues":    new GitHubIssuesProvider(),
    "github-projects":  new GitHubProjectsProvider(),
    // linear, monday: omitted — stubs throw, no value in registering
  },
});
```

Pass `ticketResolver` to each ticket phase handler.

**1.4 Surface the new providers in the dropdown**

`packages/flow-editor/src/executor-common-config.ts`:

```ts
"ticket-provider": {
  provider: [
    { value: "jira",            label: "Jira" },
    { value: "github-issues",   label: "GitHub Issues" },
    { value: "github-projects", label: "GitHub Projects" },
    { value: "linear",          label: "Linear" },
    { value: "monday",          label: "Monday" },
  ],
},
```

**1.5 Verify `provider` is threaded through the flow JSON → phase input**

Confirm in `flow-json/conductor-converter.ts` and `flow-json/resolve-inputs.ts` that the node's `provider` config field reaches the handler's `PhaseInput`. If it doesn't, add it (this is the only contract change in Stage 1, and it's additive — `provider` becomes a reserved input key alongside `credentials`).

**Done when:** a flow with a `update-status` node configured with `provider: "github-issues"` actually calls `GitHubIssuesProvider.updateStatus`, verified by integration test.

### Stage 2 — Apply the pattern to the other three executor kinds

Mechanical port now that Stage 1 nailed the shape.

**2.1 `coding-cli`** — handlers: `Analyze`, `Plan`, `Implement`, `CreateWorkspace`, `CheckoutRepo`, `ScanRepos`, `CommitPush`, `CleanupRepos`. Resolver default `"claude"`. Register only `claude` (`gemini`, `codex` are stubs).

**2.2 `git-provider`** — handlers: `CloneRepos`, `GetRepo`, `CreatePr`, `ListPrs`, `FetchPrComments`. Resolver default `"github"`. Register only `github`.

**2.3 `notification`** — handlers: `Notify`. Resolver default `"console"`.

  - Reconcile the dropdown: add `{ value: "console", label: "Console" }`. Decide on `slack`: keep listed (stub) or hide until implemented. Recommendation: **hide stubs from the dropdown** to keep the editor honest. Encode this by tagging providers `implemented: true | false` in the dropdown registry and filtering in the UI.

**2.4 Tag stubs across the board.** Apply the `implemented` flag to all four kinds so the UI shows only working providers, but the type stays open for stubs to flip to `true` when implemented.

**Done when:** `cli-worker.ts` constructs zero provider instances directly — every handler gets a resolver — and the dropdown shows only providers the worker can actually run.

### Stage 3 — Single source of truth in `@journeyman/core`

Today the dropdown list lives in `flow-editor/executor-common-config.ts` and the worker registration lives in `cli-worker.ts`. They drift. Stage 3 collapses them.

**3.1 Provider catalog in `@journeyman/core`**

```ts
// packages/core/src/registries/provider-catalog.ts
export type ExecutorKind = "coding-cli" | "git-provider" | "ticket-provider" | "notification";

export interface ProviderEntry {
  kind: ExecutorKind;
  value: string;        // stable id used in flow JSON
  label: string;        // display label
  implemented: boolean; // false hides from dropdown, throws clearly if invoked
  isDefault?: boolean;
}

export const PROVIDER_CATALOG: ReadonlyArray<ProviderEntry> = [
  { kind: "ticket-provider", value: "jira",            label: "Jira",            implemented: true, isDefault: true },
  { kind: "ticket-provider", value: "github-issues",   label: "GitHub Issues",   implemented: true },
  // ...
];
```

**3.2 Flow editor reads the catalog**

`executor-common-config.ts` becomes a thin derivation: filter by `kind`, exclude `implemented: false` for the dropdown, expose default via `isDefault`.

**3.3 Worker validates against the catalog**

At startup, `cli-worker.ts` asserts that every `implemented: true` entry has a registered instance in the corresponding resolver. Mismatch = startup error, not runtime surprise.

**Done when:** adding a new provider is exactly three edits — implement the class, add an entry to `PROVIDER_CATALOG`, register an instance in the resolver. The dropdown updates automatically.

## File-level impact

| Layer | Files touched (Stage 1) | Stage 2 | Stage 3 |
|---|---|---|---|
| `@journeyman/core` | `interfaces/provider-resolver.interface.ts` (new) | — | `registries/provider-catalog.ts` (new) |
| `@journeyman/orchestrator` | `registry/map-provider-resolver.ts` (new); 5 ticket handlers; `cli-worker.ts`; `index.ts` exports | 14 more handlers; `cli-worker.ts` | `cli-worker.ts` (catalog assert) |
| `@journeyman/flow-editor` | `executor-common-config.ts` (add 2 entries) | `executor-common-config.ts` (rebuild around `implemented`) | `executor-common-config.ts` (derive from catalog) |
| `flow-json` | `resolve-inputs.ts` may need `provider` passthrough | — | — |

## Risks & mitigations

- **Risk:** existing flow JSONs in the wild have no `provider` field. **Mitigation:** resolver falls back to the `default` key when `provider` is undefined — existing flows behave identically.
- **Risk:** Stage 3 catalog import cycle (`flow-editor` → `core` is fine; `orchestrator` → `core` is fine; nothing new). **Mitigation:** put catalog in `core`, never reference orchestrator/editor types from it.
- **Risk:** stubs surfaced as runtime errors instead of UI-greyed-out options after Stage 2. **Mitigation:** the `implemented` flag hides them; if a stub is selected via direct flow-JSON edit, the resolver throws a clear `ProviderNotImplementedError` at run time.

## Testing

- Stage 1: integration test that runs `update-status` with `provider: "github-issues"` against a mocked Octokit and asserts the right method was called.
- Stage 2: per-kind smoke test that the resolver returns the registered instance for each known key and the default for `undefined`.
- Stage 3: assertion test that `PROVIDER_CATALOG` and `cli-worker.ts` resolver registrations agree (no entry without instance, no instance without entry).

## Out of scope / future work

- UI affordance for showing "stub" providers as disabled with a tooltip rather than hiding them entirely.
- Per-run provider override (e.g. dry-run with mock providers).
- Tenant-scoped provider configuration.
