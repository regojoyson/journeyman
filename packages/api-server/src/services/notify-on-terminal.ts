import type { Pool } from "pg";
import type { IWorkflowInstanceStore, WorkflowInstanceStatus } from "@journeyman/core";
import { createLogger } from "@journeyman/core";
import { getAgent } from "@journeyman/agents";
import { getConnection, getConnectionSealed } from "@journeyman/connections";
import { open } from "@journeyman/secrets";
import { buildNotificationProvider } from "@journeyman/notification-provider";

const log = createLogger("agent:notify");

export interface NotifyOnTerminalDeps {
  pool: Pool;
  workflowInstances: IWorkflowInstanceStore;
}

/**
 * Builds the orchestrator's `notifyOnTerminal` hook: when an agent-tagged run
 * finishes, deliver the agent's configured notification (console/slack/email). Never
 * throws — notification failures are swallowed so they can't fail the run.
 */
export function makeNotifyOnTerminal(deps: NotifyOnTerminalDeps) {
  return async (workflowInstanceId: string, status: WorkflowInstanceStatus): Promise<void> => {
    if (status !== "completed" && status !== "failed") return;
    try {
      const instance = await deps.workflowInstances.getById(workflowInstanceId);
      const agentId = (instance?.inputs as { agentId?: string } | undefined)?.agentId;
      if (!agentId) return;
      const agent = await getAgent(deps.pool, agentId);
      if (!agent) return;
      const want = status === "completed" ? "success" : "failure";
      if (!agent.notifications.on.includes(want)) return;
      const connectionId = agent.notifications.connectionId;
      if (!connectionId) return;

      const conn = await getConnection(deps.pool, connectionId);
      if (!conn || conn.category !== "notification") return;

      const sealed = await getConnectionSealed(deps.pool, connectionId);
      const credential = sealed ? open(sealed) : "";
      const provider = buildNotificationProvider(
        conn.provider,
        (conn.config ?? {}) as Record<string, unknown>,
        credential,
      );

      const result = await provider.send({
        channel: agent.notifications.target ?? "",
        title: `Agent "${agent.name}" ${status}`,
        message: `Run ${workflowInstanceId} ${status}.`,
        sessionId: workflowInstanceId,
      });
      if (result && result.success === false) {
        log.warn({ workflowInstanceId, agentId, provider: conn.provider, error: result.error }, "agent notification delivery failed — ignored");
      }
    } catch (err: any) {
      // never let a notification failure affect the run — log and ignore
      log.warn({ workflowInstanceId, error: err?.message ?? String(err) }, "agent notification errored — ignored");
    }
  };
}
