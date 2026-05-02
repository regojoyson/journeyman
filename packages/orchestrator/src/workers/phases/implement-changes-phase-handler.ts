import { createLogger } from "@journeyman/core";
import type {
  ICodingCLI, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderFactory,
} from "@journeyman/core";

const log = createLogger("worker:implement");

/**
 * Phase 1 wrapper around ICodingCLI.implement.
 *
 * Required input keys:
 *   - repoDir            — absolute path to the repo
 * Optional input keys:
 *   - ticketContent      — markdown body of the ticket
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
    const repoDir = input.repoDir;
    if (typeof repoDir !== "string") {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "implement requires string `repoDir`",
          retryable: false,
        },
      };
    }
    const ticketContent = typeof input.ticketContent === "string" ? input.ticketContent : undefined;
    const analyzeReportPath = typeof input.analyzeReportPath === "string" ? input.analyzeReportPath : undefined;
    const planReportPath = typeof input.planReportPath === "string" ? input.planReportPath : undefined;
    const focus = typeof input.focus === "string" ? input.focus : undefined;
    const reviewComments = typeof input.reviewComments === "string" ? input.reviewComments : undefined;
    const extraRules = Array.isArray(input.extraRules) && input.extraRules.every((r) => typeof r === "string")
      ? (input.extraRules as string[])
      : undefined;

    const coding = this.deps.coding(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Implementing ${repoDir}`);
    const result = await coding.implement({
      repoDir,
      ticketContent,
      analyzeReportPath,
      planReportPath,
      extraRules,
      focus,
      reviewComments,
      sessionId: ctx.runId,
      signal: ctx.signal,
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
