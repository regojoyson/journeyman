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
