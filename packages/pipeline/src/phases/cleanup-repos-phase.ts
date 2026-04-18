import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

export class CleanupReposPhase extends BasePhase {
  readonly name = "cleanupRepos";
  static reads = ["repoPaths"] as const;
  static writes = [] as const;

  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const repoPaths = this.require<string[]>(ctx, "repoPaths");
    unwrap(await ctx.providers.coding.cleanupRepos({
      repos: repoPaths,
      sessionId: ctx.sessionId,
      signal: ctx.signal,
    }), "cleanupRepos");
    return this.ok({});
  }
}
