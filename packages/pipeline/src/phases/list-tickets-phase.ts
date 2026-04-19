/**
 * @file list-tickets-phase.ts
 * Lists tickets from the configured ticket provider using optional filters.
 *
 * Reads:  none.
 * Writes: listedTickets — array of Ticket objects matching the filter criteria.
 */

import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

type Config = {
  /** Restrict results to a specific project or board. */
  projectId?: string;
  /** Filter by ticket status (provider-specific literal value). */
  status?: string;
  /** Filter by assignee identifier. */
  assignee?: string;
};

/**
 * Fetches a list of tickets from the ticket provider, optionally filtered by
 * project, status, or assignee.
 *
 * Useful in flows that need to discover related work items before deciding
 * whether to proceed (e.g. checking for duplicate tickets, listing open bugs
 * before creating a new one).
 *
 * Failure modes:
 * - Provider error → unwrap throws AdapterError, runner records as failed.
 * - Auth / permission error → provider propagates as error field.
 *
 * Side effects: one read API call to the ticket provider; no mutations.
 */
export class ListTicketsPhase extends BasePhase {
  readonly name = "listTickets";
  static reads = [] as const;
  static writes = ["listedTickets"] as const;

  async run(ctx: PipelineContext, config: Config = {}): Promise<PhaseResult> {
    const res = unwrap(await ctx.providers.ticket.listTickets({
      projectId: config.projectId,
      status: config.status,
      assignee: config.assignee,
      sessionId: ctx.sessionId,
    }), "listTickets");

    return this.ok({ listedTickets: res.tickets });
  }
}
