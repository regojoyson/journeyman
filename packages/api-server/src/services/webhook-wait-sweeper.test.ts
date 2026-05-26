import { describe, it, expect, vi } from "vitest";
import { WebhookWaitSweeper } from "./webhook-wait-sweeper.ts";

function makeStore(execs: any[]) {
  return {
    listOverAgePausedNodeExecutions: vi.fn(async (_ms: number, limit: number) =>
      execs.slice(0, limit)),
  } as any;
}

function makeInstanceStore(snapshot: Record<string, string>) {
  // snapshot maps workflowInstanceId -> nodeType for the single node 'n1'
  return {
    getById: vi.fn(async (id: string) => snapshot[id] != null ? ({
      id,
      definitionSnapshot: {
        nodes: [{
          id: "n1",
          type: snapshot[id],
          config: { timeout: { defaults: { reason: "default" } } },
        }],
        edges: [],
      },
    }) : null),
  } as any;
}

describe("WebhookWaitSweeper", () => {
  it("does nothing when maxAgeMs is 0", async () => {
    const store = makeStore([]);
    const instanceStore = makeInstanceStore({});
    const fire = vi.fn();
    const sweeper = new WebhookWaitSweeper({
      maxAgeMs: 0, intervalMs: 60_000, batchSize: 500,
      nodeExecutions: store, workflowInstances: instanceStore, fire,
    });
    await sweeper.tick();
    expect(store.listOverAgePausedNodeExecutions).not.toHaveBeenCalled();
    expect(fire).not.toHaveBeenCalled();
  });

  it("fires only for webhook-wait nodes (skips human-task)", async () => {
    const execs = [
      { id: "e1", workflowInstanceId: "inst-1", nodeId: "n1" },
      { id: "e2", workflowInstanceId: "inst-2", nodeId: "n1" },
    ];
    const instanceStore = makeInstanceStore({
      "inst-1": "webhook-wait",
      "inst-2": "human-task",
    });
    const fire = vi.fn(async () => {});
    const sweeper = new WebhookWaitSweeper({
      maxAgeMs: 60_000, intervalMs: 60_000, batchSize: 500,
      nodeExecutions: makeStore(execs), workflowInstances: instanceStore, fire,
    });
    await sweeper.tick();
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith({
      workflowInstanceId: "inst-1",
      nodeId: "n1",
      defaults: { reason: "default" },
    });
  });

  it("does not throw when fire-handler throws (one row's failure does not poison the batch)", async () => {
    const execs = [
      { id: "e1", workflowInstanceId: "inst-1", nodeId: "n1" },
      { id: "e2", workflowInstanceId: "inst-2", nodeId: "n1" },
    ];
    const instanceStore = makeInstanceStore({
      "inst-1": "webhook-wait",
      "inst-2": "webhook-wait",
    });
    const fire = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    const sweeper = new WebhookWaitSweeper({
      maxAgeMs: 60_000, intervalMs: 60_000, batchSize: 500,
      nodeExecutions: makeStore(execs), workflowInstances: instanceStore, fire,
    });
    await expect(sweeper.tick()).resolves.toBeUndefined();
    expect(fire).toHaveBeenCalledTimes(2);
  });

  it("uses batchSize as the store limit", async () => {
    const store = makeStore([]);
    const sweeper = new WebhookWaitSweeper({
      maxAgeMs: 60_000, intervalMs: 60_000, batchSize: 42,
      nodeExecutions: store, workflowInstances: makeInstanceStore({}), fire: vi.fn(),
    });
    await sweeper.tick();
    expect(store.listOverAgePausedNodeExecutions).toHaveBeenCalledWith(60_000, 42);
  });

  it("start()/stop() schedule and clear the interval", () => {
    vi.useFakeTimers();
    const tickSpy = vi.spyOn(WebhookWaitSweeper.prototype as any, "tick").mockResolvedValue(undefined);
    const sweeper = new WebhookWaitSweeper({
      maxAgeMs: 60_000, intervalMs: 1_000, batchSize: 500,
      nodeExecutions: makeStore([]), workflowInstances: makeInstanceStore({}), fire: vi.fn(),
    });
    sweeper.start();
    vi.advanceTimersByTime(3_500);
    expect(tickSpy).toHaveBeenCalledTimes(3);
    sweeper.stop();
    vi.advanceTimersByTime(5_000);
    expect(tickSpy).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
    tickSpy.mockRestore();
  });
});
