import type { BuildPlan } from "@journeyman/core";
import type { BuilderSessionRecord } from "../types.ts";
import type { ApplyArgs } from "./apply.ts";

/** Derive executor ApplyArgs from a builder session + auth context. */
export function buildApplyArgs(
  session: BuilderSessionRecord,
  ctx: { orgId: string; userId: string; workspaceId: string },
): ApplyArgs {
  return {
    plan: session.buildPlan as BuildPlan,
    workflowName: session.name,
    createdBy: ctx.userId,
    workspaceId: ctx.workspaceId,
  };
}

/** True if the plan still has any required gap (blocks Apply). */
export function requiredGapsRemaining(plan: BuildPlan): boolean {
  return plan.gaps.some((g) => g.required);
}
