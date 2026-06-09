import { describe, it, expect, vi } from "vitest";
import { logOpenCodeEvent, type OpenCodeEvent } from "./sdk-logger.ts";

function ev(type: string, properties: Record<string, unknown>): OpenCodeEvent {
  return { id: "e1", type, properties: { timestamp: 0, sessionID: "s1", ...properties } } as OpenCodeEvent;
}

describe("logOpenCodeEvent", () => {
  it("logs assistant text only at level all", () => {
    const onLog = vi.fn();
    logOpenCodeEvent(ev("session.next.text.ended", { text: "hello" }), onLog, "all");
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog.mock.calls[0][0]).toContain("hello");

    const onLog2 = vi.fn();
    logOpenCodeEvent(ev("session.next.text.ended", { text: "hello" }), onLog2, "medium");
    expect(onLog2).not.toHaveBeenCalled();
  });

  it("logs tool calls at medium and all", () => {
    const onLog = vi.fn();
    logOpenCodeEvent(ev("session.next.tool.called", { tool: "read", input: { path: "/x" } }), onLog, "medium");
    expect(onLog.mock.calls[0][0]).toContain("read");
  });

  it("logs tool failures and never at none", () => {
    const onLog = vi.fn();
    logOpenCodeEvent(ev("session.next.tool.failed", { error: { name: "X" } }), onLog, "all");
    expect(onLog).toHaveBeenCalled();

    const off = vi.fn();
    logOpenCodeEvent(ev("session.next.text.ended", { text: "y" }), off, "none");
    expect(off).not.toHaveBeenCalled();
  });
});
