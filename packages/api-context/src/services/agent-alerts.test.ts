import { describe, it, expect } from "vitest";
import { evaluateAlerts, DEFAULT_THRESHOLDS } from "./agent-alerts.ts";

function fakePool(handlers: Array<{ match: string; rows: any[] }>) {
  return {
    query: async (sql: string) => {
      for (const h of handlers) if (sql.includes(h.match)) return { rows: h.rows };
      return { rows: [] };
    },
  } as any;
}

const FAILRATE = "FILTER (WHERE status = 'failed')";
const STUCK = "status = 'running'";
const NEARCAP = "jm_agent_run_counters c";

describe("evaluateAlerts", () => {
  it("returns no alerts when everything is healthy", async () => {
    const pool = fakePool([]);
    expect(await evaluateAlerts(pool)).toEqual([]);
  });

  it("flags a high failure rate above the threshold and min runs", async () => {
    const pool = fakePool([{ match: FAILRATE, rows: [{ agent_id: "a1", total: 10, failed: 8 }] }]);
    const alerts = await evaluateAlerts(pool);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "failure_rate", agentId: "a1", detail: { total: 10, failed: 8 } });
  });

  it("does not flag failure rate below min runs", async () => {
    const pool = fakePool([{ match: FAILRATE, rows: [{ agent_id: "a1", total: 3, failed: 3 }] }]);
    expect(await evaluateAlerts(pool)).toEqual([]);
  });

  it("flags a stuck run", async () => {
    const pool = fakePool([{ match: STUCK, rows: [{ id: "wi1", agent_id: "a1", age_ms: 9_000_000 }] }]);
    const alerts = await evaluateAlerts(pool);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "stuck_run", agentId: "a1", detail: { workflowInstanceId: "wi1" } });
  });

  it("flags near-daily-cap at the configured fraction", async () => {
    // cap 10, fraction 0.8 → trips at runs >= 8
    const pool = fakePool([{ match: NEARCAP, rows: [{ agent_id: "a1", org_id: "o1", runs: 8, cap: 10 }] }]);
    const alerts = await evaluateAlerts(pool);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "near_daily_cap", agentId: "a1", orgId: "o1", detail: { runs: 8, cap: 10 } });
  });

  it("does not flag near-cap when cap is null", async () => {
    const pool = fakePool([{ match: NEARCAP, rows: [{ agent_id: "a1", org_id: "o1", runs: 50, cap: null }] }]);
    expect(await evaluateAlerts(pool)).toEqual([]);
  });

  it("respects custom thresholds", async () => {
    const pool = fakePool([{ match: FAILRATE, rows: [{ agent_id: "a1", total: 10, failed: 4 }] }]);
    // default failRate 0.5 → 0.4 is fine; lower the bar to 0.3 → trips
    expect(await evaluateAlerts(pool)).toEqual([]);
    expect(await evaluateAlerts(pool, { ...DEFAULT_THRESHOLDS, failRate: 0.3 })).toHaveLength(1);
  });
});
