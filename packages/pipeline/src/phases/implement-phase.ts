import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { AnalyzeResult, ImplementResult, PhaseResult, PipelineContext, PlanResult } from "@journeyman/core";

export class ImplementPhase extends BasePhase {
  readonly name = "implement";
  static reads = ["plan", "primaryRepoPath", "ticketMd"] as const;
  static writes = ["implementation"] as const;

  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const plan = this.require<PlanResult>(ctx, "plan");
    const analysis = this.optional<AnalyzeResult>(ctx, "analysis");
    const primaryRepoPath = this.require<string>(ctx, "primaryRepoPath");
    const ticketMd = this.require<string>(ctx, "ticketMd");

    const result = unwrap(await ctx.providers.coding.implement({
      dirPath: primaryRepoPath,
      ticketContent: ticketMd,
      analyzeReportPath: analysis?.reportPath,
      planReportPath: plan.reportPath,
      sessionId: ctx.sessionId,
      signal: ctx.signal,
    }), "implement") as ImplementResult;

    if (!result.success) return this.failed(result.error ?? "implement returned success=false");

    const reportHandle = await ctx.artifactStore.putPath(
      ctx.sessionId, "implement-report", result.reportPath,
      { contentType: "text/markdown" },
    );

    return this.ok({ implementation: { ...result, reportHandle } });
  }
}
