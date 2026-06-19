# Agent Input Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the agent-input chain end to end — auto-detect `{{tokens}}` in the prompt, show a fill-in field per input on every trigger, and substitute real values into the prompt at run time (missing → empty).

**Architecture:** A pure `renderInstructions` helper in `@journeyman/agents` substitutes `{{name}}`/`{{payload}}`/`{{trigger.type}}` during `compileAgentToGraph`, fed by a render context threaded through `runAgent`/`runAgentGuarded` (webhook supplies the payload). On the web side, a pure `detectInputs` helper drives the input list: `InstructionsSection` keeps `agent.inputs` in sync from the prompt and shows chips; `TriggersSection` renders one row per input (webhook path / schedule value); `AgentDetail` adds a Run-now form.

**Tech Stack:** TypeScript, React 18, react-router-dom, Vitest + `renderToStaticMarkup`, `@journeyman/webhooks` `readPath`.

> **Execution constraints for this plan (per user):** Do **NOT** commit at any step. Run the **full typecheck once at the very end** (Task 8); per-task verification runs only the targeted Vitest file.

---

## File Structure

**Create:**
- `packages/agents/src/render.ts` — `renderInstructions(template, ctx)` + `RenderContext`.
- `packages/agents/src/render.test.ts` — unit tests.
- `packages/web/src/components/agents/detect-inputs.ts` — `detectInputs(instructions)`.
- `packages/web/src/components/agents/detect-inputs.test.ts` — unit tests.
- `packages/web/src/components/agents/sections/InstructionsSection.test.tsx` — chip render test.
- `packages/web/src/components/agents/sections/TriggersSection.test.tsx` — per-input row render test.

**Modify:**
- `packages/agents/src/index.ts` — export `render.ts`.
- `packages/agents/src/compile.ts` — render instructions via a new `ctx` arg.
- `packages/agents/src/compile.test.ts` — expect rendered instructions.
- `packages/agents/src/run-agent.ts` — thread a `renderCtx` into compile.
- `packages/agents/src/run-agent.test.ts` — assert rendered instructions reach the graph.
- `packages/api-server/src/services/agent-webhook-fire.ts` — pass `{ payload }` as render context.
- `packages/web/src/components/agents/sections/InstructionsSection.tsx` — sync inputs from prompt + chips.
- `packages/web/src/components/agents/sections/TriggersSection.tsx` — per-input rows for webhook + schedule.
- `packages/web/src/components/agents/AgentDetail.tsx` — Run-now form per input.

---

### Task 1: `renderInstructions` helper (backend)

**Files:**
- Create: `packages/agents/src/render.ts`
- Test: `packages/agents/src/render.test.ts`
- Modify: `packages/agents/src/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/agents/src/render.test.ts
import { describe, it, expect } from "vitest";
import { renderInstructions } from "./render.ts";

describe("renderInstructions", () => {
  it("substitutes named inputs", () => {
    expect(
      renderInstructions("Fix {{ticketKey}} now", { inputs: { ticketKey: "PROJ-1" }, triggerType: "manual" }),
    ).toBe("Fix PROJ-1 now");
  });
  it("leaves a missing input as an empty string", () => {
    expect(renderInstructions("Fix {{ticketKey}}!", { inputs: {}, triggerType: "manual" })).toBe("Fix !");
  });
  it("renders {{payload}} as JSON and {{trigger.type}} as the source", () => {
    const out = renderInstructions("p={{payload}} t={{trigger.type}}", {
      inputs: {},
      payload: { a: 1 },
      triggerType: "webhook",
    });
    expect(out).toBe('p={"a":1} t=webhook');
  });
  it("renders {{payload}} as {} when no payload is supplied", () => {
    expect(renderInstructions("{{payload}}", { inputs: {}, triggerType: "schedule" })).toBe("{}");
  });
  it("substitutes every occurrence of a repeated token", () => {
    expect(renderInstructions("{{k}}-{{k}}", { inputs: { k: "x" }, triggerType: "api" })).toBe("x-x");
  });
  it("coerces non-string input values", () => {
    expect(renderInstructions("n={{n}} b={{b}}", { inputs: { n: 5, b: true }, triggerType: "manual" })).toBe(
      "n=5 b=true",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agents && npx vitest run src/render.test.ts`
