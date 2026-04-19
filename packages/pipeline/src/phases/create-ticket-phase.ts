/**
 * @file create-ticket-phase.ts
 * Creates a new ticket on the configured ticket provider (Jira, Linear, GitHub Issues, etc.).
 *
 * Reads:  none.
 * Writes: createdTicket — the full Ticket object returned by the provider.
 */

import { BasePhase } from "./base-phase.ts";
import { unwrapField } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

type Config = {
  /** Ticket title (required). */
  title: string;
  /** Optional description / body text. */
  description?: string;
  /** Assignee identifier (provider-specific format). */
  assignee?: string;
  /** Labels to apply at creation time. */
  labels?: string[];
  /** Project or board id where the ticket should be created. */
  projectId?: string;
  /** Initial status name (provider-specific). */
  status?: string;
  /** Provider-specific custom field values. */
  customFields?: Record<string, unknown>;
};

/**
 * Creates a new ticket on the ticket provider and stores the resulting Ticket
 * object under `createdTicket`.
 *
 * This phase does not update `ctx.ticketKey` — the run's primary ticket remains
 * unchanged. `createdTicket` is an independent artifact for downstream use
 * (e.g. linking, status transitions on the new ticket).
 *
 * Failure modes:
 * - Missing `config.title` → failed (CONFIG_MISSING).
 * - Provider returns no ticket object → unwrapField throws AdapterError.
 * - Auth / permission error from provider → runner records as failed.
 *
 * Side effects: creates a ticket on the external ticket provider.
 */
export class CreateTicketPhase extends BasePhase {
  readonly name = "createTicket";
  static reads = [] as const;
  static writes = ["createdTicket"] as const;

  async run(ctx: PipelineContext, config: Config): Promise<PhaseResult> {
    if (!config?.title) {
      return this.failed("createTicket requires config.title", "CONFIG_MISSING");
    }

    const res = await ctx.providers.ticket.createTicket({
      title: config.title,
      description: config.description,
      assignee: config.assignee,
      labels: config.labels,
      projectId: config.projectId,
      status: config.status,
      customFields: config.customFields,
      sessionId: ctx.sessionId,
    });

    const ticket = unwrapField(res, "ticket", "createTicket");
    return this.ok({ createdTicket: ticket });
  }
}
