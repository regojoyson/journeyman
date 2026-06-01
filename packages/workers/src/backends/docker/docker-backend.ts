import type {
  Connectivity, ExecutionEnvironmentBackend, ExecutionEnvironmentSpec, ExecutionMode,
  IExecutionEnvironment, ResolvedWorker, WorkerType,
} from "@journeyman/core";
import type { IDockerClient } from "./docker-client.ts";
import { DockerExecutionEnvironment } from "./docker-execution-environment.ts";
import { buildDockerfileImage } from "./build-image.ts";

export interface ResolveDockerSpecDeps {
  client: IDockerClient;
  defaultImage: string;
  bundleRef: string;
}

/**
 * Build an ExecutionEnvironmentSpec from a docker worker's config, BUILDING the
 * image first when the config supplies a Dockerfile (auto-wrapped + cached).
 */
export async function resolveDockerSpec(
  config: Record<string, unknown>,
  deps: ResolveDockerSpecDeps,
): Promise<ExecutionEnvironmentSpec> {
  const image = config.image as { kind?: string; imageRef?: string; content?: string } | undefined;
  let imageRef: string;
  if (image?.kind === "dockerfile" && typeof image.content === "string") {
    imageRef = await buildDockerfileImage({ content: image.content, client: deps.client, bundleRef: deps.bundleRef });
  } else if (image?.kind === "ref" && image.imageRef) {
    imageRef = image.imageRef;
  } else {
    imageRef = deps.defaultImage;
  }
  const network = config.network === "none" ? "none" : "full";
  const resources = (config.resources as ExecutionEnvironmentSpec["resources"]) ?? undefined;
  const env = (config.env as Record<string, string>) ?? undefined;
  return { imageRef, network, ...(resources ? { resources } : {}), ...(env ? { env } : {}) };
}

export interface DockerBackendDeps {
  client: IDockerClient;
  /** Default runner image (e.g. journeyman/runner-base:<version>). */
  defaultImage: string;
  runnerCmd?: string[];
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
      client: this.deps.client,
      defaultImage: this.deps.defaultImage,
      ...(this.deps.runnerCmd ? { runnerCmd: this.deps.runnerCmd } : {}),
    });
  }
}
