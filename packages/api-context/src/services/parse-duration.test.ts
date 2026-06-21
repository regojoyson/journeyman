import { describe, it, expect } from "vitest";
import { parseDurationMs } from "./parse-duration.ts";

describe("parseDurationMs", () => {
  it("parses seconds", () => expect(parseDurationMs("5s")).toBe(5_000));
  it("parses minutes", () => expect(parseDurationMs("5m")).toBe(300_000));
  it("parses hours", () => expect(parseDurationMs("2h")).toBe(7_200_000));
  it("parses days", () => expect(parseDurationMs("30d")).toBe(2_592_000_000));
  it("parses ms", () => expect(parseDurationMs("500ms")).toBe(500));
  it("tolerates whitespace", () => expect(parseDurationMs("  30d  ")).toBe(2_592_000_000));
  it("returns 0 for empty string", () => expect(parseDurationMs("")).toBe(0));
  it("returns 0 for invalid input", () => expect(parseDurationMs("garbage")).toBe(0));
  it("returns 0 for negative numbers", () => expect(parseDurationMs("-5m")).toBe(0));
});
