/**
 * Step-timeout knobs — the single source of truth shared by the worker harness
 * (which enforces the real per-step deadline and the in-process image-build wait)
 * and the Conductor converter (which must size the engine-side task timeout so it
 * never fires before the worker's own enforcement does).
 *
 * Why this lives in one place: the worker waits up to
 * `attempts × delayMs` for a sandbox image to build, then runs the step for up to
 * the per-step timeout. If Conductor's `timeoutSeconds`/`responseTimeoutSeconds`
 * is shorter than that combined budget, Conductor TIMED_OUTs a task the worker is
 * still legitimately working on — and with `retryCount: 0` that fails the whole
 * run. The Conductor task timeout must therefore be a true *backstop*: strictly
 * larger than (image wait + step work). Keeping both sides on these resolvers
 * stops the two from drifting apart.
 */

/** Default per-step deadline (s) when WORKER_DEFAULT_STEP_TIMEOUT_S is unset/invalid. */
export const DEFAULT_STEP_TIMEOUT_SECONDS = 1800;
/** Default in-process image-wait retry attempts when WORKER_IMAGE_RETRY_ATTEMPTS is unset/invalid. */
export const DEFAULT_IMAGE_RETRY_ATTEMPTS = 10;
/** Default delay (ms) between image-wait retries when WORKER_IMAGE_RETRY_DELAY_MS is unset/invalid. */
export const DEFAULT_IMAGE_RETRY_DELAY_MS = 30_000;
/** Default headroom (s) added on top of (image wait + step work) for the Conductor backstop. */
export const DEFAULT_CONDUCTOR_TIMEOUT_MARGIN_SECONDS = 120;

/** Parse an env value as a finite number ≥ min, else fall back. */
function num(raw: string | undefined, fallback: number, min: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

/** In-process image-wait retry config (attempts may be 0 to fast-fail). */
export function resolveImageRetryConfig(
  env: NodeJS.ProcessEnv = process.env,
): { attempts: number; delayMs: number } {
  return {
    attempts: num(env.WORKER_IMAGE_RETRY_ATTEMPTS, DEFAULT_IMAGE_RETRY_ATTEMPTS, 0),
    delayMs: num(env.WORKER_IMAGE_RETRY_DELAY_MS, DEFAULT_IMAGE_RETRY_DELAY_MS, 0),
  };
}

/** Per-step deadline (s) the worker harness enforces via its abort timer. */
export function resolveDefaultStepTimeoutSeconds(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return num(env.WORKER_DEFAULT_STEP_TIMEOUT_S, DEFAULT_STEP_TIMEOUT_SECONDS, 1);
}

/** Worst-case time (s) the worker may spend waiting for an image to build before running the step. */
export function resolveImageWaitBudgetSeconds(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const { attempts, delayMs } = resolveImageRetryConfig(env);
  return Math.ceil((attempts * delayMs) / 1000);
}

/**
 * Conductor task timeout (s) — the backstop. Sized as
 * `stepTimeout + imageWaitBudget + margin` so the engine never times out a run
 * the worker is still working on.
 *
 * The step component is floored at the worker default: a per-step override only
 * ever *raises* the backstop. A node may set a shorter `timeoutSeconds`, but the
 * worker enforces its own deadline (top-level `stepInput.timeoutSeconds`, itself
 * floored at the worker default) — and Conductor must outlast whatever the worker
 * does. The two read different fields (`RetryPolicy.timeoutSeconds` here vs the
 * worker's top-level value), so flooring is what keeps the backstop safe whether
 * or not the override reaches the worker. A short override just means the worker
 * fires first and Conductor never does.
 */
export function resolveConductorTaskTimeoutSeconds(
  opts: { stepTimeoutSeconds?: number; env?: NodeJS.ProcessEnv } = {},
): number {
  const env = opts.env ?? process.env;
  const override =
    typeof opts.stepTimeoutSeconds === "number" && opts.stepTimeoutSeconds > 0
      ? opts.stepTimeoutSeconds
      : 0;
  const step = Math.max(override, resolveDefaultStepTimeoutSeconds(env));
  const margin = num(
    env.WORKER_CONDUCTOR_TIMEOUT_MARGIN_S,
    DEFAULT_CONDUCTOR_TIMEOUT_MARGIN_SECONDS,
    0,
  );
  return step + resolveImageWaitBudgetSeconds(env) + margin;
}
