import { query } from "@anthropic-ai/claude-agent-sdk";
import type { CreateTicketOptions, CreateTicketResult } from "@journeyman/core";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { buildMcpConfig } from "../utils/mcp-config.ts";

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    ticket: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
        status: { type: "string" },
        assignee: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        url: { type: "string" },
      },
      required: ["id", "title"],
    },
    error: { type: "string" },
  },
} as const;

function buildPrompt(opts: CreateTicketOptions): string {
  const parts = [
    "Create a Jira issue with the following details:",
    `Title: ${opts.title}`,
    "Issue type: Task",
  ];
  if (opts.description) parts.push(`Description: ${opts.description}`);
  if (opts.projectId) parts.push(`Project ID or key: ${opts.projectId}`);
  if (opts.assignee) parts.push(`Assignee account ID or email: ${opts.assignee}`);
  if (opts.labels?.length) parts.push(`Labels: ${opts.labels.join(", ")}`);
  parts.push("Return the created issue's id, title, description, status, assignee, labels, and url.");
  return parts.join("\n");
}

export async function createTicket(opts: CreateTicketOptions): Promise<CreateTicketResult> {
  for await (const msg of query({
    prompt: buildPrompt(opts),
    options: {
      tools: [],
      allowedTools: [],
      mcpServers: { atlassian: buildMcpConfig() },
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: [],
      outputFormat: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
  })) {
    logSdkMessage(msg);
    if (msg.type === "result") {
      if (msg.subtype === "success") return msg.structured_output as CreateTicketResult;
      throw new Error((msg as any).errors?.[0] ?? "Unknown error");
    }
  }
  return { error: "No result received" };
}
