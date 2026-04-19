/**
 * @file reset-repos-phase.ts
 * Resets locally cloned repositories to their configured default branches.
 *
 * Reads:  repoPaths    — list of local repo paths written by cloneRepos.
 * Writes: resetResults — array of ResetResult objects, one per repo.
 */

import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

/**
 * Resets each repo in `repoPaths` to the default branch declared in
 * `productConfig.repos`. Branches are matched by index — the i-th path
 * corresponds to the i-th repo entry. Falls back to `"main"` when a product
 * repo entry is missing.
 *
 * Useful as a cleanup step between retries or before re-running implement,
 * ensuring the working tree is in a known-good state.
 *
 * Failure modes:
 * - Any individual repo reports `error` → phase fails immediately with that message.
 * - Provider error → unwrap throws AdapterError, runner records as failed.
 * - Aborted via `ctx.signal` → provider raises AbortError.
 *
 * Side effects: performs `git reset` (and possibly `git checkout`) on local disk.
 */
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
