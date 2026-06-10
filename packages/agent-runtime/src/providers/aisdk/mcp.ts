import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { tool, jsonSchema } from "ai";
import type { ResolvedMcpInstance } from "@journeyman/core";

interface McpClient {
  /** Returns a record of AI SDK tools (already prefixed-ready, un-prefixed names). */
  tools: () => Promise<Record<string, unknown>>;
  close: () => Promise<void>;
}

export interface BuildMcpDeps {
  /** Injectable for tests; defaults to a real @modelcontextprotocol/sdk client. */
  createClient?: (inst: ResolvedMcpInstance) => Promise<McpClient>;
}

function toHeaders(env: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) h[k.toUpperCase() === "AUTHORIZATION" ? "Authorization" : k] = v;
  return h;
}

/** Connect to one MCP server and expose its tools as AI SDK tools that proxy callTool. */
async function defaultCreate(inst: ResolvedMcpInstance): Promise<McpClient> {
  const transport =
    inst.transport === "stdio"
      ? new StdioClientTransport({ command: inst.command ?? "", args: inst.args ?? [], env: inst.env })
      : new StreamableHTTPClientTransport(new URL(inst.url ?? ""), { requestInit: { headers: toHeaders(inst.env) } });

  const client = new Client({ name: "journeyman-aisdk", version: "1.0.0" });
  await client.connect(transport);

  return {
    tools: async () => {
      const listed = await client.listTools();
      const out: Record<string, unknown> = {};
      for (const t of listed.tools) {
        out[t.name] = tool({
          description: t.description ?? t.name,
          inputSchema: jsonSchema((t.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} }),
          execute: async (args: unknown) => client.callTool({ name: t.name, arguments: (args ?? {}) as Record<string, unknown> }),
        });
      }
      return out;
    },
    close: () => client.close(),
  };
}

export async function buildMcpTools(
  instances: ResolvedMcpInstance[],
  deps: BuildMcpDeps = {},
): Promise<{ tools: Record<string, unknown>; close: () => Promise<void> }> {
  const create = deps.createClient ?? defaultCreate;
  const clients: McpClient[] = [];
  const tools: Record<string, unknown> = {};
  const seen = new Map<string, number>();

  for (const inst of instances) {
    const client = await create(inst);
    clients.push(client);
    const n = (seen.get(inst.name) ?? 0) + 1;
    seen.set(inst.name, n);
    const key = n === 1 ? inst.name : `${inst.name}-${n}`;
    const provided = await client.tools();
    for (const [name, def] of Object.entries(provided)) tools[`mcp__${key}__${name}`] = def;
  }

  return {
    tools,
    close: async () => { for (const c of clients) await c.close().catch(() => {}); },
  };
}
