# Journeyman Builder — Phase 3c: Prompt Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the agent's instructions from a *guardrail* into a *playbook* — add reference workflow patterns (dev / QA / SRE / review) and richer custom-step authoring guidance to the system prompt, embed **validated few-shot examples** (real intents that tests prove assemble correctly), and add an **eval harness** so plan quality is measurable.

**Architecture:** Everything lives in `@journeyman/builder/src/agent/`. Few-shot examples are typed `AssemblerIntent` objects in `examples.ts`, **proven correct by unit tests** (they validate against the schema and assemble to graphs with the expected shape), then serialized into the system prompt — so the prompt's examples can never drift from what the assembler actually accepts. The eval harness (`eval.ts`) is a pure `evaluatePlan(plan, checks)` scorer + reusable check builders + an injectable `runEval(caller, …)` (testable with a fake model); a real-model eval run is documented (needs the key).

**Tech Stack:** TypeScript (ESM), Vitest. Pure functions + string assembly.

**Constraints (from the user):** **No `git commit` steps.** **Final step is `npm run check`.** Each task ends by running its tests.

**Reference:** Spec `docs/superpowers/specs/2026-06-13-journeyman-builder-design.md` (behavioral rules + reference dev-flow pattern). Builds on Phase 3b (`buildSystemPrompt`, `assemblerIntentSchema`, `assemble`, `planFromIntent`).

---

## File Structure (Phase 3c)

**Create:**
- `packages/builder/src/agent/examples.ts` — `FEW_SHOT_EXAMPLES` (dev / QA-branch / SRE) + `serializeFewShotExamples`
- `packages/builder/src/agent/examples.test.ts`
- `packages/builder/src/agent/eval.ts` — `evaluatePlan`, check builders, `runEval`
- `packages/builder/src/agent/eval.test.ts`

**Modify:**
- `packages/builder/src/agent/prompt.ts` — add reference playbooks + expanded authoring guidance; append serialized few-shot examples
- `packages/builder/src/agent/prompt.test.ts` — assert playbooks + examples present
- `packages/builder/src/index.ts` — export examples + eval surface

---

## Task 1: Reference playbooks + authoring guidance in the prompt

**Files:**
- Modify: `packages/builder/src/agent/prompt.ts`, `packages/builder/src/agent/prompt.test.ts`

- [ ] **Step 1: Extend the prompt test (add playbook + authoring assertions)**

In `packages/builder/src/agent/prompt.test.ts`, replace the `buildSystemPrompt` describe block with:

```ts
describe("buildSystemPrompt", () => {
  it("states the intent contract, the proposePlan tool, and the no-invented-steps rule", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("proposePlan");
    expect(p.toLowerCase()).toContain("only");
    expect(p.toLowerCase()).toContain("clarify");
  });
  it("includes reference playbooks for the common scenarios", () => {
    const p = buildSystemPrompt().toLowerCase();
    expect(p).toContain("development");
    expect(p).toContain("qa");
    expect(p).toContain("sre");
    expect(p).toContain("review");
  });
  it("gives custom-step authoring guidance (prompt template + inputs/outputs)", () => {
    const p = buildSystemPrompt().toLowerCase();
    expect(p).toContain("prompttemplate");
    expect(p).toContain("outputmode");
  });
  it("embeds at least one worked example", () => {
    expect(buildSystemPrompt()).toContain("Goal:");
    expect(buildSystemPrompt()).toContain("proposePlan input:");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/builder/src/agent/prompt.test.ts`
Expected: FAIL — playbooks / authoring / example assertions not yet present.

- [ ] **Step 3: Rewrite `buildSystemPrompt` in `packages/builder/src/agent/prompt.ts`**

Add the import at the top:
```ts
import { serializeFewShotExamples } from "./examples.ts";
```
Replace the `buildSystemPrompt` function with:

