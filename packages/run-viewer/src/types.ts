import type { FlowGraph, NodeExecution, Run, RunEvent } from "@journeyman/core";

export type NodeStatus =
  | "pending"
  | "running"
  | "retry-backoff"
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

export interface RunViewerProps {
  flow: FlowGraph;
  run: Run;
  events: RunEvent[];
  executions: NodeExecution[];
  onRerun?: () => void;
  onCancel?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onExport?: () => void;
  onRetryStep?: (nodeId: string) => void;
  onFork?: () => void;
  initialSelectedNodeId?: string | null;
}
