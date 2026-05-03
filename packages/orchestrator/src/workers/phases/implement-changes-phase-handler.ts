import { createLogger, isIssueLike } from "@journeyman/core";
import type {
  ICodingCLI, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderFactory,
  ResolvedMcpInstance, ResolvedSkillPackage,
} from "@journeyman/core";

const log = createLogger("worker:implement");

/**
 * Phase 1 wrapper around ICodingCLI.implement.
 *
 * Required input keys:
 *   - workspaceDir       — absolute path to the workspace root
 * Optional input keys:
 *   - issue              — full Issue object
 *   - analyzeReportPath  — explicit path to a prior analyze report
 *   - planReportPath     — explicit path to a prior plan report
 *   - extraRules         — string[] of additional rules
 *   - focus              — narrowing of scope
 *   - reviewComments     — reviewer feedback to incorporate
 *
 * Returns:
 *   - implementation     — the ImplementResult shape produced by ICodingCLI.implement
 */
export class ImplementChangesPhaseHandler implements IPhaseHandler {
  readonly phaseType = "implement-changes";

  constructor(private deps: { coding: ProviderFactory<ICodingCLI> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const workspaceDir = input.workspaceDir;
    if (typeof workspaceDir !== "string") {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "implement requires string `workspaceDir`",
          retryable: false,
        },
      };
    }
    const issue = isIssueLike(input.issue) ? input.issue : undefined;
    const analyzeReportPath = typeof input.analyzeReportPath === "string" ? input.analyzeReportPath : undefined;
    const planReportPath = typeof input.planReportPath === "string" ? input.planReportPath : undefined;
    const focus = typeof input.focus === "string" ? input.focus : undefined;
    const reviewComments = typeof input.reviewComments === "string" ? input.reviewComments : undefined;
    const extraRules = Array.isArray(input.extraRules) && input.extraRules.every((r) => typeof r === "string")
      ? (input.extraRules as string[])
      : undefined;

    const coding = this.deps.coding(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Implementing ${workspaceDir}`);
    const mcps = Array.isArray(input.mcps) ? (input.mcps as ResolvedMcpInstance[]) : undefined;
    const skills = Array.isArray(input.skills) ? (input.skills as ResolvedSkillPackage[]) : undefined;
    const result = await coding.implement({
      workspaceDir,
      issue,
      analyzeReportPath,
      planReportPath,
      extraRules,
      focus,
      reviewComments,
      sessionId: ctx.runId,
      signal: ctx.signal,
      ...(mcps ? { mcps } : {}),
      ...(skills ? { skills } : {}),
    });
    if (result && typeof result === "object" && "error" in result && (result as any).error) {
      log.error({ result }, "implement failed");
      return {
        kind: "failure",
        failure: {
          errorClass: "ImplementFailed",
          message: String((result as any).error),
          retryable: true,
        },
      };
    }
    return { kind: "success", output: { implementation: result } };
  }
}
