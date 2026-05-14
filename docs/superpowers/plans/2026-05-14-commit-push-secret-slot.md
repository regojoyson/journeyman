# Commit & Push — Provider-Aware Secret Slot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the commit-and-push phase resolve git-host credentials from the workflow's configured git provider via the existing slots/bindings cascade (user → org → global), and inject the resolved token into the bash tool that runs `git push`.

**Architecture:** Add an optional `slotsFromKind?: ExecutorKind` field on `PhaseDefinition`. When set, both the editor and worker-harness derive the slot list from `PROVIDER_CATALOG` keyed by the workflow's provider for that kind (instead of the phase's executor provider). The conductor-converter plumbs a `_kindProviders` map onto every task so worker-harness and handlers can read it. The Claude commit-push operation accepts `env` + `gitProvider`, passes `env` to the SDK's top-level `env` option, and injects a `credential.helper` snippet into the prompt that consumes `$<TOKEN_ENV>` only inside the helper invocation.

**Tech Stack:** TypeScript across `@journeyman/core`, `@journeyman/flow-editor`, `@journeyman/phases`, `@journeyman/orchestrator`, `@journeyman/coding-cli`.

**Spec:** [docs/superpowers/specs/2026-05-14-commit-push-secret-slot-design.md](../specs/2026-05-14-commit-push-secret-slot-design.md)

**Conventions for this plan:**
- **No commits.** Engineer runs `npm run typecheck` only at the very end (Task 9).
- **No unit tests.** Skip TDD steps — implement directly.
- Every code block shows the actual content; no placeholders.
- The spec uses `ProviderKind`; the codebase calls it `ExecutorKind`. **This plan uses `ExecutorKind` everywhere** to match the live types.

---

## File Map

**Modify:**
- `packages/flow-editor/src/phase-definition.ts` — add `slotsFromKind?: ExecutorKind` to `PhaseDefinition`.
- `packages/phases/src/repos/commit-and-push.tsx` — set `slotsFromKind: "git-provider"`, flip `requiredSecrets` to `"shown"`.
- `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx` — extend slot resolution with the `slotsFromKind` rule + empty-config hint.
- `packages/core/src/types/git.types.ts` — extend `CommitPushReposOptions` with `env?` and `gitProvider?`.
- `packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts` — accept `env`, pick the token env-var name from the provider catalog, alter the prompt's push instruction, pass `env` to the SDK.
- `packages/orchestrator/src/flow-json/conductor-converter.ts` — emit `_kindProviders` on every task's `inputParameters`.
- `packages/orchestrator/src/workers/worker-harness.ts` — when `phaseDef.slotsFromKind` is set, look up slots from the kind's provider entry instead of the phase's executor provider.
- `packages/orchestrator/src/workers/phases/commit-and-push-phase-handler.ts` — pass `ctx.env` and the workflow's git-provider name to `commitPushRepos`.

---

## Task 1: Add `slotsFromKind` to `PhaseDefinition`

**Files:**
- Modify: `packages/flow-editor/src/phase-definition.ts`

- [ ] **Step 1: Import `ExecutorKind` and add the new field**

Open the file and confirm the existing imports include something like `import type { SecretSlotDef } from "@journeyman/core"`. Add `ExecutorKind` to that import (creating it if no such import exists):

```ts
import type { SecretSlotDef, ExecutorKind } from "@journeyman/core";
```

Then locate the `slots?: SecretSlotDef[]` field in the `PhaseDefinition` interface and add `slotsFromKind` immediately below it:

```ts
  /** Credential slots this phase needs at run time. Each slot becomes a
   *  row in the editor's "Required secrets" tab and a key in ctx.env. */
  slots?: SecretSlotDef[];

  /** When set, the slot list for this phase is resolved from
   *  PROVIDER_CATALOG keyed by the workflow's configured provider for the
   *  named ExecutorKind, rather than from `slots` or the phase's executor
   *  provider. Used for phases that run on one executor but need credentials
   *  from a different kind (e.g. commit-and-push runs via coding-cli but
   *  needs the workflow's git-provider credentials to push). */
  slotsFromKind?: ExecutorKind;
```

