import { describe, it, expect } from "vitest";
import type { IDockerClient } from "./backends/docker/docker-client.ts";
import type { AgentClient } from "./backends/windows/windows-agent-client.ts";
import type { ReadinessReply } from "@journeyman/agent-protocol";
import { runWorkerConnectionTest } from "./test-connection.ts";

function fakeClient(pingImpl: () => Promise<void>): IDockerClient {
  return { ping: pingImpl } as unknown as IDockerClient;
}

function fakeWinClient(reply: ReadinessReply): AgentClient {
  return {
    Readiness: (_r: Record<string, never>, cb: (e: Error | null, r: ReadinessReply) => void) => cb(null, reply),
    close: () => {},
  } as unknown as AgentClient;
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

  it("machine-windows: ok when the agent reports ready", async () => {
    const res = await runWorkerConnectionTest(
      { type: "machine-windows", config: { connection: { host: "h", port: 1, certDir: "/c" } } },
      {
        makeDockerClient: () => fakeClient(async () => {}),
        makeWindowsClient: () => fakeWinClient({ ready: true, checks: [] }),
      },
    );
    expect(res).toEqual({ ok: true });
  });

  it("machine-windows: not-ok surfaces the failing check detail", async () => {
    const res = await runWorkerConnectionTest(
      { type: "machine-windows", config: { connection: { host: "h", port: 1, certDir: "/c" } } },
      {
        makeDockerClient: () => fakeClient(async () => {}),
        makeWindowsClient: () => fakeWinClient({ ready: false, checks: [{ name: "bash", ok: false, detail: "not found — install Git for Windows" }] }),
      },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Git for Windows/i);
  });
});
