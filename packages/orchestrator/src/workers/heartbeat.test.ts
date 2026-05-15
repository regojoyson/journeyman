import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startHeartbeat } from "./heartbeat.ts";

describe("startHeartbeat", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("invokes onBeat at the configured interval with elapsedMs", () => {
    const onBeat = vi.fn();
    const stop = startHeartbeat({ intervalMs: 1000, onBeat });
    vi.advanceTimersByTime(2500);
    stop();
    expect(onBeat).toHaveBeenCalledTimes(2);
    expect(onBeat.mock.calls[0][0]).toBeGreaterThanOrEqual(1000);
    expect(onBeat.mock.calls[1][0]).toBeGreaterThanOrEqual(2000);
  });

  it("does not start when intervalMs is 0", () => {
    const onBeat = vi.fn();
    const stop = startHeartbeat({ intervalMs: 0, onBeat });
    vi.advanceTimersByTime(10_000);
    stop();
    expect(onBeat).not.toHaveBeenCalled();
  });
});