Expected: FAIL — `render.ts` not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/agents/src/render.ts

export interface RenderContext {
  /** Resolved named inputs (after defaults). */
  inputs: Record<string, unknown>;
  /** Raw trigger payload, for {{payload}}. Undefined → {}. */
  payload?: unknown;
  /** How the run started, for {{trigger.type}} (e.g. "webhook"). */
  triggerType: string;
}

/**
 * Substitute {{name}}, {{payload}} and {{trigger.type}} in an agent's
 * instructions. Any token with no value renders as an empty string — runs are
 * never blocked on a missing input.
 */
export function renderInstructions(template: string, ctx: RenderContext): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, token: string) => {
    if (token === "payload") return JSON.stringify(ctx.payload ?? {});
    if (token === "trigger.type") return ctx.triggerType;
    const v = ctx.inputs[token];
    return v === undefined || v === null ? "" : String(v);
  });
}
```

- [ ] **Step 4: Export it from the package index**

In `packages/agents/src/index.ts` add after the `compile.ts` export:

```typescript
export * from "./render.ts";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/agents && npx vitest run src/render.test.ts`
Expected: PASS (6 tests).

---

### Task 2: Render instructions in `compileAgentToGraph`

**Files:**
- Modify: `packages/agents/src/compile.ts`
- Modify: `packages/agents/src/compile.test.ts`

- [ ] **Step 1: Update the test to expect rendered output**

In `packages/agents/src/compile.test.ts`, change the assertion on line 38 from:

```typescript
    expect(stepNode.config!.instructions).toBe("Fix {{ticketKey}}");
```

to:

```typescript
    expect(stepNode.config!.instructions).toBe("Fix PROJ-1");
