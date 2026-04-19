import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

export class ResetReposPhase extends BasePhase {
  readonly name = "resetRepos";
  static reads = ["repoPaths"] as const;
  static writes = ["resetResults"] as const;

  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const repoPaths = this.require<string[]>(ctx, "repoPaths");
    const repos = ctx.productConfig.repos;

    const entries = repoPaths.map((dirPath, i) => ({
      dirPath,
      branch: repos[i]?.defaultBranch ?? "main",
    }));

    const res = unwrap(await ctx.providers.coding.resetRepos({
      repos: entries,
      sessionId: ctx.sessionId,
      signal: ctx.signal,
    }), "resetRepos");

    for (const r of res.repos) {
      if (r.error) return this.failed(`resetRepos: ${r.error}`);
    }

    return this.ok({ resetResults: res.repos });
  }
}
