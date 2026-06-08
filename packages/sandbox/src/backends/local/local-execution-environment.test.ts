import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OperationRunner } from "@journeyman/core";
import { LocalExecutionEnvironment } from "./local-execution-environment.ts";
import { runExecutionEnvironmentContract } from "../contract.ts";

const echoRunner: OperationRunner = async (op) => ({ ok: true, structured: { op: op.op } });

runExecutionEnvironmentContract("local", async () => {
  const base = await mkdtemp(join(tmpdir(), "jm-workers-"));
  return new LocalExecutionEnvironment({ runOperation: echoRunner, baseDir: base });
});

describe("LocalExecutionEnvironment", () => {
  it("provision creates the run workspace dir under baseDir", async () => {
    const base = await mkdtemp(join(tmpdir(), "jm-workers-"));
    const env = new LocalExecutionEnvironment({ runOperation: echoRunner, baseDir: base });
    const p = await env.provision("run-x", {});
    expect(p.type).toBe("local");
    expect(p.workspaceDir).toBe(join(base, "run-x"));
    expect(existsSync(p.workspaceDir)).toBe(true);
    await env.destroy(p);
    expect(existsSync(p.workspaceDir)).toBe(false);
  });

  it("destroy keeps the workspace when retainWorkspace is true", async () => {
    const base = await mkdtemp(join(tmpdir(), "jm-workers-"));
    const env = new LocalExecutionEnvironment({ runOperation: echoRunner, baseDir: base, retainWorkspace: true });
    const p = await env.provision("run-y", {});
    await env.destroy(p);
    expect(existsSync(p.workspaceDir)).toBe(true);
  });

  it("exec delegates to the injected operation runner with the run workspaceDir", async () => {
    const base = await mkdtemp(join(tmpdir(), "jm-workers-"));
    const calls: string[] = [];
    const runner: OperationRunner = async (op, c) => {
      calls.push(`${op.op}@${c.workspaceDir}`);
      return { ok: true };
    };
    const env = new LocalExecutionEnvironment({ runOperation: runner, baseDir: base });
    const p = await env.provision("run-z", {});
    await env.exec(p, { op: "analyze", stdin: {} });
    expect(calls).toEqual([`analyze@${join(base, "run-z")}`]);
  });

  it("list returns empty (local does not track instances)", async () => {
    const base = await mkdtemp(join(tmpdir(), "jm-workers-"));
    const env = new LocalExecutionEnvironment({ runOperation: echoRunner, baseDir: base });
    expect(await env.list()).toEqual([]);
  });
});