```ts
/** The Builder's static system prompt (rules + playbooks + worked examples). */
export function buildSystemPrompt(): string {
  return [
    "You are the Journeyman Builder. You turn a user's goal into a workflow plan.",
    "",
    "## How you work",
    "- Clarify the goal by asking questions ONE at a time until you understand it. Reply in plain language.",
    "- You do NOT write graph JSON, node ids, reference strings, or JSONPath. You express INTENT; a deterministic assembler emits the wiring.",
    "- When you have enough information, call the `proposePlan` tool with the full intent. Otherwise just reply with your question.",
    "",
    "## Hard rules",
    "- Use ONLY step types, providers, and node types listed in the context message. Never invent one.",
    "- Only propose a provider step whose provider is in the implemented-providers list. If the goal needs an unavailable provider, prefer an implemented alternative and say so, or describe it as a gap.",
    "- If an action has no step type, route it through a custom-AI step (define it in newCustomSteps) using tools/an MCP, or describe it as a gap.",
    "- Reuse an existing custom step when one closely matches; only define a new one when needed.",
    "- A coding step that is followed by opening a PR/MR must also commit and push (say so in its prompt).",
    "- For Jira/ticket status changes, ask the user for the exact status names (do not guess).",
    "- In-flow error branches do not run; for failure handling offer retry or an out-of-band alert.",
    "- Mark steps that touch production or hold broad credentials as risky and suggest a human-task gate before irreversible actions.",
    "",
    "## Authoring a custom-AI step (newCustomSteps)",
    "- Give it a clear `name` and a `promptTemplate` that tells the inner AI exactly what to do; reference its inputs as {{input.<field>}}.",
    "- Declare `inputFields` for everything the prompt needs, and set `outputMode` (\"text\" for a summary, \"structured\" + `outputFields` when later steps or branches read specific fields).",
    "- Give it the tools it needs (e.g. read-file/search for review; bash/edit-file for coding) — nothing more.",
    "- Prefer an existing provider step when one already does the job; only write a custom-AI step for AI reasoning or actions no step covers.",
    "",
    "## Reference playbooks (adapt; don't follow blindly)",
    "- Development (ticket → PR): webhook on the ticket-ready transition → get-issue → clone-repos → a custom-AI 'implement' step (codes AND commits+pushes) → open-pull-request → optionally a human-task to wait for review approval.",
    "- QA / test: manual or webhook trigger → checkout → a custom-AI 'run tests' step (bash, in a sandbox with the toolchain) emitting a structured pass/fail → a gateway branching on pass/fail → comment results on the PR (pass) vs. flag (fail).",
    "- SRE / remediation: webhook on an alert (generic preset; ask for a sample payload) → a custom-AI 'investigate' step → a human-task approval gate → a custom-AI 'remediate' step (mark it risky) → confirm.",
    "- Code review: webhook on PR opened → a custom-AI 'review' step (read-file/search) emitting findings → comment-on-pull-request.",
    "",
    "## Worked examples",
    serializeFewShotExamples(),
  ].join("\n");
}
```

- [ ] **Step 4: (defer running until Task 2)** — `buildSystemPrompt` now imports `./examples.ts`, which Task 2 creates. Proceed to Task 2, then run the prompt test.

---

## Task 2: Validated few-shot examples

**Files:**
- Create: `packages/builder/src/agent/examples.ts`, `…/examples.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/builder/src/agent/examples.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { FEW_SHOT_EXAMPLES, serializeFewShotExamples } from "./examples.ts";
import { assemblerIntentSchema } from "./intent-schema.ts";
import { assemble } from "../assembler/assemble.ts";

describe("FEW_SHOT_EXAMPLES", () => {
  it("has dev, qa and sre examples", () => {
    const goals = FEW_SHOT_EXAMPLES.map((e) => e.goal.toLowerCase()).join(" | ");
    expect(goals).toMatch(/ticket|develop|pr/);
    expect(goals).toMatch(/test|qa/);
    expect(goals).toMatch(/alert|sre|incident/);
  });

  it("every example validates against the intent schema", () => {
    for (const ex of FEW_SHOT_EXAMPLES) {
      expect(() => assemblerIntentSchema.parse(ex.intent)).not.toThrow();
    }
  });

  it("every example assembles to a graph whose edges connect real nodes", () => {
    for (const ex of FEW_SHOT_EXAMPLES) {
      const { workflow } = assemble(ex.intent);
      const ids = new Set(workflow.nodes.map((n) => n.id));
      expect(workflow.nodes.length).toBeGreaterThan(0);
      for (const e of workflow.edges) {
        expect(ids.has(e.source)).toBe(true);
        expect(ids.has(e.target)).toBe(true);
      }
    }
  });

  it("the QA example uses a gateway, the SRE example a human-task", () => {
    const qa = FEW_SHOT_EXAMPLES.find((e) => /test|qa/i.test(e.goal))!;
    const sre = FEW_SHOT_EXAMPLES.find((e) => /alert|sre|incident/i.test(e.goal))!;
    expect(assemble(qa.intent).workflow.nodes.some((n) => n.type === "gateway-xor")).toBe(true);
    expect(assemble(sre.intent).workflow.nodes.some((n) => n.type === "human-task")).toBe(true);
  });

  it("serializes to text containing each goal and the proposePlan label", () => {
    const text = serializeFewShotExamples();
    expect(text).toContain("Goal:");
    expect(text).toContain("proposePlan input:");
    for (const ex of FEW_SHOT_EXAMPLES) expect(text).toContain(ex.goal);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/builder/src/agent/examples.test.ts`
