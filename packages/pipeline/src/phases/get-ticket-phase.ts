/**
 * @file get-ticket-phase.ts
 * Fetches the current ticket from the ticket provider and renders it as markdown.
 *
 * Reads:  none — uses ctx.ticketKey directly.
 * Writes: ticket   — raw Ticket object from the provider.
 *         ticketMd — markdown rendering used as context in AI prompts.
 *
 * Failure modes: ticket not found (provider 404), network error, or missing ticketKey.
 * Side effects: one read API call to the ticket provider; no mutations.
 */

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
