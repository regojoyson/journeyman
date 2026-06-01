import type {
  Connectivity, ExecutionEnvironmentBackend, ExecutionEnvironmentSpec, ExecutionMode,
  IExecutionEnvironment, ResolvedWorker, WorkerType,
} from "@journeyman/core";
import type { DockerCommandRunner } from "./docker-command-runner.ts";
import { DockerExecutionEnvironment } from "./docker-execution-environment.ts";

export interface DockerBackendDeps {
  docker: DockerCommandRunner;
  /** Default runner image (e.g. journeyman/runner-base:<version>). */
  defaultImage: string;
  runnerCmd?: string[];
}

/** Build an ExecutionEnvironmentSpec from a docker worker's config. */
export function dockerSpecFromConfig(
  config: Record<string, unknown>,
  defaultImage: string,
): ExecutionEnvironmentSpec {
  const image = config.image as { kind?: string; imageRef?: string; content?: string } | undefined;
  if (image?.kind === "dockerfile") {
    throw new Error("docker worker: dockerfile images are not supported yet (Plan 5)");
  }
  const network = config.network === "none" ? "none" : "full";
  const resources = (config.resources as ExecutionEnvironmentSpec["resources"]) ?? undefined;
  const env = (config.env as Record<string, string>) ?? undefined;
  return {
    imageRef: image?.kind === "ref" && image.imageRef ? image.imageRef : defaultImage,
    network,
    ...(resources ? { resources } : {}),
    ...(env ? { env } : {}),
  };
}

export class DockerBackend implements ExecutionEnvironmentBackend {
  readonly type: WorkerType = "docker";
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

  create(worker: ResolvedWorker): IExecutionEnvironment {
    this.validateConfig(worker.config);
    return new DockerExecutionEnvironment({
      docker: this.deps.docker,
      defaultImage: this.deps.defaultImage,
      ...(this.deps.runnerCmd ? { runnerCmd: this.deps.runnerCmd } : {}),
    });
  }
}
