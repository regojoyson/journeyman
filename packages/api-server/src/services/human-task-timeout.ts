type TimeoutKey = `${string}:${string}`; // `${runId}:${nodeId}`

export interface HumanTaskTimeoutService {
  schedule(runId: string, nodeId: string, durationMs: number, fire: () => Promise<void>): void;
  cancel(runId: string, nodeId: string): void;
  cancelAllForRun(runId: string): void;
}

export class InMemoryHumanTaskTimeoutService implements HumanTaskTimeoutService {
  private timers = new Map<TimeoutKey, NodeJS.Timeout>();

  schedule(runId: string, nodeId: string, durationMs: number, fire: () => Promise<void>): void {
    const key: TimeoutKey = `${runId}:${nodeId}`;
    this.cancel(runId, nodeId);
    const t = setTimeout(() => {
      this.timers.delete(key);
      fire().catch(err => {
        console.error(`[human-task-timeout] fire failed for ${key}:`, err);
      });
    }, durationMs);
    this.timers.set(key, t);
  }

  cancel(runId: string, nodeId: string): void {
    const key: TimeoutKey = `${runId}:${nodeId}`;
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing);
      this.timers.delete(key);
    }
  }

  cancelAllForRun(runId: string): void {
    for (const key of [...this.timers.keys()]) {
      if (key.startsWith(`${runId}:`)) {
        clearTimeout(this.timers.get(key)!);
        this.timers.delete(key);
      }
    }
  }
}
