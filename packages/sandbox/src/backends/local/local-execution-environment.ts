import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { extract } from "tar";
import type {
  ExecOp,
  ExecResult,
  ExecutionEnvironmentSpec,
  FileBundle,
  IExecutionEnvironment,
  OperationRunner,
  ProvisionedEnv,
  SandboxType,
} from "@journeyman/core";

export interface LocalExecutionEnvironmentDeps {
  runOperation: OperationRunner;
  baseDir: string;
  retainWorkspace?: boolean;
}

/**
 * The `local` backend: runs operations in-process, no container, no isolation.
 * Each run gets a dynamic instance folder `${baseDir}/${runId}`, shared across the run's steps.
 */
export class LocalExecutionEnvironment implements IExecutionEnvironment {
  readonly type: SandboxType = "local";

  constructor(private deps: LocalExecutionEnvironmentDeps) {}

  async provision(runId: string, _spec: ExecutionEnvironmentSpec): Promise<ProvisionedEnv> {
    const workspaceDir = join(this.deps.baseDir, runId);
    await mkdir(workspaceDir, { recursive: true });
    return { runId, type: "local", handle: `local:${runId}`, workspaceDir };
  }

  async exec(env: ProvisionedEnv, op: ExecOp): Promise<ExecResult> {
    return this.deps.runOperation(op, { workspaceDir: env.workspaceDir });
  }

  async destroy(env: ProvisionedEnv): Promise<void> {
    if (this.deps.retainWorkspace) return;
    await rm(env.workspaceDir, { recursive: true, force: true });
  }

  async list(): Promise<ProvisionedEnv[]> {
    return [];
  }

  async materialize(env: ProvisionedEnv, destDir: string, bundle: FileBundle): Promise<void> {
    // Resolve destDir to an absolute path on the local filesystem.
    // If it's already an absolute sub-path of workspaceDir, use it directly.
    // If it starts with /workspace (container convention), replace that prefix.
    // Otherwise join relative to workspaceDir.
    let abs: string;
    if (destDir.startsWith(env.workspaceDir)) {
      abs = destDir;
    } else if (destDir.startsWith("/workspace")) {
      abs = join(env.workspaceDir, destDir.replace(/^\/workspace\/?/, ""));
    } else {
      abs = join(env.workspaceDir, destDir.replace(/^\//, ""));
    }
    await rm(abs, { recursive: true, force: true });
    await mkdir(abs, { recursive: true });
    // Skip extraction for an empty bundle (nothing to write).
    const isEmpty = bundle.tar instanceof Buffer && bundle.tar.length === 0;
    if (isEmpty) return;
    await new Promise<void>((resolve, reject) => {
      const src: Readable =
        bundle.tar instanceof Buffer
          ? (Readable.from(bundle.tar as Iterable<number>) as Readable)
          : (bundle.tar as Readable);
      src.pipe(extract({ cwd: abs })).on("finish", resolve).on("error", reject);
    });
  }
}