If `ExecutorKind` is not exported from `@journeyman/core`'s public surface, verify by reading `packages/core/src/index.ts`. It is exported via `export type * from "./registries/provider-catalog.ts"` — `ExecutorKind` is declared in that file.

---

## Task 2: Declare `slotsFromKind` on the commit-and-push phase

**Files:**
- Modify: `packages/phases/src/repos/commit-and-push.tsx`

- [ ] **Step 1: Flip the tab visibility and add `slotsFromKind`**

Replace the `tabs` and `slots` block (around line 31–32):

```ts
  // No secret slots — git push uses the embedded credential in the
  // already-cloned repo's `.git/config` (set by clone-repos).
  tabs: { io: "shown", requiredSecrets: "hidden", mcp: "hidden", retry: "shown" },
  slots: [],
```

with:

```ts
  // Slot list comes from the workflow's git-provider entry in PROVIDER_CATALOG
  // (e.g. GITHUB_ACCESS_TOKEN for github). The resolved token is injected as
  // env to the Claude bash tool and consumed by `git push` via an inline
  // credential.helper.
  tabs: { io: "shown", requiredSecrets: "shown", mcp: "hidden", retry: "shown" },
  slots: [],
  slotsFromKind: "git-provider",
```

---

## Task 3: Extend `RequiredSecretsTab` for `slotsFromKind`

**Files:**
- Modify: `packages/flow-editor/src/properties-panel/RequiredSecretsTab.tsx`

- [ ] **Step 1: Add kind-override resolution**

Locate the existing slot resolution block (around line 76–90 in the current file — search for `customSlots` and `providerSlots`). Replace the `slots` computation with the cascade described in the spec §6. Concretely, find this block:

```ts
  const providerSlots = PROVIDER_CATALOG.find(p => p.value === effectiveProvider)?.slots ?? [];

  // ...existing customSlots computation...

  // For custom-ai nodes: union of the static phase def's slots ...
  const slots: SecretSlotDef[] = (() => {
    if (node.phaseType === "custom-ai") {
      const base = phaseDef?.slots ?? [];
      const overrides = new Map(customSlots.map(s => [s.name, s]));
      const merged: SecretSlotDef[] = base.map(s => overrides.get(s.name) ?? s);
      for (const s of customSlots) {
        if (!base.some(b => b.name === s.name)) merged.push(s);
      }
      return merged;
    }
    return phaseDef?.slots?.length ? phaseDef.slots : providerSlots;
  })();
```

Add the kind-override computation just before it, and update the fallback:

```ts
  const providerSlots = PROVIDER_CATALOG.find(p => p.value === effectiveProvider)?.slots ?? [];

  // Kind-override slots: when the phase declares `slotsFromKind`, look up the
  // slot list from the workflow's catalog entry for that kind (e.g. the
  // git-provider). Lets a coding-cli phase borrow credentials from a different
  // provider kind without hardcoding slot names.
  const slotsFromKind = phaseDef?.slotsFromKind;
  const kindProvider = slotsFromKind
    ? flow.defaults?.executorConfig?.[slotsFromKind]?.provider
    : undefined;
  const kindOverrideSlots: SecretSlotDef[] = slotsFromKind && kindProvider
    ? (PROVIDER_CATALOG.find(p => p.kind === slotsFromKind && p.value === kindProvider)?.slots ?? [])
    : [];

  // ...existing customSlots computation stays here unchanged...

  const slots: SecretSlotDef[] = (() => {
    if (node.phaseType === "custom-ai") {
      const base = phaseDef?.slots ?? [];
      const overrides = new Map(customSlots.map(s => [s.name, s]));
      const merged: SecretSlotDef[] = base.map(s => overrides.get(s.name) ?? s);
      for (const s of customSlots) {
        if (!base.some(b => b.name === s.name)) merged.push(s);
      }
      return merged;
    }
    if (kindOverrideSlots.length > 0) return kindOverrideSlots;
    return phaseDef?.slots?.length ? phaseDef.slots : providerSlots;
  })();
```

- [ ] **Step 2: Empty-config hint**

Find the existing empty-state block (search for the early return that renders "This phase doesn't need any secrets."). Add a special case for the `slotsFromKind` case so the user knows *why* it's empty.

Replace:

