import { createLogger } from "@journeyman/core";
import type {
  ICodingCLI, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderFactory,
} from "@journeyman/core";

const log = createLogger("worker:analyze");

/**
 * Phase 1 wrapper around the existing analyze logic. Calls ICodingCLI.analyze
 * directly, bypassing the legacy PipelineContext.
 *
 * Required input keys (all strings):
 *   - repoDir        — absolute path to the repo to analyze
 *   - issueContent  — markdown body of the issue
 *
 * Returns:
 *   - analysis       — the AnalyzeResult shape produced by ICodingCLI.analyze
 */
export class AnalyzeRepoPhaseHandler implements IPhaseHandler {
  readonly phaseType = "analyze-repo";

  constructor(private deps: { coding: ProviderFactory<ICodingCLI> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const repoDir = input.repoDir;
    const issueContent = input.issueContent;
    if (typeof repoDir !== "string" || typeof issueContent !== "string") {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "analyze requires string `repoDir` and `issueContent`",
          retryable: false,
        },
      };
    }
    const coding = this.deps.coding(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Analyzing ${repoDir}`);
    const result = await coding.analyze({
      repoDir,
      issueContent,
      sessionId: ctx.runId,
      signal: ctx.signal,
    });
    if (result && typeof result === "object" && "error" in result && (result as any).error) {
      log.error({ result }, "analyze failed");
      return {
        kind: "failure",
        failure: {
          errorClass: "AnalyzeFailed",
          message: String((result as any).error),
          retryable: true,
        },
      };
    }
    return {
      kind: "success",
      output: {
        summary: result.summary,
        complexity: result.complexity,
        affectedFiles: result.affectedAreas,
        analyzeReportPath: result.reportPath,
      },
    };
  }
}