Expected: FAIL — cannot resolve `./examples.ts`.

- [ ] **Step 3: Create `packages/builder/src/agent/examples.ts`**

```ts
import type { AssemblerIntent } from "../assembler/intent.ts";

export interface FewShotExample {
  goal: string;
  intent: AssemblerIntent;
}

/** Development: ticket → branch → implement(+commit/push) → PR → wait for approval. */
const dev: FewShotExample = {
  goal: "When a ticket moves to Ready for Development, implement it and open a PR, then wait for approval.",
  intent: {
    summary: "Implement a Jira ticket and open a PR, then pause for review approval.",
    triggers: [{
      kind: "webhook", webhookId: null, listensFor: ["jira:issue_updated"],
      inputs: [{ name: "issueKey", type: "string", fromPath: "$.issue.key" }],
    }],
    steps: [
      { ref: "ticket", kind: "provider", label: "Get ticket", stepType: "get-issue", provider: "jira",
        inputs: [{ slot: "ref", value: { from: "workflow-input", name: "issueKey" } }] },
      { ref: "clone", kind: "provider", label: "Clone repos", stepType: "clone-repos", provider: "github" },
      { ref: "impl", kind: "ai", label: "Implement the change", stepType: "custom-ai", customStepId: "tmp-impl",
        tools: ["read-file", "edit-file", "bash"],
        inputs: [{ slot: "issue", value: { from: "step-output", stepRef: "ticket", field: "issue" } }] },
      { ref: "pr", kind: "provider", label: "Open pull request", stepType: "open-pull-request", provider: "github" },
      { ref: "review", kind: "human-task", label: "Wait for review approval", assignee: "team", taskPrompt: "Approve this PR?" },
    ],
    newCustomSteps: [{
      id: "tmp-impl",
      step: {
        scope: "user", name: "Implement ticket",
        promptTemplate: "Implement the change described in {{input.issue}}. When done, run git add/commit and push the branch.",
        inputFields: [{ name: "issue", type: "json-object", required: true }],
        outputMode: "text",
        defaultTools: ["read-file", "edit-file", "bash"],
      },
    }],
  },
};

/** QA: run tests, branch on pass/fail, comment the result. */
const qa: FewShotExample = {
  goal: "Run the test suite for a PR and comment pass or fail on the PR.",
  intent: {
    summary: "Run tests for a PR and report the result on the PR.",
    triggers: [{ kind: "manual" }],
    steps: [
      { ref: "test", kind: "ai", label: "Run tests", stepType: "custom-ai", customStepId: "tmp-test",
        tools: ["bash"], sandboxId: undefined },
    ],
    gateway: {
      ref: "gate", label: "Tests passed?",
      branches: [{
        label: "passed",
        condition: { left: { from: "step-output", stepRef: "test", field: "passed" }, op: "==", right: true },
        steps: [{ ref: "ok", kind: "provider", label: "Comment success", stepType: "comment-on-pull-request", provider: "github" }],
      }],
      elseBranch: { steps: [{ ref: "fail", kind: "provider", label: "Comment failure", stepType: "comment-on-pull-request", provider: "github" }] },
    },
    newCustomSteps: [{
      id: "tmp-test",
      step: {
        scope: "user", name: "Run tests",
        promptTemplate: "Run the project's test suite with bash and report whether it passed.",
        outputMode: "structured",
        outputFields: [{ name: "passed", type: "boolean", required: true }],
        defaultTools: ["bash"],
      },
    }],
  },
};

/** SRE: alert → investigate → human approval → remediate → confirm. */
const sre: FewShotExample = {
  goal: "When an alert fires, investigate, wait for an engineer to approve, then apply the fix.",
  intent: {
    summary: "Investigate an incident alert, get human approval, then remediate.",
    triggers: [{
      kind: "webhook", webhookId: null, listensFor: [],
      inputs: [{ name: "service", type: "string", fromPath: "$.service" }],
    }],
    steps: [
      { ref: "investigate", kind: "ai", label: "Investigate", stepType: "custom-ai", customStepId: "tmp-inv",
        tools: ["bash"],
        inputs: [{ slot: "service", value: { from: "workflow-input", name: "service" } }] },
      { ref: "approve", kind: "human-task", label: "Approve remediation", assignee: "oncall", taskPrompt: "Approve the proposed fix?" },
      { ref: "remediate", kind: "ai", label: "Apply the fix (production)", stepType: "custom-ai", customStepId: "tmp-fix",
        tools: ["bash"] },
    ],
    newCustomSteps: [
      { id: "tmp-inv", step: { scope: "user", name: "Investigate incident",
        promptTemplate: "Investigate the alert for {{input.service}} and propose a fix.",
        inputFields: [{ name: "service", type: "string", required: true }],
        outputMode: "text", defaultTools: ["bash"] } },
      { id: "tmp-fix", step: { scope: "user", name: "Apply remediation",
        promptTemplate: "Apply the approved fix in production, carefully.",
        outputMode: "text", defaultTools: ["bash"] } },
    ],
  },
};

export const FEW_SHOT_EXAMPLES: FewShotExample[] = [dev, qa, sre];

/** Render the examples as prompt text (goal + the intent the model should produce). */
export function serializeFewShotExamples(examples: FewShotExample[] = FEW_SHOT_EXAMPLES): string {
  return examples
    .map((e) => `Goal: ${e.goal}\nproposePlan input:\n${JSON.stringify(e.intent, null, 2)}`)
    .join("\n\n");
}
```

