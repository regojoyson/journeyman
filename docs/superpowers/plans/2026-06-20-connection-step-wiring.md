# Connection-Wired Steps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual provider + secret-binding config on git/ticket/notification steps with a single connection picker per step, resolved to a decrypted credential at worker runtime.

**Architecture:** Add `connectionId?: string | null` to `WorkflowNode`; forward it through the Conductor converter; add a `connectionResolver` dep to `WorkerHarness` that fetches + decrypts the connection and injects it into `StepContext.connection`; update all 11 affected step handlers to use `ctx.connection` instead of `ctx.env`; remove provider dropdowns and secrets tab from the flow-editor for connection-backed steps; add a `ConnectionPicker` + `RepoPicker` to the step properties panel.

**Tech Stack:** TypeScript, React, Fastify, PostgreSQL (`pg`), `@journeyman/connections`, `@journeyman/secrets`

**Constraints:** Work on master branch directly. No commits. Run `npm run typecheck` at the end.

---

## File Map

| Action | File | What changes |
|---|---|---|
| Modify | `packages/core/src/types/connection.types.ts` | Add `ResolvedConnection` interface |
| Modify | `packages/core/src/types/flow.types.ts` | Add `connectionId?: string \| null` to `WorkflowNode` |
| Modify | `packages/core/src/types/step-handler.types.ts` | Add `connection?: ResolvedConnection` to `StepContext` |
| Modify | `packages/core/src/interfaces/provider-resolver.interface.ts` | Add optional third arg to `ProviderFactory<T>` |
| Modify | `packages/core/src/index.ts` | Export `ResolvedConnection` |
| Modify | `packages/steps/src/catalog.ts` | Add `connectionCategory?` to `StepCatalogEntry`; set on 12 entries |
| Modify | `packages/core/src/registries/provider-catalog.ts` | Remove `slots` from git/issue/notification entries; remove those entries from `PHASE_KIND_MAP` |
| Modify | `packages/orchestrator/src/flow-json/conductor-converter.ts` | Forward `connectionId` in `inputParameters` |
| Modify | `packages/orchestrator/src/workers/worker-harness.ts` | Add `connectionResolver` dep; resolve + inject `ctx.connection` |
| Create | `packages/orchestrator/src/workers/worker-harness.connection.test.ts` | Unit test for connection resolution |
| Modify | `packages/orchestrator/src/cli-worker.ts` | Wire `connectionResolver`; update git/issue/notification factories |
| Modify | `packages/orchestrator/src/workers/steps/clone-repos-step-handler.ts` | Use `ctx.connection` |
| Modify | `packages/orchestrator/src/workers/steps/get-repository-step-handler.ts` | Use `ctx.connection` |
| Modify | `packages/orchestrator/src/workers/steps/list-pull-requests-step-handler.ts` | Use `ctx.connection` |
| Modify | `packages/orchestrator/src/workers/steps/list-pull-request-comments-step-handler.ts` | Use `ctx.connection` |
| Modify | `packages/orchestrator/src/workers/steps/open-pull-request-step-handler.ts` | Use `ctx.connection` |
| Modify | `packages/orchestrator/src/workers/steps/get-issue-step-handler.ts` | Use `ctx.connection` |
| Modify | `packages/orchestrator/src/workers/steps/create-issue-step-handler.ts` | Use `ctx.connection` |
| Modify | `packages/orchestrator/src/workers/steps/update-issue-fields-step-handler.ts` | Use `ctx.connection` |
| Modify | `packages/orchestrator/src/workers/steps/transition-issue-step-handler.ts` | Use `ctx.connection` |
| Modify | `packages/orchestrator/src/workers/steps/comment-on-issue-step-handler.ts` | Use `ctx.connection` |
| Modify | `packages/orchestrator/src/workers/steps/send-message-step-handler.ts` | Use `ctx.connection` |
| Modify | `packages/steps/src/git/clone-repos.tsx` | `requiredSecrets: "hidden"`, remove `slots` |
| Modify | `packages/steps/src/git/get-repository.tsx` | `requiredSecrets: "hidden"`, remove `slots` |
| Modify | `packages/steps/src/git/open-pull-request.tsx` | `requiredSecrets: "hidden"`, remove `slots` |
| Modify | `packages/steps/src/git/list-pull-requests.tsx` | `requiredSecrets: "hidden"`, remove `slots` |
| Modify | `packages/steps/src/git/comment-on-pull-request.tsx` | `requiredSecrets: "hidden"`, remove `slots` |
| Modify | `packages/steps/src/git/list-pull-request-comments.tsx` | `requiredSecrets: "hidden"`, remove `slots` |
| Modify | `packages/steps/src/issues/get-issue.tsx` | `requiredSecrets: "hidden"` |
| Modify | `packages/steps/src/issues/create-issue.tsx` | `requiredSecrets: "hidden"`, remove `slots` |
| Modify | `packages/steps/src/issues/update-issue-fields.tsx` | `requiredSecrets: "hidden"`, remove `slots` |
| Modify | `packages/steps/src/issues/transition-issue.tsx` | `requiredSecrets: "hidden"`, remove `slots` |
| Modify | `packages/steps/src/issues/comment-on-issue.tsx` | `requiredSecrets: "hidden"`, remove `slots` |
| Modify | `packages/steps/src/notifications/send-message.tsx` | `requiredSecrets: "hidden"`, remove `slots` |
| Modify | `packages/flow-editor/src/flow-config/DefaultsExecutorSection.tsx` | Keep only `"coding-cli"` in `EXECUTOR_KINDS` |
| Modify | `packages/flow-editor/src/executor-common-config.ts` | Set empty `provider: []` for non-coding-cli kinds |
| Create | `packages/flow-editor/src/api/connections.ts` | `fetchConnections(wsId, category)` and `fetchConnectionRepos(wsId, connectionId, search)` |
| Create | `packages/flow-editor/src/properties-panel/ConnectionPicker.tsx` | Dropdown filtered by `connectionCategory` |
| Create | `packages/flow-editor/src/properties-panel/RepoPicker.tsx` | Searchable multi-select for `clone-repos` |
| Modify | `packages/flow-editor/src/properties-panel/ConfigTab.tsx` | Render `ConnectionPicker` at top for connection-backed steps; render `RepoPicker` for `clone-repos`; skip `ExecutorBlock` for those |
| Modify | `packages/flow-editor/src/catalogs/use-step-catalog.ts` | Add `connectionCategory?` to local `StepCatalogEntry` type |

