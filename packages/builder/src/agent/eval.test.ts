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
    expect(evaluatePlan(plan, [noRequiredGaps()])[0].pass).toBe(true);
  });
});

describe("runEval", () => {
  it("runs goals through an injected caller and scores the resulting plans", async () => {
    const caller: BuilderModelCaller = { call: async () => ({ text: "ok", proposedIntent: qa.intent }) };
    const report = await runEval({ caller }, "sys", [
      { goal: "qa", checks: [hasNodeType("gateway-xor")] },
    ]);
    expect(report[0].score).toEqual({ passed: 1, total: 1 });
    expect(report[0].produced).toBe(true);
  });

  it("marks all checks failed when the agent produces no plan", async () => {
    const caller: BuilderModelCaller = { call: async () => ({ text: "Which repo?", proposedIntent: null }) };
    const report = await runEval({ caller }, "sys", [{ goal: "x", checks: [hasNodeType("step")] }]);
    expect(report[0].produced).toBe(false);
    expect(report[0].score).toEqual({ passed: 0, total: 1 });
  });
});
