# Secret Slots & Bindings Design

**Status:** Draft — design approved in brainstorming, awaiting spec review.
**Supersedes:** the `defaultRequiredSecrets` / `optionalSecrets` / `node.requiredSecrets[]` model introduced earlier today in [2026-04-30-workflow-secrets-validation-design.md](2026-04-30-workflow-secrets-validation-design.md). The visible-names endpoint, three-tier resolver, and save-time validation framework from that spec stay; the per-node data shape and the editor tab are replaced.
**Depends on:** [Secrets & User Management](2026-04-28-secrets-and-user-management-design.md) (built — DB, resolver, scopes).

---

## 1. Goal

Give every phase a *named slot* for each credential it needs (e.g. `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`). Per node, the user binds each slot to a concrete value source — either **Auto** (resolver picks from user > org > global by slot name) or **Pinned** (use exactly this `(scope, name)`).

Phase code reads each credential by its slot name, decoupled from whatever the user happened to call their secret.

This closes three problems with the prior model:

1. Users had to guess and type secret names that match what providers hardcoded.
2. Listing N names = "all required" with no way to express "use this one specifically."
3. Resolved values never reached the providers, because providers read `process.env` at startup, not `ctx.env` per call.

## 2. Non-goals

- No changes to secret storage (DB schema, encryption, HTTP routes for CRUD on user/org/global).
- No new scope semantics — user > org > global stays.
- No "any of these will do" fallback alternatives within a single slot.
- No per-slot type system (everything is a string secret in v1).
- No scope-pinning at flow-template time as a separate authoring mode — pinning is per-node only.

## 3. Mental model in one paragraph

A phase declares the *slots* it needs (named, like function parameters). Each slot on each node has a **binding**: either `Auto` (resolver picks the secret named the same as the slot, walking user → org → global), or `Pinned to (scope, name)` (use exactly this secret, no fallback). At run time the orchestrator resolves every binding to a value, builds a `{ slotName: value }` env, and the phase handler reads `ctx.env[slotName]`. Save-time validation flags pinned bindings the running user can't reach.

## 4. Architecture changes

```
+-------------------------+      slots[] declared
| PhaseDefinition         | ------------------------+
|   slots: SlotDef[]      |                         |
+-------------------------+                         v
                                          +---------------------+
+-------------------------+                | Editor              |
| FlowNode (per-node)     |  bindings  --->|  RequiredSecretsTab |
|   secretBindings        | <---------     |  (slot rows + dropdown)
+-------------------------+                +---------------------+
            |
            v
+-------------------------+      resolveBindings(bindings, ctx)
| @journeyman/secrets     | ----------------------------+
|   resolver (extended)   |                             v
+-------------------------+                  +----------------------+
                                             | Phase handler        |
                                             |   reads ctx.env      |
                                             |   keyed by slot name |
                                             +----------------------+
```

## 5. Data model

### 5.1 Slot definition (on `PhaseDefinition`)

```ts
// packages/flow-editor/src/phase-definition.ts
export interface SecretSlotDef {
  /** Slot identifier — what the phase reads at runtime as ctx.env[name].
   *  Convention: SCREAMING_SNAKE_CASE. */
  name: string;
  /** Short, human-friendly explanation. Shown next to the slot in the editor. */
  description: string;
  /** When true, the slot is optional — Auto-mode failing to resolve does
   *  not fail the run, and the phase handler must tolerate undefined. */
  optional?: boolean;
}

export interface PhaseDefinition<TConfig = unknown> {
  // ...existing fields...
  /** Credential slots this phase needs at run time. */
  slots?: SecretSlotDef[];
}
```

`defaultRequiredSecrets` and `optionalSecrets` are removed. `slots` replaces both:
- A required slot was a `defaultRequiredSecrets` entry.
- An optional slot has `optional: true` (replaces `optionalSecrets`).

### 5.2 Binding (on `FlowNode`)

