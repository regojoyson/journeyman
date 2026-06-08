import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDebug = vi.fn();
const mockTrace = vi.fn();
const mockError = vi.fn();

// Mock the logger before importing the module under test so the module-level
// `createLogger("conductor:client")` call returns our spy.
vi.mock("@journeyman/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@journeyman/core")>();
  return {
    ...actual,
    createLogger: () => ({
      debug: mockDebug,
      trace: mockTrace,
      error: mockError,
      info: vi.fn(),
      warn: vi.fn(),
    }),
  };
});

const { ConductorClient } = await import("./conductor-client.ts");

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const TASK = {
  taskId: "t-1",
  workflowInstanceId: "wf-1",
  taskDefName: "clone-repos",
  referenceTaskName: "node-1",
  inputData: {},
  retryCount: 0,
};

beforeEach(() => {
  mockDebug.mockClear();
  mockTrace.mockClear();
  mockError.mockClear();
});

describe("ConductorClient.pollTask logging", () => {
  it("logs an empty poll at trace, never debug", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const client = new ConductorClient({ baseUrl: "http://c/api", fetchImpl });

    const r = await client.pollTask("clone-repos", "worker-1");

    expect(r).toBeNull();
    expect(mockTrace).toHaveBeenCalledTimes(1);
    expect(mockTrace).toHaveBeenCalledWith(
      expect.objectContaining({ stepType: "clone-repos", workerId: "worker-1", hasTask: false }),
      "conductor.poll.request.end",
    );
    expect(mockDebug).not.toHaveBeenCalled();
  });

  it("logs a productive poll at debug, never trace", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(TASK));
    const client = new ConductorClient({ baseUrl: "http://c/api", fetchImpl });

    const r = await client.pollTask("clone-repos", "worker-1");

    expect(r).toMatchObject({ taskId: "t-1" });
    expect(mockDebug).toHaveBeenCalledTimes(1);
    expect(mockDebug).toHaveBeenCalledWith(
      expect.objectContaining({ stepType: "clone-repos", workerId: "worker-1", hasTask: true }),
      "conductor.poll.request.end",
    );
    expect(mockTrace).not.toHaveBeenCalled();
  });

  it("never emits a request.start line", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(TASK));
    const client = new ConductorClient({ baseUrl: "http://c/api", fetchImpl });

    await client.pollTask("clone-repos", "worker-1");

    const startCalls = [...mockDebug.mock.calls, ...mockTrace.mock.calls]
      .filter((call) => call[1] === "conductor.poll.request.start");
    expect(startCalls).toHaveLength(0);
  });

  it("logs failures at error and rethrows", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"));
    const client = new ConductorClient({ baseUrl: "http://c/api", fetchImpl });

    await expect(client.pollTask("clone-repos", "worker-1")).rejects.toThrow("boom");
    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({ stepType: "clone-repos", workerId: "worker-1" }),
      "conductor.poll.request.failed",
    );
  });
});
