import type { BuildPlan } from "@journeyman/core";
import type { BuilderSessionRecord } from "../types.ts";
import type { ApplyArgs } from "./apply.ts";

/** Derive executor ApplyArgs from a (user-scoped) builder session + auth context. */
export function buildApplyArgs(
  session: BuilderSessionRecord,
  ctx: { orgId: string; userId: string },
): ApplyArgs {
  return {
    plan: session.buildPlan as BuildPlan,
    workflowName: session.name,
    scope: "user",
    orgId: ctx.orgId,
    userId: ctx.userId,
    createdBy: ctx.userId,
  };
}

/** True if the plan still has any required gap (blocks Apply). */
export function requiredGapsRemaining(plan: BuildPlan): boolean {
  return plan.gaps.some((g) => g.required);
}
