import { query } from "@anthropic-ai/claude-agent-sdk";
import type { UpdateTicketOptions, UpdateTicketResult } from "@journeyman/core";
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

function buildPrompt(opts: UpdateTicketOptions): string {
  const parts = [`Update Jira issue with key: ${opts.id}`];
  if (opts.title) parts.push(`New title: ${opts.title}`);
  if (opts.description) parts.push(`New description: ${opts.description}`);
  if (opts.status) parts.push(`New status (transition to): ${opts.status}`);
  if (opts.assignee) parts.push(`New assignee account ID or email: ${opts.assignee}`);
  if (opts.labels?.length) parts.push(`New labels: ${opts.labels.join(", ")}`);
  parts.push("Return the updated issue's id, title, description, status, assignee, labels, and url.");
  return parts.join("\n");
}

export async function updateTicket(opts: UpdateTicketOptions): Promise<UpdateTicketResult> {
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
      if (msg.subtype === "success") return msg.structured_output as UpdateTicketResult;
      throw new Error((msg as any).errors?.join(", ") || "Unknown error");
    }
  }
  return { error: "No result received" };
}
