import { describe, it, expect } from "vitest";
import type { DockerCommandRunner, DockerRunResult } from "./docker-command-runner.ts";
import { DockerExecutionEnvironment } from "./docker-execution-environment.ts";

function recorder(responses: Record<string, DockerRunResult>): {
  runner: DockerCommandRunner;
  calls: string[][];
  stdins: (string | undefined)[];
} {
  const calls: string[][] = [];
  const stdins: (string | undefined)[] = [];
  const runner: DockerCommandRunner = async (args, opts) => {
    calls.push(args);
    stdins.push(opts?.stdin);
    const key = args[0];
    return responses[key] ?? { stdout: "", stderr: "", exitCode: 0 };
  };
  return { runner, calls, stdins };
}

const okExec: DockerRunResult = {
  stdout: JSON.stringify({ ok: true, structured: { done: 1 } }),
  stderr: "",
  exitCode: 0,
};

describe("DockerExecutionEnvironment", () => {
  it("provision creates a labeled volume + idle container at /workspace", async () => {
    const { runner, calls } = recorder({ run: { stdout: "container123\n", stderr: "", exitCode: 0 } });
    const env = new DockerExecutionEnvironment({ docker: runner });
    const p = await env.provision("run-1", { imageRef: "img:1" });
    expect(p.type).toBe("docker");
    expect(p.workspaceDir).toBe("/workspace");
    expect(p.volume).toBe("jm-run-run-1");
    expect(p.handle).toBe("container123");
    const volumeCreate = calls.find((c) => c[0] === "volume");
    expect(volumeCreate).toEqual(["volume", "create", "jm-run-run-1"]);
    const run = calls.find((c) => c[0] === "run")!;
    expect(run).toContain("-d");
    expect(run).toContain("--label");
    expect(run).toContain("journeyman.runId=run-1");
    expect(run).toContain("-v");
    expect(run).toContain("jm-run-run-1:/workspace");
    expect(run).toContain("img:1");
  });

  it("exec pipes the {op,opts} request to the runner and parses the response", async () => {
    const { runner, calls, stdins } = recorder({ exec: okExec });
    const env = new DockerExecutionEnvironment({ docker: runner });
    const res = await env.exec(
      { runId: "run-1", type: "docker", handle: "c1", volume: "v1", workspaceDir: "/workspace" },
      { op: "custom-prompt", stdin: { prompt: "hi" }, env: { ANTHROPIC_API_KEY: "k" } },
    );
    expect(res).toEqual({ ok: true, structured: { done: 1 }, error: undefined });
    const exec = calls.find((c) => c[0] === "exec")!;
    expect(exec).toContain("c1");
    expect(exec).toContain("-i");
    expect(exec).toContain("-e");
    expect(exec).toContain("ANTHROPIC_API_KEY=k");
    expect(JSON.parse(stdins.find((s) => s !== undefined)!)).toEqual({
      op: "custom-prompt",
      opts: { prompt: "hi", cwd: "/workspace" },
    });
  });

  it("exec returns an error result when the runner exits non-zero with no JSON", async () => {
    const { runner } = recorder({ exec: { stdout: "", stderr: "kaboom", exitCode: 1 } });
    const env = new DockerExecutionEnvironment({ docker: runner });
    const res = await env.exec(
      { runId: "r", type: "docker", handle: "c1", workspaceDir: "/workspace" },
      { op: "x", stdin: {} },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain("kaboom");
  });

  it("exec forwards NDJSON stderr to onLog as (line, meta) and raw lines as-is", async () => {
    const logs: Array<[string, unknown]> = [];
    const runner: DockerCommandRunner = async (_args, opts) => {
      opts?.onStderr?.(JSON.stringify({ line: "hello", meta: { sdk: 1 } }));
      opts?.onStderr?.("plain line");
      return okExec;
    };
    const env = new DockerExecutionEnvironment({ docker: runner });
    await env.exec(
      { runId: "r", type: "docker", handle: "c1", workspaceDir: "/workspace" },
      { op: "x", stdin: {}, onLog: (line, meta) => logs.push([line, meta]) },
    );
    expect(logs).toEqual([["hello", { sdk: 1 }], ["plain line", undefined]]);
  });

  it("destroy removes the container and volume", async () => {
    const { runner, calls } = recorder({});
    const env = new DockerExecutionEnvironment({ docker: runner });
    await env.destroy({ runId: "r", type: "docker", handle: "c1", volume: "v1", workspaceDir: "/workspace" });
    expect(calls).toContainEqual(["rm", "-f", "c1"]);
    expect(calls).toContainEqual(["volume", "rm", "v1"]);
  });

  it("list parses runId-labeled containers", async () => {
    const { runner } = recorder({
      ps: { stdout: "c1 jm-run-a journeyman.runId=a\nc2 jm-run-b journeyman.runId=b\n", stderr: "", exitCode: 0 },
    });
    const env = new DockerExecutionEnvironment({ docker: runner });
    const list = await env.list();
    expect(list.map((e) => e.runId).sort()).toEqual(["a", "b"]);
    expect(list.map((e) => e.handle).sort()).toEqual(["c1", "c2"]);
  });
});
