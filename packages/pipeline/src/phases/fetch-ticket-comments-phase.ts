/**
 * @file fetch-ticket-comments-phase.ts
 * Fetches the latest ticket comments and writes them to `reviewComments` for
 * downstream phases (analyze / plan / implement) to consume as feedback context.
 *
 * Reads:  none (uses ctx.ticketKey).
 * Writes: reviewComments — concatenated markdown string of all comments, oldest first.
 *
 * Failure modes: ticket provider error.
 * Side effects: one read call to the ticket provider.
 */

import { BasePhase } from "./base-phase.ts";
import type { PhaseResult, PipelineContext, TicketComment } from "@journeyman/core";

export class FetchTicketCommentsPhase extends BasePhase {
  readonly name = "fetchTicketComments";
  static reads = [] as const;
  static writes = ["reviewComments"] as const;

  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const result = await ctx.providers.ticket.getTicket({
      id: ctx.ticketKey,
      sessionId: ctx.sessionId,
    });

    const comments: TicketComment[] = result.ticket?.comments ?? [];
    const formatted = comments
      .map(
        (c) =>
          `**${c.author ?? "unknown"}** (${c.createdAt ?? ""}):\n\n${c.body ?? ""}`,
      )
      .join("\n\n---\n\n");

    return this.ok({ reviewComments: formatted });
  }
}
