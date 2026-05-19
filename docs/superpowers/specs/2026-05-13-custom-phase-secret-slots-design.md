# Custom Phase Secret Slots — Design

**Date:** 2026-05-13
**Status:** Draft — design approved in brainstorming, awaiting spec review.
**Builds on:**
- [Custom AI Phases](2026-05-05-custom-ai-phases-design.md) — definition shape, handler, ICodingCLI surface.
- [Custom AI Phases — Tool Configuration](2026-05-06-custom-phase-tools-design.md) — `default_tools`, per-node `tools` override, canonical tool vocabulary.
- [Secret Slots & Bindings](2026-04-30-secret-slots-and-bindings-design.md) — slot/binding model, `resolveBindings`, save-time validation codes.

## 1. Goal

Let custom AI phases declare named **secret slots** the way built-in phases already do, so an author can write a prompt that references `$GITHUB_TOKEN`, `$DEPLOY_API_TOKEN`, etc., and flow authors can bind each slot to a concrete user/org/global secret per workflow node.

At run time the resolved slot values are injected into the Bash tool's child-process environment. The LLM never sees raw token values — it only sees the variable names the prompt mentions.

## 2. Non-goals

- **No prompt substitution of secret values.** `{{secrets.X}}` style interpolation is explicitly out — keeps tokens out of model context, logs, and tool-result traces. Revisit only if a tool that cannot read env (e.g. `web-fetch` headers) creates a real need.
- **No new resolver or storage.** Re-uses `resolveBindings`, the `secrets` table, scopes, encryption, and the existing visible-names endpoint untouched.
- **No auto git-credential wiring.** The phase prompt explicitly instructs the LLM to set up `git config credential.helper` (or equivalent) using the slot it wants. Zero magic.
- **No per-phase tool-level secret scoping.** Every selected tool that can read env sees the full slot-keyed env. Phase authors are responsible for not leaking via `echo`.
- **No CLI-worker support for pinned bindings.** Same constraint the parent slots spec already enforces — flows with pinned bindings fail fast on the CLI worker.

## 3. Mental model

A custom phase's definition declares slots by name. A flow node carries `secretBindings` (Auto or Pinned per slot, same shape built-in phases use). At run time the custom-phase handler asks the existing resolver for a `{ slotName: value }` map and passes it to the provider's `runCustomPrompt` as `env`. The provider plumbs the map into the Bash tool's `spawn` env. The prompt template references `$SLOT_NAME` literally; the shell does the substitution inside the spawned process.

## 4. Data model

### 4.1 `custom_ai_phases.slots`

Migration `packages/migrations/src/sql/021_custom_phase_slots.sql`:

```sql
ALTER TABLE custom_ai_phases
  ADD COLUMN slots jsonb NOT NULL DEFAULT '[]'::jsonb;
```

Shape (re-uses `SecretSlotDef` from `@journeyman/core`):

```ts
slots: Array<{
  name: string;           // SCREAMING_SNAKE_CASE, unique within the phase
  description: string;    // shown next to the row in the editor
  optional?: boolean;     // default false
}>
```

Server-side validation on `POST` / `PATCH /api/custom-phases[/:id]` and the org variants:

- Every `name` matches `^[A-Z][A-Z0-9_]*$`.
- Names are unique within the array.
- `description` non-empty.
- The set of names does not collide with reserved env keys we already inject (none today; future-proof: reject anything starting with `JM_`).

### 4.2 Flow node `secretBindings`

No schema change. The existing `FlowNode.secretBindings: Record<string, SecretBinding>` field already covers per-slot Auto/Pinned bindings. Custom-AI nodes populate it on drop with `{ mode: "auto" }` for every slot declared on the current definition.

## 5. Runtime — custom-phase handler

`packages/orchestrator/src/workers/phases/custom-ai-phase-handler.ts` gains two steps (numbered against the parent custom-phases spec §"Runtime Handler"):

```
3a. const { values } = await resolveBindings({
      pool,
      ctx: runCtx,
      slots: def.slots ?? [],
      bindings: node.secretBindings ?? {},
    });
…
8.  await provider.runCustomPrompt({
      prompt,
      outputMode: def.output_mode,
      outputSchema: def.output_schema,
      cwd,
      mcps,
      skills,
      tools: effective,
      env: values,                  // NEW
    });
```

Behavior, per slot, is exactly what the parent slots spec defines (§6.1):

| Binding | Lookup |
|---|---|
| `{ mode: "pinned", scope: "user", name }` | `(orgId, userId, name)` row |
| `{ mode: "pinned", scope: "org", name }` | `(orgId, name, user_id IS NULL)` row |
| `{ mode: "pinned", scope: "global", name }` | `process.env.JM_GLOBAL_<name>` |
| `{ mode: "auto" }` | walk user → org → global on the slot's name |

Failure modes (unchanged from parent):

- Required slot can't resolve → `MissingSecretsError([slotName])`, run fails before LLM is invoked.
- Optional slot misses → key omitted from `values`; `$SLOT_NAME` is unset inside bash.

