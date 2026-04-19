/**
 * @file update-ticket-phase.ts
 * Updates fields on the current run's ticket via the configured ticket provider.
 *
 * Reads:  none — always targets ctx.ticketKey.
 * Writes: updatedTicket — the updated Ticket object returned by the provider (may be null
 *         if the provider does not return the full object after update).
 */

import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

type Config = {
  /** New title for the ticket. */
  title?: string;
  /** New description / body text. */
  description?: string;
  /** New status value (provider-specific literal, not a semantic name). */
  status?: string;
  /** New assignee identifier. */
  assignee?: string;
  /** Labels to set (replaces existing labels on most providers). */
  labels?: string[];
  /** Priority level (provider-specific string). */
  priority?: string;
  /** Provider-specific custom field values to update. */
  customFields?: Record<string, unknown>;
};

/**
 * Applies a partial update to the current run's ticket (`ctx.ticketKey`).
 *
 * Only fields present in `config` are sent — omitted fields are left unchanged.
 * Note: `status` here is a provider-specific literal value. To use semantic
 * status names mapped per product, use `updateStatus` instead.
 *
 * Failure modes:
 * - Provider returns `error` → unwrap throws AdapterError, runner records as failed.
 * - Ticket not found / permission error → provider propagates as error field.
 *
 * Side effects: mutates the ticket on the external ticket provider.
 */
export class UpdateTicketPhase extends BasePhase {
  readonly name = "updateTicket";
  static reads = [] as const;
  static writes = ["updatedTicket"] as const;

  async run(ctx: PipelineContext, config: Config = {}): Promise<PhaseResult> {
    const res = unwrap(await ctx.providers.ticket.updateTicket({
      id: ctx.ticketKey,
      title: config.title,
      description: config.description,
      status: config.status,
      assignee: config.assignee,
      labels: config.labels,
      priority: config.priority,
      customFields: config.customFields,
      sessionId: ctx.sessionId,
    }), "updateTicket");

    return this.ok({ updatedTicket: res.ticket ?? null });
  }
}
