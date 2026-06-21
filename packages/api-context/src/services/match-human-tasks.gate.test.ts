import { describe, it, expect, vi } from "vitest";
import { matchAndResolveWebhookWaits } from "./match-human-tasks.ts";

// A RUNNING (non-terminal) instance with a waiting+correlated webhook-wait node
// must be resolved — not skipped for "status !== paused".
describe("matchAndResolveWebhookWaits — gate on terminal, not paused", () => {
  it("resolves a waiting node on a RUNNING instance", async () => {
    const instance = {
      id: "wi", engineWorkflowId: "eng", status: "running",
      definitionSnapshot: { nodes: [{ id: "wh", type: "webhook-wait", config: { outputs: [] } }] },
    };
    const exec = { id: "ne", nodeId: "wh", status: "waiting", conductorTaskId: "ct" };
    const c = {
      nodeExecutions: {
        findAllWaitingWithCorrelation: vi.fn().mockResolvedValue([
          { workflowInstanceId: "wi", nodeId: "wh", correlationEventPath: "$.issue.number", correlationValue: "6" },
        ]),
        latestForNode: vi.fn().mockImplementation(async () => ({ ...exec })),
        markWaiting: vi.fn().mockResolvedValue(exec),
        markCompleted: vi.fn().mockImplementation(async () => { exec.status = "completed"; return exec; }),
        markSkipped: vi.fn().mockResolvedValue(exec),
        latestWaitingForInstance: vi.fn().mockResolvedValue(null),
      },
      workflowInstances: {
        getById: vi.fn().mockImplementation(async () => ({ ...instance })),
        setStatus: vi.fn().mockResolvedValue(undefined),
      },
      conditions: { evaluate: vi.fn().mockReturnValue(true) },
      humanTaskTimeouts: { cancel: vi.fn(), schedule: vi.fn() },
      humanTaskResolutions: { create: vi.fn().mockResolvedValue(undefined) },
      events: { append: vi.fn().mockResolvedValue(undefined) },
      conductorClient: {
        completeTask: vi.fn().mockResolvedValue(undefined),
        getWorkflowWithTasks: vi.fn().mockResolvedValue({ status: "RUNNING", tasks: [] }),
      },
    } as never;

    const res = await matchAndResolveWebhookWaits(c, {
      id: "ev", provider: "github", eventType: "issues", rawPayload: { issue: { number: 6 } },
    });
    expect(res.matched).toBe(1);
  });
});
