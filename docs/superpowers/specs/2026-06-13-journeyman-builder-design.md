# Journeyman Builder — Design Spec

**Date:** 2026-06-13
**Status:** Draft — under active design review (refined through five flow dry-tests)
**Author:** Samuel Rego

## What this means in plain words

Today, building anything in Journeyman is manual: you click through the UI to
create custom steps, register MCPs and skills, set up a sandbox, and wire a
workflow graph node by node. That's hard for developers who don't know the tool.

The **Builder** is one page where you type a goal in plain English — *"review
every PR on my repo for security problems and leave a comment"* — and an AI
assistant interviews you, then hands back a **ready-to-use workflow** (plus any
new custom steps it needed to create). You look it over, click **Apply**, and it
appears as a normal draft flow in your existing editor. Nothing runs until you
decide to run it.

The assistant does the creative thinking (what steps, what prompts, which of
your existing MCPs/skills to use). A deterministic piece of code does the fiddly
wiring (node ids, edges, input references) so the connections are always
correct. Everything it produces passes the **same validation gate** as a
hand-built flow, so "the AI built it" still means "production-ready."

## Goal & audience

A single conversational page that lets a developer **unfamiliar with Journeyman**
turn a natural-language goal into a complete, validated workflow. Target
usecases are open-ended (development end-to-end, QA, code review, an SRE agent,
etc.) — the assistant is general, not template-locked.

## Scope (v1)

**In scope — what we *build* (the feature itself):**
- **The agent's instructions** — the static system prompt (role, intent
  contract, custom-step authoring guidance, the behavioral rules), the
  dynamic-context serializers (live catalog / providers / node-types / inventory
  → prompt text), the intent/`BuildPlan` structured-output schema, the read-tool
  definitions, and the prompt-assembly that wires them into the LLM call. This is
  the heart of the Builder — see "Builder instructions & prompt strategy". Without
  it the LLM can do nothing.
- The deterministic assembler, the apply executor, the session store, the API,
  and the page (detailed in their sections).

**In scope — what the assistant then *builds for the user*:**
- The workflow graph (nodes, edges, input/output wiring, branch conditions) —
  **using only step types that exist in the catalog** (the assembler never
  invents a step type; see "No invented steps" below).
- New custom-AI steps (prompt template, input/output fields, tool selection).
- The **start trigger(s)** — *one or more* of `trigger-manual` (run button),
  `trigger-webhook` (external event), `trigger-human` (in-app form). A flow may
  have several (e.g. start by button *or* by event); the assembler can wire both
  or just one. For webhooks it also builds `listensFor`, the `inputsMapping`
  (JSONPath → workflow input), and matching `inputDefs`. The webhook *record* is
  a selectable prerequisite, not built (see gaps).
