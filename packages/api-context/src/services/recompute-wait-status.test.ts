import { describe, it, expect, vi } from "vitest";
import { recomputeWaitStatus } from "./recompute-wait-status.ts";

function makeC(status: string, hasWaiting: boolean) {
  const setStatus = vi.fn().mockResolvedValue(undefined);
  const c = {
    workflowInstances: {
      getById: vi.fn().mockResolvedValue(status ? { id: "wi", status } : null),
      setStatus,
    },
    nodeExecutions: {
      latestWaitingForInstance: vi.fn().mockResolvedValue(hasWaiting ? { id: "ne" } : null),
    },
  } as never;
  return { c, setStatus };
}

describe("recomputeWaitStatus", () => {
  it("sets paused when a waiting row exists", async () => {
    const { c, setStatus } = makeC("running", true);
    await recomputeWaitStatus(c, "wi");
    expect(setStatus).toHaveBeenCalledWith("wi", "paused");
  });
  it("sets running when no waiting row exists", async () => {
    const { c, setStatus } = makeC("paused", false);
    await recomputeWaitStatus(c, "wi");
    expect(setStatus).toHaveBeenCalledWith("wi", "running");
  });
  it("is a no-op when status already matches", async () => {
    const { c, setStatus } = makeC("running", false);
    await recomputeWaitStatus(c, "wi");
    expect(setStatus).not.toHaveBeenCalled();
  });
  it("never touches a terminal instance", async () => {
    const { c, setStatus } = makeC("completed", false);
    await recomputeWaitStatus(c, "wi");
    expect(setStatus).not.toHaveBeenCalled();
  });
});
