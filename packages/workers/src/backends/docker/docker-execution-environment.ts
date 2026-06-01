import type {
  ExecOp, ExecResult, ExecutionEnvironmentSpec, IExecutionEnvironment, ProvisionedEnv, WorkerType,
} from "@journeyman/core";
import type { DockerCommandRunner } from "./docker-command-runner.ts";

export interface DockerExecutionEnvironmentDeps {
  docker: DockerCommandRunner;
  /** How to invoke the runner inside the container. */
  runnerCmd?: string[];
  /** Fallback image when a spec omits imageRef. */
  defaultImage?: string;
}

const DEFAULT_RUNNER_CMD = ["npx", "tsx", "packages/coding-cli/src/runner/cli.ts"];
const WORKSPACE = "/workspace";

export class DockerExecutionEnvironment implements IExecutionEnvironment {
  readonly type: WorkerType = "docker";

  constructor(private deps: DockerExecutionEnvironmentDeps) {}

  async provision(runId: string, spec: ExecutionEnvironmentSpec): Promise<ProvisionedEnv> {
    const volume = `jm-run-${runId}`;
    const image = spec.imageRef ?? this.deps.defaultImage;
    if (!image) throw new Error("docker provision requires an imageRef or defaultImage");

    await this.deps.docker(["volume", "create", volume]);

    const args = ["run", "-d", "--label", `journeyman.runId=${runId}`, "-v", `${volume}:${WORKSPACE}`];
    if (spec.resources?.cpus) args.push("--cpus", String(spec.resources.cpus));
    if (spec.resources?.memoryMb) args.push("--memory", `${spec.resources.memoryMb}m`);
    if (spec.network === "none") args.push("--network", "none");
    for (const [k, v] of Object.entries(spec.env ?? {})) args.push("-e", `${k}=${v}`);
    args.push("--entrypoint", "sleep", image, "infinity");

    const r = await this.deps.docker(args);
    if (r.exitCode !== 0) throw new Error(`docker run failed: ${r.stderr.trim()}`);
    const handle = r.stdout.trim();
    return { runId, type: "docker", handle, volume, workspaceDir: WORKSPACE };
  }

  async exec(env: ProvisionedEnv, op: ExecOp): Promise<ExecResult> {
    const request = JSON.stringify({ op: op.op, opts: { ...((op.stdin as object) ?? {}), cwd: WORKSPACE } });
    const args = ["exec", "-i", "-w", "/app"];
    for (const [k, v] of Object.entries(op.env ?? {})) args.push("-e", `${k}=${v}`);
    args.push(env.handle, ...(this.deps.runnerCmd ?? DEFAULT_RUNNER_CMD));

    const r = await this.deps.docker(args, {
      stdin: request,
      ...(op.signal ? { signal: op.signal } : {}),
      ...(op.onLog ? { onStderr: (line: string) => {
        // The runner emits NDJSON {line, meta} per log; forward parsed, else raw.
        try {
          const parsed = JSON.parse(line) as { line?: string; meta?: Record<string, unknown> };
          if (parsed && typeof parsed.line === "string") { op.onLog!(parsed.line, parsed.meta); return; }
        } catch { /* not NDJSON */ }
        op.onLog!(line);
      } } : {}),
    });

    const text = r.stdout.trim();
    if (text) {
      try {
        const parsed = JSON.parse(text) as ExecResult & { result?: string };
        // The runner envelope carries text-mode output in `result`; flatten it into `structured`.
        return { ok: parsed.ok, structured: parsed.structured ?? parsed.result, error: parsed.error };
      } catch {
        // fall through to error handling
      }
    }
    return { ok: false, error: `runner produced no JSON (exit ${r.exitCode}): ${r.stderr.trim() || text}` };
  }

  async destroy(env: ProvisionedEnv): Promise<void> {
    await this.deps.docker(["rm", "-f", env.handle]).catch(() => undefined);
    if (env.volume) await this.deps.docker(["volume", "rm", env.volume]).catch(() => undefined);
  }

  async list(filter?: { runId?: string }): Promise<ProvisionedEnv[]> {
    const args = ["ps", "-a", "--filter", "label=journeyman.runId"];
    if (filter?.runId) args.push("--filter", `label=journeyman.runId=${filter.runId}`);
    args.push("--format", "{{.ID}} {{.Mounts}} {{.Label \"journeyman.runId\"}}");
    const r = await this.deps.docker(args);
    return r.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((line) => {
        const [handle, , label] = line.split(/\s+/);
        const runId = (label ?? "").replace(/^journeyman\.runId=/, "");
        return { runId, type: "docker" as WorkerType, handle, volume: `jm-run-${runId}`, workspaceDir: WORKSPACE };
      });
  }
}
