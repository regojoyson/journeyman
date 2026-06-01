import { describe, it, expect } from "vitest";
import { MemoryNodeExecutionStore } from "./memory-workflow-instance-store.ts";

describe("markSkipped (memory)", () => {
  it("flips a waiting row to skipped and clears it from waiting lookups", async () => {
    const store = new MemoryNodeExecutionStore();
    const exec = await store.markWaiting("wi-1", "node-a", "ctask-1", { eventPath: "$.x", value: "1" });
    expect(exec.status).toBe("waiting");

    const skipped = await store.markSkipped(exec.id);
    expect(skipped.status).toBe("skipped");
    expect(skipped.completedAt).not.toBeNull();

    expect(await store.latestWaitingForInstance("wi-1")).toBeNull();
  });
});
