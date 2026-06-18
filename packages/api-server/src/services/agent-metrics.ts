import type { Pool } from "pg";
import type { IWorkflowInstanceStore, WorkflowInstanceStatus } from "@journeyman/core";
import { createLogger } from "@journeyman/core";

const log = createLogger("agent-metrics");

export interface AgentMetricsDeps {
  pool: Pool;
  workflowInstances: IWorkflowInstanceStore;
}

/**
 * On a terminal transition of an agent-tagged run, emit a structured metric
 * line (run count, success/fail, duration) tagged by agentId/orgId. The per-day
 * run tally is maintained at submit (4b); token/cost capture needs provider
 * usage plumbing and is deferred (RunCustomPromptResult exposes no usage). Never
 * throws — metrics must not affect the run.
 */
export function makeRecordTerminalMetrics(deps: AgentMetricsDeps) {
  return async (workflowInstanceId: string, status: WorkflowInstanceStatus): Promise<void> => {
    if (status !== "completed" && status !== "failed") return;
    try {
      const instance = await deps.workflowInstances.getById(workflowInstanceId);
      const agentId = (instance?.inputs as { agentId?: string } | undefined)?.agentId;
      if (!instance || !agentId) return;
      const startedAt = instance.startedAt ? new Date(instance.startedAt).getTime() : null;
      const completedAt = instance.completedAt ? new Date(instance.completedAt).getTime() : null;
      const durationMs =
        instance.durationMs ?? (startedAt != null && completedAt != null ? completedAt - startedAt : null);
      log.info(
        {
          metric: "agent_run_terminal",
          agentId,
          workflowInstanceId,
          status,
          success: status === "completed",
          durationMs,
          triggerSource: instance.triggerSource ?? null,
        },
        "agent run terminal",
      );
    } catch (err) {
      log.error({ err, workflowInstanceId }, "metrics record failed");
    }
  };
}
