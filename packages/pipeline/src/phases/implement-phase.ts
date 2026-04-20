/**
 * @file implement-phase.ts
 * Applies the implementation plan to the working tree, producing code changes.
 *
 * Reads:  plan            — PlanResult from the plan phase.
 *         primaryRepoPath — local repo path where changes will be written.
 *         ticketMd        — markdown ticket description for additional context.
 *         analysis        — optional AnalyzeResult; passed to provider when available.
 * Writes: implementation — ImplementResult including a diff/summary reportHandle.
 *
 * Fails immediately if the provider returns `success: false` (e.g. the AI detected
 * unresolvable conflicts or test failures during implementation).
 *
 * Failure modes: provider error, merge conflicts, file-system permission errors,
 * test failures detected during implementation.
 * Side effects: mutates files under primaryRepoPath; writes one artifact blob.
 */

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
      reviewComments: ctx.artifacts.reviewComments as string | undefined,
    }), "implement") as ImplementResult;

    if (!result.success) return this.failed(result.error ?? "implement returned success=false");

    const reportHandle = await ctx.artifactStore.putPath(
      ctx.sessionId, "implement-report", result.reportPath,
      { contentType: "text/markdown" },
    );

    return this.ok({ implementation: { ...result, reportHandle } });
  }
}
