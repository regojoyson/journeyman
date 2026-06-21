import type { Composition } from "@journeyman/api-context";
import { parseDurationMs, reconcileWorkflowInstance, resolveHumanTask, startAgentScheduler } from "@journeyman/api-context";
import type { WorkflowInstanceStatus } from "@journeyman/core";
import { WorkflowInstanceSyncer, ProvisioningReaper, findStuckProvisioningRuns } from "@journeyman/orchestrator";
import { SandboxInstanceReaper, listActiveSandboxInstances, markSandboxInstanceDestroyed } from "@journeyman/sandbox";
import { WebhookWaitSweeper } from "./services/webhook-wait-sweeper.ts";

/**
 * Starts every background/control-plane loop. MUST run in exactly ONE process
 * (the api-control-plane service) — the timers double-fire with >1 replica.
 * Returns a stop() that halts all loops (idempotent / safe to call once).
 */
export function startControlPlane(c: Composition): () => void {
  const stops: Array<() => void> = [];

  // 1. Run-status syncer (Conductor → DB) + paused-run reconciliation.
  const syncer = new WorkflowInstanceSyncer({
    workflowInstances: c.workflowInstances,
    orchestrator: c.orchestrator,
    events: c.events,
    intervalMs: Number(process.env.RUN_SYNC_INTERVAL_MS ?? 1500),
    reconcilePaused: (id: string) => reconcileWorkflowInstance(c, id).then(() => undefined),
  });
  syncer.start();
  stops.push(() => syncer.stop());

  // 2. Webhook-wait max-age sweeper.
  const maxAgeStr = (process.env.JOURNEYMAN_WEBHOOK_WAIT_MAX_AGE ?? "30d").trim();
  const intervalStr = (process.env.JOURNEYMAN_WEBHOOK_WAIT_SWEEP_INTERVAL ?? "5m").trim();
  const sweeperDisabled = maxAgeStr === "" || maxAgeStr.toLowerCase() === "off";
  const maxAgeMs = sweeperDisabled ? 0 : parseDurationMs(maxAgeStr);
  if (!sweeperDisabled && maxAgeMs === 0) {
    throw new Error(`Invalid JOURNEYMAN_WEBHOOK_WAIT_MAX_AGE: "${maxAgeStr}". Use "30d", "12h", "90m", or "off".`);
  }
  const intervalMs = parseDurationMs(intervalStr) || 5 * 60_000;
  const sweeper = new WebhookWaitSweeper({
    maxAgeMs, intervalMs, batchSize: 500,
    nodeExecutions: c.nodeExecutions, workflowInstances: c.workflowInstances,
    fire: async ({ workflowInstanceId, nodeId, defaults }) => {
      try {
        await resolveHumanTask(c, {
          workflowInstanceId, nodeId, values: defaults, payload: {},
          actor: null, source: "timeout", resolvedBy: "max_age_sweep",
        });
      } catch { /* already resolved or cancelled — not an error */ }
    },
  });
  sweeper.start();
  stops.push(() => sweeper.stop());

  // 3. Scheduled-agent firing.
  if (c.pool) {
    const schedulerStop = startAgentScheduler(c.pool, { orchestrator: c.orchestrator });
    if (typeof schedulerStop === "function") stops.push(schedulerStop);
  }

  // 4. Sandbox-instance reaper + 5. stuck-provisioning reaper.
  if (c.pool && c.sandboxInstanceRoutesDeps) {
    const reaper = new SandboxInstanceReaper({
      listActive: () => listActiveSandboxInstances(c.pool!),
      isRunActive: c.sandboxInstanceRoutesDeps.isRunActive,
      destroy: c.sandboxInstanceRoutesDeps.destroy,
      markDestroyed: (id) => markSandboxInstanceDestroyed(c.pool!, id),
    });
    stops.push(reaper.start(Number(process.env.SANDBOX_REAP_INTERVAL_MS ?? 60_000)));

    const PROVISION_TIMEOUT_MS = Number(process.env.PROVISION_TIMEOUT_MS ?? 600_000);
    const provisioningReaper = new ProvisioningReaper({
      findStuck: () => findStuckProvisioningRuns(c.pool!, PROVISION_TIMEOUT_MS),
      failRun: async (id: string) => {
        await c.events
          .append({ workflowInstanceId: id, eventType: "step.log", payload: { line: "Run failed: sandbox provisioning timed out" } })
          .catch(() => undefined);
        await c.workflowInstances.setStatus(id, "failed" as WorkflowInstanceStatus, { completedAt: new Date() });
      },
    });
    stops.push(provisioningReaper.start(Number(process.env.PROVISION_REAP_INTERVAL_MS ?? 60_000)));
  }

  return () => { for (const s of stops) { try { s(); } catch { /* idempotent */ } } };
}
