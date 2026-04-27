import type { McpCatalog } from "../types.ts";

export const defaultMcpCatalog: McpCatalog = [
  {
    id: "filesystem",
    label: "Filesystem",
    source: "builtin",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    description: "Read/write files via the official MCP filesystem server.",
  },
  {
    id: "git",
    label: "Git",
    source: "builtin",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-git"],
    description: "Run git commands via the official MCP git server.",
  },
  {
    id: "jira",
    label: "Jira",
    source: "provided",
    transport: "http",
    url: "https://mcp.atlassian.com/jira",
    requiredEnv: ["JIRA_API_TOKEN", "JIRA_EMAIL"],
    description: "Atlassian Jira via HTTP MCP. Requires JIRA_API_TOKEN + JIRA_EMAIL.",
  },
  {
    id: "slack",
    label: "Slack",
    source: "provided",
    transport: "http",
    url: "https://mcp.slack.com",
    requiredEnv: ["SLACK_BOT_TOKEN"],
    description: "Slack via HTTP MCP. Requires SLACK_BOT_TOKEN.",
  },
];
