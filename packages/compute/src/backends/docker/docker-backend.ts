import type {
  Connectivity, ExecutionEnvironmentBackend, ExecutionMode,
  IExecutionEnvironment, ResolvedComputeTarget, ComputeTargetType,
} from "@journeyman/core";
import type { IDockerClient } from "./docker-client.ts";
import { DockerExecutionEnvironment } from "./docker-execution-environment.ts";

export interface DockerBackendDeps {
  client: IDockerClient;
  /** Default runner image (e.g. journeyman/runner-base:<version>). */
  defaultImage: string;
  runnerCmd?: string[];
}

export class DockerBackend implements ExecutionEnvironmentBackend {
  readonly type: ComputeTargetType = "docker";
  readonly supportedModes: ExecutionMode[] = ["per-instance"];
  readonly supportedConnectivity: Connectivity[] = ["push"];

  constructor(private deps: DockerBackendDeps) {}

  validateConfig(config: unknown): void {
    if (config == null) return;
    if (typeof config !== "object") throw new Error("docker worker config must be an object");
    const c = config as Record<string, unknown>;
    if (c.image !== undefined) {
      const image = c.image as { kind?: string };
      if (image.kind !== "ref" && image.kind !== "dockerfile") {
        throw new Error("docker worker config.image.kind must be 'ref' or 'dockerfile'");
      }
    }
    if (c.network !== undefined && c.network !== "full" && c.network !== "none") {
      throw new Error("docker worker config.network must be 'full' or 'none'");
    }
  }

  create(worker: ResolvedComputeTarget): IExecutionEnvironment {
    this.validateConfig(worker.config);
    return new DockerExecutionEnvironment({
      client: this.deps.client,
      defaultImage: this.deps.defaultImage,
      ...(this.deps.runnerCmd ? { runnerCmd: this.deps.runnerCmd } : {}),
    });
  }
}
