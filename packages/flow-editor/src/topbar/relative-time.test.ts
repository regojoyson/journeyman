import { describe, it, expect } from "vitest";
import { formatRelativeTime } from "./relative-time.ts";

const now = new Date("2026-06-20T12:00:00Z").getTime();

describe("formatRelativeTime", () => {
  it("shows 'just now' under a minute", () => {
    expect(formatRelativeTime("2026-06-20T11:59:40Z", now)).toBe("just now");
  });
  it("shows minutes", () => {
    expect(formatRelativeTime("2026-06-20T11:45:00Z", now)).toBe("15m ago");
  });
  it("shows hours", () => {
    expect(formatRelativeTime("2026-06-20T10:00:00Z", now)).toBe("2h ago");
  });
  it("shows days", () => {
    expect(formatRelativeTime("2026-06-18T12:00:00Z", now)).toBe("2d ago");
  });
  it("falls back to a date past a week", () => {
    expect(formatRelativeTime("2026-06-01T12:00:00Z", now)).toMatch(/2026|Jun/);
  });
});
