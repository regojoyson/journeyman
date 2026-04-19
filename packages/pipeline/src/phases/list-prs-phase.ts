/**
 * @file list-prs-phase.ts
 * Lists pull requests for the primary repository via the git hosting provider.
 *
 * Reads:  none — uses productConfig.repos[0] for owner/repo coordinates.
 * Writes: listedPRs — array of ListPRItem objects.
 */

import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

type Config = {
  /** Filter by PR state. Defaults to "open". */
  state?: "open" | "closed" | "all";
  /** Filter by head branch in "owner:branch" format (GitHub convention). */
  head?: string;
};

/**
 * Fetches the list of pull requests (or merge requests) for the primary repo.
 *
 * This is a standalone phase distinct from the internal preflight check inside
 * `createPR`. Use it when a flow needs to inspect existing PRs before deciding
 * on a branch strategy or as an audit step.
 *
 * Config:
 * - `state` — "open" | "closed" | "all" (default: "open").
 * - `head`  — narrow results to a specific branch, e.g. "myorg:feature/branch".
 *
 * Failure modes:
 * - No repos configured in product → failed immediately.
 * - Git provider error → unwrap throws AdapterError.
 * - Network error → runner records as failed.
 *
 * Side effects: one read API call to the git hosting provider; no mutations.
 */
export class ListPRsPhase extends BasePhase {
  readonly name = "listPRs";
  static reads = [] as const;
  static writes = ["listedPRs"] as const;

  async run(ctx: PipelineContext, config: Config = {}): Promise<PhaseResult> {
    const primary = ctx.productConfig.repos[0];
    if (!primary) return this.failed("no repos configured in product");

    const res = unwrap(await ctx.providers.git.listPRs({
      owner: primary.owner,
      repo: primary.repo,
      state: config.state ?? "open",
      head: config.head,
      sessionId: ctx.sessionId,
    }), "listPRs");

    return this.ok({ listedPRs: res.prs });
  }
}
