import { describe, it, expect, vi } from "vitest";
import { WorkflowInstanceSyncer } from "./workflow-instance-syncer.ts";

function makeDeps(instances: Array<{ id: string; status: string }>, liveStatus: string) {
  const reconcilePaused = vi.fn().mockResolvedValue(undefined);
  const append = vi.fn().mockResolvedValue(undefined);
  const deps = {
    workflowInstances: {
      list: vi.fn().mockImplementation(async ({ status }: { status: string }) =>
        instances.filter(i => i.status === status)),
    },
    orchestrator: { syncStatus: vi.fn().mockResolvedValue(liveStatus) },
    events: { append },
    reconcilePaused,
  } as never;
  return { deps, reconcilePaused, append };
}

describe("WorkflowInstanceSyncer", () => {
  it("calls reconcilePaused for paused instances", async () => {
    const { deps, reconcilePaused } = makeDeps([{ id: "p1", status: "paused" }], "paused");
    await new WorkflowInstanceSyncer(deps).syncOnce();
    expect(reconcilePaused).toHaveBeenCalledWith("p1");
  });

  it("does NOT re-emit workflow_instance.started on a paused → running transition", async () => {
    const { deps, append } = makeDeps([{ id: "p1", status: "paused" }], "running");
    await new WorkflowInstanceSyncer(deps).syncOnce();
    const started = append.mock.calls.find((call: unknown[]) => (call[0] as { eventType?: string })?.eventType === "workflow_instance.started");
    expect(started).toBeUndefined();
  });
});
