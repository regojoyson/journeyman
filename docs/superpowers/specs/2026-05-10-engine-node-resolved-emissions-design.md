# Engine Node `node.resolved` Emissions — Design

**Date:** 2026-05-10
**Status:** Approved

## Problem

The run viewer derives node status from events. Phase nodes emit
`phase.started`/`phase.completed` from the worker-harness, but several node
types compile to engine-internal Conductor tasks with no worker, so they
emit no status events and stay `pending` even after they execute.

Affected node types
([conductor-converter.ts:148-162](../../../packages/orchestrator/src/flow-json/conductor-converter.ts)):

| Node type      | Conductor task | Currently emits status?                  |
| -------------- | -------------- | ---------------------------------------- |
| `phase`        | SIMPLE         | ✓ via worker-harness `phase.*`           |
| `if`           | SWITCH         | ✗                                        |
| `gateway-xor`  | SWITCH         | ✗                                        |
| `gateway-and`  | FORK_JOIN      | ✗                                        |
| `loop`         | DO_WHILE       | ✗                                        |
| `timer`        | WAIT           | ✗                                        |
| `subflow`      | SUB_WORKFLOW   | ✗                                        |
| `human-task`   | HUMAN          | ✓ via `node.waiting` + `node.resolved`   |
| `start`        | —              | ✓ explicit emission at instance start    |
| `end`          | TERMINATE      | ✓ via `emitEndNodeCompleted`             |

Today, `emitEndNodeCompleted`
([conductor-orchestrator.ts:180](../../../packages/orchestrator/src/engines/conductor/conductor-orchestrator.ts))
already handles TERMINATE on instance terminal sync. The fix is to extend
that sweep to cover all engine-internal task types in one place.

This bug interacts with the recently-added "skipped" sweep in
`compute-node-status.ts`: without this fix, gateway/loop/timer/subflow nodes
that *did* execute get mislabelled `skipped` on terminal runs.

## Goals

- On instance terminal sync, emit `node.resolved` for every COMPLETED
  Conductor task that doesn't already produce its own status events.
- Reached non-phase nodes show `completed` in the viewer.
- Unreached nodes still flow into the existing `skipped` pass.
- No new task-type-specific branches in the orchestrator — one rule covers
  current and future Conductor task types.

## Non-goals

- Live emission as each task completes mid-run. Same constraint as
  `emitEndNodeCompleted` today: emission happens on terminal sync. Acceptable
  because most affected types (SWITCH, FORK_JOIN, WAIT, TERMINATE) are short
  or naturally bracket worker-driven phases that already animate the canvas.
- Backfilling events for older completed instances. Append-only event log;
  legacy runs will still show their pre-fix state.
- Custom payload shaping per task type beyond `{ taskType, output }`.

## Design

Rename `emitEndNodeCompleted` → `emitEngineNodeResolveds`. Replace its body
with a generic loop. Skip task types whose nodes already emit status from
elsewhere: `SIMPLE` (phase, via worker-harness) and `HUMAN` (human-task,
emits its own `node.waiting`/`node.resolved`).

```ts
private async emitEngineNodeResolveds(instance: WorkflowInstance): Promise<void> {
  if (!instance.engineWorkflowId) return;
  try {
    const exec = await this.deps.client.getWorkflowWithTasks(instance.engineWorkflowId);
    for (const t of exec.tasks) {
      if (t.status !== "COMPLETED") continue;
      // Skip types whose nodes already produce status events:
      // SIMPLE → worker-harness emits phase.*
      // HUMAN  → emits node.waiting + node.resolved on its own
      if (t.taskType === "SIMPLE" || t.taskType === "HUMAN") continue;
      await this.deps.events.append({
        workflowInstanceId: instance.id,
        nodeId: t.referenceTaskName,
        eventType: "node.resolved",
        payload: { taskType: t.taskType, output: t.outputData ?? {} },
      });
    }
  } catch (err) {
    log.warn(
      { workflowInstanceId: instance.id, err: (err as Error)?.message },
      "failed to emit engine node resolved events",
    );
  }
}
```

Update the call site at line 160 (`await this.emitEndNodeCompleted(instance);`)
to `await this.emitEngineNodeResolveds(instance);`.

Update the JSDoc above the function to describe the broader scope.

### Interaction with the skipped sweep

After this fix, on any terminal run:

- Reached non-phase engine nodes (if, xor, and-join, loop, timer, subflow,
  end) receive `node.resolved` → status `completed`.
- Reached phase nodes → `phase.completed` (unchanged).
- Reached human-task nodes → `node.resolved` (unchanged).
- Unreached nodes stay `pending` → swept to `skipped` by the terminal pass
  in `compute-node-status.ts`.

## Edge cases

| Scenario                                       | Behavior                                                   |
| ---------------------------------------------- | ---------------------------------------------------------- |
| Loop body that ran N iterations                | DO_WHILE task → one resolved emission for the loop node. Inner phases keep emitting `phase.*` per attempt. |
| Fork-join with parallel branches               | FORK_JOIN → one resolved emission. Inner phases unchanged.|
| Subflow completed                              | SUB_WORKFLOW → resolved on the parent's subflow node. Child instance events are independent. |
| Workflow failed before non-phase node executed | Task isn't COMPLETED → no event → node stays pending → swept to `skipped`. Correct. |
| Workflow cancelled mid-flight after if evaluated | SWITCH was COMPLETED → emit fires → if shows ✓; downstream pending → cancelled (existing pass). |
| Future Conductor task type added               | Falls through the filter → emits resolved → node shows completed. If a future type needs special handling, add to the skip list. |
| Older instances with no SWITCH/FORK_JOIN events | Will still show those nodes as `skipped` after the prior change. Acceptable; legacy view. |

## Verification

Manual smoke test on the run from the user's screenshot
(`localhost:5173/workflow-instances/3fc1de85-...`):

- After the fix, the `if` node shows ✓ instead of `pending`/`skipped`.
- Untaken branch's "Add comment on Ticket" and bottom End remain `skipped`.
- Open a workflow with a `gateway-and` (parallel fork-join) → reached
  fork-join shows ✓.
- Open a workflow with a `timer` node that fired → shows ✓.
- Open a still-running workflow → unreached nodes still show `pending`
  (terminal logic must NOT fire mid-run — same constraint as
  `emitEndNodeCompleted` today).
