import { BasePhase } from "./base-phase.ts";
import { unwrap, AdapterError } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

type Config = { status: string };

type StatusEntry = {
  at: string;
  semantic: string;
  actual: string;
  ok: boolean;
};

export class UpdateStatusPhase extends BasePhase {
  readonly name = "updateStatus";
  static reads = [] as const;
  static writes = ["statusHistory"] as const;

  async run(ctx: PipelineContext, config: Config): Promise<PhaseResult> {
    const semantic = config.status;
    const map = ctx.productConfig.ticketWorkflow?.statuses ?? {};
    const actual = map[semantic];
    if (!actual) {
      throw new AdapterError(
        "updateStatus",
        `no mapping for semantic status "${semantic}" in product "${ctx.productId}"`,
      );
    }

    unwrap(await ctx.providers.ticket.updateStatus({
      id: ctx.ticketKey,
      status: actual,
      sessionId: ctx.sessionId,
    }), "updateStatus");

    const prior = this.optional<StatusEntry[]>(ctx, "statusHistory") ?? [];
    return this.ok({
      statusHistory: [
        ...prior,
        { at: new Date().toISOString(), semantic, actual, ok: true },
      ],
    });
  }
}
