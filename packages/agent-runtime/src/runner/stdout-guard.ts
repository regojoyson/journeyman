/**
 * The runner's stdout is a strict protocol channel: it must contain ONLY the
 * final RunnerResponse JSON (see runner/cli.ts). Some libraries write to stdout
 * out of band and corrupt that channel — notably the AI SDK, whose first-warning
 * banner is emitted via `console.info` (which Node routes to stdout). That single
 * line prepends to the response JSON and makes the orchestrator report
 * "runner produced no JSON".
 *
 * guardRunnerStdout() closes both holes:
 *   1. Disables AI SDK warning logging entirely (its documented off-switch).
 *   2. Re-routes any stray `console.log`/`console.info` to stderr, so only the
 *      explicit `process.stdout.write(out)` in cli.ts ever reaches stdout.
 * `console.warn`/`console.error` already target stderr and are left untouched.
 */
export function guardRunnerStdout(): void {
  (globalThis as Record<string, unknown>).AI_SDK_LOG_WARNINGS = false;
  const toStderr = (...args: unknown[]): void => {
    const line = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    process.stderr.write(line + "\n");
  };
  console.log = toStderr as typeof console.log;
  console.info = toStderr as typeof console.info;
}
