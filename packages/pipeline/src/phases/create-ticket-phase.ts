import { BasePhase } from "./base-phase.ts";
import { unwrapField } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

type Config = {
  title: string;
  description?: string;
  assignee?: string;
  labels?: string[];
  projectId?: string;
  status?: string;
  customFields?: Record<string, unknown>;
};

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
