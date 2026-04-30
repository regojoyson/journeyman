import { createLogger } from "@journeyman/core";
import type {
  ICodingCLI, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderResolver,
} from "@journeyman/core";

const log = createLogger("worker:plan");

/**
 * Phase 1 wrapper around ICodingCLI.plan.
 *
 * Required input keys:
 *   - dirPath            — absolute path to the repo
 * Optional input keys:
 *   - ticketContent      — markdown body of the ticket
 *   - analyzeReportPath  — explicit path to a prior analyze report
 *   - focus              — narrowing of scope
 *   - reviewComments     — reviewer feedback to incorporate
 *
 * Returns:
 *   - plan               — the PlanResult shape produced by ICodingCLI.plan
 */
export class PlanImplementationPhaseHandler implements IPhaseHandler {
  readonly phaseType = "plan-implementation";

  constructor(private deps: { coding: ProviderResolver<ICodingCLI> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const dirPath = input.dirPath;
    if (typeof dirPath !== "string") {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "plan requires string `dirPath`",
          retryable: false,
        },
      };
    }
    const ticketContent = typeof input.ticketContent === "string" ? input.ticketContent : undefined;
    const analyzeReportPath = typeof input.analyzeReportPath === "string" ? input.analyzeReportPath : undefined;
    const focus = typeof input.focus === "string" ? input.focus : undefined;
    const reviewComments = typeof input.reviewComments === "string" ? input.reviewComments : undefined;

    const coding = this.deps.coding.resolve(
      typeof input.provider === "string" ? input.provider : undefined,
    );
    ctx.log(`Planning ${dirPath}`);
    const result = await coding.plan({
      dirPath,
      ticketContent,
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
    return { kind: "success", output: { plan: result } };
  }
}