If `node.secretBindings` is missing a key the definition declares, the handler treats it as `{ mode: "auto" }` (matches the migration shim in the parent slots spec). If `secretBindings` carries a key the definition no longer declares, the resolver ignores it.

## 6. ICodingCLI surface

`runCustomPrompt` gains one optional field:

```ts
runCustomPrompt(opts: {
  prompt: string;
  outputMode: "none" | "text" | "structured";
  outputSchema?: JSONSchema;
  cwd?: string;
  mcps?: ResolvedMcpInstance[];
  skills?: ResolvedSkill[];
  tools?: CanonicalTool[];
  env?: Record<string, string>;   // NEW — slot-keyed
}): Promise<{ result?: string; structured?: unknown }>
```

### 6.1 Claude provider

The Claude provider plumbs `opts.env` to the Bash tool only. The Claude Agent SDK's `query()` doesn't take a process env directly — it spawns tool processes itself. We inject the env via the SDK's `Bash` tool configuration:

- If the SDK exposes a per-tool env (preferred): set Bash's `env` to `{ ...process.env, ...opts.env }`.
- Otherwise: wrap each Bash invocation in a small helper that re-execs with the slot-keyed env prepended. Implementation detail confirmed during planning by reading [`.claude/sdk.d.ts`](../../.claude/sdk.d.ts).

`web-fetch` and `web-search` do not receive `opts.env` — they're not shell tools and the v1 design does not surface secret values to them.

### 6.2 Other providers

`GeminiProvider`, `CodexProvider`, and `OpenCodeProvider` accept `env` in their `runCustomPrompt` signature and pass it to their shell-tool spawn equivalent. Stubs continue to throw "not implemented" until the adapter lands.

## 7. Editor UX

### 7.1 Definition editor — new "Secrets" pane

Sits between *Tools* and *Defaults* on `/my/custom-phases` and `/admin/custom-phases`:

```
Secrets
───────
Declare credentials this phase needs. Each slot becomes an
environment variable in the Bash tool ($SLOT_NAME).

[ + Add slot ]

  GITHUB_TOKEN                                       [optional ☐] [✕]
  GitHub PAT used for git push and gh API calls.

  DEPLOY_API_TOKEN                                   [optional ☐] [✕]
  Token for the internal deploy API.
```

Inline validation: name must be `SCREAMING_SNAKE_CASE`, unique, and not in the reserved set. The pane is hidden when `default_tools` contains neither `bash` nor any other future env-consuming tool, with an info note: *"Add the `bash` tool to use secret slots."* — this prevents authors from declaring slots that have nowhere to land.

### 7.2 Prompt pane — autocomplete

`{{...}}` autocomplete in the prompt textarea continues to suggest declared **input** names. Slot names are *not* template tokens (no substitution by design) — instead, the pane shows a sidebar reminder:

```
Available env vars in $bash:
  $GITHUB_TOKEN
  $DEPLOY_API_TOKEN
```

Click-to-insert drops `$GITHUB_TOKEN` at the cursor as literal text.

### 7.3 Node config drawer — Secrets section

Below *Tools* in the `custom-ai` node drawer. One row per slot declared on the current definition. Each row uses the **same Auto/Pinned picker** the built-in phase Required Secrets tab uses (parent slots spec §8.2, §8.3, §8.4):

```
GITHUB_TOKEN                                       ⓘ
GitHub PAT used for git push and gh API calls.
[ Auto (Your secrets > Organization > Global)  ▼ ]
✓ Will use: GITHUB_TOKEN from Your secrets
```

Resolution preview, cross-scope warnings, optional-slot indicator, and pinned-but-deleted treatment all match the built-in pattern verbatim. Custom-AI nodes get this for free by mounting the same `RequiredSecretsTab` component.

### 7.4 Schema-break detection (extends parent custom-phases spec)

On flow editor load, the editor diffs `definition.slots` against the flow's saved `node.secretBindings`:

| Diff | Severity | UI |
|---|---|---|
| Required slot added since save | error | red marker on node + on the slot row; blocks run |
| Optional slot added | none | silent; appears with `{ mode: "auto" }` default |
| Slot renamed | error | red marker on the orphaned binding; flagged as "Unknown slot: `<old>`" |
| Slot removed | warning | amber marker; orphan binding ignored at run time |
| Slot's `optional` toggled true → false | error if currently unresolvable |
| Slot's `optional` toggled false → true | none |

Errors block run; warnings do not. Same model as the parent custom-phases spec's input/output schema-break table.

## 8. Workflow-level validation

`computeSaveWarnings` in `packages/api-server/src/routes/flows.ts` already walks `secretBindings` for built-in phases. We extend it to walk custom-AI nodes the same way:

For every `custom-ai` node:

