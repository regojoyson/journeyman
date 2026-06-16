import type { IExecutionEnvironmentRegistry, ResolvedSandbox, SandboxType } from "@journeyman/core";
import type { SandboxInstanceRecord } from "./sandbox-instance-store.ts";

/**
 * Tear down a tracked sandbox instance via the registry — the single teardown
 * path used by the api-server reaper, the admin routes, and the CLI. Synthesizes
 * a minimal ResolvedSandbox from the record (connection is enough for destroy).
 */
export async function destroySandboxInstance(
  registry: IExecutionEnvironmentRegistry,
  sb: SandboxInstanceRecord,
): Promise<void> {
  const type = sb.type as SandboxType;
  const worker: ResolvedSandbox = {
    id: sb.runId,
    type,
    executionMode: "shared",
    config: { connection: sb.connection ?? undefined },
  };
  const env = registry.get(type).create(worker);
  await env.destroy({
    runId: sb.runId,
    type,
    handle: sb.handle,
    ...(sb.volume ? { volume: sb.volume } : {}),
    workspaceDir: type === "local" ? sb.handle.replace(/^local:/, "") : "/workspace",
  });
}
