import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { AnalyzeResult, PhaseResult, PipelineContext } from "@journeyman/core";

type Config = {
  channel: string;
  template?: "analysis-summary" | "pr-opened" | "default";
  message?: string;
  title?: string;
};

export class NotifyPhase extends BasePhase {
  readonly name = "notify";
  static reads = [] as const;
  static writes = ["notifications"] as const;

  async run(ctx: PipelineContext, config: Config): Promise<PhaseResult> {
    if (!config?.channel) {
      return this.failed("notify requires config.channel", "CONFIG_MISSING");
    }

    const message = config.message ?? this.renderTemplate(ctx, config.template ?? "default");
    const res = unwrap(await ctx.providers.notification.send({
      channel: config.channel,
      message,
      title: config.title,
      sessionId: ctx.sessionId,
    }), "notify");

    if (!res.success) {
      return this.failed(res.error ?? "notification provider reported failure", "NOTIFY_FAILED");
    }

    const prior = this.optional<Record<string, string>>(ctx, "notifications") ?? {};
    const stepId = ctx.state.currentStep ?? "notify";
    return this.ok({
      notifications: { ...prior, [stepId]: res.messageId ?? "unknown" },
    });
  }

  private renderTemplate(ctx: PipelineContext, template: string): string {
    if (template === "analysis-summary") {
      const a = this.optional<AnalyzeResult>(ctx, "analysis");
      if (!a) return "Auto-pilot: (no analysis available)";
      return `:robot_face: *Analysis complete*\n• Complexity: ${a.complexity}\n• Readiness: ${a.readinessScore}/100\n\n${a.summary}`;
    }
    if (template === "pr-opened") {
      const pr = this.optional<{ url: string; number: number; title?: string }>(ctx, "pr");
      return pr ? `:rocket: PR opened: ${pr.url}` : `:rocket: PR opened (url unavailable)`;
    }
    return `Auto-pilot checkpoint: ${ctx.state.currentStep ?? "notify"}`;
  }
}
