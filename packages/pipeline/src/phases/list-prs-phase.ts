import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

type Config = { state?: "open" | "closed" | "all"; head?: string };

export class ListPRsPhase extends BasePhase {
  readonly name = "listPRs";
  static reads = [] as const;
  static writes = ["listedPRs"] as const;

  async run(ctx: PipelineContext, config: Config = {}): Promise<PhaseResult> {
    const primary = ctx.productConfig.repos[0];
    if (!primary) return this.failed("no repos configured in product");

    const res = unwrap(await ctx.providers.git.listPRs({
      owner: primary.owner,
      repo: primary.repo,
      state: config.state ?? "open",
      head: config.head,
      sessionId: ctx.sessionId,
    }), "listPRs");

    return this.ok({ listedPRs: res.prs });
  }
}
