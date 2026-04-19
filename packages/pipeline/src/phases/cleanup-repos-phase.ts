/**
 * @file cleanup-repos-phase.ts
 * Removes locally cloned repository directories from disk.
 *
 * Reads:  repoPaths — array of local repo paths (written by cloneRepos).
 * Writes: none — this is a pure teardown step with no artifact output.
 *
 * Intended as the final step in a flow to reclaim disk space after all AI and git
 * operations are complete. Missing or unreadable paths are logged and skipped rather
 * than failing the run, since cleanup is best-effort.
 *
 * Failure modes: permission error deleting directories.
 * Side effects: deletes directories from disk permanently.
 */

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