- **Mid-flow pause points** — optional, placed *inside* the flow where it should
  stop and wait:
  - `human-task` — pause for a person to act/approve (e.g. "after the MR is
    ready, wait for a human to review the code" before continuing).
  - `webhook-wait` — pause until an external signal arrives (e.g. "wait for CI
    to finish" / "wait for deploy approval"), then continue. A `webhook-wait`
    also needs a webhook record (selectable prerequisite or a `webhook` gap).
  Both, either, or neither can appear, wherever the goal calls for it.

**In scope — the assistant *selects* (never creates), and flags gaps:**
- MCP instances, skill packages, sandboxes, provider connections
  (git/ticket/notification credentials), and **webhooks** — chosen from what the
  user already has. When something needed doesn't exist, it is reported as a
  **gap** pinned to the step(s) that need it, with a pointer to the existing
  config UI — not silently invented.
- A **capability gap** is reported when the goal needs an action that *no
  catalog step covers* (e.g. "fetch a PR's diff" — there is no diff step). The
  assistant either routes the action through a custom-AI step using tools/an MCP
  (e.g. a GitHub MCP, or `gh` in the sandbox), or reports it as a capability gap
  rather than fabricating a step.

**Autonomy:** Draft → review → apply. The assistant proposes a fully validated
plan; the user reviews and clicks Apply, which creates the entities via the
existing create APIs as a **draft flow**. The assistant never publishes and
never starts a run in v1.

**Out of scope (v2+):**
- Creating MCPs / skills / sandboxes from the conversation (external
  side-effects: connection tests, git installs, infra provisioning).
- Auto-publish and autonomous run-from-chat.
- Multi-user collaboration on a single builder session.

**Platform limitations the Builder works around (deferred fixes):** scheduled/cron
triggers, true for-each/fan-out over a collection, and richer list filters are not
supported by Journeyman today; the Builder flags these and explains the workaround
rather than faking them. Tracked in
[journeyman-builder-future-todo.md](journeyman-builder-future-todo.md).

## Architecture

Generation strategy is a **hybrid**: a tool-using agent for intent, clarifying
questions, and selecting existing entities; a **deterministic assembler** for
the mechanical graph wiring; validation through the **existing**
`POST /workflows/validate` gate before anything is shown or applied.

**Build only on what is real and implemented.** Many pieces of Journeyman exist
in name but are stubs or reserved-not-yet-built. The Builder must never propose
anything not confirmed *real* by an authoritative source, and every "not yet"
must produce an honest message (steer to a working alternative, or flag a
`not-implemented` gap). The authoritative sources — and what is *not real today*:

| Concern | Source of truth | Not real today |
|---|---|---|
| Step types | the step catalog (`listStepCatalog`) | the catalog *is* the truth |
| **Providers** (coding / git / ticket / notification) | `provider-catalog.ts` → `implemented: boolean` (`implementedProvidersForKind()`) | Slack, GitLab, Linear, Monday, Gemini, Codex |
| **Specific operations** within an otherwise-real provider | a maintained **unsupported-operations list** (see below) | Jira `transitionIssue` + `commentOnIssue` (throw despite Jira's flag being `true`) |
| **Node types** (loop, if, gateway, timer, wait…) | the converter (`conductor-converter.ts`) — NOT the stale comment in `flow.types.ts` | only `retry-block`, `try-catch` |
| **Edge types & policy fields** | the converter (what it actually *honors*) — NOT the type system | the `"error"` edge type and `RetryPolicy.onFailure` are **declared but ignored** by the converter |
| Webhook presets | preset files | `generic` has no payload schema (see input-mapping note) |

**A provider can be *half*-implemented.** The dev/QA dry-test found Jira is
marked `implemented: true`, yet `transitionIssue` and `commentOnIssue` still
`throw "...not implemented"` — and those are exactly the steps a dev→QA handover
needs. The per-provider boolean is therefore *necessary but not sufficient*.

**The type system can advertise features the engine ignores.** The release
dry-test found the `"error"` edge type and `RetryPolicy.onFailure` exist in the
types but the converter never honors them — a failure-handler branch drawn with
an `"error"` edge would *silently never fire*. So the deny-list and the
"is-it-real?" check extend beyond steps/providers/nodes to **edge types and
policy fields**: the Builder must never wire a construct the engine doesn't
actually run, even when the type system allows it. Truth = what the converter
honors, not what the types permit.

**Decision (chosen approach):** keep the per-provider `implemented` boolean, and
add a small **maintained deny-list of specific unsupported operations** (by
provider + method, mapped to the step types that use them) that the Builder
consults in addition to the boolean. A step whose underlying operation is on the
deny-list is treated like any other unavailable thing: steer to an alternative or
raise a `not-implemented` gap with an honest message — never built into a plan
that would throw at run time. The list lives next to the provider catalog so it
is updated in the same place when a method is finished.

Hard rules for the assembler/agent:
- Only emit step types in the catalog (the dry-test found "fetch PR diff" has no
  step → route via a custom-AI step or a `capability` gap).
- Only emit node types the converter implements. **Loops, branching (`if` /
  `gateway-xor` / conditional edges), timers, `subflow`, `human-task`,
  `webhook-wait` ARE supported and may be used.** Only `retry-block` and
  `try-catch` are off-limits.
- A built-in/provider step is only proposed when (a) its provider is
  `implemented: true` **and** (b) the specific operation it uses is not on the
  unsupported-operations deny-list. Otherwise prefer an implemented alternative
  (e.g. Console instead of Slack; comment on the **PR** instead of the Jira issue)
  and say so, or raise a `not-implemented` gap. This catches both the SRE trap
  (`SlackProvider.send`) and the dev/QA trap (Jira `transitionIssue` /
  `commentOnIssue`), where a step *validates* but throws at run time.

> Code-smell noted for separate cleanup: `flow.types.ts`'s comment claims
> gateway/loop/timer/etc. are rejected as "not yet supported," but the converter
> implements them. The comment is stale; the converter is authoritative.

**Validating a plan that contains new steps.** `POST /workflows/validate`
currently resolves referenced custom steps from the database by id and *fails*
if one isn't found (`flows.ts:loadCustomStepShapes`,
`validate-ref-shape.ts`). Because a plan's custom steps don't exist until Apply,
the endpoint is **extended with an optional `proposedCustomSteps` field**: an
array of inline custom-step shapes that are merged into the resolution map for
the duration of the validation call only (no persistence). This lets a full plan
— new steps included — pass the *same* validation gate before Apply, preserving
the "AI-built passes the identical bar" guarantee. This endpoint change is a
required dependency of the feature.

### New package: `@journeyman/builder` (backend)

Houses the agent loop, its tools, the assembler, the plan model, the apply
executor, and the session store. It calls the existing entity create/validate
endpoints — it does not reach into other packages' databases (except its own
`jm_builder_sessions` table).

### LLM layer (provider-agnostic, env-configured)

A single "brain" configured purely via environment variables — no DB coupling,
no per-user model selection in v1:

| Env var | Purpose |
|---|---|
| `BUILDER_LLM_PROVIDER` | Provider id (e.g. `anthropic`, `openai`, `openai-compatible`) |
| `BUILDER_LLM_MODEL` | Model id |
| `BUILDER_LLM_API_KEY` | API key for the builder feature only |
| `BUILDER_LLM_BASE_URL` | Optional, for openai-compatible / self-hosted endpoints |

Implemented over a provider-agnostic AI SDK (aligns with the existing
`2026-06-09-aisdk-provider-design.md` direction). Supports streaming, tool
calling, and structured output. If unconfigured, the page shows a clear
operator-facing message.

### Agent tools (read + dry-run only — no write tools)

The agent can read the user's inventory and dry-run a plan, but can **never**
write directly. All writes happen server-side in the Apply executor.

- `listStepCatalog` — built-in step types with their input/output schemas.
  **Authoritative**: the assembler may use no step type absent from this list.
- `listMyCustomSteps` — the user's existing custom-AI steps (scoped).
- `listMyMcps`, `listMySkills`, `listMySandboxes` — the user's current inventory.
- `listMyWebhooks`, `listWebhookPresets` — existing webhooks and the preset
  catalog (e.g. `github`, `github-issues`, `generic`), so the agent can configure
  a `trigger-webhook` / `webhook-wait` and its `inputsMapping`, or flag a gap.
- `listProviders` — the provider catalog with the `implemented` flag, so the
  agent knows which git/ticket/notification/coding providers actually work
  (Slack/GitLab/Linear/Monday/Gemini/Codex are `false` today) and steers around
  stubs or raises a `not-implemented` gap.
- `listSupportedNodeTypes` — the node types the converter actually implements
  (authoritative over the stale `flow.types.ts` comment), so the assembler may
  use loops/branching/timers/waits but never `retry-block` / `try-catch`.
- `validatePlan` — wraps the extended `POST /workflows/validate` (passing
  `proposedCustomSteps`) for dry-run feedback on the full plan.

### Builder instructions & prompt strategy

The LLM is useless without instructions; authoring them is the core build. There
are **two kinds**, passed differently.

**1. Static instructions — the system prompt (authored by us, in the package).**
Stable across all builds:
- **Role & intent contract** — "turn a goal into a `BuildPlan`; you express
  *intent* (which step, which output feeds which input), you do **not** write
  graph JSON, reference strings, or JSONPath — the assembler does." This is what
  keeps the LLM in its lane.
- **Custom-step authoring guidance** — how to write a good `promptTemplate` and
  define `inputFields`/`outputFields`/tools. (The Builder LLM is *writing a prompt
  for another AI* — the custom-ai step — so this is meta-prompting.)
- **The behavioral rules** — the "Behavioral rules" section below is the source
  text: reuse-before-create, status mapping, commit+push, failure-handling
  options, risk surfacing, no-invented-steps, capability gaps, ask-don't-guess.
- **Conversation style** — clarifying questions one at a time; how to present
  gaps and choices.

**2. Dynamic context — injected per build (generated, never hardcoded).**
The "what exists right now" knowledge, kept out of the static prompt so new steps
need no prompt change (see Extensibility):
- live **step catalog** (+ I/O schemas), **provider list** (+ `implemented` +
  deny-list), **supported node types**, **webhook presets**, and the user's
  **inventory** (custom steps, MCPs, skills, sandboxes, webhooks).
- Delivered as a mix of a **pre-injected compact snapshot** (first message, to cut
  round-trips) and **on-demand tool calls** (the read tools above) for details.

**How it's passed to the AI SDK:** `system` = the static prompt (1);
`tools` = the read-tool schemas; structured-output `schema` = the intent /
`BuildPlan` shape (so output is constrained and validated, same `json_schema`
discipline the codebase already uses); a context message carries the dynamic
snapshot (2).

**What must be built for this:** the system-prompt text, the dynamic-context
**serializers** (catalog/providers/node-types/inventory → prompt text), the
intent/`BuildPlan` output schema, the read-tool definitions, and the
prompt-assembly that composes them. The behavioral rules and the schemas already
exist (as design + in the codebase); the prompt and serializers are greenfield.

### Deterministic assembler / normalizer

The agent expresses **intent** ("node B's `issue` input is fed by node A's
`ticket` output; branch to node C when label == security"). The assembler:
- assigns node ids and layout positions,
- creates edges (including branch conditions/labels),
- emits the correct reference syntax (`@token` / `${}`) from catalog
  input/output schemas,
- builds the **trigger node(s)** — one or more of manual / webhook / form; for
  `trigger-webhook` it produces `listensFor`, the `inputsMapping` (JSONPath into
  the preset's payload → workflow input), and the matching `inputDefs`, kept
  consistent so publish-time trigger validation passes,
- builds **mid-flow pause nodes** where intent calls for them — `human-task`
  (with its prompt/assignee shape) and `webhook-wait` (with its event filter and
  the webhook it waits on) — and wires the edges so the flow resumes correctly
  after the pause.

This is the source of wiring correctness — the LLM never hand-writes graph JSON,
reference strings, or JSONPath. It only names intent; the assembler emits syntax,
and only ever from real catalog step types.

### Apply executor (server-side, ordered, with rollback)

Given an approved plan:
0. Re-validate the full plan server-side (`/workflows/validate` with
   `proposedCustomSteps`) and confirm no *required* gaps remain; abort if either
   fails.
1. Create new custom steps; capture returned ids.
2. Rewrite the workflow graph to reference the new step ids.
3. `POST /workflows` as a **draft**; capture the flow id.
4. Return links to the created entities.

On partial failure (e.g. flow creation fails after steps were created), roll
back by deleting the created custom steps. Never calls `/publish` or
`/workflow-instances`.

The executor does **not** create prerequisites (secrets, connections, MCPs,
webhooks) — those are created earlier, when the user resolves a gap, through
their own existing flows. Apply only creates the plan's own entities (custom
steps + the draft flow). See "Prerequisites vs. plan" below.

## The build plan (typed in `@journeyman/core`)

The plan is **step-aware**: tools, MCPs, and skills bind per *custom-AI step*
(each `CustomAiStep` carries its own `defaultTools` / `defaultMcpIds` /
`defaultSkillIds`), while built-in *provider steps* (comment on PR, transition
ticket, send message) bind a provider *connection* (a credential via secret
bindings) instead — they use no tools/MCPs/skills. Sandbox is a workflow default,
overridable per node. So "what does this step use" differs by step kind, and the
preview reflects that per step rather than as one global blob.

```ts
interface BuildPlan {
  newCustomSteps: CustomAiStepCreateInput[]; // each carries its own tools/mcpIds/skillIds
  workflow: WorkflowGraph;                   // assembled, validated
  defaults: { sandboxId: string | null; model: string | null };
  stepBindings: StepBinding[];               // per-node "what it uses", for the preview
  gaps: Gap[];                               // missing prerequisites, pinned to steps
  summary: string;                           // plain-language description of the flow
}

interface StepBinding {
  nodeId: string;
  stepKind: "trigger" | "ai" | "provider" | "human-task" | "webhook-wait";
  uses: {
    tools?: CanonicalTool[];   // ai
    mcpIds?: string[];         // ai
    skillIds?: string[];       // ai
    model?: string;            // ai
    connection?: string;       // provider — the credential/provider it needs
    sandboxId?: string;        // only when overridden from defaults
    // secret slots tagged by name (convention) — values never carried in the plan
    secrets?: { slot: string; secretName: string | null }[];
  };
  io: {                        // surfaced by the inputs/outputs (⇄) reveal
    inputs: { name: string; from: string }[];   // `from` is human-readable: "step 2 · output diff"
    outputs: { name: string; type: string }[];
  };
}

interface Gap {
  id: string;
  kind:
    | "mcp" | "skill" | "sandbox" | "connection" | "webhook"
    | "capability"       // no catalog step covers the action
    | "not-implemented"; // a needed provider/node exists in name but is a stub
  nodeIds: string[];                  // the step(s) this blocks — a gap can span steps
  reason: string;                     // plain-language: why it's needed
  required: boolean;                  // required gaps block Apply
  fixHint: string;                    // pointer to the existing config UI (null for capability)
}
```

A single gap (e.g. a missing GitHub connection) can block several steps, so it is
deduped but carries every `nodeId` it blocks. `summary` and `gap.reason` are
written in plain language by design — the audience is developers who don't know
Journeyman.

The set of things the assistant *selects, never creates* (and flags as gaps when
absent) is therefore: MCP instances, skill packages, sandboxes, provider
connections (git/ticket/notification credentials), **and webhooks**. A
`capability` gap is the exception — it has no fix in config UI; it signals that
no catalog step covers the requested action.

The flow's **start trigger(s)** (one or more of `trigger-manual` /
`trigger-webhook` / `trigger-human`, with `inputsMapping` + `inputDefs` for
webhooks) and any **mid-flow pause nodes** (`human-task`, `webhook-wait`) are all
part of `workflow`, built by the assembler. Any webhook *record* they point at
(start webhook or a `webhook-wait`'s) is a selected prerequisite (or a `webhook`
gap).

## Persistence: `jm_builder_sessions`

Conversations persist so users can leave and resume a build (important for the
non-expert audience). Migration `043_builder_sessions.sql`, following house
conventions (scope/org/user columns, `UNIQUE NULLS NOT DISTINCT`, jsonb blobs,
app-managed `updated_at`, app-level scope enforcement — no RLS).

```sql
-- 043_builder_sessions.sql
-- User/org-scoped conversational AI-builder chat sessions.

CREATE TABLE IF NOT EXISTS jm_builder_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope           TEXT NOT NULL CHECK (scope IN ('user', 'org')),
  org_id          UUID NOT NULL REFERENCES jm_orgs(id) ON DELETE CASCADE,
  user_id         UUID          REFERENCES jm_users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'applied', 'archived')),
  messages        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- conversation transcript
  build_plan      JSONB,                                -- latest BuildPlan (nullable)
  applied_flow_id UUID,                                 -- set once Apply succeeds
  created_by      UUID NOT NULL REFERENCES jm_users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT jm_builder_sessions_scope_name_unique
    UNIQUE NULLS NOT DISTINCT (scope, org_id, user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_jm_builder_sessions_org_user
  ON jm_builder_sessions (org_id, user_id);
```

Session `name` is user-facing and editable; it defaults to a short label derived
from the opening goal (e.g. *"PR security review"*). To satisfy the
`UNIQUE (scope, org_id, user_id, name)` constraint, the create path
de-duplicates by suffixing (`… (2)`) on collision rather than failing.

> Before implementing the migration, re-read
> [DATABASE_ARCHITECTURE.md](../../constitution/DATABASE_ARCHITECTURE.md) and
> confirm the column set still matches current conventions.

## API surface (new, in `@journeyman/api-server`)

All routes scoped under the user's org, consistent with existing entity routes.

- `POST   /api/orgs/:orgId/users/me/builder/sessions` — create a session.
- `GET    /api/orgs/:orgId/users/me/builder/sessions` — list sessions.
- `GET    /api/orgs/:orgId/users/me/builder/sessions/:id` — load a session (messages + current plan).
- `POST   /api/orgs/:orgId/users/me/builder/sessions/:id/messages` (**SSE**) —
  send a user message; stream agent events: assistant text, clarifying
  questions, plan updates, validation results.
- `POST   /api/orgs/:orgId/users/me/builder/sessions/:id/apply` — apply the
  current plan (re-validates server-side, runs the executor).
- `DELETE /api/orgs/:orgId/users/me/builder/sessions/:id` — delete/archive.

Internally these reuse the existing entity create + `/workflows/validate`
endpoints.

## Data flow

1. User states a goal → SSE stream opens (api-server already supports SSE).
2. Agent reads inventory via tools; asks clarifying questions **one at a time**.
3. When confident: agent proposes intent → assembler builds graph →
   `validatePlan` runs → plan + validation + gaps stream to the preview pane;
   the session row is updated with messages + `build_plan`.
4. User refines via chat or inline edits. A chat prompt produces a **targeted
   patch** that preserves the user's unrelated manual edits; a full rebuild is
   only triggered by an explicit "start over" (see "Edit vs. re-prompt" below).
   Resolving a gap may create a *prerequisite* immediately (separate from Apply).
5. **Apply** → executor re-validates, creates entities via existing APIs →
   `applied_flow_id` is recorded, `status` → `applied` → returns the draft flow
   link. The hand-off is **trigger-aware**: a flow with a manual trigger offers
   "run now"; webhook/form triggers need "publish to go live" to start firing on
   events (a multi-trigger flow can offer both). If the flow contains mid-flow
   pause points, the hand-off also notes it will *pause* for a human review or an
   external signal partway through.

## The page (in `@journeyman/web`)

Split view:
- **Left:** chat (streaming responses, clarifying questions).
- **Right:** live **plan preview** — a plain-language summary, the workflow
  defaults (sandbox, model), then **one card per step**. Each step card shows
  *what that step uses*, scaled to its kind:
  - **AI step** → tools · MCPs · skills · model (new AI steps are badged "new").
  - **Provider step** → the connection/credential it needs · sandbox if overridden.
  - **Trigger(s)** → what starts the flow (one or more: button / event / form).
  - **Pause point** → `human-task` (who reviews/approves) or `webhook-wait`
    (which external signal it waits for) — shown inline where the flow pauses.

  Steps that mutate external/production systems or hold broad credentials carry a
  **risk indicator** (⚠️), with a suggestion to add a `human-task` gate before
  irreversible actions (advisory, not a hard block).

  Gaps are rendered **inline on the step they block** (e.g. step 4 "Comment on
  PR" shows "needs a GitHub connection → set it up"), with a footer summarizing
  total gaps across steps.

**Inputs / outputs reveal.** Each step card carries an inputs/outputs icon
(⇄). Clicking it reveals, in human-readable form, where each input value comes
from (`diff ← step 2 · output diff`, `repo ← flow input`) and what the step
outputs and who consumes it — i.e. the assembler's `@token` / `${}` wiring shown
without raw reference syntax.

**The plan is editable during review — light edits here, deep edits in the
editor.** The preview supports *quick swaps* inline: change the model, toggle a
tool on/off, pick or create a secret, select an MCP/sandbox, and resolve gaps.
These cover the common "almost right, one tweak" case without leaving the page.
Anything more involved (rewriting a prompt template, restructuring the graph,
fine-grained input mapping) is **deferred to the existing flow editor** after
Apply — the Builder does not reimplement the editor's full per-step config UI.
Inline edits mutate the in-memory `BuildPlan`; any edit re-runs
`POST /workflows/validate` so validation state stays live before Apply.

> Rationale: the existing flow editor already owns deep per-step editing.
> Duplicating it on the Builder page is wasted surface and a maintenance
> liability. The Builder's job is to get you to a correct draft fast; the editor
> remains the home for detailed work. (A future option is to extract the
> editor's config controls into shared components — out of scope for v1.)

**Secrets are tagged by name (convention), never by value.** Where a step needs
a credential (a custom-AI step's `SecretSlotDef`, or a provider connection), the
UI shows the slot name in `SCREAMING_SNAKE_CASE` and lets the user **map it to a
secret from the vault by name** — the value is never entered or displayed here;
it is resolved from the secret vault at run time. Mapping (or creating) the
secret is how a `connection` gap is closed.

**Apply** is disabled until validation passes and all *required* gaps are
acknowledged. A sessions list lets the user resume past builds.

## Behavioral rules (surfaced by the dry-tests)

These came out of five flow dry-tests (PR review, SRE, dev→QA, scheduled digest,
release), grouped by theme.

### Triggers, statuses & events

**Event-transition triggers must be filtered (`acceptIf`, not just `listensFor`).**
A status-change trigger (e.g. Jira "moved to Ready for Development") arrives as a
generic `jira:issue_updated` event that fires on *any* edit — comments, labels,
anything. `listensFor` only narrows the event *type*; it would still trigger on
every update. The Builder must also generate the `acceptIf` predicate that checks
the actual change (e.g. the changelog status went *to* the target status), so the
flow starts only on the real transition. The mechanism already exists on the
webhook trigger — the Builder just has to produce the condition (using a status
name the user confirms; see next rule). The same applies to a `webhook-wait` that
resumes on "MR approved".

**Status mapping — ask which status, for what, and where (never guess names).**
A flow has *several* status touchpoints, not one, and every team names its
statuses differently. The Builder must build a **status map with the user**, one
entry per touchpoint: the trigger status that kicks the flow off, the status to
move to when work begins, the handover status, and (for branches) the on-pass /
on-fail statuses. For each it asks *which status, what it's for, and where in the
flow the transition sits*. Where possible it **fetches the project's real
statuses/transitions** (e.g. via Jira) and offers them as a pick-list, so the
user maps each touchpoint to an actual status on their board rather than typing a
guessable name. Free-text status names that don't match the board are a common
silent failure this prevents.

**Schema-less webhooks — ask, don't guess.** A typed preset (e.g. `github`) gives
a known payload shape, so the assembler wires `inputsMapping` JSONPaths
confidently. The `generic` preset (the only fit for Datadog / PagerDuty / Grafana
and other alert sources) has **no payload schema**, so the field paths would be
guesswork. In that case the assistant asks the user to **paste a sample payload**,
derives the JSONPaths from the real example, and marks those mappings
**"unverified until a real event arrives"** in the preview so they get a
deliberate double-check. It does not silently guess alert structure.

### Steps, capabilities & the dev recipe

**Capability gaps.** When the goal needs an action with no catalog step (e.g.
fetching a PR diff), the assistant routes it through a custom-AI step using
tools/an MCP; if even that isn't possible, it raises a `capability` gap rather
than fabricating a step. (See also "Build only on what is real" in Architecture.)

**Coding steps own commit + push (no separate step exists).** There is no
built-in commit/push step — `start-feature-branch` doesn't push and
`open-pull-request` assumes the branch is already on the remote. So whenever a
coding (custom-AI) step is followed by opening a PR/MR, the Builder must make
that coding step **also commit and push** (give it the git/bash ability and put
commit+push in its instructions). If it can't, it raises a `capability` gap
rather than producing an empty PR. Caveat: this runs *inside* an AI step, so it
is AI-driven rather than mechanically guaranteed; a future dedicated commit/push
step would be picked up automatically (see Extensibility) and preferred.

**Reference dev-flow pattern (a recorded recipe the assembler follows):**
trigger (Jira `issue_updated`, filtered to the target status) → `get-issue` →
`start-feature-branch` → analyze (custom-AI) → plan (custom-AI) → **develop +
commit + push (custom-AI)** → `open-pull-request` → notify (`send-message` /
MCP) → **wait for MR approval** (`webhook-wait` on the MR-approved event, or
`human-task`) → continue. Encoding this as a known recipe keeps the commit+push
bundling and the approval wait from being forgotten.

**Running tests = a custom-AI + bash step, with a user-chosen sandbox.** There is
no built-in "run tests" step; the only way to run a suite is a custom-AI step with
the `bash` tool, inside a sandbox that already has the toolchain (Node, Python,
…). The Builder must not silently pick a sandbox. Instead it: (1) explains what
the step needs ("runs your tests → needs your project's tools"); (2) lists the
user's available sandboxes **with their details** (name, type, image, tags,
description); and (3) **asks the user to choose** one based on those details.
Honest limit: the Builder shows what a sandbox *declares* (type/image/tags) but
can't always verify what's installed inside — so it notes "double-check this has
your test tools" when a sandbox isn't clearly labelled, and raises a `sandbox`
gap if none fit. The same "show details, let the user choose" rule applies
anywhere a sandbox is selected.

### Safety & failure

**Failure handling — offer what actually works.** In-flow error routing (the
`"error"` edge / `onFailure`) is not honored, so the Builder must not build
failure-handler branches. When the user asks to "handle / notify on failure," it
offers the mechanisms that *do* work, matched to intent:
- **per-step retry** (`RetryPolicy`: maxAttempts/backoff — fully honored) for
  flaky/transient steps;
- an **out-of-band run-failure alert** (run-status callback, outside the flow's
  steps) for "tell me if the whole run dies";
- a **self-handling AI step** (the risky work in one custom-AI step that catches
  its own error and notifies before failing) for "if this specific step breaks,
  react."

Recommended default for a generic "notify on failure": per-step retry + the
out-of-band run-failure alert; add the self-handling AI step for a high-risk step
(e.g. a prod deploy). A failing step otherwise terminates the whole run — the
Builder says so plainly rather than implying in-flow recovery exists.

**Risk / blast-radius surfacing.** Steps are not equally safe. The Builder marks
steps that **mutate external or production systems, or hold broad credentials**
(e.g. an AI step with `bash` + prod access applying a remediation) with a clear
risk indicator in the preview, shows what they can reach and which secrets they
hold, and **recommends inserting a `human-task` approval gate immediately before
any irreversible action**. Risk is classified from observable signals — write
vs. read tools, the sandbox's reach, the breadth of the bound connection/secret —
not guessed. This matters most for SRE/remediation flows, which can auto-act on
production once published; the user should never be surprised by how much power a
step holds. (Risk surfacing is advisory — it never blocks Apply on its own.)

### Plan lifecycle & editing

**Prerequisites vs. plan.** Two kinds of writes exist, and only one waits for
Apply. *Prerequisites* — secrets, connections, MCPs, webhooks — are created when
the user resolves a gap, immediately, through their own existing flows; they are
shared resources, not part of this plan. *The plan's own entities* — the new
custom steps and the draft flow — are created only on Apply, atomically with
rollback. The "nothing is created until you approve" promise applies to the
plan's entities; resolving a gap is a deliberate, separate action the user takes.

**Edit vs. re-prompt.** Manual inline edits and chat prompts both mutate one
shared in-memory plan. A chat prompt is applied as a **targeted patch** that
leaves the user's unrelated manual edits intact (e.g. "add a Slack step" does
not reset a model the user changed by hand). A from-scratch rebuild happens only
on an explicit "start over." After any change, `validatePlan` re-runs.

**Reuse before create (no silent duplicates).** Before proposing a *new* custom
step, the assistant searches the user's existing custom steps (via
`listMyCustomSteps`) for a close match — by name and by purpose
(inputs/outputs/intent). When a likely match is found, it does **not** silently
create a duplicate: it surfaces the choice — *"You already have ‘Security
review’ that looks close — reuse it, or create a new one?"* — inline in chat and
on the step card. Reuse drops the existing step into the plan (still tweakable
via a quick edit or follow-up); create makes the fresh step. This is the one
place the assistant could have duplicated, since custom steps are the only entity
it creates; the other entities are already select-or-gap, so reuse is their
default. Matches are surfaced as suggestions, never auto-applied — the user
decides.

## Extensibility / staying in sync

Journeyman keeps gaining built-in steps and features. The Builder is designed so
that **most additions require no Builder change at all** — because it reads the
live system instead of hardcoding what exists.

**The catalog is the seam.** Every build, the agent asks the live system what
exists via its read tools (`listStepCatalog`, `listProviders`,
`listSupportedNodeTypes`, `listWebhookPresets`, …). The agent's prompt receives
the catalog dynamically — it never embeds a fixed list of steps. So anything that
flows through these sources reaches the Builder automatically.

**Free — no Builder change:**

| You add… | Why it's free |
|---|---|
| A new **built-in step** | Appears in `listStepCatalog`; the agent sees it and the assembler wires it from its declared input/output shapes. |
| A provider going **stub → real** (`implemented: true`) | The Builder stops flagging it as a `not-implemented` gap on its own. |
| A new **webhook preset** | Appears via `listWebhookPresets`. |
| New MCPs / skills / sandboxes | Already read live per build. |

**The one obligation:** a new step must **self-describe** in the catalog — id,
label, input schema, output schema, the connection/provider it needs, and ideally
a one-line description and a risk hint. The catalog already carries input/output
shapes, so following that convention keeps new steps plug-and-play. *Put the
knowledge in the data, not in the Builder.*

**Needs a small, localized change:**

| You add… | Change | Size |
|---|---|---|
| A brand-new **node type** the assembler must *construct* (a new control/pause primitive with its own config shape) | One new "how to build this node" case in the assembler | Small, rare |
| A new **entity the assistant should create** (e.g. later: create MCPs) | New tool + apply-executor step + a scope decision | Medium (a deliberate feature) |
| A new **metadata dimension** the Builder should use (e.g. a per-step risk score) | Surface it in the catalog, then read it | Small |

Rule of thumb: **new data is free; a new *kind of structure* is a small touch.**
Adding the hundredth step costs nothing; adding the second-ever pause-node type
is a few lines in the assembler.

**The guard that keeps this honest.** A contract test — *every step in the
catalog is selectable and wireable by the assembler* — fails CI the moment a step
is added with incomplete metadata. That converts "the Builder silently can't
handle the new step" into a loud failure at PR time, not a surprise a user hits
later.

## Error handling

- **Validation errors** — surfaced in the preview; the agent makes bounded
  auto-repair attempts; residual errors shown in plain language.
- **Gaps** — required gaps block Apply (each with a "set this up here" link);
  optional gaps warn only.
- **Apply partial failure** — roll back created custom steps; report what was
  and wasn't created.
- **LLM unconfigured / provider error** — clear operator-facing message; the
  page degrades gracefully (no crash).
- **Model capability floor** — the design requires reliable tool-calling **and**
  structured output from the configured model. "Connect any provider" carries
  that asterisk: a model lacking these will produce broken plans. The builder
  parses tool/output defensively and surfaces a clear error (rather than a silent
  bad plan) when the model returns malformed tool calls or off-schema output.

## Testing

- **Unit (TDD), highest value:** the assembler — intent → graph wiring,
  reference-syntax emission, branch conditions. Pure and deterministic.
- **Unit:** apply executor ordering + rollback (mocked create APIs).
- **Contract:** every generated `BuildPlan` (including its `newCustomSteps`)
  validates against `POST /workflows/validate` via `proposedCustomSteps`.
- **Endpoint extension:** `proposedCustomSteps` is merged into validation
  resolution and never persisted — covered by a focused test on the extended
  validate route.
- **Assembler trigger output:** `trigger-webhook` node + `inputsMapping` +
  `inputDefs` stay consistent and pass publish-time trigger validation.
- **No-invented-steps guard:** a plan referencing an unknown step type is
  rejected by the assembler, not emitted.
- **Catalog-coverage contract (extensibility guard):** every step in
  `listStepCatalog` is selectable and wireable by the assembler — fails CI when a
  newly added step has incomplete metadata, so the Builder stays in sync as
  built-in steps grow.
- **Golden cases:** representative "prompt → plan" fixtures (dev end-to-end flow,
  webhook-triggered PR-review flow) to guard against regressions.
- **Session store:** CRUD + scope enforcement unit tests.

## Key design decisions (rationale)

| Decision | Why |
|---|---|
| Agent tools are read/dry-run only; writes are server-side on Apply | Keeps the LLM unable to mutate state directly; one auditable apply path with rollback. |
| Deterministic assembler owns wiring | LLMs are unreliable at node-id/edge/reference bookkeeping; this is where "production-ready" correctness comes from. |
| Validate through the existing `/workflows/validate` gate | "AI-built" passes the identical bar as hand-built; no second validation system to maintain. |
| Single env-configured provider-agnostic LLM | Matches the requested operating model; no DB/secrets coupling; any provider works. |
| Build flow + custom steps only in v1; select (not create) MCP/skill/sandbox | Concentrates effort on the highest-pain authoring; avoids external side-effects in the first cut. |
| Persist sessions (jm_builder_sessions) | Non-expert audience needs to leave and resume a build; refresh-safe. |
| Draft → review → apply; no auto-run | Safety foundation that makes later autonomy modes trustworthy. |
| Extend `/workflows/validate` with `proposedCustomSteps` | Validation resolves custom steps from the DB and fails on unknown ids; without this, a plan's not-yet-created steps can't pass the gate before Apply. |
| Assembler limited to the live catalog; no invented steps | The dry test found no "PR diff" step exists; an unconstrained LLM would fabricate one. The catalog is authoritative. |
| Triggers (incl. webhooks) are first-class in scope and the assembler | The entry point of common flows ("PR opened") is a `trigger-webhook` with `inputsMapping`/`inputDefs`; it must be generated, not assumed. |
| Prerequisites created on gap-resolution, plan entities on Apply | Honest framing of "nothing created until Apply": shared prereqs are a separate, deliberate user action. |
| Build only on sources-of-truth that flag what's real vs. stub (providers' `implemented`, converter node support, step catalog) | The SRE trace found steps that *validate* but throw at run time (Slack stub) and a stale comment that hid working features (loops). "Validates" ≠ "will run"; honest "not implemented yet" messaging requires reading these flags. |
