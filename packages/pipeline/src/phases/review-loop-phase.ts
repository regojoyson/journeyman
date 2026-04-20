/**
 * @file review-loop-phase.ts
 * Generic compound review-loop phase. Orchestrates configured sub-phases on
 * each rework cycle. Loops by returning `blocked` after every rework cycle.
 *
 * Config:
 *   approveStatus: string       — semantic status that exits the loop with ok
 *   reworkStatus:  string       — semantic status that triggers sub-phases
 *   onRework:      string[]     — ordered list of phase names to run on rework
 *   maxCycles?:    number       — default 3; exceeding fails the run
 *
 * Reads:  none (sub-phases declare their own reads)
 * Writes: `${stepId}_cycles`, `${stepId}_outcome`
 */

import { BasePhase } from "./base-phase.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";
import type { PhaseRegistry } from "../registry/phase-registry.ts";
import { resolveSemantic } from "./await-ticket-status-phase.ts";

export type ReviewLoopConfig = {
  approveStatus: string;
  reworkStatus: string;
  onRework: string[];
  maxCycles?: number;
};

export class ReviewLoopPhase extends BasePhase {
  readonly name = "reviewLoop";
  static reads = [] as const;
  static writes = [] as const;

  constructor(private readonly registry: PhaseRegistry) { super(); }

  async run(ctx: PipelineContext, rawConfig: unknown): Promise<PhaseResult> {
    const config = rawConfig as ReviewLoopConfig;
    const maxCycles = config.maxCycles ?? 3;
    const cyclesKey = `${ctx.currentStepId}_cycles`;
    const outcomeKey = `${ctx.currentStepId}_outcome`;
    const cycles = (ctx.artifacts[cyclesKey] as number) ?? 0;
    const resumeStatus = ctx.artifacts.__resumeStatus as string | undefined;

    if (!resumeStatus) {
      return this.blocked("awaiting review", "ticket-comment");
    }

    const semantic = resolveSemantic(ctx, resumeStatus);

    if (semantic === config.approveStatus) {
      return this.ok({ [cyclesKey]: cycles, [outcomeKey]: "approved" });
    }

    if (semantic === config.reworkStatus) {
      if (cycles >= maxCycles) {
        return this.failed(`max rework cycles (${maxCycles}) exceeded`);
      }

      for (const phaseName of config.onRework) {
        const subPhase = this.registry.resolve(phaseName);
        const result = await subPhase.run(ctx, {});
        if (result.status === "failed") return result;
        if (result.status === "blocked") return result;
        Object.assign(ctx.artifacts, result.artifacts);
      }

      return this.blocked(
        `cycle ${cycles + 1} complete, awaiting review`,
        "ticket-comment",
        { [cyclesKey]: cycles + 1 },
      );
    }

    return this.blocked(
      `status "${semantic}" unhandled, awaiting ${config.approveStatus}|${config.reworkStatus}`,
      "ticket-comment",
    );
  }
}
