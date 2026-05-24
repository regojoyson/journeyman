import type { Composition } from "../composition.ts";
import type { HumanTaskNotifyConfig } from "@journeyman/core";
import { notifyOnHumanTaskPause } from "./notify-on-human-task-pause.ts";

export interface ReconcileResult {
  pendingNodeIds: string[];
}

/**
 * Sync our DB with Conductor's view for a single workflow instance. Specifically:
 *   - find HUMAN tasks with Conductor status IN_PROGRESS
 *   - upsert NodeExecution rows with status='waiting' and conductor_task_id
 *   - set WorkflowInstance.status='paused' if any HUMAN task is in progress
 *   - emit `node.waiting` event the first time we see one
 *   - schedule timeout timers per the node's config.timeout
 *
 * Idempotent. Call before any read or resolve operation that depends on
 * "is this workflow instance waiting on a human?".
 */
export async function reconcileWorkflowInstance(c: Composition, workflowInstanceId: string): Promise<ReconcileResult> {
  const workflowInstance = await c.workflowInstances.getById(workflowInstanceId);
  if (!workflowInstance || !workflowInstance.engineWorkflowId) return { pendingNodeIds: [] };

  let wf;
  try {
    wf = await c.conductorClient.getWorkflowWithTasks(workflowInstance.engineWorkflowId);
  } catch {
    // If Conductor is unreachable we leave the DB as-is.
    return { pendingNodeIds: [] };
  }

  const humanInProgress = (wf.tasks ?? []).filter(t =>
    t.taskType === "HUMAN" && t.status === "IN_PROGRESS",
  );

  const pendingNodeIds: string[] = [];
  for (const t of humanInProgress) {
    const nodeId = t.referenceTaskName;
    const existing = await c.nodeExecutions.latestForNode(workflowInstanceId, nodeId);
    const isNewlyWaiting = !existing || existing.status !== "waiting";

    await c.nodeExecutions.markWaiting(workflowInstanceId, nodeId, t.taskId);

    if (isNewlyWaiting) {
      const node = workflowInstance.definitionSnapshot.nodes.find(n => n.id === nodeId);
      const cfg = (node?.config ?? {}) as {
        prompt?: string;
        outputs?: Array<{ name: string }>;
        listensFor?: string[];
        notify?: HumanTaskNotifyConfig;
        timeout?: { duration: string; defaults?: Record<string, unknown> };
      };
      await c.events.append({
        workflowInstanceId,
        nodeId,
        eventType: "node.waiting",
        payload: {
          prompt: cfg.prompt,
          outputs: (cfg.outputs ?? []).map(o => o.name),
          listensFor: cfg.listensFor,
        },
      });

      if (node?.type === "human-task" && cfg.notify) {
        await notifyOnHumanTaskPause(c, {
          workflowInstanceId,
          nodeId,
          notify: cfg.notify,
          prompt: cfg.prompt,
        });
      }

      if (cfg.timeout) {
        const ms = parseDurationMsLite(cfg.timeout.duration);
        const defaults = cfg.timeout.defaults ?? {};
        if (ms > 0) {
          c.humanTaskTimeouts.schedule(workflowInstanceId, nodeId, ms, async () => {
            const { resolveHumanTask } = await import("./resolve-human-task.ts");
            try {
              await resolveHumanTask(c, {
                workflowInstanceId, nodeId,
                values: defaults,
                payload: {},
                actor: null,
                source: "timeout",
              });
            } catch {
              // Already resolved by webhook/manual or workflow instance cancelled — not an error.
            }
          });
        }
      }
    }

    pendingNodeIds.push(nodeId);
  }

  if (humanInProgress.length > 0 && workflowInstance.status !== "paused") {
    await c.workflowInstances.setStatus(workflowInstanceId, "paused");
  }

  return { pendingNodeIds };
}

function parseDurationMsLite(input: string): number {
  const m = /^(\d+)\s*(ms|s|m|h|d)$/.exec(input.trim());
  if (!m) return 0;
  const n = Number(m[1]);
  return n * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const)[m[2] as "ms"];
}
