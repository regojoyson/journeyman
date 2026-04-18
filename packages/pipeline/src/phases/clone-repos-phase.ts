import { join } from "node:path";
import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

export class CloneReposPhase extends BasePhase {
  readonly name = "cloneRepos";
  static reads = [] as const;
  static writes = ["repoPaths", "primaryRepoPath", "repoRefs"] as const;

  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const repos = ctx.productConfig.repos;
    if (!repos.length) return this.blocked("product has no repos configured", "manual");

    const entries = repos.map(r => ({ url: r.url, branch: r.defaultBranch }));
    const res = unwrap(await ctx.providers.coding.cloneRepos({
      repos: entries,
      targetDir: join(ctx.workspaceDir, "repos"),
      sessionId: ctx.sessionId,
      signal: ctx.signal,
    }), "cloneRepos");

    for (const c of res.repos) {
      if (c.error) return this.failed(`cloneRepos: ${c.error}`);
    }

    const repoPaths = res.repos.map(r => r.dirPath);
    return this.ok({
      repoPaths,
      primaryRepoPath: repoPaths[0],
      repoRefs: repos,
    });
  }
}
