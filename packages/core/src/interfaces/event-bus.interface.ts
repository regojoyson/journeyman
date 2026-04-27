import type { RunEvent, RunEventType } from "../types/run.types.ts";

export interface AppendEventArgs {
  runId: string;
  nodeId?: string | null;
  eventType: RunEventType;
  payload: Record<string, unknown>;
}

export interface IEventBus {
  append(args: AppendEventArgs): Promise<RunEvent>;
  list(runId: string, opts?: { sinceId?: number; limit?: number }): Promise<RunEvent[]>;
  /** Async iterator that yields events as they're appended (Phase 3 SSE). */
  subscribe(runId: string, opts?: { sinceId?: number }): AsyncIterable<RunEvent>;
}
