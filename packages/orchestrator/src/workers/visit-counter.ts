export class VisitCounter {
  private counts = new Map<string, number>();
  private limit: number;

  constructor(limit: number = 100) { this.limit = limit; }

  setLimit(limit: number): void { this.limit = limit; }

  /** Records a visit and returns whether the limit was exceeded. */
  recordVisit(runId: string, nodeId: string): { count: number; exceeded: boolean } {
    const key = `${runId}::${nodeId}`;
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return { count: next, exceeded: next > this.limit };
  }

  /** Best-effort cleanup once a run terminates. */
  forgetRun(runId: string): void {
    for (const k of this.counts.keys()) {
      if (k.startsWith(`${runId}::`)) this.counts.delete(k);
    }
  }
}