```ts
  if (slots.length === 0) {
    return (
      <div className="je-props__field">
        <div style={{ color: "#888", fontSize: 11, fontStyle: "italic" }}>
          This phase doesn't need any secrets.
        </div>
      </div>
    );
  }
```

with:

```ts
  if (slots.length === 0) {
    if (slotsFromKind && !kindProvider) {
      return (
        <div className="je-props__field">
          <div style={{ color: "#f0c97a", fontSize: 11 }}>
            This phase needs the workflow's <code>{slotsFromKind}</code> credentials.
            Pick a {slotsFromKind} in Workflow settings to see the required slot.
          </div>
        </div>
      );
    }
    return (
      <div className="je-props__field">
        <div style={{ color: "#888", fontSize: 11, fontStyle: "italic" }}>
          This phase doesn't need any secrets.
        </div>
      </div>
    );
  }
```

---

## Task 4: Add `env` + `gitProvider` to `CommitPushReposOptions`

**Files:**
- Modify: `packages/core/src/types/git.types.ts`

- [ ] **Step 1: Extend the option type**

Locate the `CommitPushReposOptions` type (around line 179). Replace:

```ts
export type CommitPushReposOptions = SessionOptions & {
  repos: string | string[] | CommitPushEntry | CommitPushEntry[];
  issue?: string;
  pattern?: string;
  prSummaryStyle?: "brief" | "detailed";
  signal?: AbortSignal;
  model?: string;
  onLog?: CodingCliLogFn;
  agentLogLevel?: AgentLogLevel;
};
```

with:

```ts
export type CommitPushReposOptions = SessionOptions & {
  repos: string | string[] | CommitPushEntry | CommitPushEntry[];
  issue?: string;
  pattern?: string;
  prSummaryStyle?: "brief" | "detailed";
  signal?: AbortSignal;
  model?: string;
  onLog?: CodingCliLogFn;
  agentLogLevel?: AgentLogLevel;
  /** Resolved slot-keyed env values. Passed to the Claude SDK's top-level
   *  `env` option so the Bash tool inherits them when running `git push`. */
  env?: Record<string, string>;
  /** The workflow's configured git provider (e.g. "github"). Lets the
   *  operation pick the right token env-var name to reference in the
   *  prompt's credential.helper snippet. Unset → falls back to plain
   *  `git push` (today's behavior). */
  gitProvider?: string;
};
```

---

## Task 5: Update the Claude `commit-push-repos` operation

**Files:**
- Modify: `packages/coding-cli/src/providers/claude/operations/commit-push-repos.ts`

- [ ] **Step 1: Add the token-env-name helper**

At the top of the file, just below the imports, add:

```ts
import { PROVIDER_CATALOG } from "@journeyman/core";

/** Convention: the first slot in a git-provider's catalog entry is the
 *  push-auth token slot. Adequate for github (single slot). When other
 *  providers land, confirm their push token is also slot index 0 — otherwise
 *  introduce an explicit `pushAuthSlot` field on ProviderEntry. */
function pushTokenEnvName(gitProvider: string | undefined): string | undefined {
  if (!gitProvider) return undefined;
  const entry = PROVIDER_CATALOG.find(p => p.kind === "git-provider" && p.value === gitProvider);
  return entry?.slots?.[0]?.name;
}
```

- [ ] **Step 2: Thread the token env-var name through `buildPrompt`**

Find the `buildPrompt` signature:

```ts
function buildPrompt(
  entries: NormalizedEntry[],
  pattern: string,
  prSummaryStyle: "brief" | "detailed"
): string {
```

Add a fourth parameter:

```ts
function buildPrompt(
  entries: NormalizedEntry[],
  pattern: string,
  prSummaryStyle: "brief" | "detailed",
  tokenEnvName: string | undefined,
): string {
```

- [ ] **Step 3: Alter step 10 of the prompt to use the credential helper**

Inside `buildPrompt`, find the step-10 push instruction (it starts with `"10. Push the branch, handling the case where it has no upstream yet:",`). Locate the existing first sub-bullet:

```ts
    "    - First try `git -C <repoDir> push origin <branch>`.",
```

Replace **just that line** with a conditional that uses the credential helper when `tokenEnvName` is set, and keeps the plain push otherwise:

