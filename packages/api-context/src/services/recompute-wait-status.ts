import type { Composition } from "../composition.ts";
import { isTerminalStatus } from "@journeyman/core";

/**
 * Derive paused/running from waiting node-executions and persist it.
 *   - waiting row exists  → "paused"
 *   - none                → "running"
 *   - terminal instance   → no-op (the engine owns terminal states)
 *
 * Safety: only call this in contexts where the run is genuinely engine-RUNNING
 * (after resolving/cancelling a wait, or from the backstop which has confirmed
 * the engine is RUNNING). A *manually* paused run reports Conductor PAUSED and
 * is never a caller here, so this never un-pauses a manual pause.
 */
export async function recomputeWaitStatus(c: Composition, workflowInstanceId: string): Promise<void> {
  const instance = await c.workflowInstances.getById(workflowInstanceId);
  if (!instance || isTerminalStatus(instance.status)) return;
  const waiting = await c.nodeExecutions.latestWaitingForInstance(workflowInstanceId);
  const desired = waiting ? "paused" : "running";
  if (instance.status !== desired) {
    await c.workflowInstances.setStatus(workflowInstanceId, desired);
  }
}
