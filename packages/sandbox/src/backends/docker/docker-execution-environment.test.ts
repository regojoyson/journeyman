import { describe, it, expect, vi } from "vitest";
import type { IDockerClient } from "./docker-client.ts";
import { DockerExecutionEnvironment } from "./docker-execution-environment.ts";

interface Calls {
  createVolume: string[];
  removeVolume: string[];
  runIdle: Array<Parameters<IDockerClient["runIdle"]>[0]>;
  exec: Array<{ id: string; o: Parameters<IDockerClient["exec"]>[1] }>;
  removeContainer: string[];
  list: Array<[string, string | undefined]>;
}

function fakeClient(over: {
  execStdout?: string; execExit?: number; stderr?: string[]; list?: Array<{ id: string; runId: string }>;
} = {}): { client: IDockerClient; calls: Calls } {
  const calls: Calls = { createVolume: [], removeVolume: [], runIdle: [], exec: [], removeContainer: [], list: [] };
  const client: IDockerClient = {
    async ping() {},
    async createVolume(n) { calls.createVolume.push(n); },
    async removeVolume(n) { calls.removeVolume.push(n); },
    async runIdle(o) { calls.runIdle.push(o); return "container123"; },
    async exec(id, o) {
      calls.exec.push({ id, o });
      if (o.onStderr && over.stderr) for (const l of over.stderr) o.onStderr(l);
      return { stdout: over.execStdout ?? JSON.stringify({ ok: true, structured: { done: 1 } }), exitCode: over.execExit ?? 0 };
    },
    async removeContainer(id) { calls.removeContainer.push(id); },
    async listByLabel(k, v) { calls.list.push([k, v]); return over.list ?? []; },
    async imageExists() { return false; },
    async imageId() { return null; },
    async buildImage() { /* noop */ },
    async loadImage() { /* noop */ },
    async putArchive() { /* noop */ },
  };
  return { client, calls };
}

describe("DockerExecutionEnvironment", () => {
  it("provision creates a labeled volume + idle container at /workspace", async () => {
    const { client, calls } = fakeClient();
    const env = new DockerExecutionEnvironment({ client });
    const p = await env.provision("run-1", { imageRef: "img:1", network: "none", resources: { cpus: 2 } });
    expect(p).toEqual({ runId: "run-1", type: "docker", handle: "container123", volume: "jm-run-run-1", workspaceDir: "/workspace" });
    expect(calls.createVolume).toEqual(["jm-run-run-1"]);
    expect(calls.runIdle[0]).toMatchObject({
      image: "img:1", volume: "jm-run-run-1", mountPath: "/workspace",
      labels: { "journeyman.runId": "run-1" }, network: "none", cpus: 2,
    });
  });

  it("exec sends the {op,opts} request and parses the response", async () => {
    const { client, calls } = fakeClient();
    const env = new DockerExecutionEnvironment({ client });
    const res = await env.exec(
      { runId: "r", type: "docker", handle: "c1", volume: "v1", workspaceDir: "/workspace" },
      { op: "custom-prompt", stdin: { prompt: "hi" }, env: { ANTHROPIC_API_KEY: "k" } },
    );
    expect(res).toEqual({ ok: true, structured: { done: 1 }, error: undefined });
    expect(calls.exec[0].id).toBe("c1");
    expect(calls.exec[0].o.cmd).toEqual(["journeyman-runner"]);
    expect(calls.exec[0].o.env).toEqual({ ANTHROPIC_API_KEY: "k" });
    expect(JSON.parse(calls.exec[0].o.stdin!)).toEqual({ op: "custom-prompt", opts: { prompt: "hi", cwd: "/workspace" } });
  });

  it("exec flattens a text-mode result and forwards NDJSON/raw stderr to onLog", async () => {
    const logs: Array<[string, unknown]> = [];
    const { client } = fakeClient({
      execStdout: JSON.stringify({ ok: true, result: "hello text" }),
      stderr: [JSON.stringify({ line: "log A", meta: { sdk: 1 } }), "raw B"],
    });
    const env = new DockerExecutionEnvironment({ client });
    const res = await env.exec(
      { runId: "r", type: "docker", handle: "c1", workspaceDir: "/workspace" },
      { op: "custom-prompt", stdin: {}, onLog: (line, meta) => logs.push([line, meta]) },
    );
    expect(res.structured).toBe("hello text");
    expect(logs).toEqual([["log A", { sdk: 1 }], ["raw B", undefined]]);
  });

  it("exec returns an error result when the runner produced no JSON", async () => {
    const { client } = fakeClient({ execStdout: "", execExit: 1 });
    const env = new DockerExecutionEnvironment({ client });
    const res = await env.exec({ runId: "r", type: "docker", handle: "c1", workspaceDir: "/workspace" }, { op: "x", stdin: {} });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no JSON/);
  });

  it("destroy removes the container and volume", async () => {
    const { client, calls } = fakeClient();
    const env = new DockerExecutionEnvironment({ client });
    await env.destroy({ runId: "r", type: "docker", handle: "c1", volume: "v1", workspaceDir: "/workspace" });
    expect(calls.removeContainer).toEqual(["c1"]);
    expect(calls.removeVolume).toEqual(["v1"]);
  });

  it("list maps labeled containers to ProvisionedEnv", async () => {
    const { client } = fakeClient({ list: [{ id: "c1", runId: "a" }, { id: "c2", runId: "b" }] });
    const env = new DockerExecutionEnvironment({ client });
    const list = await env.list();
    expect(list.map((e) => e.runId).sort()).toEqual(["a", "b"]);
    expect(list.map((e) => e.handle).sort()).toEqual(["c1", "c2"]);
  });
});

it("materialize wipes destDir then putArchives", async () => {
  const exec = vi.fn().mockResolvedValue({ stdout: "", exitCode: 0 });
  const putArchive = vi.fn().mockResolvedValue(undefined);
  const client = { exec, putArchive } as any;
  const env = new DockerExecutionEnvironment({ client });
  await env.materialize(
    { runId: "r", type: "docker", handle: "c1", workspaceDir: "/workspace" } as any,
    "/workspace/.journeyman/skills",
    { tar: Buffer.from("x") },
  );
  expect(exec).toHaveBeenCalledWith("c1", expect.objectContaining({
    cmd: expect.arrayContaining(["sh", "-c"]),
  }));
  expect(putArchive).toHaveBeenCalledWith("c1", expect.anything(), { path: "/workspace/.journeyman/skills" });
});
