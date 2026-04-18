import type { McpHttpServerConfig } from "@anthropic-ai/claude-agent-sdk";

export function buildMcpConfig(): McpHttpServerConfig {
  const token = process.env.ATLASSIAN_API_TOKEN;
  if (!token) throw new Error("ATLASSIAN_API_TOKEN env var is required");
  return {
    type: "http",
    url: "https://mcp.atlassian.com/v1/mcp",
    headers: { Authorization: `Bearer ${token}` },
  };
}
