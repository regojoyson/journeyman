import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { AnalyzeResult, PhaseResult, PipelineContext, PlanResult } from "@journeyman/core";

export class PlanPhase extends BasePhase {
  readonly name = "plan";
  static reads = ["analysis", "ticketMd", "primaryRepoPath"] as const;
  static writes = ["plan"] as const;

  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const analysis = this.require<AnalyzeResult>(ctx, "analysis");
    const primaryRepoPath = this.require<string>(ctx, "primaryRepoPath");
    const ticketMd = this.require<string>(ctx, "ticketMd");

    const result = unwrap(await ctx.providers.coding.plan({
      dirPath: primaryRepoPath,
      ticketContent: ticketMd,
      analyzeReportPath: analysis.reportPath,
      sessionId: ctx.sessionId,
      signal: ctx.signal,
    }), "plan") as PlanResult;

    const reportHandle = await ctx.artifactStore.putPath(
      ctx.sessionId, "plan-report", result.reportPath,
      { contentType: "text/markdown" },
    );

    return this.ok({ plan: { ...result, reportHandle } });
  }
}
