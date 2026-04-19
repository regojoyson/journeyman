/**
 * @file get-ticket-schema-phase.ts
 * Fetches the field schema for the current ticket from the ticket provider.
 *
 * Reads:  none — uses ctx.ticketKey as the target ticket id.
 * Writes: ticketSchema — array of TicketField descriptors (id, name, type, required, allowedValues).
 */

import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

type Config = {
  /** Optional project id to scope the schema lookup (provider-specific). */
  projectId?: string;
};

/**
 * Retrieves the field definitions for the current ticket's issue type.
 *
 * The returned `ticketSchema` describes which fields are available, their types,
 * whether they are required, and their allowed values. Downstream phases can use
 * this to build dynamic forms, validate `updateTicket` payloads, or drive AI
 * prompts that need to know what fields a ticket supports.
 *
 * Config:
 * - `projectId` — narrows the schema lookup to a specific project when the
 *   provider requires it (e.g. Jira's project-scoped issue type metadata).
 *
 * Failure modes:
 * - Provider error → unwrap throws AdapterError, runner records as failed.
 * - Ticket not found / permission error → provider propagates as error field.
 *
 * Side effects: one read API call to the ticket provider; no mutations.
 */
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
