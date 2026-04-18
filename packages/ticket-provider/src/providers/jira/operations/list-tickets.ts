import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ListTicketsOptions, ListTicketsResult } from "@journeyman/core";
import { logSdkMessage } from "../utils/sdk-logger.ts";
import { buildMcpConfig } from "../utils/mcp-config.ts";

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    tickets: {
      type: "array",
      items: {
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
    },
    error: { type: "string" },
  },
  required: ["tickets"],
} as const;

function buildJql(opts: ListTicketsOptions): string {
  const clauses: string[] = [];
  if (opts.projectId) clauses.push(`project = "${opts.projectId}"`);
  if (opts.status) clauses.push(`status = "${opts.status}"`);
  if (opts.assignee) clauses.push(`assignee = "${opts.assignee}"`);
  return clauses.length ? clauses.join(" AND ") : "order by created DESC";
}

function buildPrompt(opts: ListTicketsOptions): string {
  return [
    `Search Jira issues using this JQL query: ${buildJql(opts)}`,
    "Return an array of issues, each with id, title, description, status, assignee, labels, and url.",
  ].join("\n");
}

export async function listTickets(opts: ListTicketsOptions): Promise<ListTicketsResult> {
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
      if (msg.subtype === "success") return msg.structured_output as ListTicketsResult;
      throw new Error((msg as any).errors?.[0] ?? "Unknown error");
    }
  }
  return { tickets: [], error: "No result received" };
}
