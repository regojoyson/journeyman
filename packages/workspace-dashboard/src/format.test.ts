import { describe, it, expect } from "vitest";
import { formatTokens, formatDuration, formatAgo } from "./format.ts";

describe("formatTokens", () => {
  it("formats millions", () => expect(formatTokens(4_200_000)).toBe("4.2M"));
  it("formats thousands", () => expect(formatTokens(12_300)).toBe("12.3K"));
  it("passes small numbers through", () => expect(formatTokens(842)).toBe("842"));
  it("handles zero", () => expect(formatTokens(0)).toBe("0"));
});

describe("formatDuration", () => {
  it("formats minutes and seconds", () => expect(formatDuration(221_000)).toBe("3m 41s"));
  it("formats seconds only", () => expect(formatDuration(40_000)).toBe("40s"));
});

describe("formatAgo", () => {
  it("appends ' ago' to a duration", () => expect(formatAgo(40_000)).toBe("40s ago"));
  it("handles minutes", () => expect(formatAgo(221_000)).toBe("3m 41s ago"));
});
