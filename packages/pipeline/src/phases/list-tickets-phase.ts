import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

type Config = { projectId?: string; status?: string; assignee?: string };

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