- [ ] **Step 4: Run the examples test to verify it passes**

Run: `npx vitest run packages/builder/src/agent/examples.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the prompt test (now that `examples.ts` exists)**

Run: `npx vitest run packages/builder/src/agent/prompt.test.ts`
Expected: PASS (4 tests) — playbooks, authoring guidance, and an embedded example are present.

---

## Task 3: Eval harness

**Files:**
- Create: `packages/builder/src/agent/eval.ts`, `…/eval.test.ts`
- Modify: `packages/builder/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/builder/src/agent/eval.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  evaluatePlan, scoreEval, hasStepType, hasNodeType, definesCustomStep, noRequiredGaps, runEval,
} from "./eval.ts";
import { planFromIntent } from "./runner.ts";
import { FEW_SHOT_EXAMPLES } from "./examples.ts";
import type { BuilderModelCaller } from "./runner.ts";

const qa = FEW_SHOT_EXAMPLES.find((e) => /test|qa/i.test(e.goal))!;

describe("evaluatePlan", () => {
  it("scores checks against a plan", () => {
    const plan = planFromIntent(qa.intent);
    const results = evaluatePlan(plan, [
      hasNodeType("gateway-xor"),
      hasStepType("comment-on-pull-request"),
      definesCustomStep(),
    ]);
    expect(results.every((r) => r.pass)).toBe(true);
    expect(scoreEval(results)).toEqual({ passed: 3, total: 3 });
  });

  it("a missing-thing check fails", () => {
    const plan = planFromIntent(qa.intent);
    const [r] = evaluatePlan(plan, [hasStepType("send-message")]);
    expect(r.pass).toBe(false);
  });

  it("noRequiredGaps detects a required gap", () => {
    const plan = planFromIntent(qa.intent);
    expect(evaluatePlan(plan, [noRequiredGaps()])[0].pass).toBe(true); // QA example has no required gaps
  });
});

