/**
 * @file commit-push-phase.ts
 * Commits all staged changes in the primary repo and pushes to the remote branch.
 *
 * Reads:  primaryRepoPath — local repo path (written by cloneRepos).
 * Writes: commit — CommitPushResult for the primary repo, including branch, commitSha,
 *                  commitMessage, PR title, PR description body, and remoteUrl.
 *
 * Config:
 * - `pattern`        — commit message template (default: "{ticket} : {summary}").
 * - `prSummaryStyle` — "brief" | "detailed" (default: "detailed").
 *
 * Fails if the provider returns no repo result, if the primary repo has an error,
 * or if the push did not succeed (e.g. force-push blocked, stale ref, auth failure).
 *
 * Side effects: creates a git commit; pushes to the remote git host.
 */

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
