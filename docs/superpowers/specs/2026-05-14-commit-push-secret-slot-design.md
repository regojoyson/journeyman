# Commit & Push — Provider-Aware Secret Slot

**Date:** 2026-05-14
**Status:** Draft — design approved in brainstorming, awaiting spec review.
**Builds on:**
- [Secret Slots & Bindings](2026-04-30-secret-slots-and-bindings-design.md) — slot/binding model, `resolveBindings`, Auto-mode cascade.
- [Provider-Aware Secret Slots](2026-05-03-provider-aware-secret-slots-design.md) — `PROVIDER_CATALOG[kind].slots` lookup the editor + harness already use for provider-driven phases.

## 1. Goal

Make the **commit-and-push** phase explicitly declare it needs the workflow's git-host credentials, and resolve those credentials through the standard Auto cascade (user → org → global) — same UX as `ANTHROPIC_API_KEY` for analyze/plan/implement.

The mechanism must be **provider-generic**: GitHub today resolves `GITHUB_ACCESS_TOKEN`, GitLab tomorrow resolves `GITLAB_TOKEN`, etc., without changing the phase definition or any operation code.

## 2. Non-goals

- **No clone-repos changes.** That phase already embeds credentials at clone time. This spec only covers commit-and-push, which is the reported failure.
- **No new provider implementations.** GitLab support is unblocked by this spec but lands separately.
- **No provider auto-detection from the cloned repo's remote URL.** The workflow's configured git provider drives the slot lookup. Mixing providers within one workflow is out of scope.
- **No fundamental change to the slot/binding model or the resolver.** Re-uses existing primitives.
- **No prompt rewrite.** The `commit-push-repos` prompt is unchanged except for two added lines describing how to use the token.

## 3. Mental model

A phase that runs via one executor kind but needs **credentials from a different kind** declares that on its `PhaseDefinition`:

```ts
executor:       { kind: "coding-cli", method: "commitPushRepos" },
slotsFromKind:  "git-provider",
```

When `slotsFromKind` is set, both the editor's Required Secrets tab and the orchestrator's worker-harness derive the slot list from the workflow's catalog entry for that kind instead of the phase's executor provider. Everything else — Auto/Pinned bindings per node, save-time validation, resolver cascade — is unchanged.

## 4. Data model

### 4.1 `PhaseDefinition.slotsFromKind`

`packages/flow-editor/src/phase-definition.ts`:

```ts
import type { ProviderKind } from "@journeyman/core";

export interface PhaseDefinition<TConfig = unknown> {
  // ...existing fields...
  /**
   * When set, this phase's slot list is derived from PROVIDER_CATALOG entries
   * for the workflow's configured provider of this kind, not from the phase's
   * own `slots: []` or its executor provider. Used for phases that run on one
   * executor but need credentials from a different provider kind (e.g.
   * commit-and-push runs via coding-cli but needs the workflow's git-provider
   * credentials to push).
   */
  slotsFromKind?: ProviderKind;
}
```

No DB schema change. Phase definitions are static code.

### 4.2 No change to `FlowNode.secretBindings`

Custom and built-in phases continue to use the same `secretBindings: Record<string, SecretBinding>` shape. The lookup mechanism changes; the per-node binding contract does not.

## 5. Phase definition change

`packages/phases/src/repos/commit-and-push.tsx`:

```ts
tabs: { io: "shown", requiredSecrets: "shown", mcp: "hidden", retry: "shown" },
slots: [],
slotsFromKind: "git-provider",
```

Effect: dropping commit-and-push into a workflow that uses the `github` git-provider surfaces a `GITHUB_ACCESS_TOKEN` row in the Required Secrets tab with the standard Auto/Pinned picker. The user binds it (Auto by default), and at runtime that token reaches the Bash tool's env.

## 6. Editor — `RequiredSecretsTab`

`packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx` gains one extra resolution rule, applied **before** the existing executor-provider fallback:

```ts
// Resolution order, highest precedence first:
//   1. Custom-AI: definition.slots from DB (existing).
//   2. phaseDef.slotsFromKind: catalog entry for workflow's <kind> provider.
//   3. phaseDef.slots: statically declared on the phase definition.
//   4. providerSlots from the phase's executor kind/provider.
```

Step 2 implementation:

```ts
let kindOverrideSlots: SecretSlotDef[] = [];
if (phaseDef?.slotsFromKind) {
  const kindProvider =
    flow.defaults?.executorConfig?.[phaseDef.slotsFromKind]?.provider;
  kindOverrideSlots = kindProvider
    ? (PROVIDER_CATALOG.find(p => p.kind === phaseDef.slotsFromKind && p.value === kindProvider)?.slots ?? [])
    : [];
}
```

