import type { PipelineEvent } from "@journeyman/core";

type Listener = (e: PipelineEvent) => void;

export class EventBus {
  private listeners = new Map<string, Set<Listener>>();
  private buffers = new Map<string, PipelineEvent[]>();

  constructor(private readonly bufferSize: number = 500) {}

  publish(e: PipelineEvent): void {
    const ls = this.listeners.get(e.sessionId);
    if (ls) for (const l of ls) l(e);

    let buf = this.buffers.get(e.sessionId);
    if (!buf) { buf = []; this.buffers.set(e.sessionId, buf); }
    buf.push(e);
    if (buf.length > this.bufferSize) buf.splice(0, buf.length - this.bufferSize);
  }

  subscribe(sessionId: string, listener: Listener): () => void {
    let set = this.listeners.get(sessionId);
    if (!set) { set = new Set(); this.listeners.set(sessionId, set); }
    set.add(listener);
    return () => { set!.delete(listener); };
  }

  replay(sessionId: string): PipelineEvent[] {
    return [...(this.buffers.get(sessionId) ?? [])];
  }
}