```

Then add this test inside the `describe("compileAgentToGraph", …)` block:

```typescript
  it("renders {{trigger.type}} from the supplied context", () => {
    const agent = { ...baseAgent, instructions: "src={{trigger.type}}" };
    const { graph } = compileAgentToGraph(agent, { ticketKey: "X" }, { triggerType: "webhook" });
    const step = graph.nodes.find((n) => n.stepType === "agent-run")!;
    expect(step.config!.instructions).toBe("src=webhook");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/agents && npx vitest run src/compile.test.ts`
Expected: FAIL — instructions still equal `"Fix {{ticketKey}}"` / no `ctx` param.

- [ ] **Step 3: Update `compile.ts`**

Add the import at the top of `packages/agents/src/compile.ts`:

```typescript
import { renderInstructions } from "./render.ts";
```

Change the `compileAgentToGraph` signature and add rendering. Replace the function header and the `const inputs = …` line:

```typescript
export function compileAgentToGraph(
  agent: Agent,
  suppliedInputs: Record<string, unknown> = {},
  ctx: { payload?: unknown; triggerType?: string } = {},
): { graph: WorkflowGraph; inputs: Record<string, unknown> } {
  const inputs = resolveInputs(agent, suppliedInputs);
  const instructions = renderInstructions(agent.instructions, {
    inputs,
    payload: ctx.payload,
    triggerType: ctx.triggerType ?? "manual",
  });
```

Then, in the step node `config`, change the `instructions` line from:

```typescript
          instructions: agent.instructions,
```

to:

```typescript
          instructions,
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/agents && npx vitest run src/compile.test.ts`
Expected: PASS (4 tests — the existing "rejects missing ones" still throws because `ticketKey` is `required: true`).

---

### Task 3: Thread render context through `runAgent` and the webhook fire

**Files:**
- Modify: `packages/agents/src/run-agent.ts`
- Modify: `packages/agents/src/run-agent.test.ts`
- Modify: `packages/api-server/src/services/agent-webhook-fire.ts`

- [ ] **Step 1: Add a failing test for rendered instructions in the submitted graph**

In `packages/agents/src/run-agent.test.ts`, add this test inside `describe("runAgent", …)`:

```typescript
  it("renders the instructions into the submitted graph", async () => {
    const submit = vi.fn().mockResolvedValue({ workflowInstanceId: "wi2", engineWorkflowId: null });
    await runAgent({ orchestrator: { submit } }, agent, { k: "PROJ-9" }, "api", { userId: null, orgId: "o1" });
    const arg = submit.mock.calls[0][0];
    const step = arg.definitionSnapshot.nodes.find((n: any) => n.stepType === "agent-run");
    expect(step.config.instructions).toBe("do PROJ-9");
  });
```

Note: the existing `agent` fixture has `inputs: [{ name: "k", required: true }]`, so the existing "throws when a required input is missing" test still passes unchanged.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/agents && npx vitest run src/run-agent.test.ts`
Expected: FAIL — `step.config.instructions` is `"do {{k}}"` (compile not yet receiving the trigger context here is fine; it fails because run-agent doesn't pass `triggerSource` as `triggerType`).

- [ ] **Step 3: Thread `renderCtx` through `runAgent`**

In `packages/agents/src/run-agent.ts`, change the `runAgent` signature and the `compileAgentToGraph` call. Replace the signature block:

```typescript
export async function runAgent(
  deps: RunAgentDeps,
  agent: Agent,
  inputs: Record<string, unknown>,
  triggerSource: AgentTriggerSource,
  startedBy: { userId: string | null; orgId: string },
  triggerNodeId = "trigger-1",
  renderCtx: { payload?: unknown } = {},
): Promise<{ workflowInstanceId: string; engineWorkflowId: string | null }> {
  const compiled = compileAgentToGraph(agent, inputs, { payload: renderCtx.payload, triggerType: triggerSource });
```

(The rest of `runAgent` is unchanged.)

- [ ] **Step 4: Thread `renderCtx` through `runAgentGuarded`**

In the same file, change `runAgentGuarded`'s signature and its `runAgent` call. Replace the signature block:

```typescript
export async function runAgentGuarded(
  deps: RunAgentDeps & { pool: Pool },
  agent: Agent,
  inputs: Record<string, unknown>,
  triggerSource: AgentTriggerSource,
  startedBy: { userId: string | null; orgId: string },
  triggerNodeId = "trigger-1",
  renderCtx: { payload?: unknown } = {},
): Promise<GuardedRunResult> {
  const verdict = await enforceSafetyRails(deps.pool, agent);
  if (!verdict.ok) return { skipped: verdict.reason };
  const res = await runAgent(deps, agent, inputs, triggerSource, startedBy, triggerNodeId, renderCtx);
  await incrementRunCounter(deps.pool, startedBy.orgId, agent.id).catch(() => undefined);
  return res;
}
```

- [ ] **Step 5: Pass the payload from the webhook fire**

In `packages/api-server/src/services/agent-webhook-fire.ts`, change the `runAgentGuarded` call (currently 5 args) to pass the node id and the payload:

```typescript
  const res = await runAgentGuarded(
    { orchestrator: c.orchestrator, pool: c.pool },
    agent,
    inputs,
    "webhook",
    { userId: null, orgId: agent.orgId },
    "trigger-1",
    { payload: input.rawPayload },
  );
```

- [ ] **Step 6: Run the agents test file to verify it passes**

Run: `cd packages/agents && npx vitest run src/run-agent.test.ts`
Expected: PASS (3 tests).

---

### Task 4: `detectInputs` helper (frontend)

**Files:**
- Create: `packages/web/src/components/agents/detect-inputs.ts`
- Test: `packages/web/src/components/agents/detect-inputs.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/web/src/components/agents/detect-inputs.test.ts
import { describe, it, expect } from "vitest";
import { detectInputs } from "./detect-inputs.ts";

describe("detectInputs", () => {
  it("finds tokens in first-appearance order", () => {
    expect(detectInputs("Fix {{ticketKey}} in {{repo}}")).toEqual(["ticketKey", "repo"]);
  });
  it("deduplicates repeated tokens", () => {
    expect(detectInputs("{{a}} and {{a}} and {{b}}")).toEqual(["a", "b"]);
  });
  it("excludes the reserved payload token", () => {
    expect(detectInputs("see {{payload}} and {{x}}")).toEqual(["x"]);
  });
  it("does not match dotted reserved tokens like trigger.type", () => {
    expect(detectInputs("from {{trigger.type}} with {{x}}")).toEqual(["x"]);
  });
  it("returns an empty array when there are no tokens", () => {
    expect(detectInputs("plain text")).toEqual([]);
  });
  it("tolerates inner whitespace", () => {
    expect(detectInputs("{{  spaced  }}")).toEqual(["spaced"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run src/components/agents/detect-inputs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/web/src/components/agents/detect-inputs.ts

/** Tokens that are special, not user inputs. {{trigger.type}} is naturally
 *  excluded because the matcher only accepts word characters (no dot). */
const RESERVED = new Set(["payload"]);

/** Extract the ordered, de-duplicated list of {{input}} names from a prompt. */
export function detectInputs(instructions: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\{\{\s*(\w+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(instructions)) !== null) {
    const name = m[1];
    if (RESERVED.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && npx vitest run src/components/agents/detect-inputs.test.ts`
Expected: PASS (6 tests).

---

### Task 5: `InstructionsSection` — sync inputs from the prompt + chips

**Files:**
- Modify: `packages/web/src/components/agents/sections/InstructionsSection.tsx`
- Test: `packages/web/src/components/agents/sections/InstructionsSection.test.tsx`

- [ ] **Step 1: Write the failing render test**

```tsx
// packages/web/src/components/agents/sections/InstructionsSection.test.tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Agent } from "@journeyman/core";
import { InstructionsSection } from "./InstructionsSection.tsx";

const agent = {
  instructions: "Fix {{ticketKey}} in {{repo}}",
  inputs: [
    { name: "ticketKey", type: "text", required: false },
    { name: "repo", type: "text", required: false },
  ],
} as unknown as Agent;

describe("InstructionsSection", () => {
  it("lists the detected inputs as chips", () => {
    const html = renderToStaticMarkup(<InstructionsSection a={agent} patch={() => {}} locked={false} />);
    expect(html).toContain("Detected inputs");
    expect(html).toContain("ticketKey");
    expect(html).toContain("repo");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run src/components/agents/sections/InstructionsSection.test.tsx`
Expected: FAIL — current component renders an "Available:" hint, not "Detected inputs" chips.

- [ ] **Step 3: Rewrite `InstructionsSection.tsx`**

Replace the whole file with:

```tsx
// packages/web/src/components/agents/sections/InstructionsSection.tsx
import type { Agent, AgentUpdateInput } from "@journeyman/core";
import { inputCls, codePill } from "../../../routes/admin-styles.ts";
import { SectionShell, FieldLabel } from "./SectionShell.tsx";
import { detectInputs } from "../detect-inputs.ts";

export interface SectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
}

export function InstructionsSection({ a, patch, locked }: SectionProps) {
  const onChangeInstructions = (text: string) => {
    const names = detectInputs(text);
    patch({
      instructions: text,
      inputs: names.map((name) => ({ name, type: "text", required: false })),
    });
  };
  const detected = a.inputs.map((i) => i.name);

  return (
    <SectionShell title="Instructions & Inputs" description="What this agent should do each run.">
      <div>
        <FieldLabel>Instructions</FieldLabel>
        <textarea
          className={`${inputCls} min-h-[160px]`}
          disabled={locked}
          value={a.instructions}
          onChange={(e) => onChangeInstructions(e.target.value)}
        />
      </div>
      <div className="text-xs text-muted-foreground bg-muted rounded-md p-3 space-y-2">
        <div>
          Insert a value with <code className={codePill}>{"{{name}}"}</code>. Reserved:{" "}
          <code className={codePill}>{"{{payload}}"}</code>, <code className={codePill}>{"{{trigger.type}}"}</code>.
        </div>
        <div>
          <span className="font-medium text-foreground">Detected inputs:</span>{" "}
          {detected.length === 0 ? (
            "—"
          ) : (
            detected.map((name) => (
              <span key={name} className={`${codePill} mr-1`}>
                {name}
              </span>
            ))
          )}
        </div>
      </div>
    </SectionShell>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && npx vitest run src/components/agents/sections/InstructionsSection.test.tsx`
Expected: PASS.

---

### Task 6: `TriggersSection` — one row per input (webhook path + schedule value)

**Files:**
- Modify: `packages/web/src/components/agents/sections/TriggersSection.tsx`
- Test: `packages/web/src/components/agents/sections/TriggersSection.test.tsx`

- [ ] **Step 1: Write the failing render test**

```tsx
// packages/web/src/components/agents/sections/TriggersSection.test.tsx
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Agent } from "@journeyman/core";
import { TriggersSection } from "./TriggersSection.tsx";

const agent = {
  id: "a1",
  inputs: [{ name: "ticketKey", type: "text", required: false }],
  triggers: [
    { type: "webhook", webhookId: "wh1", inputsMapping: { ticketKey: "$.issue.key" } },
    { type: "schedule", cron: "0 2 * * *", timezone: "UTC", fixedInputs: { ticketKey: "PROJ-1" } },
  ],
} as unknown as Agent;

describe("TriggersSection", () => {
  it("renders a webhook path row and a schedule value row per input", () => {
    const html = renderToStaticMarkup(
      <TriggersSection a={agent} patch={() => {}} locked={false} wsId="w1" />,
    );
    expect(html).toContain("ticketKey");
    expect(html).toContain("$.issue.key"); // webhook path value
    expect(html).toContain("PROJ-1"); // schedule fixed value
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/web && npx vitest run src/components/agents/sections/TriggersSection.test.tsx`
Expected: FAIL — current component uses a free-text mapping box and no schedule fixed-input rows.

- [ ] **Step 3: Rewrite `TriggersSection.tsx`**

Replace the whole file with:

```tsx
// packages/web/src/components/agents/sections/TriggersSection.tsx
import { useEffect, useState } from "react";
import type { Agent, AgentUpdateInput } from "@journeyman/core";
import { agentsApi } from "../../../api/agents.ts";
import { inputCls, btnGhost, codePill } from "../../../routes/admin-styles.ts";
import { SectionShell } from "./SectionShell.tsx";

export interface SectionProps {
  a: Agent;
  patch: (p: AgentUpdateInput) => void;
  locked: boolean;
  wsId: string;
}

/** Drop empty-string values from a name→value record. */
function pruneEmpty(rec: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) if (v.trim()) out[k] = v.trim();
  return out;
}

export function TriggersSection({ a, patch, locked, wsId }: SectionProps) {
  const schedule = a.triggers.find((t) => t.type === "schedule") as
    | { type: "schedule"; cron: string; timezone: string; fixedInputs?: Record<string, unknown> }
    | undefined;
  const webhook = a.triggers.find((t) => t.type === "webhook") as
    | { type: "webhook"; webhookId: string; inputsMapping?: Record<string, string> }
    | undefined;

  const setSchedule = (next: { cron: string; timezone: string; fixedInputs: Record<string, string> } | null) => {
    const others = a.triggers.filter((t) => t.type !== "schedule");
    patch({ triggers: next ? [...others, { type: "schedule", ...next }] : others });
  };
  const setWebhook = (next: { webhookId: string; inputsMapping: Record<string, string> } | null) => {
    const others = a.triggers.filter((t) => t.type !== "webhook");
    patch({ triggers: next ? [...others, { type: "webhook", ...next }] : others });
  };

  const webhookPaths = (webhook?.inputsMapping ?? {}) as Record<string, string>;
  const scheduleValues = (schedule?.fixedInputs ?? {}) as Record<string, string>;

  // API tokens (immediate, independent of Save)
  const [apiTokens, setApiTokens] = useState<Array<{ id: string; created_at: string }>>([]);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  useEffect(() => {
    agentsApi.listApiTokens(wsId, a.id).then(setApiTokens).catch(() => setApiTokens([]));
  }, [wsId, a.id]);
  const issueToken = async () => {
    const r = await agentsApi.issueApiToken(wsId, a.id);
    setRevealedToken(r.token);
    setApiTokens(await agentsApi.listApiTokens(wsId, a.id));
  };
  const revokeToken = async (tokenId: string) => {
    await agentsApi.revokeApiToken(wsId, a.id, tokenId);
    setApiTokens(await agentsApi.listApiTokens(wsId, a.id));
  };

  const noInputs = a.inputs.length === 0;

  return (
    <SectionShell title="Triggers" description="How runs are started — on a schedule, via the API, or from a webhook.">
      {/* Schedule */}
      <div className="border rounded-lg p-4 space-y-2">
        <div className="font-medium text-sm">⏱ Schedule</div>
        <label className="flex gap-2 items-center text-sm">
          <input
            type="checkbox"
            disabled={locked}
            checked={Boolean(schedule)}
            onChange={(e) =>
              setSchedule(e.target.checked ? { cron: "0 2 * * *", timezone: "UTC", fixedInputs: scheduleValues } : null)
            }
          />{" "}
          Run on a schedule
        </label>
        {schedule && (
          <>
            <div className="flex gap-2">
              <input
                className={inputCls}
                disabled={locked}
                placeholder="cron (e.g. 0 2 * * *)"
                value={schedule.cron}
                onChange={(e) =>
                  setSchedule({ cron: e.target.value, timezone: schedule.timezone, fixedInputs: scheduleValues })
                }
              />
              <input
                className={inputCls}
                disabled={locked}
                placeholder="IANA timezone"
                value={schedule.timezone}
                onChange={(e) =>
                  setSchedule({ cron: schedule.cron, timezone: e.target.value, fixedInputs: scheduleValues })
                }
              />
            </div>
            {noInputs ? (
              <div className="text-xs text-muted-foreground">Add {"{{inputs}}"} to the prompt to set values here.</div>
            ) : (
              a.inputs.map((inp) => (
                <div key={inp.name} className="flex items-center gap-2">
                  <span className="text-sm w-32 truncate" title={inp.name}>{inp.name}</span>
                  <span className="text-muted-foreground">=</span>
                  <input
                    className={inputCls}
                    disabled={locked}
                    placeholder="fixed value"
                    value={scheduleValues[inp.name] ?? ""}
                    onChange={(e) =>
                      setSchedule({
                        cron: schedule.cron,
                        timezone: schedule.timezone,
                        fixedInputs: pruneEmpty({ ...scheduleValues, [inp.name]: e.target.value }),
                      })
                    }
                  />
                </div>
              ))
            )}
          </>
        )}
      </div>

      {/* API */}
      <div className="border rounded-lg p-4 space-y-2">
        <div className="font-medium text-sm">&lt;/&gt; API</div>
        <div className="text-xs text-muted-foreground">
          Fire via <code className={codePill}>POST /api/agents/{a.id}/fire</code> with{" "}
          <code className={codePill}>Authorization: Bearer &lt;token&gt;</code>.
        </div>
        {revealedToken && (
          <div className="text-xs bg-muted rounded p-2 break-all">
            🔑 Copy now (shown once): <code className={codePill}>{revealedToken}</code>
          </div>
        )}
        <button className={btnGhost} onClick={issueToken}>Issue token</button>
        <ul className="text-xs text-muted-foreground space-y-1">
          {apiTokens.map((t) => (
            <li key={t.id} className="flex gap-2 items-center">
              <span>token …{t.id.slice(0, 8)} · created {t.created_at}</span>
              <button className="text-destructive underline" onClick={() => revokeToken(t.id)}>revoke</button>
            </li>
          ))}
        </ul>
      </div>

      {/* Webhook */}
      <div className="border rounded-lg p-4 space-y-2">
        <div className="font-medium text-sm">🪝 Webhook</div>
        <div className="text-xs text-muted-foreground">
          Create a webhook on the Webhooks page, then paste its ID here. Inbound events fire this agent.
        </div>
        <label className="flex gap-2 items-center text-sm">
          <input
            type="checkbox"
            disabled={locked}
            checked={Boolean(webhook)}
            onChange={(e) => setWebhook(e.target.checked ? { webhookId: "", inputsMapping: webhookPaths } : null)}
          />{" "}
          Fire from a webhook
        </label>
        {webhook && (
          <>
            <input
              className={inputCls}
              disabled={locked}
              placeholder="webhook id"
              value={webhook.webhookId}
              onChange={(e) => setWebhook({ webhookId: e.target.value, inputsMapping: webhookPaths })}
            />
            {noInputs ? (
              <div className="text-xs text-muted-foreground">Add {"{{inputs}}"} to the prompt to map them.</div>
            ) : (
              <>
                <div className="text-xs text-muted-foreground">Map each input from the payload (a JSON path):</div>
                {a.inputs.map((inp) => (
                  <div key={inp.name} className="flex items-center gap-2">
                    <span className="text-sm w-32 truncate" title={inp.name}>{inp.name}</span>
                    <span className="text-muted-foreground">←</span>
                    <input
                      className={inputCls}
                      disabled={locked}
                      placeholder="$.issue.key"
                      value={webhookPaths[inp.name] ?? ""}
                      onChange={(e) =>
                        setWebhook({
                          webhookId: webhook.webhookId,
                          inputsMapping: pruneEmpty({ ...webhookPaths, [inp.name]: e.target.value }),
                        })
                      }
                    />
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </SectionShell>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/web && npx vitest run src/components/agents/sections/TriggersSection.test.tsx`
Expected: PASS.

---

### Task 7: `AgentDetail` — Run-now form per input

**Files:**
- Modify: `packages/web/src/components/agents/AgentDetail.tsx`

- [ ] **Step 1: Add Run-now form state**

In `packages/web/src/components/agents/AgentDetail.tsx`, add these two state hooks right after the existing `const [busy, setBusy] = useState(false);` line:

```tsx
  const [showRunForm, setShowRunForm] = useState(false);
  const [runInputs, setRunInputs] = useState<Record<string, string>>({});
```

- [ ] **Step 2: Replace `runNow` to collect inputs**

Replace the entire existing `runNow` function with:

```tsx
  const openRun = () => {
    if (a.inputs.length === 0) {
      void runNow({});
      return;
    }
    setRunInputs(Object.fromEntries(a.inputs.map((i) => [i.name, ""])));
    setShowRunForm(true);
  };

  const runNow = async (inputs: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await agentsApi.runNow(wsId, a.id, inputs);
      setShowRunForm(false);
      selectSection("runs");
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };
```

- [ ] **Step 3: Point the header button at `openRun`**

In the header actions, change the Run-now button's handler from `onClick={runNow}` to:

```tsx
              <button className={btnGhost} disabled={busy} onClick={openRun}>Run now</button>
```

- [ ] **Step 4: Render the Run-now form**

Immediately after the `{locked && ( … )}` lock banner block and before `{error && …}`, insert:

```tsx
        {showRunForm && (
          <div className={`${card} p-4 space-y-3`}>
            <div className="font-medium text-sm">Run now — provide inputs</div>
            {a.inputs.map((inp) => (
              <div key={inp.name} className="flex items-center gap-2">
                <span className="text-sm w-32 truncate" title={inp.name}>{inp.name}</span>
                <input
                  className={inputCls}
                  value={runInputs[inp.name] ?? ""}
                  onChange={(e) => setRunInputs((prev) => ({ ...prev, [inp.name]: e.target.value }))}
                />
              </div>
            ))}
            <div className="flex gap-2">
              <button className={btnPrimary} disabled={busy} onClick={() => runNow(runInputs)}>Run</button>
              <button className={btnGhost} disabled={busy} onClick={() => setShowRunForm(false)}>Cancel</button>
            </div>
          </div>
        )}
```

- [ ] **Step 5: Add the `inputCls` import**

The file imports `btnPrimary, btnGhost, card` from `admin-styles.ts`. Change that import to also include `inputCls`:

```tsx
import { btnPrimary, btnGhost, card, inputCls } from "../../routes/admin-styles.ts";
```

- [ ] **Step 6: Run the existing AgentDetail test to confirm no regression**

Run: `cd packages/web && npx vitest run src/components/agents/AgentDetail.test.tsx`
Expected: PASS (3 tests — badge, default section, lock banner unaffected).

---

### Task 8: Final verification (typecheck + full tests; no commits)

- [ ] **Step 1: Full monorepo typecheck + boundaries**

Run: `cd /Users/admin/data/workspace/claude-skils/journeyman && npm run check`
Expected: typecheck passes for all packages; import boundaries clean.
(Note: a pre-existing `check:theme-colors` failure on `OrgWorkspacesPage.tsx:171 bg-black` is unrelated to this work — ignore it.)

- [ ] **Step 2: Full `@journeyman/agents` test suite**

Run: `cd packages/agents && npx vitest run`
Expected: all pass (incl. `render`, updated `compile`, updated `run-agent`).

- [ ] **Step 3: Full `@journeyman/web` test suite**

Run: `cd packages/web && npx vitest run`
Expected: all pass (incl. `detect-inputs`, `InstructionsSection`, `TriggersSection`, and the existing agent tests).

- [ ] **Step 4: Manual verification (preview)**

In the running web app: open an agent → add `{{a}} {{b}}` to the prompt → Instructions shows "Detected inputs: a b" chips → Triggers shows two webhook path rows and two schedule value rows → click **Run now** and confirm a form prompts for `a` and `b`.

**Do not commit** — leave all changes in the working tree for the user to review.

---

## Self-Review Notes

- **Spec coverage:** Part 1 detect → Task 4 (`detectInputs`) + Task 5 (sync `agent.inputs`, chips). Part 2 per-trigger fields → Task 6 (webhook paths + schedule values) + Task 7 (manual Run-now form). Part 3 substitute → Task 1 (`renderInstructions`) + Task 2 (compile) + Task 3 (thread through run-agent + webhook payload). "Missing → empty / optional inputs" → Task 1 empty-string fallback + Task 5 `required: false`. Testing section → per-task tests + Task 8.
- **Type consistency:** `renderInstructions(template, ctx)` / `RenderContext` consistent across Tasks 1–3; `compileAgentToGraph(agent, inputs, ctx)` third arg `{ payload?, triggerType? }` matches the `renderCtx`/`triggerSource` passed by `runAgent`; `detectInputs` returns `string[]` used to build `{ name, type: "text", required: false }` in Task 5 and read as `a.inputs` rows in Tasks 6–7; `pruneEmpty` defined and used only within Task 6.
- **Intentional behavior note:** `resolveInputs` is unchanged, so a legacy `required: true` input still throws on a missing value (covered by the existing, untouched run-agent/compile tests). New auto-detected inputs are always `required: false`, satisfying the "run anyway" decision.