1. Load the referenced `custom_ai_phases` row (already loaded by the catalog merge step).
2. For each `slot` in `def.slots`:
   - Read `binding = node.secretBindings[slot.name] ?? { mode: "auto" }`.
   - **Auto, required**, name not in caller's visible set → `inaccessible_secrets` warning (existing code).
   - **Auto, optional**, name not in visible set → no warning (preview line is informational).
   - **Pinned**, `(scope, name)` not visible to caller → `inaccessible_secrets`.
   - **Pinned**, scope narrower than flow scope → `cross_scope_pin` (existing code).
3. Additionally, if the node carries a `secretBindings` key that is not in `def.slots` → emit a new code:
   ```ts
   { code: "orphan_secret_binding", message: string,
     entries: Array<{ nodeId: string; slot: string }> }
   ```
   Non-blocking. The flow editor surfaces it as a warning marker (§7.4).

Permissive-save / strict-publish behavior is unchanged: save succeeds with warnings; publish/run is blocked while there are errors (schema-break errors from §7.4 dominate).

The same checks run server-side on **publish**, returning the warnings/errors as the publish response so the editor can refuse to flip a flow to "ready" while errors exist.

## 9. Failure modes — quick reference

| Situation | Behavior |
|---|---|
| Save: required slot's auto binding has no visible secret | `200 OK` + `inaccessible_secrets` warning |
| Save: pinned to inaccessible secret | `200 OK` + `inaccessible_secrets` warning |
| Save: pinned scope narrower than flow scope | `200 OK` + `cross_scope_pin` warning |
| Save: node carries binding for a slot no longer declared | `200 OK` + `orphan_secret_binding` warning |
| Publish: any of the above warnings present | publish blocked, warnings returned |
| Edit-time: required slot added since save | red marker, run blocked |
| Run: pinned secret deleted between save and run | `MissingSecretsError`, run fails before LLM call |
| Run: auto + required slot, no visible match | `MissingSecretsError`, run fails before LLM call |
| Run: auto + optional slot, no visible match | `$SLOT_NAME` unset in bash; LLM proceeds |
| Run: phase declares slots but `default_tools` has no env-consuming tool | save-time warning (§7.1); at run the env is built but never reaches a tool |
| CLI worker: any pinned binding in the flow | hard fail with explanatory message (parent slots spec §7.3) |

## 10. Security posture

- Slot values exist in plaintext only inside (a) the worker process memory between resolver and `spawn`, and (b) the spawned Bash child process's env.
- The prompt template, the rendered prompt, the SDK message stream (`logSdkMessage`), and the run-timeline UI all see only the literal `$SLOT_NAME` strings the author wrote. Provided the LLM does not `echo $TOKEN`, no value is logged. We do not attempt to scrub tool-output streams for secret material in v1 — that is a separate hardening task.
- The resolver already enforces caller-scoped lookups (orgId/userId from `runCtx`). A user cannot bind to another user's secret; the visible-names endpoint and the editor's source dropdown reflect the same constraint.
- `process.env` is **not** wholesale merged into the Bash env; only `{ ...process.env, ...opts.env }` in the child process spawn, matching how built-in phases already work post-slots.

## 11. Rollout

1. Migration: add `custom_ai_phases.slots jsonb DEFAULT '[]'`.
2. `@journeyman/custom-phases`: extend zod schemas for `POST` / `PATCH` to accept and validate `slots`. Surface `slots` in the `GET` payloads consumed by the catalog and the editor.
3. Catalog merge (`buildPhaseCatalog`) carries `slots` through into the `PhaseMeta` so the editor can render the per-node binding rows without an extra fetch.
4. Orchestrator handler: call `resolveBindings`, pass `env` into `provider.runCustomPrompt`.
5. `@journeyman/core`: add `env?: Record<string,string>` to `runCustomPrompt` opts.
6. `@journeyman/coding-cli` Claude provider: plumb `env` to the Bash tool. Gemini/Codex/OpenCode accept it in the signature and pass it on (stubs unaffected).
7. Flow editor: new Secrets pane on the definition editor; reuse `RequiredSecretsTab` in the node drawer; sidebar of available `$VAR`s in the prompt pane; schema-break detection extended.
8. API server: extend `computeSaveWarnings` and the publish-validation path; add the `orphan_secret_binding` warning code.

No feature flag. Additive at the data layer; existing custom phases have `slots = []` and behave identically.

## 12. Open implementation questions

- **Bash tool env injection mechanism in Claude SDK.** Confirm during planning whether the Agent SDK's `tools` config accepts per-tool env, or whether we need a wrapper. Falls out of reading [`.claude/sdk.d.ts`](../../.claude/sdk.d.ts) before writing the implementation plan.
- **Reserved-prefix policy.** v1 rejects slot names starting with `JM_`. Worth widening to a small allowlist (e.g. forbid `PATH`, `HOME`, `LD_*`) to reduce footgun risk; default behavior of `{ ...process.env, ...opts.env }` means a slot named `PATH` would shadow the worker's `PATH` inside bash and likely break commands.
- **Telemetry.** The handler already logs `customPhaseId` / `customPhaseName`. We additionally log the resolved slot **names** (not values) and their binding mode (auto/pinned + scope) for run-debugging. Confirm this is acceptable from a privacy posture during planning.
