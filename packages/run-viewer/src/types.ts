import type { FlowGraph, NodeExecution, Run, RunEvent } from "@journeyman/core";

export type NodeStatus =
  | "pending"
  | "running"
  | "retry-backoff"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled";

export interface ResolvedNodeStatus {
  status: NodeStatus;
  attempt: number;
  startedAt?: Date;
  completedAt?: Date;
  durationMs?: number;
  errorClass?: string;
  visitCount: number;
}

export interface PendingHumanTaskOutput {
  name: string;
  type: "string" | "number" | "boolean" | "json" | "date";
  label?: string;
  description?: string;
  required?: boolean;
  default?: unknown;
}

export interface PendingHumanTask {
  nodeId: string;
  prompt?: string;
  outputs: PendingHumanTaskOutput[];
  startedAt: string;
  timeout?: { durationMs: number };
}

export interface HumanTaskHistoryEntry {
  nodeId: string;
  outcome: string;          // best-effort primary string for display
  comment: string | null;
  actor: string | null;
  source: "webhook" | "manual" | "timeout";
  resolvedAt: string;
}

export interface RunViewerProps {
  flow: FlowGraph;
  run: Run;
  events: RunEvent[];
  executions: NodeExecution[];
  pendingHumanTask?: PendingHumanTask | null;
  humanTaskHistory?: HumanTaskHistoryEntry[];
  onRerun?: () => void;
  onCancel?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onExport?: () => void;
  onRetryStep?: (nodeId: string) => void;
  onFork?: () => void;
  /** Caller resolves a pending human task (POSTs to the manual-resolve API). */
  onResolveHumanTask?: (input: {
    nodeId: string;
    values: Record<string, unknown>;
    comment?: string;
    data?: unknown;
  }) => Promise<void>;
  initialSelectedNodeId?: string | null;
}
