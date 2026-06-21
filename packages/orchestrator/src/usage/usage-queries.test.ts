import { describe, it, expect } from "vitest";
import { buildUsageAggregateQuery, buildUsageTotalsQuery } from "./usage-queries.ts";

describe("buildUsageAggregateQuery", () => {
  it("groups by a whitelisted dimension and always scopes by workspace", () => {
    const { sql, params } = buildUsageAggregateQuery("model", { wsId: "ws1" });
    expect(sql).toContain("FROM jm_token_usage");
    expect(sql).toContain("workspace_id = $1");
    expect(sql).toContain("GROUP BY provider, model");
    expect(params).toEqual(["ws1"]);
  });

  it("maps the 'day' dimension to a date_trunc bucket", () => {
    const { sql } = buildUsageAggregateQuery("day", { wsId: "ws1" });
    expect(sql).toContain("date_trunc('day', created_at)");
  });

  it("appends filters as parameters", () => {
    const { sql, params } = buildUsageAggregateQuery("agent", { wsId: "ws1", provider: "claude", from: "2026-06-01" });
    expect(params).toEqual(["ws1", "claude", "2026-06-01"]);
    expect(sql).toContain("provider = $2");
    expect(sql).toContain("created_at >= $3");
  });

  it("rejects an unknown dimension", () => {
    expect(() => buildUsageAggregateQuery("drop_table" as any, { wsId: "ws1" })).toThrow();
  });
});

describe("buildUsageTotalsQuery", () => {
  it("scopes by workspace with no GROUP BY", () => {
    const { sql, params } = buildUsageTotalsQuery({ wsId: "ws1", vendor: "anthropic" });
    expect(sql).toContain("FROM jm_token_usage");
    expect(sql).toContain("workspace_id = $1");
    expect(sql).not.toContain("GROUP BY");
    expect(params).toEqual(["ws1", "anthropic"]);
  });
});
