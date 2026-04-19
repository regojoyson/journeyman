import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

export class ScanReposPhase extends BasePhase {
  readonly name = "scanRepos";
  static reads = ["primaryRepoPath"] as const;
  static writes = ["scannedRepos"] as const;

  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const parentDir = this.require<string>(ctx, "primaryRepoPath");

    const res = unwrap(await ctx.providers.coding.scanRepos({
      parentDir,
      sessionId: ctx.sessionId,
      signal: ctx.signal,
    }), "scanRepos");

    return this.ok({ scannedRepos: res.repos });
  }
}
