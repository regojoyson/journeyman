import { describe, it, expect } from "vitest";
import type { Agent } from "@journeyman/core";
import { enforceSafetyRails } from "./safety.ts";

/**
 * Fake pg pool: route each query by a substring of its SQL to a canned result.
 * `handlers` maps a SQL fragment → rows (or a fn of params → rows).
 */
function fakePool(handlers: Array<{ match: string; rows: any[] | ((params: any[]) => any[]) }>) {
  return {
    query: async (sql: string, params: any[] = []) => {
      for (const h of handlers) {
        if (sql.includes(h.match)) {
          const rows = typeof h.rows === "function" ? h.rows(params) : h.rows;
          return { rows };
        }
      }
      return { rows: [] };
    },
  } as any;
}

const agent = (over: Partial<Agent> = {}): Agent =>
  ({
    id: "a1",
    orgId: "o1",
    name: "A",
    limits: undefined,
    ...over,
  }) as Agent;

const SETTINGS = "FROM jm_org_agent_settings";
const INSTANCES = "FROM jm_workflow_instances";
const COUNTERS = "FROM jm_agent_run_counters";

describe("enforceSafetyRails", () => {
  it("ok when no settings row and no limits", async () => {
    const pool = fakePool([]);
    expect(await enforceSafetyRails(pool, agent())).toEqual({ ok: true });
  });

  it("blocks when org is paused", async () => {
    const pool = fakePool([{ match: SETTINGS, rows: [{ org_id: "o1", paused: true, updated_at: "t" }] }]);
    expect(await enforceSafetyRails(pool, agent())).toEqual({ ok: false, reason: "paused" });
  });

  it("blocks on concurrency when at the org limit", async () => {
    const pool = fakePool([
      { match: SETTINGS, rows: [{ org_id: "o1", paused: false, max_concurrent_runs: 2, updated_at: "t" }] },
      { match: INSTANCES, rows: [{ n: 2 }] },
    ]);
    expect(await enforceSafetyRails(pool, agent())).toEqual({ ok: false, reason: "concurrency" });
  });

  it("allows under the concurrency limit", async () => {
    const pool = fakePool([
      { match: SETTINGS, rows: [{ org_id: "o1", paused: false, max_concurrent_runs: 5, updated_at: "t" }] },
      { match: INSTANCES, rows: [{ n: 1 }] },
    ]);
    expect(await enforceSafetyRails(pool, agent())).toEqual({ ok: true });
  });

  it("per-agent limit overrides the org default (lower wins via override)", async () => {
    const pool = fakePool([
      { match: SETTINGS, rows: [{ org_id: "o1", paused: false, max_concurrent_runs: 99, updated_at: "t" }] },
      { match: INSTANCES, rows: [{ n: 1 }] },
    ]);
    // agent override of 1 trumps org's 99 → at limit
    const res = await enforceSafetyRails(pool, agent({ limits: { maxConcurrentRuns: 1 } }));
    expect(res).toEqual({ ok: false, reason: "concurrency" });
  });

  it("blocks on daily cap", async () => {
    const pool = fakePool([
      { match: SETTINGS, rows: [{ org_id: "o1", paused: false, daily_run_cap: 10, updated_at: "t" }] },
      { match: COUNTERS, rows: [{ runs: 10, tokens: 0, cost_usd: 0 }] },
    ]);
    expect(await enforceSafetyRails(pool, agent())).toEqual({ ok: false, reason: "daily_cap" });
  });

  it("blocks on token budget", async () => {
    const pool = fakePool([
      { match: SETTINGS, rows: [{ org_id: "o1", paused: false, budget: { maxTokens: 1000 }, updated_at: "t" }] },
      { match: COUNTERS, rows: [{ runs: 1, tokens: 1500, cost_usd: 0 }] },
    ]);
    expect(await enforceSafetyRails(pool, agent())).toEqual({ ok: false, reason: "budget" });
  });

  it("blocks on cost budget", async () => {
    const pool = fakePool([
      { match: SETTINGS, rows: [{ org_id: "o1", paused: false, budget: { maxCostUsd: 5 }, updated_at: "t" }] },
      { match: COUNTERS, rows: [{ runs: 1, tokens: 0, cost_usd: 5.01 }] },
    ]);
    expect(await enforceSafetyRails(pool, agent())).toEqual({ ok: false, reason: "budget" });
  });

  it("allows when under all caps", async () => {
    const pool = fakePool([
      {
        match: SETTINGS,
        rows: [{ org_id: "o1", paused: false, daily_run_cap: 10, budget: { maxTokens: 1000, maxCostUsd: 5 }, updated_at: "t" }],
      },
      { match: COUNTERS, rows: [{ runs: 3, tokens: 500, cost_usd: 1.2 }] },
    ]);
    expect(await enforceSafetyRails(pool, agent())).toEqual({ ok: true });
  });
});