The slot list `slots` is then:

```ts
customSlots.length            ? customSlots
: kindOverrideSlots.length    ? kindOverrideSlots
: phaseDef?.slots?.length     ? phaseDef.slots
: providerSlots;
```

The resolution-preview, cross-scope warnings, and pinned-but-deleted handling are unchanged — slot rows are rendered the same way regardless of where the slot list came from.

### 6.1 Empty git-provider config

If `flow.defaults.executorConfig["git-provider"]` is unset (no provider chosen), `kindOverrideSlots` is empty and no rows render. A short hint replaces the empty state:

> *This phase needs the workflow's git-provider credentials. Pick a git provider in Workflow settings to see the required slot.*

Save-time validation continues to flag the workflow as incomplete via the existing publish path (the workflow can't push without a git provider anyway).

## 7. Runtime — `worker-harness`

`packages/orchestrator/src/workers/worker-harness.ts` mirrors the editor rule. The current slot lookup:

```ts
const phaseSlots = (phaseDef as { slots?: SecretSlotDef[] })?.slots ?? [];
const slots = phaseSlots.length > 0 ? phaseSlots : providerSlots;
```

becomes:

```ts
let kindOverrideSlots: SecretSlotDef[] = [];
const slotsFromKind = (phaseDef as { slotsFromKind?: ProviderKind }).slotsFromKind;
if (slotsFromKind) {
  const flowDefaults = (phaseInput as { _flowDefaults?: FlowDefaults })._flowDefaults;
  const kindProvider = flowDefaults?.executorConfig?.[slotsFromKind]?.provider;
  kindOverrideSlots = kindProvider
    ? (PROVIDER_CATALOG.find(p => p.kind === slotsFromKind && p.value === kindProvider)?.slots ?? [])
    : [];
}

const phaseSlots = (phaseDef as { slots?: SecretSlotDef[] })?.slots ?? [];
const slots = kindOverrideSlots.length > 0
  ? kindOverrideSlots
  : (phaseSlots.length > 0 ? phaseSlots : providerSlots);
```

`_flowDefaults` is already plumbed through the conductor-converter for default-source tracking; this re-uses the same field. If it isn't reachable in the worker context for some reason, the conductor-converter is extended to also pass `gitProvider`/`flowDefaults` explicitly on the phase input — implementation detail confirmed during planning.

Failure modes (unchanged from existing slots model):
- Required slot can't resolve → `MissingSecretsError` before LLM call. Run fails fast with a clear "missing GITHUB_ACCESS_TOKEN" message.
- Optional slot misses → key omitted from `ctx.env`; LLM proceeds; `git push` falls back to whatever credentials are baked into the clone (which is exactly today's behavior).

## 8. Runtime — `commit-push-repos` operation

`packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts`:

### 8.1 Options surface

`packages/core/src/types/git.types.ts`:

```ts
export type CommitPushReposOptions = SessionOptions & {
  // ...existing fields...
  /** Resolved slot-keyed env values. Passed to the Claude SDK's
   *  Bash tool so $GITHUB_ACCESS_TOKEN etc. are available at push time. */
  env?: Record<string, string>;
  /** The workflow's configured git provider (e.g. "github"). Lets the
   *  operation pick the right token env-var name to reference in the
   *  prompt's credential.helper snippet. */
  gitProvider?: string;
};
```

### 8.2 Provider-to-slot-name lookup

The operation maps `gitProvider` to the *primary* slot name that holds the push token. Re-uses `PROVIDER_CATALOG`:

```ts
function pushTokenEnvName(gitProvider: string | undefined): string | undefined {
  if (!gitProvider) return undefined;
  const entry = PROVIDER_CATALOG.find(p => p.kind === "git-provider" && p.value === gitProvider);
  // Convention: the first slot is the auth token. (GitHub's slots = [GITHUB_ACCESS_TOKEN])
  return entry?.slots?.[0]?.name;
}
```

Convention: the **first slot in a git-provider's catalog entry is its push-auth slot**. Documented inline so future providers stay compatible.

### 8.3 Prompt change

Two lines added to `buildPrompt` when `tokenEnvName` is set, replacing the bare `git push` instruction in step 10:

> *Before pushing, use the host token from env. Run push as:*
> `` git -C <repoDir> -c credential.helper='!f() { echo username=x-access-token; echo password=$<TOKEN_ENV>; }; f' push origin <branch> ``
> *The shell expands `$<TOKEN_ENV>` only inside the credential helper invocation; it never appears in `.git/config`, in `ps`, or in your output.*

When `tokenEnvName` is undefined (no git provider configured), the prompt keeps the existing plain `git push origin <branch>` instruction — backwards compatible.

The `-u` upstream retry and all other error-handling branches stay verbatim.

### 8.4 SDK env injection

The query options gain `env`:

```ts
options: {
  tools: ["Bash"],
  allowedTools: ["Bash"],
  permissionMode: "bypassPermissions",
  allowDangerouslySkipPermissions: true,
  ...(opts.env && Object.keys(opts.env).length ? { env: opts.env } : {}),
  // ...rest unchanged
}
```

This is the SDK's documented top-level `env` field (per [.claude/sdk.d.ts](../../.claude/sdk.d.ts) line 1075), merged on top of `process.env` for spawned tool processes only.

## 9. Handler

`packages/orchestrator/src/workers/phases/commit-and-push-phase-handler.ts` plumbs the resolved env and git-provider name through:

```ts
const result = await coding.commitPushRepos({
  // ...existing fields...
  env: ctx.env,
  gitProvider: ctx.flowDefaults?.executorConfig?.["git-provider"]?.provider,
});
```

`ctx.flowDefaults` is the same source the worker-harness consults for slot resolution (§7); if the runtime context doesn't expose it directly today, the planning step extends `PhaseContext` to include it. No business-logic change.

## 10. Save-time validation

No new warning codes. The existing `computeSaveWarnings` walks `node.secretBindings` and emits `inaccessible_secrets` / `cross_scope_pin` exactly as it does for built-in phases. Because commit-and-push now declares slots via `slotsFromKind`, its bindings participate in the same validation. No code change needed in `flows.ts`.

Two small caveats handled inline:
- If the workflow has no git provider configured, slot list is empty → no bindings to validate → no warnings. Save still succeeds.
- If the user has bound slots from a *previous* git provider (e.g. they switched github → gitlab and `GITHUB_ACCESS_TOKEN` is now an orphan binding), the existing `orphan_secret_binding` warning (added by the custom-phase slots spec) catches it. Two specs converge cleanly.

## 11. Failure modes — quick reference

| Situation | Behavior |
|---|---|
| Save: required slot's auto binding has no visible secret | `200 OK` + `inaccessible_secrets` warning |
| Save: workflow has no git provider configured | no slot rows, no warnings, save succeeds (publish still blocked by the existing git-provider-required check) |
| Save: orphan binding after git-provider switch | `200 OK` + `orphan_secret_binding` warning |
| Run: required slot, no visible match | `MissingSecretsError` before LLM call |
| Run: token wrong/expired/insufficient scope | LLM's `git push` records `pushed: false` with stderr — existing per-repo error path |
| Run: workflow has no git provider | no env injected, push falls back to clone-embedded credentials (today's behavior) |

## 12. Rollout

1. `@journeyman/flow-editor`: add `slotsFromKind?: ProviderKind` to `PhaseDefinition`.
2. `packages/phases/src/repos/commit-and-push.tsx`: set `slotsFromKind: "git-provider"`, flip `requiredSecrets` tab to `"shown"`.
3. `RequiredSecretsTab.tsx`: extend the slot-resolution cascade with the kind-override rule (§6) plus the empty-config hint (§6.1).
4. `@journeyman/core`: extend `CommitPushReposOptions` with `env` + `gitProvider`.
5. `commit-push-repos.ts`: add the `pushTokenEnvName` helper, two prompt lines, and `env` plumbing into the SDK call.
6. `commit-and-push-phase-handler.ts`: pass `ctx.env` and the workflow's git-provider name to the operation.
7. `worker-harness.ts`: implement the `slotsFromKind` branch in slot resolution.
8. Conductor-converter (if needed): ensure `flowDefaults`/`gitProvider` is reachable in the phase context.

No feature flag. Additive on every layer; flows that don't configure a git provider keep working as today.

## 13. Open implementation questions

- **`flowDefaults` reachability in `PhaseContext`.** Worker-harness has access to the workflow definition during slot resolution; whether `PhaseContext` exposes the same to handlers is confirmed during planning. If not, conductor-converter passes `gitProvider` as an explicit field on the phase input.
- **First-slot convention.** §8.2 picks the first slot in a git-provider catalog entry as the push-auth slot. Adequate for github (single slot). When gitlab/bitbucket land, confirm their primary push token is also slot index 0 — otherwise we add a `pushAuthSlot` marker to the catalog entry.
- **Other "borrowed-kind" phases.** `start-feature-branch` runs locally and doesn't need remote auth — no change. If any future phase runs via coding-cli but needs another kind's creds (e.g. a Slack-from-bash phase needing `SLACK_BOT_TOKEN`), it sets `slotsFromKind: "notification-provider"`. No further wiring.
