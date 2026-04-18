import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { AnalyzeResult, PhaseResult, PipelineContext } from "@journeyman/core";

export class AnalyzePhase extends BasePhase {
  readonly name = "analyze";
  static reads = ["primaryRepoPath", "ticketMd"] as const;
  static writes = ["analysis"] as const;

  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const primaryRepoPath = this.require<string>(ctx, "primaryRepoPath");
    const ticketMd = this.require<string>(ctx, "ticketMd");

    const result = unwrap(await ctx.providers.coding.analyze({
      dirPath: primaryRepoPath,
      ticketContent: ticketMd,
      sessionId: ctx.sessionId,
      signal: ctx.signal,
    }), "analyze") as AnalyzeResult;

    const reportHandle = await ctx.artifactStore.putPath(
      ctx.sessionId, "analyze-report", result.reportPath,
      { contentType: "text/markdown" },
    );

    return this.ok({ analysis: { ...result, reportHandle } });
  }
}
