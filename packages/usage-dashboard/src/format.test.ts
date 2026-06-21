import { describe, it, expect } from "vitest";
import { formatUsd, formatTokens, pctDelta } from "./format.ts";

describe("formatUsd", () => {
  it("formats dollars to 2dp", () => expect(formatUsd(1284.5)).toBe("$1,284.50"));
  it("shows an em dash for null", () => expect(formatUsd(null)).toBe("—"));
});
describe("formatTokens", () => {
  it("abbreviates millions", () => expect(formatTokens(847_200_000)).toBe("847.2M"));
  it("abbreviates thousands", () => expect(formatTokens(12_300)).toBe("12.3K"));
});
describe("pctDelta", () => {
  it("computes percent change", () => expect(pctDelta(112, 100)).toBe(12));
  it("returns null when previous is 0", () => expect(pctDelta(5, 0)).toBeNull());
});
