import type { Readable } from "node:stream";
import type {
  ExecOp, ExecResult, ExecutionEnvironmentSpec, FileBundle, IExecutionEnvironment, ProvisionedEnv, SandboxType,
} from "@journeyman/core";
import type { AgentClient } from "./windows-agent-client.ts";
import type { ExecEvent } from "@journeyman/agent-protocol";

export interface WindowsExecutionEnvironmentDeps { client: AgentClient; }

export class WindowsExecutionEnvironment implements IExecutionEnvironment {
  readonly type: SandboxType = "machine-windows";
  constructor(private deps: WindowsExecutionEnvironmentDeps) {}

  async provision(runId: string, _spec: ExecutionEnvironmentSpec): Promise<ProvisionedEnv> {
    const r = await new Promise<{ handle: string; workspace_dir: string }>((res, rej) =>
      this.deps.client.Provision({ run_id: runId }, (e, x) => (e ? rej(e) : res(x))));
    return { runId, type: "machine-windows", handle: r.handle, workspaceDir: r.workspace_dir };
  }

  async exec(env: ProvisionedEnv, op: ExecOp): Promise<ExecResult> {
    const request = JSON.stringify({
      op: op.op, provider: op.provider,
      opts: { ...((op.stdin as object) ?? {}), cwd: env.workspaceDir },
    });
    return new Promise<ExecResult>((resolve, reject) => {
      const stream = this.deps.client.Exec({ run_id: env.runId, request_json: request, env: op.env ?? {} });
      if (op.signal) op.signal.addEventListener("abort", () => stream.cancel(), { once: true });
      let final: ExecResult | undefined;
      stream.on("data", (ev: ExecEvent) => {
        if (ev.log && op.onLog) {
          const meta = ev.log.meta_json ? safeParse(ev.log.meta_json) : undefined;
          op.onLog(ev.log.line, meta as Record<string, unknown> | undefined);
        }
        if (ev.final) {
          final = {
            ok: ev.final.ok,
            ...(ev.final.structured_json ? { structured: safeParse(ev.final.structured_json) } : {}),
            ...(ev.final.error ? { error: ev.final.error } : {}),
          };
        }
      });
      stream.on("end", () => resolve(final ?? { ok: false, error: "agent produced no final event" }));
      stream.on("error", (e: Error) => reject(e));
    });
  }

  async destroy(env: ProvisionedEnv): Promise<void> {
    await new Promise<void>((res, rej) =>
      this.deps.client.Destroy({ run_id: env.runId }, (e) => (e ? rej(e) : res())));
  }

  async list(filter?: { runId?: string }): Promise<ProvisionedEnv[]> {
    const r = await new Promise<{ runs: Array<{ run_id: string; handle: string; workspace_dir: string }> }>((res, rej) =>
      this.deps.client.List({ run_id: filter?.runId ?? "" }, (e, x) => (e ? rej(e) : res(x))));
    return r.runs.map((run) => ({
      runId: run.run_id, type: "machine-windows" as SandboxType, handle: run.handle, workspaceDir: run.workspace_dir,
    }));
  }

  async materialize(env: ProvisionedEnv, destDir: string, bundle: FileBundle): Promise<void> {
    const raw = bundle.tar;
    const tar = Buffer.isBuffer(raw) ? raw : await streamToBuffer(raw as Readable);
    await new Promise<void>((resolve, reject) => {
      const call = this.deps.client.Materialize((e) => (e ? reject(e) : resolve()));
      const CHUNK = 1024 * 1024;
      if (tar.length === 0) {
        call.write({ run_id: env.runId, dest_dir: destDir, tar: Buffer.alloc(0) });
      } else {
        for (let i = 0; i < tar.length; i += CHUNK) {
          call.write({ run_id: env.runId, dest_dir: destDir, tar: tar.subarray(i, i + CHUNK) });
        }
      }
      call.end();
    });
  }
}

function safeParse(s: string): unknown { try { return JSON.parse(s); } catch { return s; } }
async function streamToBuffer(src: Readable): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const c of src) parts.push(Buffer.from(c as Buffer));
  return Buffer.concat(parts);
}
