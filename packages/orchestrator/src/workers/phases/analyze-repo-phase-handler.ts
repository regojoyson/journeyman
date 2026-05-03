import { createLogger, isIssueLike } from "@journeyman/core";
import type {
  ICodingCLI, IPhaseHandler, PhaseContext, PhaseInput, PhaseRunResult, ProviderFactory,
  ResolvedMcpInstance,
} from "@journeyman/core";

const log = createLogger("worker:analyze");

/**
 * Phase 1 wrapper around the existing analyze logic. Calls ICodingCLI.analyze
 * directly, bypassing the legacy PipelineContext.
 *
 * Required input keys:
 *   - workspaceDir — absolute path to the workspace root (string)
 *   - issue        — full Issue object (id + title required)
 *
 * Returns:
 *   - analysis     — the AnalyzeResult shape produced by ICodingCLI.analyze
 */
export class AnalyzeRepoPhaseHandler implements IPhaseHandler {
  readonly phaseType = "analyze-repo";

  constructor(private deps: { coding: ProviderFactory<ICodingCLI> }) {}

  async run(input: PhaseInput, ctx: PhaseContext): Promise<PhaseRunResult> {
    const workspaceDir = input.workspaceDir;
    const issue = input.issue;
    if (typeof workspaceDir !== "string" || !isIssueLike(issue)) {
      return {
        kind: "failure",
        failure: {
          errorClass: "InvalidInput",
          message: "analyze requires string `workspaceDir` and an `issue` object with `id` and `title`",
          retryable: false,
        },
      };
    }
    const coding = this.deps.coding(typeof input.provider === "string" ? input.provider : undefined, ctx.env);
    ctx.log(`Analyzing ${workspaceDir}`);
    const mcps = Array.isArray(input.mcps) ? (input.mcps as ResolvedMcpInstance[]) : undefined;
    const result = await coding.analyze({
      workspaceDir,
      issue,
      sessionId: ctx.runId,
      signal: ctx.signal,
      ...(mcps ? { mcps } : {}),
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
