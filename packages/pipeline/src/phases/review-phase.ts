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
