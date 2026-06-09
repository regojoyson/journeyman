import { describe, it, expect, vi } from "vitest";
import { logOpenCodeTranscript, type OpenCodePart } from "./sdk-logger.ts";

const textPart: OpenCodePart = { type: "text", text: "hello" };
const toolOk: OpenCodePart = { type: "tool", tool: "read", state: { status: "completed", input: { path: "/x" } } };
const toolErr: OpenCodePart = { type: "tool", tool: "bash", state: { status: "error", input: { command: "boom" }, error: "exit 1" } };

describe("logOpenCodeTranscript", () => {
  it("logs assistant text only at level all", () => {
    const onLog = vi.fn();
    logOpenCodeTranscript([textPart], onLog, "all");
    expect(onLog).toHaveBeenCalledTimes(1);
    expect(onLog.mock.calls[0][0]).toContain("hello");

    const medium = vi.fn();
    logOpenCodeTranscript([textPart], medium, "medium");
    expect(medium).not.toHaveBeenCalled();
  });

  it("logs tool calls at medium and all", () => {
    const onLog = vi.fn();
    logOpenCodeTranscript([toolOk], onLog, "medium");
    expect(onLog.mock.calls[0][0]).toContain("read");
    expect(onLog.mock.calls[0][0]).toContain("/x");
  });

  it("logs the tool outcome (ok/error) at level all", () => {
    const ok = vi.fn();
    logOpenCodeTranscript([toolOk], ok, "all");
    expect(ok.mock.calls.some((c: any[]) => String(c[0]).includes("read: ok"))).toBe(true);

    const err = vi.fn();
    logOpenCodeTranscript([toolErr], err, "all");
    expect(err.mock.calls.some((c: any[]) => String(c[0]).includes("error"))).toBe(true);
  });

  it("emits nothing at level none", () => {
    const off = vi.fn();
    logOpenCodeTranscript([textPart, toolOk, toolErr], off, "none");
    expect(off).not.toHaveBeenCalled();
  });

  it("tolerates undefined parts", () => {
    const onLog = vi.fn();
    expect(() => logOpenCodeTranscript(undefined, onLog, "all")).not.toThrow();
    expect(onLog).not.toHaveBeenCalled();
  });
});
