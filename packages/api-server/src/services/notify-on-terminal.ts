import type { Pool } from "pg";
import type { INotificationProvider, IWorkflowInstanceStore, WorkflowInstanceStatus } from "@journeyman/core";
import { getAgent } from "@journeyman/agents";
import { getConnection, getConnectionSealed } from "@journeyman/connections";
import { open } from "@journeyman/secrets";
import { SlackProvider, ConsoleProvider } from "@journeyman/notification-provider";

export interface NotifyOnTerminalDeps {
  pool: Pool;
  workflowInstances: IWorkflowInstanceStore;
}

/**
 * Builds the orchestrator's `notifyOnTerminal` hook: when an agent-tagged run
 * finishes, deliver the agent's configured notification (Slack/Console). Never
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

      let provider: INotificationProvider;
      if (conn.provider === "console") {
        provider = new ConsoleProvider();
      } else if (conn.provider === "slack") {
        const sealed = await getConnectionSealed(deps.pool, connectionId);
        if (!sealed) return;
        const credential = open(sealed);
        const method = (conn.config as { method?: string } | undefined)?.method === "webhook" ? "webhook" : "token";
        provider =
          method === "webhook"
            ? new SlackProvider({ method: "webhook", webhookUrl: credential })
            : new SlackProvider({ method: "token", token: credential });
      } else {
        return;
      }

      await provider.send({
        channel: agent.notifications.target ?? "",
        title: `Agent "${agent.name}" ${status}`,
        message: `Run ${workflowInstanceId} ${status}.`,
        sessionId: workflowInstanceId,
      });
    } catch {
      // never let a notification failure affect the run
    }
  };
}
