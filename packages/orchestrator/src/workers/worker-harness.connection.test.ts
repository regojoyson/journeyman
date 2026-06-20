import { describe, it, expect, vi } from "vitest";
import { WorkerHarness } from "./worker-harness.ts";

function fakeTask(overrides: Partial<any> = {}): any {
  return {
    taskId: "t-1",
    taskDefName: "clone-repos",
    referenceTaskName: "node-1",
    workflowInstanceId: "engine-wf-1",
    retryCount: 0,
    inputData: {
      workflowInstanceId: "wf-1",
      startedByUserId: "u-1",
      startedByOrgId: "o-1",
      ...overrides.inputData,
    },
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
  const ensureWorkspace = vi.fn().mockResolvedValue({
    env: { exec: vi.fn(), materialize: vi.fn() },
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

describe("WorkerHarness connection resolution", () => {
  it("resolves connectionId and injects ctx.connection before running the step", async () => {
    const resolvedConn = {
      id: "conn-1",
      category: "git" as const,
      provider: "github",
      credential: "ghp_secret",
      baseUrl: undefined,
      config: undefined,
    };
    const connectionResolver = vi.fn().mockResolvedValue(resolvedConn);

    let capturedConnection: unknown = "not-set";
    const handler = {
      stepType: "clone-repos",
      requiresWorkspace: false,
      run: vi.fn().mockImplementation(async (_input: unknown, ctx: { connection?: unknown }) => {
        capturedConnection = ctx.connection;
        return { kind: "success", output: {} };
      }),
    };

    const deps: any = makeDeps({ connectionResolver });
    deps.client.pollTask.mockResolvedValue(fakeTask({
      inputData: {
        workflowInstanceId: "wf-1",
        startedByUserId: "u-1",
        startedByOrgId: "o-1",
        connectionId: "conn-1",
      },
    }));
    deps.registry.get.mockReturnValue(handler);

    const harness = new WorkerHarness(deps);
    await harness.processOnce("clone-repos");

    expect(capturedConnection).toEqual(resolvedConn);
    expect(connectionResolver).toHaveBeenCalledWith("conn-1");
  });

  it("leaves ctx.connection undefined when connectionId is absent", async () => {
    let capturedConnection: unknown = "sentinel";
    const handler = {
      stepType: "clone-repos",
      requiresWorkspace: false,
      run: vi.fn().mockImplementation(async (_input: unknown, ctx: { connection?: unknown }) => {
        capturedConnection = ctx.connection;
        return { kind: "success", output: {} };
      }),
    };

    const deps: any = makeDeps();
    deps.client.pollTask.mockResolvedValue(fakeTask());
    deps.registry.get.mockReturnValue(handler);

    const harness = new WorkerHarness(deps);
    await harness.processOnce("clone-repos");

    expect(capturedConnection).toBeUndefined();
  });

  it("fails the task with FAILED_WITH_TERMINAL_ERROR when connectionResolver throws", async () => {
    const connectionResolver = vi.fn().mockRejectedValue(
      Object.assign(new Error("Connection not found: conn-missing"), { name: "ConfigurationError" }),
    );

    const handler = {
      stepType: "clone-repos",
      requiresWorkspace: false,
      run: vi.fn(),
    };

    const deps: any = makeDeps({ connectionResolver });
    deps.client.pollTask.mockResolvedValue(fakeTask({
      inputData: {
        workflowInstanceId: "wf-1",
        startedByUserId: "u-1",
        startedByOrgId: "o-1",
        connectionId: "conn-missing",
      },
    }));
    deps.registry.get.mockReturnValue(handler);

    const harness = new WorkerHarness(deps);
    await harness.processOnce("clone-repos");

    expect(handler.run).not.toHaveBeenCalled();
    const complete = deps.client.completeTask.mock.calls[0]?.[0];
    expect(complete?.status).toBe("FAILED_WITH_TERMINAL_ERROR");
    expect(complete?.reasonForIncompletion).toContain("Connection resolution failed");
  });
});
