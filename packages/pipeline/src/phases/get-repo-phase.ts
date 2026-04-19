/**
 * @file get-repo-phase.ts
 * Fetches metadata for the primary repository from the git hosting provider.
 *
 * Reads:  none — uses productConfig.repos[0] for owner/repo coordinates.
 * Writes: repo — { name, fullName, url, defaultBranch }.
 */

import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";

/**
 * Retrieves repository metadata (name, full name, clone URL, default branch)
 * for the first repo entry in `productConfig.repos` via the git provider REST API.
 *
 * Useful as a setup step to confirm the repository exists and to capture its
 * canonical `defaultBranch` before cloning or creating PRs.
 *
 * Failure modes:
 * - No repos configured in product → failed immediately.
 * - Git provider 404 or auth error → unwrap throws AdapterError.
 * - Network error → runner records as failed.
 *
 * Side effects: one read API call to the git hosting provider; no mutations.
 */
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
