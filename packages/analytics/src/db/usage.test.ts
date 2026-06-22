import { describe, it, expect } from "vitest";
import { DIMENSION_SQL, costPerRun, cacheReadHitRatio, WASTE_OUTCOME_PREDICATE, usageWaste } from "./usage.ts";

describe("DIMENSION_SQL whitelist", () => {
  it("maps known dimensions and omits unknown ones", () => {
    expect(DIMENSION_SQL.model.group).toBe("provider, model");
    expect(DIMENSION_SQL.agent.group).toContain("agent_id");
    expect((DIMENSION_SQL as Record<string, unknown>).bogus).toBeUndefined();
  });

  it("agent label resolves a real name and never renders a bare dash", () => {
    // falls back name → jm_agents lookup → id text; the JS mapper adds the final '—'
    expect(DIMENSION_SQL.agent.label).toContain("agent_name");
    expect(DIMENSION_SQL.agent.label).toContain("jm_agents");
    expect(DIMENSION_SQL.agent.label).toContain("agent_id::text");
  });

  it("model label coalesces to provider when model is null", () => {
    expect(DIMENSION_SQL.model.label).toBe("COALESCE(model, provider)");
  });
});

describe("derivations", () => {
  it("costPerRun divides cost by runs, null when no runs or no cost", () => {
    expect(costPerRun(100, 50)).toBe(2);
    expect(costPerRun(null, 50)).toBeNull();
    expect(costPerRun(100, 0)).toBeNull();
  });
  it("cacheReadHitRatio = cacheRead / (cacheRead + input)", () => {
    expect(cacheReadHitRatio(75, 25)).toBeCloseTo(0.75, 6);
    expect(cacheReadHitRatio(0, 0)).toBe(0);
  });
});

describe("waste predicate", () => {
  it("counts failed/aborted attempts only — not successful retries", () => {
    expect(WASTE_OUTCOME_PREDICATE).toBe("outcome <> 'success'");
    expect(WASTE_OUTCOME_PREDICATE).not.toContain("attempt");
  });
});

describe("usageWaste assembly", () => {
  // Fake pool: dispatch canned rows by inspecting the SQL each query runs.
  const pool = {
    query: async (sql: string) => {
      if (sql.includes("jm_workflow_instances")) return { rows: [{ failed_runs: 3 }] };
      if (sql.includes("agent_id")) return { rows: [{ agent_id: "a1", agent_name: "Coder", cost_usd: "0.30" }] };
      if (sql.includes("total_tokens")) return { rows: [{ cost_usd: "0.30", total_tokens: "1500", rows: 2 }] };
      return { rows: [{ cost_usd: "1.20" }] }; // total cost
    },
  } as unknown as import("pg").Pool;

  it("returns failedRunsNoCost and a fraction over total cost", async () => {
    const w = await usageWaste(pool, "ws1", new Date("2026-06-01"));
    expect(w.costUsd).toBe(0.3);
    expect(w.failedRunsNoCost).toBe(3);
    expect(w.fractionOfTotalCost).toBeCloseTo(0.25, 6);
    expect(w.topAgent).toMatchObject({ agentName: "Coder", costUsd: 0.3 });
  });
});
