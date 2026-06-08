import { describe, it, expect } from "vitest";
import type {
  ExecutionEnvironmentBackend,
  IExecutionEnvironment,
  ResolvedSandbox,
  SandboxType,
} from "@journeyman/core";
import { InMemoryExecutionEnvironmentRegistry } from "./in-memory-execution-environment-registry.ts";

const fakeEnv = {} as IExecutionEnvironment;

function fakeBackend(type: SandboxType): ExecutionEnvironmentBackend {
  return {
    type,
    supportedModes: ["shared"],
    supportedConnectivity: [],
    validateConfig: () => {},
    create: (_w: ResolvedSandbox) => fakeEnv,
  };
}

describe("InMemoryExecutionEnvironmentRegistry", () => {
  it("registers and gets a backend by type", () => {
    const r = new InMemoryExecutionEnvironmentRegistry();
    r.register(fakeBackend("local"));
    expect(r.get("local").type).toBe("local");
  });

  it("available() lists registered types", () => {
    const r = new InMemoryExecutionEnvironmentRegistry();
    r.register(fakeBackend("local"));
    r.register(fakeBackend("docker"));
    expect(r.available().sort()).toEqual(["docker", "local"]);
  });

  it("throws on duplicate registration", () => {
    const r = new InMemoryExecutionEnvironmentRegistry();
    r.register(fakeBackend("local"));
    expect(() => r.register(fakeBackend("local"))).toThrow(/already registered/);
  });

  it("throws when getting an unregistered type", () => {
    const r = new InMemoryExecutionEnvironmentRegistry();
    expect(() => r.get("docker")).toThrow(/No execution backend/);
  });
});
