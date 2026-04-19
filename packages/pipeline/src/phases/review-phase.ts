/**
 * @file review-phase.ts
 * Mandatory human-in-the-loop gate that always blocks the pipeline run.
 *
 * Reads:  none.
 * Writes: none.
 *
 * Returns `PhaseResult.blocked` unconditionally with waitFor="pr-comment", signalling
 * that a human must review and then call POST /api/runs/:sessionId/resume to continue.
 * Typically placed between implement and commitPushRepos to require sign-off before
 * code reaches the remote repository.
 *
 * Side effects: none.
 */

import { BasePhase } from "./base-phase.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

export class ReviewPhase extends BasePhase {
  readonly name = "review";
  static reads = [] as const;
  static writes = [] as const;

  async run(_ctx: PipelineContext): Promise<PhaseResult> {
    return this.blocked("awaiting human review", "pr-comment");
  }
}
