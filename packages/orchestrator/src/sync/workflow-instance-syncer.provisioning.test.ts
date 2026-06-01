import { describe, it, expect, vi } from "vitest";
import { WorkflowInstanceSyncer } from "./workflow-instance-syncer.ts";

describe("WorkflowInstanceSyncer provisioning", () => {
  it("polls the provisioning status during a sweep", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const syncer = new WorkflowInstanceSyncer({
      workflowInstances: { list } as never,
      orchestrator: { syncStatus: vi.fn() } as never,
      events: { append: vi.fn() } as never,
    });

    await syncer.syncOnce();

    const polledStatuses = list.mock.calls.map((c) => c[0]?.status);
    expect(polledStatuses).toContain("provisioning");
  });
});
