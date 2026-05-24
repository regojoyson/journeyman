import { describe, it, expect, vi } from "vitest";
import { appendStepEvent } from "./append-step-event.ts";
import type { WorkflowLogCtx } from "./workflow-logger.ts";

const ctx: WorkflowLogCtx = {
  workflowInstanceId: "wf-1", nodeId: "n-1", stepType: "p", attempt: 1, taskId: "t", workerId: "w",
};

describe("appendStepEvent", () => {
  it("forwards eventType and payload, injecting correlation fields", async () => {
    const events = { append: vi.fn().mockResolvedValue(undefined) };
    await appendStepEvent(events, ctx, "step.started", { input: 1 });
    expect(events.append).toHaveBeenCalledWith({
      workflowInstanceId: "wf-1",
      nodeId: "n-1",
      eventType: "step.started",
      payload: { input: 1, stepType: "p", attempt: 1, taskId: "t", workerId: "w" },
    });
  });
  it("never throws — logs and swallows errors", async () => {
    const err = new Error("db down");
    const events = { append: vi.fn().mockRejectedValue(err) };
    const onError = vi.fn();
    await expect(appendStepEvent(events, ctx, "step.failed", {}, onError)).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(err);
  });
});
