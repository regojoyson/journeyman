import { describe, it, expect, vi } from "vitest";
import { WindowsBackend } from "./windows-backend.ts";
import type { AgentClient } from "./windows-agent-client.ts";
import type { ResolvedSandbox } from "@journeyman/core";

const worker: ResolvedSandbox = {
  id: "w1", type: "machine-windows", executionMode: "shared", connectivity: "agent",
  config: { connection: { host: "win-box", port: 50051, certDir: "/c" } },
};

describe("WindowsBackend", () => {
  it("declares machine-windows / shared / agent", () => {
    const b = new WindowsBackend({ makeClient: () => ({} as AgentClient) });
    expect(b.type).toBe("machine-windows");
    expect(b.supportedModes).toEqual(["shared"]);
    expect(b.supportedConnectivity).toEqual(["agent"]);
  });

  it("validateConfig requires connection host/port/certDir", () => {
    const b = new WindowsBackend({ makeClient: () => ({} as AgentClient) });
    expect(() => b.validateConfig({})).toThrow(/connection|object/i);
    expect(() => b.validateConfig({ connection: { host: "h", port: 1, certDir: "/c" } })).not.toThrow();
  });

  it("create builds the client from the worker connection", () => {
    const makeClient = vi.fn(() => ({} as AgentClient));
    const env = new WindowsBackend({ makeClient }).create(worker);
    expect(makeClient).toHaveBeenCalledWith({ host: "win-box", port: 50051, certDir: "/c" });
    expect(env.type).toBe("machine-windows");
  });
});
