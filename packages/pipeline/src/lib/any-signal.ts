/**
 * @file any-signal.ts
 * Composes multiple AbortSignals into a single signal that aborts when any one fires.
 *
 * Used by the Pipeline runner to combine the run-level cancel signal with a
 * per-step timeout signal (`AbortSignal.timeout(step.timeoutMs)`), so either
 * a manual cancel or a timeout will interrupt the current phase.
 */

/** Compose multiple AbortSignals into one that aborts when any of them aborts. */
export function anySignal(signals: AbortSignal[]): AbortSignal {
  const ac = new AbortController();
  const onAbort = (s: AbortSignal) => ac.abort(s.reason);
  for (const s of signals) {
    if (s.aborted) onAbort(s);
    else s.addEventListener("abort", () => onAbort(s), { once: true });
  }
  return ac.signal;
}
