import { describe, it, expect } from "vitest";
import type { IDockerClient } from "./backends/docker/docker-client.ts";
import { runWorkerConnectionTest } from "./test-connection.ts";

function fakeClient(pingImpl: () => Promise<void>): IDockerClient {
  return { ping: pingImpl } as unknown as IDockerClient;
}

describe("runWorkerConnectionTest", () => {
  it("returns ok when the docker daemon pings", async () => {
    const res = await runWorkerConnectionTest(
      { type: "docker", config: { connection: { host: "tcp://docker:2375" } } },
      { makeDockerClient: () => fakeClient(async () => {}) },
    );
    expect(res).toEqual({ ok: true });
  });

  it("returns the error when the docker daemon is unreachable", async () => {
    const res = await runWorkerConnectionTest(
      { type: "docker", config: { connection: { host: "tcp://nope:2375" } } },
      { makeDockerClient: () => fakeClient(async () => { throw new Error("connect ENOENT /nope.sock"); }) },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain("ENOENT");
  });

  it("rejects types without a backend", async () => {
    const res = await runWorkerConnectionTest(
      { type: "ecs", config: {} },
      { makeDockerClient: () => fakeClient(async () => {}) },
    );
    expect(res).toEqual({ ok: false, error: "No connection test for type 'ecs'" });
  });
});
