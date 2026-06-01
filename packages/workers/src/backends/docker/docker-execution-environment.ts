import type {
  ExecOp, ExecResult, ExecutionEnvironmentSpec, IExecutionEnvironment, ProvisionedEnv, WorkerType,
} from "@journeyman/core";
import type { IDockerClient } from "./docker-client.ts";

export interface DockerExecutionEnvironmentDeps {
  client: IDockerClient;
  /** How to invoke the runner inside the container. Both runner-base and the bundle expose this. */
  runnerCmd?: string[];
  /** Fallback image when a spec omits imageRef. */
  defaultImage?: string;
}

const DEFAULT_RUNNER_CMD = ["journeyman-runner"];
const WORKSPACE = "/workspace";

export class DockerExecutionEnvironment implements IExecutionEnvironment {
  readonly type: WorkerType = "docker";

  constructor(private deps: DockerExecutionEnvironmentDeps) {}

  async provision(runId: string, spec: ExecutionEnvironmentSpec): Promise<ProvisionedEnv> {
    const volume = `jm-run-${runId}`;
    const image = spec.imageRef ?? this.deps.defaultImage;
    if (!image) throw new Error("docker provision requires an imageRef or defaultImage");

    await this.deps.client.createVolume(volume);
    const handle = await this.deps.client.runIdle({
      image,
      volume,
      mountPath: WORKSPACE,
      labels: { "journeyman.runId": runId },
      ...(spec.env ? { env: spec.env } : {}),
      ...(spec.resources?.cpus ? { cpus: spec.resources.cpus } : {}),
      ...(spec.resources?.memoryMb ? { memoryMb: spec.resources.memoryMb } : {}),
      ...(spec.network ? { network: spec.network } : {}),
    });
    return { runId, type: "docker", handle, volume, workspaceDir: WORKSPACE };
  }

  async exec(env: ProvisionedEnv, op: ExecOp): Promise<ExecResult> {
    const request = JSON.stringify({ op: op.op, opts: { ...((op.stdin as object) ?? {}), cwd: WORKSPACE } });
    const r = await this.deps.client.exec(env.handle, {
      cmd: this.deps.runnerCmd ?? DEFAULT_RUNNER_CMD,
      stdin: request,
      ...(op.env ? { env: op.env } : {}),
      ...(op.signal ? { signal: op.signal } : {}),
      ...(op.onLog ? { onStderr: (line: string) => forwardLog(line, op.onLog!) } : {}),
    });

    const text = r.stdout.trim();
    if (text) {
      try {
        const parsed = JSON.parse(text) as ExecResult & { result?: string };
        // The runner envelope carries text-mode output in `result`; flatten into `structured`.
        return { ok: parsed.ok, structured: parsed.structured ?? parsed.result, error: parsed.error };
      } catch {
        // fall through
      }
    }
    return { ok: false, error: `runner produced no JSON (exit ${r.exitCode}): ${text}` };
  }

  async destroy(env: ProvisionedEnv): Promise<void> {
    await this.deps.client.removeContainer(env.handle).catch(() => undefined);
    if (env.volume) await this.deps.client.removeVolume(env.volume).catch(() => undefined);
  }

  async list(filter?: { runId?: string }): Promise<ProvisionedEnv[]> {
    const rows = await this.deps.client.listByLabel("journeyman.runId", filter?.runId);
    return rows
      .filter((r) => r.runId)
      .map((r) => ({
        runId: r.runId, type: "docker" as WorkerType, handle: r.id,
        volume: `jm-run-${r.runId}`, workspaceDir: WORKSPACE,
      }));
  }
}

/** Runner emits NDJSON {line, meta} per log; forward parsed, else raw. */
function forwardLog(line: string, onLog: (line: string, meta?: Record<string, unknown>) => void): void {
  try {
    const parsed = JSON.parse(line) as { line?: string; meta?: Record<string, unknown> };
    if (parsed && typeof parsed.line === "string") { onLog(parsed.line, parsed.meta); return; }
  } catch { /* not NDJSON */ }
  onLog(line);
}
