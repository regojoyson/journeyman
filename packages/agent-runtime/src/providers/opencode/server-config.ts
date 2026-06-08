import { createServer } from "node:net";
import type { ResolvedMcpInstance } from "@journeyman/core";
import type { OpenCodeProviderConfig } from "./types.ts";
import { toOpenCodeMcpConfigs } from "./mcp-adapter.ts";

const BYPASS_PERMISSION = {
  bash: "allow", edit: "allow", webfetch: "allow", websearch: "allow", skill: "allow",
} as const;

/**
 * Assemble the OpenCode `Config` passed at managed-server spawn. Permissions are
 * bypass-style (parity with Claude's bypassPermissions). MCP is merged from
 * static config + the per-call resolved instances. Tools/model/format are NOT here
 * — those are per-prompt params.
 */
export function buildServerConfig(
  config: OpenCodeProviderConfig,
  mcps: ResolvedMcpInstance[] | undefined,
): Record<string, unknown> {
  const permission = { ...BYPASS_PERMISSION, ...config.permission };
  const mcp = { ...(config.mcp ?? {}), ...(mcps?.length ? toOpenCodeMcpConfigs(mcps) : {}) };
  return {
    permission,
    ...(Object.keys(mcp).length ? { mcp } : {}),
  };
}

/**
 * Temporarily set env vars on process.env (the only channel the SDK forwards to
 * the spawned `opencode` process) and return a restore fn. Needed for the LOCAL
 * backend, where per-call secrets are not already on process.env. In the Docker
 * backend the runner's process.env already carries them, so this is a harmless
 * re-set. NOTE: process.env is process-global — concurrent local-backend ops can
 * race; acceptable for dev (Docker is the isolated production path).
 */
export function applyEnv(env: Record<string, string> | undefined): () => void {
  if (!env || !Object.keys(env).length) return () => {};
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  return () => {
    for (const [k, old] of Object.entries(prev)) {
      if (old === undefined) delete process.env[k];
      else process.env[k] = old;
    }
  };
}

/** Grab a free ephemeral TCP port so concurrent local managed servers don't collide. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}