---

## Task 1: Add `ResolvedConnection` to `@journeyman/core`

**Files:**
- Modify: `packages/core/src/types/connection.types.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add `ResolvedConnection` interface to `connection.types.ts`**

  Append after the existing `ConnectionUpdateInput` type:

  ```ts
  /** Decrypted connection handed to a step handler via StepContext.connection. */
  export interface ResolvedConnection {
    id: string;
    category: ConnectionCategory;
    provider: string;
    credential: string;
    baseUrl?: string;
    config?: Record<string, unknown>;
  }
  ```

- [ ] **Step 2: Export `ResolvedConnection` from `packages/core/src/index.ts`**

  Find the line that exports from `./types/connection.types.ts` and confirm `ResolvedConnection` is covered. If the export is `export * from "./types/connection.types.ts"`, it's already covered and no change is needed. If named exports are used, add `ResolvedConnection` to the list.

---

## Task 2: Add `connectionId` to `WorkflowNode` and `connection` to `StepContext`

**Files:**
- Modify: `packages/core/src/types/flow.types.ts`
- Modify: `packages/core/src/types/step-handler.types.ts`

- [ ] **Step 1: Add `connectionId` to `WorkflowNode` in `flow.types.ts`**

  In the `WorkflowNode` interface (around line 98), add after the `sandboxId` field:

  ```ts
  /** Connection ID for provider-backed steps (git/ticket/notification). Resolved by the worker before the step runs. */
  connectionId?: string | null;
  ```

- [ ] **Step 2: Add `connection` to `StepContext` in `step-handler.types.ts`**

  The file is `packages/core/src/types/step-handler.types.ts`. In `StepContext`, add after `env`:

  ```ts
  /** Resolved connection for this step. Present when node.connectionId is set. */
  connection?: import("./connection.types.ts").ResolvedConnection;
  ```

---

## Task 3: Extend `ProviderFactory<T>` with optional connection arg

**Files:**
- Modify: `packages/core/src/interfaces/provider-resolver.interface.ts`

- [ ] **Step 1: Add optional third arg**

  Replace the existing `ProviderFactory` type:

  ```ts
  // before
  export type ProviderFactory<T> = (
    key: string | undefined,
    env: Record<string, string>,
  ) => T;

  // after
  export type ProviderFactory<T> = (
    key: string | undefined,
    env: Record<string, string>,
    connection?: import("../types/connection.types.ts").ResolvedConnection,
  ) => T;
  ```

---

## Task 4: Add `connectionCategory` to step catalog

**Files:**
- Modify: `packages/steps/src/catalog.ts`

- [ ] **Step 1: Add `connectionCategory` to `StepCatalogEntry`**

  In the `StepCatalogEntry` interface (around line 82), add:

  ```ts
  export interface StepCatalogEntry {
    stepType: string;
    label: string;
    category: string;
    description: string;
    inputFields: InputFields;
    outputSchema: OutputSchema | null;
    configSchema?: { safeParse: (v: unknown) => { success: boolean; error?: { issues?: Array<{ path?: PropertyKey[]; message?: string }> } } };
    /** Declares which connection category this step requires. UI-only: drives the connection picker in the properties panel. */
    connectionCategory?: import("@journeyman/core").ConnectionCategory;
  }
  ```

- [ ] **Step 2: Set `connectionCategory` on all affected catalog entries**

  In the `stepCatalog` array, add `connectionCategory` to each entry:

  ```ts
  // Code Host entries — add connectionCategory: "git"
  { stepType: CLONE_REPOS_STEP_TYPE, ..., connectionCategory: "git" },
  { stepType: GET_REPOSITORY_STEP_TYPE, ..., connectionCategory: "git" },
  { stepType: OPEN_PULL_REQUEST_STEP_TYPE, ..., connectionCategory: "git" },
  { stepType: LIST_PULL_REQUESTS_STEP_TYPE, ..., connectionCategory: "git" },
  { stepType: COMMENT_ON_PULL_REQUEST_STEP_TYPE, ..., connectionCategory: "git" },
  { stepType: LIST_PULL_REQUEST_COMMENTS_STEP_TYPE, ..., connectionCategory: "git" },

  // Issue Tracker entries — add connectionCategory: "ticket"
  { stepType: GET_ISSUE_STEP_TYPE, ..., connectionCategory: "ticket" },
  { stepType: CREATE_ISSUE_STEP_TYPE, ..., connectionCategory: "ticket" },
  { stepType: UPDATE_ISSUE_FIELDS_STEP_TYPE, ..., connectionCategory: "ticket" },
  { stepType: TRANSITION_ISSUE_STEP_TYPE, ..., connectionCategory: "ticket" },
  { stepType: COMMENT_ON_ISSUE_STEP_TYPE, ..., connectionCategory: "ticket" },

  // Messaging — add connectionCategory: "notification"
  { stepType: SEND_MESSAGE_STEP_TYPE, ..., connectionCategory: "notification" },
  ```

  The catalog entries span many lines each; add `connectionCategory` as the last property on each affected entry object.

---

## Task 5: Remove `slots` and `PHASE_KIND_MAP` entries for non-coding-cli providers

**Files:**
- Modify: `packages/core/src/registries/provider-catalog.ts`

- [ ] **Step 1: Remove `slots` from git, issue, and notification `PROVIDER_CATALOG` entries**

  Credentials now come from the connection; slots are no longer used for these kinds. Remove the `slots` array from every `PROVIDER_CATALOG` entry whose `kind` is `"git-provider"`, `"issue-provider"`, or `"notification"`.

  After the change, the affected entries look like:
  ```ts
  { kind: "git-provider", value: "github", label: "GitHub", implemented: true, isDefault: true },
  { kind: "git-provider", value: "gitlab", label: "GitLab", implemented: false },
  { kind: "issue-provider", value: "jira", label: "Jira", implemented: true, isDefault: true },
  { kind: "issue-provider", value: "github-issues", label: "GitHub Issues", implemented: true },
  { kind: "issue-provider", value: "github-projects", label: "GitHub Projects", implemented: true },
  { kind: "issue-provider", value: "linear",  label: "Linear",  implemented: false },
  { kind: "issue-provider", value: "monday",  label: "Monday",  implemented: false },
  { kind: "notification", value: "console", label: "Console", implemented: true, isDefault: true },
  { kind: "notification", value: "slack",   label: "Slack",   implemented: false },
  ```

- [ ] **Step 2: Remove git, issue, and notification entries from `PHASE_KIND_MAP`**

  With connections replacing provider slots for these step types, `kindForStepType` returning `undefined` for them is correct — the harness will skip slot resolution entirely and rely on `ctx.connection` instead.

  Remove these entries from `PHASE_KIND_MAP`:
  ```ts
  // remove:
  "clone-repos":                "git-provider",
  "get-repository":             "git-provider",
  "list-pull-request-comments": "git-provider",
  "list-pull-requests":         "git-provider",
  "open-pull-request":          "git-provider",
  "comment-on-issue":   "issue-provider",
  "create-issue":       "issue-provider",
  "get-issue":          "issue-provider",
  "transition-issue":   "issue-provider",
  "update-issue-fields":"issue-provider",
  "send-message": "notification",
  ```

  Keep only the `coding-cli` entries:
  ```ts
  export const PHASE_KIND_MAP: Record<string, ExecutorKind> = {
    "custom-ai":            "coding-cli",
    "list-workspace-files": "coding-cli",
    "start-feature-branch": "coding-cli",
  };
  ```

---

## Task 6: Forward `connectionId` through the Conductor converter

**Files:**
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts`

