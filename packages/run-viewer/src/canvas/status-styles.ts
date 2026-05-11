import type { NodeStatus } from "../types.ts";

export const STATUS_CLASS: Record<NodeStatus, string> = {
  "pending":       "je-runnode--pending",
  "running":       "je-runnode--running",
  "retry-backoff": "je-runnode--retry",
  "waiting":       "je-runnode--waiting",
  "completed":     "je-runnode--completed",
  "failed":        "je-runnode--failed",
  "cancelled":     "je-runnode--cancelled",
  "skipped":       "je-runnode--skipped",
};

export const STATUS_LABEL: Record<NodeStatus, string> = {
  "pending":       "pending",
  "running":       "running",
  "retry-backoff": "retry…",
  "waiting":       "⏳ waiting",
  "completed":     "✓",
  "failed":        "✗",
  "cancelled":     "cancelled",
  "skipped":       "skipped",
};
