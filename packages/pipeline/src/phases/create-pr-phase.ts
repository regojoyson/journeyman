import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { CommitPushResult, PhaseResult, PipelineContext } from "@journeyman/core";

export class CreatePRPhase extends BasePhase {
  readonly name = "createPR";
  static reads = ["commit"] as const;
  static writes = ["pr"] as const;

  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const commit = this.require<CommitPushResult>(ctx, "commit");
    const primary = ctx.productConfig.repos[0];
    if (!primary) return this.failed("product has no repos configured");

    // Idempotency: reuse existing PR for branch if present
    const listRes = await ctx.providers.git.listPRs({
      owner: primary.owner,
      repo: primary.repo,
      head: `${primary.owner}:${commit.branch}`,
      state: "open",
      sessionId: ctx.sessionId,
    });
    if (listRes.error) {
      return this.failed(`listPRs preflight failed: ${listRes.error}`, "listPRs_error");
    }
    if (listRes.prs && listRes.prs.length > 0) {
      const existing = listRes.prs[0];
      return this.ok({
        pr: { id: existing.id, url: existing.url, number: existing.number },
      });
    }

    const res = unwrap(await ctx.providers.git.createPR({
      owner: primary.owner,
      repo: primary.repo,
      title: commit.title,
      body: commit.description,
      sourceBranch: commit.branch,
      targetBranch: primary.defaultBranch,
      sessionId: ctx.sessionId,
    }), "createPR");

    return this.ok({
      pr: { id: res.id, url: res.url, number: res.number },
    });
  }
}
