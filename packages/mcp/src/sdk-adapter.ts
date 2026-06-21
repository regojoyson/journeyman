import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { ResolvedMcpInstance } from "@journeyman/core";

/**
 * Convert resolved MCP instances into the SDK's mcpServers shape.
 *
 * The SDK keys the map by a server name. We use `instance.name`. If two
 * instances share the same name (one user-scope and one org-scope, allowed by
 * the unique-per-scope DB constraint), the second occurrence is suffixed.
 */
export function toMcpServerConfigs(
  resolved: ResolvedMcpInstance[],
): Record<string, McpServerConfig> {
  const out: Record<string, McpServerConfig> = {};
  const seen = new Map<string, number>();
  for (const inst of resolved) {
    const baseCount = seen.get(inst.name) ?? 0;
    const key = baseCount === 0 ? inst.name : `${inst.name}_${baseCount + 1}`;
    seen.set(inst.name, baseCount + 1);
    out[key] = buildConfig(inst);
  }
  return out;
}

/**
 * Convert a resolved instance's env map into HTTP headers.
 *
 * Special-cases `AUTHORIZATION` → `Authorization: Bearer <value>`. Any other
 * env key is copied to the headers verbatim. We deliberately do NOT also
 * write the original `AUTHORIZATION` key — HTTP header names are
 * case-insensitive, and writing both caused the raw token to overwrite the
 * Bearer-formatted one in the underlying fetch Headers object.
 */
export function buildHeaders(env: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (k === "AUTHORIZATION") {
      headers["Authorization"] =
        v.startsWith("Basic ") || v.startsWith("Bearer ") ? v : `Bearer ${v}`;
    } else {
      headers[k] = v;
    }
  }
  return headers;
}

function buildConfig(inst: ResolvedMcpInstance): McpServerConfig {
  if (inst.transport === "stdio") {
    return {
      type: "stdio",
      command: inst.command!,
      args: inst.args ?? [],
      env: inst.env,
    };
  }
  const headers = buildHeaders(inst.env);
  if (inst.transport === "sse") {
    return { type: "sse", url: inst.url!, headers };
  }
  return { type: "http", url: inst.url!, headers };
}

/**
 * Concatenate non-empty system prompts with `\n\n`. Returns "" if none.
 */
export function mergeSystemPrompts(resolved: ResolvedMcpInstance[]): string {
  return resolved
    .map((i) => (i.systemPrompt ?? "").trim())
    .filter((s) => s.length > 0)
    .join("\n\n");
}
