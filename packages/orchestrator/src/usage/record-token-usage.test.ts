import { describe, it, expect } from "vitest";
import { recordTokenUsage, type RecordTokenUsageArgs } from "./record-token-usage.ts";

function fakePool() {
  const calls: { sql: string; params: unknown[] }[] = [];
  // rows: [] so the price-lookup SELECT resolves to "no active price" (cost stays null).
  const pool = { query: async (sql: string, params: unknown[]) => { calls.push({ sql, params }); return { rowCount: 1, rows: [] }; } };
  return { pool: pool as any, calls };
}

const inserts = (calls: { sql: string; params: unknown[] }[]) =>
  calls.filter((c) => c.sql.includes("INSERT INTO jm_token_usage"));

const base: RecordTokenUsageArgs = {
  workspaceId: "ws1", orgId: "org1", workflowId: "wf1", workflowVersionId: "v1", workflowName: "WF",
  workflowInstanceId: "run1", nodeId: "n1", stepType: "custom-ai", stepName: "step", attempt: 1,
  agentId: null, agentName: null, triggeredByUserId: "u1", outcome: "success",
  provider: "claude", requestedModel: "claude-opus-4-8",
  usage: [
    { provider: "claude", vendor: "anthropic", model: "claude-opus-4-8", inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    { provider: "claude", vendor: "anthropic", model: "claude-haiku-4-5", inputTokens: 2, outputTokens: 1, totalTokens: 3 },
  ],
};

describe("recordTokenUsage", () => {
  it("no-ops and returns 0 when pool is absent", async () => {
    expect(await recordTokenUsage(null, base)).toBe(0);
    expect(await recordTokenUsage(undefined, base)).toBe(0);
  });

  it("inserts one row per usage entry and returns inserted count", async () => {
    const { pool, calls } = fakePool();
    const n = await recordTokenUsage(pool, base);
    expect(n).toBe(2);
    const ins = inserts(calls);
    expect(ins).toHaveLength(2);
    expect(ins[0].sql).toContain("INSERT INTO jm_token_usage");
    expect(ins[0].sql).toContain("ON CONFLICT");
    expect(ins[0].params).toContain("claude-opus-4-8");
  });

  it("writes one usage_reported=false row with the requested model when usage is empty", async () => {
    const { pool, calls } = fakePool();
    const n = await recordTokenUsage(pool, { ...base, usage: [] });
    expect(n).toBe(1);
    const ins = inserts(calls);
    expect(ins).toHaveLength(1);
    expect(ins[0].params).toContain("claude-opus-4-8"); // requestedModel fallback
    expect(ins[0].params).toContain(false);             // usage_reported
  });

  it("does not throw when a query rejects", async () => {
    const pool = { query: async () => { throw new Error("db down"); } } as any;
    await expect(recordTokenUsage(pool, base)).resolves.toBe(0);
  });

  it("looks up the active price and writes cost_usd into the INSERT", async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const pool = {
      query: async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        if (sql.includes("FROM jm_model_pricing")) {
          return { rows: [{ input_per_1m: 15, output_per_1m: 75, cache_read_per_1m: 1.5,
            cache_creation_per_1m: 18.75, reasoning_per_1m: 75 }] };
        }
        return { rowCount: 1, rows: [] };
      },
    } as any;
    await recordTokenUsage(pool, {
      ...base,
      usage: [{ provider: "claude", vendor: "anthropic", model: "claude-opus-4-8",
        inputTokens: 1_000_000, outputTokens: 1_000_000, totalTokens: 2_000_000 }],
    });
    const insert = calls.find((c) => c.sql.includes("INSERT INTO jm_token_usage"))!;
    expect(insert.sql).toContain("cost_usd");
    // 1M input @15 + 1M output @75 = 90
    expect(insert.params).toContain(90);
  });
});