```ts
    ...(tokenEnvName
      ? [
          `    - First try push using the host token from env. The token is`,
          `      consumed only inside the credential.helper invocation; it never`,
          `      lands in .git/config or in process listings:`,
          `        git -C <repoDir> -c credential.helper='!f() { echo username=x-access-token; echo "password=$${tokenEnvName}"; }; f' push origin <branch>`,
        ]
      : [
          "    - First try `git -C <repoDir> push origin <branch>`.",
        ]),
```

The next sub-bullet — the `-u` retry — also needs to use the helper when `tokenEnvName` is set. Locate:

```ts
    "    - If it fails because the branch has no upstream / does not exist on",
    "      remote (stderr mentions 'has no upstream branch', 'set-upstream',",
    "      'src refspec ... does not match any', or similar), retry with",
    "      `git -C <repoDir> push -u origin <branch>` to create and track it.",
```

Replace the last of those four lines (the one with the backtick command) with:

```ts
    ...(tokenEnvName
      ? [
          `      \`git -C <repoDir> -c credential.helper='!f() { echo username=x-access-token; echo "password=$${tokenEnvName}"; }; f' push -u origin <branch>\` to create and track it.`,
        ]
      : [
          "      `git -C <repoDir> push -u origin <branch>` to create and track it.",
        ]),
```

Because step 10 is built from a `return [ ... ].join("\n")` array, the spread-in-conditional lines fit cleanly. Verify by reading the surrounding `return [ ... ]` block; if any of those existing strings have changed wording, match the surrounding text exactly when adapting.

- [ ] **Step 4: Pass the new args through `commitPushRepos`**

Locate the `commitPushRepos` function body. The call to `buildPrompt(entries, pattern, prSummaryStyle)` becomes:

```ts
  const tokenEnvName = pushTokenEnvName(opts.gitProvider);
```

placed just before the existing `for await (const msg of query({ ... }))` loop, and the prompt is built via:

```ts
    prompt: buildPrompt(entries, pattern, prSummaryStyle, tokenEnvName),