- [ ] **Step 1: Add `connectionId` to `inputParameters`**

  In `conductor-converter.ts`, find the `inputParameters` block (around line 377). It currently spreads `resolvedNode.config`, then adds `sandboxId` etc. Add `connectionId` in the same pattern:

  ```ts
  // in the inputParameters object, after sandboxId:
  ...(resolvedNode.connectionId ? { connectionId: resolvedNode.connectionId } : {}),
  ```

  Full block for context (only the new line matters):
  ```ts
  return {
    ...(resolvedNode.config ?? {}),
    ...resolveInputs(resolvedNode.inputs),
    provider: resolvedNode.executorConfig?.provider,
    retry: resolvedNode.retry ?? {},
    secretBindings: bindings,
    ...(resolvedNode.model ? { model: resolvedNode.model } : {}),
    ...(resolvedNode.sandboxId ? { sandboxId: resolvedNode.sandboxId } : {}),
    ...(resolvedNode.connectionId ? { connectionId: resolvedNode.connectionId } : {}),   // NEW
    _flowDefaultSources: defaultSources,
    _kindProviders: kindProviders,
    workflowInstanceId: "${workflow.input.workflowInstanceId}",
    startedByUserId: "${workflow.input.startedByUserId}",
    startedByOrgId: "${workflow.input.startedByOrgId}",
    workspaceId: "${workflow.input.workspaceId}",
    workflowId: "${workflow.input.workflowId}",
  };
  ```

---

## Task 7: Add `connectionResolver` to `WorkerHarness` and resolve before step runs

**Files:**
- Modify: `packages/orchestrator/src/workers/worker-harness.ts`
- Create: `packages/orchestrator/src/workers/worker-harness.connection.test.ts`

