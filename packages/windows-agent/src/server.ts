import { join } from "node:path";
import * as grpc from "@grpc/grpc-js";
import { agentServiceDef } from "@journeyman/agent-protocol";
import type { AgentConfig } from "./config.ts";
import { findGitBash } from "./shell.ts";
import { runReadinessChecks } from "./readiness.ts";
import { provisionDir, destroyDir, listRuns, materializeTar } from "./workspace.ts";
import { spawnRunner } from "./runner-spawn.ts";

export interface AgentServerDeps {
  config: AgentConfig;
  /** which-style probe; default assumes present. Injectable for tests. */
  probe?: (tool: string) => Promise<boolean>;
}

export function createAgentServer(deps: AgentServerDeps): grpc.Server {
  const { config } = deps;
  const bash = findGitBash();
  const probe = deps.probe ?? (async () => true);
  const server = new grpc.Server({
    // Keepalive so long, quiet builds aren't dropped (finding 14).
    "grpc.keepalive_time_ms": 30_000,
    "grpc.keepalive_timeout_ms": 10_000,
    "grpc.keepalive_permit_without_calls": 1,
  });

  const impl: grpc.UntypedServiceImplementation = {
    Readiness: (_call: grpc.ServerUnaryCall<unknown, unknown>, cb: grpc.sendUnaryData<unknown>) => {
      runReadinessChecks({ bashPath: bash, workspaceRoot: config.workspaceRoot, probe })
        .then((r) => cb(null, r)).catch((e) => cb(e as grpc.ServiceError));
    },
    Provision: (call: grpc.ServerUnaryCall<{ run_id: string }, unknown>, cb: grpc.sendUnaryData<unknown>) => {
      provisionDir(config.workspaceRoot, call.request.run_id)
        .then((p) => cb(null, { handle: p.handle, workspace_dir: p.workspaceDir }))
        .catch((e) => cb(e as grpc.ServiceError));
    },
    Destroy: (call: grpc.ServerUnaryCall<{ run_id: string }, unknown>, cb: grpc.sendUnaryData<unknown>) => {
      destroyDir(config.workspaceRoot, call.request.run_id)
        .then(() => cb(null, { ok: true })).catch((e) => cb(e as grpc.ServiceError));
    },
    List: (call: grpc.ServerUnaryCall<{ run_id: string }, unknown>, cb: grpc.sendUnaryData<unknown>) => {
      listRuns(config.workspaceRoot).then((runs) => {
        const filtered = call.request.run_id ? runs.filter((r) => r.run_id === call.request.run_id) : runs;
        cb(null, { runs: filtered });
      }).catch((e) => cb(e as grpc.ServiceError));
    },
    Materialize: (call: grpc.ServerReadableStream<{ run_id: string; dest_dir: string; tar: Buffer }, unknown>, cb: grpc.sendUnaryData<unknown>) => {
      const parts: Buffer[] = [];
      let runId = ""; let destDir = "";
      call.on("data", (chunk) => {
        runId = chunk.run_id || runId; destDir = chunk.dest_dir || destDir;
        if (chunk.tar?.length) parts.push(Buffer.from(chunk.tar));
      });
      call.on("end", () => {
        materializeTar(join(config.workspaceRoot, runId), destDir, Buffer.concat(parts))
          .then(() => cb(null, { ok: true })).catch((e) => cb(e as grpc.ServiceError));
      });
      call.on("error", (e) => cb(e as grpc.ServiceError));
    },
    Exec: (call: grpc.ServerWritableStream<{ run_id: string; request_json: string; env: Record<string, string> }, unknown>) => {
      const ws = join(config.workspaceRoot, call.request.run_id);
      const ac = new AbortController();
      call.on("cancelled", () => ac.abort(new Error("gRPC call cancelled")));
      spawnRunner({
        command: config.runnerCommand, args: [...config.runnerArgs], cwd: ws,
        requestJson: call.request.request_json, env: call.request.env ?? {},
        onLog: (line, meta) => call.write({ log: { line, meta_json: meta ? JSON.stringify(meta) : "" } }),
        signal: ac.signal,
      }).then((result) => {
        call.write({ final: { ok: result.ok, structured_json: result.structured != null ? JSON.stringify(result.structured) : "", error: result.error ?? "" } });
        call.end();
      }).catch((err) => {
        call.write({ final: { ok: false, structured_json: "", error: (err as Error).message } });
        call.end();
      });
    },
  };

  server.addService(agentServiceDef().service, impl);
  return server;
}