```ts
// packages/core/src/types/flow.types.ts
export type SecretBinding =
  | { mode: "auto" }
  | { mode: "pinned"; scope: SecretScope; name: string };

export interface FlowNode {
  // ...existing fields...
  /** Per-slot binding. Key is the slot name from the phase definition. */
  secretBindings?: Record<string, SecretBinding>;
}
```

`node.requiredSecrets?: string[]` is removed.

**Default** when a node is dropped on the canvas: every slot is `{ mode: "auto" }`. Nothing pinned by default.

### 5.3 Persistence

`secretBindings` rides inside the existing `FlowGraph.nodes[i]` JSON, persisted in `jm_flow_versions.definition` (no migration needed). Update zod schema in `packages/api-server/src/schemas/update-flow.ts` to accept the new shape and reject the old one.

### 5.4 Migration of existing flows

A one-time JSON-level migration in the orchestrator's flow-graph loader converts old `requiredSecrets: [N1, N2]` to:
```ts
secretBindings: {
  N1: { mode: "auto" },
  N2: { mode: "auto" },
}
```
Run on read, not at rest. Old flows keep working with Auto mode for everything.

## 6. Resolver changes

### 6.1 New entry point — `resolveBindings`

```ts
// packages/secrets/src/resolver.ts
export interface ResolveBindingsInput {
  pool: Pool;
  ctx: RunContext;
  bindings: Record<string, SecretBinding>;
  slots: SecretSlotDef[];   // declared by the phase, drives optional-handling
}
export interface ResolveBindingsResult {
  values: Record<string, string>;     // slotName -> resolved value
}
export async function resolveBindings(input: ResolveBindingsInput): Promise<ResolveBindingsResult>;
```

Algorithm per slot:
1. **`mode: "pinned"`** — fetch exactly `(scope, name)`:
   - `scope: "user"` → `WHERE org_id = $1 AND user_id = $2 AND name = $3`
   - `scope: "org"` → `WHERE org_id = $1 AND user_id IS NULL AND name = $2`
   - `scope: "global"` → `process.env.JM_GLOBAL_<name>`
   - Missing → `MissingSecretsError([slot.name])`. No fallback.
2. **`mode: "auto"`** — walk user → org → global on the **slot's name**:
   - First match wins (re-uses existing `resolveSecrets` behavior, scoped to one name).
   - Missing AND `slot.optional !== true` → `MissingSecretsError`.
   - Missing AND `slot.optional === true` → omit from result; phase handler sees `ctx.env[slot.name] === undefined`.
3. Validate every name matches `^[A-Z][A-Z0-9_]*$` before query.

### 6.2 Existing `resolveSecrets(names[])` stays

The old name-list API is still used by the credential-store path for legacy callers, but flow runs migrate to `resolveBindings` (see §7).

## 7. Runtime — closing the provider gap

The current `worker-harness.ts` resolves credentials and merges into `ctx.env`, but providers read `process.env` directly at instantiation time, so user/org-scope values never reach them.

Fix: providers consume `ctx.env` per call, not `process.env` at startup.

### 7.1 `worker-harness.ts` change

After resolving bindings, build the per-call env keyed by slot name and pass it to the handler:
```ts
const resolved = await resolveBindings({ pool, ctx: runCtx, bindings, slots });
const callEnv = { ...resolved.values };  // slot-keyed, no process.env merging

const result = await handler.run(task.inputData, {
  ...,
  env: callEnv,
});
```

`process.env` is no longer pre-merged; the handler must use `ctx.env` exclusively for credentials.

### 7.2 Handler / provider plumbing

Each phase handler currently uses a long-lived provider instance built from startup `process.env`. Switch to per-call construction:

- Handlers receive a **provider factory** instead of a resolved provider.
- The factory accepts the call's env: `factory.create(ctx.env)`.
- Provider constructor reads tokens from the supplied env (e.g. `env.GITHUB_TOKEN` instead of `process.env.GITHUB_ACCESS_TOKEN`).

Concrete change per provider package:
- `@journeyman/git-provider` `GitHubProvider` — accept `{ token: string }` only; remove `tokenEnv` / `process.env` fallbacks.
- `@journeyman/ticket-provider` `GitHubIssuesProvider`, `GitHubProjectsProvider` — same.
- `@journeyman/coding-cli` Claude provider — read `env.ANTHROPIC_API_KEY` if present.

