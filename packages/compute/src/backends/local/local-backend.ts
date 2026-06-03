import type {
  Connectivity,
  ExecutionEnvironmentBackend,
  ExecutionMode,
  IExecutionEnvironment,
  OperationRunner,
  ResolvedComputeTarget,
  ComputeTargetType,
} from "@journeyman/core";
import { LocalExecutionEnvironment } from "./local-execution-environment.ts";

export interface LocalWorkerConfig {
  baseDir?: string;
  retainWorkspace?: boolean;
}

export interface LocalBackendDeps {
  runOperation: OperationRunner;
  defaultBaseDir: string;
}

export class LocalBackend implements ExecutionEnvironmentBackend {
  readonly type: ComputeTargetType = "local";
  readonly supportedModes: ExecutionMode[] = ["shared"];
  readonly supportedConnectivity: Connectivity[] = [];

  constructor(private deps: LocalBackendDeps) {}

  validateConfig(config: unknown): void {
    if (config == null) return;
    if (typeof config !== "object") {
      throw new Error("local worker config must be an object");
    }
    const c = config as Record<string, unknown>;
    if (c.baseDir !== undefined && typeof c.baseDir !== "string") {
      throw new Error("local worker config.baseDir must be a string");
    }
    if (c.retainWorkspace !== undefined && typeof c.retainWorkspace !== "boolean") {
      throw new Error("local worker config.retainWorkspace must be a boolean");
    }
  }

  create(worker: ResolvedComputeTarget): IExecutionEnvironment {
    this.validateConfig(worker.config);
    const cfg = (worker.config ?? {}) as LocalWorkerConfig;
    return new LocalExecutionEnvironment({
      runOperation: this.deps.runOperation,
      baseDir: cfg.baseDir ?? this.deps.defaultBaseDir,
      retainWorkspace: cfg.retainWorkspace,
    });
  }
}
