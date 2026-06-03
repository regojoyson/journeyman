import type { WorkerType } from "@journeyman/core";
import type { IDockerClient, DockerConnection } from "./backends/docker/docker-client.ts";

export interface ConnectionTestResult { ok: boolean; error?: string }

export interface RunWorkerConnectionTestDeps {
  makeDockerClient: (connection?: DockerConnection) => IDockerClient;
}

/** Validate that a worker's connection config can reach its target. Docker only for now. */
export async function runWorkerConnectionTest(
  input: { type: WorkerType; config: Record<string, unknown> },
  deps: RunWorkerConnectionTestDeps,
): Promise<ConnectionTestResult> {
  if (input.type !== "docker") {
    return { ok: false, error: `No connection test for type '${input.type}'` };
  }
  const connection = (input.config.connection as DockerConnection | undefined) ?? { kind: "local" };
  try {
    await deps.makeDockerClient(connection).ping();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? "Connection failed" };
  }
}
