import { createLogger, isIssueLike } from "@journeyman/core";
import type {
  ICodingCLI, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderFactory,
  ResolvedMcpInstance,
} from "@journeyman/core";

const log = createLogger("worker:plan");

/**
 * Phase 1 wrapper around ICodingCLI.plan.
 *
 * Required input keys:
 *   - workspaceDir       — absolute path to the workspace root
 * Optional input keys:
 *   - issue              — full Issue object
 *   - analyzeReportPath  — explicit path to a prior analyze report
 *   - focus              — narrowing of scope
 *   - reviewComments     — reviewer feedback to incorporate
 *
 * Returns:
 *   - plan               — the PlanResult shape produced by ICodingCLI.plan
 */
export class PlanImplementationPhaseHandler implements IPhaseHandler {
  readonly phaseType = "plan-implementation";

  constructor(private deps: { coding: ProviderFactory<ICodingCLI> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const workspaceDir = input.workspaceDir;
    if (typeof workspaceDir !== "string") {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "plan requires string `workspaceDir`",
          retryable: false,
        },
      };
    }
    const issue = isIssueLike(input.issue) ? input.issue : undefined;
    const analyzeReportPath = typeof input.analyzeReportPath === "string" ? input.analyzeReportPath : undefined;
    const focus = typeof input.focus === "string" ? input.focus : undefined;
    const reviewComments = typeof input.reviewComments === "string" ? input.reviewComments : undefined;

    const coding = this.deps.coding(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Planning ${workspaceDir}`);
    const mcps = Array.isArray(input.mcps) ? (input.mcps as ResolvedMcpInstance[]) : undefined;
    const result = await coding.plan({
      workspaceDir,
      issue,
      analyzeReportPath,
      focus,
      reviewComments,
      sessionId: ctx.runId,
      signal: ctx.signal,
      ...(mcps ? { mcps } : {}),
    });
    if (result && typeof result === "object" && "error" in result && (result as any).error) {
      log.error({ result }, "plan failed");
      return {
        kind: "failure",
        failure: {
          errorClass: "PlanFailed",
          message: String((result as any).error),
          retryable: true,
        },
      };
    }
    return {
      kind: "success",
      output: {
        steps: result.steps.map((s) => s.title),
        affectedFiles: result.affectedFiles,
        estimatedComplexity: result.estimatedComplexity,
        planReportPath: result.reportPath,
      },
    };
  }
}
