import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

type Config = {
  title?: string;
  description?: string;
  status?: string;
  assignee?: string;
  labels?: string[];
  priority?: string;
  customFields?: Record<string, unknown>;
};

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