Slot names are the contract:
- `get-ticket` slot `GITHUB_TOKEN` → ticket-provider reads `env.GITHUB_TOKEN`.
- `analyze-repo` slot `ANTHROPIC_API_KEY` (optional) → coding-cli reads `env.ANTHROPIC_API_KEY` if defined, else lets the SDK pick its ambient default.

### 7.3 CLI worker

The CLI worker's `EnvCredentialStore` doesn't have a run context (no DB-backed user/org), so it cannot resolve pinned bindings. It handles flows whose bindings are all `mode: "auto"` and only the global tier is consulted. Pinned bindings → fail fast with a clear "CLI worker can't resolve pinned bindings — run via api-server" error.

## 8. Editor UX

The Required Secrets tab is rebuilt around the slot/binding model. Source of truth: `phaseDef.slots`. Each slot is one row.

### 8.1 Top of tab — collapsible "How this works"

Closed by default. Open shows the resolution rules (Auto vs Pinned, exact name match, fallback order). One-time read; it stays closed on subsequent visits.

### 8.2 Per-slot row

```
GITHUB_TOKEN                                       ⓘ
GitHub PAT used to call the GitHub API.
[ Auto (Your secrets > Organization > Global)  ▼ ]
✓ Will use: GITHUB_TOKEN from Your secrets
```

- **Slot name** in monospace + ⓘ tooltip showing `slot.description`.
- **Description** below the name (small grey text).
- **Source dropdown** — the binding picker (§8.3).
- **Resolution preview** — a one-line note explaining what *will happen at run time given the current visible secrets*.

### 8.3 Source dropdown contents

```
○ Auto (Your secrets > Organization > Global)

Your secrets
  ○ GITHUB_TOKEN
  ○ MY_PAT

Organization
  ○ TEAM_GH_TOKEN

Global
  ○ GITHUB_ACCESS_TOKEN
```

Picking `Auto` → `{ mode: "auto" }`.
Picking a specific entry → `{ mode: "pinned", scope, name }`.

If a tier has zero entries, hide its section entirely.

### 8.4 Resolution preview rules

| Mode | Resolves to | Render |
|---|---|---|
| Auto, name found in user | user value | `✓ Will use: <name> from Your secrets` |
| Auto, name found in org only | org value | `✓ Will use: <name> from Organization` |
| Auto, name in global only | global value | `✓ Will use: <name> from Global` |
| Auto, missing in all tiers, slot required | nothing | `⚠ No secret named <name> in any tier. Run will fail.` |
| Auto, missing, slot optional | nothing | `ℹ Optional. None found — phase will use its own default.` |
| Pinned, secret still exists | that value | `ℹ Pinned to <name> (<scope>). No fallback.` |
| Pinned, secret deleted/inaccessible | nothing | `⚠ Pinned secret <name> (<scope>) is not accessible. Runs will fail.` |

The preview is computed client-side from the visible-names list (§9.1).

### 8.5 Cross-scope warnings

When the flow's scope is broader than the binding's pinned scope, render a warning under that row:

| Flow scope | Pinned to scope | Warning |
|---|---|---|
| `org` | `user` | "This is an organization flow but you pinned a personal secret. Teammates running this flow can't see it." |
| `global` | `user` or `org` | "This is a global flow but you pinned a non-global secret. Other users / orgs running it can't see it." |
| `user` | `user` / `org` / `global` | (no warning — all visible to flow owner) |

Save-time validation emits the same warning in the response so it surfaces on the Validate panel too.

### 8.6 Optional slot indicator

Optional slots show a `(optional)` tag next to the slot name, and the resolution-preview "missing" line stays informational rather than warning.

### 8.7 What's removed

- The freeform combobox from the previous design.
- The "Typically needs / Optionally" hint block at the top — its information is now per-slot, in-context.
- The `defaultRequiredSecrets` / `optionalSecrets` fields on phase definitions.

## 9. API surface changes

