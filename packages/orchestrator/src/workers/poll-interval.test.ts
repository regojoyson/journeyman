import { describe, it, expect } from "vitest";
import { resolvePollIntervalMs, DEFAULT_POLL_INTERVAL_MS } from "./poll-interval.ts";

describe("resolvePollIntervalMs", () => {
  it("defaults to 2000 when the env var is unset", () => {
    expect(DEFAULT_POLL_INTERVAL_MS).toBe(2000);
    expect(resolvePollIntervalMs({})).toBe(2000);
  });

  it("parses a valid numeric string", () => {
    expect(resolvePollIntervalMs({ WORKER_POLL_INTERVAL_MS: "5000" })).toBe(5000);
  });

  it("falls back to the default for a non-numeric value", () => {
    expect(resolvePollIntervalMs({ WORKER_POLL_INTERVAL_MS: "abc" })).toBe(2000);
  });

  it("falls back to the default for zero or negative values", () => {
    expect(resolvePollIntervalMs({ WORKER_POLL_INTERVAL_MS: "0" })).toBe(2000);
    expect(resolvePollIntervalMs({ WORKER_POLL_INTERVAL_MS: "-100" })).toBe(2000);
  });
});
