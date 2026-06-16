import type { OperationRunner } from "@journeyman/core";
import { InMemoryExecutionEnvironmentRegistry } from "./registry/in-memory-execution-environment-registry.ts";
import { LocalBackend } from "./backends/local/local-backend.ts";
import { DockerBackend, type DockerBackendDeps } from "./backends/docker/docker-backend.ts";
import { WindowsBackend, type WindowsBackendDeps } from "./backends/windows/windows-backend.ts";

export interface DefaultRegistryOptions {
  /** Local backend deps. `runOperation` omitted ⇒ teardown-only (no exec). */
  runOperation?: OperationRunner;
  defaultBaseDir: string;
  /** When provided, also register the docker backend (per-connection factory-based). */
  docker?: DockerBackendDeps;
  /** When provided, also register the machine-windows backend. */
  windows?: WindowsBackendDeps;
}

/** Build a per-process registry: `local` always, `docker`/`windows` when configured. */
export function createDefaultRegistry(
  opts: DefaultRegistryOptions,
): InMemoryExecutionEnvironmentRegistry {
  const registry = new InMemoryExecutionEnvironmentRegistry();
  registry.register(
    new LocalBackend({
      ...(opts.runOperation ? { runOperation: opts.runOperation } : {}),
      defaultBaseDir: opts.defaultBaseDir,
    }),
  );
  if (opts.docker) {
    registry.register(new DockerBackend(opts.docker));
  }
  if (opts.windows) {
    registry.register(new WindowsBackend(opts.windows));
  }
  return registry;
}