### 9.1 Visible names endpoint stays

`GET /api/orgs/:orgId/secrets/_visible-names` already returns `{ names, scoped }`. No change. Editor uses `scoped` for the dropdown grouping; it uses the same data for the per-row preview.

### 9.2 New endpoint — preview resolution (optional, v1.1)

Not in v1. The client computes the preview from `scoped` because we already have everything needed. Server-side preview endpoint can come later if we want server-authoritative previews.

### 9.3 Save-time validation update

`computeSaveWarnings` in [packages/api-server/src/routes/flows.ts](../../packages/api-server/src/routes/flows.ts) is rewritten to walk `secretBindings` instead of `requiredSecrets`:

For each node, for each binding:
- `mode: "auto"` → if name not in visible set, add to `inaccessible_secrets` warning.
- `mode: "pinned"` → if `(scope, name)` is not in the caller's visible set with that exact scope, add to `inaccessible_secrets` warning. Also check cross-scope rule (§8.5) and emit a separate `cross_scope_pin` warning if violated.

Two warning codes:

```ts
export type FlowSaveWarning =
  | { code: "inaccessible_secrets"; message: string; names: string[] }
  | { code: "cross_scope_pin"; message: string; entries: Array<{
      nodeId: string; slot: string; pinnedScope: SecretScope; flowScope: FlowScope;
    }>; };
```

Both are non-blocking — save still succeeds.

## 10. Failure modes — quick reference

| Situation | Behavior |
|---|---|
| Save: any binding references inaccessible secret | `200 OK` + `inaccessible_secrets` warning |
| Save: pinned to narrower scope than flow | `200 OK` + `cross_scope_pin` warning |
| Run: pinned secret missing/deleted | `MissingSecretsError`, run fails before phase |
| Run: auto + required slot, name in no tier | `MissingSecretsError`, run fails |
| Run: auto + optional slot, name missing | `ctx.env[slot]` undefined, phase decides |
| CLI worker: pinned binding | hard fail with explanatory message |
| Migration: old `requiredSecrets` array | converted to all-`auto` bindings on read |

## 11. Rollout

1. **Core types** — add `SecretSlotDef`, `SecretBinding`, update `FlowNode`. Remove `requiredSecrets` field.
2. **Resolver** — add `resolveBindings()` in `@journeyman/secrets`.
3. **Migration shim** — old `requiredSecrets[]` → `secretBindings: { ...auto }` on flow-load.
4. **Phase definitions** — every phase declares `slots`. Drop `defaultRequiredSecrets` / `optionalSecrets`.
5. **Provider plumbing** — each provider accepts a token via constructor opts; handlers build per-call. Remove `process.env` reads.
6. **Worker harness** — call `resolveBindings`; pass slot-keyed env to handler; stop merging `process.env`.
7. **Editor** — rebuild `RequiredSecretsTab` around slot rows + binding picker + preview.
8. **Save-time validation** — port `computeSaveWarnings` to walk bindings, emit two warning codes.
9. **Validate-panel UI** — render new warning codes (extend the existing secret-warnings section).
10. **CLI worker** — emit clear error when a flow has any pinned binding.

Implementation plan (file-by-file, task ordering) is produced separately by the writing-plans skill.

## 12. Open implementation questions

- **Slot name collisions across executor kinds.** A phase that combines a ticket slot and a coding-CLI slot will declare two slots. Names should be globally meaningful (`GITHUB_TOKEN`, `ANTHROPIC_API_KEY`) — confirmed convention, not enforced.
- **Provider constructor compatibility.** Existing provider classes accept `{ token, tokenEnv }` for back-compat. We keep `token`-only path going forward and remove `tokenEnv`. The legacy `EnvCredentialStore` is unaffected by this spec; it lives on for the CLI-worker global-tier-only path.
- **Optional-slot env shape.** When an optional slot doesn't resolve, do we set `ctx.env[name] = undefined` (the phase has to check) or omit the key entirely? Pick **omit** — `if (!ctx.env.X)` works either way, and `ctx.env` only contains real values.

---
