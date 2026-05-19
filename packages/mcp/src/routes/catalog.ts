import type { FastifyInstance } from "fastify";

/**
 * Static catalog of well-known MCP servers. Mirrors the entries available in
 * `@journeyman/flow-editor`'s `defaultMcpCatalog`, but lives here to avoid
 * pulling JSX-bearing flow-editor sources into the server-side typecheck.
 *
 * The "Add MCP from catalog" UI calls `GET /api/mcp-catalog` and uses the
 * returned entries to pre-fill the create form.
 */
interface McpCatalogEntry {
  id: string;
  label: string;
  source: "builtin" | "provided";
  transport: "stdio" | "http" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  requiredEnv?: string[];
  description?: string;
}

const CATALOG: McpCatalogEntry[] = [
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
  {
    id: "github",
    label: "GitHub",
    source: "provided",
    transport: "http",
    url: "https://api.githubcopilot.com/mcp/",
    requiredEnv: ["AUTHORIZATION"],
    description:
      "Official GitHub MCP via hosted HTTP endpoint. Bind AUTHORIZATION to a GitHub PAT secret; the server sends it as Bearer auth.",
  },
];

export async function registerMcpCatalogRoute(app: FastifyInstance) {
  app.get("/api/mcp-catalog", async () => CATALOG);
}
