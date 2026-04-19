/**
 * @file scan-repos-phase.ts
 * Scans a local directory for git repositories via the coding-cli provider.
 *
 * Reads:  primaryRepoPath — parent directory to scan (written by cloneRepos).
 * Writes: scannedRepos    — array of RepoInfo objects describing discovered repos.
 */

import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

/**
 * Scans the `primaryRepoPath` directory for git repositories.
 *
 * Each discovered repo is described by a `RepoInfo` object containing its
 * folder name, absolute path, remote URL (if detected), current branch, and
 * a boolean indicating whether it is a valid git repo.
 *
 * Failure modes:
 * - `primaryRepoPath` artifact absent → `require` throws PhaseError.
 * - Coding-cli provider error → unwrap throws AdapterError, runner records as failed.
 * - Aborted via `ctx.signal` → provider raises AbortError.
 *
 * Side effects: reads directory metadata on disk; no mutations.
 */
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