```

inside the `query({ ... })` argument.

- [ ] **Step 5: Pass `env` to the SDK**

In the same `query({ options: { ... } })` block, add the env injection alongside the existing options. Find:

```ts
    options: {
      tools: ["Bash"],
      allowedTools: ["Bash"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 40,
      settingSources: [],
      settings: { allowedMcpServers: [] },
      outputFormat: { type: "json_schema", schema: OUTPUT_SCHEMA },
      ...(opts.model ? { model: opts.model } : {}),
      ...(controller !== undefined ? { abortController: controller } : {}),
      ...queryOption,
    },
```

and add the env line:

```ts
    options: {
      tools: ["Bash"],
      allowedTools: ["Bash"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      maxTurns: 40,
      settingSources: [],
      settings: { allowedMcpServers: [] },
      outputFormat: { type: "json_schema", schema: OUTPUT_SCHEMA },
      ...(opts.env && Object.keys(opts.env).length ? { env: opts.env } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(controller !== undefined ? { abortController: controller } : {}),
      ...queryOption,
    },
```

---

## Task 6: Plumb `_kindProviders` through the conductor-converter

**Files:**
- Modify: `packages/orchestrator/src/flow-json/conductor-converter.ts`

- [ ] **Step 1: Emit `_kindProviders` on every task input**

Locate the `inputParameters` IIFE inside the `task` construction (around line 218–230). Find:

```ts
      inputParameters: (() => {
        const bindings = resolvedNode.secretBindings ?? {};
        return {
          ...(resolvedNode.config ?? {}),
          ...resolveInputs(resolvedNode.inputs),
          provider: resolvedNode.executorConfig?.provider,
          retry: resolvedNode.retry ?? {},
          secretBindings: bindings,
          ...(resolvedNode.model ? { model: resolvedNode.model } : {}),
          _flowDefaultSources: defaultSources,
          workflowInstanceId: "${workflow.input.workflowInstanceId}",
          startedByUserId: "${workflow.input.startedByUserId}",
          startedByOrgId: "${workflow.input.startedByOrgId}",
          workflowId: "${workflow.input.workflowId}",
        };
      })(),
```

Find the variable in the outer scope that holds the workflow definition. Search the function body for `flow.defaults` or `definition.defaults` — the converter holds the workflow graph as a parameter (likely named `flow` or `definition`; confirm by reading the function signature 10–30 lines above). Let `<flowVar>` be that name.

Add `_kindProviders` to the returned object:

```ts
      inputParameters: (() => {
        const bindings = resolvedNode.secretBindings ?? {};
        const kindProviders: Record<string, string> = {};
        const ec = <flowVar>.defaults?.executorConfig;
        if (ec) {
          for (const [kind, cfg] of Object.entries(ec)) {
            if (cfg?.provider) kindProviders[kind] = cfg.provider;
          }
        }
        return {
          ...(resolvedNode.config ?? {}),
          ...resolveInputs(resolvedNode.inputs),
          provider: resolvedNode.executorConfig?.provider,
          retry: resolvedNode.retry ?? {},
          secretBindings: bindings,
          ...(resolvedNode.model ? { model: resolvedNode.model } : {}),
          _flowDefaultSources: defaultSources,
          _kindProviders: kindProviders,
          workflowInstanceId: "${workflow.input.workflowInstanceId}",
          startedByUserId: "${workflow.input.startedByUserId}",
          startedByOrgId: "${workflow.input.startedByOrgId}",
          workflowId: "${workflow.input.workflowId}",
        };
      })(),
```

Replace `<flowVar>` with the actual parameter name (e.g. `flow` or `this.flow` or `def`). If the converter is a class and the workflow lives on `this`, use `this.<field>`.

---

## Task 7: Worker-harness — `slotsFromKind` slot resolution

**Files:**
- Modify: `packages/orchestrator/src/workers/worker-harness.ts`

- [ ] **Step 1: Extend slot resolution**

Locate the existing slot-resolution block (the one wrapped in `try { … } catch { … }` after `declaredBindings` is extracted, around line 140–170 in the current file). Find:

```ts
      const phaseDef = this.deps.registry.get(phaseType);
      const phaseKind = kindForPhaseType(phaseType);
      const provider = (phaseInput as { provider?: string }).provider;
      const providerSlots = phaseKind
        ? (PROVIDER_CATALOG.find(p => p.value === provider && p.kind === phaseKind)?.slots ?? [])
        : [];
      const phaseSlots = (phaseDef as unknown as { slots?: Array<{ name: string; optional?: boolean }> })?.slots ?? [];
      const slots = phaseSlots.length > 0 ? phaseSlots : providerSlots;
```

Replace with:

```ts
      const phaseDef = this.deps.registry.get(phaseType);
      const phaseKind = kindForPhaseType(phaseType);
      const provider = (phaseInput as { provider?: string }).provider;
      const providerSlots = phaseKind
        ? (PROVIDER_CATALOG.find(p => p.value === provider && p.kind === phaseKind)?.slots ?? [])
        : [];
      const phaseSlots = (phaseDef as unknown as { slots?: Array<{ name: string; optional?: boolean }> })?.slots ?? [];

      // Kind-override: when the phase declares `slotsFromKind`, look up the
      // slot list from the workflow's catalog entry for that kind, not the
      // phase's executor provider. The conductor-converter passes the
      // workflow's per-kind providers as `_kindProviders`.
      const slotsFromKind = (phaseDef as unknown as { slotsFromKind?: string }).slotsFromKind;
      const kindProviders =
        (phaseInput as { _kindProviders?: Record<string, string> })._kindProviders ?? {};
      const kindOverrideSlots = slotsFromKind && kindProviders[slotsFromKind]
        ? (PROVIDER_CATALOG.find(p => p.kind === slotsFromKind && p.value === kindProviders[slotsFromKind])?.slots ?? [])
        : [];

      const slots = kindOverrideSlots.length > 0
        ? kindOverrideSlots
        : (phaseSlots.length > 0 ? phaseSlots : providerSlots);
```

- [ ] **Step 2: Update the resolving-secrets log line**

Just below this, find the existing log line:

```ts
      log.info({
        workflowInstanceId, nodeId, phaseKind, provider,
        slots: slots.map(s => s.name),
        bindings: Object.fromEntries(Object.entries(declaredBindings).map(([k, v]) => [k, v.mode])),
        userId: userId ?? "(null)",
        orgId: orgId ?? "(null)",
      }, "resolving secrets");
```

Add the slot-source for diagnostics:

```ts
      log.info({
        workflowInstanceId, nodeId, phaseKind, provider,
        slotsFromKind: slotsFromKind ?? null,
        kindProvider: slotsFromKind ? (kindProviders[slotsFromKind] ?? null) : null,
        slots: slots.map(s => s.name),
        bindings: Object.fromEntries(Object.entries(declaredBindings).map(([k, v]) => [k, v.mode])),
        userId: userId ?? "(null)",
        orgId: orgId ?? "(null)",
      }, "resolving secrets");
```

---

## Task 8: Handler — pass `env` + `gitProvider` to the operation

**Files:**
- Modify: `packages/orchestrator/src/workers/phases/commit-and-push-phase-handler.ts`

- [ ] **Step 1: Read `_kindProviders` from input and pass through**

Find the existing `coding.commitPushRepos({ ... })` call. Replace:

```ts
    const result = await coding.commitPushRepos({
      repos,
      issue,
      pattern,
      sessionId: ctx.workflowInstanceId,
      signal: ctx.signal,
      ...(agentLogLevel !== "none" ? { onLog: ctx.log, agentLogLevel } : {}),
    });
```

with:

```ts
    const kindProviders =
      (input as { _kindProviders?: Record<string, string> })._kindProviders ?? {};
    const gitProvider = kindProviders["git-provider"];

    const result = await coding.commitPushRepos({
      repos,
      issue,
      pattern,
      sessionId: ctx.workflowInstanceId,
      signal: ctx.signal,
      env: ctx.env,
      ...(gitProvider ? { gitProvider } : {}),
      ...(agentLogLevel !== "none" ? { onLog: ctx.log, agentLogLevel } : {}),
    });
```

---

## Task 9: Typecheck

- [ ] **Step 1: Run the workspace typecheck**

```bash
npm run typecheck
```

Expected: clean.

Likely failure points and their fixes:
- `ExecutorKind` not imported in `phase-definition.ts` → fix the import in Task 1.
- `CommitPushReposOptions.env` not accepted by another `commitPushRepos` caller (e.g. the OpenCode provider's stub) → add `env?: Record<string,string>` to its signature, or simply accept `opts` of the new type without destructuring `env` (the stubs already use `_opts`).
- `_kindProviders` typed as `Record<string,string>` clashing with `string | undefined` in conductor: ensure the entries pushed into `kindProviders` are only when `cfg?.provider` is truthy (the code in Task 6 already guards this).
- Read-only flow defaults: if `<flowVar>.defaults` is `Readonly<...>`, the for-of loop still works because we only read.

---

## Self-Review Summary

- **Spec §1 (goal):** Task 2 declares the slot via `slotsFromKind`; Task 7 makes the runtime resolve it; Task 5/8 inject the token into bash. ✓
- **Spec §2 (non-goals):** No clone-repos changes; only commit-push touched. ✓
- **Spec §4.1 (`slotsFromKind` field):** Task 1. ✓
- **Spec §4.2 (no FlowNode change):** Confirmed — no edits to `FlowNode.secretBindings`. ✓
- **Spec §5 (phase def change):** Task 2. ✓
- **Spec §6 (editor cascade + empty-config hint):** Task 3 steps 1 + 2. ✓
- **Spec §7 (worker-harness):** Task 7. Spec referenced `_flowDefaults`; the plan uses a more focused `_kindProviders` map (carries only what's needed for slot lookup + handler routing). Equivalent in behavior. ✓
- **Spec §8 (options + prompt + SDK env):** Task 4 (options), Task 5 (helper, prompt, env). ✓
- **Spec §9 (handler):** Task 8. ✓
- **Spec §10 (save-time validation):** No code change — existing `computeSaveWarnings` already walks `node.secretBindings`. The custom-phase `orphan_secret_binding` warning also catches stale bindings after a git-provider switch. ✓
- **Spec §11 (failure modes):** Covered by existing resolver + LLM-side push error path; no new code. ✓
- **Spec §12 (rollout):** Task ordering matches. ✓
- **Spec §13 (open questions):** First-slot convention noted inline in Task 5 Step 1 ("Adequate for github (single slot)…"). `flowDefaults` reachability resolved by Tasks 6 + 8 via the `_kindProviders` map. ✓
