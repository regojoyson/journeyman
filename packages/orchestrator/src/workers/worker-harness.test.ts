import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkerHarness } from "./worker-harness.ts";

function fakeTask(overrides: Partial<any> = {}): any {
  return {
    taskId: "t-1",
    taskDefName: "test-step",
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
  // Stub ensureWorkspace — returns a fake local provisioned env.
  const fakeEnv = {
    exec: vi.fn().mockResolvedValue({ ok: true }),
    materialize: vi.fn().mockResolvedValue(undefined),
  };
  const ensureWorkspace = vi.fn().mockResolvedValue({
    env: fakeEnv,
    provisioned: { runId: "wf-1", type: "local", handle: "local:wf-1", workspaceDir: "/tmp/ws" },
  });
  return {
    events, client, registry, ensureWorkspace,
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
    await harness.processOnce("test-step");

    const polled = deps.events.append.mock.calls.find((c: any) => c[0].eventType === "task.polled");
    expect(polled).toBeDefined();
    expect(polled[0]).toMatchObject({
      workflowInstanceId: "wf-1", nodeId: "node-1",
      payload: expect.objectContaining({ taskId: "t-1", attempt: 1, workerId: "worker-1", stepType: "test-step" }),
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
    await harness.processOnce("test-step");
    const beats = deps.events.append.mock.calls.filter((c: any) => c[0].eventType === "worker.heartbeat");
    expect(beats.length).toBeGreaterThanOrEqual(2);
    expect(beats[0][0].payload.elapsedMs).toBeGreaterThanOrEqual(50);
  });
});

describe("WorkerHarness.processOnce — error enrichment", () => {
  it("attaches log tail (last 20 lines) to step.failed payload", async () => {
    const deps: any = makeDeps();
    deps.client.pollTask.mockResolvedValue(fakeTask());
    deps.registry.get.mockReturnValue({
      run: async (_input: any, runCtx: any) => {
        for (let i = 0; i < 25; i++) runCtx.log(`line ${i}`, {});
        return { kind: "failure", failure: { errorClass: "BoomError", message: "boom", retryable: false } };
      },
    });
    const harness = new WorkerHarness(deps);
    await harness.processOnce("test-step");

    const failed = deps.events.append.mock.calls.find((c: any) => c[0].eventType === "step.failed");
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
    await harness.processOnce("test-step");
    const failed = deps.events.append.mock.calls.find((c: any) => c[0].eventType === "step.failed");
    expect(failed[0].payload).toMatchObject({
      reason: "unhandled",
      error: { errorClass: "Error", message: "top", cause: { message: "root" } },
    });
  });
});

describe("WorkerHarness.processOnce — durations", () => {
  it("includes durationMs on step.completed payload", async () => {
    const deps: any = makeDeps();
    deps.client.pollTask.mockResolvedValue(fakeTask());
    deps.registry.get.mockReturnValue({
      run: () => new Promise(r => setTimeout(() => r({ kind: "success", output: { ok: 1 } }), 30)),
    });
    const harness = new WorkerHarness(deps);
    await harness.processOnce("test-step");
    const completed = deps.events.append.mock.calls.find((c: any) => c[0].eventType === "step.completed");
    expect(completed[0].payload.durationMs).toBeGreaterThanOrEqual(30);
  });
});

describe("WorkerHarness.processOnce — ImageNotReadyError in-process retry", () => {
  beforeEach(() => { process.env.WORKER_IMAGE_RETRY_DELAY_MS = "0"; });
  afterEach(() => { delete process.env.WORKER_IMAGE_RETRY_DELAY_MS; });

  it("retries ensureWorkspace and succeeds when image becomes ready on second attempt", async () => {
    const deps: any = makeDeps();
    deps.client.pollTask.mockResolvedValue(fakeTask());
    deps.registry.get.mockReturnValue({ run: vi.fn().mockResolvedValue({ kind: "success", output: {} }), requiresWorkspace: true });
    const err = Object.assign(new Error("image not ready"), { name: "ImageNotReadyError" });
    deps.ensureWorkspace
      .mockRejectedValueOnce(err)   // first attempt fails
      .mockResolvedValue({           // second attempt succeeds
        env: { exec: vi.fn().mockResolvedValue({ ok: true }), materialize: vi.fn().mockResolvedValue(undefined) },
        provisioned: { runId: "wf-1", type: "local", handle: "local:wf-1", workspaceDir: "/tmp/ws" },
      });

    const harness = new WorkerHarness(deps);
    await harness.processOnce("test-step");

    expect(deps.ensureWorkspace).toHaveBeenCalledTimes(2);
    const completed = deps.events.append.mock.calls.find((c: any) => c[0].eventType === "step.completed");
    expect(completed).toBeDefined();
    expect(deps.client.completeTask).toHaveBeenCalledWith(expect.objectContaining({ status: "COMPLETED" }));
  });

  it("emits a step.log on each wait and fails after all retries exhausted", async () => {
    process.env.WORKER_IMAGE_RETRY_ATTEMPTS = "2";
    const deps: any = makeDeps();
    deps.client.pollTask.mockResolvedValue(fakeTask());
    deps.registry.get.mockReturnValue({ run: vi.fn(), requiresWorkspace: true });
    const err = Object.assign(new Error("still building"), { name: "ImageNotReadyError" });
    deps.ensureWorkspace.mockRejectedValue(err);

    const harness = new WorkerHarness(deps);
    await harness.processOnce("test-step");

    // 3 total calls: 1 initial + 2 retries
    expect(deps.ensureWorkspace).toHaveBeenCalledTimes(3);
    const waitLogs = deps.events.append.mock.calls.filter(
      (c: any) => c[0].eventType === "step.log" && String(c[0].payload?.line).includes("waiting for image"),
    );
    expect(waitLogs.length).toBe(2);
    expect(deps.client.completeTask).toHaveBeenCalledWith(expect.objectContaining({ status: "FAILED" }));
    delete process.env.WORKER_IMAGE_RETRY_ATTEMPTS;
  });
});

describe("WorkerHarness.processOnce — image wait honors the step deadline", () => {
  it("aborts the image wait when a custom timeoutSeconds elapses (not after all retries)", async () => {
    // Long retry delay so the test would hang if the wait ignored the deadline.
    process.env.WORKER_IMAGE_RETRY_DELAY_MS = "10000";
    const deps: any = makeDeps();
    // 0.05s step deadline — fires during the first image wait.
    deps.client.pollTask.mockResolvedValue(
      fakeTask({ inputData: { workflowInstanceId: "wf-1", startedByUserId: "u-1", startedByOrgId: "o-1", timeoutSeconds: 0.05 } }),
    );
    deps.registry.get.mockReturnValue({ run: vi.fn(), requiresWorkspace: true });
    const err = Object.assign(new Error("still building"), { name: "ImageNotReadyError" });
    deps.ensureWorkspace.mockRejectedValue(err);

    const harness = new WorkerHarness(deps);
    await harness.processOnce("test-step");

    // Should have bailed during the first wait, not run all 10 default attempts.
    expect(deps.ensureWorkspace.mock.calls.length).toBeLessThan(3);
    expect(deps.client.completeTask).toHaveBeenCalledWith(expect.objectContaining({
      status: "FAILED",
      reasonForIncompletion: expect.stringContaining("timeout"),
    }));
    const failed = deps.events.append.mock.calls.find((c: any) => c[0].eventType === "step.failed");
    expect(failed[0].payload).toMatchObject({ reason: "timeout" });
    delete process.env.WORKER_IMAGE_RETRY_DELAY_MS;
  });
});

describe("WorkerHarness.processOnce — ImageNotReadyError fast-fail", () => {
  beforeEach(() => { process.env.WORKER_IMAGE_RETRY_ATTEMPTS = "0"; process.env.WORKER_IMAGE_RETRY_DELAY_MS = "0"; });
  afterEach(() => { delete process.env.WORKER_IMAGE_RETRY_ATTEMPTS; delete process.env.WORKER_IMAGE_RETRY_DELAY_MS; });

  it("calls completeTask(FAILED) immediately when ensureWorkspace throws ImageNotReadyError", async () => {
    const deps: any = makeDeps();
    deps.client.pollTask.mockResolvedValue(fakeTask());
    deps.registry.get.mockReturnValue({ run: vi.fn(), requiresWorkspace: true });
    const err = Object.assign(new Error("image fingerprint changed"), { name: "ImageNotReadyError" });
    deps.ensureWorkspace.mockRejectedValue(err);

    const harness = new WorkerHarness(deps);
    await harness.processOnce("test-step");

    expect(deps.client.completeTask).toHaveBeenCalledWith(expect.objectContaining({
      status: "FAILED",
      reasonForIncompletion: expect.stringContaining("image_not_ready"),
    }));
    const failed = deps.events.append.mock.calls.find((c: any) => c[0].eventType === "step.failed");
    expect(failed[0].payload).toMatchObject({ reason: "image_not_ready" });
  });

  it("emits step.log before step.failed for ImageNotReadyError", async () => {
    const deps: any = makeDeps();
    deps.client.pollTask.mockResolvedValue(fakeTask());
    deps.registry.get.mockReturnValue({ run: vi.fn(), requiresWorkspace: true });
    const err = Object.assign(new Error("fingerprint changed"), { name: "ImageNotReadyError" });
    deps.ensureWorkspace.mockRejectedValue(err);

    const harness = new WorkerHarness(deps);
    await harness.processOnce("test-step");

    const allCalls = deps.events.append.mock.calls.map((c: any) => c[0].eventType);
    const logIdx = allCalls.indexOf("step.log");
    const failedIdx = allCalls.indexOf("step.failed");
    expect(logIdx).toBeGreaterThanOrEqual(0);
    expect(logIdx).toBeLessThan(failedIdx);
    const logLine = deps.events.append.mock.calls[logIdx][0].payload.line as string;
    expect(logLine).toContain("image not ready");
    expect(logLine).toContain("retrying");
  });
});

describe("WorkerHarness.processOnce — default step timeout", () => {
  beforeEach(() => { process.env.WORKER_DEFAULT_STEP_TIMEOUT_S = "1"; });
  afterEach(() => { delete process.env.WORKER_DEFAULT_STEP_TIMEOUT_S; });

  it("aborts step after WORKER_DEFAULT_STEP_TIMEOUT_S when step has no timeoutSeconds", async () => {
    const deps: any = makeDeps();
    deps.client.pollTask.mockResolvedValue(fakeTask()); // no timeoutSeconds in inputData
    deps.registry.get.mockReturnValue({
      // step never resolves — simulates a hang
      run: (_input: any, ctx: any) => new Promise<never>((_, reject) => {
        ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
      }),
    });

    const harness = new WorkerHarness(deps);
    await harness.processOnce("test-step");

    // The unhandled-error branch fires after abort
    const failed = deps.events.append.mock.calls.find((c: any) => c[0].eventType === "step.failed");
    expect(failed).toBeDefined();
    expect(deps.client.completeTask).toHaveBeenCalledWith(expect.objectContaining({
      status: "FAILED",
    }));
  });

  it("emits step.log with ⏱ prefix and step.failed with reason timeout on timeout", async () => {
    const deps: any = makeDeps();
    deps.client.pollTask.mockResolvedValue(fakeTask());
    deps.registry.get.mockReturnValue({
      run: (_input: any, ctx: any) => new Promise<never>((_, reject) => {
        ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
      }),
    });

    const harness = new WorkerHarness(deps);
    await harness.processOnce("test-step");

    const logCall = deps.events.append.mock.calls.find(
      (c: any) => c[0].eventType === "step.log" && String(c[0].payload?.line).includes("timed out"),
    );
    expect(logCall).toBeDefined();
    expect(logCall[0].payload.line).toContain("⏱");
    expect(logCall[0].payload.line).toContain("1s");

    const failed = deps.events.append.mock.calls.find((c: any) => c[0].eventType === "step.failed");
    expect(failed[0].payload).toMatchObject({ reason: "timeout" });

    expect(deps.client.completeTask).toHaveBeenCalledWith(expect.objectContaining({
      status: "FAILED",
      reasonForIncompletion: expect.stringContaining("timeout"),
    }));
  });
});
