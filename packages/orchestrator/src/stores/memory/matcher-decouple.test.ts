import { describe, it, expect } from "vitest";
import { MemoryWorkflowInstanceStore, MemoryNodeExecutionStore } from "./memory-workflow-instance-store.ts";

function makeInstance(instances: MemoryWorkflowInstanceStore) {
  return instances.create({
    workflowId: "w", workflowVersionId: "v", workflowNameSnapshot: "n",
    workflowScopeSnapshot: "user", definitionSnapshot: { nodes: [], edges: [] } as never,
    triggerSource: "manual", startedByUserId: null, startedByOrgId: null, inputs: {},
  });
}

describe("findAllWaitingWithCorrelation — decoupled from paused", () => {
  it("matches a waiting+correlated node on a RUNNING (non-terminal) instance", async () => {
    const instances = new MemoryWorkflowInstanceStore();
    const nodes = new MemoryNodeExecutionStore(instances);
    const inst = await makeInstance(instances);
    await instances.setStatus(inst.id, "running");
    await nodes.markWaiting(inst.id, "wh", "ctask", { eventPath: "$.n", value: "6" });

    const found = await nodes.findAllWaitingWithCorrelation();
    expect(found.map(f => f.workflowInstanceId)).toContain(inst.id);
  });

  it("excludes terminal instances", async () => {
    const instances = new MemoryWorkflowInstanceStore();
    const nodes = new MemoryNodeExecutionStore(instances);
    const inst = await makeInstance(instances);
    await nodes.markWaiting(inst.id, "wh", "ctask", { eventPath: "$.n", value: "6" });
    await instances.setStatus(inst.id, "completed");

    const found = await nodes.findAllWaitingWithCorrelation();
    expect(found.map(f => f.workflowInstanceId)).not.toContain(inst.id);
  });
});
