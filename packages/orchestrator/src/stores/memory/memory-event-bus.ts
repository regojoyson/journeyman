import type { AppendEventArgs, IEventBus, RunEvent } from "@journeyman/core";

export class MemoryEventBus implements IEventBus {
  private rows: RunEvent[] = [];
  private nextId = 1;
  private listeners = new Map<string, Array<(ev: RunEvent) => void>>();

  async append(args: AppendEventArgs): Promise<RunEvent> {
    const ev: RunEvent = {
      id: this.nextId++,
      runId: args.runId,
      nodeId: args.nodeId ?? null,
      eventType: args.eventType,
      payload: args.payload,
      ts: new Date(),
    };
    this.rows.push(ev);
    for (const fn of (this.listeners.get(args.runId) ?? [])) fn(ev);
    return ev;
  }

  async list(runId: string, opts: { sinceId?: number; limit?: number } = {}): Promise<RunEvent[]> {
    let out = this.rows.filter(e => e.runId === runId);
    if (opts.sinceId !== undefined) out = out.filter(e => e.id > opts.sinceId!);
    if (opts.limit) out = out.slice(0, opts.limit);
    return out;
  }

  async *subscribe(runId: string, opts: { sinceId?: number } = {}): AsyncIterable<RunEvent> {
    for (const ev of await this.list(runId, opts)) yield ev;
    const queue: RunEvent[] = [];
    let resolve: (() => void) | null = null;
    const push = (ev: RunEvent) => {
      queue.push(ev);
      if (resolve) { resolve(); resolve = null; }
    };
    const list = this.listeners.get(runId) ?? [];
    list.push(push);
    this.listeners.set(runId, list);
    try {
      while (true) {
        if (queue.length === 0) await new Promise<void>(r => { resolve = r; });
        while (queue.length) yield queue.shift()!;
      }
    } finally {
      const arr = this.listeners.get(runId) ?? [];
      this.listeners.set(runId, arr.filter(f => f !== push));
    }
  }
}
