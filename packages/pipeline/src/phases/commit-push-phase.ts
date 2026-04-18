import { BasePhase } from "./base-phase.ts";
import { unwrap, AdapterError } from "../adapter-unwrap.ts";
import type { CommitPushResult, PhaseResult, PipelineContext } from "@journeyman/core";

type Config = {
  pattern?: string;
  prSummaryStyle?: "brief" | "detailed";
};

export class CommitPushPhase extends BasePhase {
  readonly name = "commitPushRepos";
  static reads = ["primaryRepoPath"] as const;
  static writes = ["commit"] as const;

  async run(ctx: PipelineContext, config: Config = {}): Promise<PhaseResult> {
    const primaryRepoPath = this.require<string>(ctx, "primaryRepoPath");

    const res = unwrap(await ctx.providers.coding.commitPushRepos({
      repos: primaryRepoPath,
      ticket: ctx.ticketShortKey,
      pattern: config.pattern,
      prSummaryStyle: config.prSummaryStyle,
      sessionId: ctx.sessionId,
      signal: ctx.signal,
    }), "commitPushRepos");

    const primary = res.repos[0] as CommitPushResult | undefined;
    if (!primary) throw new AdapterError("commitPushRepos", "no repo result returned");
    if (primary.error) throw new AdapterError("commitPushRepos", primary.error);
    if (!primary.pushed) throw new AdapterError("commitPushRepos", "push did not succeed");

    return this.ok({ commit: primary });
  }
}
