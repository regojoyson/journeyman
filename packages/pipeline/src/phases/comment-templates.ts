/**
 * @file comment-templates.ts
 * Registry of ticket comment renderers for AddCommentPhase.
 *
 * Add a new template by writing a renderer function, adding it to `commentTemplates`,
 * and extending the Config template union in add-comment-phase.ts. No other changes needed.
 */
import type { AnalyzeResult, ImplementResult, PlanResult, Ticket, PipelineContext } from "@journeyman/core";

type TemplateRenderer = (ctx: PipelineContext) => string;

function renderWorkStarted(ctx: PipelineContext): string {
  const ticket = ctx.artifacts.ticket as Ticket | undefined;
  if (!ticket) return `🚀 Work started on ${ctx.ticketKey}`;
  const link = ticket.url ? ` ([${ctx.ticketShortKey}](${ticket.url}))` : ` (${ctx.ticketShortKey})`;
  return `🚀 **Work started**${link}\n\n${ticket.title}`;
}

function renderAnalysisSummary(ctx: PipelineContext): string {
  const a = ctx.artifacts.analysis as AnalyzeResult | undefined;
  if (!a) return "🤖 Analysis complete (no details available)";
  return `🤖 **Analysis complete**\n\n- **Complexity:** ${a.complexity}\n- **Readiness:** ${a.readinessScore}/100\n\n${a.summary}`;
}

function renderPlanSummary(ctx: PipelineContext): string {
  const p = ctx.artifacts.plan as PlanResult | undefined;
  if (!p) return "🗺️ Plan complete (no details available)";
  return `🗺️ **Plan ready**\n\n- **Steps:** ${p.steps.length}\n- **Complexity:** ${p.estimatedComplexity}\n\n${p.summary}`;
}

function renderImplementationSummary(ctx: PipelineContext): string {
  const impl = ctx.artifacts.implementation as ImplementResult | undefined;
  if (!impl) return "✅ Implementation complete (no details available)";
  return `✅ **Implementation complete**\n\n- **Files changed:** ${impl.filesChanged.length}\n\n${impl.summary}`;
}

function renderPrOpened(ctx: PipelineContext): string {
  const pr = ctx.artifacts.pr as { url: string; number: number } | undefined;
  return pr ? `🚀 PR opened: ${pr.url}` : `🚀 PR opened (url unavailable)`;
}

function renderReviewWaiting(_ctx: PipelineContext): string {
  return `👀 **Ready for review** — please approve or request rework on this ticket.`;
}

function renderReviewComplete(ctx: PipelineContext): string {
  const outcomeKey = Object.keys(ctx.artifacts).find(k => k.endsWith("_outcome"));
  const outcome = outcomeKey ? (ctx.artifacts[outcomeKey] as string) : undefined;
  if (!outcome) return `👀 **Review complete**`;
  return `👀 **Review complete** — ${outcome}`;
}

function renderCompleted(ctx: PipelineContext): string {
  const ticket = ctx.artifacts.ticket as Ticket | undefined;
  const pr = ctx.artifacts.pr as { url: string; number: number } | undefined;
  const prRef = pr ? ` — PR: ${pr.url}` : "";
  const title = ticket?.title ? `\n\n${ticket.title}` : "";
  return `✅ **${ctx.ticketShortKey} complete**${prRef}${title}`;
}

function renderDefault(ctx: PipelineContext): string {
  return `Auto-pilot checkpoint: ${ctx.state.currentStep ?? ctx.currentStepId}`;
}

export const commentTemplates: Record<string, TemplateRenderer> = {
  "work-started":           renderWorkStarted,
  "analysis-summary":       renderAnalysisSummary,
  "plan-summary":           renderPlanSummary,
  "implementation-summary": renderImplementationSummary,
  "pr-opened":              renderPrOpened,
  "review-waiting":         renderReviewWaiting,
  "review-complete":        renderReviewComplete,
  "completed":              renderCompleted,
  "default":                renderDefault,
};

export function selectTemplate(ctx: PipelineContext): string {
  if (ctx.artifacts.pr)             return "pr-opened";
  if (ctx.artifacts.implementation) return "implementation-summary";
  if (ctx.artifacts.plan)           return "plan-summary";
  if (ctx.artifacts.analysis)       return "analysis-summary";
  if (ctx.artifacts.ticket)         return "work-started";
  return "default";
}

export function renderComment(ctx: PipelineContext, template: string): string {
  const renderer = commentTemplates[template] ?? commentTemplates["default"];
  return renderer(ctx);
}
