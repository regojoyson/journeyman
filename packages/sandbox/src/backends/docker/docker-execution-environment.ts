import type {
  ExecOp, ExecResult, ExecutionEnvironmentSpec, FileBundle, IExecutionEnvironment, ProvisionedEnv, SandboxType,
} from "@journeyman/core";
import type { IDockerClient } from "./docker-client.ts";

export interface DockerExecutionEnvironmentDeps {
  client: IDockerClient;
  /** How to invoke the runner inside the container. Both runner-base and the bundle expose this. */
  runnerCmd?: string[];
  /** Fallback image when a spec omits imageRef. */
  defaultImage?: string;
  /** Worker config captured at create() — carries connection, image recipe, __existingHandle, network, etc. */
  config?: Record<string, unknown>;
  /**
   * Resolve the image ref to provision with, ensuring it's present on this daemon.
   * Injected by the backend deps (orchestrator owns kit/registry specifics).
   * Falls back to spec.imageRef / defaultImage when absent.
   */
  resolveImageRef?: (config: Record<string, unknown>, client: IDockerClient) => Promise<string>;
}

const DEFAULT_RUNNER_CMD = ["journeyman-runner"];
const WORKSPACE = "/workspace";

export class DockerExecutionEnvironment implements IExecutionEnvironment {
  readonly type: SandboxType = "docker";

  constructor(private deps: DockerExecutionEnvironmentDeps) {}

  async provision(runId: string, spec: ExecutionEnvironmentSpec): Promise<ProvisionedEnv> {
    const config = this.deps.config ?? {};

    // Reconnect path: an existing container handle was recorded (connect()).
    const existingHandle = config["__existingHandle"];
    if (existingHandle) {
      return {
        runId,
        type: "docker",
        handle: String(existingHandle),
        ...(config["__existingVolume"] ? { volume: String(config["__existingVolume"]) } : {}),
        workspaceDir: WORKSPACE,
      };
    }

    // Fresh provision: resolve the image ref (kit base or pre-built), then run idle.
    const image = this.deps.resolveImageRef
      ? await this.deps.resolveImageRef(config, this.deps.client)
      : (spec.imageRef ?? this.deps.defaultImage);
    if (!image) throw new Error("docker provision requires an imageRef or defaultImage");

    const volume = `jm-run-${runId}`;
    const network = config["network"] === "none" ? ("none" as const) : (spec.network ?? ("full" as const));
    const env = (config["env"] as Record<string, string> | undefined) ?? spec.env;
    const resources = (config["resources"] as ExecutionEnvironmentSpec["resources"] | undefined) ?? spec.resources;

    await this.deps.client.createVolume(volume);
    const handle = await this.deps.client.runIdle({
      image,
      volume,
      mountPath: WORKSPACE,
      labels: { "journeyman.runId": runId },
      ...(env ? { env } : {}),
      ...(resources?.cpus ? { cpus: resources.cpus } : {}),
      ...(resources?.memoryMb ? { memoryMb: resources.memoryMb } : {}),
      network,
    });
    return { runId, type: "docker", handle, volume, workspaceDir: WORKSPACE, imageRef: image };
  }

  async exec(env: ProvisionedEnv, op: ExecOp): Promise<ExecResult> {
    const request = JSON.stringify({ op: op.op, provider: op.provider, opts: { ...((op.stdin as object) ?? {}), cwd: WORKSPACE } });
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
        runId: r.runId, type: "docker" as SandboxType, handle: r.id,
        volume: `jm-run-${r.runId}`, workspaceDir: WORKSPACE,
      }));
  }

  async materialize(env: ProvisionedEnv, destDir: string, bundle: FileBundle): Promise<void> {
    // 1. wipe + recreate the dir inside the container
    await this.deps.client.exec(env.handle, {
      cmd: ["sh", "-c", `rm -rf "${destDir}"/* 2>/dev/null; mkdir -p "${destDir}"`],
    });
    // 2. stream the tar into the container at destDir
    await this.deps.client.putArchive(env.handle, bundle.tar, { path: destDir });
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
