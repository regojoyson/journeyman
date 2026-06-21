import { describe, it, expect, vi } from "vitest";
import { startControlPlane } from "./start-control-plane.ts";

function fakeComposition() {
  return {
    pool: { query: vi.fn().mockResolvedValue({ rows: [] }), end: vi.fn() },
    orchestrator: {},
    events: { append: vi.fn().mockResolvedValue(undefined) },
    workflowInstances: { getById: vi.fn(), setStatus: vi.fn(), listByStatus: vi.fn().mockResolvedValue([]) },
    nodeExecutions: {},
    humanTaskTimeouts: { schedule: vi.fn(), cancel: vi.fn(), cancelAllForRun: vi.fn() },
    sandboxInstanceRoutesDeps: { destroy: vi.fn(), isRunActive: vi.fn().mockResolvedValue(false) },
  } as any;
}

describe("startControlPlane", () => {
  it("returns a stop() that is safe to call and stops all loops", () => {
    const c = fakeComposition();
    const stop = startControlPlane(c);
    expect(typeof stop).toBe("function");
    expect(() => stop()).not.toThrow();
  });
});
