import { describe, it, expect, vi } from "vitest";
import { destroySandboxInstance } from "./destroy-sandbox-instance.ts";
import type { SandboxInstanceRecord } from "./sandbox-instance-store.ts";
import type { IExecutionEnvironmentRegistry } from "@journeyman/core";

function recordOf(type: string): SandboxInstanceRecord {
  return {
    runId: "r1", type, handle: type === "local" ? "local:r1" : "h1",
    volume: type === "local" ? null : "v1", imageRef: null, owner: null,
    connection: { host: "tcp://docker:2375" }, status: "active",
  };
}

describe("destroySandboxInstance", () => {
  it("creates the backend for the record type and destroys the rebuilt env", async () => {
    const destroy = vi.fn(async () => {});
    const create = vi.fn(() => ({ destroy } as never));
    const registry = { get: vi.fn(() => ({ create })) } as unknown as IExecutionEnvironmentRegistry;
    await destroySandboxInstance(registry, recordOf("docker"));
    expect(registry.get).toHaveBeenCalledWith("docker");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ id: "r1", type: "docker", config: { connection: { host: "tcp://docker:2375" } } }),
    );
    expect(destroy).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "r1", type: "docker", handle: "h1", volume: "v1", workspaceDir: "/workspace" }),
    );
  });

  it("computes the local workspace dir from the handle", async () => {
    const destroy = vi.fn(async () => {});
    const registry = { get: vi.fn(() => ({ create: () => ({ destroy }) })) } as unknown as IExecutionEnvironmentRegistry;
    await destroySandboxInstance(registry, recordOf("local"));
    expect(destroy).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "r1", type: "local", workspaceDir: "r1" }),
    );
  });
});
