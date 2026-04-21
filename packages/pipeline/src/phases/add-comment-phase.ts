/**
 * @file add-comment-phase.ts
 * Posts a comment to the current ticket via the ticket provider.
 *
 * Config accepts either a `body` string (posted verbatim) or a `template` key
 * that is resolved via the comment template registry (comment-templates.ts).
 * If neither is provided, selectTemplate() auto-selects based on pipeline state.
 * The resulting comment ID is written to `commentIds` in the artifact bag.
 */

import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { PhaseResult, PipelineContext } from "@journeyman/core";
import { renderComment, selectTemplate } from "./comment-templates.ts";

type Config = {
  body?: string;
  /**
   * Omit or use `"auto"` to auto-select based on what artifacts are in the pipeline bag.
   * Use a named key to force a specific template regardless of pipeline state.
   * `"default"` always renders the generic checkpoint message (bypasses auto-selection).
   */
  template?:
    | "work-started"
    | "analysis-summary"
    | "plan-summary"
    | "implementation-summary"
    | "pr-opened"
    | "review-waiting"
    | "review-complete"
    | "completed"
    | "auto"
    | "default";
};

export class AddCommentPhase extends BasePhase {
  readonly name = "addComment";
  static reads = [] as const;
  static writes = ["commentIds"] as const;

  async run(ctx: PipelineContext, config: Config = {}): Promise<PhaseResult> {
    const body = config.body ?? this.resolveBody(ctx, config.template);
    const res = unwrap(await ctx.providers.ticket.addComment({
      id: ctx.ticketKey,
      body,
      sessionId: ctx.sessionId,
    }), "addComment");

    const prior = this.optional<Record<string, string>>(ctx, "commentIds") ?? {};
    const stepId = ctx.state.currentStep ?? "addComment";
    return this.ok({
      commentIds: { ...prior, [stepId]: res.comment?.id ?? "unknown" },
    });
  }

  private resolveBody(ctx: PipelineContext, template?: string): string {
    const key = (!template || template === "auto") ? selectTemplate(ctx) : template;
    return renderComment(ctx, key);
  }
}