- [ ] **Step 1: Write a failing test**

  Create `packages/orchestrator/src/workers/worker-harness.connection.test.ts`:

  ```ts
  import { describe, it, expect, vi } from "vitest";

  describe("WorkerHarness connection resolution", () => {
    it("resolves connectionId and injects ctx.connection before running the step", async () => {
      // Arrange: build minimal harness deps with a spy connectionResolver
      const resolvedConn = {
        id: "conn-1", category: "git" as const, provider: "github",
        credential: "ghp_secret", baseUrl: undefined, config: undefined,
      };
      const connectionResolver = vi.fn().mockResolvedValue(resolvedConn);

      let capturedConnection: unknown;
      const handler = {
        stepType: "clone-repos",
        requiresWorkspace: false,
        run: vi.fn().mockImplementation(async (_input: unknown, ctx: { connection?: unknown }) => {
          capturedConnection = ctx.connection;
          return { kind: "success", output: {} };
        }),
      };

      // Build minimal harness — see worker-harness.test.ts for how to construct deps
      // The task input data must carry connectionId: "conn-1"
      // After handler.run, capturedConnection should deep-equal resolvedConn
      expect(capturedConnection).toEqual(resolvedConn);
      expect(connectionResolver).toHaveBeenCalledWith("conn-1");
    });

    it("leaves ctx.connection undefined when connectionId is absent", async () => {
      let capturedConnection: unknown = "sentinel";
      const handler = {
        stepType: "clone-repos",
        requiresWorkspace: false,
        run: vi.fn().mockImplementation(async (_input: unknown, ctx: { connection?: unknown }) => {
          capturedConnection = ctx.connection;
          return { kind: "success", output: {} };
        }),
      };
      // Build harness with no connectionId in task input
      // After run, capturedConnection should be undefined
      expect(capturedConnection).toBeUndefined();
    });
  });
  ```

  > Note: look at `packages/orchestrator/src/workers/worker-harness.test.ts` for the real harness construction pattern (how to wire up `client`, `registry`, `events`, `bindingResolver`, etc.) and adapt it here. The key assertion is that `ctx.connection` equals the resolved value when `connectionId` is present, and is `undefined` when absent.

- [ ] **Step 2: Run the test to confirm it fails**

  ```bash
  cd packages/orchestrator && npm test -- --reporter=verbose worker-harness.connection
  ```

  Expected: compilation error or test failure (connection resolution not implemented yet).

- [ ] **Step 3: Add `connectionResolver` to `WorkerHarnessDeps`**

  In `worker-harness.ts`, add to the `WorkerHarnessDeps` interface after `ensureWorkspace`:

  ```ts
  /**
   * Fetch and decrypt a connection by ID. Called before running any step
   * that has connectionId set. Returns the decrypted ResolvedConnection.
   */
  connectionResolver?: (connectionId: string) => Promise<import("@journeyman/core").ResolvedConnection>;
  ```

  (Optional dep so existing tests without it still compile.)

- [ ] **Step 4: Resolve connection in `processOnce` and inject into `StepContext`**

  In `processOnce`, after the skills resolution block (around line 280, after `(stepInput as ...).skills = skills`) and before `this.deps.events.append(... "step.started" ...)`, add:

  ```ts
  const connectionId = (stepInput as { connectionId?: string }).connectionId;
  let resolvedConnection: import("@journeyman/core").ResolvedConnection | undefined;
  if (connectionId && this.deps.connectionResolver) {
    try {
      resolvedConnection = await this.deps.connectionResolver(connectionId);
      rlog.info({ connectionId, provider: resolvedConnection.provider }, "connection resolved");
    } catch (err: any) {
      rlog.error({ connectionId, err: err?.message }, "connection resolution failed");
      await appendStepEvent(this.deps.events, ctx, "step.failed", {
        reason: "connection_resolution_failed",
        error: serializeError(err),
      });
      await this.deps.client.completeTask({
        workflowInstanceId: conductorWorkflowId, taskId: task.taskId,
        status: "FAILED_WITH_TERMINAL_ERROR",
        reasonForIncompletion: `Connection resolution failed: ${err?.message ?? String(err)}`,
      });
      return;
    }
  }
  ```

  Then in the `handler.run(stepInput, { ... })` call (around line 387), add `connection` to the context object:

  ```ts
  const result = await handler.run(stepInput, {
    workflowInstanceId, nodeId, attempt: task.retryCount + 1,
    workspaceDir, signal: abort.signal,
    env: resolvedEnv,
    workflowInputs,
    ...(resolvedConnection ? { connection: resolvedConnection } : {}),  // NEW
    log: (line, meta) => { ... },
    ...(execFn ? { exec: execFn } : {}),
    ...(materializeFn ? { materialize: materializeFn } : {}),
  });
  ```

- [ ] **Step 5: Run the test again**

  ```bash
  cd packages/orchestrator && npm test -- --reporter=verbose worker-harness.connection
  ```

  Expected: PASS (after wiring the spy harness correctly per the pattern in `worker-harness.test.ts`).

---

## Task 8: Wire `connectionResolver` in `cli-worker.ts` and update provider factories

**Files:**
- Modify: `packages/orchestrator/src/cli-worker.ts`

- [ ] **Step 1: Add necessary imports**

  At the top of `cli-worker.ts`, add imports for the connections package and secrets:

  ```ts
  import { getConnection, getConnectionSealed } from "@journeyman/connections";
  import { open } from "@journeyman/secrets";
  import type { ResolvedConnection } from "@journeyman/core";
  ```

  (`@journeyman/secrets` is already imported — check it exports `open`. If not, import it from the right subpath.)

