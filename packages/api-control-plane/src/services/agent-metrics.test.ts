import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInfo = vi.fn();
vi.mock("@journeyman/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@journeyman/core")>();
  return { ...actual, createLogger: () => ({ info: mockInfo, error: vi.fn(), warn: vi.fn() }) };
});

const { makeRecordTerminalMetrics } = await import("./agent-metrics.ts");

function deps(getById: any) {
  return { pool: {} as any, workflowInstances: { getById } as any };
}

beforeEach(() => mockInfo.mockClear());

describe("makeRecordTerminalMetrics", () => {
  it("ignores non-terminal statuses", async () => {
    const getById = vi.fn();
    await makeRecordTerminalMetrics(deps(getById))("wi1", "running" as any);
    expect(getById).not.toHaveBeenCalled();
  });

  it("ignores runs with no agentId", async () => {
    await makeRecordTerminalMetrics(deps(vi.fn().mockResolvedValue({ inputs: {} })))("wi1", "completed");
    expect(mockInfo).not.toHaveBeenCalled();
  });

  it("logs a structured metric line for an agent run", async () => {
    const getById = vi.fn().mockResolvedValue({
      inputs: { agentId: "a1" },
      durationMs: 4200,
      triggerSource: "webhook",
      startedAt: null,
      completedAt: null,
    });
    await makeRecordTerminalMetrics(deps(getById))("wi1", "failed");
    expect(mockInfo).toHaveBeenCalledOnce();
    const [obj] = mockInfo.mock.calls[0];
    expect(obj).toMatchObject({
      metric: "agent_run_terminal",
      agentId: "a1",
      status: "failed",
      success: false,
      durationMs: 4200,
      triggerSource: "webhook",
    });
  });

  it("never throws when the store fails", async () => {
    const getById = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(makeRecordTerminalMetrics(deps(getById))("wi1", "completed")).resolves.toBeUndefined();
  });
});
