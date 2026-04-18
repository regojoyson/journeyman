import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { URL } from "node:url";

const GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp/";

export async function connectGitHubMcp(): Promise<Client> {
  const token = process.env.GITHUB_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "GitHub ticket provider: PAT required. Set GITHUB_ACCESS_TOKEN.",
    );
  }
  const transport = new StreamableHTTPClientTransport(new URL(GITHUB_MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client(
    { name: "journeyman-ticket-provider", version: "0.1.0" },
    { capabilities: {} },
  );
  await client.connect(transport);
  return client;
}

export async function callTool<T>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) {
    throw new Error(`MCP tool '${name}' failed: ${JSON.stringify(res.content)}`);
  }
  const content = res.content as Array<{ type: string; text?: string }>;
  const text = content.find((c) => c.type === "text")?.text;
  if (!text) throw new Error(`MCP tool '${name}' returned no text content`);
  return JSON.parse(text) as T;
}
