import { describe, it, expect } from "vitest";
import { parseLogs } from "./parse-logs.ts";

function ev(eventType: string, payload: Record<string, unknown>): any {
  return { id: 1, ts: "2026-01-01T00:00:00Z", nodeId: "n", eventType, payload };
}

describe("parseLogs — step.failed formatting", () => {
  it("shows reason and error.message when both present", () => {
    const [log] = parseLogs(
      [ev("step.failed", { reason: "timeout", error: { message: "Step timed out" } })],
      [],
    );
    expect(log.line).toBe("❌ step failed: timeout — Step timed out");
  });

  it("shows only reason when error has no message", () => {
    const [log] = parseLogs([ev("step.failed", { reason: "image_not_ready" })], []);
    expect(log.line).toBe("❌ step failed: image_not_ready");
  });

  it("shows only error.message when reason is absent", () => {
    const [log] = parseLogs([ev("step.failed", { error: { message: "disk full" } })], []);
    expect(log.line).toBe("❌ step failed: disk full");
  });

  it("shows string error directly when error is a plain string", () => {
    const [log] = parseLogs([ev("step.failed", { error: "something broke" })], []);
    expect(log.line).toBe("❌ step failed: something broke");
  });

  it("falls back to bare label when no reason or error", () => {
    const [log] = parseLogs([ev("step.failed", {})], []);
    expect(log.line).toBe("❌ step failed");
  });
});
