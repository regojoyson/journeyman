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
