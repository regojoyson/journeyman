import type { ResolvedMcpInstance } from "@journeyman/core";
import type { McpLocalConfig, McpRemoteConfig } from "./types.ts";

/**
 * Convert resolved MCP instances into OpenCode's `Config.mcp` map.
 *  - stdio  → { type:"local", command:[command, ...args], environment }
 *  - http/sse → { type:"remote", url, headers }
 * Names collide-suffixed (-2, -3, …) to keep keys unique. AUTHORIZATION env on a
 * remote instance becomes a proper `Authorization` header.
 */
export function toOpenCodeMcpConfigs(
  instances: ResolvedMcpInstance[],
): Record<string, McpLocalConfig | McpRemoteConfig> {
  const out: Record<string, McpLocalConfig | McpRemoteConfig> = {};
  const seen = new Map<string, number>();

  for (const inst of instances) {
    const base = inst.name;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const key = n === 1 ? base : `${base}-${n}`;

    if (inst.transport === "stdio") {
      out[key] = {
        type: "local",
        command: [inst.command ?? "", ...(inst.args ?? [])].filter(Boolean),
        ...(Object.keys(inst.env).length ? { environment: inst.env } : {}),
        enabled: true,
      };
    } else {
      out[key] = {
        type: "remote",
        url: inst.url ?? "",
        ...(Object.keys(inst.env).length ? { headers: toHeaders(inst.env) } : {}),
        enabled: true,
      };
    }
  }
  return out;
}

function toHeaders(env: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    headers[k.toUpperCase() === "AUTHORIZATION" ? "Authorization" : k] = v;
  }
  return headers;
}
