/**
 * Worker poll-interval resolution.
 *
 * Each registered step type runs its own poll loop; this value is how long
 * each loop sleeps between Conductor polls. Lower = faster step pickup but
 * more requests/log lines; higher = quieter and lighter but slower hops.
 */

/** Default poll interval (ms) when WORKER_POLL_INTERVAL_MS is unset or invalid. */
export const DEFAULT_POLL_INTERVAL_MS = 2000;

/**
 * Resolve the worker poll interval (ms) from the environment.
 *
 * Reads `WORKER_POLL_INTERVAL_MS`. Falls back to {@link DEFAULT_POLL_INTERVAL_MS}
 * when the value is unset, non-numeric, or non-positive (a non-positive value
 * would otherwise turn the poll loop into a busy-loop).
 */
export function resolvePollIntervalMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = Number(env.WORKER_POLL_INTERVAL_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_POLL_INTERVAL_MS;
}
