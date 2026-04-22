/**
 * @file checkout-repo-phase.ts
 * Resets locally cloned repositories to their configured default branches
 * and checks out a fresh feature branch.
 *
 * Reads:  repoPaths       — list of local repo paths written by cloneRepos.
 * Writes: checkoutResults — array of CheckoutResult objects, one per repo.
 */

import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext, Ticket } from "@journeyman/core";

/**
 * Resets each repo in `repoPaths` to the default branch declared in
 * `productConfig.repos`, then checks out a fresh feature branch. Branches are
 * matched by index — the i-th path corresponds to the i-th repo entry. Falls
 * back to `"main"` when a product repo entry is missing.
 *
 * Useful as a cleanup step between retries or before re-running implement,
 * ensuring the working tree is in a known-good state.
 *
 * Failure modes:
 * - Any individual repo reports `error` → phase fails immediately with that message.
 * - Provider error → unwrap throws AdapterError, runner records as failed.
 * - Aborted via `ctx.signal` → provider raises AbortError.
 *
 * Side effects: performs `git reset` and `git checkout` on local disk.
 */
export class CheckoutRepoPhase extends BasePhase {
  readonly name = "checkoutRepo";
  static reads = ["repoPaths"] as const;
  static writes = ["checkoutResults"] as const;

  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const repoPaths = this.require<string[]>(ctx, "repoPaths");
    const repos = ctx.productConfig.repos;

    const entries = repoPaths.map((dirPath, i) => ({
      dirPath,
      branch: repos[i]?.defaultBranch ?? "main",
    }));

    const ticket = this.optional<Ticket>(ctx, "ticket");
    const ticketId = ctx.ticketShortKey || ctx.ticketKey || undefined;

    const res = unwrap(await ctx.providers.coding.checkoutRepo({
      repos: entries,
      ticket: ticketId && ticket?.title
        ? { id: ticketId, title: ticket.title }
        : undefined,
      sessionId: ctx.sessionId,
      signal: ctx.signal,
    }), "checkoutRepo");

    for (const r of res.repos) {
      if (r.error) return this.failed(`checkoutRepo: ${r.error}`);
    }

    return this.ok({ checkoutResults: res.repos });
  }
}
