/**
 * @file await-ticket-status-phase.ts
 * One-shot gate that blocks until the run is resumed with a ticket status
 * listed in `continueOn`. If resumed with a status in `failOn`, fails the
 * run. Unknown statuses re-block (wait for the correct signal).
 *
 * Reads:  none. Writes: none.
 *
 * Config:
 *   continueOn: string[]   — semantic status names that unblock
 *   failOn?:    string[]   — semantic status names that fail the run
 */

import { BasePhase } from "./base-phase.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

export type AwaitTicketStatusConfig = {
  continueOn: string[];
  failOn?: string[];
};

export class AwaitTicketStatusPhase extends BasePhase {
  readonly name = "awaitTicketStatus";
  static reads = [] as const;
  static writes = [] as const;

  async run(ctx: PipelineContext, rawConfig: unknown): Promise<PhaseResult> {
    const config = (rawConfig ?? {}) as AwaitTicketStatusConfig;
    const resumeStatus = ctx.artifacts.__resumeStatus as string | undefined;

    if (!resumeStatus) {
      return this.blocked("awaiting ticket status change", "ticket-comment");
    }

    const semantic = resolveSemantic(ctx, resumeStatus);

    if (config.continueOn.includes(semantic)) return this.ok({});
    if (config.failOn?.includes(semantic)) return this.failed(`ticket moved to "${semantic}"`);

    return this.blocked(
      `ticket at "${semantic}", awaiting ${config.continueOn.join("|")}`,
      "ticket-comment",
    );
  }
}

/** Map literal ticket-status value → semantic name via ticketWorkflow.statuses. */
export function resolveSemantic(ctx: PipelineContext, literal: string): string {
  const map = ctx.productConfig.ticketWorkflow?.statuses ?? {};
  for (const [semantic, value] of Object.entries(map)) {
    if (value === literal) return semantic;
  }
  return literal;  // fallback — treat literal as semantic
}
