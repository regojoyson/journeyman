import { describe, it, expect } from "vitest";
import { toCron, fromCron, summarizeCron, DEFAULT_SCHEDULE } from "./cron-builder.ts";

describe("toCron", () => {
  it("hourly → '0 * * * *'", () => {
    expect(toCron({ frequency: "hourly", time: "09:00", days: [], dom: 1 })).toBe("0 * * * *");
  });
  it("daily at 09:30 → '30 9 * * *'", () => {
    expect(toCron({ frequency: "daily", time: "09:30", days: [], dom: 1 })).toBe("30 9 * * *");
  });
  it("weekly Mon+Fri at 09:00 → '0 9 * * 1,5'", () => {
    expect(toCron({ frequency: "weekly", time: "09:00", days: [1, 5], dom: 1 })).toBe("0 9 * * 1,5");
  });
  it("weekly with no days selected → '0 9 * * *'", () => {
    expect(toCron({ frequency: "weekly", time: "09:00", days: [], dom: 1 })).toBe("0 9 * * *");
  });
  it("monthly 15th at 09:00 → '0 9 15 * *'", () => {
    expect(toCron({ frequency: "monthly", time: "09:00", days: [], dom: 15 })).toBe("0 9 15 * *");
  });
  it("monthly last day → '0 9 28 * *'", () => {
    expect(toCron({ frequency: "monthly", time: "09:00", days: [], dom: 28 })).toBe("0 9 28 * *");
  });
});

describe("fromCron", () => {
  it("parses hourly", () => {
    expect(fromCron("0 * * * *")).toEqual({ frequency: "hourly", time: "00:00", days: [], dom: 1 });
  });
  it("parses daily", () => {
    expect(fromCron("30 9 * * *")).toEqual({ frequency: "daily", time: "09:30", days: [], dom: 1 });
  });
  it("parses weekly", () => {
    expect(fromCron("0 9 * * 1,5")).toEqual({ frequency: "weekly", time: "09:00", days: [1, 5], dom: 1 });
  });
  it("parses monthly", () => {
    expect(fromCron("0 9 15 * *")).toEqual({ frequency: "monthly", time: "09:00", days: [], dom: 15 });
  });
  it("returns null for unrecognised patterns", () => {
    expect(fromCron("*/5 * * * *")).toBeNull();
    expect(fromCron("0 9 1,15 * *")).toBeNull();
    expect(fromCron("0 9 * 3 *")).toBeNull();
    expect(fromCron("0 9 * * 1-5")).toBeNull();
  });
  it("roundtrips through toCron", () => {
    const s = { frequency: "weekly" as const, time: "14:00", days: [1, 3, 5], dom: 1 };
    expect(fromCron(toCron(s))).toEqual(s);
  });
});

describe("summarizeCron", () => {
  it("hourly", () => {
    expect(summarizeCron({ frequency: "hourly", time: "00:00", days: [], dom: 1 }, "UTC")).toBe("Every hour · UTC");
  });
  it("daily", () => {
    expect(summarizeCron({ frequency: "daily", time: "09:30", days: [], dom: 1 }, "America/New_York")).toBe(
      "Every day at 09:30 · New York",
    );
  });
  it("weekly with days", () => {
    expect(
      summarizeCron({ frequency: "weekly", time: "09:00", days: [1, 5], dom: 1 }, "UTC"),
    ).toBe("Every week on Mon, Fri at 09:00 · UTC");
  });
  it("weekly with no days selected", () => {
    expect(summarizeCron({ frequency: "weekly", time: "09:00", days: [], dom: 1 }, "UTC")).toBe(
      "Every week on every day at 09:00 · UTC",
    );
  });
  it("monthly", () => {
    expect(summarizeCron({ frequency: "monthly", time: "09:00", days: [], dom: 15 }, "UTC")).toBe(
      "Every month on the 15th at 09:00 · UTC",
    );
  });
  it("monthly last day", () => {
    expect(summarizeCron({ frequency: "monthly", time: "09:00", days: [], dom: 28 }, "UTC")).toBe(
      "Every month on the last day at 09:00 · UTC",
    );
  });
});
