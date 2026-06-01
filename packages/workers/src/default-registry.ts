import type { OperationRunner } from "@journeyman/core";
import { InMemoryExecutionEnvironmentRegistry } from "./registry/in-memory-execution-environment-registry.ts";
import { LocalBackend } from "./backends/local/local-backend.ts";
import { DockerBackend, type DockerBackendDeps } from "./backends/docker/docker-backend.ts";

export interface DefaultRegistryOptions {
  runOperation: OperationRunner;
  defaultBaseDir: string;
  /** When provided, also register the docker backend. */
  docker?: DockerBackendDeps;
}

/** Build a registry with the always-available `local` backend (+ `docker` when configured). */
export function createDefaultRegistry(
  opts: DefaultRegistryOptions,
): InMemoryExecutionEnvironmentRegistry {
  const registry = new InMemoryExecutionEnvironmentRegistry();
  registry.register(
    new LocalBackend({ runOperation: opts.runOperation, defaultBaseDir: opts.defaultBaseDir }),
  );
  if (opts.docker) {
    registry.register(new DockerBackend(opts.docker));
  }
  return registry;
}
