# Connection-Wired Steps Design

**Date:** 2026-06-20
**Status:** Approved

## Summary

Provider-backed steps (git, ticket, notification) currently require users to manually configure a provider string and secret bindings for credentials. This design replaces that with a connection picker: users select a named connection (already set up in workspace settings), and the worker resolves the credential from that connection at runtime. The secret bindings section is removed for these steps, and the workflow-level default provider dropdowns for git/ticket/notification are removed entirely.

---

## Scope

**Steps that get connection pickers:**

| Category | Steps |
|---|---|
| `git` | `clone-repos`, `get-repository`, `open-pull-request`, `list-pull-requests`, `comment-on-pull-request`, `list-pull-request-comments` |
| `ticket` | `get-issue`, `create-issue`, `update-issue-fields`, `transition-issue`, `comment-on-issue` |
| `notification` | `send-message` |

**Steps unchanged:**
- `list-workspace-files`, `start-feature-branch`, `custom-ai` — use coding provider, not a connection

**Backward compatibility:** Connections fully replace secret bindings for these steps. No fallback path.

---

## Section 1 — Data model (`@journeyman/core`)

### 1.1 `WorkflowNode` — new field

```ts
// flow.types.ts
export interface WorkflowNode {
  // ...existing fields...
  /** Connection ID for provider-backed steps. Resolved by worker before step runs. */
  connectionId?: string | null;
}
```

This sits alongside `sandboxId`, `model`, `secretBindings` as a top-level scalar. One connection per step — covers every current use case.

### 1.2 New `ResolvedConnection` type

```ts
// connection.types.ts
export interface ResolvedConnection {
  id: string;
  category: ConnectionCategory;
  provider: string;
  credential: string;
  baseUrl?: string;
  config?: Record<string, unknown>;
}
```

This is the decrypted, ready-to-use connection handed to a step handler via `StepContext`.

### 1.3 `StepContext` — new field

```ts
// step-handler.types.ts
export interface StepContext {
  // ...existing fields...
  /** Resolved connection for this step. Present when node.connectionId is set. */
  connection?: ResolvedConnection;
}
```

### 1.4 `ProviderFactory<T>` — optional third arg

```ts
// provider-resolver.interface.ts
export type ProviderFactory<T> = (
  key: string | undefined,
  env: Record<string, string>,
  connection?: ResolvedConnection,
) => T;
```

Factories in `cli-worker.ts` prefer `connection` over `env` when present. The third arg is optional so all existing factory call sites (non-connection steps) compile unchanged.

### 1.5 `WorkflowDefaults.executorConfig` — remove non-coding-cli kinds

`executorConfig` currently allows setting a default provider for `git-provider`, `issue-provider`, and `notification` executor kinds. These are no longer needed — the connection carries the provider. Only `coding-cli` remains.

```ts
// Before
executorConfig?: Partial<Record<ExecutorKind, { provider?: string }>>;

// After: ExecutorKind is narrowed to coding-cli only
executorConfig?: { "coding-cli"?: { provider?: string } };
```

`ExecutorKind` in `provider-catalog.ts` drops `"git-provider"`, `"issue-provider"`, `"notification"` — leaving only `"coding-cli"`. `PHASE_KIND_MAP` entries for non-coding-cli step types are removed. `PROVIDER_CATALOG` entries for git/issue/notification providers are kept (used by the connections page) but their `slots` arrays are removed — credentials now come from the connection, not the secret binding system.

---

## Section 2 — Step catalog (`@journeyman/steps`)

`StepCatalogEntry` gets one new field:

```ts
export interface StepCatalogEntry {
  // ...existing fields...
  /** UI hint: which connection category this step requires. Undefined = no connection. */
  connectionCategory?: ConnectionCategory;
}
```

This is a UI-only signal. The worker does not read it — it resolves whatever `connectionId` is on the node. Added directly in `catalog.ts` alongside existing entries; no changes to `.meta.ts` files.

---

## Section 3 — Runtime execution (`@journeyman/orchestrator`)

### 3.1 `WorkerHarness` — new `connectionResolver` dep

```ts
export interface WorkerHarnessDeps {
  // ...existing deps...
  connectionResolver: (connectionId: string) => Promise<ResolvedConnection>;
}
```

Before running any step: if `node.connectionId` is set, the harness calls `connectionResolver(node.connectionId)`, gets back a `ResolvedConnection`, and injects it into `StepContext.connection`. If not set, `ctx.connection` is `undefined`.

### 3.2 `cli-worker.ts` — wire `connectionResolver`

Uses existing `@journeyman/connections` helpers:

```ts
connectionResolver: async (id) => {
  const conn = await getConnection(pool, id);
  const sealed = await getConnectionSealed(pool, id);
  return {
    id: conn.id,
    category: conn.category,
    provider: conn.provider,
    credential: open(sealed),
    baseUrl: conn.baseUrl,
    config: conn.config,
  };
}
```

No new packages needed.

### 3.3 Step handlers — use `ctx.connection`

All 12 connection-backed step handlers change from:

```ts
// Before
const git = this.deps.git(input.provider as string, ctx.env);
```

to:

```ts
// After
const git = this.deps.git(ctx.connection?.provider, ctx.env, ctx.connection);
```

