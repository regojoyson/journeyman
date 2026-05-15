import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkerHarness } from "./worker-harness.ts";

function fakeTask(overrides: Partial<any> = {}): any {
  return {
    taskId: "t-1",
    taskDefName: "test-phase",
    referenceTaskName: "node-1",
    workflowInstanceId: "engine-wf-1",
    retryCount: 0,
    inputData: { workflowInstanceId: "wf-1", startedByUserId: "u-1", startedByOrgId: "o-1" },
    ...overrides,
  };
}

function makeDeps(overrides: Partial<any> = {}) {
  const events = { append: vi.fn().mockResolvedValue(undefined) };
  const client = {
    pollTask: vi.fn(),
    completeTask: vi.fn().mockResolvedValue(undefined),
  };
  const registry = { get: vi.fn() };
  const workspace = {
    create: vi.fn().mockResolvedValue({ path: "/tmp/ws", destroy: vi.fn().mockResolvedValue(undefined) }),
  };
  return {
    events, client, registry, workspace,
    workerId: "worker-1",
    bindingResolver: vi.fn().mockResolvedValue({}),
    mcpResolver: vi.fn().mockResolvedValue([]),
    skillsResolver: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("WorkerHarness.processOnce — pickup", () => {
  it("emits task.polled with correlation fields", async () => {
    const deps: any = makeDeps();
    deps.client.pollTask.mockResolvedValue(fakeTask());
    deps.registry.get.mockReturnValue({ run: vi.fn().mockResolvedValue({ kind: "success", output: {} }) });

    const harness = new WorkerHarness(deps);
    await harness.processOnce("test-phase");

    const polled = deps.events.append.mock.calls.find((c: any) => c[0].eventType === "task.polled");
    expect(polled).toBeDefined();
    expect(polled[0]).toMatchObject({
      workflowInstanceId: "wf-1", nodeId: "node-1",
      payload: expect.objectContaining({ taskId: "t-1", attempt: 1, workerId: "worker-1", phaseType: "test-phase" }),
    });
  });
});

describe("WorkerHarness.processOnce — heartbeat", () => {
  beforeEach(() => { process.env.WORKER_HEARTBEAT_MS = "50"; });
  afterEach(() => { delete process.env.WORKER_HEARTBEAT_MS; });

  it("emits worker.heartbeat at the configured interval", async () => {
    const deps: any = makeDeps();
    deps.client.pollTask.mockResolvedValue(fakeTask());
    deps.registry.get.mockReturnValue({
      run: () => new Promise(r => setTimeout(() => r({ kind: "success", output: {} }), 180)),
    });
    const harness = new WorkerHarness(deps);
    await harness.processOnce("test-phase");
    const beats = deps.events.append.mock.calls.filter((c: any) => c[0].eventType === "worker.heartbeat");
    expect(beats.length).toBeGreaterThanOrEqual(2);
    expect(beats[0][0].payload.elapsedMs).toBeGreaterThanOrEqual(50);
  });
});

describe("WorkerHarness.processOnce — error enrichment", () => {
  it("attaches log tail (last 20 lines) to phase.failed payload", async () => {
    const deps: any = makeDeps();
    deps.client.pollTask.mockResolvedValue(fakeTask());
    deps.registry.get.mockReturnValue({
      run: async (_input: any, runCtx: any) => {
        for (let i = 0; i < 25; i++) runCtx.log(`line ${i}`, {});
        return { kind: "failure", failure: { errorClass: "BoomError", message: "boom", retryable: false } };
      },
    });
    const harness = new WorkerHarness(deps);
    await harness.processOnce("test-phase");

    const failed = deps.events.append.mock.calls.find((c: any) => c[0].eventType === "phase.failed");
    expect(failed).toBeDefined();
    const tail: string[] = failed[0].payload.tail;
    expect(tail).toHaveLength(20);
    expect(tail[0]).toBe("line 5");
    expect(tail[19]).toBe("line 24");
  });

  it("serializes unhandled errors with stack + cause", async () => {
    const deps: any = makeDeps();
    deps.client.pollTask.mockResolvedValue(fakeTask());
    deps.registry.get.mockReturnValue({
      run: async () => {
        const cause = new Error("root");
        throw new Error("top", { cause });
      },
    });
    const harness = new WorkerHarness(deps);
    await harness.processOnce("test-phase");
    const failed = deps.events.append.mock.calls.find((c: any) => c[0].eventType === "phase.failed");
    expect(failed[0].payload).toMatchObject({
      reason: "unhandled",
      error: { errorClass: "Error", message: "top", cause: { message: "root" } },
    });
  });
});

describe("WorkerHarness.processOnce — durations", () => {
  it("includes durationMs on phase.completed payload", async () => {
    const deps: any = makeDeps();
    deps.client.pollTask.mockResolvedValue(fakeTask());
    deps.registry.get.mockReturnValue({
      run: () => new Promise(r => setTimeout(() => r({ kind: "success", output: { ok: 1 } }), 30)),
    });
    const harness = new WorkerHarness(deps);
    await harness.processOnce("test-phase");
    const completed = deps.events.append.mock.calls.find((c: any) => c[0].eventType === "phase.completed");
    expect(completed[0].payload.durationMs).toBeGreaterThanOrEqual(30);
  });
});
