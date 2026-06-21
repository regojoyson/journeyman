# Prompt caching — design

- **Date:** 2026-06-21
- **Status:** draft (spec + 5 dry-runs, validated against code) — converged, ready for plan
- **Owner:** caching workstream
- **Related but separate:** model routing (owned elsewhere), Serena structural lookups (phase 2), Headroom output compression (later), RAG notebook (later).

## Summary

Cut token cost on multi-step workflows and agents by making each provider reuse a **stable prompt prefix** across steps via the model's native prompt caching. The change is provider-agnostic at heart — **put stable text (rules, tools, MCP/skill instructions) in the system slot and keep only the step's task in the user slot** — plus a small provider-specific marker for Claude and aisdk-Anthropic. Gated by a workflow-level and agent-level toggle (default on) and a global env kill-switch.

Caching is the safest cost lever: same content, billed less. No summarisation, no context loss.

## Goal

- Reuse the repeated prefix across steps so steps 2..N pay ~10% (Anthropic/Gemini), ~50% (OpenAI), or ~80%-off reads with free writes (MiniMax) on the stable portion.
- Zero quality impact.
- One on/off control at workflow and agent level; default on.
- Prove savings with existing token-usage tracking.

## Non-goals

- Model routing (handled separately; per-step `input.model` already flows to the engine).
- Serena / structural lookups (phase 2).
- Headroom output compression (later; needs a self-hosted proxy).
- Cross-run / cross-workflow caching (out of scope; the ~5-min TTL only spans steps that run close together).

## Background — current state

All three providers today **concatenate stable text into the dynamic user prompt**, so the cacheable prefix is short or empty:

- **Claude** — `packages/agent-runtime/src/providers/claude/operations/run-custom-prompt.ts` builds `fullPrompt = [confinement, opts.prompt, mcpPromptSuffix, skillPromptSuffix]` and passes it as the dynamic `prompt`; never sets `systemPrompt`.
- **aisdk** — `.../aisdk/operations/run-custom-prompt.ts` builds `prompt = [confinement, opts.prompt, buildSkillMenu(skills)]`; **no `system:` field, no `cacheControl`.**
- **OpenCode** — `.../opencode/operations/run-custom-prompt.ts` puts MCP prompts in `system` (good) but glues `confinement` into the user `parts`.

