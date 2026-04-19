/**
 * @file notify-phase.ts
 * Delivers a notification to a channel via the configured notification provider (e.g. Slack).
 *
 * Reads:  none declared — template rendering pulls from ctx.artifacts at runtime.
 * Writes: notifications — Record<stepId, messageId> accumulating one entry per step.
 */

import { BasePhase } from "./base-phase.ts";
import { unwrap } from "../adapter-unwrap.ts";
import type { AnalyzeResult, PhaseResult, PipelineContext } from "@journeyman/core";

type Config = {
  /** Target channel name or id (required). */
  channel: string;
  /** Built-in message template. Ignored when `message` is provided. */
  template?: "analysis-summary" | "pr-opened" | "default";
  /** Verbatim message body. Takes precedence over `template`. */
  message?: string;
  /** Optional notification title / subject line. */
  title?: string;
};

/**
 * Sends a notification to the configured channel.
 *
 * Supply either `config.message` (verbatim text) or `config.template` to use a
 * built-in rendering:
 * - `"analysis-summary"` — renders from the `analysis` artifact.
 * - `"pr-opened"`        — renders from the `pr` artifact.
 * - `"default"`          — generic checkpoint message with the current step id.
 *
 * The provider-returned messageId is stored under `notifications[stepId]` so
 * multiple notify steps in the same flow remain independent.
 *
 * Failure modes:
 * - Missing `config.channel` → failed (CONFIG_MISSING).
 * - Provider returns `success: false` → failed (NOTIFY_FAILED).
 * - Network / provider error → runner catches and records as failed.
 *
 * Side effects: posts one message to the external notification service.
 */
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

  /** Renders a built-in message template from available artifacts. */
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
