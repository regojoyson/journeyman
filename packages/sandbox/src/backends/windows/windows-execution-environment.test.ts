import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { WindowsExecutionEnvironment } from "./windows-execution-environment.ts";
import { runExecutionEnvironmentContract } from "../contract.ts";
import type { AgentClient } from "./windows-agent-client.ts";

/** A fake agent client: unary RPCs resolve; Exec echoes {op}; Materialize accepts + ok. */
function fakeClient(): AgentClient {
  return {
    Provision: (req, cb) => cb(null, { handle: `win:${req.run_id}`, workspace_dir: `C:\\jm-runs\\${req.run_id}` }),
    Destroy: (_req, cb) => cb(null, { ok: true }),
    List: (_req, cb) => cb(null, { runs: [] }),
    Readiness: (_req, cb) => cb(null, { ready: true, checks: [] }),
    Exec: (req) => {
      const s = new EventEmitter() as unknown as { on: EventEmitter["on"]; emit: EventEmitter["emit"]; cancel: () => void };
      (s as { cancel: () => void }).cancel = () => {};
      const op = JSON.parse(req.request_json).op;
      queueMicrotask(() => {
        (s as unknown as EventEmitter).emit("data", { log: { line: "starting", meta_json: "" } });
        (s as unknown as EventEmitter).emit("data", { final: { ok: true, structured_json: JSON.stringify({ op }), error: "" } });
        (s as unknown as EventEmitter).emit("end");
      });
      return s as never;
    },
    Materialize: (cb) => {
      const w = { write: () => true, end: () => queueMicrotask(() => cb(null, { ok: true })) };
      return w as never;
    },
    close: () => {},
  } as AgentClient;
}

describe("WindowsExecutionEnvironment", () => {
  it("provision returns the agent handle + workspace dir", async () => {
    const env = new WindowsExecutionEnvironment({ client: fakeClient() });
    const p = await env.provision("r1", {});
    expect(p).toMatchObject({ runId: "r1", type: "machine-windows", handle: "win:r1", workspaceDir: "C:\\jm-runs\\r1" });
  });

  it("exec relays logs and maps the final event", async () => {
    const env = new WindowsExecutionEnvironment({ client: fakeClient() });
    const p = await env.provision("r2", {});
    const logs: string[] = [];
    const r = await env.exec(p, { op: "custom-prompt", stdin: { x: 1 }, onLog: (l) => logs.push(l) });
    expect(r.ok).toBe(true);
    expect(r.structured).toEqual({ op: "custom-prompt" });
    expect(logs).toContain("starting");
  });
});

runExecutionEnvironmentContract("machine-windows", () => new WindowsExecutionEnvironment({ client: fakeClient() }));
