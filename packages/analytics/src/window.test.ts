import { describe, it, expect } from "vitest";
import { windowSince } from "./window.ts";

const NOW = new Date("2026-06-21T12:00:00.000Z");

describe("windowSince", () => {
  it("24h → 24 hours before now", () => {
    expect(windowSince("24h", NOW).toISOString()).toBe("2026-06-20T12:00:00.000Z");
  });
  it("7d → 7 days before now", () => {
    expect(windowSince("7d", NOW).toISOString()).toBe("2026-06-14T12:00:00.000Z");
  });
  it("30d → 30 days before now", () => {
    expect(windowSince("30d", NOW).toISOString()).toBe("2026-05-22T12:00:00.000Z");
  });
});