The `git` / `issue` / `notification` factories in `cli-worker.ts` check `connection` first:

```ts
const git: ProviderFactory<IGitProvider> = (key, env, connection) => {
  const provider = connection?.provider ?? key ?? "github";
  switch (provider) {
    case "github":
      return new GitHubProvider({ token: connection?.credential ?? env.GITHUB_ACCESS_TOKEN });
    case "gitlab":
      return new GitLabProvider({
        token: connection?.credential ?? env.GITLAB_TOKEN,
        baseUrl: connection?.baseUrl ?? env.GITLAB_BASE_URL || undefined,
      });
    default:
      throw Object.assign(new Error(`Unknown git provider: ${provider}`), { name: "ConfigurationError" });
  }
};
```

Same pattern for `issue` and `notification` factories.

---

## Section 4 — API

No new endpoints. Existing endpoints cover all needs:

- `GET /workspaces/:wsId/connections?category=git` — connection dropdown data
- `GET /workspaces/:wsId/connections/:id/repos?search=...` — repo picker for `clone-repos`

---

## Section 5 — UI (`@journeyman/flow-editor`)

### 5.1 Connection picker

When a step's `StepCatalogEntry.connectionCategory` is set, the properties panel renders a **Connection** section at the top (above all other config fields):

- Fetches `GET .../connections?category={connectionCategory}` on mount
- Dropdown shows connection labels with provider icon + name
- Selected connection ID writes to `node.connectionId`
- If no connections exist for the category, shows "Set up a connection →" link to the workspace connections page
- A "New connection" option at the bottom of the dropdown links to the connections page

### 5.2 Repo picker for `clone-repos`

After a git connection is selected, a **Repositories** section appears:

- Calls `GET .../connections/:id/repos?search=...` on each keystroke (debounced 300ms)
- Selected repos shown as removable chips
- Searchable multi-select list below
- Selected repo clone URLs write to `node.config.repos` as `string[]` — same shape the step handler already expects

### 5.3 Removed UI

- **Secrets bindings section** — hidden for all steps with `connectionCategory` set
- **Provider dropdown** in workflow defaults — the `executorConfig` picker for `git-provider`, `issue-provider`, and `notification` kinds is removed from the workflow defaults panel. Only the `coding-cli` provider picker remains.
- **`input.provider` field** — any explicit provider selector previously shown in step config panels is removed for connection-backed steps

---

## File Map

| Package | File | Change |
|---|---|---|
| `@journeyman/core` | `types/flow.types.ts` | Add `connectionId?: string \| null` to `WorkflowNode`; remove non-coding-cli from `executorConfig` type |
| `@journeyman/core` | `types/connection.types.ts` | Add `ResolvedConnection` interface |
| `@journeyman/core` | `types/step-handler.types.ts` | Add `connection?: ResolvedConnection` to `StepContext` |
| `@journeyman/core` | `interfaces/provider-resolver.interface.ts` | Add optional third arg to `ProviderFactory<T>` |
| `@journeyman/core` | `registries/provider-catalog.ts` | Narrow `ExecutorKind` to `"coding-cli"` only; remove `slots` from git/issue/notification entries; clean up `PHASE_KIND_MAP` |
| `@journeyman/steps` | `catalog.ts` | Add `connectionCategory?: ConnectionCategory` to `StepCatalogEntry`; set it on all 12 affected step entries |
| `@journeyman/orchestrator` | `workers/worker-harness.ts` | Add `connectionResolver` dep; resolve connection into `StepContext` before step runs |
| `@journeyman/orchestrator` | `workers/steps/clone-repos-step-handler.ts` | Use `ctx.connection` |
| `@journeyman/orchestrator` | `workers/steps/get-repository-step-handler.ts` | Use `ctx.connection` |
| `@journeyman/orchestrator` | `workers/steps/open-pull-request-step-handler.ts` | Use `ctx.connection` |
| `@journeyman/orchestrator` | `workers/steps/list-pull-requests-step-handler.ts` | Use `ctx.connection` |
| `@journeyman/orchestrator` | `workers/steps/list-pull-request-comments-step-handler.ts` | Use `ctx.connection` |
| `@journeyman/orchestrator` | `workers/steps/get-issue-step-handler.ts` | Use `ctx.connection` |
| `@journeyman/orchestrator` | `workers/steps/create-issue-step-handler.ts` | Use `ctx.connection` |
| `@journeyman/orchestrator` | `workers/steps/update-issue-fields-step-handler.ts` | Use `ctx.connection` |
| `@journeyman/orchestrator` | `workers/steps/transition-issue-step-handler.ts` | Use `ctx.connection` |
| `@journeyman/orchestrator` | `workers/steps/comment-on-issue-step-handler.ts` | Use `ctx.connection` |
| `@journeyman/orchestrator` | `workers/steps/send-message-step-handler.ts` | Use `ctx.connection` |
| `@journeyman/orchestrator` | `cli-worker.ts` | Wire `connectionResolver`; update `git`, `issue`, `notification` factories to prefer `connection` |
| `@journeyman/flow-editor` | Step properties panel | Add connection picker; add repo picker for `clone-repos`; remove secrets section for connection-backed steps; remove provider dropdown from workflow defaults |
