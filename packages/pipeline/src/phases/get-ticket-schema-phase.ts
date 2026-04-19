import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

type Config = { projectId?: string };

export class GetTicketSchemaPhase extends BasePhase {
  readonly name = "getTicketSchema";
  static reads = [] as const;
  static writes = ["ticketSchema"] as const;

  async run(ctx: PipelineContext, config: Config = {}): Promise<PhaseResult> {
    const res = unwrap(await ctx.providers.ticket.getTicketSchema({
      ticketId: ctx.ticketKey,
      projectId: config.projectId,
      sessionId: ctx.sessionId,
    }), "getTicketSchema");

    return this.ok({ ticketSchema: res.fields });
  }
}
