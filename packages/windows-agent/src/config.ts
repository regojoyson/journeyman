import { join } from "node:path";

export interface AgentConfig {
  host: string; port: number; certDir: string;
  workspaceRoot: string; runnerCommand: string; runnerArgs: string[];
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  return {
    host: env.JM_AGENT_HOST ?? "0.0.0.0",
    port: Number(env.JM_AGENT_PORT ?? 50051),
    certDir: env.JM_AGENT_CERT_DIR ?? "C:\\journeyman\\certs",
    workspaceRoot: env.JM_AGENT_WORKSPACE_ROOT ?? "C:\\jm-runs",
    runnerCommand: env.JM_AGENT_RUNNER_CMD ?? process.execPath,
    runnerArgs: env.JM_AGENT_RUNNER_ARGS ? env.JM_AGENT_RUNNER_ARGS.split(" ") : [join("C:\\journeyman", "runner.js")],
  };
}
