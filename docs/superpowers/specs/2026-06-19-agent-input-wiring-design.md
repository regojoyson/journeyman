# Agent input wiring — detect, map per trigger, substitute at run time

**Date:** 2026-06-19
**Status:** Approved (design)
**Area:** `packages/web`, `packages/agents`

## Problem

An agent's instructions can contain `{{token}}` blanks, and the UI hints that
these are "inputs". But nothing connects the three links of the chain:

1. **Define** — there is no editor and no detection, so typing `{{thing1}}` in
   the prompt never adds `thing1` to `agent.inputs` (the list stays empty).
2. **Map** — the webhook trigger shows a free-text mapping box unrelated to any
   input; schedule and manual show nothing per input.
3. **Substitute** — at run time the instructions are passed to the model
   verbatim; `{{thing1}}` / `{{payload}}` / `{{trigger.type}}` are never
   replaced with real values (confirmed: `compile.test.ts` asserts the stored
   instructions remain `"Fix {{ticketKey}}"`).

Result: a user adds blanks in the prompt, goes to Triggers, and sees no
per-input mapping — because the whole chain is missing.

## Decisions (from brainstorming)

- **Define inputs by auto-detection** from the prompt — no separate editor.
- **Mapping fields for all triggers** — webhook (payload path), schedule (fixed
  value), and manual Run-now (a small form).
- **Missing value → run anyway with the blank left empty** — detected inputs are
  therefore **optional** (never block a run).

## Part 1 — Detect inputs from the prompt

New pure helper (frontend): `detectInputs(instructions: string): string[]`
- Regex `/\{\{\s*(\w+)\s*\}\}/g`, unique, first-appearance order.
- `\w+` only — so `{{trigger.type}}` (has a dot) never matches; explicitly also
  drop the reserved name `payload`.
- Returns the ordered list of user-input names.

Wiring in `AgentDetail` / `InstructionsSection`:
- When instructions change, recompute detected names and `patch({ inputs })`,
  where `inputs = detected.map((name) => ({ name, type: "text", required: false }))`.
  This keeps `agent.inputs` in sync so the Triggers section and the saved record
  reflect the prompt. `required: false` enforces the "run anyway" decision.
- `InstructionsSection` shows the detected names as a read-only chip list
  ("Detected inputs: thing1 · thing2 — or '—' when none"), replacing the current
  static "Available:" hint.

## Part 2 — Per-trigger fields (one row per detected input)

`TriggersSection` reads `a.inputs` (the detected list) and renders rows.

- **Webhook** — replace the free-text `mappingText` box with one row per input:
  `label = input.name`, value = a JSON path string. Build
  `inputsMapping[name] = path` (omit empty paths). Keep the `webhookId` field.
  When `a.inputs` is empty, show "Add {{inputs}} to the prompt to map them."
- **Schedule** — add a per-input fixed-value row; build
  `fixedInputs[name] = value` on the existing `schedule` trigger
  (`AgentTrigger` schedule already carries `fixedInputs?`). Omit empty values.

`AgentDetail` Run-now (manual):
- Today `runNow(wsId, id, {})`. Change the header **Run now** to open a small
  inline form (one text field per `a.inputs`) when the agent has inputs; on
  submit call `runNow(wsId, id, { inputs })`. With no inputs, behaves as today
  (fires immediately).

## Part 3 — Substitute at run time (the missing link)

New pure helper in `@journeyman/agents`:
`renderInstructions(template, ctx): string` where
`ctx = { inputs: Record<string, unknown>; payload?: unknown; triggerType: string }`.
- Replace `{{name}}` → `String(ctx.inputs[name] ?? "")` for each word-token.
- Replace `{{payload}}` → `JSON.stringify(ctx.payload ?? {})`.
- Replace `{{trigger.type}}` → `ctx.triggerType`.
- Any unmatched `{{token}}` → `""` (run anyway, blank left empty).

Wiring:
- `compileAgentToGraph(agent, suppliedInputs, ctx?)` gains an optional
  `ctx = { payload?, triggerType }`. It renders the instructions
  (`renderInstructions(agent.instructions, { inputs, payload: ctx?.payload, triggerType: ctx?.triggerType ?? "manual" })`)
  and stores the **rendered** text in the step config (so the run snapshot shows
  the real prompt).
- `runAgent(deps, agent, inputs, triggerSource, startedBy, triggerNodeId, renderCtx?)`
  threads `renderCtx` (carrying the raw `payload` for webhooks) into
  `compileAgentToGraph`, and passes `triggerType: triggerSource`.
- `fireAgentForWebhook` passes `{ payload: rawPayload }` as the render context so
  `{{payload}}` resolves. Scheduler/manual/api pass no payload (→ `{}`).
- `resolveInputs` is unchanged: detected inputs are `required: false`, so it
  never throws — consistent with the "run anyway" decision.

## Out of scope

- No explicit type/required editor for inputs (auto-detect only; all `text`).
- No JSON-path autocomplete or payload preview in the mapping rows.
- No change to the agent settings page layout shipped previously.

## Testing

- `detectInputs` (frontend): tokens found, dedup, order, `payload` excluded,
  `trigger.type` not matched, no-token → `[]`.
- `renderInstructions` (`@journeyman/agents`): each token substituted; missing
  input → empty; `{{payload}}` JSON; `{{trigger.type}}` value; multiple/dup
  tokens.
- Update `compile.test.ts`: stored instructions are now **rendered**
  (`compileAgentToGraph(agent, { ticketKey: "PROJ-1" }).graph` step config
  `instructions === "Fix PROJ-1"`, and `"Fix "` when omitted).
- `run-agent.test.ts`: still submits with inputs + `agentId`; add a case
  asserting the rendered instructions reach the submitted graph.
- Frontend render tests: `InstructionsSection` shows detected chips;
  `TriggersSection` renders a row per detected input for webhook + schedule.
- Manual verification (preview): add `{{a}} {{b}}` to a prompt → see them as
  chips → Triggers shows two webhook path rows and two schedule value rows →
  Run now prompts for a and b.
