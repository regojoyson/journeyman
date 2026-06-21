import type { FastifyInstance } from "fastify";

/**
 * The single source of truth for the static catalog of well-known MCP servers.
 * Served verbatim by `GET /api/mcp-catalog`.
 *
 * Both frontend surfaces consume this endpoint: the "Add MCP from catalog"
 * modal and the flow-editor canvas's MCP picker (via `FlowEditorPage`). The
 * frontend no longer keeps its own copy of this data. The optional `category`
 * field powers grouping/filtering in the picker.
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
  category?: string;
}

const CATALOG: McpCatalogEntry[] = [
  // Files
  {
    id: "filesystem",
    label: "Filesystem",
    source: "builtin",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    description: "Read/write files via the official MCP filesystem server.",
    category: "files",
  },

  // Git / VCS
  {
    id: "git",
    label: "Git",
    source: "builtin",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-git"],
    description: "Run git commands via the official MCP git server.",
    category: "git",
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
    category: "git",
  },
  {
    id: "gitlab",
    label: "GitLab",
    source: "provided",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-gitlab"],
    requiredEnv: ["GITLAB_PERSONAL_ACCESS_TOKEN"],
    description: "GitLab issues, MRs, and repo access. Requires GITLAB_PERSONAL_ACCESS_TOKEN.",
    category: "git",
  },
  {
    id: "bitbucket",
    label: "Bitbucket",
    source: "provided",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@nexus2520/bitbucket-mcp-server"],
    requiredEnv: ["BITBUCKET_USERNAME", "BITBUCKET_APP_PASSWORD"],
    description: "Bitbucket Cloud repos and PRs. Requires BITBUCKET_USERNAME + BITBUCKET_APP_PASSWORD.",
    category: "git",
  },
  {
    id: "gitea",
    label: "Gitea / Forgejo",
    source: "provided",
    transport: "stdio",
    command: "npx",
    args: ["-y", "mcp-gitea"],
    requiredEnv: ["GITEA_URL", "GITEA_TOKEN"],
    description: "Self-hosted Gitea or Forgejo. Requires GITEA_URL + GITEA_TOKEN.",
    category: "git",
  },

  // Tickets
  {
    id: "jira-apitoken",
    label: "Jira (API Token)",
    source: "provided",
    transport: "stdio",
    command: "uvx",
    args: ["mcp-atlassian"],
    requiredEnv: ["JIRA_URL", "JIRA_USERNAME", "JIRA_API_TOKEN"],
    description:
      "Jira Cloud/Server via email + API token using sooperset/mcp-atlassian. Requires JIRA_URL (e.g. https://your-org.atlassian.net), JIRA_USERNAME (your email), JIRA_API_TOKEN.",
    category: "tickets",
  },
  {
    id: "linear",
    label: "Linear",
    source: "provided",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@tacticlaunch/mcp-linear"],
    requiredEnv: ["LINEAR_API_KEY"],
    description: "Linear issue tracker. Requires LINEAR_API_KEY.",
    category: "tickets",
  },
  {
    id: "monday",
    label: "Monday.com",
    source: "provided",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@mondaydotcomorg/monday-api-mcp"],
    requiredEnv: ["MONDAY_API_TOKEN"],
    description: "Monday.com boards and items. Requires MONDAY_API_TOKEN.",
    category: "tickets",
  },
  {
    id: "notion",
    label: "Notion",
    source: "provided",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@notionhq/notion-mcp-server"],
    requiredEnv: ["NOTION_API_KEY"],
    description: "Notion pages and databases. Requires NOTION_API_KEY.",
    category: "tickets",
  },
  {
    id: "asana",
    label: "Asana",
    source: "provided",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@roychri/mcp-server-asana"],
    requiredEnv: ["ASANA_ACCESS_TOKEN"],
    description: "Asana tasks and projects. Requires ASANA_ACCESS_TOKEN.",
    category: "tickets",
  },

  // Communication
  {
    id: "slack",
    label: "Slack",
    source: "provided",
    transport: "http",
    url: "https://mcp.slack.com",
    requiredEnv: ["SLACK_BOT_TOKEN"],
    description: "Slack via HTTP MCP. Requires SLACK_BOT_TOKEN.",
    category: "communication",
  },
  {
    id: "resend",
    label: "Resend",
    source: "provided",
    transport: "stdio",
    command: "npx",
    args: ["-y", "resend-mcp"],
    requiredEnv: ["RESEND_API_KEY"],
    description: "Send transactional email via Resend. Requires RESEND_API_KEY.",
    category: "communication",
  },
  {
    id: "smtp",
    label: "SMTP Email",
    source: "provided",
    transport: "stdio",
    command: "npx",
    args: ["-y", "mcp-mail-server"],
    requiredEnv: ["SMTP_HOST", "SMTP_PORT", "EMAIL_USER", "EMAIL_PASS"],
    description:
      "Send email over any SMTP server. Requires SMTP_HOST, SMTP_PORT, EMAIL_USER, EMAIL_PASS (optional SMTP_SECURE).",
    category: "communication",
  },

  // Database
  {
    id: "postgres",
    label: "Postgres",
    source: "builtin",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    requiredEnv: ["POSTGRES_URL"],
    description: "Read-only SQL access against Postgres. Requires POSTGRES_URL.",
    category: "database",
  },
  {
    id: "sqlite",
    label: "SQLite",
    source: "builtin",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sqlite"],
    description: "Query and inspect a local SQLite database file.",
    category: "database",
  },

  // Browser / HTTP
  {
    id: "playwright",
    label: "Playwright",
    source: "provided",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@playwright/mcp"],
    description: "Microsoft Playwright — drive Chromium/Firefox/WebKit for browsing, scraping, and E2E testing.",
    category: "browser",
  },
  {
    id: "fetch",
    label: "Fetch",
    source: "builtin",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    description: "HTTP fetch with automatic HTML → Markdown conversion.",
    category: "http",
  },

  // Observability
  {
    id: "sentry",
    label: "Sentry",
    source: "provided",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@sentry/mcp-server"],
    requiredEnv: ["SENTRY_AUTH_TOKEN"],
    description: "Inspect Sentry issues, events, and projects. Requires SENTRY_AUTH_TOKEN.",
    category: "observability",
  },

  // Docs
  {
    id: "context7",
    label: "Context7",
    source: "provided",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@upstash/context7-mcp"],
    description: "Up-to-date docs and code examples for popular libraries (Upstash Context7).",
    category: "docs",
  },

  // Design
  {
    id: "figma-cloud",
    label: "Figma (Cloud)",
    source: "provided",
    transport: "http",
    url: "https://api.figma.com/mcp",
    requiredEnv: ["FIGMA_API_TOKEN"],
    description: "Figma cloud MCP — read files, frames, components, and variables. Requires FIGMA_API_TOKEN.",
    category: "design",
  },
  {
    id: "figma-local",
    label: "Figma (Local Dev Mode)",
    source: "provided",
    transport: "sse",
    url: "http://127.0.0.1:3845/sse",
    description: "Figma desktop's local Dev Mode MCP — pulls design context from the currently open file. No token needed; Figma desktop must be running with Dev Mode MCP enabled.",
    category: "design",
  },
];

export async function registerMcpCatalogRoute(app: FastifyInstance) {
  app.get("/api/mcp-catalog", async () => CATALOG);
}
