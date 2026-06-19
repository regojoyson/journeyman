export type McpTransport = "stdio" | "http" | "sse";

export interface McpBinding {
  envVar: string;
  secretName: string;
}

export interface McpInstanceRecord {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  bindings: McpBinding[];
  systemPrompt: string | null;
  enabled: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResolvedMcpInstance {
  id: string;
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env: Record<string, string>;
  systemPrompt: string | null;
}

export class MissingMcpInstancesError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Missing or inaccessible MCP instances: ${missing.join(", ")}`);
    this.name = "MissingMcpInstancesError";
  }
}
