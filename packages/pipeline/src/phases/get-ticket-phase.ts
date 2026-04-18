import { BasePhase } from "./base-phase.ts";
import { unwrapField } from "../adapter-unwrap.ts";
import { formatTicketMd } from "../lib/format-ticket-md.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

export class GetTicketPhase extends BasePhase {
  readonly name = "getTicket";
  static reads = [] as const;
  static writes = ["ticket", "ticketMd"] as const;

  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const res = await ctx.providers.ticket.getTicket({
      id: ctx.ticketKey,
      sessionId: ctx.sessionId,
    });
    const ticket = unwrapField(res, "ticket", "getTicket");
    return this.ok({ ticket, ticketMd: formatTicketMd(ticket) });
  }
}
