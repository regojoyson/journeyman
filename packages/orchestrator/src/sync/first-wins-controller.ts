import type { ConductorClient } from "../engines/conductor/conductor-client.ts";

/**
 * Inspect a workflow's tasks. For every JOIN with `inputData.errorMode === "first-wins"`
 * that is still IN_PROGRESS:
 *   - find the first branch whose terminal task has status COMPLETED
 *   - for every OTHER branch's still-pending task (IN_PROGRESS or SCHEDULED),
 *     mark it COMPLETED with cancellation metadata so the JOIN can resolve
 *
 * Idempotent: safe to call on every reconcile pass. Returns the list of
 * cancelled task ref names.
 */
export async function applyFirstWinsCancellation(
  conductor: ConductorClient,
  engineWorkflowId: string,
): Promise<{ cancelled: string[] }> {
  const wf = await conductor.getWorkflowWithTasks(engineWorkflowId);
  const cancelled: string[] = [];

  const joins = (wf.tasks ?? []).filter(t =>
    t.taskType === "JOIN" && t.status === "IN_PROGRESS",
  );

  for (const join of joins) {
    const params = (join.inputData ?? {}) as {
      errorMode?: string;
      branchTaskRefs?: string[][];
      joinOn?: string[];
    };
    if (params.errorMode !== "first-wins") continue;
    const branches = params.branchTaskRefs ?? [];
    if (branches.length < 2) continue;

    // Conductor records joinOn on the join task; fall back to inputData if not on top-level.
    const joinOn = (join as unknown as { joinOn?: string[] }).joinOn ?? params.joinOn ?? [];

    const completedTerminals = new Set(
      (wf.tasks ?? [])
        .filter(t => t.status === "COMPLETED" && joinOn.includes(t.referenceTaskName))
        .map(t => t.referenceTaskName),
    );
    if (completedTerminals.size === 0) continue;

    const winningBranchIdx = branches.findIndex(chain => {
      const terminal = chain[chain.length - 1];
      return terminal && completedTerminals.has(terminal);
    });
    if (winningBranchIdx < 0) continue;

    for (let i = 0; i < branches.length; i++) {
      if (i === winningBranchIdx) continue;
      for (const nodeId of branches[i]) {
        const task = (wf.tasks ?? []).find(t => t.referenceTaskName === nodeId);
        if (!task) continue;
        if (task.status !== "IN_PROGRESS" && task.status !== "SCHEDULED") continue;
        try {
          await conductor.completeTask({
            workflowInstanceId: engineWorkflowId,
            taskId: task.taskId,
            status: "COMPLETED",
            outputData: {
              cancelledBy: "first-wins-controller",
              joinTaskRef: join.referenceTaskName,
              cancelled: true,
            },
            reasonForIncompletion: "Cancelled by first-wins join",
          });
          cancelled.push(nodeId);
        } catch {
          // Best-effort — the task may have just transitioned. Idempotency wins.
        }
      }
    }
  }

  return { cancelled };
}