What **already exists** (reuse, don't rebuild):
- `RunCustomPromptResult.usage: TokenUsage[]` with `cacheReadTokens` / `cacheCreationTokens` (`packages/core/src/types/coding.types.ts`).
- `claude/utils/usage.ts` (`modelUsageToTokenUsage`) and `aisdk/utils/usage.ts` (`aiSdkUsageToTokenUsage`) already extract cache token counts. The aisdk path already populates `usage`.

## Design

### Principle (provider-agnostic)

```
prompt = [ STABLE prefix (cached) ] + [ DYNAMIC task (fresh each step) ]
         system slot                   user slot
```

- STABLE = workspace confinement rules + tool definitions + MCP/skill system text. Identical across steps of a run (and across runs where the workspace path matches).
- DYNAMIC = the rendered step task.
- Keep STABLE + the tool set + the model identical across steps to get a cache hit; keep volatile values (timestamps, ids) out of STABLE.

### Per-provider implementation

**Claude** — set `systemPrompt` as an array of blocks with the boundary marker; pass `opts.prompt` as the user prompt.
```ts
queryOptions.systemPrompt = [confinement, mcpPromptSuffix, skillPromptSuffix, "SYSTEM_PROMPT_DYNAMIC_BOUNDARY"].filter(Boolean);
query({ prompt: opts.prompt, options: queryOptions });
```
Blocks before `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` are cross-session cacheable; tool defs are cached automatically by the engine.

**aisdk** — add the `system:` field; branch by vendor for the marker.
```ts
const system = [confinement, buildSkillMenu(skills)].filter(Boolean).join("\n\n"); // aisdk has no MCP system-prompt merge today (see dry-run #10)
// MiniMax / OpenAI / Gemini — automatic:
generateText({ model, system, prompt: opts.prompt, tools });
// Anthropic — explicit marker:
generateText({ model, tools, messages: [
  { role: "system", content: system, providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } },
  { role: "user", content: opts.prompt },
]});
```
The forced-JSON fallback (second `generateText`) must reuse the same `system` (today it folds everything into a user message).

**OpenCode** — move confinement into `buildSystem`; keep only the task in `parts`. No explicit marker (OpenCode places Anthropic breakpoints itself; other vendors auto).

### The `caching` flag

- Add `caching?: boolean` (default `true`) to `RunCustomPromptOptions`.
- When `false`, **omit the explicit markers** (Claude `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`, aisdk `cacheControl`). The stable/dynamic split is **always** applied — it is correct prompt structure, and auto-caching vendors benefit regardless.
- Honest limit: a `false` flag cannot disable server-side automatic caching on MiniMax/OpenAI/Gemini; it only removes the explicit markers. Documented in UI help text.

### Plumbing

- **Global:** env kill-switch `JM_DISABLE_PROMPT_CACHE` checked in each `runCustomPrompt`; forces markers off.
- **Workflow:** `caching` boolean on the start-node config (Flow settings). Propagated to each step (see Dry-run #1 for the chosen path) and into the custom-ai handler → `runCustomPrompt({ caching })`.
- **Agent:** `behavior.caching` (default true) → `compileAgentToGraph` adds `caching` to the `agent-run` step config → `agent-run-step-handler` → `runCustomPrompt({ caching })`.
- **No DB migration** — workflow setting lives on start-node config; agent setting lives in the agent `definition` JSONB.

### UI

- **Flow settings** (`FlowSettingsView.tsx`): a "Prompt caching" checkbox, default on, written to start-node `config.caching`.
- **Agent form**: a caching toggle bound to `behavior.caching`.
- No per-step control.

## Management & observability

- Controls: workflow toggle, agent toggle, env kill-switch. Default on.
- Observability: already-present `usage: TokenUsage[]` carries `cacheReadTokens` / `cacheCreationTokens`. Ensure each provider populates `usage` on the result and that the worker logs it per step. Surface a cache-hit ratio in the run view (stretch).
- Verification: run one multi-step workflow + one agent before/after; confirm `cacheReadTokens` climbs on steps 2..N and total cost drops, output unchanged.

## Edge cases & operating rules

- **Prefix must be byte-identical** across steps → same system + tools + model. Routing to a different model = its own cache (one write per model) — acceptable.
- **Keep volatile values out of STABLE** (timestamps, run ids) or every step misses.
- **TTL ~5 min** — back-to-back steps hit; long human-pauses re-write. Extended (1h) cache is a later option.
- **Structured output** (`outputFormat`/`output`) and tool sets are part of the cached prefix — consistent per step type; differing schemas just mean different caches.

## Testing

- Unit: prompt is built as system + user (not concatenated) per provider; Claude boundary present when on / absent when off; aisdk `cacheControl` present only for Anthropic + on; OpenCode confinement in `system`.
- Unit: forced-JSON fallback reuses `system`.
- Unit: flag precedence — env kill-switch > workflow/agent toggle; default true.
- Integration: agent path forwards `behavior.caching` end-to-end.

## Dry-run findings (1st pass)

1. **[Medium — mechanism exists] Flow-level setting must be routed to step handlers.** Start-node config (`workflowRetry`, `maxCycleVisits`) is consumed only by `conductor-converter.ts` (engine level) and does **not** reach steps by itself. **However**, `worker-harness.ts` already delivers `ctx.workflowInputs` from `stepInput.__workflowInput`. **Resolution (two options; (b) recommended):** (a) seed `caching` into the `workflow.input` map at convert time and read `ctx.workflowInputs.caching ?? true`; or **(b) — cleaner — `conductor-converter.ts` already has the start node, so emit `caching` as a literal `inputParameter`/config on each `custom-ai` node; the handler then reads `input.caching !== false` directly** (it already reads many `input.*` fields), with no `workflow.input` seeding and no new `ctx.workflowInputs` dependency. Agent path is unaffected — `compileAgentToGraph` builds the single step config directly. Pin (a) vs (b) during implementation (see dry-run #17).
2. **[Medium → mostly resolved] Confinement embeds `cwd`.** `confinementSystemPrompt(root)` (`workspace-guard/system-prompt.ts`) is in the cached prefix, and its **only** volatile token is `root` (the workspace path). **Resolved for Docker:** the Docker backend uses a constant `workspaceDir = "/workspace"` (`docker-execution-environment.ts`), so confinement is byte-identical across steps **and runs** → fully cacheable. **Local:** the workspace dir is a per-run host path — stable across steps of one run (cross-step caching OK), not cross-run; verify the same dir is reused for all steps of a run. Tool-less steps have no cwd → unaffected.
3. **[Low] "Off" is partial.** Cannot disable auto server-side caching on MiniMax/OpenAI/Gemini; the toggle only removes explicit markers. **Resolution:** document in UI help; tests assert marker presence/absence, not "no caching at all."
4. **[Low] aisdk forced-JSON fallback** rebuilds `messages` and currently carries the old combined prompt as user content. **Resolution:** pass the same `system` there; keep only task/force-instruction in user messages.
5. **[Low] OpenCode's own internal system prompt** may include dynamic bits (date/cwd) we don't control, which could bust caching regardless of our change. **Action:** verify via `cacheReadTokens` on OpenCode runs; if it never hits, raise upstream / accept reduced benefit on OpenCode.
6. **[Resolved] Observability already exists.** Confirmed: **all three** providers populate `result.usage` with cache tokens — Claude (`modelUsageToTokenUsage(m.modelUsage)`), aisdk (`aiSdkUsageToTokenUsage(result.usage)`), OpenCode (`openCodeInfoToTokenUsage(info)`). No new extraction code needed. **Action:** verify the worker persists/logs `usage` per step (likely already done) and optionally surface a cache-hit ratio in the run view.

## Dry-run findings (2nd pass)

7. **[Resolved] Usage is fully wired to the DB.** Confirmed both handlers already forward `result.usage` to `recordTokenUsage` — `custom-ai-step-handler.ts:247` (`usage: result.usage ?? []`) and `agent-run-step-handler.ts:200` (plus `addUsage` for agent billing). With `cacheReadTokens`/`cacheCreationTokens` on `TokenUsage`, **caching savings land in the usage table automatically** — no observability work needed beyond optionally surfacing a ratio.
8. **[Resolved] No session-resume surprise.** `claude/utils/session.ts` `resolveSession` starts a **fresh** SDK conversation per step (`queryOption.sessionId = randomUUID()`); the correlation id is not a resumed conversation. So cross-step caching depends purely on identical **prefix content** — exactly the design's assumption; nothing to change.
9. **[Resolved] Skill system prompt is cache-safe.** `buildSkillSystemPrompt` emits only the package name + enabled skill names — **no `localPath` or per-run path in the prompt text** (paths live in the plugin config, not the prompt). It won't bust the cached prefix.
10. **[Medium] aisdk does not merge MCP system prompts.** aisdk's stable text is `[confinement, buildSkillMenu(skills)]` only; MCP instructions are not delivered on the aisdk path today (only `mcp.tools` are wired) — a **pre-existing gap**, not caused by caching. So the spec's earlier `mcpSystemText(opts)` does not apply to aisdk. **Action:** use `[confinement, buildSkillMenu(skills)]`; optionally add MCP system-prompt merge to aisdk as separate work. Verify `buildSkillMenu` embeds no per-run paths (cache stability).
11. **[Low] Empty-stable edge (Claude).** A pure-prompt step (no confinement/MCP/skills) would otherwise produce a lone `["SYSTEM_PROMPT_DYNAMIC_BOUNDARY"]`. **Resolution:** omit `systemPrompt` entirely when there are no stable blocks.

**2nd-pass verdict:** still no blockers. Three first-pass worries (usage forwarding, session reuse, skill-path volatility) are now **confirmed safe/already-built**. The only genuine watch-items remain **#2 (workspace-dir stability)** and the build-time items #4/#10/#11.

## Dry-run findings (3rd pass)

12. **[Medium] Env kill-switch won't reach the sandbox runner.** `runCustomPrompt` runs in the **runner** process (inside the container for Docker; a subprocess for local), which has its *own* `process.env` — only `IS_SANDBOX` (set in `runner/cli.ts`) and per-call secrets (`opts.env`) cross into it. A worker-side `JM_DISABLE_PROMPT_CACHE` would **not** be visible there. **Resolution:** resolve the kill-switch on the **worker/handler side** (where `process.env` is real) and fold it into the `caching` opt passed to `runCustomPrompt` — do **not** read env inside `runCustomPrompt`.
13. **[Resolved] Docker workspace path is constant.** `docker-execution-environment.ts` returns `workspaceDir = "/workspace"` for every run → confinement prefix is identical across steps and runs (see refined #2). Strong cache stability on Docker; even cross-run prefix reuse within the TTL.
14. **[Low/Medium] Cache key needs deterministic tool/MCP ordering.** Tool/MCP definitions are part of the cached prefix. Claude builds `tools = [...baseTools, ...mcpToolNames, ...skillToolNames]` and `mcpPromptSuffix = mergeSystemPrompts(opts.mcps)`; aisdk builds `tools = {...builtin, ...mcp.tools, ...skillTools}`. If `opts.mcps` (or tool keys) arrive in a **different order** between steps with the same config, the serialized prefix differs → cache miss. **Resolution:** ensure deterministic ordering (sort MCPs/tools by id/name) when assembling the prefix.
15. **[Low] Existing flows start caching by default.** With `ctx.workflowInputs.caching ?? true`, flows/agents that never set the flag will begin caching after deploy. Intended (zero quality risk), but call it out in release notes.

**3rd-pass verdict:** one real new item — the **env kill-switch must be resolved worker-side and passed as the `caching` opt** (#12) — plus a cache-stability nicety (#14, deterministic ordering). The workspace-dir worry (#2) is now **resolved for Docker** (constant `/workspace`) and bounded for local. Still no blockers.

## Dry-run findings (4th pass)

16. **[Resolved] Runner boundary forwards opts generically.** `SandboxInstanceCodingProvider.runCustomPrompt` sends `stdin: payload(opts)` (the whole opts, functions handled separately), and `RunnerRequest.opts` is a generic `Record<string, unknown>` ("the method's options, minus functions"). So adding `caching: boolean` to `RunCustomPromptOptions` **crosses the worker→runner boundary automatically** — no protocol/whitelist change. (Confirm `run-cli` spreads `opts` through to `runCustomPrompt` — it does, per the generic type.)
17. **[Medium — pin during impl] Seeding point for the workflow flag.** The *delivery* path is confirmed (`__workflowInput` → `ctx.workflowInputs`); the *seeding* of `config.caching` is the open choice. **Recommended: option (b)** — `conductor-converter.ts` injects `caching` as a literal input/config on each `custom-ai` node (the converter already reads the start node), so the handler reads `input.caching !== false` with no `workflow.input` plumbing. Fallback: option (a), seed into `workflow.input`.
18. **[Low] Reserved input keys.** `worker-harness.ts` treats `__workflowInput` and `_flowDefaultSources` as reserved meta keys. Deliver the flag either as a normal node input (`input.caching`, option b) or via `__workflowInput` — don't introduce a new top-level reserved key that the harness would strip.

**4th-pass verdict:** the worry that the flag/opt couldn't cross the sandbox boundary is **resolved** (generic opts passthrough). The only decision left is cosmetic — *where* to inject the workflow flag (recommend converter-per-node). No new blockers; findings are converging on build-time choices, not design risks.

## Dry-run findings (5th pass)

19. **[Resolved] `payload()` preserves `caching: false`.** `SandboxInstanceCodingProvider.payload` only deletes `onLog`/`signal` (and `env` is sent separately); it shallow-copies everything else and the stdin is JSON-serialized, which preserves boolean `false`. No falsy-drop — the flag survives the runner hop intact.
20. **[Medium — reinforces option (b)] Literal vs ref type preservation.** `resolve-inputs.ts` keeps a **literal** input's JS type as-is (`out[k] = v.value`), but a **ref/template** input becomes a `${...}` string that **Conductor resolves at runtime and can hand back as a string** (e.g. `"false"`). Therefore inject `caching` as a **literal boolean per node** (option (b)) so it arrives as a real boolean. Regardless, read it **defensively** in the handler: `const caching = !(input.caching === false || input.caching === "false");` — never `input.caching !== false` alone (a string `"false"` would wrongly read as on). Add a test for both the boolean and string forms.

**5th-pass verdict:** no new blockers. The only substantive takeaway is a type-safety guard (#20): inject the flag as a literal boolean and read it defensively. After five passes the findings have fully converged on build-time choices — **the spec is ready to drive an implementation plan.**

## Final build checklist (distilled from all 5 passes)

- [ ] Provider restructure: stable → system slot, task → user slot (Claude `systemPrompt[]`+boundary; aisdk `system:` [+ Anthropic `cacheControl`]; OpenCode confinement → `buildSystem`).
- [ ] `caching?: boolean` on `RunCustomPromptOptions` (default true); omit explicit markers when false; omit `systemPrompt` when no stable blocks (#11).
- [ ] aisdk forced-JSON fallback reuses `system` (#4); aisdk `system = [confinement, buildSkillMenu]` (#10).
- [ ] Flag plumbing: converter injects literal `caching` per custom-ai node + defensive read (#17, #20); agent via `compile` → `agent-run` handler.
- [ ] Kill-switch resolved **worker-side**, passed as the `caching` opt (#12).
- [ ] Deterministic MCP/tool ordering in the prefix (#14).
- [ ] UI: Flow-settings checkbox + agent toggle (default on).
- [ ] Verify at runtime: workspace-dir stability on local (#2), OpenCode cache hits (#5), `buildSkillMenu` path-stability (#10).
- [ ] Release note: existing flows begin caching by default (#15).

## Open questions

- Where exactly to seed the workflow `caching` flag into `workflow.input` (run-start path) — pin the function during implementation.
- Whether to expose cache-hit ratio in the run view now or defer.
