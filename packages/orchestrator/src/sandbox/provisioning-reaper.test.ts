import { describe, it, expect, vi } from "vitest";
import { ProvisioningReaper } from "./provisioning-reaper.ts";

describe("ProvisioningReaper", () => {
  it("fails every stuck run and returns the count", async () => {
    const failRun = vi.fn().mockResolvedValue(undefined);
    const reaper = new ProvisioningReaper({
      findStuck: async () => ["a", "b"],
      failRun,
    });

    const reaped = await reaper.reapOnce();

    expect(reaped).toBe(2);
    expect(failRun).toHaveBeenCalledWith("a");
    expect(failRun).toHaveBeenCalledWith("b");
  });

  it("does nothing when no runs are stuck", async () => {
    const failRun = vi.fn();
    const reaper = new ProvisioningReaper({ findStuck: async () => [], failRun });

    const reaped = await reaper.reapOnce();

    expect(reaped).toBe(0);
    expect(failRun).not.toHaveBeenCalled();
  });

  it("continues past a failRun error and counts only successes", async () => {
    const failRun = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    const reaper = new ProvisioningReaper({ findStuck: async () => ["a", "b"], failRun });

    const reaped = await reaper.reapOnce();

    expect(reaped).toBe(1);
  });
});
