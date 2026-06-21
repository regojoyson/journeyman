import { describe, it, expect, vi } from "vitest";

const runAgentMock = vi.fn().mockResolvedValue({ workflowInstanceId: "wi1", engineWorkflowId: null });
vi.mock("@journeyman/agents", () => ({
  getAgent: vi.fn().mockResolvedValue({
    id: "ag1",
    orgId: "o1",
    enabled: true,
    triggers: [{ type: "schedule", cron: "0 2 * * *", timezone: "UTC", fixedInputs: { k: "v" } }],
  }),
  runAgentGuarded: (...args: unknown[]) => runAgentMock(...args),
  wasSkipped: (r: any) => r != null && "skipped" in r,
}));

import { nextRun, tickOnce } from "./agent-scheduler.ts";

describe("nextRun", () => {
  it("returns a future time for a daily cron", () => {
    const from = new Date("2026-06-18T00:00:00Z");
    const next = nextRun("0 2 * * *", "UTC", from);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
    expect(next.toISOString()).toBe("2026-06-18T02:00:00.000Z");
  });
});

describe("tickOnce", () => {
  it("fires due schedules once and advances next_due_at", async () => {
    const calls: string[] = [];
    const pool: any = {
      query: vi.fn().mockImplementation((sql: string) => {
        calls.push(sql);
        if (/UPDATE jm_agent_schedule_state[\s\S]*RETURNING/.test(sql)) {
          return Promise.resolve({ rows: [{ agent_id: "ag1", cron: "0 2 * * *", timezone: "UTC" }] });
        }
        return Promise.resolve({ rows: [] });
      }),
    };
    const fired = await tickOnce(pool, { orchestrator: { submit: vi.fn() } } as any);
    expect(fired).toBe(1);
    expect(runAgentMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "ag1" }),
      { k: "v" },
      "schedule",
      expect.objectContaining({ orgId: "o1" }),
    );
    // claim query + advance-next_due query
    expect(calls.some((s) => /SET next_due_at/.test(s))).toBe(true);
  });
});
