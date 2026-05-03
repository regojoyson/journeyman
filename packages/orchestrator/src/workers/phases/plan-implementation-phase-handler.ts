import { createLogger } from "@journeyman/core";
import type {
  ICodingCLI, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderFactory,
} from "@journeyman/core";

const log = createLogger("worker:plan");

/**
 * Phase 1 wrapper around ICodingCLI.plan.
 *
 * Required input keys:
 *   - repoDir            — absolute path to the repo
 * Optional input keys:
 *   - issueContent      — markdown body of the issue
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
    const repoDir = input.repoDir;
    if (typeof repoDir !== "string") {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "plan requires string `repoDir`",
          retryable: false,
        },
      };
    }
    const issueContent = typeof input.issueContent === "string" ? input.issueContent : undefined;
    const analyzeReportPath = typeof input.analyzeReportPath === "string" ? input.analyzeReportPath : undefined;
    const focus = typeof input.focus === "string" ? input.focus : undefined;
    const reviewComments = typeof input.reviewComments === "string" ? input.reviewComments : undefined;

    const coding = this.deps.coding(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Planning ${repoDir}`);
    const result = await coding.plan({
      repoDir,
      issueContent,
      analyzeReportPath,
      focus,
      reviewComments,
      sessionId: ctx.runId,
      signal: ctx.signal,
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
