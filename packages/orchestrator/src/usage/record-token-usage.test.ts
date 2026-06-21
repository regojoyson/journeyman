import { describe, it, expect } from "vitest";
import { recordTokenUsage, type RecordTokenUsageArgs } from "./record-token-usage.ts";

function fakePool() {
  const calls: { sql: string; params: unknown[] }[] = [];
  const pool = { query: async (sql: string, params: unknown[]) => { calls.push({ sql, params }); return { rowCount: 1 }; } };
  return { pool: pool as any, calls };
}

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
    expect(calls).toHaveLength(2);
    expect(calls[0].sql).toContain("INSERT INTO jm_token_usage");
    expect(calls[0].sql).toContain("ON CONFLICT");
    expect(calls[0].params).toContain("claude-opus-4-8");
  });

  it("writes one usage_reported=false row with the requested model when usage is empty", async () => {
    const { pool, calls } = fakePool();
    const n = await recordTokenUsage(pool, { ...base, usage: [] });
    expect(n).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toContain("claude-opus-4-8"); // requestedModel fallback
    expect(calls[0].params).toContain(false);             // usage_reported
  });

  it("does not throw when a query rejects", async () => {
    const pool = { query: async () => { throw new Error("db down"); } } as any;
    await expect(recordTokenUsage(pool, base)).resolves.toBe(0);
  });
});
