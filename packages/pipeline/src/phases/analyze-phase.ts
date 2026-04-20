/**
 * @file analyze-phase.ts
 * AI-powered analysis of the primary repository relative to the ticket description.
 *
 * Reads:  primaryRepoPath — local repo path (written by cloneRepos).
 *         ticketMd        — markdown ticket description (written by getTicket).
 * Writes: analysis — AnalyzeResult including complexity, readinessScore, summary,
 *                    and a reportHandle pointing to the full report in the artifact store.
 *
 * The raw report file produced by the coding provider is offloaded to the artifact
 * store so the in-memory artifact bag stays lean. Downstream phases access it via
 * `analysis.reportPath` (local temp path) or `analysis.reportHandle` (durable handle).
 *
 * Failure modes: provider error, missing repo path, context-window overflow on large repos.
 * Side effects: reads files under primaryRepoPath; writes one artifact blob to the store.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
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

    mkdirSync(join(primaryRepoPath, "docs", "analyze"), { recursive: true });
    mkdirSync(join(primaryRepoPath, "docs", "plan"), { recursive: true });
    mkdirSync(join(primaryRepoPath, "docs", "implement"), { recursive: true });

    const result = unwrap(await ctx.providers.coding.analyze({
      dirPath: primaryRepoPath,
      ticketContent: ticketMd,
      sessionId: ctx.sessionId,
      signal: ctx.signal,
      reviewComments: ctx.artifacts.reviewComments as string | undefined,
    }), "analyze") as AnalyzeResult;

    const reportHandle = await ctx.artifactStore.putPath(
      ctx.sessionId, "analyze-report", result.reportPath,
      { contentType: "text/markdown" },
    );

    return this.ok({ analysis: { ...result, reportHandle } });
  }
}
