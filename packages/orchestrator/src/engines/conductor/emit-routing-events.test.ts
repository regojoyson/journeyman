import { describe, it, expect, vi } from "vitest";
import { emitRoutingEvents } from "./emit-routing-events.ts";

describe("emitRoutingEvents", () => {
  it("emits phase.skipped for tasks with status SKIPPED", async () => {
    const events = { append: vi.fn().mockResolvedValue(undefined) };
    await emitRoutingEvents(events, "wf-1", [
      { taskType: "SIMPLE", status: "SKIPPED", referenceTaskName: "node-2", inputData: {}, outputData: {} } as any,
      { taskType: "SIMPLE", status: "COMPLETED", referenceTaskName: "node-3", inputData: {}, outputData: {} } as any,
    ]);
    const skipped = events.append.mock.calls.find(c => c[0].eventType === "phase.skipped");
    expect(skipped).toBeDefined();
    expect(skipped![0].nodeId).toBe("node-2");
  });

  it("emits condition.evaluated + edge.taken for SWITCH tasks", async () => {
    const events = { append: vi.fn().mockResolvedValue(undefined) };
    await emitRoutingEvents(events, "wf-1", [
      {
        taskType: "SWITCH",
        status: "COMPLETED",
        referenceTaskName: "gate-1",
        inputData: { expression: "x > 0", x: 1 },
        outputData: { evaluationResult: ["caseA"], selectedCase: "caseA" },
      } as any,
    ]);
    const cond = events.append.mock.calls.find(c => c[0].eventType === "condition.evaluated");
    expect(cond).toBeDefined();
    expect(cond![0].payload).toMatchObject({ result: "caseA" });
    const edge = events.append.mock.calls.find(c => c[0].eventType === "edge.taken");
    expect(edge).toBeDefined();
    expect(edge![0].payload).toMatchObject({ target: "caseA" });
  });
});