describe("runEval", () => {
  it("runs goals through an injected caller and scores the resulting plans", async () => {
    const caller: BuilderModelCaller = { call: async () => ({ text: "ok", proposedIntent: qa.intent }) };
    const report = await runEval({ caller }, "sys", [
      { goal: "qa", checks: [hasNodeType("gateway-xor")] },
    ]);
    expect(report[0].score).toEqual({ passed: 1, total: 1 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/builder/src/agent/eval.test.ts`
Expected: FAIL — cannot resolve `./eval.ts`.

- [ ] **Step 3: Create `packages/builder/src/agent/eval.ts`**

```ts
import type { BuildPlan, WorkflowNodeType } from "@journeyman/core";
import { runBuilderTurn, type BuilderModelCaller, type ChatMessage } from "./runner.ts";

export interface PlanCheck {
  name: string;
  check: (plan: BuildPlan) => boolean;
}

export interface EvalCase {
  goal: string;
  checks: PlanCheck[];
}

export function hasStepType(stepType: string): PlanCheck {
  return { name: `has step ${stepType}`, check: (p) => p.workflow.nodes.some((n) => n.stepType === stepType) };
}

export function hasNodeType(t: WorkflowNodeType): PlanCheck {
  return { name: `has node ${t}`, check: (p) => p.workflow.nodes.some((n) => n.type === t) };
}

export function definesCustomStep(): PlanCheck {
  return { name: "defines a custom step", check: (p) => p.newCustomSteps.length > 0 };
}

export function noRequiredGaps(): PlanCheck {
  return { name: "no required gaps", check: (p) => !p.gaps.some((g) => g.required) };
}

export interface CheckResult { name: string; pass: boolean; }

export function evaluatePlan(plan: BuildPlan, checks: PlanCheck[]): CheckResult[] {
  return checks.map((c) => ({ name: c.name, pass: c.check(plan) }));
}

export function scoreEval(results: CheckResult[]): { passed: number; total: number } {
  return { passed: results.filter((r) => r.pass).length, total: results.length };
}

export interface EvalReport {
  goal: string;
  produced: boolean;            // did the agent produce a plan at all?
  results: CheckResult[];
  score: { passed: number; total: number };
}

/**
 * Run each goal through an injected caller and score the produced plan.
 * Inject a real `makeAiSdkCaller(model)` for a live eval, or a fake in tests.
 */
export async function runEval(
  deps: { caller: BuilderModelCaller },
  system: string,
  cases: EvalCase[],
): Promise<EvalReport[]> {
  const reports: EvalReport[] = [];
  for (const ec of cases) {
    const messages: ChatMessage[] = [{ role: "user", content: ec.goal }];
    const { plan } = await runBuilderTurn(deps, { system, messages });
    const results = plan ? evaluatePlan(plan, ec.checks) : ec.checks.map((c) => ({ name: c.name, pass: false }));
    reports.push({ goal: ec.goal, produced: plan !== null, results, score: scoreEval(results) });
  }
  return reports;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/builder/src/agent/eval.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Export the new surface from `packages/builder/src/index.ts`**

```ts
export { FEW_SHOT_EXAMPLES, serializeFewShotExamples, type FewShotExample } from "./agent/examples.ts";
export {
  evaluatePlan, scoreEval, runEval,
  hasStepType, hasNodeType, definesCustomStep, noRequiredGaps,
  type PlanCheck, type EvalCase, type EvalReport, type CheckResult,
} from "./agent/eval.ts";
```

- [ ] **Step 6: Run the whole builder package's tests**

Run: `npm test -w @journeyman/builder`
Expected: PASS — all prior suites + examples + eval, and the updated prompt suite.

---

## Final: Typecheck the whole repo (no commit)

- [ ] **Step 1: Run the full type + import-boundary check**

Run: `npm run check`
Expected: PASS — `npm run typecheck` (all workspaces) and `npm run check:boundaries`. **Do not commit** — leave changes for review.

---

## How to run a live eval (manual, needs the key)

With `BUILDER_LLM_*` set, wire the real caller and your eval cases:
```ts
const model = await resolveBuilderModel(builderLlmEnvFromProcess());
const system = `${buildSystemPrompt()}\n\n${/* context for an empty inventory */ ""}`;
const report = await runEval({ caller: makeAiSdkCaller(model) }, system, [
  { goal: "review my PRs for security and comment", checks: [hasStepType("comment-on-pull-request"), definesCustomStep()] },
  { goal: "run tests and branch on pass/fail",        checks: [hasNodeType("gateway-xor")] },
]);
console.table(report.map((r) => ({ goal: r.goal, ...r.score, produced: r.produced })));
```
This is the loop to iterate the prompt with evidence: add a case, run, see which checks fail, adjust the playbooks/examples, re-run.

---

## Self-review checklist (run before handoff)

- **Spec coverage (Phase 3c):** reference playbooks (dev/QA/SRE/review) ✓ + authoring guidance ✓ (Task 1); validated few-shot examples embedded in the prompt ✓ (Task 2); eval harness (scorer + checks + injectable runner) ✓ (Task 3).
- **No placeholders:** complete code in every step; commands + expected results on every run step.
- **Examples can't drift:** `examples.test.ts` proves each few-shot validates against `assemblerIntentSchema` and assembles to a well-connected graph — so the prompt never teaches a shape the assembler would reject.
- **Type consistency:** `FewShotExample`/`PlanCheck`/`EvalCase`/`EvalReport` defined once; `runEval` reuses `runBuilderTurn` + `evaluatePlan`; checks operate on `BuildPlan` (core).
- **Quality is now measurable:** `runEval` + check builders give an evidence loop; a live run needs the `BUILDER_LLM_*` key.
- **No commit steps anywhere; final step is `npm run check`.** ✓

> Note: `qa` example sets `sandboxId: undefined` deliberately (the user picks a sandbox at review time, per the "running tests = user-chosen sandbox" rule); it assembles fine and carries no required gap.
