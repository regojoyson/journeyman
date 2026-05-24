import type pino from "pino";

export interface WorkflowLogCtx {
  workflowInstanceId: string;
  nodeId: string;
  stepType: string;
  attempt: number;
  taskId: string;
  workerId: string;
}

export function createWorkflowLogger(base: pino.Logger, ctx: WorkflowLogCtx): pino.Logger {
  return base.child(ctx);
}

function debugRunIds(): Set<string> {
  const raw = (typeof process !== "undefined" ? process.env?.DEBUG_WORKFLOW_IDS : undefined) ?? "";
  return new Set(raw.split(",").map(s => s.trim()).filter(Boolean));
}

export function loggerForRun(base: pino.Logger, ctx: WorkflowLogCtx): pino.Logger {
  const ids = debugRunIds();
  const opts = ids.has(ctx.workflowInstanceId) ? { level: "debug" as const } : undefined;
  return opts ? base.child(ctx, opts) : base.child(ctx);
}
