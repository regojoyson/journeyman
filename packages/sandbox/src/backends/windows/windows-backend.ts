import type {
  Connectivity, ExecutionEnvironmentBackend, ExecutionMode,
  IExecutionEnvironment, ResolvedSandbox, SandboxType,
} from "@journeyman/core";
import type { AgentClient, WindowsAgentConnection } from "./windows-agent-client.ts";
import { WindowsExecutionEnvironment } from "./windows-execution-environment.ts";

export interface WindowsBackendDeps {
  /** Build a per-connection mTLS gRPC client (per-process). */
  makeClient: (connection: WindowsAgentConnection) => AgentClient;
}

export class WindowsBackend implements ExecutionEnvironmentBackend {
  readonly type: SandboxType = "machine-windows";
  readonly supportedModes: ExecutionMode[] = ["shared"];
  readonly supportedConnectivity: Connectivity[] = ["agent"];

  constructor(private deps: WindowsBackendDeps) {}

  validateConfig(config: unknown): void {
    if (config == null || typeof config !== "object") throw new Error("machine-windows config must be an object");
    const c = (config as Record<string, unknown>)["connection"] as Partial<WindowsAgentConnection> | undefined;
    if (!c || typeof c.host !== "string" || !c.host.trim()) throw new Error("machine-windows config.connection.host is required");
    if (typeof c.port !== "number" || !c.port) throw new Error("machine-windows config.connection.port is required");
    if (typeof c.certDir !== "string" || !c.certDir.trim()) throw new Error("machine-windows config.connection.certDir is required");
  }

  create(worker: ResolvedSandbox): IExecutionEnvironment {
    this.validateConfig(worker.config);
    const conn = (worker.config as Record<string, unknown>)["connection"] as WindowsAgentConnection;
    return new WindowsExecutionEnvironment({ client: this.deps.makeClient(conn) });
  }
}
