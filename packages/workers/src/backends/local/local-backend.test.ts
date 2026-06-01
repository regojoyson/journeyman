import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import type { OperationRunner, ResolvedWorker } from "@journeyman/core";
import { LocalBackend } from "./local-backend.ts";

const noopRunner: OperationRunner = async () => ({ ok: true });
const deps = { runOperation: noopRunner, defaultBaseDir: tmpdir() };

function worker(config: unknown): ResolvedWorker {
  return { id: "w1", type: "local", executionMode: "shared", config };
}

describe("LocalBackend", () => {
  it("declares type local, shared mode, no connectivity", () => {
    const b = new LocalBackend(deps);
    expect(b.type).toBe("local");
    expect(b.supportedModes).toEqual(["shared"]);
    expect(b.supportedConnectivity).toEqual([]);
  });

  it("validateConfig accepts undefined / empty / valid config", () => {
    const b = new LocalBackend(deps);
    expect(() => b.validateConfig(undefined)).not.toThrow();
    expect(() => b.validateConfig({})).not.toThrow();
    expect(() => b.validateConfig({ baseDir: "/tmp/x", retainWorkspace: true })).not.toThrow();
  });

  it("validateConfig rejects bad types", () => {
    const b = new LocalBackend(deps);
    expect(() => b.validateConfig({ baseDir: 5 })).toThrow(/baseDir/);
    expect(() => b.validateConfig({ retainWorkspace: "yes" })).toThrow(/retainWorkspace/);
  });

  it("create returns a working LocalExecutionEnvironment", async () => {
    const b = new LocalBackend(deps);
    const env = b.create(worker({}));
    expect(env.type).toBe("local");
    const p = await env.provision("run-1", {});
    const r = await env.exec(p, { op: "x", stdin: {} });
    expect(r.ok).toBe(true);
    await env.destroy(p);
  });
});
