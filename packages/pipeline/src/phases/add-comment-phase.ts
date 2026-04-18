import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { AnalyzeResult, PhaseResult, PipelineContext } from "@journeyman/core";

type Config = { template?: string; body?: string };

export class AddCommentPhase extends BasePhase {
  readonly name = "addComment";
  static reads = [] as const;       // template-dependent reads; validator treats as empty
  static writes = ["commentIds"] as const;

  async run(ctx: PipelineContext, config: Config = {}): Promise<PhaseResult> {
    const body = config.body ?? this.renderTemplate(ctx, config.template ?? "default");
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

  private renderTemplate(ctx: PipelineContext, template: string): string {
    if (template === "analysis-summary") {
      const a = this.optional<AnalyzeResult>(ctx, "analysis");
      if (!a) return "Auto-pilot: (no analysis available)";
      return `🤖 **Analysis complete**\n\n- **Complexity:** ${a.complexity}\n- **Readiness:** ${a.readinessScore}/100\n\n${a.summary}`;
    }
    if (template === "pr-opened") {
      const pr = this.optional<{ url: string; number: number }>(ctx, "pr");
      return pr ? `🚀 PR opened: ${pr.url}` : `🚀 PR opened (url unavailable)`;
    }
    return `Auto-pilot checkpoint: ${ctx.state.currentStep}`;
  }
}
