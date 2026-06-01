import type { ConductorClient } from "../engines/conductor/conductor-client.ts";

/**
 * Inspect a workflow's tasks. For every JOIN with `inputData.mode === "first-wins"`
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
  opts?: { tasks?: Awaited<ReturnType<ConductorClient["getWorkflowWithTasks"]>>["tasks"] },
): Promise<{ cancelled: string[] }> {
  const tasks = opts?.tasks ?? (await conductor.getWorkflowWithTasks(engineWorkflowId)).tasks;
  const cancelled: string[] = [];

  const joins = (tasks ?? []).filter(t =>
    t.taskType === "JOIN" && t.status === "IN_PROGRESS",
  );

  for (const join of joins) {
    // For a JOIN system task, Conductor copies `joinOn` into `inputData` but
    // drops the user-supplied `inputParameters` (mode, branchTaskRefs) — those
    // survive only on `workflowTask.inputParameters`. Read config from there
    // first, falling back to inputData for non-JOIN-mapped shapes / older runs.
    const wtParams = (join.workflowTask?.inputParameters ?? {}) as {
      mode?: string;
      branchTaskRefs?: string[][];
    };
    const inData = (join.inputData ?? {}) as {
      mode?: string;
      branchTaskRefs?: string[][];
      joinOn?: string[];
    };
    const mode = wtParams.mode ?? inData.mode;
    if (mode !== "first-wins") continue;
    const branches = wtParams.branchTaskRefs ?? inData.branchTaskRefs ?? [];
    if (branches.length < 2) continue;

    // joinOn lives on inputData / workflowTask for a JOIN; fall back across both.
    const joinOn =
      join.workflowTask?.joinOn ??
      (join as unknown as { joinOn?: string[] }).joinOn ??
      inData.joinOn ??
      [];

    const completedTerminals = new Set(
      (tasks ?? [])
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
        const task = (tasks ?? []).find(t => t.referenceTaskName === nodeId);
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
