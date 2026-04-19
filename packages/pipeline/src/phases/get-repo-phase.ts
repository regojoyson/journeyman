import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

export class GetRepoPhase extends BasePhase {
  readonly name = "getRepo";
  static reads = [] as const;
  static writes = ["repo"] as const;

  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const primary = ctx.productConfig.repos[0];
    if (!primary) return this.failed("no repos configured in product");

    const res = unwrap(await ctx.providers.git.getRepo({
      owner: primary.owner,
      repo: primary.repo,
      sessionId: ctx.sessionId,
    }), "getRepo");

    return this.ok({
      repo: {
        name: res.name,
        fullName: res.fullName,
        url: res.url,
        defaultBranch: res.defaultBranch,
      },
    });
  }
}
