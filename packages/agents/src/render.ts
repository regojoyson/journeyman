export interface RenderContext {
  /** Resolved named inputs (after defaults). */
  inputs: Record<string, unknown>;
  /** Raw trigger payload, for {{payload}}. Undefined → {}. */
  payload?: unknown;
  /** How the run started, for {{trigger.type}} (e.g. "webhook"). */
  triggerType: string;
}

/**
 * Substitute {{name}}, {{payload}} and {{trigger.type}} in an agent's
 * instructions. Any token with no value renders as an empty string — runs are
 * never blocked on a missing input.
 */
export function renderInstructions(template: string, ctx: RenderContext): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, token: string) => {
    if (token === "payload") return JSON.stringify(ctx.payload ?? {});
    if (token === "trigger.type") return ctx.triggerType;
    const v = ctx.inputs[token];
    return v === undefined || v === null ? "" : String(v);
  });
}
