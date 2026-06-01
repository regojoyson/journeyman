import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type {
  ExecOp,
  ExecResult,
  ExecutionEnvironmentSpec,
  IExecutionEnvironment,
  OperationRunner,
  ProvisionedEnv,
  WorkerType,
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
  readonly type: WorkerType = "local";

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
}
