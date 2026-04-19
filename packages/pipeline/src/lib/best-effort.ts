/**
 * @file best-effort.ts
 * Wraps non-critical async operations so failures are logged but do not kill the run.
 *
 * Use `bestEffort` for side effects like ticket comments or Slack notifications where
 * a transient API failure should not block progress. The error is recorded as a `warn`
 * trace line so it remains visible in run logs without surfacing as a PhaseResult failure.
 */

import type { PipelineContext } from "@journeyman/core";

/**
 * Run a side-effect function; if it throws, log a warn and return undefined.
 * Used for non-critical calls (comments, Slack notifications) that shouldn't kill the run.
 */
export async function bestEffort<T>(
  ctx: PipelineContext,
  label: string,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err: any) {
    await ctx.trace.log(
      ctx.sessionId,
      ctx.state.currentStep ?? "?",
      `soft-fail [${label}]: ${err.message}`,
      "warn",
    );
    return undefined;
  }
}
