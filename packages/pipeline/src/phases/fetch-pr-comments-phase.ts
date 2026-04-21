/**
 * @file fetch-pr-comments-phase.ts
 * Fetches PR review and issue comments and writes them to `reviewComments`.
 *
 * Reads:  pr — PR object { id, url, number } from createPR phase.
 * Writes: reviewComments — concatenated markdown string, oldest first.
 *
 * Failure modes: git provider error, missing pr (fails the phase).
 * Side effects: two read calls to the git provider (review + issue comments).
 */

import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { ListPRCommentsResult, PhaseResult, PipelineContext } from "@journeyman/core";

export class FetchPRCommentsPhase extends BasePhase {
  readonly name = "fetchPRComments";
  static reads = ["pr"] as const;
  static writes = ["reviewComments"] as const;

  async run(ctx: PipelineContext): Promise<PhaseResult> {
    const pr = this.require<{ id: string; url: string; number: number }>(ctx, "pr");
    const prUrl = pr.url;

    const result = unwrap(
      await ctx.providers.git.listPRComments({ prUrl, sessionId: ctx.sessionId }),
      "listPRComments",
    ) as ListPRCommentsResult;

    const formatted = result.comments
      .map(c => {
        const loc = c.path ? `\n*${c.path}${c.line ? `:${c.line}` : ""}*` : "";
        return `**${c.author}** (${c.createdAt}):${loc}\n\n${c.body}`;
      })
      .join("\n\n---\n\n");

    return this.ok({ reviewComments: formatted });
  }
}
