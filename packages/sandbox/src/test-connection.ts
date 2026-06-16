import type { SandboxType } from "@journeyman/core";
import type { IDockerClient, DockerConnection } from "./backends/docker/docker-client.ts";
import type { AgentClient, WindowsAgentConnection } from "./backends/windows/windows-agent-client.ts";
import type { ReadinessReply } from "@journeyman/agent-protocol";

export interface ConnectionTestResult { ok: boolean; error?: string }

export interface RunWorkerConnectionTestDeps {
  makeDockerClient: (connection: DockerConnection) => IDockerClient;
  makeWindowsClient?: (connection: WindowsAgentConnection) => AgentClient;
}

/** Validate that a worker's connection config can reach its target (docker ping / windows readiness). */
export async function runWorkerConnectionTest(
  input: { type: SandboxType; config: Record<string, unknown> },
  deps: RunWorkerConnectionTestDeps,
): Promise<ConnectionTestResult> {
  if (input.type === "machine-windows") {
    if (!deps.makeWindowsClient) return { ok: false, error: "windows connection test not configured" };
    const conn = input.config.connection as WindowsAgentConnection | undefined;
    try {
      const client = deps.makeWindowsClient(conn as WindowsAgentConnection);
      const ready = await new Promise<ReadinessReply>((res, rej) =>
        client.Readiness({}, (e, r) => (e ? rej(e) : res(r))));
      client.close();
      if (ready.ready) return { ok: true };
      const failed = ready.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join("; ");
      return { ok: false, error: failed || "agent not ready" };
    } catch (err) {
      return { ok: false, error: (err as Error)?.message ?? "Connection failed" };
    }
  }
  if (input.type !== "docker") {
    return { ok: false, error: `No connection test for type '${input.type}'` };
  }
  const connection = input.config.connection as DockerConnection | undefined;
  try {
    await deps.makeDockerClient(connection as DockerConnection).ping();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error)?.message ?? "Connection failed" };
  }
}
