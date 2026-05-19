import type { AppendEventArgs, IEventBus, WorkflowInstanceEvent } from "@journeyman/core";

export class MemoryEventBus implements IEventBus {
  private rows: WorkflowInstanceEvent[] = [];
  private nextId = 1;
  private listeners = new Map<string, Array<(ev: WorkflowInstanceEvent) => void>>();

  async append(args: AppendEventArgs): Promise<WorkflowInstanceEvent> {
    const ev: WorkflowInstanceEvent = {
      id: this.nextId++,
      workflowInstanceId: args.workflowInstanceId,
      nodeId: args.nodeId ?? null,
      eventType: args.eventType,
      payload: args.payload,
      ts: new Date(),
    };
    this.rows.push(ev);
    for (const fn of (this.listeners.get(args.workflowInstanceId) ?? [])) fn(ev);
    return ev;
  }

  async list(workflowInstanceId: string, opts: { sinceId?: number; limit?: number } = {}): Promise<WorkflowInstanceEvent[]> {
    let out = this.rows.filter(e => e.workflowInstanceId === workflowInstanceId);
    if (opts.sinceId !== undefined) out = out.filter(e => e.id > opts.sinceId!);
    if (opts.limit) out = out.slice(0, opts.limit);
    return out;
  }

  async *subscribe(workflowInstanceId: string, opts: { sinceId?: number } = {}): AsyncIterable<WorkflowInstanceEvent> {
    for (const ev of await this.list(workflowInstanceId, opts)) yield ev;
    const queue: WorkflowInstanceEvent[] = [];
    let resolve: (() => void) | null = null;
    const push = (ev: WorkflowInstanceEvent) => {
      queue.push(ev);
      if (resolve) { resolve(); resolve = null; }
    };
    const list = this.listeners.get(workflowInstanceId) ?? [];
    list.push(push);
    this.listeners.set(workflowInstanceId, list);
    try {
      while (true) {
        if (queue.length === 0) await new Promise<void>(r => { resolve = r; });
        while (queue.length) yield queue.shift()!;
      }
    } finally {
      const arr = this.listeners.get(workflowInstanceId) ?? [];
      this.listeners.set(workflowInstanceId, arr.filter(f => f !== push));
    }
  }
}
