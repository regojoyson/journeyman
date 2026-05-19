export interface HeartbeatOptions {
  intervalMs: number;
  onBeat: (elapsedMs: number) => void;
}

export function startHeartbeat(opts: HeartbeatOptions): () => void {
  if (opts.intervalMs <= 0) return () => {};
  const startedAt = Date.now();
  const id = setInterval(() => {
    opts.onBeat(Date.now() - startedAt);
  }, opts.intervalMs);
  return () => clearInterval(id);
}
