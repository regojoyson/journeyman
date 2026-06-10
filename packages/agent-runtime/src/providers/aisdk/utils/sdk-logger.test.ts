import { describe, it, expect, vi } from "vitest";
import { makeStepLogger, logFinal } from "./sdk-logger.ts";

describe("makeStepLogger", () => {
  it("logs tool calls at medium, results+text only at all", () => {
    const onLog = vi.fn();
    const step = { text: "hi", toolCalls: [{ toolName: "bash", input: { command: "ls" } }], toolResults: [{ toolName: "bash", output: { exitCode: 0 } }] };

    makeStepLogger(onLog, "medium")(step as any);
    const medium = onLog.mock.calls.map((c) => c[0] as string);
    expect(medium.some((l) => l.startsWith("🔧 tool: bash"))).toBe(true);
    expect(medium.some((l) => l.startsWith("🤖 assistant"))).toBe(false);

    onLog.mockClear();
    makeStepLogger(onLog, "all")(step as any);
    const all = onLog.mock.calls.map((c) => c[0] as string);
    expect(all.some((l) => l.startsWith("🤖 assistant"))).toBe(true);
    expect(all.some((l) => l.startsWith("📥 tool_result"))).toBe(true);
  });

  it("emits nothing at level none", () => {
    const onLog = vi.fn();
    makeStepLogger(onLog, "none")({ text: "x", toolCalls: [], toolResults: [] } as any);
    expect(onLog).not.toHaveBeenCalled();
  });

  it("logFinal emits a success line at light+", () => {
    const onLog = vi.fn();
    logFinal(true, undefined, onLog, "light");
    expect(onLog.mock.calls[0][0]).toMatch(/✅ result: success/);
  });
});