- [ ] **Step 2: Update the `git` `ProviderFactory` to accept `connection`**

  Find the `git` factory (around line 212). Replace it:

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
      default: {
        const err = new Error(`Unknown git provider: ${provider}`) as Error & { name: string };
        err.name = "ConfigurationError";
        throw err;
      }
    }
  };
  ```

- [ ] **Step 3: Update the `issue` `ProviderFactory` to accept `connection`**

  Find the `issue` factory (around line 234). Replace it:

  ```ts
  const issue: ProviderFactory<IIssueProvider> = (key, env, connection) => {
    const provider = connection?.provider ?? key ?? "jira";
    switch (provider) {
      case "jira":
        return new JiraProvider({
          apiToken: connection?.credential ?? env.JIRA_API_TOKEN,
          email: (connection?.config?.email as string | undefined) ?? env.JIRA_EMAIL,
          host: (connection?.baseUrl ?? env.JIRA_HOST ?? "").replace(/^https?:\/\//, ""),
        });
      case "github-issues":
        return new GitHubIssuesProvider({ token: connection?.credential ?? env.GITHUB_ACCESS_TOKEN });
      case "github-projects":
        return new GitHubProjectsProvider({ token: connection?.credential ?? env.GITHUB_ACCESS_TOKEN });
      case "linear":
        return new (require("@journeyman/ticket-provider").LinearProvider)({ apiKey: connection?.credential });
      case "monday":
        return new (require("@journeyman/ticket-provider").MondayProvider)({ apiKey: connection?.credential });
      default: {
        const err = new Error(`Unknown issue provider: ${provider}`) as Error & { name: string };
        err.name = "ConfigurationError";
        throw err;
      }
    }
  };
  ```

  > Note: `LinearProvider` and `MondayProvider` are stubs — check what they accept in `packages/ticket-provider/src/`. Adjust the constructor call to match their actual signature (likely `{ apiKey: string }`). If they're not exported yet, import them.

- [ ] **Step 4: Update the `notification` `ProviderFactory` to accept `connection`**

  Find the `notification` factory (around line 259). Replace it:

  ```ts
  const notification: ProviderFactory<INotificationProvider> = (key, _env, connection) => {
    const provider = connection?.provider ?? key ?? "console";
    switch (provider) {
      case "console":
        return new ConsoleProvider();
      case "slack":
        // SlackProvider is a stub — implement when Slack is ready
        throw Object.assign(new Error("Slack provider not yet implemented"), { name: "ConfigurationError" });
      default: {
        const err = new Error(`Unknown notification provider: ${provider}`) as Error & { name: string };
        err.name = "ConfigurationError";
        throw err;
      }
    }
  };
  ```

- [ ] **Step 5: Add `connectionResolver` to the `WorkerHarness` instantiation**

  Find where `new WorkerHarness({ ... })` or the `WorkerHarness` deps object is constructed. Add:

  ```ts
  connectionResolver: pool
    ? async (connectionId: string): Promise<ResolvedConnection> => {
        const conn = await getConnection(pool, connectionId);
        if (!conn) throw Object.assign(new Error(`Connection not found: ${connectionId}`), { name: "ConfigurationError" });
        const sealed = await getConnectionSealed(pool, connectionId);
        if (!sealed) throw Object.assign(new Error(`Connection credential not found: ${connectionId}`), { name: "ConfigurationError" });
        return {
          id: conn.id,
          category: conn.category,
          provider: conn.provider,
          credential: open(sealed),
          baseUrl: conn.baseUrl,
          config: conn.config,
        };
      }
    : undefined,
  ```

  (`open` from `@journeyman/secrets` decrypts the sealed credential. The `getConnectionSealed` function returns the raw sealed credential object — `open()` accepts it and returns the plaintext string.)

---

## Task 9: Update git step handlers to use `ctx.connection`

**Files:**
- Modify: `packages/orchestrator/src/workers/steps/clone-repos-step-handler.ts`
- Modify: `packages/orchestrator/src/workers/steps/get-repository-step-handler.ts`
- Modify: `packages/orchestrator/src/workers/steps/list-pull-requests-step-handler.ts`
- Modify: `packages/orchestrator/src/workers/steps/list-pull-request-comments-step-handler.ts`
- Modify: `packages/orchestrator/src/workers/steps/open-pull-request-step-handler.ts`

For each handler, the change is the same: pass `ctx.connection` as the third arg to the git factory.

- [ ] **Step 1: Update `clone-repos-step-handler.ts`**

  Find the line where `git` is constructed (currently line 48):
  ```ts
  // before
  const git: Pick<IGitProvider, "cloneRepos"> = ctx.exec
    ? new SandboxInstanceGitProvider(ctx.exec)
    : this.deps.git(typeof input.provider === "string" ? input.provider : undefined, ctx.env);

  // after
  const git: Pick<IGitProvider, "cloneRepos"> = ctx.exec
    ? new SandboxInstanceGitProvider(ctx.exec)
    : this.deps.git(ctx.connection?.provider, ctx.env, ctx.connection);
  ```

- [ ] **Step 2: Update `get-repository-step-handler.ts`**

  Find where `this.deps.git(...)` is called and change it to:
  ```ts
  const gitProvider = this.deps.git(ctx.connection?.provider, ctx.env, ctx.connection);
  ```
  (The local variable name may differ — adapt to match the existing code.)

- [ ] **Step 3: Update `list-pull-requests-step-handler.ts`**

  Same pattern — pass `ctx.connection` as third arg to `this.deps.git(...)`.

- [ ] **Step 4: Update `list-pull-request-comments-step-handler.ts`**

  Same pattern.

- [ ] **Step 5: Update `open-pull-request-step-handler.ts`**

  Same pattern.

---

## Task 10: Update issue step handlers to use `ctx.connection`

**Files:**
- Modify: `packages/orchestrator/src/workers/steps/get-issue-step-handler.ts`
- Modify: `packages/orchestrator/src/workers/steps/create-issue-step-handler.ts`
- Modify: `packages/orchestrator/src/workers/steps/update-issue-fields-step-handler.ts`
- Modify: `packages/orchestrator/src/workers/steps/transition-issue-step-handler.ts`
- Modify: `packages/orchestrator/src/workers/steps/comment-on-issue-step-handler.ts`

For each, find the `this.deps.issue(...)` call and change it to pass `ctx.connection` as third arg.

- [ ] **Step 1: Update `get-issue-step-handler.ts`**

  ```ts
  // before
  const issueProvider = this.deps.issue(
    typeof input.provider === "string" ? input.provider : undefined,
    ctx.env,
  );

  // after
  const issueProvider = this.deps.issue(ctx.connection?.provider, ctx.env, ctx.connection);
  ```

- [ ] **Step 2: Update `create-issue-step-handler.ts`** — same pattern.

- [ ] **Step 3: Update `update-issue-fields-step-handler.ts`** — same pattern.

- [ ] **Step 4: Update `transition-issue-step-handler.ts`** — same pattern.

- [ ] **Step 5: Update `comment-on-issue-step-handler.ts`** — same pattern.

---

## Task 11: Update `send-message` step handler

**Files:**
- Modify: `packages/orchestrator/src/workers/steps/send-message-step-handler.ts`

- [ ] **Step 1: Update `send-message-step-handler.ts`**

  Find the `this.deps.notification(...)` call and change it to:

  ```ts
  const notifProvider = this.deps.notification(ctx.connection?.provider, ctx.env, ctx.connection);
  ```

---

## Task 12: Hide secrets tab and remove `slots` from step definitions

**Files:** All `.tsx` step definition files listed in the File Map for `packages/steps/src/`.

All connection-backed steps need `requiredSecrets: "hidden"` in their `tabs` object and the `slots` array removed (if present).

- [ ] **Step 1: Update all git step definitions**

  For each of these files, set `tabs.requiredSecrets: "hidden"` and delete any `slots` property:

  **`packages/steps/src/git/clone-repos.tsx`** — add `requiredSecrets: "hidden"` to `tabs`; remove `slots` if present.

  **`packages/steps/src/git/get-repository.tsx`** — same.

  **`packages/steps/src/git/open-pull-request.tsx`** — has `slots: [{ name: "GITHUB_ACCESS_TOKEN", ... }]`; remove it entirely. Add `requiredSecrets: "hidden"` to `tabs`.

  **`packages/steps/src/git/list-pull-requests.tsx`** — check for `slots`; add `requiredSecrets: "hidden"` to `tabs`.

  **`packages/steps/src/git/comment-on-pull-request.tsx`** — check for `slots`; add `requiredSecrets: "hidden"` to `tabs`.

  **`packages/steps/src/git/list-pull-request-comments.tsx`** — check for `slots`; add `requiredSecrets: "hidden"` to `tabs`.

  For each file, the `tabs` object goes from:
  ```ts
  tabs: { io: "shown", mcp: "hidden", retry: "shown" },
  ```
  to:
  ```ts
  tabs: { io: "shown", mcp: "hidden", retry: "shown", requiredSecrets: "hidden" },
  ```

- [ ] **Step 2: Update all issue step definitions**

  Same for `packages/steps/src/issues/get-issue.tsx`, `create-issue.tsx`, `update-issue-fields.tsx`, `transition-issue.tsx`, `comment-on-issue.tsx` — add `requiredSecrets: "hidden"` to `tabs`; remove `slots` where present.

- [ ] **Step 3: Update the notification step definition**

  `packages/steps/src/notifications/send-message.tsx` — add `requiredSecrets: "hidden"` to `tabs`; remove `slots` where present.

---

## Task 13: Remove provider dropdowns from flow-editor defaults and executor config

**Files:**
- Modify: `packages/flow-editor/src/flow-config/DefaultsExecutorSection.tsx`
- Modify: `packages/flow-editor/src/executor-common-config.ts`

- [ ] **Step 1: Update `DefaultsExecutorSection.tsx` to show only `coding-cli`**

  Change `EXECUTOR_KINDS` and `KIND_LABELS`:

  ```ts
  // before
  const KIND_LABELS: Record<CoreExecutorKind, string> = {
    "coding-cli":      "Coding CLI",
    "git-provider":    "Git Provider",
    "issue-provider": "Issue Provider",
    "notification":    "Notification",
  };
  const EXECUTOR_KINDS: CoreExecutorKind[] = ["coding-cli", "git-provider", "issue-provider", "notification"];

  // after
  const KIND_LABELS: Partial<Record<CoreExecutorKind, string>> = {
    "coding-cli": "Coding CLI",
  };
  const EXECUTOR_KINDS: CoreExecutorKind[] = ["coding-cli"];
  ```

  The rest of the component is unchanged — iterating over `EXECUTOR_KINDS` will now only render the coding-cli row.

- [ ] **Step 2: Update `executor-common-config.ts` to return empty provider list for non-coding-cli kinds**

  Change `EDITOR_KINDS` and `buildCommonConfig` so git/issue/notification kinds have `provider: []`:

  ```ts
  const EDITOR_KINDS = ["coding-cli"] as const;

  function buildCommonConfig(): Record<ExecutorKind, ExecutorKindCommonConfig> {
    const out: Record<ExecutorKind, ExecutorKindCommonConfig> = {
      "coding-cli":    {},
      "git-provider":  { provider: [] },
      "issue-provider": { provider: [] },
      "notification":  { provider: [] },
      "control":       {},
    };
    out["coding-cli"] = {
      provider: PROVIDER_CATALOG
        .filter(p => p.kind === "coding-cli")
        .map(p => ({ value: p.value, label: p.label, implemented: p.implemented })),
    };
    return out;
  }
  ```

  With `provider: []`, `ExecutorBlock` checks `cfg.provider.length === 0` and returns `null` — no provider dropdown shown for these steps.

---

## Task 14: Add connection API client to flow-editor

**Files:**
- Create: `packages/flow-editor/src/api/connections.ts`

- [ ] **Step 1: Create `connections.ts`**

  ```ts
  // packages/flow-editor/src/api/connections.ts
  import type { Connection, ConnectionCategory } from "@journeyman/core";

  function baseUrl(): string {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
    return env.VITE_API_BASE_URL ?? "";
  }

  export async function fetchConnections(
    wsId: string,
    category: ConnectionCategory,
  ): Promise<Connection[]> {
    try {
      const r = await fetch(
        `${baseUrl()}/api/workspaces/${encodeURIComponent(wsId)}/connections?category=${category}`,
        { credentials: "include" },
      );
      if (!r.ok) return [];
      const data = await r.json() as Connection[];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  export interface RepoSummary {
    name: string;
    fullName: string;
    url: string;
    defaultBranch: string;
    isPrivate: boolean;
  }

  export async function fetchConnectionRepos(
    wsId: string,
    connectionId: string,
    search?: string,
  ): Promise<RepoSummary[]> {
    try {
      const qs = search ? `?search=${encodeURIComponent(search)}` : "";
      const r = await fetch(
        `${baseUrl()}/api/workspaces/${encodeURIComponent(wsId)}/connections/${encodeURIComponent(connectionId)}/repos${qs}`,
        { credentials: "include" },
      );
      if (!r.ok) return [];
      const data = await r.json() as { repos: RepoSummary[] };
      return Array.isArray(data?.repos) ? data.repos : [];
    } catch {
      return [];
    }
  }
  ```

---

## Task 15: Create `ConnectionPicker` component

**Files:**
- Create: `packages/flow-editor/src/properties-panel/ConnectionPicker.tsx`

- [ ] **Step 1: Write the component**

  ```tsx
  // packages/flow-editor/src/properties-panel/ConnectionPicker.tsx
  import { useEffect, useState } from "react";
  import type { Connection, ConnectionCategory } from "@journeyman/core";
  import { fetchConnections } from "../api/connections.ts";
  import { useWsId } from "../state/org-context.tsx";

  interface Props {
    category: ConnectionCategory;
    value: string | null | undefined;
    onChange: (connectionId: string | null) => void;
    readOnly?: boolean;
  }

  const CATEGORY_LABEL: Record<ConnectionCategory, string> = {
    git: "Git",
    ticket: "Ticket tracker",
    notification: "Notification",
  };

  export function ConnectionPicker({ category, value, onChange, readOnly }: Props) {
    const wsId = useWsId();
    const [connections, setConnections] = useState<Connection[]>([]);

    useEffect(() => {
      if (!wsId) return;
      fetchConnections(wsId, category).then(setConnections).catch(() => {});
    }, [wsId, category]);

    return (
      <div className="je-props__field">
        <label>{CATEGORY_LABEL[category]} connection</label>
        <select
          value={value ?? ""}
          disabled={readOnly}
          onChange={e => onChange(e.target.value || null)}
        >
          <option value="">— pick a connection —</option>
          {connections.map(c => (
            <option key={c.id} value={c.id}>
              {c.label} ({c.provider})
            </option>
          ))}
        </select>
        {connections.length === 0 && (
          <div className="je-props__field-help">
            No {CATEGORY_LABEL[category].toLowerCase()} connections in this workspace.{" "}
            <a href="/connections" target="_blank" rel="noopener noreferrer">Set one up →</a>
          </div>
        )}
      </div>
    );
  }
  ```

---

## Task 16: Create `RepoPicker` component for `clone-repos`

**Files:**
- Create: `packages/flow-editor/src/properties-panel/RepoPicker.tsx`

- [ ] **Step 1: Write the component**

  ```tsx
  // packages/flow-editor/src/properties-panel/RepoPicker.tsx
  import { useEffect, useState, useCallback } from "react";
  import { fetchConnectionRepos, type RepoSummary } from "../api/connections.ts";
  import { useWsId } from "../state/org-context.tsx";

  interface Props {
    connectionId: string;
    /** Currently selected clone URLs */
    value: string[];
    onChange: (urls: string[]) => void;
    readOnly?: boolean;
  }

  export function RepoPicker({ connectionId, value, onChange, readOnly }: Props) {
    const wsId = useWsId();
    const [repos, setRepos] = useState<RepoSummary[]>([]);
    const [search, setSearch] = useState("");
    const [loading, setLoading] = useState(false);

    const load = useCallback(
      (q: string) => {
        if (!wsId) return;
        setLoading(true);
        fetchConnectionRepos(wsId, connectionId, q || undefined)
          .then(setRepos)
          .catch(() => setRepos([]))
          .finally(() => setLoading(false));
      },
      [wsId, connectionId],
    );

    useEffect(() => { load(""); }, [load]);

    useEffect(() => {
      const id = window.setTimeout(() => load(search), 300);
      return () => window.clearTimeout(id);
    }, [search, load]);

    const toggle = (url: string) => {
      if (readOnly) return;
      onChange(value.includes(url) ? value.filter(u => u !== url) : [...value, url]);
    };

    return (
      <div className="je-props__field">
        <label>Repositories</label>

        {/* Selected chips */}
        {value.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
            {value.map(url => {
              const name = url.split("/").slice(-2).join("/").replace(/\.git$/, "");
              return (
                <span key={url} style={{
                  display: "inline-flex", alignItems: "center", gap: 4,
                  fontSize: 11, padding: "2px 7px",
                  background: "rgb(var(--color-surface) / 1)",
                  border: "1px solid rgb(var(--color-border) / 1)",
                  borderRadius: 4,
                }}>
                  {name}
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => toggle(url)}
                      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 12, color: "rgb(var(--color-text-muted) / 1)" }}
                    >×</button>
                  )}
                </span>
              );
            })}
          </div>
        )}

        {/* Search */}
        <input
          type="search"
          placeholder="Search repos…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          disabled={readOnly}
          style={{ width: "100%", marginBottom: 4, boxSizing: "border-box" }}
        />

        {/* List */}
        <div style={{
          maxHeight: 150, overflowY: "auto",
          border: "1px solid rgb(var(--color-border) / 1)", borderRadius: 4,
        }}>
          {loading && (
            <div style={{ padding: "6px 8px", fontSize: 11, color: "rgb(var(--color-text-muted) / 1)" }}>
              Loading…
            </div>
          )}
          {!loading && repos.length === 0 && (
            <div style={{ padding: "6px 8px", fontSize: 11, color: "rgb(var(--color-text-muted) / 1)" }}>
              No repos found.
            </div>
          )}
          {repos.map(r => {
            const selected = value.includes(r.url);
            return (
              <div
                key={r.url}
                onClick={() => toggle(r.url)}
                style={{
                  padding: "5px 8px", fontSize: 12, cursor: readOnly ? "default" : "pointer",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  background: selected ? "rgb(var(--color-info) / 0.1)" : undefined,
                }}
              >
                <span>{r.fullName}</span>
                {selected && <span style={{ fontSize: 11, color: "rgb(var(--color-info) / 1)" }}>✓</span>}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  ```

---

## Task 17: Wire `ConnectionPicker` and `RepoPicker` into `ConfigTab.tsx`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/ConfigTab.tsx`
- Modify: `packages/flow-editor/src/catalogs/use-step-catalog.ts`

- [ ] **Step 1: Add `connectionCategory` to the local `StepCatalogEntry` type in `use-step-catalog.ts`**

  In `use-step-catalog.ts`, update `StepCatalogEntry`:

  ```ts
  export interface StepCatalogEntry {
    stepType: string;
    label: string;
    category: string;
    inputFields: Record<string, StepInputFieldMeta>;
    outputSchema: OutputSchema | null;
    /** Which connection category this step requires. Undefined = no connection picker. */
    connectionCategory?: "git" | "ticket" | "notification";
  }
  ```

- [ ] **Step 2: Import `ConnectionPicker` and `RepoPicker` in `ConfigTab.tsx`**

  Add at the top of `ConfigTab.tsx`:

  ```ts
  import { ConnectionPicker } from "./ConnectionPicker.tsx";
  import { RepoPicker } from "./RepoPicker.tsx";
  ```

- [ ] **Step 3: Render `ConnectionPicker` for connection-backed steps**

  In `ConfigTab.tsx`, find where `ExecutorBlock` is rendered (around line 306):

  ```tsx
  {definition && (
    <ExecutorBlock
      kind={definition.executor.kind}
      ...
    />
  )}
  ```

  Replace with:

  ```tsx
  {catalogEntry?.connectionCategory ? (
    <ConnectionPicker
      category={catalogEntry.connectionCategory}
      value={node.connectionId}
      readOnly={readOnly}
      onChange={connectionId => onChange({ ...node, connectionId: connectionId ?? null })}
    />
  ) : definition && (
    <ExecutorBlock
      kind={definition.executor.kind}
      value={executorConfig}
      onChange={next => onChange({ ...node, executorConfig: next })}
      readOnly={readOnly}
      flowDefaults={flowDefaults}
    />
  )}
  ```

- [ ] **Step 4: Render `RepoPicker` for `clone-repos` after the connection picker**

  After the connection picker block, add (still inside the main `<div>`):

  ```tsx
  {node.stepType === "clone-repos" && node.connectionId && (
    <RepoPicker
      connectionId={node.connectionId}
      value={Array.isArray(config.repos) ? config.repos as string[] : []}
      readOnly={readOnly}
      onChange={repos => onChange({ ...node, config: { ...config, repos } })}
    />
  )}
  ```

  This replaces the freetext `repos` field for `clone-repos` — users now pick repos from the list instead of typing URLs. The `SchemaForm` will still try to render a `repos` field from the step's configFields; to prevent double-rendering, confirm that `clone-repos` doesn't have `repos` in its `configFields` in `packages/steps/src/git/clone-repos.tsx`. If it does, remove it from `configFields` (the `RepoPicker` owns the `repos` config key now).

---

## Task 18: Final typecheck

- [ ] **Step 1: Run typecheck across the monorepo**

  ```bash
  npm run typecheck
  ```

  Expected: no errors. Common issues to look for:
  - `StepContext.connection` type mismatch if `ResolvedConnection` import path is wrong — use `import type { ResolvedConnection } from "@journeyman/core"` in handler files
  - `ProviderFactory<T>` third arg type error in any factory call site that didn't add the third param — the arg is optional so existing call sites without it should compile without change
  - `ConnectionCategory` not exported from `@journeyman/core` — verify the export in `core/src/index.ts`
  - `WorkflowNode.connectionId` type used in conductor-converter — should be `string | null | undefined`, matching the field definition
  - `catalogEntry?.connectionCategory` in `ConfigTab.tsx` will be `string | undefined`; the `ConnectionPicker` expects `ConnectionCategory` — the type from `use-step-catalog.ts` should match

- [ ] **Step 2: Fix any type errors**

  Address each error shown. The most common:

  ```
  Argument of type 'string | undefined' is not assignable to parameter of type 'ConnectionCategory'
  ```

  Fix by narrowing: in `ConfigTab.tsx`, change the check to:
  ```tsx
  {(catalogEntry?.connectionCategory === "git" || catalogEntry?.connectionCategory === "ticket" || catalogEntry?.connectionCategory === "notification") ? (
    <ConnectionPicker category={catalogEntry.connectionCategory} ... />
  ) : ...}
  ```
